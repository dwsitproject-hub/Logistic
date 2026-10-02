import { afterEach, describe, expect, it } from 'vitest';
import { jpsDocumentDownloadUrl, jpsPortIdOverride, jpsUseVesselName } from './config';
import {
  buildJpsExternalReference,
  buildJpsSubmitPayload,
  mapKlipIncotermToJpsTradeTerm,
  toJpsDateTime,
  type JpsShipmentSource,
} from './mapper';

const OPTIONS = {};

function source(overrides: Partial<JpsShipmentSource> = {}): JpsShipmentSource {
  return {
    sto_key: '1006019026',
    revision: 1,
    vessel_name: 'BG. MARINI I',
    vessel_hub_code: null,
    port_hub_code: 'PRT-BONTANG',
    eta_discharge_arrival: '2026-09-18',
    eta_discharge_complete: '2026-09-20',
    incoterm: 'FOB',
    cargo: [
      { contract_no: '1004029443', po_no: '1001029443', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 300000, contract_quantity_kg: 300000 },
    ],
    ...overrides,
  };
}

describe('cargo_type is the DataHub code of the product', () => {
  it('sends products.code_dhm as cargo_type, whatever the product is called', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({
        cargo: [
          { contract_no: 'C1', po_no: 'P1', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 1000, contract_quantity_kg: 1000 },
          { contract_no: 'C2', po_no: 'P2', product: 'SHELL PALM', product_hub_code: 'CMD-0037', sto_quantity_kg: 2000, contract_quantity_kg: 2000 },
        ],
      }),
      OPTIONS,
    );
    expect(problems).toEqual([]);
    expect(payload?.cargo.map((line) => line.cargo_type)).toEqual(['CMD-0006', 'CMD-0037']);
  });

  it('does not send the short name JPS used before DataHub', () => {
    const { payload } = buildJpsSubmitPayload(source(), OPTIONS);
    expect(payload?.cargo[0].cargo_type).toBe('CMD-0006');
    expect(payload?.cargo[0].cargo_type).not.toBe('CPO');
  });

  it('holds the STO, saying which product, when a product has no DataHub code', () => {
    for (const code of [null, undefined, '', '   ']) {
      const { payload, problems } = buildJpsSubmitPayload(
        source({ cargo: [{ contract_no: 'C1', po_no: 'P1', product: 'CPO', product_hub_code: code, sto_quantity_kg: 1000, contract_quantity_kg: 1000 }] }),
        OPTIONS,
      );
      expect(payload).toBeUndefined();
      expect(problems.join(' ')).toContain('no DHM code on Master Product for "CPO"');
    }
  });
});

describe('mapKlipIncotermToJpsTradeTerm', () => {
  it('passes the terms GET /terms actually offers', () => {
    expect(mapKlipIncotermToJpsTradeTerm('FOB')).toBe('FOB');
    expect(mapKlipIncotermToJpsTradeTerm('cif')).toBe('CIF');
  });

  // FRC (12,056 contracts) and LCO (4,018) have no JPS counterpart. trade_term is optional, so
  // omitting it is correct; substituting the nearest term would misstate the contract.
  it('omits KLIP-only incoterms', () => {
    expect(mapKlipIncotermToJpsTradeTerm('FRC')).toBeUndefined();
    expect(mapKlipIncotermToJpsTradeTerm('LCO')).toBeUndefined();
  });
});

describe('toJpsDateTime', () => {
  it('renders a KLIP date as midnight UTC', () => {
    expect(toJpsDateTime('2026-09-18')).toBe('2026-09-18T00:00:00Z');
  });

  it('is undefined for empty or unparseable input', () => {
    expect(toJpsDateTime(null)).toBeUndefined();
    expect(toJpsDateTime('not a date')).toBeUndefined();
  });

  // `pg` returns a DATE as a JS Date at LOCAL midnight. toISOString() on a UTC+7 server rolls that
  // back to 17:00 the previous day, and an ETA of 2026-09-18 left as 2026-09-17 - a day early for
  // a berth booking. Constructed the same way the driver does it.
  it('keeps the calendar day when pg hands back a local-midnight Date', () => {
    const fromDriver = new Date(2026, 8, 18, 0, 0, 0);
    expect(toJpsDateTime(fromDriver)).toBe('2026-09-18T00:00:00Z');
  });

  it('keeps the calendar day for a timestamp string', () => {
    expect(toJpsDateTime('2026-09-18T00:00:00.000+07:00')).toBe('2026-09-18T00:00:00Z');
  });
});

describe('buildJpsExternalReference', () => {
  // A rejected instruction cannot be amended - JPS requires a NEW reference - so the STO number
  // alone would be spent after one rejection.
  it('carries a revision that can be incremented', () => {
    expect(buildJpsExternalReference('1006019026', 1)).toBe('KLIP-1006019026-R1');
    expect(buildJpsExternalReference('1006019026', 3)).toBe('KLIP-1006019026-R3');
  });
});

