/**
 * Read-only. Why do the Contract Performance cards and the view table disagree on Outstanding?
 *
 * Runs BOTH real code paths for the same filters and prints them side by side per PO:
 *   - the cards / drilldown: loadLatePerformanceRows() + the helpers aggregateLatePerformanceRows() applies
 *   - the view table: getContracts() with the params the page sends
 *
 *   node dist/scripts/diagCpOsDiscrepancy.js
 *   node dist/scripts/diagCpOsDiscrepancy.js --plant="TANJUNG PURA" --product=CPO --incoterm=FOB --from=2026-01-01
 */
import type { Response } from 'express';
import pool from '../database/connection';
import { getContracts } from '../controllers/contract.controller';
import type { AuthRequest } from '../middleware/auth';
import {
  isContractIncludedInPerfDrilldownTree,
  loadLatePerformanceRows,
  parseLatePerformanceFilters,
  resolveEffectiveDeliveryEnd,
  resolveOpenPerfOutstandingQtyKg,
} from '../services/latePerformance.service';
import { resolveContractEffectiveStatusText } from '../utils/contractDeliveryStatus';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const mt = (kg: unknown): string => {
  const n = Number(kg);
  return Number.isFinite(n) ? String(Math.round((n / 1000) * 1000) / 1000) : '-';
};

function fakeRes(): Response & { __body?: unknown } {
  const res = {
    statusCode: 200,
    status() { return res; },
    json(body: unknown) { (res as { __body?: unknown }).__body = body; return res; },
    setHeader() { return res; },
  } as unknown as Response & { __body?: unknown };
  return res;
}

async function main(): Promise<void> {
  const plant = arg('plant', 'TANJUNG PURA');
  const product = arg('product', 'CPO');
  const incoterm = arg('incoterm', 'FOB');
  const from = arg('from', `${new Date().getFullYear()}-01-01`);
  const to = arg('to', new Date().toISOString().slice(0, 10));

  const common: Record<string, string> = {
    scope: 'filtered',
    dateFrom: from,
    dateTo: to,
    plant,
    product,
    incoterms: incoterm,
    status: 'Open',
  };
  const user = { id: 'diag', role: 'ADMIN', permissions: ['*'] };

  // ---- cards / drilldown side
  const filters = parseLatePerformanceFilters({ query: { ...common }, user } as unknown as AuthRequest, 'all');
  const rows = await loadLatePerformanceRows(filters);
  const cards = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const po = String(row.po_number ?? row.contract_id ?? '');
    cards.set(po, {
      po,
      contract: row.contract_id,
      status: row.status,
      importStatus: row.import_status,
      effective: resolveContractEffectiveStatusText(row),
      os_row_mt: mt(row.outstanding_quantity),
      os_card_mt: mt(resolveOpenPerfOutstandingQtyKg(row)),
      deliveryEnd: resolveEffectiveDeliveryEnd(row)?.toISOString().slice(0, 10) ?? '(none)',
      inTree: isContractIncludedInPerfDrilldownTree(row),
      atc: row.last_ata_vessel_complete_discharge ? String(row.last_ata_vessel_complete_discharge).slice(0, 10) : '',
      stos: row.sto_count,
      allStosDischarged: row.all_stos_discharged,
    });
  }

  // ---- view table side: the params the page sends for the Open tab, drilldown FOB / CPO / plant
  const req = {
    query: {
      ...common,
      lateOnTimeFilter: 'ALL',
      excludeUnscheduled: 'false',
      requireRegionSite: 'true',
      compact: 'true',
      page: '1',
      limit: '200',
      sortKey: 'outstanding_qty_mt',
      sortDir: 'desc',
      _ts: String(Date.now()),
    },
    user,
  } as unknown as AuthRequest;
  const res = fakeRes();
  await getContracts(req, res);
  const body = res.__body as { data?: { contracts?: Array<Record<string, unknown>> } } | undefined;
  const table = body?.data?.contracts ?? [];

  console.log(`filters: ${plant} / ${product} / ${incoterm} / ${from}..${to} / Open`);
  console.log(`cards rows: ${rows.length}   table rows: ${table.length}\n`);
  console.log('PO\t\ttable_os_mt\tcard_os_mt\tcard_status\ttable_status\tdeliveryEnd\tinTree\tATC\tstos\tallDisch');
  let tableSum = 0;
  let cardSum = 0;
  for (const t of table) {
    const po = String(t.po_number ?? t.contract_id ?? '');
    const tableOs = Number(t.outstanding_quantity ?? t.outstanding_qty_mt ?? 0);
    const c = cards.get(po);
    tableSum += tableOs;
    if (c && (c.effective === 'OPEN' || c.effective === 'ACTIVE')) cardSum += Number(c.os_card_mt) * 1000;
    console.log(
      [
        po,
        mt(tableOs),
        c ? c.os_card_mt : '(not in cards rows)',
        c ? `${c.effective}${c.importStatus ? ` (gr=${c.importStatus})` : ''}` : '-',
        `${t.status ?? ''}`,
        c ? c.deliveryEnd : '-',
        c ? c.inTree : '-',
        c ? c.atc || '-' : '-',
        c ? c.stos : '-',
        c ? c.allStosDischarged : '-',
      ].join('\t'),
    );
  }
  console.log(`\ntable OS total: ${mt(tableSum)} MT    cards (effective Open) OS total: ${mt(cardSum)} MT`);
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
