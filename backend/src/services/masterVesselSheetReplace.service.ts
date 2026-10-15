import type { PoolClient } from 'pg';
import { normalizeVesselName, uppercaseText } from '../utils/vesselNameNormalize';
import { buildProvisionalVesselCode } from '../utils/masterVesselCodeResolve';
import { looseVesselKey } from './vesselMasterLoad.service';

/**
 * Replace KLIP's Master Vessel with the vessel sheet "Vessel - Klip (Final Validation)" of "Master Data - CPO 28 Sep 2026" (Ryan, 2026-10-15):
 * the sheet is the source, the way the Master Port cleanup made the Port sheet the source.
 *
 * Unlike vesselMasterLoad.service.ts (which only filled EMPTY fields of the tug/barge load), every sheet row ends up as exactly one master
 * vessel with the sheet's name and attributes, its Vessel Code SAP list attached, and its pair; a master vessel the sheet does not have is
 * archived (master_vessels_archive, migration 240) and removed, unless something still needs it.
 *
 * Per sheet row, the master it becomes, in this order:
 *   name      the same name (upper-case, single spaces)
 *   norm      the same normalised name, and not a tug where the sheet has a barge or the reverse
 *   twin      the same letters and digits (looseVesselKey: "TOLLANDAK II" / "TOL LANDAK II"), one candidate only
 *   code      the master that holds one of the row's SAP codes
 *   create    none of the above
 * A master two sheet rows would become is given to the first; the second is a conflict. Two sheet rows with the same normalised name (a tug
 * and a barge such as TB. PACIFIC STAR I / BG. PACIFIC STAR 1) cannot both be OFFICIAL (uq_master_vessels_normalized_name_official): the
 * second is reported, not guessed.
 *
 * A sheet value replaces the stored one; an EMPTY sheet cell leaves the stored value alone unless `blankClears` (the sheet's owner, company
 * code and capacity are blank on a third of the rows). DHM columns are never touched: the DHM cutover is a separate step.
 *
 * A SAP code moves to the sheet vessel that lists it. A code two sheet rows list is attached to neither and reported.
 *
 * A master the sheet does not have:
 *   kept      klip_origin (a vessel a KLIP user added; see masterVesselProtection.service.ts), or used by shipments that no sheet vessel takes over
 *   repoint   used by shipments, and a sheet vessel takes over one of its SAP codes: the shipments move to that vessel, then it is archived
 *   archive   used by nothing: archived and removed
 * Pairs: one per Pair ID that has exactly one tug and one barge; a pair the sheet no longer has is removed.
 */

export type SheetRole = 'TB' | 'BG' | null;

export interface SheetVessel {
  row: number;
  pairId: string | null;
  name: string;
  companyCode: string | null;
  owner: string | null;
  capacity: number | null;
  vesselType: string | null;
  heating: boolean | null;
  lambung: string | null;
  charter: string | null;
  draft: number | null;
  loa: string | null;
  hullType: string | null;
  registrationYear: number | null;
  codes: string[];
}

const text = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s : null;
};

