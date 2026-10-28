import { describe, expect, it, vi } from 'vitest';
import { applyCompanyCodeRepair, planCompanyCodeRepair, rollbackSql, type CompanyRow } from './companyCodeRepair';

const row = (over: Partial<CompanyRow> & Pick<CompanyRow, 'id' | 'company_code'>): CompanyRow => ({
  company_name: over.company_code,
  code_dhm: null,
  code_klip: null,
  dhm_is_deleted: false,
  sap: null,
  ...over,
});

// the shape SIT had on 2026-10-28
const legacyPm = row({ id: 'L-PM', company_code: 'PM', company_name: 'PMC GENERAL HO JAKARTA', code_dhm: 'ORG-0016', code_klip: 'KCMP-0028' });
const legalPmc = row({ id: 'N-PMC', company_code: 'PMC', company_name: 'PT Prima Makmur Cakrawala', code_dhm: 'ORG-0006', code_klip: 'KCMP-0057', sap: 'PM' });
const legacySc = row({ id: 'L-SC', company_code: 'SC', company_name: 'SPC GENERAL HO JAKARTA', code_dhm: 'ORG-0038' });
const legalSpc = row({ id: 'N-SPC', company_code: 'SPC', company_name: 'PT Sumber Pangan Cemerlang', code_dhm: 'ORG-0010', sap: 'SC' });
const legacyEo = row({ id: 'L-EO', company_code: 'EO', company_name: 'PT. ENERGI OLEO PERSADA', code_dhm: 'ORG-0028' });
const legalEop = row({ id: 'N-EOP', company_code: 'EOP', company_name: 'PT. ENERGI OLEO PERSADA', code_dhm: 'ORG-0003' }); // DHM has no company_code_sap yet