describe('buildJpsSubmitPayload', () => {
  it('builds one instruction per STO with a cargo line per PO', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({
        cargo: [
          { contract_no: '1004029443', po_no: '1001029443', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 300000, contract_quantity_kg: 300000 },
          { contract_no: '1004030198', po_no: '1001030198', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 1000000, contract_quantity_kg: 1000000 },
        ],
      }),
      OPTIONS,
    );
    expect(problems).toEqual([]);
    expect(payload?.cargo).toHaveLength(2);
    expect(payload?.cargo[0]).toMatchObject({ cargo_type: 'CMD-0006', tonnage: 300, unit: 'MT', po_no: '1001029443' });
    expect(payload?.cargo[1].tonnage).toBe(1000);
  });

  it('always calls at BONTANG to discharge', () => {
    const { payload } = buildJpsSubmitPayload(source(), OPTIONS);
    expect(payload?.purpose).toBe('Unloading');
    expect(payload?.port_hub_code).toBe('PRT-BONTANG');
    expect(payload?.port_id).toBeUndefined();
    // No agent is named: it goes as an explicit null, not as the old fixed "Other" and not left out.
    expect(payload?.agent_name).toBeNull();
    expect(payload).toHaveProperty('agent_name', null);
  });

  // JPS rejects an unregistered shipper outright ("unknown shipper: ... Create it first"), and
  // KLIP's 57 BONTANG suppliers do not match its 25 registered names without a human mapping.
  it('never sends shipper_name', () => {
    const { payload } = buildJpsSubmitPayload(source(), OPTIONS);
    expect(payload?.cargo[0]).not.toHaveProperty('shipper_name');
  });

  it('prefers vessel_hub_code over vessel_name when DHM has supplied one', () => {
    const { payload } = buildJpsSubmitPayload(source({ vessel_hub_code: 'VSL-0001' }), OPTIONS);
    expect(payload?.vessel_hub_code).toBe('VSL-0001');
    expect(payload?.vessel_name).toBeUndefined();
  });

  it('falls back to vessel_name while dhm_code is still empty', () => {
    const { payload } = buildJpsSubmitPayload(source(), OPTIONS);
    expect(payload?.vessel_name).toBe('BG. MARINI I');
  });

  it('sends document download URLs and omits a blank one', () => {
    const { payload } = buildJpsSubmitPayload(
      source({
        contract_document_url: 'https://klip.example/api/documents/c/download',
        shipping_instruction_document_url: 'https://klip.example/api/documents/s/download',
        bl_document_url: '  ',
      }),
      OPTIONS,
    );
    expect(payload?.contract_document_url).toBe('https://klip.example/api/documents/c/download');
    expect(payload?.shipping_instruction_document_url).toBe('https://klip.example/api/documents/s/download');
    expect(payload?.bl_document_url).toBeUndefined();
  });

  it('holds the STO when Master Port has no DHM code', () => {
    const { payload, problems } = buildJpsSubmitPayload(source({ port_hub_code: null }), OPTIONS);
    expect(payload).toBeUndefined();
    expect(problems.join(' ')).toContain('no DHM code');
  });

  it('refuses to build without an ETA, which JPS requires', () => {
    const { payload, problems } = buildJpsSubmitPayload(source({ eta_discharge_arrival: null }), OPTIONS);
    expect(payload).toBeUndefined();
    expect(problems.join(' ')).toContain('ETA discharge arrival is empty');
  });

  // JPS rejects an etd that is not after eta, so a same-day discharge must simply omit it.
  it('omits etd when it does not follow eta', () => {
    const { payload } = buildJpsSubmitPayload(
      source({ eta_discharge_complete: '2026-09-18' }),
      OPTIONS,
    );
    expect(payload?.etd).toBeUndefined();
  });

  it('holds the STO rather than guessing a cargo type', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({ cargo: [{ contract_no: 'C1', po_no: 'P1', product: 'GULA', sto_quantity_kg: 1000, contract_quantity_kg: 1000 }] }),
      OPTIONS,
    );
    expect(payload).toBeUndefined();
    expect(problems.join(' ')).toContain('no DHM code on Master Product for "GULA"');
  });

  // One contract of 5,000 MT was spread over five STOs totalling 10,000 MT in production. Sending
  // that would book berth space for cargo that does not exist.
  it('drops a line whose STO quantity exceeds its own contract by more than 10%', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({ cargo: [{ contract_no: '1014002227', po_no: '1011002227', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 5000000, contract_quantity_kg: 1000000 }] }),
      OPTIONS,
    );
    expect(payload).toBeUndefined();
    expect(problems.join(' ')).toContain('exceeds contract qty');
  });

  it('accepts an STO quantity smaller than the contract, which is the normal split', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({ cargo: [{ contract_no: '1004029279', po_no: '1001029279', product: 'CPO', product_hub_code: 'CMD-0006', sto_quantity_kg: 101220, contract_quantity_kg: 400000 }] }),
      OPTIONS,
    );
    expect(problems).toEqual([]);
    expect(payload?.cargo[0].tonnage).toBe(101.22);
  });
});

