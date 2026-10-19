/**
 * Register the vessels a SAP vessel name names, when KLIP's Master Vessel does not have them yet.
 *
 * Before this, a vessel code or name KLIP had never seen made resolveMasterVessel INSERT a master from the raw SAP text: a tug + barge name
 * ("TB. ARGO 10 / BG. SOLID 10") became ONE vessel, with no clean name, no pair, and nobody told. Now (Ryan, 2026-10-16):
 *
 *   - a pair name is split into its tug (TB.) and its barge (BG.), each cleaned like the Master Vessel sheet (sapVesselNameParse), the missing ones
 *     created, the pair (vessel_pairs + the SAP text) recorded, and the SAP code placed by assignPairCode;
 *   - a single vessel is created with its cleaned name, role and type taken from its prefix;
 *   - EVERYTHING is created (a stump cut at 35 characters, a name with no prefix ...), and what it is not sure of is marked review_status PENDING with
 *     the reason, for the "Perlu review" tab of Master Vessel: a person approves it, edits it, or merges it into the vessel it really is.
 *   - DHM is not asked here. The DHM cron pushes the new vessels (dhm/pushSapVessels.ts); DHM refuses a second vessel with the same name and KLIP
 *     then links the record DHM holds (pushMasterVesselToDhm).
 *
 * An existing vessel is never renamed, re-typed or re-roled here: the sheet and the Edit Vessel page own those. Only what is missing is created.
 *
 * Kill switch: VESSEL_AUTO_REGISTER=false returns to the old raw creation.
 */
import type { PoolClient } from 'pg';
import { query } from '../database/connection';
import logger from '../utils/logger';
import { buildProvisionalVesselCode, isProvisionalVesselCode } from '../utils/masterVesselCodeResolve';
import {
  assignPairCode,
  parseSapVesselName,
  vesselKey,
  type ParsedSapVesselName,
  type ParsedVesselSegment,
  type VesselRole,
} from '../utils/sapVesselNameParse';
import { isMissingVesselCode, normalizeVesselName, uppercaseText } from '../utils/vesselNameNormalize';
import { ensureAlias, type ResolvedMasterVessel } from './resolveMasterVessel.service';

export interface SapVesselIdentityInput {
  vessel_code?: string | null;
  vessel_name?: string | null;
  vessel_owner?: string | null;
}

type Run = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

interface FoundMaster {
  id: string;
  vessel_code: string;
  vessel_name: string;
  normalized_vessel_name: string;
  vessel_role: string | null;
}

export { isVesselAutoRegisterEnabled } from '../utils/vesselAutoRegister';

const MASTER_COLUMNS = 'id, vessel_code, vessel_name, normalized_vessel_name, vessel_role';

function officialCodeOf(code: unknown): string | null {
  const raw = uppercaseText(code as string | null | undefined);
  return raw && !isMissingVesselCode(raw) && !isProvisionalVesselCode(raw) ? raw : null;
}

async function findMasterByCode(run: Run, code: string): Promise<FoundMaster | null> {
  const byAlias = await run(
    `SELECT mv.id, mv.vessel_code, mv.vessel_name, mv.normalized_vessel_name, mv.vessel_role
     FROM master_vessel_code_aliases a
     INNER JOIN master_vessels mv ON mv.id = a.master_vessel_id
     WHERE upper(trim(a.vessel_code)) = upper(trim($1))
     LIMIT 1`,
    [code],
  );
  if (byAlias.rows[0]) return byAlias.rows[0] as unknown as FoundMaster;
  const byCode = await run(
    `SELECT ${MASTER_COLUMNS} FROM master_vessels WHERE upper(trim(vessel_code)) = upper(trim($1)) LIMIT 1`,
    [code],
  );
  return (byCode.rows[0] as unknown as FoundMaster) ?? null;
}

/** By normalised name, and by role: a tug and a barge may share a base name (migration 242), so a side with a role only matches its own role or a vessel with none. */
async function findMasterByName(run: Run, norm: string, role: VesselRole | null): Promise<FoundMaster | null> {
  const result = await run(
    `SELECT ${MASTER_COLUMNS}
     FROM master_vessels
     WHERE normalized_vessel_name = $1
       AND (
         $2::text IS NULL
         OR vessel_role = $2::text
         -- a vessel with no role matches too, unless its own name says it is the other kind (the normalised name drops the prefix, so
         -- a legacy BG. PACIFIC STAR 1 would otherwise be taken for the tug TB. PACIFIC STAR I)
         OR (vessel_role IS NULL AND NOT (
               ($2::text = 'TB' AND vessel_name ~* '^(BG|TKG?|MT|SPOB)[. ]')
            OR ($2::text = 'BG' AND vessel_name ~* '^(TB|MT|SPOB)[. ]')
         ))
       )
     ORDER BY (vessel_role = $2::text) DESC NULLS LAST,
              CASE WHEN code_status = 'OFFICIAL' THEN 0 ELSE 1 END,
              updated_at DESC
     LIMIT 1`,
    [norm, role],
  );
  return (result.rows[0] as unknown as FoundMaster) ?? null;
}

