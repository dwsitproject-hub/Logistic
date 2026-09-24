-- Jetty Planning System (JPS): the tracker behind KLIP's outbound Shipping Instructions.
--
-- KLIP submits one Shipping Instruction per STO to JPS so a berth can be planned for a vessel
-- discharging at BONTANG, then polls for the operator's decision. This table is the only record of
-- that conversation: JPS itself cannot be queried by shipment, only by the reference we chose.
--
-- WHY A TABLE AND NOT A COLUMN ON shipments. The grain is the STO, and 470 of 1,042 STOs carry
-- more than one `shipments` row - one per PO. Hanging this off `shipments` would submit the same
-- vessel call several times, and every retry after the first would come back 409.
--
-- external_reference CARRIES A REVISION. JPS requires it unique per API key, and a rejected
-- instruction cannot be corrected - the partner has to submit a NEW one with a NEW reference
-- (partner API v4.2 §4.2). The STO number alone would therefore be spent after a single rejection,
-- so the reference is `KLIP-<sto>-R<n>` and `revision` counts up.
--
-- DELTA ONLY. Ryan asked for no backfill: only STOs that become eligible after go-live are sent.
-- The seed at the bottom writes a row for every STO that already satisfies the rule, marked
-- SKIPPED_PRE_EXISTING, so the daily sweep simply skips anything it already knows. A timestamp
-- watermark was the alternative and was rejected - a SAP import bumps `updated_at` on thousands of
-- rows it did not meaningfully change, so "changed since deploy" would fire on noise.

CREATE TABLE IF NOT EXISTS jps_shipping_instructions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- COALESCE(shipments.shipment_id, shipments.operation_id): the STO, or the manual planning id
  -- when a shipment has no STO. 31 of the 35 BONTANG shipments missing from contract_stos are
  -- reachable only through operation_id.
  sto_key VARCHAR(100) NOT NULL,

  external_reference VARCHAR(100) NOT NULL,
  revision INT NOT NULL DEFAULT 1,

  -- KLIP-side state. SKIPPED_PRE_EXISTING is the seed; it is never submitted.
  state VARCHAR(30) NOT NULL DEFAULT 'PENDING_SUBMIT',

  -- JPS-side state, copied verbatim from the API: Pending / Approved / Rejected / Allocated.
  jps_id INT,
  jps_status VARCHAR(30),
  rejection_reason TEXT,
  jetty_name VARCHAR(200),
  planned_berthing_time TIMESTAMPTZ,

  submitted_at TIMESTAMPTZ,
  last_polled_at TIMESTAMPTZ,
  last_error TEXT,
  request_id VARCHAR(100),
  payload JSONB,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_jps_si_external_reference UNIQUE (external_reference),
  CONSTRAINT uq_jps_si_sto_revision UNIQUE (sto_key, revision),
  CONSTRAINT chk_jps_si_state CHECK (state IN (
    'PENDING_SUBMIT', 'SUBMITTED', 'FAILED', 'SKIPPED_PRE_EXISTING', 'SKIPPED_NO_CARGO'
  ))
);

-- The sweep asks "which STOs do I already know about", so sto_key is the hot lookup.
CREATE INDEX IF NOT EXISTS idx_jps_si_sto_key ON jps_shipping_instructions (sto_key);

-- The poller asks for live instructions oldest-polled-first; JPS allows one poll per instruction
-- per 5 minutes, so the ordering has to be cheap.
CREATE INDEX IF NOT EXISTS idx_jps_si_poll
  ON jps_shipping_instructions (last_polled_at NULLS FIRST)
  WHERE state = 'SUBMITTED' AND jps_status IN ('Pending', 'Approved');

-- Seed: everything that already satisfies the rule at go-live, so it is never submitted.
--
-- The rule, as agreed with Ryan on 2026-09-23:
--   Region/Site = BONTANG, ATC Loading filled (SAP or a KLIP edit), no discharge ATA of any kind,
--   status not COMPLETED/CANCELLED, and ETA discharge arrival present (JPS requires `eta`).
--
-- ATA Sailed is deliberately absent. It is filled alongside ATC Loading on 1,799 of 1,818
-- shipments, so requiring it changes nothing today, and requiring its ABSENCE would mean the
-- trigger never fires at all.
INSERT INTO jps_shipping_instructions (sto_key, external_reference, revision, state)
SELECT sto_key, 'KLIP-' || sto_key || '-R1', 1, 'SKIPPED_PRE_EXISTING'
FROM (
  SELECT DISTINCT COALESCE(
           NULLIF(TRIM(s.shipment_id), ''),
           NULLIF(TRIM(s.operation_id), '')
         ) AS sto_key
  FROM shipments s
  LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
  INNER JOIN contracts c ON c.id = s.contract_id
  INNER JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
  WHERE UPPER(TRIM(COALESCE(l.discharge_destination, ''))) = 'BONTANG'
    AND COALESCE(NULLIF(TRIM(s.shipment_id), ''), NULLIF(TRIM(s.operation_id), '')) IS NOT NULL
    AND COALESCE(sao.ata_loading_complete, s.ata_loading_complete) IS NOT NULL
    AND COALESCE(sao.ata_discharge_arrival, s.ata_discharge_arrival) IS NULL
    AND COALESCE(sao.ata_discharge_berthed, s.ata_discharge_berthed) IS NULL
    AND COALESCE(sao.ata_discharge_start, s.ata_discharge_start) IS NULL
    AND COALESCE(sao.ata_discharge_complete, s.ata_discharge_complete) IS NULL
    AND COALESCE(s.status, '') NOT IN ('COMPLETED', 'CANCELLED')
    AND s.eta_discharge_arrival IS NOT NULL
) eligible
ON CONFLICT (external_reference) DO NOTHING;
