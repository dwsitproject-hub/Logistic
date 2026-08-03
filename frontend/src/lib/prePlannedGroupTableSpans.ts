import type { PrePlannedGroup } from '@/lib/prePlannedGroups';

export function resolveShipmentContractNumber(row: {
  contract_number?: string | null;
  contract_numbers?: string | null;
}): string {
  return String(row.contract_number ?? row.contract_numbers ?? '')
    .split(',')[0]
    ?.trim() ?? '';
}

/** Match table row to pre-planned group via SAP contract no. and/or contracts.id UUID. */
export function resolvePrePlannedGroupForRow<
  T extends {
    id: string;
    contract_number?: string | null;
    contract_numbers?: string | null;
    contract_row_id?: string | null;
  },
>(row: T, contractNumberToGroup: Map<string, PrePlannedGroup>): PrePlannedGroup | undefined {
  const keys = [
    resolveShipmentContractNumber(row),
    String(row.contract_row_id ?? '').trim(),
    String(row.id ?? '').trim(),
  ].filter(Boolean);
  for (const key of keys) {
    const group = contractNumberToGroup.get(key);
    if (group) return group;
  }
  return undefined;
}

export function buildPrePlannedGroupLookupMap(groups: PrePlannedGroup[]): Map<string, PrePlannedGroup> {
  const map = new Map<string, PrePlannedGroup>();
  for (const g of groups) {
    for (const m of g.members) {
      if (m.contractNumber) map.set(m.contractNumber, g);
      if (m.contractId) map.set(m.contractId, g);
    }
  }
  return map;
}

export function formatPrePlannedGroupTooltip(group: PrePlannedGroup): string {
  const memberList = group.members.map((m) => m.contractNumber).join(', ');
  return [
    group.groupCode,
    `${group.groupPlant} · ${group.supplier} · ${group.product} · ${group.incoterm}`,
    `Window ${group.windowStart} – ${group.windowEnd} · ${group.totalOsMt.toLocaleString()} MT${
      group.isPartial ? ' · partial' : ''
    }`,
    `Contracts: ${memberList}`,
  ].join('\n');
}
