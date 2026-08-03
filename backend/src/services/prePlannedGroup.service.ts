import { query } from '../database/connection';
import pool from '../database/connection';
import { getPrePlannedConfig, isPrePlannedGroupingEnabled } from '../config/prePlannedConfig';
import { buildPrePlannedEligibleContractsQuery } from '../utils/prePlannedEligibilitySql';
import {
  buildClusterBins,
  computeMergeHints,
  plantCodePrefix,
  type PrePlannedEligibleContract,
} from './prePlannedClustering.service';
import {
  loadParcelCapacityMap,
  refreshPrePlannedParcelCapacity,
} from './prePlannedParcelCapacity.service';
import { AuditService } from './audit.service';
import logger from '../utils/logger';

export interface PrePlannedGroupMemberDto {
  contractId: string;
  contractNumber: string;
  osMtAtGrouping: number;
  supplier?: string;
  buyer?: string;
  product?: string;
  deliveryStart?: string;
  deliveryEnd?: string;
}

export interface PrePlannedGroupDto {
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
  members: PrePlannedGroupMemberDto[];
}

function mapEligibleRow(row: Record<string, unknown>): PrePlannedEligibleContract {
  return {
    id: String(row.id),
    contractId: String(row.contract_id),
    groupPlant: String(row.group_plant ?? 'Blank'),
    buyer: String(row.buyer ?? ''),
    incoterm: String(row.incoterm ?? ''),
    product: String(row.product ?? ''),
    supplier: String(row.supplier ?? ''),
    supplierGroup: row.group_name ? String(row.group_name) : null,
    deliveryStart: new Date(String(row.delivery_start_date)),
    deliveryEnd: new Date(String(row.delivery_end_date)),
    osMt: Number(row.os_mt ?? 0),
  };
}

function memberSignature(members: PrePlannedEligibleContract[]): string {
  return members
    .map((m) => m.id)
    .sort()
    .join(',');
}

async function fetchEligibleContracts(): Promise<PrePlannedEligibleContract[]> {
  const cfg = getPrePlannedConfig();
  const { sql, params } = buildPrePlannedEligibleContractsQuery({
    excludedPlants: cfg.excludedPlants,
    minOsMt: cfg.minOsMt,
  });
  const res = await query(sql, params);
  return res.rows.map(mapEligibleRow);
}

async function nextGroupCode(
  groupPlant: string,
  nextSequenceByPrefix: Map<string, number>,
): Promise<string> {
  const prefix = plantCodePrefix(groupPlant);
  let seq = nextSequenceByPrefix.get(prefix);
  if (seq === undefined) {
    const pattern = `PP-${prefix}-%`;
    const res = await query(
      `
      SELECT MAX(group_code) AS max_code
      FROM pre_planned_groups
      WHERE group_code LIKE $1
      `,
      [pattern],
    );
    const maxCode = res.rows[0]?.max_code;
    seq = 1;
    if (maxCode) {
      const parts = maxCode.split('-');
      const last = Number(parts[parts.length - 1]);
      if (Number.isFinite(last)) seq = last + 1;
    }
  }
  nextSequenceByPrefix.set(prefix, seq + 1);
  return `PP-${prefix}-${String(seq).padStart(3, '0')}`;
}

async function loadSuggestedGroupsWithMembers(): Promise<
  Array<{ id: string; groupCode: string; memberIds: string[] }>
> {
  const res = await query(
    `
    SELECT pg.id, pg.group_code, pgm.contract_id::text
    FROM pre_planned_groups pg
    INNER JOIN pre_planned_group_members pgm ON pgm.group_id = pg.id AND pgm.released_at IS NULL
    WHERE pg.status = 'SUGGESTED'
    ORDER BY pg.group_code
    `,
  );
  const byGroup = new Map<string, { id: string; groupCode: string; memberIds: string[] }>();
  for (const row of res.rows as Array<{ id: string; group_code: string; contract_id: string }>) {
    const g = byGroup.get(row.id) ?? { id: row.id, groupCode: row.group_code, memberIds: [] };
    g.memberIds.push(row.contract_id);
    byGroup.set(row.id, g);
  }
  return [...byGroup.values()];
}

