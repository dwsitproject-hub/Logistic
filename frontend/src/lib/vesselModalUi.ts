/** Shared layout tokens — aligned with Add New Shipment / Add New Trucking modals. */

export const VESSEL_MODAL_OVERLAY_CLASS =
  'fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4'

export const VESSEL_MODAL_PANEL_CLASS =
  'flex max-h-[90vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-xl'

export const VESSEL_MODAL_HEADER_CLASS =
  'sticky top-0 z-10 shrink-0 rounded-t-xl border-b border-gray-200 bg-white'

export const VESSEL_MODAL_BODY_CLASS = 'min-h-0 flex-1 overflow-y-auto px-6 py-4'

export const VESSEL_MODAL_SECTION_CLASS = 'rounded-xl border border-gray-200 shadow-sm'

export type VesselModalSectionTint = 'blue' | 'cyan' | 'violet' | 'emerald' | 'orange' | 'slate'

const SECTION_HEADER_TINT: Record<VesselModalSectionTint, string> = {
  blue: 'bg-gradient-to-r from-blue-50 to-white',
  cyan: 'bg-gradient-to-r from-cyan-50 to-white',
  violet: 'bg-gradient-to-r from-violet-50 to-white',
  emerald: 'bg-gradient-to-r from-emerald-50 to-white',
  orange: 'bg-gradient-to-r from-orange-50 to-white',
  slate: 'bg-gradient-to-r from-slate-50 to-white',
}

/** Gradient section header — matches Trucking / Add New Shipment cards. */
export function vesselModalSectionHeaderClass(
  tint: VesselModalSectionTint = 'blue',
  extraClassName = '',
): string {
  const base =
    'flex items-center gap-2.5 px-4 py-2.5 rounded-t-xl border-b border-gray-200'
  return `${base} ${SECTION_HEADER_TINT[tint]}${extraClassName ? ` ${extraClassName}` : ''}`
}

/** Default blue gradient header (backward-compatible constant for page modals). */
export const VESSEL_MODAL_SECTION_HEADER_CLASS = vesselModalSectionHeaderClass('blue')

export const VESSEL_MODAL_STEP_STRIP_CLASS =
  'flex items-center gap-0 border-t border-gray-100 px-6 py-2 bg-gray-50/80'

export const VESSEL_MODAL_FOOTER_BAR_CLASS =
  'shrink-0 border-t border-gray-200 bg-white px-6 py-4 flex flex-col gap-3 rounded-b-xl'

/** In-body action card (Add New / Trucking style). */
export const VESSEL_MODAL_FOOTER_CARD_CLASS =
  'rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3'

export const VESSEL_MODAL_SUBSECTION_LABEL_CLASS =
  'text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2'

export const VESSEL_MODAL_COMPACT_TH =
  'h-9 px-3 py-2 text-[11px] font-semibold text-gray-600 whitespace-nowrap bg-gray-50'

export const VESSEL_MODAL_COMPACT_TD = 'px-3 py-2 text-xs align-middle text-gray-900'

export const VESSEL_MODAL_TABLE_FOOTER_CLASS = 'bg-slate-50 border-t-2 border-slate-200 font-semibold'
