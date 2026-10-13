/**
 * Which master vessels must survive the master cleanup - the guard behind it.
 *
 * Only vessels that were INPUT IN KLIP (Add New Vessel) are protected. Everything the SAP import created is meant to be replaced by the cleaner
 * data the master is being migrated to, including vessels shipments currently use, so "used by a shipment" is NOT a reason to keep a row.
 *
 * The cost of deleting a row of master_vessels is real, which is why the flag matters: its SAP code aliases and its tug/barge pairs go with it
 * (ON DELETE CASCADE) and every shipment that pointed at it silently loses the link (ON DELETE SET NULL). A vessel typed into KLIP often exists
 * nowhere else yet - no SAP row, no Jovin row, no entry in the cleaned list - so a cleanup built from those sources would drop it without a sound.
 *
 * `klip_origin` (migration 234) is set by POST /master-vessels when that call CREATES the row. It is never set by the SAP import, the Jovin import
 * or the vessel loader.
 *
 * What a protected vessel's usage and DHM link still tell you is returned as facts, not as reasons: a protected vessel that shipments use has to be
 * carried into the new master AND have its shipments repointed, and the cleanup should say so.
 */

export type ProtectionReasonCode = 'klip_origin';

export interface ProtectionReason {
  code: ProtectionReasonCode;
  message: string;
}

export interface MasterVesselProtection {
  id: string;
  vesselName: string;
  vesselCode: string;
  /** Facts, not reasons: what migrating this vessel has to carry along. */
  shipmentsActive: number;
  shipmentsCancelled: number;
  linkedToDhm: boolean;
  klipOrigin: boolean;
  reasons: ProtectionReason[];
  protected: boolean;
}

/** Anything with a pg-style query: a pool client, or the app's `query` wrapped. */
export interface QueryRunner {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface ProtectionFacts {
  id: string;
  vessel_name: string;
  vessel_code: string;
  shipments_active: number;
  shipments_cancelled: number;
  linked_to_dhm: boolean;
  klip_origin: boolean;
}

/** Pure: the facts of one vessel into its verdict. */
export function describeProtection(f: ProtectionFacts): MasterVesselProtection {
  const reasons: ProtectionReason[] = [];
  if (f.klip_origin) {
    reasons.push({
      code: 'klip_origin',
      message: 'diinput lewat Add New Vessel di KLIP dan mungkin belum ada di SAP / DHM; harus dipindahkan ke master baru, bukan diganti',
    });
  }
  return {
    id: f.id,
    vesselName: f.vessel_name,
    vesselCode: f.vessel_code,
    shipmentsActive: Number(f.shipments_active) || 0,
    shipmentsCancelled: Number(f.shipments_cancelled) || 0,
    linkedToDhm: Boolean(f.linked_to_dhm),
    klipOrigin: Boolean(f.klip_origin),
    reasons,
    protected: reasons.length > 0,
  };
}

const PROTECTION_SQL = `
  SELECT mv.id::text AS id, mv.vessel_name, mv.vessel_code,
         mv.dhm_id IS NOT NULL AS linked_to_dhm,
         COALESCE(mv.klip_origin, FALSE) AS klip_origin,
         COALESCE(u.active, 0)::int AS shipments_active,
         COALESCE(u.cancelled, 0)::int AS shipments_cancelled
  FROM master_vessels mv
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE UPPER(COALESCE(s.status, '')) <> 'CANCELLED') AS active,
           COUNT(*) FILTER (WHERE UPPER(COALESCE(s.status, '')) = 'CANCELLED') AS cancelled
    FROM shipments s
    WHERE s.master_vessel_id = mv.id
       OR (NULLIF(trim(s.vessel_code), '') IS NOT NULL AND (
            upper(trim(s.vessel_code)) = upper(trim(mv.vessel_code))
            OR EXISTS (
              SELECT 1 FROM master_vessel_code_aliases a
              WHERE a.master_vessel_id = mv.id AND upper(trim(a.vessel_code)) = upper(trim(s.vessel_code))
            )
          ))
       OR (NULLIF(trim(s.vessel_name), '') IS NOT NULL AND normalize_vessel_name(s.vessel_name) = mv.normalized_vessel_name)
  ) u ON TRUE`;

/** Protection of the given master vessels. Ids that do not exist are simply absent from the result. */
export async function loadMasterVesselProtection(db: QueryRunner, ids: readonly string[]): Promise<Map<string, MasterVesselProtection>> {
  const out = new Map<string, MasterVesselProtection>();
  const wanted = [...new Set(ids.map((i) => String(i ?? '').trim()).filter(Boolean))];
  if (wanted.length === 0) return out;
  const res = await db.query(`${PROTECTION_SQL}\n  WHERE mv.id = ANY($1::uuid[])`, [wanted]);
  for (const row of res.rows as ProtectionFacts[]) out.set(row.id, describeProtection(row));
  return out;
}

/** Every KLIP-origin master vessel with its facts - the list a migration has to carry over. Cheap: only the flagged rows are counted against shipments. */
export async function loadKlipOriginVessels(db: QueryRunner): Promise<MasterVesselProtection[]> {
  const res = await db.query(`${PROTECTION_SQL}\n  WHERE COALESCE(mv.klip_origin, FALSE) IS TRUE\n  ORDER BY mv.created_at DESC`);
  return (res.rows as ProtectionFacts[]).map(describeProtection);
}

export interface DeletableSplit {
  deletable: MasterVesselProtection[];
  blocked: MasterVesselProtection[];
  /** Ids the cleanup named that the database does not know: never silently treated as deletable. */
  missing: string[];
}

/** The gate a cleanup goes through: of the vessels it wants to delete, the ones it may and the ones it may not. */
export async function splitDeletable(db: QueryRunner, ids: readonly string[]): Promise<DeletableSplit> {
  const map = await loadMasterVesselProtection(db, ids);
  const deletable: MasterVesselProtection[] = [];
  const blocked: MasterVesselProtection[] = [];
  for (const p of map.values()) (p.protected ? blocked : deletable).push(p);
  const missing = [...new Set(ids.map((i) => String(i ?? '').trim()).filter(Boolean))].filter((i) => !map.has(i));
  return { deletable, blocked, missing };
}

export class ProtectedMasterVesselError extends Error {
  readonly protection: MasterVesselProtection[];

  constructor(protection: MasterVesselProtection[]) {
    super(
      `master vessel dilindungi (diinput lewat KLIP), tidak boleh dihapus: ${protection
        .map((p) => `"${p.vesselName}" [${p.vesselCode}]${p.shipmentsActive > 0 ? `, dipakai ${p.shipmentsActive} shipment aktif` : ''}`)
        .join(' | ')}`,
    );
    this.name = 'ProtectedMasterVesselError';
    this.protection = protection;
  }
}

/** Throws ProtectedMasterVesselError when any of the ids is protected. For code that deletes in bulk and must not do it halfway. */
export async function assertDeletable(db: QueryRunner, ids: readonly string[]): Promise<void> {
  const { blocked } = await splitDeletable(db, ids);
  if (blocked.length > 0) throw new ProtectedMasterVesselError(blocked);
}
