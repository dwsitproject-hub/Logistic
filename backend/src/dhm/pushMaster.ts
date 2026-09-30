import logger from '../utils/logger';
import { dhmSlugIsAllowlisted } from './catalog';
import { isDhmEnabled } from './config';
import { postInbound, putInbound } from './inbound';
import { toDhmNamePayload } from './mapper';
import {
  findSiblingOrgCode,
  persistMasterReplica,
  rememberDhmOrganization,
  type DhmReplicaTable,
} from './masterReplica';
import type { DhmPushAttachment } from './pushVessel';
import type { DhmInboundResult, DhmRecord } from './types';

async function allowError(slug: string): Promise<string | null> {
  try {
    const allowed = await dhmSlugIsAllowlisted(slug);
    return allowed ? null : `DHM catalog does not allow ${slug}`;
  } catch (error) {
    logger.warn('DHM catalog unavailable', { slug, error });
    return 'DHM catalog unavailable';
  }
}

async function pushNamed(args: {
  slug: string;
  name: string;
  existingCode: string | null;
  extra?: Record<string, string>;
  overwrite?: boolean;
  persist: (record: DhmRecord, code: string | null) => Promise<void>;
}): Promise<DhmPushAttachment> {
  const blocked = await allowError(args.slug);
  if (blocked) return { dhmError: blocked };

  const existingCode = String(args.existingCode || '').trim();
  const send = (code?: string) => toDhmNamePayload(args.name, { code, extra: args.extra });
  let result: DhmInboundResult = existingCode
    ? await putInbound(args.slug, existingCode, send(existingCode))
    : await postInbound(args.slug, send());

  if (result.ok) {
    await args.persist(result.record, result.code);
    return { dhmStatus: result.status, dhmCode: result.code };
  }

  if (result.conflict) {
    await args.persist(result.record, result.code || null);
    const code = result.code || String(result.record.data?.code || '').trim();
    if (args.overwrite && code) {
      const updated = await putInbound(args.slug, code, send(code));
      if (updated.ok) {
        await args.persist(updated.record, updated.code);
        return { dhmStatus: updated.status, dhmCode: updated.code };
      }
      return {
        dhmConflict: true,
        dhmCode: code,
        dhmRecord: result.record,
        dhmError: !updated.ok && !updated.conflict ? updated.error : 'DHM overwrite failed',
      };
    }
    return {
      dhmConflict: true,
      dhmStatus: 'duplicate',
      dhmCode: code || null,
      dhmRecord: result.record,
    };
  }

  logger.warn('DHM inbound rejected', { slug: args.slug, error: result.error, status: result.httpStatus });
  return { dhmError: result.error };
}

function persistRow(table: DhmReplicaTable, localId: string) {
  return (record: DhmRecord, code: string | null) => persistMasterReplica(table, localId, record, code);
}

export async function pushNamedMasterToDhm(
  table: DhmReplicaTable,
  localId: string,
  slug: string,
  name: string,
  existingCode: string | null,
  options?: { overwrite?: boolean; extra?: Record<string, string> },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};
  const label = String(name || '').trim();
  if (!label) return { dhmError: 'Name is required for DHM' };
  try {
    return await pushNamed({
      slug,
      name: label,
      existingCode,
      extra: options?.extra,
      overwrite: options?.overwrite,
      persist: persistRow(table, localId),
    });
  } catch (error) {
    logger.warn('DHM inbound unavailable; local master saved', { slug, localId, error });
    return { dhmError: 'DHM unavailable' };
  }
}

export async function pushMasterPlantToDhm(
  localId: string,
  row: Record<string, unknown>,
  options?: { overwrite?: boolean },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};
  const companyName = String(row.company_name || '').trim();
  const siteName = String(row.plant_name || '').trim() || String(row.plant_code || '').trim();
  if (!companyName || !siteName) {
    return { dhmError: 'Company name and plant are required for DHM' };
  }

  try {
    let orgCode = String(row.dhm_org_code || '').trim();
    if (!orgCode) orgCode = (await findSiblingOrgCode(companyName, localId)) || '';

    const org = await pushNamed({
      slug: 'organization',
      name: companyName,
      existingCode: orgCode || null,
      overwrite: options?.overwrite,
      persist: async (record, code) => {
        await rememberDhmOrganization(record, code, companyName);
      },
    });
    if (org.dhmConflict || org.dhmError) return org;
    const resolvedOrg = String(org.dhmCode || orgCode || '').trim();
    if (!resolvedOrg) return { dhmError: 'DHM organization was not linked' };

    const site = await pushNamed({
      slug: 'site',
      name: siteName,
      existingCode: String(row.code_dhm || '').trim() || null,
      extra: { organization_id: resolvedOrg },
      overwrite: options?.overwrite,
      persist: persistRow('master_plants', localId),
    });
    return site.dhmCode || site.dhmConflict || site.dhmError ? site : { ...site, dhmCode: resolvedOrg };
  } catch (error) {
    logger.warn('DHM inbound unavailable; local plant saved', { localId, error });
    return { dhmError: 'DHM unavailable' };
  }
}

export async function pushMasterPortToDhm(
  localId: string,
  row: Record<string, unknown>,
  options?: { overwrite?: boolean },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};
  const site = String(row.dhm_site_code || '').trim();
  if (!site) return { dhmError: 'Port needs a DHM site' };
  return pushNamedMasterToDhm(
    'master_loading_ports',
    localId,
    'port_master',
    String(row.port || ''),
    String(row.code_dhm || '').trim() || null,
    {
    overwrite: options?.overwrite,
    extra: { site_id: site },
  });
}
