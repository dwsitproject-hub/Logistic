import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  sqlContractEffectivelyDoneExpr,
  sqlContractImportStatusIsClosedExpr,
  sqlContractImportStatusIsOpenExpr,
} from './contractDeliveryStatus';

const src = readFileSync(join(__dirname, '..', 'controllers', 'contract.controller.ts'), 'utf8');
const listFilter = src.slice(src.indexOf('Contract Performance only (it is the one caller'), src.indexOf('Optional: delivered=true'));

describe('Contract Performance view table: Open / Close follow the same effectively-done rule as the cards', () => {
  const done = sqlContractEffectivelyDoneExpr({ outstandingKgExpr: 'os', atcExpr: 'atc', stoCountExpr: 'n', everyStoDischargedExpr: 'all_done' });

  it('Open drops an effectively finished contract, Close takes it - cancelled stays cancelled', () => {
    expect(sqlContractImportStatusIsOpenExpr('s', undefined, done)).toContain(`AND NOT ${done}`);
    const closed = sqlContractImportStatusIsClosedExpr('s', undefined, done);
    expect(closed).toContain(done);
    expect(closed).toMatch(/AND NOT .*CANCEL/is);
  });

  it('the table filter passes the predicate to BOTH the Open and the Close branch', () => {
    expect(listFilter).toContain('cpEffectivelyDoneSql');
    expect(listFilter.match(/cpEffectivelyDoneSql,\s*\)\}`;/g)?.length).toBe(2);
  });

  it('is built from the same four inputs the cards use: OS band, ATC, STO count, every-STO-discharged', () => {
    expect(listFilter).toContain('sqlContractOutstandingSignedExpr');
    expect(listFilter).toContain('sqlLastAtaVesselCompleteDischargeForContract');
    expect(listFilter).toContain("stoCountExpr: 'base.sto_count'");
    expect(listFilter).toContain('sqlContractEveryStoDischargedExpr');
  });

  it('applies only to Contract Performance (requireRegionSite), so the Contracts page is unchanged', () => {
    expect(listFilter).toMatch(/requireRegionSite.*=== 'true'\s*\?\s*sqlContractEffectivelyDoneExpr/s);
    expect(listFilter).toContain(': undefined;');
  });
});
