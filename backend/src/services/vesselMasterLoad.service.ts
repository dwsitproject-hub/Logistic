import type { PoolClient } from 'pg';
import logger from '../utils/logger';
import { normalizeVesselName, uppercaseText } from '../utils/vesselNameNormalize';
import { resolveMasterVessel } from './resolveMasterVessel.service';

/**
 * Load the cleaned tug / barge vessels and their pairs into master_vessels and vessel_pairs.
 *
 * Built for a dry run first: planVesselLoad only reads. A vessel becomes one of
 *   create    - no master vessel has this normalised name yet
 *   exists    - one has, and it is compatible (same role or none, not a tug-vs-barge clash): it is reused and only its EMPTY fields are
 *               filled in, so an existing owner / capacity / type is never overwritten
 *   duplicate - the same vessel written twice in the file (TB. HADI I / TB. HADI 1: the master reads the roman numeral as the digit): the
 *               first spelling is loaded and the second is mapped to the same master row
 *   conflict  - one has, but it is the other role, or a barge where this is a tug (a tug and a barge can share a base name once the
 *               TB./BG. prefix is stripped): skipped and reported, never merged
 * and a SAP code is only attached when no OTHER vessel already holds it: resolveMasterVessel would otherwise take the vessel that owns the
 * code and rewrite it, and ensureAlias moves an alias between vessels, so a code that is taken is reported and left where it is.
 */

export type VesselRole = 'TB' | 'BG';

export interface LoadVessel {
  role: VesselRole;
  name: string;
  /** SAP codes taken from plain (non TB+BG) SAP names only; may be empty. */
  codes: string[];
  owner?: string | null;
  capacity?: number | null;
  vesselType?: string | null;
  heating?: boolean | null;
  lambung?: string | null;
  terms?: string | null;
}

export interface LoadPair {
  pairCode: string;
  tb: string | null;
  bg: string | null;
  firstContractDate?: string | null;
  lastContractDate?: string | null;
  sapRows2026?: number | null;
  note?: string | null;
  /** The combined names SAP sends for this pair. Text only - never codes. */
  sapNames: string[];
}

export interface LoadData {
  vessels: LoadVessel[];
  pairs: LoadPair[];
}

export interface ExistingMaster {
  id: string;
  vessel_code: string;
  vessel_name: string;
  normalized_vessel_name: string;
  vessel_role: string | null;
  vessel_type: string | null;
  code_status: string | null;
}

/**
 * The same vessel spelled with different spaces or leading zeros: "TOLLANDAK II" and "TOL LANDAK II", "OV - 01" and "OV-1". The master
 * does not read those as one vessel (its normalised names differ), DHM does, and a load that trusts the master alone creates a twin.
 * Letters and digits only, and zeros stripped from the front of a number.
 */
export function looseVesselKey(normalizedName: string): string {
  return String(normalizedName ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/(?<=\D|^)0+(?=\d)/g, '');
}

export type CodeOwners = Map<string, string>; // UPPER(code) -> normalised name of the vessel holding it

export interface VesselDecision {
  action: 'create' | 'exists' | 'conflict' | 'duplicate';
  existing?: ExistingMaster;
  /** duplicate only: the spelling earlier in the file that this one is the same vessel as. */
  duplicateOf?: string;
  /** Other master rows that look like the same vessel spelled differently (exists: reported, not acted on). */
  twins?: ExistingMaster[];
  codes: string[];
  skippedCodes: Array<{ code: string; heldBy: string }>;
  reasons: string[];
}

export function vesselNormName(name: string): string {
  return normalizeVesselName(uppercaseText(name) ?? '');
}