describe('planCompanyCodeRepair: the SAP code goes to the organisation DHM says owns it', () => {
  it('releases the legacy row to its own DHM code, then gives the organisation the SAP code (PM -> ORG-0006)', () => {
    const plan = planCompanyCodeRepair([legacyPm, legalPmc]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.steps).toEqual([
      { id: 'L-PM', name: 'PMC GENERAL HO JAKARTA', from: 'PM', to: 'ORG-0016', why: 'release legacy row' },
      { id: 'N-PMC', name: 'PT Prima Makmur Cakrawala', from: 'PMC', to: 'PM', why: 'take SAP code' },
    ]);
  });

  it('the release always comes BEFORE the take (company_code is unique)', () => {
    const { steps } = planCompanyCodeRepair([legalPmc, legacyPm, legalSpc, legacySc]);
    for (const code of ['PM', 'SC']) {
      const release = steps.findIndex((s) => s.from === code && s.why === 'release legacy row');
      const take = steps.findIndex((s) => s.to === code && s.why === 'take SAP code');
      expect(release).toBeGreaterThanOrEqual(0);
      expect(release).toBeLessThan(take);
    }
  });

  it('an organisation DHM has not given a company_code_sap (EOP) and its legacy row (EO) are left alone', () => {
    const plan = planCompanyCodeRepair([legacyEo, legalEop]);
    expect(plan.steps).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('a row that already holds its SAP code needs nothing, and a free SAP code is simply taken', () => {
    const right = row({ id: 'R', company_code: 'XX', code_dhm: 'ORG-0099', sap: 'XX' });
    const free = row({ id: 'F', company_code: 'NEWSHORT', code_dhm: 'ORG-0098', sap: 'NW' });
    const plan = planCompanyCodeRepair([right, free]);
    expect(plan.alreadyRight).toEqual(['XX']);
    expect(plan.steps).toEqual([{ id: 'F', name: 'NEWSHORT', from: 'NEWSHORT', to: 'NW', why: 'take SAP code' }]);
  });

  it('is case- and space-insensitive, like the unique index', () => {
    const plan = planCompanyCodeRepair([row({ id: 'L', company_code: ' pm ', code_dhm: 'ORG-0016' }), row({ id: 'N', company_code: 'PMC', code_dhm: 'ORG-0006', sap: 'Pm' })]);
    expect(plan.steps.map((s) => [s.id, s.to])).toEqual([['L', 'ORG-0016'], ['N', 'PM']]);
  });

  it('two organisations claiming one SAP code is DHM\'s to settle: neither is moved', () => {
    const a = row({ id: 'A', company_code: 'AA', code_dhm: 'ORG-0001', sap: 'ZZ' });
    const b = row({ id: 'B', company_code: 'BB', code_dhm: 'ORG-0002', sap: 'ZZ' });
    const plan = planCompanyCodeRepair([a, b]);
    expect(plan.steps).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].reason).toContain('ORG-0001 and ORG-0002 both claim SAP code ZZ');
  });

  it('an organisation deleted in DHM, or one without a DHM code, claims nothing', () => {
    const gone = row({ id: 'G', company_code: 'GG', code_dhm: 'ORG-0003', sap: 'QQ', dhm_is_deleted: true });
    const local = row({ id: 'K', company_code: 'KK', code_dhm: null, sap: 'WW' });
    expect(planCompanyCodeRepair([gone, local]).steps).toEqual([]);
  });

  it('a manual KLIP row holding the code (no DHM code) is released to its KLIP code, or reported when it has none', () => {
    const manual = row({ id: 'M', company_code: 'PM', company_name: 'manual', code_dhm: null, code_klip: 'KCMP-0999' });
    expect(planCompanyCodeRepair([manual, legalPmc]).steps[0]).toMatchObject({ id: 'M', to: 'KCMP-0999' });
    const bare = row({ id: 'B', company_code: 'PM', company_name: 'bare', code_dhm: null, code_klip: null });
    const plan = planCompanyCodeRepair([bare, legalPmc]);
    expect(plan.steps).toEqual([]);
    expect(plan.conflicts[0].reason).toContain('neither a DHM code nor a KLIP code');
  });

  it('a release that would land on a code another row already holds is reported, not forced', () => {
    const squatter = row({ id: 'S', company_code: 'ORG-0016', code_dhm: 'ORG-0555' });
    const plan = planCompanyCodeRepair([legacyPm, legalPmc, squatter]);
    expect(plan.steps).toEqual([]);
    expect(plan.conflicts[0].reason).toContain('already holds');
  });
});

describe('rollbackSql and applyCompanyCodeRepair', () => {
  const { steps } = planCompanyCodeRepair([legacyPm, legalPmc]);

  it('the rollback undoes the steps in reverse, and each only fires on the value the repair set', () => {
    const sql = rollbackSql(steps);
    expect(sql).toEqual([
      "UPDATE master_companies SET company_code = 'PMC', updated_at = CURRENT_TIMESTAMP WHERE id = 'N-PMC' AND company_code = 'PM';",
      "UPDATE master_companies SET company_code = 'PM', updated_at = CURRENT_TIMESTAMP WHERE id = 'L-PM' AND company_code = 'ORG-0016';",
    ]);
  });

  it('runs the steps in one transaction, in order, each guarded by the value the plan saw', async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const client = { query: vi.fn(async (text: string, params?: unknown[]) => (calls.push([text, params]), { rows: [], rowCount: 1 })) };
    await applyCompanyCodeRepair(client, steps);
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[1][1]).toEqual(['L-PM', 'ORG-0016', 'PM']);
    expect(calls[2][1]).toEqual(['N-PMC', 'PM', 'PMC']);
    expect(calls[3][0]).toBe('COMMIT');
  });

  it('a row that is not as it was planned rolls EVERYTHING back', async () => {
    const calls: string[] = [];
    let n = 0;
    const client = {
      query: vi.fn(async (text: string) => {
        calls.push(text);
        if (text.startsWith('UPDATE')) return { rows: [], rowCount: ++n === 2 ? 0 : 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    await expect(applyCompanyCodeRepair(client, steps)).rejects.toThrow('not as it was planned');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });
});