describe('port id override (testing only)', () => {
  it('sends the numeric port_id and no port_hub_code when an override is given', () => {
    const { payload, problems } = buildJpsSubmitPayload(source(), { portId: 1 });
    expect(problems).toEqual([]);
    expect(payload?.port_id).toBe(1);
    expect(payload).not.toHaveProperty('port_hub_code');
  });

  it('does not hold an STO back for a missing port code while the override is on', () => {
    const { payload, problems } = buildJpsSubmitPayload(source({ port_hub_code: null }), { portId: 1 });
    expect(problems).toEqual([]);
    expect(payload?.port_id).toBe(1);
  });

  it('still sends port_hub_code, and holds a missing one, without an override', () => {
    expect(buildJpsSubmitPayload(source(), OPTIONS).payload).toMatchObject({ port_hub_code: 'PRT-BONTANG' });
    expect(buildJpsSubmitPayload(source(), OPTIONS).payload).not.toHaveProperty('port_id');
    const held = buildJpsSubmitPayload(source({ port_hub_code: null }), OPTIONS);
    expect(held.payload).toBeUndefined();
    expect(held.problems).toContain('discharge port has no DHM code on Master Port');
  });
});

describe('vessel name override (testing only)', () => {
  it('sends the vessel name and no vessel_hub_code when asked to', () => {
    const { payload, problems } = buildJpsSubmitPayload(
      source({ vessel_name: 'SMS 3002', vessel_hub_code: 'VSL-0249' }),
      { vesselNameOnly: true },
    );
    expect(problems).toEqual([]);
    expect(payload?.vessel_name).toBe('SMS 3002');
    expect(payload).not.toHaveProperty('vessel_hub_code');
  });

  it('holds an STO with no vessel name while the override is on, even if it has a code', () => {
    const held = buildJpsSubmitPayload(
      source({ vessel_name: null, vessel_hub_code: 'VSL-0249' }),
      { vesselNameOnly: true },
    );
    expect(held.payload).toBeUndefined();
    expect(held.problems).toContain('no vessel_name');
  });

  it('keeps the hub code first without the override', () => {
    const { payload } = buildJpsSubmitPayload(
      source({ vessel_name: 'SMS 3002', vessel_hub_code: 'VSL-0249' }),
      OPTIONS,
    );
    expect(payload?.vessel_hub_code).toBe('VSL-0249');
    expect(payload).not.toHaveProperty('vessel_name');
  });
});

describe('jpsUseVesselName', () => {
  const previous = process.env.JPS_USE_VESSEL_NAME;

  afterEach(() => {
    if (previous === undefined) delete process.env.JPS_USE_VESSEL_NAME;
    else process.env.JPS_USE_VESSEL_NAME = previous;
  });

  it('is on only for the word true', () => {
    delete process.env.JPS_USE_VESSEL_NAME;
    expect(jpsUseVesselName()).toBe(false);
    process.env.JPS_USE_VESSEL_NAME = 'true';
    expect(jpsUseVesselName()).toBe(true);
    process.env.JPS_USE_VESSEL_NAME = 'yes';
    expect(jpsUseVesselName()).toBe(false);
  });
});

describe('jpsPortIdOverride', () => {
  const keys = ['JPS_USE_PORT_ID', 'JPS_PORT_ID'] as const;
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of keys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  });

  it('is off unless the switch is on AND a valid id is set', () => {
    delete process.env.JPS_USE_PORT_ID;
    process.env.JPS_PORT_ID = '1';
    expect(jpsPortIdOverride()).toBeNull();

    process.env.JPS_USE_PORT_ID = 'true';
    expect(jpsPortIdOverride()).toBe(1);

    process.env.JPS_PORT_ID = 'abc';
    expect(jpsPortIdOverride()).toBeNull();
    delete process.env.JPS_PORT_ID;
    expect(jpsPortIdOverride()).toBeNull();
  });
});

describe('jpsDocumentDownloadUrl', () => {
  const previousOrigin = process.env.APP_PUBLIC_ORIGIN;
  const previousFrontend = process.env.FRONTEND_URL;

  afterEach(() => {
    if (previousOrigin === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = previousOrigin;
    if (previousFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontend;
  });

  it('builds the open download link and ignores a missing id', () => {
    process.env.APP_PUBLIC_ORIGIN = 'https://test-klip.kpndomain.com/';
    expect(jpsDocumentDownloadUrl('11111111-1111-1111-1111-111111111111')).toBe(
      'https://test-klip.kpndomain.com/api/documents/11111111-1111-1111-1111-111111111111/download',
    );
    expect(jpsDocumentDownloadUrl('  ')).toBeUndefined();
  });

  // SIT's public origin is plain http. JPS answered every instruction carrying a document link with
  // "must be a valid HTTPS URL" and refused the whole thing, so a non-https origin yields no link at all.
  it('leaves the link out when the public origin is not https', () => {
    process.env.APP_PUBLIC_ORIGIN = 'http://test-klip.kpndomain.com';
    expect(jpsDocumentDownloadUrl('11111111-1111-1111-1111-111111111111')).toBeUndefined();
  });
});
