import { dhmRequest } from './client';

export interface DhmCatalogField {
  key: string;
  required?: boolean;
  unique?: boolean;
  systemGenerated?: boolean;
  dataType?: string;
  referenceSlug?: string;
}

export interface DhmCatalogEntity {
  slug: string;
  name?: string;
  operations?: { read?: boolean; create?: boolean; update?: boolean };
  fields?: DhmCatalogField[];
}

/** Live hub renamed organization → company. Shipper may be external_party. */
const SLUG_ALIASES: Record<string, string[]> = {
  company: ['company', 'organization'],
  organization: ['company', 'organization'],
  shipper: ['shipper', 'external_party'],
  external_party: ['external_party', 'shipper'],
};

let catalogCache: { fetchedAt: number; entities: DhmCatalogEntity[] } | null = null;
const CATALOG_TTL_MS = 10 * 60 * 1000;

export async function fetchDhmCatalog(force = false): Promise<DhmCatalogEntity[]> {
  if (!force && catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.entities;
  }
  const { status, data } = await dhmRequest<{ entities?: DhmCatalogEntity[] }>({
    method: 'GET',
    url: '/v1/catalog',
  });
  if (status !== 200) {
    throw new Error(`DHM catalog failed (${status})`);
  }
  const entities = Array.isArray(data?.entities) ? data.entities : [];
  catalogCache = { fetchedAt: Date.now(), entities };
  return entities;
}

export function resetDhmCatalogCache(): void {
  catalogCache = null;
}

export async function getDhmCatalogEntity(slug: string): Promise<DhmCatalogEntity | null> {
  const entities = await fetchDhmCatalog();
  return entities.find((entity) => entity.slug === slug) ?? null;
}

/** Prefer the slug the live catalog actually lists. */
export async function resolveDhmSlug(preferred: string): Promise<string | null> {
  const entities = await fetchDhmCatalog();
  const have = new Set(entities.map((entity) => entity.slug));
  const options = SLUG_ALIASES[preferred] ?? [preferred];
  return options.find((slug) => have.has(slug)) ?? null;
}

export async function dhmSlugIsAllowlisted(slug: string): Promise<boolean> {
  return (await resolveDhmSlug(slug)) != null;
}

export async function dhmVesselIsAllowlisted(): Promise<boolean> {
  return dhmSlugIsAllowlisted('vessel');
}
