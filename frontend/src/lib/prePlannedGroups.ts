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
