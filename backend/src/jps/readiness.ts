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
import { isJpsEnabled, jpsDischargePort, jpsRegionSite } from './config';
import { companiesForPort, fetchJpsPortCompanies } from './companies';
import { EFFECTIVE_ATA_SQL, STO_KEY_SQL, findEligibleStos } from './eligibility';
import { buildJpsSubmitPayload } from './mapper';

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
}

export interface JpsReadiness {
  stoKey: string | null;
  /** Everything KLIP can check passed and nothing at JPS blocks a (re)submission. */
  canSubmit: boolean;
  /** Why not, in a sentence, when canSubmit is false. */
  reason: string | null;
  tracker: JpsTrackerState | null;
  checks: ReadinessCheck[];
}

const fmtDate = (v: unknown): string => {
  if (!v) return '(empty)';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/** Which master page a payload problem points at, from the wording the payload builder uses. */
export function classifyPayloadProblem(problem: string): { fixAt: ReadinessFix; fix: string } {
  const p = problem.toLowerCase();
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
    `SELECT state, revision, jps_status, last_error, updated_at
       FROM jps_shipping_instructions
      WHERE sto_key = $1
      ORDER BY (state = 'SUBMITTED') DESC, revision DESC
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
  };
}

/** Each condition of the eligibility rule, read on its own across the STO's shipment rows (the rule needs ONE row to pass them all). */
async function loadEligibilityChecks(stoKey: string, regionSite: string, dischargePort: string | null): Promise<ReadinessCheck[]> {
  const res = await query(
    `SELECT s.id, s.status, s.eta_discharge_arrival, s.port_of_discharge,
            eff.atc_loading, eff.ata_disch_arrival, eff.ata_disch_berthed, eff.ata_disch_start, eff.ata_disch_complete,
            UPPER(TRIM(COALESCE(l.discharge_destination, ''))) AS region_site,
            COALESCE(
              s.discharge_master_port_id,
              (SELECT v.master_port_id FROM vessel_loading_ports v
                WHERE v.shipment_id = s.id
                  AND COALESCE(v.is_discharge_port, FALSE) IS TRUE
                  AND COALESCE(v.is_cancelled, FALSE) IS NOT TRUE
                  AND v.master_port_id IS NOT NULL
                ORDER BY v.port_sequence DESC LIMIT 1)
            ) AS discharge_port_id,
            CASE WHEN $2::text IS NULL THEN NULL ELSE klip_resolve_master_port_id($2::text) END AS wanted_port_id
       FROM shipments s
       LEFT JOIN shipment_ata_overrides sao ON sao.shipment_id = s.id
       INNER JOIN contracts c ON c.id = s.contract_id
       LEFT JOIN contract_latest_spd_snapshot l ON l.contract_number = c.contract_id
       CROSS JOIN LATERAL (SELECT ${EFFECTIVE_ATA_SQL}) eff
      WHERE ${STO_KEY_SQL} = $1`,
    [stoKey, dischargePort],
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
  const regionOk = any((r) => String(r.region_site ?? '') === regionSite);
  const atcOk = any((r) => r.atc_loading != null);
  const noAtaOk = any((r) => !r.ata_disch_arrival && !r.ata_disch_berthed && !r.ata_disch_start && !r.ata_disch_complete);
  const statusOk = any((r) => !['COMPLETED', 'CANCELLED'].includes(String(r.status ?? '').toUpperCase()));
  const etaOk = any((r) => r.eta_discharge_arrival != null);
  const portOk = dischargePort == null || any((r) => r.wanted_port_id != null && r.discharge_port_id === r.wanted_port_id);

  const checks: ReadinessCheck[] = [
    {
      key: 'region',
      label: `Region/Site is ${regionSite}`,
      ok: regionOk,
      value: [...new Set(rows.map((r) => String(r.region_site || '(empty)')))].join(', '),
      fix: `Only ${regionSite} is sent to JPS for now.`,
      fixAt: 'sap',
    },
    {
      key: 'discharge_port',
      label: dischargePort ? `Discharge port is ${dischargePort}` : 'Discharge port',
      ok: portOk,
      value: String(first.port_of_discharge ?? '(empty)'),
      fix: 'The discharge port must resolve to that Master Port: add its name as a VESSEL PORT (SAP) name in Master Port, or correct the shipment\'s discharge port.',
      fixAt: 'master_port',
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
  const base: JpsReadiness = { stoKey, canSubmit: false, reason: null, tracker: null, checks };

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
  if (tracker?.state === 'SUBMITTED') {
    base.reason = `Already at JPS (${tracker.jpsStatus ?? 'status pending'}). It cannot be sent again; JPS has no way to replace an accepted instruction.`;
    return base;
  }
  if (tracker?.state === 'SKIPPED_PRE_EXISTING') {
    base.reason = 'Marked as already existing at JPS before KLIP went live, so KLIP does not send it.';
    return base;
  }

  const regionSite = jpsRegionSite();
  const wantedPort = String(jpsDischargePort() ?? '').trim();
  const dischargePort = wantedPort === '' || wantedPort.toUpperCase() === 'ALL' ? null : wantedPort;
  checks.push(...(await loadEligibilityChecks(stoKey, regionSite, dischargePort)));

  // Master data the payload needs, asked of the payload builder itself so this list can never differ from what a real submission would hold back.
  const conditionsOk = checks.every((c) => c.ok);
  if (conditionsOk && enabled) {
    const [sto] = await findEligibleStos(regionSite, 1, { stoKeys: [stoKey], dischargePort: dischargePort ?? 'ALL' });
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
      const built = buildJpsSubmitPayload({ ...sto, revision: 1 }, { portCompanies: companiesForPort(catalog, sto.port_hub_code) });
      if (built.problems.length === 0) {
        checks.push({ key: 'master_data', label: 'Master data (port, vessel, product, company, quantities)', ok: true, value: 'complete' });
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
