import { dhmRequest } from './client';

export interface DhmCatalogEntity {
  slug: string;
  name?: string;
  operations?: { read?: boolean; create?: boolean; update?: boolean };
  fields?: Array<{ key: string; required?: boolean; unique?: boolean }>;
}

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

export async function dhmVesselIsAllowlisted(): Promise<boolean> {
  const entities = await fetchDhmCatalog();
  return entities.some((e) => e.slug === 'vessel');
}
