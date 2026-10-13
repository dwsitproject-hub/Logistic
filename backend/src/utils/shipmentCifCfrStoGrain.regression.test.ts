import { describe, expect, it } from 'vitest';
import { shipmentActiveStageRank } from './shipmentActiveStageRank';
import { contractEffectiveIncotermExpr } from './truckingIncotermScope';
import { shipmentPagePipelineSummarySelectSql } from './shipmentPagePipelineSql';
import { sqlShipmentExecutionOsPerContractCtes } from './shipmentOutstandingQtySummarySql';
import { buildShipmentSection1CombinedSummaryQuery } from './shipmentSection1CombinedSummarySql';
import {
  shipmentListSeaDisplayStoNumberExpr,
  shipmentListSeaStoKeyExpr,
  shipmentListStoKeyExpr,
} from './shipmentStoTypeSql';

/**
 * Baseline for the CIF / CFR "one PO, several STOs" change on the Shipments page.
 *
 * A CIF / CFR PO usually carries several SAP STOs of Type T (trucking legs, no vessel): in the SAP data measured on 2026-10-08, 89 of 114 CIF / CFR
 * POs that have a STO have two or more, and every one of those STOs is Type T. Today each STO is its own Shipments row. Showing them as ONE row
 * (PO once, STOs comma-separated) changes the row grain, and these tests pin what that change must not touch by accident and what it will move on
 * purpose. If one of them fails after the change, read the note on it: the failure is either the intended change (update the test and say so) or
 * the OS regression it was written to catch.
 *
 * What they cannot prove is the numbers on real data. That is docs/scripts/diag-cif-cfr-multi-sto.cjs (run it before and after) and the three
 * Shipments cards read off the page.
 */

describe('CIF / CFR rows are one per STO today', () => {
  const key = shipmentListSeaStoKeyExpr('c', 'l', 's');
  const baseKey = shipmentListStoKeyExpr('c', 'l', 's');

  it('the only incoterm that collapses several STOs of a contract into one key is FOB', () => {
    // Intended change: a CIF / CFR collapse adds a branch here. Do it in a NEW expression, not in this one - this key also feeds Oil Loss's
    // vessel rows and Shipping Performance, which must keep one row per STO.
    // the effective-incoterm sub-expression names CIF / CFR itself to classify a contract; take it out and look at what the key does with the result
    const withoutIncotermLookup = key.split(contractEffectiveIncotermExpr('c')).join('<incoterm>');
    expect(withoutIncotermLookup.match(/= 'FOB'/g)).toHaveLength(1);
    expect(withoutIncotermLookup).not.toMatch(/'CIF'|'CFR'/);
  });

  it('every other row falls through to the per-STO base key (numeric shipment_id, contract STO, effective STO, operation id)', () => {
    expect(key.replace(/\s+/g, ' ')).toContain(baseKey.replace(/\s+/g, ' '));
  });

  it('the STO shown on a row is one value, not a list', () => {
    const display = shipmentListSeaDisplayStoNumberExpr('c', 'l', 's');
    expect(display).not.toMatch(/string_agg|array_to_string/i);
  });
});

describe('Shipments OS cards are contract grain - they must stay the same when rows merge', () => {
  const os = sqlShipmentExecutionOsPerContractCtes('enriched', { requireResolvedRegionSite: true });

  it('explodes every contract of a row and keeps ONE entry per contract, at its furthest active stage', () => {
    expect(os).toContain('unnest(');
    expect(os).toContain('regexp_split_to_array');
    expect(os).toContain('DISTINCT ON (contract_number)');
    expect(os).toMatch(/ORDER BY contract_number, stage_rank DESC/);
  });

  it('takes the OS from the contract (qty_move), never from the row and never divided by the number of sibling STOs', () => {
    expect(os).not.toContain('po_sto_count');
    expect(os).not.toContain('outstanding_quantity / ');
  });

  it('the furthest-stage rule: a PO whose STOs sit at different stages is counted at the furthest one', () => {
    // A merged row must resolve its status the SAME way (furthest active stage), or the PO's OS moves to an earlier card. Resolving it the way
    // the status filter does (earliest stage, "group floor") would move OS for every PO whose sibling STOs are not in lock-step - 10 of the 89
    // multi-STO CIF / CFR POs in the SAP data already disagree on GR STO status between siblings.
    const furthest = (statuses: string[]) =>
      statuses.reduce((best, s) => (shipmentActiveStageRank(s) > shipmentActiveStageRank(best) ? s : best));
    expect(furthest(['PLANNED', 'LOADING'])).toBe('LOADING');
    expect(furthest(['PLANNED', 'SAILED', 'LOADING'])).toBe('SAILED');
    expect(furthest(['UNLOADING', 'PLANNED'])).toBe('UNLOADING');
    // a finished or cancelled sibling never outranks a live one
    expect(furthest(['COMPLETED', 'PLANNED'])).toBe('PLANNED');
    expect(furthest(['CANCELLED', 'LOADING'])).toBe('LOADING');
    // and a PO with nothing live is at no active stage, so its OS is not in any stage card
    expect(shipmentActiveStageRank('COMPLETED')).toBe(shipmentActiveStageRank('CANCELLED'));
  });
});

describe('Shipments counts are per ROW - merging rows lowers them on purpose', () => {
  it('stage counts are COUNT(*) over rows (a PO on 3 STO rows counts 3 times today, once after the merge)', () => {
    const sql = shipmentPagePipelineSummarySelectSql();
    expect(sql.match(/COUNT\(\*\) FILTER/g)).toHaveLength(13);
    expect(sql).not.toMatch(/COUNT\(DISTINCT/);
  });

  it('the card Contract Qty is summed per row, not per contract (the same 3x today)', async () => {
    const sql = await buildShipmentSection1CombinedSummaryQuery({
      shipmentBaseCteSql: 'WITH shipment_base AS (SELECT 1)',
      unplannedBacklogCountCteSql: ', unplanned_contract_backlog_table AS (SELECT 0 AS backlog_count)',
      toolbarOuterSql: '',
      summaryScopeCte: '',
      summaryEnrichedFrom: 'filtered_shipments',
    });
    for (const status of ['PLANNED', 'COMPLETED', 'CANCELLED']) {
      expect(sql).toContain(
        `SUM(COALESCE(contract_qty, 0)) FILTER (WHERE effective_status = '${status}')`,
      );
    }
    expect(sql).toMatch(/COUNT\(\*\)[^\n]*AS total_count/);
    // while the OS of the same cards comes from the contract-grain CTE
    expect(sql).toContain('execution_os');
    expect(sql).toContain('DISTINCT ON (contract_number)');
  });
});