export async function rebuildPrePlannedGroups(triggeredBy: string): Promise<{
  groupsCreated: number;
  groupsSuperseded: number;
  contractsGrouped: number;
  durationMs: number;
}> {
  if (!isPrePlannedGroupingEnabled()) {
    return { groupsCreated: 0, groupsSuperseded: 0, contractsGrouped: 0, durationMs: 0 };
  }

  const start = Date.now();
  const cfg = getPrePlannedConfig();
  await refreshPrePlannedParcelCapacity();
  const parcelMap = await loadParcelCapacityMap();
  const eligible = await fetchEligibleContracts();
  const bins = buildClusterBins(eligible, parcelMap);
  const mergeHintIdx = computeMergeHints(bins, cfg.tier2GapDays);

  const existing = await loadSuggestedGroupsWithMembers();
  const existingBySig = new Map<string, { id: string; groupCode: string }>();
  for (const g of existing) {
    existingBySig.set(
      [...g.memberIds].sort().join(','),
      { id: g.id, groupCode: g.groupCode },
    );
  }

  const client = await pool.connect();
  let groupsCreated = 0;
  let groupsSuperseded = 0;
  let contractsGrouped = 0;

  try {
    await client.query('BEGIN');

    const newSignatures = new Set<string>();
    const insertedGroupIds: string[] = [];
    const nextSequenceByPrefix = new Map<string, number>();

    // Rebuild active SUGGESTED membership atomically. This releases the partial
    // unique index before changed groups are inserted; stable groups are restored below.
    await client.query(`
      UPDATE pre_planned_group_members pgm
      SET released_at = now()
      FROM pre_planned_groups pg
      WHERE pgm.group_id = pg.id
        AND pg.status = 'SUGGESTED'
        AND pgm.released_at IS NULL
    `);
    await client.query(`
      UPDATE pre_planned_groups
      SET merge_hint_ids = '{}', updated_at = now()
      WHERE status = 'SUGGESTED'
    `);

    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i]!;
      const sig = memberSignature(bin.members);
      newSignatures.add(sig);
      contractsGrouped += bin.members.length;

      const stable = existingBySig.get(sig);
      let groupId: string;
      let groupCode: string;

      if (stable) {
        groupId = stable.id;
        groupCode = stable.groupCode;
        await client.query(
          `
          UPDATE pre_planned_groups SET
            partition_key = $2,
            group_plant = $3,
            buyer = $4,
            incoterm = $5,
            product = $6,
            supplier = $7,
            supplier_group = $8,
            window_start = $9,
            window_end = $10,
            bin_capacity_mt = $11,
            total_os_mt = $12,
            is_partial = $13,
            updated_at = now()
          WHERE id = $1
          `,
          [
            groupId,
            bin.partitionKey,
            bin.groupPlant,
            bin.buyer,
            bin.incoterm,
            bin.product,
            bin.supplier,
            bin.supplierGroup,
            bin.windowStart,
            bin.windowEnd,
            bin.binCapacityMt,
            bin.totalOsMt,
            bin.isPartial,
          ],
        );
      } else {
        groupCode = await nextGroupCode(bin.groupPlant, nextSequenceByPrefix);
        const ins = await client.query(
          `
          INSERT INTO pre_planned_groups (
            group_code, partition_key, group_plant, buyer, incoterm, product,
            supplier, supplier_group, window_start, window_end,
            bin_capacity_mt, total_os_mt, is_partial, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'SUGGESTED')
          RETURNING id
          `,
          [
            groupCode,
            bin.partitionKey,
            bin.groupPlant,
            bin.buyer,
            bin.incoterm,
            bin.product,
            bin.supplier,
            bin.supplierGroup,
            bin.windowStart,
            bin.windowEnd,
            bin.binCapacityMt,
            bin.totalOsMt,
            bin.isPartial,
          ],
        );
        groupId = ins.rows[0]!.id;
        groupsCreated += 1;

      }

      for (const m of bin.members) {
        await client.query(
          `
          INSERT INTO pre_planned_group_members (group_id, contract_id, contract_number, os_mt_at_grouping)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (group_id, contract_id) DO UPDATE SET
            contract_number = EXCLUDED.contract_number,
            os_mt_at_grouping = EXCLUDED.os_mt_at_grouping,
            released_at = NULL
          `,
          [groupId, m.id, m.contractId, m.osMt],
        );
      }

      insertedGroupIds.push(groupId);
    }

    // Apply merge hints after all groups inserted (map bin index → group id)
    for (let i = 0; i < bins.length; i++) {
      const hintIdxs = mergeHintIdx.get(i) ?? [];
      if (hintIdxs.length === 0 || !insertedGroupIds[i]) continue;
      const hintIds = hintIdxs.map((j) => insertedGroupIds[j]).filter(Boolean);
      if (hintIds.length > 0) {
        await client.query(
          `UPDATE pre_planned_groups SET merge_hint_ids = $2::uuid[], updated_at = now() WHERE id = $1`,
          [insertedGroupIds[i], hintIds],
        );
      }
    }

    // Supersede stale SUGGESTED groups whose membership changed
    for (const g of existing) {
      const sig = [...g.memberIds].sort().join(',');
      if (!newSignatures.has(sig)) {
        await client.query(
          `UPDATE pre_planned_groups SET status = 'SUPERSEDED', updated_at = now() WHERE id = $1`,
          [g.id],
        );
        await client.query(
          `UPDATE pre_planned_group_members SET released_at = now() WHERE group_id = $1 AND released_at IS NULL`,
          [g.id],
        );
        groupsSuperseded += 1;
      }
    }

    const durationMs = Date.now() - start;
    await client.query(
      `
      INSERT INTO pre_planned_rebuild_log (triggered_by, groups_created, groups_superseded, contracts_grouped, duration_ms)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [triggeredBy, groupsCreated, groupsSuperseded, contractsGrouped, durationMs],
    );

    await client.query('COMMIT');

    logger.info('Pre-planned groups rebuilt', {
      triggeredBy,
      groupsCreated,
      groupsSuperseded,
      contractsGrouped,
      durationMs,
    });

    return { groupsCreated, groupsSuperseded, contractsGrouped, durationMs };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listPrePlannedGroups(filters: {
  plant?: string;
  status?: string;
}): Promise<{ groups: PrePlannedGroupDto[]; ungroupedContractCount: number }> {
  const params: unknown[] = [];
  let where = `WHERE pg.status = $1`;
  params.push(filters.status?.trim() || 'SUGGESTED');
  let idx = 2;
  if (filters.plant?.trim()) {
    where += ` AND pg.group_plant = $${idx++}`;
    params.push(filters.plant.trim());
  }

  const res = await query(
    `
    SELECT
      pg.id,
      pg.group_code,
      pg.partition_key,
      pg.group_plant,
      pg.buyer,
      pg.incoterm,
      pg.product,
      pg.supplier,
      pg.supplier_group,
      pg.window_start,
      pg.window_end,
      pg.bin_capacity_mt,
      pg.total_os_mt,
      pg.est_vessels,
      pg.is_partial,
      pg.merge_hint_ids,
      pg.status,
      pg.shipment_id,
      pgm.contract_id,
      pgm.contract_number,
      pgm.os_mt_at_grouping,
      c.supplier AS member_supplier,
      c.buyer AS member_buyer,
      c.product AS member_product,
      c.delivery_start_date,
      c.delivery_end_date
    FROM pre_planned_groups pg
    LEFT JOIN pre_planned_group_members pgm ON pgm.group_id = pg.id AND pgm.released_at IS NULL
    LEFT JOIN contracts c ON c.id = pgm.contract_id
    ${where}
    ORDER BY pg.group_plant, pg.window_start, pg.group_code, pgm.contract_number
    `,
    params,
  );

  const groupMap = new Map<string, PrePlannedGroupDto>();
  for (const row of res.rows) {
    const id = String(row.id);
    let g = groupMap.get(id);
    if (!g) {
      g = {
        id,
        groupCode: String(row.group_code),
        partitionKey: String(row.partition_key),
        groupPlant: String(row.group_plant),
        buyer: String(row.buyer),
        incoterm: String(row.incoterm),
        product: String(row.product),
        supplier: String(row.supplier),
        supplierGroup: row.supplier_group ? String(row.supplier_group) : null,
        windowStart: String(row.window_start).slice(0, 10),
        windowEnd: String(row.window_end).slice(0, 10),
        binCapacityMt: Number(row.bin_capacity_mt),
        totalOsMt: Number(row.total_os_mt),
        estVessels: Number(row.est_vessels ?? 1),
        isPartial: Boolean(row.is_partial),
        mergeHintGroupIds: Array.isArray(row.merge_hint_ids)
          ? (row.merge_hint_ids as string[])
          : [],
        status: String(row.status),
        shipmentId: row.shipment_id ? String(row.shipment_id) : null,
        members: [],
      };
      groupMap.set(id, g);
    }
    if (row.contract_id) {
      g.members.push({
        contractId: String(row.contract_id),
        contractNumber: String(row.contract_number),
        osMtAtGrouping: Number(row.os_mt_at_grouping),
        supplier: row.member_supplier ? String(row.member_supplier) : undefined,
        buyer: row.member_buyer ? String(row.member_buyer) : undefined,
        product: row.member_product ? String(row.member_product) : undefined,
        deliveryStart: row.delivery_start_date
          ? String(row.delivery_start_date).slice(0, 10)
          : undefined,
        deliveryEnd: row.delivery_end_date
          ? String(row.delivery_end_date).slice(0, 10)
          : undefined,
      });
    }
  }

  const eligible = await fetchEligibleContracts();
  const groupedIds = new Set<string>();
  for (const g of groupMap.values()) {
    for (const m of g.members) groupedIds.add(m.contractId);
  }
  const ungroupedContractCount = eligible.filter((c) => !groupedIds.has(c.id)).length;

  return { groups: [...groupMap.values()], ungroupedContractCount };
}

export async function dismissPrePlannedGroup(
  groupId: string,
  reason: string | undefined,
  userId: string | undefined,
): Promise<void> {
  await query(
    `
    UPDATE pre_planned_groups
    SET status = 'DISMISSED', dismissed_reason = $2, updated_at = now()
    WHERE id = $1 AND status = 'SUGGESTED'
    `,
    [groupId, reason ?? null],
  );
  await query(
    `
    UPDATE pre_planned_group_members SET released_at = now()
    WHERE group_id = $1 AND released_at IS NULL
    `,
    [groupId],
  );
  await AuditService.log({
    userId: userId ?? '00000000-0000-0000-0000-000000000000',
    action: 'PRE_PLANNED_DISMISS',
    entityType: 'PRE_PLANNED_GROUP',
    entityId: groupId,
    afterData: { reason },
  });
}

/**
 * Accept a suggested group. When `shipmentId` is omitted, the group becomes
 * ACCEPTED with `shipment_id` left NULL — this is the "Preplanned" state
 * (contracts are marked accepted but have no real shipment yet). Passing
 * `shipmentId` links the group to a real shipment (used when a shipment is
 * created directly from the suggestion, or later for a preplanned group).
 */
export async function acceptPrePlannedGroupLink(
  groupId: string,
  shipmentId: string | undefined,
  userId: string | undefined,
): Promise<void> {
  await query(
    `
    UPDATE pre_planned_groups
    SET status = 'ACCEPTED', shipment_id = COALESCE($2, shipment_id), updated_at = now()
    WHERE id = $1
    `,
    [groupId, shipmentId ?? null],
  );
  await AuditService.log({
    userId: userId ?? '00000000-0000-0000-0000-000000000000',
    action: 'PRE_PLANNED_ACCEPT',
    entityType: 'PRE_PLANNED_GROUP',
    entityId: groupId,
    afterData: { shipmentId: shipmentId ?? null },
  });
}

/**
 * Revert a Preplanned group (ACCEPTED, no shipment yet) back to SUGGESTED so
 * it reappears as a Grouping Suggestion. Not allowed once a real shipment has
 * been linked.
 */
export async function revertPrePlannedGroupToSuggested(
  groupId: string,
  userId: string | undefined,
): Promise<void> {
  const res = await query(
    `
    UPDATE pre_planned_groups
    SET status = 'SUGGESTED', updated_at = now()
    WHERE id = $1 AND status = 'ACCEPTED' AND shipment_id IS NULL
    RETURNING id
    `,
    [groupId],
  );
  if (res.rows.length === 0) {
    throw new Error('Group is not a revertible Preplanned suggestion');
  }
  await AuditService.log({
    userId: userId ?? '00000000-0000-0000-0000-000000000000',
    action: 'PRE_PLANNED_REVERT',
    entityType: 'PRE_PLANNED_GROUP',
    entityId: groupId,
    afterData: {},
  });
}

/**
 * Auto-detect and link any Preplanned (ACCEPTED, shipment_id NULL) groups
 * that contain the given contracts to the newly created shipment. Runs
 * regardless of whether the frontend explicitly passed a prePlannedGroupId,
 * so any UI path that creates a shipment for a preplanned contract completes
 * the Preplanned -> Planned transition.
 */
export async function linkAcceptedPrePlannedGroupsForContracts(
  contractIds: string[],
  shipmentId: string,
  userId: string | undefined,
): Promise<void> {
  if (contractIds.length === 0) return;
  const res = await query(
    `
    SELECT DISTINCT pg.id
    FROM pre_planned_groups pg
    INNER JOIN pre_planned_group_members pgm ON pgm.group_id = pg.id
    WHERE pg.status = 'ACCEPTED'
      AND pg.shipment_id IS NULL
      AND pgm.released_at IS NULL
      AND pgm.contract_id = ANY($1::uuid[])
    `,
    [contractIds],
  );
  for (const row of res.rows as Array<{ id: string }>) {
    await acceptPrePlannedGroupLink(row.id, shipmentId, userId);
  }
}

export async function releaseContractsFromPrePlanned(contractIds: string[]): Promise<void> {
  if (contractIds.length === 0) return;
  await query(
    `
    UPDATE pre_planned_group_members pgm
    SET released_at = now()
    FROM pre_planned_groups pg
    WHERE pgm.group_id = pg.id
      AND pg.status = 'SUGGESTED'
      AND pgm.contract_id = ANY($1::uuid[])
      AND pgm.released_at IS NULL
    `,
    [contractIds],
  );
  await query(
    `
    UPDATE pre_planned_groups pg
    SET status = 'SUPERSEDED', updated_at = now()
    WHERE pg.status = 'SUGGESTED'
      AND NOT EXISTS (
        SELECT 1 FROM pre_planned_group_members pgm
        WHERE pgm.group_id = pg.id AND pgm.released_at IS NULL
      )
    `,
  );
}

export async function getPrePlannedGroupById(groupId: string): Promise<PrePlannedGroupDto | null> {
  const res = await query(
    `
    SELECT
      pg.id,
      pg.group_code,
      pg.partition_key,
      pg.group_plant,
      pg.buyer,
      pg.incoterm,
      pg.product,
      pg.supplier,
      pg.supplier_group,
      pg.window_start,
      pg.window_end,
      pg.bin_capacity_mt,
      pg.total_os_mt,
      pg.est_vessels,
      pg.is_partial,
      pg.merge_hint_ids,
      pg.status,
      pg.shipment_id,
      pgm.contract_id,
      pgm.contract_number,
      pgm.os_mt_at_grouping,
      c.delivery_start_date,
      c.delivery_end_date
    FROM pre_planned_groups pg
    LEFT JOIN pre_planned_group_members pgm ON pgm.group_id = pg.id AND pgm.released_at IS NULL
    LEFT JOIN contracts c ON c.id = pgm.contract_id
    WHERE pg.id = $1
    ORDER BY pgm.contract_number
    `,
    [groupId],
  );
  if (res.rows.length === 0) return null;

  let group: PrePlannedGroupDto | null = null;
  for (const row of res.rows) {
    if (!group) {
      group = {
        id: String(row.id),
        groupCode: String(row.group_code),
        partitionKey: String(row.partition_key),
        groupPlant: String(row.group_plant),
        buyer: String(row.buyer),
        incoterm: String(row.incoterm),
        product: String(row.product),
        supplier: String(row.supplier),
        supplierGroup: row.supplier_group ? String(row.supplier_group) : null,
        windowStart: String(row.window_start).slice(0, 10),
        windowEnd: String(row.window_end).slice(0, 10),
        binCapacityMt: Number(row.bin_capacity_mt),
        totalOsMt: Number(row.total_os_mt),
        estVessels: Number(row.est_vessels ?? 1),
        isPartial: Boolean(row.is_partial),
        mergeHintGroupIds: Array.isArray(row.merge_hint_ids)
          ? (row.merge_hint_ids as string[])
          : [],
        status: String(row.status),
        shipmentId: row.shipment_id ? String(row.shipment_id) : null,
        members: [],
      };
    }
    if (row.contract_id && group) {
      group.members.push({
        contractId: String(row.contract_id),
        contractNumber: String(row.contract_number),
        osMtAtGrouping: Number(row.os_mt_at_grouping),
        deliveryStart: row.delivery_start_date
          ? String(row.delivery_start_date).slice(0, 10)
          : undefined,
        deliveryEnd: row.delivery_end_date
          ? String(row.delivery_end_date).slice(0, 10)
          : undefined,
      });
    }
  }
  return group;
}

export async function getPrePlannedMetrics(): Promise<{
  suggestedCount: number;
  acceptedCount: number;
  dismissedCount: number;
  lastRebuild: Record<string, unknown> | null;
}> {
  const counts = await query(
    `SELECT status, COUNT(*)::text AS cnt FROM pre_planned_groups GROUP BY status`,
  );
  const byStatus = Object.fromEntries(counts.rows.map((r: { status: string; cnt: string }) => [r.status, Number(r.cnt)]));
  const last = await query(
    `SELECT * FROM pre_planned_rebuild_log ORDER BY created_at DESC LIMIT 1`,
  );
  return {
    suggestedCount: byStatus.SUGGESTED ?? 0,
    acceptedCount: byStatus.ACCEPTED ?? 0,
    dismissedCount: byStatus.DISMISSED ?? 0,
    lastRebuild: last.rows[0] ?? null,
  };
}

export async function schedulePrePlannedRebuildIfEnabled(triggeredBy: string): Promise<void> {
  if (!isPrePlannedGroupingEnabled()) return;
  setImmediate(() => {
    rebuildPrePlannedGroups(triggeredBy).catch((err) => {
      logger.error('Pre-planned rebuild failed', { triggeredBy, err });
    });
  });
}