/** Letters and digits only, upper-case: the form in which a SAP name is compared. */
export function sapNameKey(name: string): string {
  return String(name ?? '').replace(/ /g, ' ').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const isTugType = (t: string | null | undefined) => /^TUG/i.test(String(t ?? '').trim());

/** Pure: what to do with one vessel, given what already exists and who holds which code. `candidates` come OFFICIAL first. */
export function decideVessel(
  vessel: LoadVessel,
  candidates: readonly ExistingMaster[],
  codeOwners: CodeOwners,
): VesselDecision {
  const norm = vesselNormName(vessel.name);
  const codes: string[] = [];
  const skippedCodes: Array<{ code: string; heldBy: string }> = [];
  for (const raw of vessel.codes) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!code || codes.includes(code)) continue;
    const owner = codeOwners.get(code);
    if (owner && owner !== norm) skippedCodes.push({ code, heldBy: owner });
    else codes.push(code);
  }

  const existing = candidates[0];
  if (!existing) return { action: 'create', codes, skippedCodes, reasons: [] };

  const reasons: string[] = [];
  if (existing.vessel_role && existing.vessel_role !== vessel.role) {
    reasons.push(`sudah ada sebagai ${existing.vessel_role} dengan nama dasar yang sama (${existing.vessel_name})`);
  }
  if (vessel.role === 'TB' && existing.vessel_type && !isTugType(existing.vessel_type)) {
    reasons.push(`sudah ada kapal bertipe ${existing.vessel_type} dengan nama dasar yang sama (${existing.vessel_name})`);
  }
  if (vessel.role === 'BG' && isTugType(existing.vessel_type)) {
    reasons.push(`sudah ada tugboat dengan nama dasar yang sama (${existing.vessel_name})`);
  }
  return reasons.length > 0
    ? { action: 'conflict', existing, codes, skippedCodes, reasons }
    : { action: 'exists', existing, codes, skippedCodes, reasons };
}

export interface VesselPlan {
  vessel: LoadVessel;
  decision: VesselDecision;
}

export async function planVesselLoad(client: Pick<PoolClient, 'query'>, data: LoadData): Promise<VesselPlan[]> {
  const norms = [...new Set(data.vessels.map((v) => vesselNormName(v.name)).filter(Boolean))];
  const codes = [...new Set(data.vessels.flatMap((v) => v.codes).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];

  const existingRows = await client.query(
    `SELECT id::text, vessel_code, vessel_name, normalized_vessel_name, vessel_role, vessel_type, code_status
       FROM master_vessels
      WHERE normalized_vessel_name = ANY($1::text[])
      ORDER BY CASE WHEN code_status = 'OFFICIAL' THEN 0 ELSE 1 END, updated_at DESC`,
    [norms],
  );
  const byNorm = new Map<string, ExistingMaster[]>();
  for (const row of existingRows.rows as ExistingMaster[]) {
    const list = byNorm.get(row.normalized_vessel_name) ?? [];
    list.push(row);
    byNorm.set(row.normalized_vessel_name, list);
  }

  const ownerRows = await client.query(
    `SELECT upper(trim(a.vessel_code)) AS code, mv.normalized_vessel_name AS norm
       FROM master_vessel_code_aliases a JOIN master_vessels mv ON mv.id = a.master_vessel_id
      WHERE upper(trim(a.vessel_code)) = ANY($1::text[])
     UNION
     SELECT upper(trim(vessel_code)), normalized_vessel_name FROM master_vessels WHERE upper(trim(vessel_code)) = ANY($1::text[])`,
    [codes],
  );
  const owners: CodeOwners = new Map();
  for (const row of ownerRows.rows as Array<{ code: string; norm: string }>) owners.set(row.code, row.norm);

  const allRows = await client.query(
    `SELECT id::text, vessel_code, vessel_name, normalized_vessel_name, vessel_role, vessel_type, code_status FROM master_vessels`,
  );
  const byLoose = new Map<string, ExistingMaster[]>();
  for (const row of allRows.rows as ExistingMaster[]) {
    const k = looseVesselKey(row.normalized_vessel_name);
    if (!k) continue;
    byLoose.set(k, [...(byLoose.get(k) ?? []), row]);
  }

  const firstInFile = new Map<string, LoadVessel>();
  const planned = data.vessels.map((vessel) => {
    const norm = vesselNormName(vessel.name);
    const earlier = firstInFile.get(norm);
    if (!earlier) {
      firstInFile.set(norm, vessel);
      return { vessel, decision: decideVessel(vessel, byNorm.get(norm) ?? [], owners) };
    }
    // the file itself holds this base name already: planned against the database alone, both would read "create" and the second would
    // silently land on the first one's row
    if (earlier.role !== vessel.role) {
      return {
        vessel,
        decision: {
          action: 'conflict' as const,
          codes: [],
          skippedCodes: [],
          reasons: [`nama dasar sama dengan ${earlier.role} ${earlier.name} di file yang sama (satu tugboat dan satu tongkang)`],
        },
      };
    }
    return { vessel, decision: { action: 'duplicate' as const, duplicateOf: earlier.name, codes: [], skippedCodes: [], reasons: [] } };
  });

  // a vessel the master does not know by this name, but does know under a spelling that differs only in spaces or leading zeros, is
  // probably the same vessel: creating it would leave two master rows for one ship (DHM, which compares more loosely, then refuses to
  // link the second). Report it instead, and let the sheet use the spelling the master already has.
  return planned.map((plan) => {
    const { vessel, decision } = plan;
    if (decision.action === 'conflict' || decision.action === 'duplicate') return plan;
    const norm = vesselNormName(vessel.name);
    const twins = (byLoose.get(looseVesselKey(norm)) ?? []).filter(
      (row) => row.normalized_vessel_name !== norm && row.id !== decision.existing?.id,
    );
    if (twins.length === 0) return plan;
    if (decision.action === 'create') {
      const list = twins.map((t) => `"${t.vessel_name}" [${t.vessel_code}${t.vessel_role ? ', ' + t.vessel_role : ''}]`).join(', ');
      return {
        vessel,
        decision: {
          ...decision,
          action: 'conflict' as const,
          reasons: [`ejaan mirip dengan kapal yang sudah ada: ${list}; kalau itu kapal yang sama, tulis ejaan itu di kolom Nama final`],
        },
      };
    }
    return { vessel, decision: { ...decision, twins } };
  });
}

/** An existing master vessel whose stored name differs from the clean one: what --rename-existing would change. */
export function plannedRenames(plans: VesselPlan[]): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const { vessel, decision } of plans) {
    const to = uppercaseText(vessel.name);
    if (decision.action === 'exists' && decision.existing && to && decision.existing.vessel_name !== to) {
      out.push({ from: decision.existing.vessel_name, to });
    }
  }
  return out;
}

