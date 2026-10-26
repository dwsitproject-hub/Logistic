import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database/connection', () => ({ query: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./client', () => ({ jpsRequest: vi.fn() }));
vi.mock('./eligibility', () => ({ findEligibleStos: vi.fn() }));

import { buildJpsAmendBody } from './amend';
import {
  companiesForPort,
  fetchJpsPortCompanies,
  parseJpsCompanyCatalog,
  resetJpsCompanyCatalogForTests,
} from './companies';
import { jpsRequest } from './client';
import { buildJpsSubmitPayload, decideJpsCompany, type JpsShipmentSource } from './mapper';
import { describeJpsDetail } from './submit';
import type { JpsSubmitPayload } from './types';

function source(overrides: Partial<JpsShipmentSource> = {}): JpsShipmentSource {
  return {
    sto_key: '1006019026',
    revision: 1,
    vessel_name: 'BG. MARINI I',
    vessel_hub_code: 'VSL-0001',
    port_hub_code: 'PORT-0048',
    eta_discharge_arrival: '2026-09-18',
    eta_discharge_complete: '2026-09-20',
    incoterm: 'FOB',
    company_code: 'EU',
    company_hub_code: 'ORG-0001',
    cargo: [
      { contract_no: '1004029443', po_no: '1001029443', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 300000, contract_quantity_kg: 300000 },
    ],
    ...overrides,
  };
}

describe('decideJpsCompany', () => {
  it('sends nothing, and holds nothing, while the port companies are unknown', () => {
    expect(decideJpsCompany(source(), null)).toEqual({});
    expect(decideJpsCompany(source(), undefined)).toEqual({});
  });

  it('sends nothing for a port JPS maps no company to: a code would be refused', () => {
    expect(decideJpsCompany(source(), [])).toEqual({});
  });

  it('omits the code for a one-company port unless it is that company', () => {
    expect(decideJpsCompany(source(), ['ORG-0009'])).toEqual({});
    expect(decideJpsCompany(source({ company_hub_code: null }), ['ORG-0009'])).toEqual({});
    expect(decideJpsCompany(source(), ['ORG-0001'])).toEqual({ companyHubCode: 'ORG-0001' });
  });

  it('sends the code when a multi-company port lists it, whatever the case', () => {
    expect(decideJpsCompany(source({ company_hub_code: 'org-0001' }), ['ORG-0001', 'ORG-0003'])).toEqual({
      companyHubCode: 'org-0001',
    });
  });

  describe('a port with two or more companies requires one', () => {
    const ports = ['ORG-0001', 'ORG-0003'];

    it('says KLIP has no SAP Company Code', () => {
      const { companyHubCode, problem } = decideJpsCompany(source({ company_code: null, company_hub_code: null }), ports);
      expect(companyHubCode).toBeUndefined();
      expect(problem).toContain('carry no SAP Company Code');
      expect(problem).toContain('PORT-0048');
      expect(problem).toContain('ORG-0001, ORG-0003');
    });

    it('says the Master Company has no DHM code', () => {
      const { problem } = decideJpsCompany(source({ company_hub_code: null }), ports);
      expect(problem).toContain('no DHM code on Master Company for SAP Company Code "EU"');
    });

    it('says the Master Company was deleted in DHM', () => {
      const { problem } = decideJpsCompany(source({ company_hub_code: null, company_deleted: true }), ports);
      expect(problem).toContain('Master Company "EU" was deleted in DHM');
    });

    it('says the company is not one of the port\'s', () => {
      const { problem } = decideJpsCompany(source({ company_hub_code: 'ORG-0099' }), ports);
      expect(problem).toContain('Master Company "EU" (ORG-0099) is not mapped to PORT-0048 at JPS');
    });

    it('does not pick a company when the contracts disagree', () => {
      const { companyHubCode, problem } = decideJpsCompany(
        source({ company_code: null, company_hub_code: null, company_conflict: ['EO', 'EU'] }),
        ports,
      );
      expect(companyHubCode).toBeUndefined();
      expect(problem).toContain('different SAP Company Codes (EO, EU)');
    });
  });
});

describe('company_hub_code on the submit payload', () => {
  it('is left off when the port companies are unknown, as before v5.6', () => {
    const { payload, problems } = buildJpsSubmitPayload(source());
    expect(problems).toEqual([]);
    expect(payload).not.toHaveProperty('company_hub_code');
  });

  it('is sent when the port requires one and KLIP has it', () => {
    const { payload, problems } = buildJpsSubmitPayload(source(), { portCompanies: ['ORG-0001', 'ORG-0003'] });
    expect(problems).toEqual([]);
    expect(payload?.company_hub_code).toBe('ORG-0001');
  });

  it('holds the STO, saying why, when the port requires one and KLIP has none', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({ company_hub_code: null }),
      { portCompanies: ['ORG-0001', 'ORG-0003'] },
    );
    expect(payload).toBeUndefined();
    expect(problems.join(' ')).toContain('no DHM code on Master Company');
  });

  it('does not hold a one-company port for a company KLIP cannot resolve', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({ company_code: null, company_hub_code: null }),
      { portCompanies: ['ORG-0001'] },
    );
    expect(problems).toEqual([]);
    expect(payload).not.toHaveProperty('company_hub_code');
  });
});