/** Why a person should look at a vessel this module created. Empty = nothing to review. */
function reviewReasons(parsed: ParsedSapVesselName, extra: string[]): string[] {
  return [...new Set([...parsed.flags, ...extra])];
}

async function uniqueCode(run: Run, wanted: string, role: VesselRole | null): Promise<string> {
  const taken = async (code: string) =>
    (await run(`SELECT 1 FROM master_vessels WHERE upper(trim(vessel_code)) = upper(trim($1)) LIMIT 1`, [code])).rows.length > 0;
  if (!(await taken(wanted))) return wanted;
  const suffix = role ?? 'X';
  for (let n = 0; n < 20; n += 1) {
    const candidate = `${wanted}-${suffix}${n === 0 ? '' : n + 1}`.slice(0, 50);
    if (!(await taken(candidate))) return candidate;
  }
  return `${wanted}-${Date.now().toString(36)}`.slice(0, 50);
}

interface CreateInput {
  segment: ParsedVesselSegment;
  /** The SAP code this vessel owns (official), or null for a provisional one. */
  code: string | null;
  owner: string | null;
  reasons: string[];
  sapName: string;
}

/** Create one master. Returns the row that exists afterwards (a concurrent writer may have created it first). */
async function createMaster(run: Run, input: CreateInput): Promise<{ master: FoundMaster; created: boolean }> {
  const { segment } = input;
  const norm = normalizeVesselName(segment.name);
  const official = input.code && !(await findMasterByCode(run, input.code)) ? input.code : null;
  const wantedCode = official ?? buildProvisionalVesselCode(norm);
  const vesselCode = await uniqueCode(run, wantedCode, segment.role);
  const review = input.reasons.length > 0;

  const inserted = await run(
    `INSERT INTO master_vessels (
       vessel_code, vessel_name, normalized_vessel_name, vessel_owner, vessel_type, vessel_role, code_status,
       registered_from, review_status, review_reason, review_sap_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'sap_auto', $8, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING ${MASTER_COLUMNS}`,
    [
      vesselCode,
      segment.name,
      norm,
      input.owner,
      segment.type,
      segment.role,
      official ? 'OFFICIAL' : 'PROVISIONAL',
      review ? 'PENDING' : null,
      review ? input.reasons.join(',') : null,
      input.sapName,
    ],
  );
  const row = inserted.rows[0] as unknown as FoundMaster | undefined;
  if (!row) {
    // a unique index said no (another writer created it between our look and our insert): use what is there
    const existing = (await findMasterByName(run, norm, segment.role)) ?? (official ? await findMasterByCode(run, official) : null);
    if (existing) return { master: existing, created: false };
    throw new Error(`could not create or find master vessel ${segment.name}`);
  }
  await ensureAlias(run, row.id, row.vessel_code, 'sap_import', true);
  return { master: row, created: true };
}

/** Next TBG-nnn. Serialised by the caller's advisory lock. */
async function nextPairCode(run: Run): Promise<string> {
  const res = await run(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(pair_code, '[^0-9]', '', 'g'), '')::int), 0) + 1 AS next
     FROM vessel_pairs WHERE pair_code ~ '^TBG-[0-9]+$'`,
  );
  const next = Number(res.rows[0]?.next ?? 1);
  return `TBG-${String(next).padStart(3, '0')}`;
}

async function ensurePair(run: Run, tugId: string, bargeId: string, sapName: string): Promise<void> {
  await run(`SELECT pg_advisory_xact_lock(hashtext('vessel_pair_code'))`);
  let pairId = (
    await run(`SELECT id FROM vessel_pairs WHERE tb_master_vessel_id = $1 AND bg_master_vessel_id = $2 LIMIT 1`, [tugId, bargeId])
  ).rows[0]?.id as string | undefined;
  if (!pairId) {
    const code = await nextPairCode(run);
    const inserted = await run(
      `INSERT INTO vessel_pairs (pair_code, tb_master_vessel_id, bg_master_vessel_id, source)
       VALUES ($1, $2, $3, 'sap_auto')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [code, tugId, bargeId],
    );
    pairId = inserted.rows[0]?.id as string | undefined;
    if (!pairId) {
      pairId = (
        await run(`SELECT id FROM vessel_pairs WHERE tb_master_vessel_id = $1 AND bg_master_vessel_id = $2 LIMIT 1`, [tugId, bargeId])
      ).rows[0]?.id as string | undefined;
    }
  }
  if (!pairId) return;
  await run(
    `INSERT INTO vessel_pair_sap_names (pair_id, sap_vessel_name, normalized_sap_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (pair_id, normalized_sap_name) DO NOTHING`,
    [pairId, sapName, vesselKey(sapName)],
  );
}

