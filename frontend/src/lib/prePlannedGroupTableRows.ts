import type { PrePlannedGroup } from '@/lib/prePlannedGroups';
import { resolvePrePlannedGroupForRow } from '@/lib/prePlannedGroupTableSpans';
import {
  resolveShipmentListDeliveredKg,
  resolveShipmentListReceiveKg,
  shipmentListOutstandingKgForViewTable,
  shipmentStoredQtyKg,
} from '@/lib/shipmentQuantityUnits';
import { formatQtyMtFromKg } from '@/lib/utils';

export type PrePlannedGroupAggregationMode = 'single' | 'stackDistinct' | 'sumKg';

export interface PrePlannedTableGroupMember {
  id: string;
  contract_number?: string | null;
  contract_numbers?: string | null;
  contract_row_id?: string | null;
  pre_planned_group_id?: string | null;
  po_numbers?: string | null;
  contract_date?: string | null;
  contract_ext_no?: string | null;
  delivery_start_date?: string | null;
  delivery_end_date?: string | null;
  contract_qty?: number | null;
  quantity_delivered?: number | null;
  quantity_delivered_klip?: number | null;
  quantity_delivered_sap?: number | null;
  total_quantity_delivered?: number | null;
  quantity_receive?: number | null;
  actual_vessel_qty_receive?: number | null;
  outstanding_quantity?: number | null;
  incoterm?: string | null;
  is_contract_sap_closed?: boolean | null;
}

export interface PrePlannedTableGroup<T extends PrePlannedTableGroupMember = PrePlannedTableGroupMember> {
  groupKey: string;
  group?: PrePlannedGroup;
  members: T[];
}

const SUM_KG_COLUMN_IDS = new Set([
  'contract_qty',
  'quantity_delivered',
  'quantity_receive',
  'outstanding_quantity',
]);

const STACK_DISTINCT_COLUMN_IDS = new Set([
  'contract_numbers',
  'contract_number',
  'po_numbers',
  'contract_date',
  'contract_ext_no',
  'delivery_start_date',
  'delivery_end_date',
  'delivery_start',
  'delivery_end',
]);

export function prePlannedGroupColumnAggregationMode(colId: string): PrePlannedGroupAggregationMode {
  if (SUM_KG_COLUMN_IDS.has(colId)) return 'sumKg';
  if (STACK_DISTINCT_COLUMN_IDS.has(colId)) return 'stackDistinct';
  return 'single';
}

function stableMemberSort<T extends PrePlannedTableGroupMember>(a: T, b: T): number {
  const dateCmp = String(a.contract_date ?? '').localeCompare(String(b.contract_date ?? ''));
  if (dateCmp !== 0) return dateCmp;
  return String(a.contract_number ?? a.contract_numbers ?? a.id).localeCompare(
    String(b.contract_number ?? b.contract_numbers ?? b.id),
  );
}

/** Preserve first-seen group order from the sorted list. */
export function groupShipmentsByPrePlannedSuggestion<
  T extends PrePlannedTableGroupMember,
>(
  rows: readonly T[],
  acceptedGroupLookup: Map<string, PrePlannedGroup>,
): PrePlannedTableGroup<T>[] {
  const groups: PrePlannedTableGroup<T>[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    const accepted = resolvePrePlannedGroupForRow(row, acceptedGroupLookup);
    const groupKey =
      String(row.pre_planned_group_id ?? '').trim() ||
      accepted?.id ||
      `singleton:${String(row.id ?? '').trim()}`;

    const existing = indexByKey.get(groupKey);
    if (existing !== undefined) {
      groups[existing].members.push(row);
      continue;
    }

    indexByKey.set(groupKey, groups.length);
    groups.push({
      groupKey,
      group: accepted,
      members: [row],
    });
  }

  for (const group of groups) {
    group.members.sort(stableMemberSort);
  }

  return groups;
}

export function collectDistinctFormattedValues<T extends PrePlannedTableGroupMember>(
  members: readonly T[],
  pick: (row: T) => string | null | undefined,
  format?: (value: string) => string,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const member of members) {
    const raw = String(pick(member) ?? '').trim();
    if (!raw) continue;
    const formatted = format ? format(raw) : raw;
    const key = formatted.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(formatted);
  }

  return lines;
}

export function sumGroupQtyKg<T extends PrePlannedTableGroupMember>(
  members: readonly T[],
  pick: (row: T) => number | null | undefined,
): number | null {
  if (members.length === 0) return null;

  let hasAny = false;
  let total = 0;

  for (const member of members) {
    const kg = pick(member);
    if (kg == null || Number.isNaN(kg)) continue;
    hasAny = true;
    total += kg;
  }

  return hasAny ? total : null;
}

export function sumGroupQtyKgForColumn<T extends PrePlannedTableGroupMember>(
  members: readonly T[],
  colId: string,
): number | null {
  switch (colId) {
    case 'contract_qty':
      return sumGroupQtyKg(members, (m) => shipmentStoredQtyKg(m.contract_qty));
    case 'quantity_delivered':
      return sumGroupQtyKg(members, (m) => resolveShipmentListDeliveredKg(m));
    case 'quantity_receive':
      return sumGroupQtyKg(members, (m) => resolveShipmentListReceiveKg(m));
    case 'outstanding_quantity':
      return sumGroupQtyKg(members, (m) => shipmentListOutstandingKgForViewTable(m));
    default:
      return null;
  }
}

export function formatPrePlannedGroupQtyMt(
  kg: number | null,
  opts?: { maxFractionDigits?: number },
): string {
  return formatQtyMtFromKg(kg, opts);
}

export function getPrePlannedGroupRepresentativeMember<T extends PrePlannedTableGroupMember>(
  group: PrePlannedTableGroup<T>,
): T {
  return group.members[0];
}

export function getPrePlannedGroupSortValue<T extends PrePlannedTableGroupMember>(
  group: PrePlannedTableGroup<T>,
  colId: string,
  getColumnRawValue: (row: T, columnId: string) => string | number | null,
): string | number {
  const mode = prePlannedGroupColumnAggregationMode(colId);

  if (mode === 'sumKg') {
    return sumGroupQtyKgForColumn(group.members, colId) ?? 0;
  }

  if (mode === 'stackDistinct') {
    const values = collectDistinctFormattedValues(group.members, (m) => {
      const raw = getColumnRawValue(m, colId);
      if (raw == null) return '';
      return String(raw);
    });
    return values[0] ?? '';
  }

  if (colId === 'pre_planned_group') {
    return group.group?.groupCode ?? '';
  }

  const rep = getPrePlannedGroupRepresentativeMember(group);
  const raw = getColumnRawValue(rep, colId);
  if (typeof raw === 'number') return raw;
  return String(raw ?? '');
}
