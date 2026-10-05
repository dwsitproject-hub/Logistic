/**
 * The push functions the Master controllers call, each followed by a note of how it went (pushState.ts).
 *
 * The raw functions in pushMaster.ts / pushVessel.ts keep returning exactly what they did; these wrappers only add the
 * bookkeeping, so a save that fails to reach DHM leaves something behind to show and retry. pushCatalog.ts records the
 * bulk Sync button and the retry job itself, since it calls the raw functions.
 */
import {
  pushMasterCompanyToDhm as rawCompany,
  pushMasterExternalPartyToDhm as rawExternalParty,
  pushMasterPlantToDhm as rawPlant,
  pushMasterPortToDhm as rawPort,
  pushMasterSiteToDhm as rawSite,
  pushNamedMasterToDhm as rawNamed,
} from './pushMaster';
import { pushMasterVesselToDhm as rawVessel } from './pushVessel';
import { recordPushOutcome, type DhmPushKind } from './pushState';
import type { DhmPushAttachment } from './pushVessel';

type PushFn<A extends unknown[]> = (localId: string, ...rest: A) => Promise<DhmPushAttachment>;

function tracked<A extends unknown[]>(kind: DhmPushKind, fn: PushFn<A>): PushFn<A> {
  return async (localId, ...rest) => {
    const result = await fn(localId, ...rest);
    await recordPushOutcome(kind, localId, result);
    return result;
  };
}

export const pushMasterVesselToDhm = tracked('vessel', rawVessel);
export const pushMasterCompanyToDhm = tracked('company', rawCompany);
export const pushMasterExternalPartyToDhm = tracked('ext_company', rawExternalParty);
export const pushMasterPlantToDhm = tracked('plant', rawPlant);
export const pushMasterPortToDhm = tracked('port', rawPort);
export const pushMasterSiteToDhm = tracked('site', rawSite);

/** Products and incoterms go through the generic named push; the table (and slug) say which master it was. */
export const pushNamedMasterToDhm: typeof rawNamed = async (table, localId, slug, name, existingCode, options) => {
  const result = await rawNamed(table, localId, slug, name, existingCode, options);
  const kind: DhmPushKind | null =
    table === 'products' ? 'product' : table === 'master_reference_items' && slug === 'incoterm' ? 'incoterm' : null;
  if (kind) await recordPushOutcome(kind, localId, result);
  return result;
};
