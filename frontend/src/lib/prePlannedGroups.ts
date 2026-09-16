import api from '@/lib/api';

export interface PrePlannedGroupMember {
  contractId: string;
  contractNumber: string;
  osMtAtGrouping: number;
  supplier?: string;
  buyer?: string;
  product?: string;
  deliveryStart?: string;
  deliveryEnd?: string;
  contractDate?: string;
}

export interface PrePlannedGroup {
  id: string;
  groupCode: string;
  partitionKey: string;
  groupPlant: string;
  buyer: string;
  incoterm: string;
  product: string;
  supplier: string;
  supplierGroup: string | null;
  windowStart: string;
  windowEnd: string;
  binCapacityMt: number;
  totalOsMt: number;
  estVessels: number;
  isPartial: boolean;
  mergeHintGroupIds: string[];
  status: string;
  shipmentId: string | null;
  excelGroupLabel?: string | null;
  members: PrePlannedGroupMember[];
}

export interface PrePlannedGroupsResponse {
  groups: PrePlannedGroup[];
  ungroupedContractCount: number;
}

export async function fetchPrePlannedGroups(params?: {
  plant?: string;
  status?: string;
}): Promise<PrePlannedGroupsResponse> {
  const res = await api.get('/pre-planned/groups', { params });
  return res.data.data as PrePlannedGroupsResponse;
}

export async function dismissPrePlannedGroup(groupId: string, reason?: string): Promise<void> {
  await api.post(`/pre-planned/groups/${groupId}/dismiss`, { reason });
}

export async function acceptPrePlannedGroup(
  groupId: string,
  shipmentId?: string,
): Promise<void> {
  const body = shipmentId ? { shipmentId } : {};
  await api.post(`/pre-planned/groups/${groupId}/accept`, body);
}

export async function revertPrePlannedGroup(groupId: string): Promise<void> {
  await api.post(`/pre-planned/groups/${groupId}/revert`);
}

export async function rebuildPrePlannedGroups(): Promise<void> {
  await api.post('/pre-planned/rebuild');
}

/**
 * Manually create a Preplanned group from user-selected Unplanned contracts
 * (Shipments View Table "Select" column). Requires at least 2 contract ids;
 * the group is created directly with status ACCEPTED (Preplanned), no
 * intermediate SUGGESTED step.
 */
export async function createManualPrePlannedGroup(contractIds: string[]): Promise<PrePlannedGroup> {
  const res = await api.post('/pre-planned/groups/manual', { contractIds });
  return res.data.data.group as PrePlannedGroup;
}

export type ShipmentGroupingBulkUploadResult = {
  processedGroups: number;
  succeeded: number;
  failed: number;
  skippedWithoutY: number;
  groups: Array<{ group: string; groupCode: string; contractCount: number; totalOsMt?: number }>;
  failures: Array<{ excelRowNumbers: number[]; group?: string; reason: string }>;
  warnings: Array<{ group: string; groupCode: string; reason: string }>;
};

export async function downloadShipmentGroupingTemplate(params: URLSearchParams): Promise<{
  blob: Blob;
  truncated: boolean;
  rowCount: number;
  limit: number;
}> {
  const res = await api.get(`/pre-planned/grouping-template?${params.toString()}`, {
    responseType: 'blob',
  });
  const blob = res.data as Blob;
  const contentType = String(res.headers?.['content-type'] ?? '');
  if (contentType.includes('application/json')) {
    const text = await blob.text();
    let message = 'Failed to download grouping template';
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  const truncated = String(res.headers?.['x-klip-template-truncated'] ?? '') === '1';
  const rowCount = Number(res.headers?.['x-klip-template-row-count'] ?? 0);
  const limit = Number(res.headers?.['x-klip-template-limit'] ?? 0);
  return { blob, truncated, rowCount, limit };
}

export async function uploadShipmentGroupingTemplate(
  file: File,
): Promise<ShipmentGroupingBulkUploadResult> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api.post('/pre-planned/grouping-bulk-upload', fd);
  return res.data.data as ShipmentGroupingBulkUploadResult;
}

/** Toolbar scope used to narrow pre-planned suggestions on the Shipments page. */
export interface PrePlannedGlobalScopeFilters {
  dateFrom: string;
  dateTo: string;
  searchTerm: string;
  selectedIncoterms: readonly string[];
  selectedProducts: readonly string[];
  selectedSuppliers: readonly string[];
  selectedGroupPlants: readonly string[];
}

function normScopeValue(value: unknown): string {
  return String(value ?? '').trim();
}

function valueInScopeList(value: string, list: readonly string[]): boolean {
  const v = normScopeValue(value);
  return list.some((item) => normScopeValue(item) === v);
}

function groupMatchesSearchTerm(group: PrePlannedGroup, searchTerm: string): boolean {
  const needle = searchTerm.toLowerCase();
  const fields = [
    group.groupCode,
    group.excelGroupLabel,
    group.groupPlant,
    group.supplier,
    group.product,
    group.buyer,
    group.incoterm,
    ...group.members.map((m) => m.contractNumber),
  ];
  return fields.some((field) => normScopeValue(field).toLowerCase().includes(needle));
}

/** Mirror Shipments global toolbar filters on pre-planned group metadata. */
export function filterPrePlannedGroupsByGlobalScope(
  groups: PrePlannedGroup[],
  scope: PrePlannedGlobalScopeFilters,
): PrePlannedGroup[] {
  const searchTerm = normScopeValue(scope.searchTerm);

  return groups.filter((group) => {
    if (
      scope.selectedGroupPlants.length > 0 &&
      !valueInScopeList(group.groupPlant, scope.selectedGroupPlants)
    ) {
      return false;
    }
    if (
      scope.selectedSuppliers.length > 0 &&
      !valueInScopeList(group.supplier, scope.selectedSuppliers)
    ) {
      return false;
    }
    if (
      scope.selectedProducts.length > 0 &&
      !valueInScopeList(group.product, scope.selectedProducts)
    ) {
      return false;
    }
    if (
      scope.selectedIncoterms.length > 0 &&
      !valueInScopeList(group.incoterm, scope.selectedIncoterms)
    ) {
      return false;
    }
    // Note: global toolbar dateFrom/dateTo filter shipments by contract_date; pre-planned
    // groups cluster by contract date — applying date here caused suggestions to disappear while
    // unplanned rows remained visible. Plant/supplier/product/incoterm/search stay in sync.
    if (searchTerm && !groupMatchesSearchTerm(group, searchTerm)) {
      return false;
    }
    return true;
  });
}

export function hasPrePlannedGlobalScopeFilters(scope: PrePlannedGlobalScopeFilters): boolean {
  return (
    Boolean(normScopeValue(scope.searchTerm)) ||
    scope.selectedGroupPlants.length > 0 ||
    scope.selectedIncoterms.length > 0 ||
    scope.selectedProducts.length > 0 ||
    scope.selectedSuppliers.length > 0
  );
}