describe('parseJpsCompanyCatalog', () => {
  it('groups the companies by port, upper-cased', () => {
    const map = parseJpsCompanyCatalog({
      referenceRows: [
        { hub_code: 'ORG-0001', port_hub_codes: ['PORT-0048', 'port-0050'] },
        { hub_code: 'org-0003', port_hub_codes: ['PORT-0048'] },
        { hub_code: 'ORG-0004', port_hub_codes: [] },
      ],
    });
    expect(map?.get('PORT-0048')).toEqual(['ORG-0001', 'ORG-0003']);
    expect(map?.get('PORT-0050')).toEqual(['ORG-0001']);
    expect(map?.has('ORG-0004')).toBe(false);
  });

  it('is null when the body is not the catalog shape', () => {
    expect(parseJpsCompanyCatalog(null)).toBeNull();
    expect(parseJpsCompanyCatalog({})).toBeNull();
    expect(parseJpsCompanyCatalog({ referenceRows: 'x' })).toBeNull();
  });
});

describe('companiesForPort', () => {
  it('is unknown without a catalog, and empty for a port the catalog does not list', () => {
    expect(companiesForPort(null, 'PORT-0048')).toBeNull();
    const map = parseJpsCompanyCatalog({ referenceRows: [{ hub_code: 'ORG-0001', port_hub_codes: ['PORT-0048'] }] });
    expect(companiesForPort(map, ' port-0048 ')).toEqual(['ORG-0001']);
    expect(companiesForPort(map, 'PORT-0099')).toEqual([]);
    expect(companiesForPort(map, null)).toEqual([]);
  });
});

describe('fetchJpsPortCompanies', () => {
  beforeEach(() => {
    resetJpsCompanyCatalogForTests();
    vi.mocked(jpsRequest).mockReset();
  });

  it('reads GET /catalog/company once and answers the next call from the cache', async () => {
    vi.mocked(jpsRequest).mockResolvedValue({
      ok: true,
      status: 200,
      data: { referenceRows: [{ hub_code: 'ORG-0001', port_hub_codes: ['PORT-0048'] }] },
    } as never);
    const first = await fetchJpsPortCompanies();
    const second = await fetchJpsPortCompanies();
    expect(first?.get('PORT-0048')).toEqual(['ORG-0001']);
    expect(second).toBe(first);
    expect(jpsRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(jpsRequest).mock.calls[0]![0]).toMatchObject({ method: 'GET', url: '/catalog/company' });
  });

  it('is null on a failure, and does not cache it', async () => {
    vi.mocked(jpsRequest).mockResolvedValue({
      ok: false,
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'boom',
      retryable: true,
    } as never);
    expect(await fetchJpsPortCompanies()).toBeNull();
    expect(await fetchJpsPortCompanies()).toBeNull();
    expect(jpsRequest).toHaveBeenCalledTimes(2);
  });
});

describe('buildJpsAmendBody with company_hub_code', () => {
  const base = (over: Partial<JpsSubmitPayload> = {}): JpsSubmitPayload => ({
    external_reference: 'KLIP-STO-1-R1',
    port_hub_code: 'PORT-0048',
    purpose: 'Unloading',
    eta: '2026-09-25T00:00:00Z',
    agent_name: null,
    cargo: [{ cargo_hub_code: 'CMD-0006', tonnage: 100, unit: 'MT', contract_no: 'C-1', po_no: 'PO-1' }],
    ...over,
  });

  it('sends a company that was not there at submit', () => {
    expect(buildJpsAmendBody(base(), base({ company_hub_code: 'ORG-0001' }))).toEqual({ company_hub_code: 'ORG-0001' });
  });

  it('sends a corrected company', () => {
    expect(buildJpsAmendBody(base({ company_hub_code: 'ORG-0001' }), base({ company_hub_code: 'ORG-0003' }))).toEqual({
      company_hub_code: 'ORG-0003',
    });
  });

  it('sends nothing when the company has not moved, or can no longer be resolved', () => {
    expect(buildJpsAmendBody(base({ company_hub_code: 'ORG-0001' }), base({ company_hub_code: 'ORG-0001' }))).toBeNull();
    expect(buildJpsAmendBody(base({ company_hub_code: 'ORG-0001' }), base())).toBeNull();
  });
});

describe('describeJpsDetail', () => {
  it('shows what JPS would have accepted next to the issue', () => {
    expect(
      describeJpsDetail({
        field: 'company_hub_code',
        issue: 'company_hub_code is required for this port',
        valid_company_hub_codes: ['ORG-0001', 'ORG-0003'],
      }),
    ).toBe('company_hub_code: company_hub_code is required for this port [valid_company_hub_codes=ORG-0001|ORG-0003]');
  });

  it('keeps the plain form when there is nothing to list', () => {
    expect(describeJpsDetail({ field: 'eta', issue: 'required' })).toBe('eta: required');
    expect(describeJpsDetail({})).toBe('?: ');
  });
});