export interface LoadResult {
  created: number;
  reused: number;
  duplicates: number;
  renamed: number;
  conflicts: number;
  failed: Array<{ name: string; error: string }>;
  pairsCreated: number;
  pairsUpdated: number;
  pairsSkipped: Array<{ pairCode: string; reason: string }>;
  /** master_vessels.id by "ROLE|normalised name", for the DHM push. */
  ids: Map<string, string>;
}

const FILL_GAPS_SQL = `
  UPDATE master_vessels SET
    vessel_role = COALESCE(vessel_role, $2),
    vessel_owner = COALESCE(NULLIF(trim(vessel_owner), ''), $3),
    vessel_capacity_mt = COALESCE(vessel_capacity_mt, $4),
    vessel_type = COALESCE(NULLIF(trim(vessel_type), ''), $5),
    heating = COALESCE(heating, $6),
    lambung_type = COALESCE(NULLIF(trim(lambung_type), ''), $7),
    terms = COALESCE(NULLIF(trim(terms), ''), $8),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = $1`;

/** Writes inside the caller's transaction. Each vessel and each pair gets its own SAVEPOINT, so one bad row is reported, not fatal. */
export async function applyVesselLoad(
  client: PoolClient,
  data: LoadData,
  plans: VesselPlan[],
  options: { renameExisting?: boolean } = {},
): Promise<LoadResult> {
  const result: LoadResult = { created: 0, reused: 0, duplicates: 0, renamed: 0, conflicts: 0, failed: [], pairsCreated: 0, pairsUpdated: 0, pairsSkipped: [], ids: new Map() };
  const idKey = (role: string, name: string) => `${role}|${vesselNormName(name)}`;

  for (const { vessel, decision } of plans) {
    if (decision.action === 'conflict') {
      result.conflicts += 1;
      continue;
    }
    if (decision.action === 'duplicate') {
      const firstId = result.ids.get(idKey(vessel.role, decision.duplicateOf!));
      if (firstId) {
        result.ids.set(idKey(vessel.role, vessel.name), firstId);
        result.duplicates += 1;
      } else {
        result.failed.push({ name: vessel.name, error: `${decision.duplicateOf} (the same vessel earlier in the file) was not loaded` });
      }
      continue;
    }
    const sp = `sp_vload_${Math.random().toString(36).slice(2, 10)}`;
    try {
      await client.query(`SAVEPOINT ${sp}`);
      const attrs = {
        vessel_owner: vessel.owner ?? null,
        vessel_capacity_mt: vessel.capacity ?? null,
        vessel_type: vessel.vesselType ?? null,
        heating: vessel.heating ?? null,
        lambung_type: vessel.lambung ?? null,
        terms: vessel.terms ?? null,
      };
      let id: string;
      let codesLeft = decision.codes;
      if (decision.action === 'create') {
        const first = decision.codes[0] ?? null;
        const created = await resolveMasterVessel(
          { vessel_code: first, vessel_name: vessel.name, ...attrs, source: first ? 'sap_import' : 'manual', updateAttributes: true },
          client,
        );
        if (!created) throw new Error('resolveMasterVessel returned nothing');
        id = created.master_vessel_id;
        codesLeft = decision.codes.slice(1);
        result.created += 1;
      } else {
        id = decision.existing!.id;
        result.reused += 1;
      }
      // every other code: resolveMasterVessel finds the vessel by name and records the code as an alias (or promotes a provisional vessel)
      for (const code of codesLeft) {
        await resolveMasterVessel(
          { vessel_code: code, vessel_name: vessel.name, source: 'sap_import', updateAttributes: false },
          client,
        );
      }
      await client.query(FILL_GAPS_SQL, [
        id, vessel.role, attrs.vessel_owner, attrs.vessel_capacity_mt, attrs.vessel_type, attrs.heating, attrs.lambung_type, attrs.terms,
      ]);
      if (options.renameExisting && decision.action === 'exists') {
        // the master keeps matching by the normalised name (unchanged by construction); only the displayed name becomes the clean one
        const renamed = await client.query(
          `UPDATE master_vessels SET vessel_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND vessel_name IS DISTINCT FROM $2`,
          [id, uppercaseText(vessel.name)],
        );
        result.renamed += renamed.rowCount ?? 0;
      }
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      result.ids.set(idKey(vessel.role, vessel.name), id);
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => undefined);
      result.failed.push({ name: vessel.name, error: error instanceof Error ? error.message : String(error) });
      logger.warn('vessel master load: a vessel failed', { name: vessel.name, error });
    }
  }

  for (const pair of data.pairs) {
    const tbId = pair.tb ? result.ids.get(idKey('TB', pair.tb)) : undefined;
    const bgId = pair.bg ? result.ids.get(idKey('BG', pair.bg)) : undefined;
    if (!tbId || !bgId) {
      result.pairsSkipped.push({
        pairCode: pair.pairCode,
        reason: !pair.tb || !pair.bg ? 'nama TB atau BG kosong' : `${!tbId ? 'TB' : 'BG'} belum ada di master (ditahan, konflik, atau gagal)`,
      });
      continue;
    }
    const sp = `sp_pair_${Math.random().toString(36).slice(2, 10)}`;
    try {
      await client.query(`SAVEPOINT ${sp}`);
      const clash = await client.query(
        `SELECT pair_code FROM vessel_pairs WHERE tb_master_vessel_id = $1 AND bg_master_vessel_id = $2 AND pair_code <> $3 LIMIT 1`,
        [tbId, bgId, pair.pairCode],
      );
      if (clash.rows.length > 0) {
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        result.pairsSkipped.push({ pairCode: pair.pairCode, reason: `pasangan TB-BG yang sama sudah ada sebagai ${clash.rows[0].pair_code}` });
        continue;
      }
      const up = await client.query(
        `INSERT INTO vessel_pairs (pair_code, tb_master_vessel_id, bg_master_vessel_id, first_contract_date, last_contract_date, sap_rows_2026, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (pair_code) DO UPDATE SET
           tb_master_vessel_id = EXCLUDED.tb_master_vessel_id, bg_master_vessel_id = EXCLUDED.bg_master_vessel_id,
           first_contract_date = EXCLUDED.first_contract_date, last_contract_date = EXCLUDED.last_contract_date,
           sap_rows_2026 = EXCLUDED.sap_rows_2026, note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP
         RETURNING id::text, (xmax = 0) AS inserted`,
        [pair.pairCode, tbId, bgId, pair.firstContractDate ?? null, pair.lastContractDate ?? null, pair.sapRows2026 ?? null, pair.note ?? null],
      );
      const pairId = up.rows[0].id as string;
      for (const name of pair.sapNames) {
        const key = sapNameKey(name);
        if (!key) continue;
        await client.query(
          `INSERT INTO vessel_pair_sap_names (pair_id, sap_vessel_name, normalized_sap_name) VALUES ($1, $2, $3)
           ON CONFLICT (pair_id, normalized_sap_name) DO NOTHING`,
          [pairId, name.trim(), key],
        );
      }
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      if (up.rows[0].inserted) result.pairsCreated += 1;
      else result.pairsUpdated += 1;
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => undefined);
      result.pairsSkipped.push({ pairCode: pair.pairCode, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export interface DhmPushSummary {
  attempted: number;
  ok: number;
  conflicts: Array<{ name: string; dhmCode: string | null }>;
  errors: Array<{ name: string; error: string }>;
  dhmDisabled: boolean;
}

/**
 * Push the loaded vessels (tugs included) to DHM one by one, AFTER the load has committed, so DHM never sees a vessel KLIP rolled back.
 * Sequential with a small pause: DHM is a shared hub. A tug carries the Hub's own tug value in Vessel_Type when the Hub has one and
 * no type otherwise (see dhm/mapper pickDhmVesselType). A name DHM already holds comes back as a conflict, not an error.
 */
export async function pushLoadedVesselsToDhm(
  ids: Iterable<string>,
  options: { delayMs?: number } = {},
): Promise<DhmPushSummary> {
  const { query } = await import('../database/connection');
  const { isDhmEnabled } = await import('../dhm/config');
  const { pushMasterVesselToDhm } = await import('../dhm/pushVessel');
  const summary: DhmPushSummary = { attempted: 0, ok: 0, conflicts: [], errors: [], dhmDisabled: !isDhmEnabled() };
  if (summary.dhmDisabled) return summary;

  for (const id of new Set(ids)) {
    const res = await query(`SELECT * FROM master_vessels WHERE id = $1`, [id]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) continue;
    summary.attempted += 1;
    const name = String(row.vessel_name ?? id);
    try {
      const out = await pushMasterVesselToDhm(
        id,
        {
          vessel_code: row.vessel_code != null ? String(row.vessel_code) : null,
          vessel_name: name,
          vessel_capacity_mt: row.vessel_capacity_mt != null ? Number(row.vessel_capacity_mt) : null,
          heating: typeof row.heating === 'boolean' ? row.heating : null,
          vessel_type: row.vessel_type != null ? String(row.vessel_type) : null,
          lambung_type: row.lambung_type != null ? String(row.lambung_type) : null,
          terms: row.terms != null ? String(row.terms) : null,
          dhm_code: row.dhm_code != null ? String(row.dhm_code) : null,
        },
        {},
      );
      if (out.dhmConflict) summary.conflicts.push({ name, dhmCode: out.dhmCode ?? null });
      else if (out.dhmError) summary.errors.push({ name, error: out.dhmError });
      else summary.ok += 1;
    } catch (error) {
      summary.errors.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  }
  return summary;
}