/**
 * A SAP pair name: make sure its tug, its barge and the pair exist, creating what is missing. Does nothing for a single vessel. Never renames an
 * existing vessel, and never moves a SAP code another vessel holds (that case is flagged on what it creates).
 */
/**
 * A SAP import repeats the same name on thousands of rows, so the common case must cost ONE indexed lookup: this exact SAP text already belongs to
 * a pair (the vessel sheet records its names the same way), and then its tug, barge and pair exist. It is asked of the database, not remembered in
 * the process: inside the import's transaction a row can still be rolled back, and a pair remembered as done would never be created.
 */
async function pairIsKnown(run: Run, rawSapName: string): Promise<boolean> {
  const known = await run(`SELECT 1 FROM vessel_pair_sap_names WHERE normalized_sap_name = $1 LIMIT 1`, [vesselKey(rawSapName)]);
  return known.rows.length > 0;
}

export async function registerPairFromSap(
  identity: SapVesselIdentityInput,
  run: Run,
  options: { skipKnownCheck?: boolean } = {},
): Promise<void> {
  const parsed = parseSapVesselName(identity.vessel_name);
  if (parsed.kind !== 'pair' || !parsed.tug || !parsed.barge) return;
  if (!options.skipKnownCheck && (await pairIsKnown(run, parsed.raw))) return;

  const code = officialCodeOf(identity.vessel_code);

  const owner = uppercaseText(identity.vessel_owner as string | null | undefined);
  const roleOk = !parsed.flags.includes('pair_roles_conflict');
  const codeOwner = roleOk && code ? assignPairCode(code, parsed.tug.name, parsed.barge.name) : null;
  const extra: string[] = [];
  if (codeOwner?.ambiguous) extra.push('code_ambiguous');

  const codeHolder = code ? await findMasterByCode(run, code) : null;
  const resolved: Array<{ segment: ParsedVesselSegment; master: FoundMaster }> = [];

  for (const segment of [parsed.tug, parsed.barge]) {
    const norm = normalizeVesselName(segment.name);
    const owns = Boolean(codeOwner && code && segment.role === codeOwner.role);
    let master = await findMasterByName(run, norm, segment.role);
    const reasons = [...extra];
    if (owns && codeHolder && master?.id !== codeHolder.id) {
      // SAP's code is held by a different vessel than the one this name says: not moved, and a person is told
      reasons.push('code_held_by_other');
    }
    if (!master) {
      const created = await createMaster(run, {
        segment,
        code: owns && !codeHolder ? code : null,
        owner,
        reasons: reviewReasons(parsed, reasons),
        sapName: parsed.raw,
      });
      master = created.master;
    } else if (owns && code && !codeHolder) {
      // an existing vessel that does not know this SAP code yet: it learns it as an alias (never as its primary code)
      await ensureAlias(run, master.id, code, 'sap_import', false);
    }
    resolved.push({ segment, master });
  }

  if (roleOk) {
    const tug = resolved.find((r) => r.segment === parsed.tug)?.master;
    const barge = resolved.find((r) => r.segment === parsed.barge)?.master;
    if (tug && barge && tug.id !== barge.id) await ensurePair(run, tug.id, barge.id, parsed.raw);
  }
}

/**
 * A single vessel no master has, at the point resolveMasterVessel used to insert the raw SAP text: create it with its cleaned name and the role
 * and type its prefix says. `primaryCode` / `codeStatus` are what the caller already worked out, so the code rules do not change.
 */
