/**
 * What the Edit Shipment modal draws for the SFAL / SFBD figures now that SAP supplies them too (SAP Phase 3 template, 2026-11).
 *
 * The working figure (sfal_qty / sfbd_qty, kg) is what users see and edit. SAP's own figure for the PO x STO row (sap_sfal_qty / sap_sfbd_qty) rides beside it
 * as a reference. The badge itself comes from resolveKlipSapProvenance, fed the same way the other SAP-or-KLIP fields feed it:
 *
 *   SAP filled it       SAP's figure, no user wrote the column  -> SAP badge
 *   a user wrote it     klip_edited_fields lists the column     -> KLIP badge, and SAP's figure underneath when it differs
 *   empty               nothing                                 -> no badge
 *
 * A multi-PO STO is the fourth case: the backend keeps SAP's figure there as a reference only (SAP repeats the voyage figure on some of those POs), so the working
 * figure is empty while SAP's is not. There is no badge to show, but the reference must still be visible: that is `referenceOnly`.
 */

/** Quantities are stored in kg and shown in MT. */
export function kgToMt(kg: number | null | undefined): number | null {
  return kg === null || kg === undefined || Number.isNaN(kg) ? null : kg / 1000;
}

export type SapFigureView = {
  /** The working figure in MT, for the badge and the compare. */
  klipMt: number | null;
  /** SAP's own figure in MT. Zero is no figure (the template sends 0 where it has none). */
  sapMt: number | null;
  /** The working figure is empty but SAP has one: show SAP's number as a reference, since no badge will appear. */
  referenceOnly: boolean;
};

export function sapFigureView(klipKg: number | null | undefined, sapKg: number | null | undefined): SapFigureView {
  const klipMt = kgToMt(klipKg);
  const sapRaw = kgToMt(sapKg);
  const sapMt = sapRaw !== null && sapRaw > 0 ? sapRaw : null;
  return { klipMt, sapMt, referenceOnly: klipMt === null && sapMt !== null };
}
