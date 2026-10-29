/**
 * Is this STO ready to be sent to the Jetty Planning System, and if not, what is missing and where is it fixed?
 *
 * Behind the Submit to Jetty button. It answers from the SAME rule the sweep uses (eligibility.ts: findEligibleStos for the data, and the payload builder's own
 * problem list for the master data), plus one query that reads each condition on its own, because the rule only says "not eligible" and the user needs to
 * know which condition. Writes nothing and calls nothing at JPS except the port/company catalog the payload builder asks for.
 *
 * JPS has no dry-run endpoint, so what only JPS can know - its own master data, e.g. a vessel dimension it holds as 0 - cannot be checked here; it shows
 * up in the answer to the real submission.
 */
import { query } from '../database/connection';
import { isJpsEnabled, jpsEnabledPortNames, jpsPorts } from './config';
import { companiesForPort, fetchJpsPortCompanies } from './companies';
import { fetchJpsKnownPorts } from './portCatalog';
import { EFFECTIVE_ATA_SQL, STO_KEY_SQL, findEligibleStos } from './eligibility';
import { buildJpsSubmitPayload } from './mapper';
import { isJpsClosedStatus } from './types';
import { JPS_CURRENT_ROW_ORDER_SQL } from '../utils/shipmentListStoJoinSql';

/** Where the missing thing is fixed: on this shipment, in a KLIP master page, in SAP, or at JPS. */
export type ReadinessFix = 'shipment' | 'master_port' | 'master_vessel' | 'master_product' | 'master_company' | 'sap' | 'jps' | 'settings';

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  /** What KLIP found (the value that decided it). */
  value: string;
  /** What to do when it is not ok. */
  fix?: string;
  fixAt?: ReadinessFix;
}

export interface JpsTrackerState {
  state: string;
  revision: number;
  jpsStatus: string | null;
  lastError: string | null;
  updatedAt: string | null;
  /** Why the JPS operator rejected it (jps_status Rejected), as JPS wrote it. */
  rejectionReason: string | null;
  rejectedAt: string | null;
}

/** Present when JPS closed the instruction KLIP sent (Rejected, or Deleted by an operator): the STO can be sent again, as a NEW instruction under the next revision. */
export interface JpsResubmitInfo {
  /** What JPS says the closed instruction is: 'Rejected' or 'Deleted'. */
  status: string;
  fromRevision: number;
  rejectionReason: string | null;
  rejectedAt: string | null;
  /** True when what KLIP would send now is identical to what JPS rejected (nothing was fixed on KLIP's side); null when that could not be built. */
  payloadUnchanged: boolean | null;
}

export interface JpsReadiness {
  stoKey: string | null;
  /** Everything KLIP can check passed and nothing at JPS blocks a (re)submission. */
  canSubmit: boolean;
  /** Why not, in a sentence, when canSubmit is false. */
  reason: string | null;
  tracker: JpsTrackerState | null;
  /** Set when the instruction at JPS was rejected, so sending again is a resubmission under a new reference. */
  resubmit: JpsResubmitInfo | null;
  checks: ReadinessCheck[];
}

/** Key order must not matter when two payloads are compared. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Whether two submit payloads say the same thing to JPS. The external reference differs by design (a resubmission is a new revision), so it is left out;
 * so is who asked (the sweep sends `sap-data-import`, a button press the user's email), which JPS does not judge the instruction by.
 * Used to warn that a resubmission repeats what JPS rejected.
 */