/** "21,34" and "21.34" -> 21.34; "", "-" and words -> null. */
export function sheetNumber(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const TERMS = new Set(['T/C', 'V/C', 'CIF']);

/** One row of the sheet, keyed by column letter (A..P, C ignored), as the build script writes it. */
export function parseSheetVessel(raw: Record<string, unknown> & { row: number }): SheetVessel | null {
  const name = uppercaseText(text(raw.B));
  if (!name) return null;
  const heatingText = String(raw.I ?? '').trim().toUpperCase();
  const charter = String(raw.K ?? '').trim().toUpperCase();
  const year = sheetNumber(raw.O);
  const loa = sheetNumber(raw.M);
  const codes = String(raw.P ?? '')
    .split(/[,;\n]/)
    .map((c) => c.trim().toUpperCase())
    .filter((c, i, all) => c !== '' && all.indexOf(c) === i);
  return {
    row: raw.row,
    pairId: uppercaseText(text(raw.A)),
    name,
    companyCode: uppercaseText(text(raw.E)),
    owner: uppercaseText(text(raw.F)),
    capacity: sheetNumber(raw.G),
    vesselType: uppercaseText(text(raw.H)),
    heating: heatingText === 'YES' ? true : heatingText === 'NO' ? false : null,
    lambung: uppercaseText(text(raw.J)),
    charter: TERMS.has(charter) ? charter : null,
    draft: sheetNumber(raw.L),
    loa: loa != null ? String(loa) : null,
    hullType: uppercaseText(text(raw.N)),
    registrationYear: year != null && Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    codes,
  };
}

/** TUG BOAT (or a TB. name) is a tug, BARGE (or a BG. name) a barge; tankers, SPOB and the rest have no role. */
export function sheetRole(v: Pick<SheetVessel, 'vesselType' | 'name'>): SheetRole {
  const type = String(v.vesselType ?? '').toUpperCase();
  if (/^TUG/.test(type)) return 'TB';
  if (type === 'BARGE') return 'BG';
  if (!type) {
    if (/^TB\b/.test(v.name)) return 'TB';
    if (/^BG\b/.test(v.name)) return 'BG';
  }
  return null;
}

export interface MasterSnapshot {
  id: string;
  vessel_code: string;
  vessel_name: string;
  normalized_vessel_name: string;
  vessel_role: string | null;
  vessel_type: string | null;
  code_status: string | null;
  klip_origin: boolean;
  dhm_id: string | null;
  shipments: number;
}

export type RowAction = 'update' | 'create' | 'conflict';

export interface RowPlan {
  sheet: SheetVessel;
  role: SheetRole;
  action: RowAction;
  matchedBy?: 'name' | 'norm' | 'twin' | 'code';
  master?: MasterSnapshot;
  /** Codes to attach to this vessel (moved from another master when one holds them). */
  codes: Array<{ code: string; from: MasterSnapshot | null }>;
  /** Codes of this row another sheet row lists too: attached to neither. */
  sharedCodes: string[];
  reasons: string[];
}

export interface RetirePlan {
  master: MasterSnapshot;
  action: 'archive' | 'repoint' | 'keep';
  /** repoint: the sheet row whose vessel takes the shipments. */
  target?: SheetVessel;
  reason: string;
}

export interface PairPlan {
  pairCode: string;
  tb: SheetVessel | null;
  bg: SheetVessel | null;
  ok: boolean;
  reason?: string;
}

export interface ReplacePlan {
  rows: RowPlan[];
  retire: RetirePlan[];
  pairs: PairPlan[];
  skippedSheetRows: number[];
  /** Codes more than one sheet row lists: nobody gets them, not even through a merged twin. */
  sharedCodes: string[];
}

const isTugType = (t: string | null | undefined) => /^TUG/i.test(String(t ?? '').trim());

function roleClash(role: SheetRole, m: MasterSnapshot): boolean {
  if (!role) return false;
  if (m.vessel_role && m.vessel_role !== role) return true;
  if (role === 'TB' && m.vessel_type && !isTugType(m.vessel_type) && m.vessel_role !== 'TB') return true;
  if (role === 'BG' && isTugType(m.vessel_type)) return true;
  return false;
}

/** Pure: the whole replacement, from the sheet, the master vessels and who holds which SAP code (UPPER code -> master id). */
export function planSheetReplace(
  sheetRows: ReadonlyArray<SheetVessel>,
  masters: ReadonlyArray<MasterSnapshot>,
  codeHolder: ReadonlyMap<string, string>,
): ReplacePlan {
  const byId = new Map(masters.map((m) => [m.id, m]));
  const byName = new Map<string, MasterSnapshot[]>();
  const byNorm = new Map<string, MasterSnapshot[]>();
  const byLoose = new Map<string, MasterSnapshot[]>();
  const push = (map: Map<string, MasterSnapshot[]>, k: string, m: MasterSnapshot) => {
    if (k) map.set(k, [...(map.get(k) ?? []), m]);
  };
  for (const m of masters) {
    push(byName, uppercaseText(m.vessel_name) ?? '', m);
    push(byNorm, m.normalized_vessel_name, m);
    push(byLoose, looseVesselKey(m.normalized_vessel_name), m);
  }

  // a code two sheet rows list is nobody's
  const codeRows = new Map<string, number>();
  for (const s of sheetRows) for (const c of s.codes) codeRows.set(c, (codeRows.get(c) ?? 0) + 1);

  const claimed = new Map<string, SheetVessel>(); // master id -> sheet row that became it
  const normInSheet = new Map<string, SheetVessel>();
  const rows: RowPlan[] = [];

  for (const sheet of sheetRows) {
    const role = sheetRole(sheet);
    const norm = normalizeVesselName(sheet.name);
    const sharedCodes = sheet.codes.filter((c) => (codeRows.get(c) ?? 0) > 1);
    const ownCodes = sheet.codes.filter((c) => (codeRows.get(c) ?? 0) === 1);
    const reasons: string[] = [];

    const earlier = normInSheet.get(norm);
    if (earlier) {
      rows.push({
        sheet, role, action: 'conflict', codes: [], sharedCodes, reasons: [
          `nama ternormalisasi sama dengan baris ${earlier.row} (${earlier.name}); dua vessel OFFICIAL tidak boleh punya nama ternormalisasi yang sama`,
        ],
      });
      continue;
    }
    normInSheet.set(norm, sheet);

    const free = (list: MasterSnapshot[] | undefined) => (list ?? []).filter((m) => !claimed.has(m.id) && !roleClash(role, m));
    let master: MasterSnapshot | undefined;
    let matchedBy: RowPlan['matchedBy'];
    const exact = free(byName.get(sheet.name));
    if (exact.length > 0) {
      master = exact[0];
      matchedBy = 'name';
    } else {
      const normHits = free(byNorm.get(norm)).sort((a, b) => Number(b.code_status === 'OFFICIAL') - Number(a.code_status === 'OFFICIAL'));
      if (normHits.length > 0) {
        master = normHits[0];
        matchedBy = 'norm';
      } else {
        const twins = free(byLoose.get(looseVesselKey(norm)));
        if (twins.length === 1) {
          master = twins[0];
          matchedBy = 'twin';
        } else if (twins.length > 1) {
          reasons.push(`ejaan mirip dengan beberapa vessel: ${twins.map((t) => t.vessel_name).join(', ')}`);
        } else {
          const holders = [...new Set(ownCodes.map((c) => codeHolder.get(c)).filter((id): id is string => Boolean(id)))]
            .map((id) => byId.get(id))
            .filter((m): m is MasterSnapshot => Boolean(m) && !claimed.has(m!.id) && !roleClash(role, m!));
          if (holders.length === 1) {
            master = holders[0];
            matchedBy = 'code';
          } else if (holders.length > 1) {
            reasons.push(`kode SAP-nya dipegang beberapa vessel: ${holders.map((h) => h.vessel_name).join(', ')}`);
          }
        }
      }
    }
    if (reasons.length > 0) {
      rows.push({ sheet, role, action: 'conflict', codes: [], sharedCodes, reasons });
      continue;
    }
    if (master) claimed.set(master.id, sheet);
    rows.push({
      sheet,
      role,
      action: master ? 'update' : 'create',
      matchedBy,
      master,
      codes: ownCodes.map((code) => {
        const holderId = codeHolder.get(code);
        const holder = holderId && holderId !== master?.id ? byId.get(holderId) ?? null : null;
        return { code, from: holder };
      }),
      sharedCodes,
      reasons,
    });
  }

  // masters the sheet does not have
  const takenOverBy = new Map<string, SheetVessel>(); // master id -> sheet vessel taking one of its codes
  for (const r of rows) for (const c of r.codes) if (c.from && !takenOverBy.has(c.from.id)) takenOverBy.set(c.from.id, r.sheet);
  // the same letters and digits as exactly one loaded sheet vessel ("BG. JAYA SEJAHTERA I" / "BG. JAYASEJAHTERA I"): the same ship
  const loadedByLoose = new Map<string, RowPlan[]>();
  for (const r of rows) {
    if (r.action === 'conflict') continue;
    const k = looseVesselKey(normalizeVesselName(r.sheet.name));
    if (k) loadedByLoose.set(k, [...(loadedByLoose.get(k) ?? []), r]);
  }
  const twinOf = (m: MasterSnapshot): SheetVessel | undefined => {
    const hits = (loadedByLoose.get(looseVesselKey(m.normalized_vessel_name)) ?? []).filter((r) => !roleClash(r.role, m));
    return hits.length === 1 ? hits[0].sheet : undefined;
  };
  const retire: RetirePlan[] = [];
  for (const m of masters) {
    if (claimed.has(m.id)) continue;
    const twin = twinOf(m);
    if (m.klip_origin) {
      retire.push({ master: m, action: 'keep', reason: 'dibuat lewat Add New Vessel di KLIP (klip_origin)' });
    } else if (m.shipments > 0 && takenOverBy.has(m.id)) {
      retire.push({ master: m, action: 'repoint', target: takenOverBy.get(m.id), reason: `${m.shipments} shipment pindah ke vessel sheet yang mengambil kode SAP-nya` });
    } else if (twin) {
      retire.push({
        master: m, action: 'repoint', target: twin,
        reason: `ejaan lain dari ${twin.name} (huruf dan angka sama): ${m.shipments} shipment dan kode SAP-nya pindah ke sana`,
      });
    } else if (m.shipments > 0) {
      retire.push({ master: m, action: 'keep', reason: `dipakai ${m.shipments} shipment dan tidak ada vessel sheet yang menggantikannya` });
    } else {
      retire.push({ master: m, action: 'archive', reason: 'tidak ada di sheet dan tidak dipakai' });
    }
  }

  // pairs
  const groups = new Map<string, SheetVessel[]>();
  for (const s of sheetRows) if (s.pairId) groups.set(s.pairId, [...(groups.get(s.pairId) ?? []), s]);
  const conflictRows = new Set(rows.filter((r) => r.action === 'conflict').map((r) => r.sheet.row));
  const pairs: PairPlan[] = [...groups.entries()].map(([pairCode, members]) => {
    const tbs = members.filter((m) => sheetRole(m) === 'TB');
    const bgs = members.filter((m) => sheetRole(m) !== 'TB');
    if (tbs.length === 1 && bgs.length === 1) {
      // a member the sheet itself holds back (a conflict, reported above) cannot be paired yet: incomplete, not a failure of the run
      const held = [tbs[0], bgs[0]].find((m) => conflictRows.has(m.row));
      if (held) return { pairCode, tb: tbs[0], bg: bgs[0], ok: false, reason: `${held.name} (baris ${held.row}) konflik, belum dimuat` };
      return { pairCode, tb: tbs[0], bg: bgs[0], ok: true };
    }
    return {
      pairCode, tb: tbs[0] ?? null, bg: bgs[0] ?? null, ok: false,
      reason: `Pair ID dipakai ${members.length} baris (${tbs.length} tugboat, ${bgs.length} lainnya); butuh tepat satu TB dan satu BG`,
    };
  });

  const sharedCodes = [...codeRows.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  return { rows, retire, pairs, skippedSheetRows: [], sharedCodes };
}

export async function loadMasterSnapshot(client: Pick<PoolClient, 'query'>): Promise<{ masters: MasterSnapshot[]; codeHolder: Map<string, string> }> {
  const m = await client.query(
    `SELECT mv.id::text, mv.vessel_code, mv.vessel_name, mv.normalized_vessel_name, mv.vessel_role, mv.vessel_type, mv.code_status,
            COALESCE(mv.klip_origin, false) AS klip_origin, mv.dhm_id::text,
            (SELECT count(*)::int FROM shipments s WHERE s.master_vessel_id = mv.id) AS shipments
       FROM master_vessels mv
      ORDER BY mv.created_at, mv.id`,
  );
  const a = await client.query(
    `SELECT upper(trim(vessel_code)) AS code, master_vessel_id::text AS id FROM master_vessel_code_aliases
     UNION ALL
     SELECT upper(trim(vessel_code)), id::text FROM master_vessels WHERE upper(trim(vessel_code)) NOT LIKE 'TMP-%'`,
  );
  const codeHolder = new Map<string, string>();
  for (const r of a.rows as Array<{ code: string; id: string }>) if (!codeHolder.has(r.code)) codeHolder.set(r.code, r.id);
  return { masters: m.rows as MasterSnapshot[], codeHolder };
}

export interface ApplyResult {
  updated: number;
  created: number;
  codesAttached: number;
  codesMoved: number;
  repointedShipments: number;
  archived: number;
  kept: number;
  pairsUpserted: number;
  pairsRemoved: number;
  failed: Array<{ what: string; error: string }>;
}

const ATTRS_SQL = (blankClears: boolean) => {
  const set = (col: string, p: string) => (blankClears ? `${col} = ${p}` : `${col} = COALESCE(${p}, ${col})`);
  return [
    set('vessel_role', '$2::varchar'),
    set('sap_vendor_code', '$3::varchar'),
    set('vessel_owner', '$4::varchar'),
    set('vessel_capacity_mt', '$5::numeric'),
    set('vessel_type', '$6::varchar'),
    set('heating', '$7::boolean'),
    set('lambung_type', '$8::varchar'),
    set('terms', '$9::varchar'),
    set('vessel_draft', '$10::numeric'),
    set('vessel_length_overall', '$11::varchar'),
    set('vessel_hull_type', '$12::varchar'),
    set('vessel_registration_year', '$13::int'),
  ].join(',\n      ');
};

const attrParams = (r: RowPlan) => [
  r.role, r.sheet.companyCode, r.sheet.owner, r.sheet.capacity, r.sheet.vesselType, r.sheet.heating, r.sheet.lambung, r.sheet.charter,
  r.sheet.draft, r.sheet.loa, r.sheet.hullType, r.sheet.registrationYear,
];

async function savepoint<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  const sp = `sp_vsr_${Math.random().toString(36).slice(2, 10)}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const out = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return out;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => undefined);
    throw error;
  }
}

/** Writes the plan inside the CALLER's transaction (the script commits it, or rolls it back for a dry run). One bad row is reported, not fatal. */
export async function applySheetReplace(client: PoolClient, plan: ReplacePlan, options: { blankClears?: boolean } = {}): Promise<ApplyResult> {
  const res: ApplyResult = {
    updated: 0, created: 0, codesAttached: 0, codesMoved: 0, repointedShipments: 0, archived: 0, kept: 0, pairsUpserted: 0, pairsRemoved: 0, failed: [],
  };
  const attrs = ATTRS_SQL(options.blankClears === true);
  const idBySheetRow = new Map<number, string>();
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const retireOne = async (t: RetirePlan) => {
    try {
      await savepoint(client, async () => {
        if (t.action === 'repoint') {
          const target = t.target ? idBySheetRow.get(t.target.row) : undefined;
          if (!target) throw new Error('vessel tujuan belum termuat');
          const moved = await client.query(`UPDATE shipments SET master_vessel_id = $2 WHERE master_vessel_id = $1`, [t.master.id, target]);
          res.repointedShipments += moved.rowCount ?? 0;
          // its remaining SAP codes go along, so a SAP row with one still finds the vessel; a code several sheet rows list stays nobody's
          const codes = await client.query(
            `UPDATE master_vessel_code_aliases SET master_vessel_id = $2, is_primary = false, updated_at = CURRENT_TIMESTAMP
              WHERE master_vessel_id = $1 AND NOT (upper(trim(vessel_code)) = ANY($3::text[]))`,
            [t.master.id, target, plan.sharedCodes],
          );
          res.codesMoved += codes.rowCount ?? 0;
          // its own primary code, when no alias row carries it yet and it is no placeholder
          const own = await client.query(
            `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, namespace, is_primary)
             SELECT $2, upper(trim(mv.vessel_code)), 'vessel_sheet', 'SAP', false FROM master_vessels mv
              WHERE mv.id = $1 AND upper(mv.vessel_code) NOT LIKE 'TMP-%' AND NOT (upper(trim(mv.vessel_code)) = ANY($3::text[]))
             ON CONFLICT (vessel_code) DO NOTHING`,
            [t.master.id, target, plan.sharedCodes],
          );
          res.codesMoved += own.rowCount ?? 0;
        }
        await client.query(
          `INSERT INTO master_vessels_archive (id, vessel_name, reason, vessel_row, code_aliases, pairs)
           SELECT mv.id, mv.vessel_name, $2, to_jsonb(mv),
                  COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM master_vessel_code_aliases a WHERE a.master_vessel_id = mv.id), '[]'::jsonb),
                  COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM vessel_pairs p WHERE p.tb_master_vessel_id = mv.id OR p.bg_master_vessel_id = mv.id), '[]'::jsonb)
             FROM master_vessels mv WHERE mv.id = $1
           ON CONFLICT (id) DO UPDATE SET reason = EXCLUDED.reason, vessel_row = EXCLUDED.vessel_row, code_aliases = EXCLUDED.code_aliases,
             pairs = EXCLUDED.pairs, archived_at = CURRENT_TIMESTAMP`,
          [t.master.id, `vessel sheet replace: ${t.reason}`],
        );
        await client.query(`DELETE FROM master_vessels WHERE id = $1`, [t.master.id]);
        res.archived += 1;
      });
    } catch (error) {
      res.failed.push({ what: `pensiun ${t.master.vessel_name}`, error: msg(error) });
    }
  };

  // 1. the unused ones go first, so a sheet vessel renamed to their spelling does not trip the unique OFFICIAL name
  for (const t of plan.retire) if (t.action === 'archive') await retireOne(t);

  // 2. the sheet's vessels
  for (const r of plan.rows) {
    if (r.action === 'conflict') continue;
    try {
      await savepoint(client, async () => {
        let id: string;
        if (r.action === 'update') {
          id = r.master!.id;
          await client.query(
            `UPDATE master_vessels SET
              vessel_name = $14, normalized_vessel_name = $15,
              ${attrs},
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [id, ...attrParams(r), r.sheet.name, normalizeVesselName(r.sheet.name)],
          );
          res.updated += 1;
        } else {
          const norm = normalizeVesselName(r.sheet.name);
          // the first SAP code nobody holds becomes the primary code (OFFICIAL); without one, a unique TMP- placeholder (PROVISIONAL)
          const freeCode = r.codes.find((c) => !c.from)?.code ?? null;
          let code = freeCode;
          if (!code) {
            const base = buildProvisionalVesselCode(norm);
            code = base;
            for (let i = 2; (await client.query(`SELECT 1 FROM master_vessels WHERE vessel_code = $1`, [code])).rows.length > 0; i++) {
              code = `${base.slice(0, 46)}-${i}`;
            }
          }
          const ins = await client.query(
            `INSERT INTO master_vessels (vessel_code, vessel_name, normalized_vessel_name, code_status)
             VALUES ($1, $2, $3, $4) RETURNING id::text`,
            [code, r.sheet.name, norm, freeCode ? 'OFFICIAL' : 'PROVISIONAL'],
          );
          id = ins.rows[0].id;
          await client.query(`UPDATE master_vessels SET ${attrs} WHERE id = $1`, [id, ...attrParams(r)]);
          res.created += 1;
        }
        for (const { code, from } of r.codes) {
          await client.query(
            `INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source, namespace, is_primary)
             VALUES ($1, $2, 'vessel_sheet', 'SAP', false)
             ON CONFLICT (vessel_code) DO UPDATE SET master_vessel_id = EXCLUDED.master_vessel_id, is_primary = false,
               source = 'vessel_sheet', updated_at = CURRENT_TIMESTAMP`,
            [id, code],
          );
          res.codesAttached += 1;
          if (from) res.codesMoved += 1;
        }
        // a vessel with only a TMP- placeholder takes the first of its sheet codes that no other master uses as its own code
        const promote = await client.query(
          `UPDATE master_vessels mv SET vessel_code = c.code, code_status = 'OFFICIAL', updated_at = CURRENT_TIMESTAMP
             FROM (SELECT unnest($2::text[]) AS code) c
            WHERE mv.id = $1 AND upper(mv.vessel_code) LIKE 'TMP-%'
              AND NOT EXISTS (SELECT 1 FROM master_vessels o WHERE o.vessel_code = c.code AND o.id <> mv.id)
              AND NOT EXISTS (SELECT 1 FROM master_vessels o WHERE o.code_status = 'OFFICIAL' AND o.normalized_vessel_name = mv.normalized_vessel_name AND o.id <> mv.id)
            RETURNING mv.id`,
          [id, r.codes.map((c) => c.code)],
        );
        void promote;
        idBySheetRow.set(r.sheet.row, id);
      });
    } catch (error) {
      res.failed.push({ what: `baris ${r.sheet.row} ${r.sheet.name}`, error: msg(error) });
    }
  }

  // 3. the used ones whose shipments a sheet vessel takes over, now that it exists
  for (const t of plan.retire) {
    if (t.action === 'keep') res.kept += 1;
    else if (t.action === 'repoint') await retireOne(t);
  }

  // 4. pairs
  const keepCodes: string[] = [];
  for (const p of plan.pairs) {
    if (!p.ok || !p.tb || !p.bg) continue;
    const tb = idBySheetRow.get(p.tb.row);
    const bg = idBySheetRow.get(p.bg.row);
    if (!tb || !bg) {
      res.failed.push({ what: `pair ${p.pairCode}`, error: 'TB atau BG-nya tidak termuat' });
      continue;
    }
    try {
      await savepoint(client, async () => {
        // the same TB+BG under another code would trip uq_vessel_pairs_tb_bg: the sheet's code wins
        await client.query(`DELETE FROM vessel_pairs WHERE tb_master_vessel_id = $1 AND bg_master_vessel_id = $2 AND pair_code <> $3`, [tb, bg, p.pairCode]);
        await client.query(
          `INSERT INTO vessel_pairs (pair_code, tb_master_vessel_id, bg_master_vessel_id, source)
           VALUES ($1, $2, $3, 'vessel_sheet')
           ON CONFLICT (pair_code) DO UPDATE SET tb_master_vessel_id = EXCLUDED.tb_master_vessel_id,
             bg_master_vessel_id = EXCLUDED.bg_master_vessel_id, source = 'vessel_sheet', updated_at = CURRENT_TIMESTAMP`,
          [p.pairCode, tb, bg],
        );
        keepCodes.push(p.pairCode);
        res.pairsUpserted += 1;
      });
    } catch (error) {
      res.failed.push({ what: `pair ${p.pairCode}`, error: msg(error) });
    }
  }
  const removed = await client.query(`DELETE FROM vessel_pairs WHERE NOT (pair_code = ANY($1::text[]))`, [keepCodes]);
  res.pairsRemoved = removed.rowCount ?? 0;
  return res;
}
