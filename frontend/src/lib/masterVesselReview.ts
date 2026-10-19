/**
 * The "Perlu review" queue of Master Vessel: vessels KLIP registered itself from a SAP vessel name and was not sure of
 * (backend services/registerVesselFromSap.service.ts, masterVesselReview.service.ts).
 */

export interface VesselReviewCandidate {
  id: string
  vessel_name: string
  vessel_code: string
}

export interface VesselReviewItem {
  id: string
  vessel_name: string
  vessel_code: string
  vessel_role: string | null
  vessel_type: string | null
  vessel_owner: string | null
  code_status: string | null
  review_reasons: string[]
  review_sap_name: string | null
  created_at: string | null
  pair_code: string | null
  pair_partner_name: string | null
  /** Existing vessels this one may really be: the targets of a merge. */
  candidates: VesselReviewCandidate[]
}

/** The reasons the backend writes (VesselNameFlag of sapVesselNameParse, plus the two the registration adds), in words. */
export const VESSEL_REVIEW_REASON_LABELS: Readonly<Record<string, string>> = {
  truncated: 'Nama mungkin terpotong SAP (batas 35 karakter)',
  no_prefix: 'Nama tanpa prefiks TB./BG./MT.: role dan tipe belum diketahui',
  unknown_prefix: 'Prefiks tidak dikenal (diambil sebagai tongkang)',
  tug_inferred: 'Tugboat disimpulkan dari pasangannya (TB. ditambahkan)',
  barge_inferred: 'Tongkang disimpulkan dari pasangannya (BG. ditambahkan)',
  prefix_undecided: 'Prefiks KLM./KM./MV. belum ada aturannya',
  pair_roles_conflict: 'Pasangan TB/BG tidak jelas: kedua sisi berperan sama',
  too_many_segments: 'Nama SAP berisi lebih dari dua bagian',
  code_held_by_other: 'Kode SAP sudah dipakai kapal lain (tidak dipindahkan)',
  code_ambiguous: 'Kode SAP cocok dengan kedua nama pasangan (diberikan ke tongkang)',
}

export function describeVesselReviewReason(code: string): string {
  return VESSEL_REVIEW_REASON_LABELS[code] ?? code
}

/** "BARGE · BG" / "TUG BOAT · TB" / "-": what the vessel is, as far as its prefix said. */
export function describeVesselKind(item: Pick<VesselReviewItem, 'vessel_role' | 'vessel_type'>): string {
  const parts = [item.vessel_type, item.vessel_role].map((p) => String(p ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join(' · ') : '-'
}
