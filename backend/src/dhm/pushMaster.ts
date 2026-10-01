import logger from '../utils/logger';
import { query } from '../database/connection';
import { getDhmCatalogEntity, resolveDhmSlug } from './catalog';
import { isDhmEnabled } from './config';
import { postInbound, putInbound } from './inbound';
import { dhmParentRefKey, companyCatalogExtra, externalPartyCatalogExtra, matchDhmFieldKey, toDhmCatalogPayload } from './mapper';
import { persistMasterReplica, type DhmReplicaTable } from './masterReplica';
import type { DhmPushAttachment } from './pushVessel';
import type { DhmInboundResult, DhmRecord } from './types';

async function payloadFor(
  slug: string,
  name: string,
  extra: Record<string, string | string[]> | undefined,
  code?: string,
): Promise<{ payload: Record<string, unknown> } | { error: string }> {
  const entity = await getDhmCatalogEntity(slug);
  if (!entity) return { error: `DHM catalog does not allow ${slug}` };
  const built = toDhmCatalogPayload(entity, { name, ...(extra ?? {}) }, { code });
  if (built.missing.length) return { error: `DHM ${slug} needs ${built.missing.join(', ')}` };
  return { payload: built.payload };
}

async function pushNamed(args: {
  slug: string;
  name: string;
  existingCode: string | null;
  extra?: Record<string, string | string[]>;
  overwrite?: boolean;
  persist: (record: DhmRecord, code: string | null) => Promise<void>;
}): Promise<DhmPushAttachment> {
  let slug = args.slug;
  try {
    const resolved = await resolveDhmSlug(args.slug);
    if (!resolved) return { dhmError: `DHM catalog does not allow ${args.slug}` };
    slug = resolved;
  } catch (error) {
    logger.warn('DHM catalog unavailable', { slug: args.slug, error });
    return { dhmError: 'DHM catalog unavailable' };
  }

  const existingCode = String(args.existingCode || '').trim();
  const created = await payloadFor(slug, args.name, args.extra, existingCode || undefined);
  if ('error' in created) return { dhmError: created.error };
  let result: DhmInboundResult = existingCode
    ? await putInbound(slug, existingCode, created.payload)
    : await postInbound(slug, created.payload);

  if (result.ok) {
    await args.persist(result.record, result.code);
    return { dhmStatus: result.status, dhmCode: result.code };
  }

  if (result.conflict) {
    await args.persist(result.record, result.code || null);
    const code = result.code || String(result.record.data?.code || '').trim();
    if (args.overwrite && code) {
      const again = await payloadFor(slug, args.name, args.extra, code);
      if ('error' in again) return { dhmConflict: true, dhmCode: code, dhmRecord: result.record, dhmError: again.error };
      const updated = await putInbound(slug, code, again.payload);
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

  logger.warn('DHM inbound rejected', { slug, error: result.error, status: result.httpStatus });
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
  options?: { overwrite?: boolean; extra?: Record<string, string | string[]> },
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

async function siteDhmCodeForPlant(siteId: string | null, siteName: string): Promise<{ found: boolean; code: string | null }> {
  const parent = await query(
    `SELECT code_dhm
     FROM master_sites
     WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
        OR (
          $1::uuid IS NULL
          AND $2::text <> ''
          AND upper(trim(site_name)) = upper(trim($2::text))
        )
     LIMIT 1`,
    [siteId, siteName.trim()],
  );
  if (!parent.rows[0]) return { found: false, code: null };
  return { found: true, code: String(parent.rows[0].code_dhm || '').trim() || null };
}

export async function pushMasterPlantToDhm(
  localId: string,
  row: Record<string, unknown>,
  options?: { overwrite?: boolean },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};
  const plantName = String(row.plant_name || '').trim() || String(row.plant_code || '').trim();
  if (!plantName) return { dhmError: 'Plant name is required for DHM' };

  try {
    let siteCode = String(row.site_dhm_code || '').trim();
    if (!siteCode) {
      const parent = await siteDhmCodeForPlant(String(row.site_id || '').trim() || null, String(row.site || ''));
      if (!parent.found) return { dhmError: 'Plant needs a DHM site.' };
      if (!parent.code) return { dhmError: 'Plant needs a DHM site. Sync Master Site first.' };
      siteCode = parent.code;
    }

    const entity = await getDhmCatalogEntity('plant');
    const extra: Record<string, string> = {};
    if (entity) {
      const sap = String(row.plant_code || '').trim();
      const plantType = String(row.plant_type || '').trim();
      const sapKey = matchDhmFieldKey(entity, [
        (key) => key.includes('sap') && (key.includes('plant') || key.includes('code')),
        (key) => key === 'plantcode',
      ]);
      const nameKey = matchDhmFieldKey(entity, [
        (key) => key === 'plantname',
        (key) => key.includes('plant') && key.includes('name'),
      ]);
      const typeKey = matchDhmFieldKey(entity, [
        (key) => key === 'planttype',
        (key) => key.includes('plant') && key.includes('type'),
        (key) => key === 'type',
      ]);
      const siteKey =
        dhmParentRefKey(entity, ['site_id']) ||
        matchDhmFieldKey(entity, [(key) => key === 'siteid' || key === 'site']);
      if (sapKey && sap) extra[sapKey] = sap;
      if (nameKey && nameKey !== 'name') extra[nameKey] = plantName;
      if (typeKey && plantType) extra[typeKey] = plantType;
      if (siteKey && siteCode) extra[siteKey] = siteCode;
    }

    return pushNamedMasterToDhm('master_plants', localId, 'plant', plantName, String(row.code_dhm || '').trim() || null, {
      overwrite: options?.overwrite,
      extra,
    });
  } catch (error) {
    logger.warn('DHM inbound unavailable; local plant saved', { localId, error });
    return { dhmError: 'DHM unavailable' };
  }
}

export async function pushMasterExternalPartyToDhm(
  localId: string,
  row: Record<string, unknown>,
  options?: { overwrite?: boolean },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};
  const name = String(row.value_3 || '').trim();
  if (!name) return { dhmError: 'Name is required for DHM' };
  try {
    const slug = (await resolveDhmSlug('external_party')) || 'external_party';
    const entity = await getDhmCatalogEntity(slug);
    return pushNamedMasterToDhm(
      'master_reference_items',
      localId,
      'external_party',
      name,
      String(row.code_dhm || '').trim() || null,
      {
        overwrite: options?.overwrite,
        extra: externalPartyCatalogExtra(entity, String(row.value_2 || '')),
      },
    );
  } catch (error) {
    logger.warn('DHM inbound unavailable; local external party saved', { localId, error });
    return { dhmError: 'DHM unavailable' };
  }
}

export async function pushMasterCompanyToDhm(
  localId: string,
  row: Record<string, unknown>,
  options?: { overwrite?: boolean },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};
  const name = String(row.company_name || '').trim();
  if (!name) return { dhmError: 'Name is required for DHM' };
  try {
    let siteCodes = Array.isArray(row.site_dhm_codes)
      ? row.site_dhm_codes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (!siteCodes.length) {
      const linked = await query(
        `SELECT site.code_dhm
         FROM master_company_sites link
         JOIN master_sites site ON site.id = link.site_id
         WHERE link.company_id = $1::uuid
           AND NULLIF(trim(site.code_dhm), '') IS NOT NULL
         ORDER BY site.site_name`,
        [localId],
      );
      siteCodes = linked.rows.map((item) => String(item.code_dhm));
    }
    const slug = (await resolveDhmSlug('company')) || 'company';
    const entity = await getDhmCatalogEntity(slug);
    return pushNamedMasterToDhm(
      'master_companies',
      localId,
      'company',
      name,
      String(row.code_dhm || '').trim() || null,
      {
        overwrite: options?.overwrite,
        extra: companyCatalogExtra(entity, String(row.company_code || ''), siteCodes),
      },
    );
  } catch (error) {
    logger.warn('DHM inbound unavailable; local company saved', { localId, error });
    return { dhmError: 'DHM unavailable' };
  }
}