export async function registerSingleFromSap(
  identity: SapVesselIdentityInput,
  code: { primaryCode: string; codeStatus: 'OFFICIAL' | 'PROVISIONAL' },
  run: Run,
): Promise<ResolvedMasterVessel | null> {
  const parsed = parseSapVesselName(identity.vessel_name);
  if (parsed.kind === 'empty' || parsed.segments.length === 0) return null;

  if (parsed.kind === 'pair') {
    // registerPairFromSap made its vessels; the vessel of a combo name is its barge. Nothing is created here for a pair, whatever happens.
    if (!parsed.barge) return null;
    // by the pair the SAP text belongs to first (a stump a person merged into its real vessel is found this way, its own name no longer exists),
    // then by the barge's name
    const viaPair = await run(
      `SELECT bg.id, bg.vessel_code, bg.vessel_name, bg.normalized_vessel_name, bg.vessel_role
         FROM vessel_pair_sap_names n
         JOIN vessel_pairs p ON p.id = n.pair_id
         JOIN master_vessels bg ON bg.id = p.bg_master_vessel_id
        WHERE n.normalized_sap_name = $1
        LIMIT 1`,
      [vesselKey(parsed.raw)],
    );
    const barge =
      (viaPair.rows[0] as unknown as FoundMaster | undefined) ??
      (await findMasterByName(run, normalizeVesselName(parsed.barge.name), parsed.barge.role));
    return barge
      ? {
          master_vessel_id: barge.id,
          vessel_code: barge.vessel_code,
          vessel_name: barge.vessel_name,
          normalized_vessel_name: barge.normalized_vessel_name,
          created: false,
          alias_added: false,
        }
      : null;
  }

  const segment = parsed.segments[0];
  const owner = uppercaseText(identity.vessel_owner as string | null | undefined);

  const created = await createMaster(run, {
    segment,
    code: code.codeStatus === 'OFFICIAL' ? code.primaryCode : null,
    owner,
    reasons: reviewReasons(parsed, []),
    sapName: parsed.raw,
  });
  return {
    master_vessel_id: created.master.id,
    vessel_code: created.master.vessel_code,
    vessel_name: created.master.vessel_name,
    normalized_vessel_name: created.master.normalized_vessel_name,
    created: created.created,
    alias_added: false,
  };
}

/**
 * Run `work` so that a failure cannot break the caller: inside a transaction (a client) it gets its own SAVEPOINT, so a failed statement rolls back
 * to a clean point instead of leaving the whole import row "aborted" (the lesson of ensureMasterVesselFromSap); outside one it is just caught.
 * Returns null on failure, after logging.
 */
async function guarded<T>(
  client: PoolClient | undefined,
  what: string,
  context: Record<string, unknown>,
  work: (run: Run) => Promise<T>,
): Promise<T | null> {
  const run: Run = client ? (client.query.bind(client) as Run) : (query as unknown as Run);
  const savepoint = client ? `sp_register_vessel_${Math.random().toString(36).slice(2, 10)}` : null;
  try {
    if (client && savepoint) await client.query(`SAVEPOINT ${savepoint}`);
    const result = await work(run);
    if (client && savepoint) await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    if (client && savepoint) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (spError) {
        logger.error('registerVesselFromSap: could not recover the savepoint', { what, spError });
      }
    }
    logger.warn(`registerVesselFromSap: ${what} failed`, { ...context, error });
    return null;
  }
}

/** For the resolver: the pair of a SAP combo name, never failing the caller. */
export async function registerPairGuarded(identity: SapVesselIdentityInput, client?: PoolClient): Promise<void | null> {
  const parsed = parseSapVesselName(identity.vessel_name);
  if (parsed.kind !== 'pair' || !parsed.tug || !parsed.barge) return;
  const run: Run = client ? (client.query.bind(client) as Run) : (query as unknown as Run);
  // the common case, one round trip and no SAVEPOINT: an indexed read of a table that exists since migration 230
  if (await pairIsKnown(run, parsed.raw)) return;
  return guarded(client, 'pair', { vesselName: identity.vessel_name, vesselCode: identity.vessel_code }, (guardedRun) =>
    registerPairFromSap(identity, guardedRun, { skipKnownCheck: true }),
  );
}

/** For the resolver: a single vessel nobody has. Null (and a log) when it failed, and the caller falls back to the old raw creation. */
export function registerSingleGuarded(
  identity: SapVesselIdentityInput,
  code: { primaryCode: string; codeStatus: 'OFFICIAL' | 'PROVISIONAL' },
  client?: PoolClient,
): Promise<ResolvedMasterVessel | null> {
  return guarded(client, 'single vessel', { vesselName: identity.vessel_name, vesselCode: identity.vessel_code }, (run) =>
    registerSingleFromSap(identity, code, run),
  );
}
