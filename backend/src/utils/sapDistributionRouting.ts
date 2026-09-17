/**
 * Pure SAP import routing — SEA vs LAND decision for shipment materialization.
 * Mirrors SapDataDistributionService.distributeData / ensureSeaShipmentIfEligible.
 */
import {
  isSapSeaStoLeg,
  isSapSeaStoLegForIncoterm,
  isShipmentPageGrPoIncoterm,
} from './sapSeaStoLeg';

export interface SapDistributionRoutingContext {
  isLand: boolean;
  isSea: boolean;
  incotermLabel: string;
  isTruckIncoterm: boolean;
  hasShipment: boolean;
  seaEligible: boolean;
  hasVesselLike: boolean;
  hasStoInShipment: boolean;
  parsedData: unknown;
}

export interface SapDistributionRoutingResult {
  seaLike: boolean;
  assumeSea: boolean;
  landSeaStoLeg: boolean;
  cifCfrSeaLike: boolean;
}

/** Resolve whether SAP row should route to Shipments (SEA-like) creation path. */
export function resolveSapDistributionSeaLike(
  ctx: SapDistributionRoutingContext,
): SapDistributionRoutingResult {
  const assumeSea =
    !ctx.isLand &&
    !ctx.isSea &&
    ctx.hasShipment &&
    (ctx.hasVesselLike || ctx.hasStoInShipment);

  const isCifCfrIncoterm = isShipmentPageGrPoIncoterm(ctx.incotermLabel);
  const landSeaStoLeg =
    ctx.isLand &&
    ctx.incotermLabel === 'FOB' &&
    !ctx.isTruckIncoterm &&
    isSapSeaStoLeg(ctx.parsedData) &&
    ctx.seaEligible;
  const cifCfrSeaLike =
    isCifCfrIncoterm &&
    !ctx.isTruckIncoterm &&
    ctx.hasShipment &&
    ctx.seaEligible;

  const seaLike = ctx.isSea || assumeSea || landSeaStoLeg || cifCfrSeaLike;

  return { seaLike, assumeSea, landSeaStoLeg, cifCfrSeaLike };
}

/** True when distributeData should attempt shipment upsert for this row. */
export function shouldMaterializeSapShipment(
  ctx: SapDistributionRoutingContext,
): boolean {
  const { seaLike } = resolveSapDistributionSeaLike(ctx);
  if (!seaLike || !ctx.hasShipment || !ctx.seaEligible || ctx.isTruckIncoterm) {
    return false;
  }
  // Block FOB Type T (and other non-sea FOB legs) even via assumeSea + STO anchor.
  return isSapSeaStoLegForIncoterm(ctx.parsedData, ctx.incotermLabel);
}