async function companyDhmCodeForSite(siteId: string, companyName: string): Promise<string | null> {
  const name = companyName.trim();
  const linked = await query(
    `SELECT company.code_dhm
     FROM master_companies company
     LEFT JOIN master_company_sites link
       ON link.company_id = company.id AND link.site_id = $1::uuid
     WHERE NULLIF(trim(company.code_dhm), '') IS NOT NULL
       AND (
         link.site_id IS NOT NULL
         OR ($2::text <> '' AND upper(trim(company.company_name)) = upper(trim($2::text)))
       )
     ORDER BY
       CASE
         WHEN link.site_id IS NOT NULL AND $2::text <> '' AND upper(trim(company.company_name)) = upper(trim($2::text)) THEN 0
         WHEN link.site_id IS NOT NULL THEN 1
         ELSE 2
       END,
       company.company_name
     LIMIT 1`,
    [siteId, name],
  );
  return String(linked.rows[0]?.code_dhm || '').trim() || null;
}

export async function pushMasterSiteToDhm(
  localId: string,
  row: Record<string, unknown>,
  options?: { overwrite?: boolean },
): Promise<DhmPushAttachment> {
  if (!isDhmEnabled()) return {};
  const siteName = String(row.site_name || '').trim();
  if (!siteName) return { dhmError: 'Name is required for DHM' };
  try {
    const companyCode = await companyDhmCodeForSite(localId, String(row.company_name || ''));
    if (!companyCode) {
      return { dhmError: 'Site needs a DHM company. Sync Master Company (Internal) first.' };
    }
    const slug = (await resolveDhmSlug('site')) || 'site';
    const entity = await getDhmCatalogEntity(slug);
    const companyKey = entity
      ? dhmParentRefKey(entity, ['company_id', 'organization_id']) ||
        matchDhmFieldKey(entity, [(key) => key === 'companyid' || key === 'organizationid'])
      : 'company_id';
    const extra: Record<string, string> = {};
    if (companyKey) extra[companyKey] = companyCode;
    return pushNamedMasterToDhm(
      'master_sites',
      localId,
      'site',
      siteName,
      String(row.code_dhm || '').trim() || null,
      { overwrite: options?.overwrite, extra },
    );
  } catch (error) {
    logger.warn('DHM inbound unavailable; local site saved', { localId, error });
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
