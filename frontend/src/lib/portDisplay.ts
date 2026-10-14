/**
 * How a vessel port text is DRAWN: as its Master Port when it has one, else as it is (the original SAP text).
 *
 * The tables draw ports in many places (Shipments list and export, Shipping Performance, ...) from row objects that only carry text. The Master Port map
 * (GET /contracts/filter-options/discharge-port-map, from the Master Port and its VESSEL PORT (SAP) names) is loaded once per page, so a page hands it over here with
 * setPortDisplayResolver while it renders and the drawing functions read it, instead of every cell renderer being passed one. No map (not loaded yet, or failed):
 * every text is drawn as it is.
 *
 * Standalone on purpose (no imports): shipmentListPorts, shippingPerformancePorts and dischargePortFilter all use it, and the identity rule lives here once.
 */

/** Align with vesselLoadingPortDedupe.normalizePortIdentity (PORT OF X ≡ X). */
export function normalizeListPortIdentity(name: unknown): string {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/^(PORT|JETTY|TERMINAL|PELABUHAN|DERMAGA)(\s+OF)?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

let current: ReadonlyMap<string, string> | null = null

/** Called by a page while it renders, with the Master Port map it loaded (or null). Idempotent. */
export function setPortDisplayResolver(resolver: ReadonlyMap<string, string> | null | undefined): void {
  current = resolver ?? null
}

/** The Master Port a text stands for, or null (no map yet, an empty text, or a text nobody mapped). */
export function masterPortOf(text: unknown): string | null {
  if (!current) return null
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  if (!clean) return null
  return current.get(normalizeListPortIdentity(clean) || clean) ?? null
}

/** The text as drawn: its Master Port when it has one, else the text itself (the original SAP / KLIP value). */
export function displayPortLabel(text: string): string {
  return masterPortOf(text) ?? text
}