export function samePayloadIgnoringReference(a: unknown, b: unknown): boolean {
  const strip = (p: unknown) => {
    if (!p || typeof p !== 'object') return p;
    const { external_reference: _ignored, requested_by: _requester, ...rest } = p as Record<string, unknown>;
    return rest;
  };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

const fmtDate = (v: unknown): string => {
  if (!v) return '(empty)';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/** Which master page a payload problem points at, from the wording the payload builder uses. */
export function classifyPayloadProblem(problem: string): { fixAt: ReadinessFix; fix: string } {
  const p = problem.toLowerCase();
  // A port JPS does not have is JPS's to add: the Master Port is fine on KLIP's side.
  if (p.includes('not known to jps')) {
    return { fixAt: 'jps', fix: "Ask the JPS team to add this port to their master data (GET /catalog/port), or leave the shipment out: JPS refuses a port it does not know." };
  }
  if (p.includes('master port') || p.includes('discharge port')) {
    return { fixAt: 'master_port', fix: 'Fill the DHM code of this port in Master Port (or sync it from DHM).' };
  }
  if (p.includes('master vessel')) {
    return { fixAt: 'master_vessel', fix: 'Fill the DHM code of this vessel in Master Vessel (or sync it from DHM).' };
  }
  if (p.includes('master product')) {
    return { fixAt: 'master_product', fix: 'Fill the DHM code of this product in Master Product (or sync it from DHM).' };
  }
  if (p.includes('compan')) {
    return { fixAt: 'master_company', fix: 'Fill the DHM code of the operating company in Master Company (Internal).' };
  }
  if (p.includes('eta discharge')) {
    return { fixAt: 'shipment', fix: 'Fill ETA at Discharge Port on this shipment and save.' };
  }
  if (p.includes('sto quantity') || p.includes('exceeds contract qty')) {
    return { fixAt: 'sap', fix: 'The STO quantity comes from SAP; correct it there, or fix the quantity on the contract.' };
  }
  return { fixAt: 'sap', fix: 'Correct the data this refers to.' };
}

/** The STO key a shipment is grouped and submitted under (the same expression the Shipments list uses). */
export async function resolveStoKeyForShipment(shipmentId: string): Promise<string | null> {
  const r = await query(
    `SELECT ${STO_KEY_SQL} AS sto_key
       FROM shipments s
       INNER JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
      WHERE s.id = $1`,
    [shipmentId],
  );
  const key = String(r.rows[0]?.sto_key ?? '').trim();
  return key || null;
}

async function loadTracker(stoKey: string): Promise<JpsTrackerState | null> {
  const r = await query(
    `SELECT j.state, j.revision, j.jps_status, j.last_error, j.updated_at, j.rejection_reason, j.rejected_at
       FROM jps_shipping_instructions j
      WHERE j.sto_key = $1
      ORDER BY ${JPS_CURRENT_ROW_ORDER_SQL}
      LIMIT 1`,
    [stoKey],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    state: String(row.state),
    revision: Number(row.revision),
    jpsStatus: row.jps_status ? String(row.jps_status) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at).toISOString() : null,
  };
}

/** The payload KLIP sent for this revision, to compare with what it would send now. */
async function loadSentPayload(stoKey: string, revision: number): Promise<unknown> {
  const r = await query(`SELECT payload FROM jps_shipping_instructions WHERE sto_key = $1 AND revision = $2`, [stoKey, revision]);
  return r.rows[0]?.payload ?? null;
}

/** Each condition of the eligibility rule, read on its own across the STO's shipment rows (the rule needs ONE row to pass them all). */
async function loadEligibilityChecks(stoKey: string, enabledPorts: string[], listedPorts: string[]): Promise<ReadinessCheck[]> {
  const res = await query(
    `SELECT s.id, s.status, s.eta_discharge_arrival, s.port_of_discharge,
            eff.atc_loading, eff.ata_disch_arrival, eff.ata_disch_berthed, eff.ata_disch_start, eff.ata_disch_complete,
            COALESCE(
              s.discharge_master_port_id,
              (SELECT v.master_port_id FROM vessel_loading_ports v
                WHERE v.shipment_id = s.id
                  AND COALESCE(v.is_discharge_port, FALSE) IS TRUE
                  AND COALESCE(v.is_cancelled, FALSE) IS NOT TRUE
                  AND v.master_port_id IS NOT NULL
                ORDER BY v.port_sequence DESC LIMIT 1)
            ) AS discharge_port_id,
            ARRAY(SELECT klip_resolve_master_port_id(p) FROM unnest($2::text[]) AS p) AS enabled_port_ids,
            ARRAY(SELECT klip_resolve_master_port_id(p) FROM unnest($3::text[]) AS p) AS listed_port_ids
       FROM shipments s
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
       INNER JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
       CROSS JOIN LATERAL (SELECT ${EFFECTIVE_ATA_SQL}) eff
      WHERE ${STO_KEY_SQL} = $1`,
    [stoKey, enabledPorts, listedPorts],
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return [
      {
        key: 'shipment',
        label: 'Shipment found for this STO',
        ok: false,
        value: 'no shipment row with this STO / operation id',
        fix: 'Reload the page; the shipment may have been removed.',
        fixAt: 'shipment',
      },
    ];
  }

  const any = (f: (r: Record<string, unknown>) => boolean) => rows.some(f);
  const first = rows[0];
  const atcOk = any((r) => r.atc_loading != null);
  const noAtaOk = any((r) => !r.ata_disch_arrival && !r.ata_disch_berthed && !r.ata_disch_start && !r.ata_disch_complete);
  const statusOk = any((r) => !['COMPLETED', 'CANCELLED'].includes(String(r.status ?? '').toUpperCase()));
  const etaOk = any((r) => r.eta_discharge_arrival != null);
  const idIn = (id: unknown, list: unknown) => id != null && Array.isArray(list) && list.map(String).includes(String(id));
  const portOk = any((r) => idIn(r.discharge_port_id, r.enabled_port_ids));
  const portListedOff = !portOk && any((r) => idIn(r.discharge_port_id, r.listed_port_ids));
  const portResolved = any((r) => r.discharge_port_id != null);

  const checks: ReadinessCheck[] = [
    {
      key: 'discharge_port',
      label: 'Discharge port is switched on for JPS',
      ok: portOk,
      value: [...new Set(rows.map((r) => String(r.port_of_discharge ?? '(empty)')))].join(', '),
      fix: portListedOff
        ? 'The port is listed but not switched on yet: an ADMIN switches it on in Integrations > JPS > Ports.'
        : portResolved
          ? 'JPS is sent only for the ports switched on in Integrations > JPS > Ports (now: ' + (enabledPorts.join(', ') || 'none') + '). An ADMIN adds this port there; it must be synced with DHM.'
          : "The discharge port is not a Master Port: add its name as a VESSEL PORT (SAP) name in Master Port, or correct the shipment's discharge port.",
      fixAt: portResolved ? 'settings' : 'master_port',
    },
    {
      key: 'atc_loading',
      label: 'ATC Loading is filled',
      ok: atcOk,
      value: fmtDate(first.atc_loading),
      fix: 'Fill ATC Loading (section 4. ATA Vessel Information) and save.',
      fixAt: 'shipment',
    },
    {
      key: 'eta_discharge',
      label: 'ETA at Discharge Port is filled',
      ok: etaOk,
      value: fmtDate(first.eta_discharge_arrival),
      fix: 'Fill ETA at Discharge Port (section 3. Estimation) and save. JPS requires it.',
      fixAt: 'shipment',
    },
    {
      key: 'no_discharge_ata',
      label: 'The vessel has not arrived (no discharge ATA)',
      ok: noAtaOk,
      value: noAtaOk ? 'all empty' : 'a discharge ATA is already filled',
      fix: 'An STO whose vessel has arrived is no longer sent.',
      fixAt: 'shipment',
    },
    {
      key: 'status',
      label: 'Shipment is not Completed or Cancelled',
      ok: statusOk,
      value: [...new Set(rows.map((r) => String(r.status ?? '(empty)')))].join(', '),
      fixAt: 'shipment',
    },
  ];
  return checks;
}

export async function checkJpsReadiness(shipmentId: string): Promise<JpsReadiness> {
  const checks: ReadinessCheck[] = [];
  const stoKey = await resolveStoKeyForShipment(shipmentId);
  const base: JpsReadiness = { stoKey, canSubmit: false, reason: null, tracker: null, resubmit: null, checks };

  const enabled = isJpsEnabled();
  checks.push({
    key: 'integration',
    label: 'JPS integration is switched on',
    ok: enabled,
    value: enabled ? 'on' : 'off',
    fix: 'JPS_ENABLED, the base URL and the API key must all be set (Integrations > JPS).',
    fixAt: 'settings',
  });
  if (!stoKey) {
    base.reason = 'This shipment has no STO / operation id to send under.';
    return base;
  }

  const tracker = await loadTracker(stoKey);
  base.tracker = tracker;
  // An instruction JPS REJECTED (or an operator DELETED) is closed at JPS; the way forward is a new instruction under a new reference, which is what a revision is.
  // Any other status is an instruction JPS holds (accepted or still open), and JPS has no way to replace it.
  const rejected = tracker?.state === 'SUBMITTED' && isJpsClosedStatus(tracker.jpsStatus);
  if (tracker?.state === 'SUBMITTED' && !rejected) {
    base.reason = `Already at JPS (${tracker.jpsStatus ?? 'status pending'}). It cannot be sent again; JPS has no way to replace an accepted instruction.`;
    return base;
  }
  if (rejected && tracker) {
    base.resubmit = { status: tracker.jpsStatus as string, fromRevision: tracker.revision, rejectionReason: tracker.rejectionReason, rejectedAt: tracker.rejectedAt, payloadUnchanged: null };
  }
  if (tracker?.state === 'SKIPPED_PRE_EXISTING') {
    base.reason = 'Marked as already existing at JPS before KLIP went live, so KLIP does not send it.';
    return base;
  }

  // Only ports switched on are sent. With none switched on there is nothing to check the shipment against.
  const enabledPorts = jpsEnabledPortNames();
  if (enabledPorts.length === 0) {
    checks.push({
      key: 'port_enabled',
      label: 'A port is switched on for JPS',
      ok: false,
      value: 'no port is switched on',
      fix: 'An ADMIN adds a port in Integrations > JPS > Ports and switches it on.',
      fixAt: 'settings',
    });
    base.reason = 'No port is switched on for JPS.';
    return base;
  }
  checks.push(...(await loadEligibilityChecks(stoKey, enabledPorts, jpsPorts().map((p) => p.port))));

  // Master data the payload needs, asked of the payload builder itself so this list can never differ from what a real submission would hold back.
  const conditionsOk = checks.every((c) => c.ok);
  if (conditionsOk && enabled) {
    const [sto] = await findEligibleStos(enabledPorts, 1, { stoKeys: [stoKey] });
    if (!sto) {
      checks.push({
        key: 'eligible',
        label: 'KLIP rule for sending',
        ok: false,
        value: 'the conditions above pass on different shipment rows of this STO, not on one row together',
        fix: 'Check the dates on every shipment row of this STO.',
        fixAt: 'shipment',
      });
    } else {
      const catalog = await fetchJpsPortCompanies();
      const built = buildJpsSubmitPayload({ ...sto, revision: 1 }, { portCompanies: companiesForPort(catalog, sto.port_hub_code), knownPortCodes: await fetchJpsKnownPorts() });
      if (built.problems.length === 0) {
        checks.push({ key: 'master_data', label: 'Master data (port, vessel, product, company, quantities)', ok: true, value: 'complete' });
        if (base.resubmit && built.payload) {
          const sent = await loadSentPayload(stoKey, base.resubmit.fromRevision);
          base.resubmit.payloadUnchanged = sent ? samePayloadIgnoringReference(sent, built.payload) : null;
        }
      } else {
        for (const [i, problem] of built.problems.entries()) {
          const where = classifyPayloadProblem(problem);
          checks.push({ key: `master_data_${i}`, label: 'Master data', ok: false, value: problem, fix: where.fix, fixAt: where.fixAt });
        }
      }
    }
  }

  const failed = checks.filter((c) => !c.ok);
  base.canSubmit = failed.length === 0;
  base.reason = base.canSubmit ? null : `${failed.length} requirement${failed.length === 1 ? ' is' : 's are'} not met.`;
  return base;
}
