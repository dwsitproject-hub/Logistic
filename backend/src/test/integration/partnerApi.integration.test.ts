import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { replaceIntegrationOverrides } from '../../integrations/integrationEnv';
import { hashSecret } from '../../integrations/secretHash';
import { createPartnerRouter } from '../../partner/routes';
import { refreshPartnerRecords } from '../../partner/refresh';

/**
 * The KMAPS partner API against a real Postgres: the records are built by the SAME Shipments page derivation the pipeline summary uses, keep their id when the
 * STO key changes, raise their version only when KMAPS-visible content changes, and are served per vessel, by DHM or SAP code, complete for the vessels asked.
 */

const P = 'ITEST-PTN';
const PUBLIC_KEY = 'kmaps_pk_integration0123';
const PRIVATE_KEY = 'kmaps_sk_integration0123456789abcdef';
const MASTER = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

const app = express();
app.use('/api/partner/v1', createPartnerRouter());

let token = '';
const get = (path: string) => request(app).get(`/api/partner/v1${path}`).set('Authorization', `Bearer ${token}`);

interface Ids {
  vesselBg: string;
  vesselTb: string;
  portLoad: string;
  portDisc: string;
  shipA: string;
  shipB: string;
  shipC: string;
  shipD: string;
  contractA: string;
}
const ids = {} as Ids;

async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  const res = await query(text, params);
  return res.rows[0] as T;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM partner_shipment_records`);
  await query(`UPDATE partner_snapshot_state SET signature = NULL, refreshed_at = NULL`);
  await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${P}-%`]);
  await query(`DELETE FROM contract_stos WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${P}-%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${P}-%`]);
  await query(`DELETE FROM vessel_pairs WHERE pair_code LIKE 'ITPTN-%'`);
  await query(`DELETE FROM master_vessel_code_aliases WHERE vessel_code LIKE 'ITPTN%'`);
  await query(`DELETE FROM master_vessels WHERE vessel_name LIKE 'IT PTN %'`);
  await query(`DELETE FROM master_loading_ports WHERE port LIKE 'IT PTN %'`);
  await query(`DELETE FROM master_plants WHERE plant_code LIKE 'ITPTN%'`);
  await query(`DELETE FROM products WHERE product_name LIKE 'IT PTN %'`);
}

async function newContract(key: string, extra: { sto?: string | null; price?: number } = {}): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm, status, transport_mode, plant_code, po_number,
                            sto_number, unit_price, currency, contract_value, contract_date)
     VALUES ($1, 'IT Buyer', 'IT Supplier', 'IT PTN CPO', 5000000, 'KG', 'CIF', 'Open', 'SEA', 'ITPTN-PLANT', $2, $3, $4, 'IDR', $5, CURRENT_DATE)
     RETURNING id`,
    [`${P}-${key}`, `${P}-PO-${key}`, extra.sto ?? null, extra.price ?? 12850000, (extra.price ?? 12850000) * 5000],
  );
  return row.id;
}

async function newShipment(contractId: string, key: string, vesselName: string, extra: Record<string, unknown> = {}): Promise<string> {
  const cols: Record<string, unknown> = {
    shipment_id: `${P}-S-${key}`,
    contract_id: contractId,
    vessel_name: vesselName,
    status: 'PLANNED',
    voyage_no: 'V-07',
    charter_type: 'T/C',
    ...extra,
  };
  const names = Object.keys(cols);
  const row = await one<{ id: string }>(
    `INSERT INTO shipments (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    names.map((n) => cols[n]),
  );
  return row.id;
}

const records = async (path: string) => (await get(path)).body.records as Array<Record<string, any>>;
const byShipmentNo = (rows: Array<Record<string, any>>, key: string) => rows.find((r) => r.shipmentNo === `${P}-S-${key}`);

beforeAll(async () => {
  process.env.INTEGRATION_SECRETS_KEY = MASTER;
  replaceIntegrationOverrides(
    new Map([
      ['KMAPS_ENABLED', 'true'],
      ['KMAPS_PUBLIC_KEY', PUBLIC_KEY],
      ['KMAPS_PRIVATE_KEY', hashSecret(PRIVATE_KEY)],
    ]),
  );
  await cleanup();

  ids.vesselBg = (await one<{ id: string }>(
    `INSERT INTO master_vessels (vessel_name, normalized_vessel_name, vessel_code, dhm_code, vessel_role) VALUES ('IT PTN BARGE ONE', 'IT PTN BARGE ONE', 'ITPTNBG1', 'VSL-9001', 'BG') RETURNING id`,
  )).id;
  ids.vesselTb = (await one<{ id: string }>(
    `INSERT INTO master_vessels (vessel_name, normalized_vessel_name, vessel_code, dhm_code, vessel_role) VALUES ('IT PTN TUG ONE', 'IT PTN TUG ONE', 'ITPTNTB1', 'VSL-9002', 'TB') RETURNING id`,
  )).id;
  await query(`INSERT INTO master_vessel_code_aliases (master_vessel_id, vessel_code, source) VALUES ($1, 'ITPTNBG1', 'manual')`, [ids.vesselBg]);
  await query(`INSERT INTO vessel_pairs (pair_code, tb_master_vessel_id, bg_master_vessel_id, last_contract_date) VALUES ('ITPTN-T01', $1, $2, '2026-10-28')`, [
    ids.vesselTb,
    ids.vesselBg,
  ]);
  ids.portLoad = (await one<{ id: string }>(`INSERT INTO master_loading_ports (port, code_dhm) VALUES ('IT PTN LOAD PORT', 'PRT-9001') RETURNING id`)).id;
  ids.portDisc = (await one<{ id: string }>(`INSERT INTO master_loading_ports (port, code_dhm) VALUES ('IT PTN DISCHARGE PORT', 'PRT-9002') RETURNING id`)).id;
  await query(`INSERT INTO master_plants (company_name, plant_code, plant_name, code_dhm) VALUES ('IT Co', 'ITPTN-PLANT', 'IT PTN PLANT', 'PLT-9001')`);
  await query(`INSERT INTO products (product_name, code_dhm) VALUES ('IT PTN CPO', 'CMD-9001')`);

  ids.contractA = await newContract('A');
  ids.shipA = await newShipment(ids.contractA, 'A', 'IT PTN BARGE ONE', {
    master_vessel_id: ids.vesselBg,
    vessel_code: 'ITPTNBG1',
    loading_master_port_id: ids.portLoad,
    discharge_master_port_id: ids.portDisc,
    eta_arrival: '2026-11-02',
    eta_discharge_arrival: '2026-11-09',
  });
  await query(
    `INSERT INTO vessel_loading_ports (shipment_id, port_name, port_sequence, master_port_id, eta_vessel_arrival, is_discharge_port)
     VALUES ($1, 'IT PTN LOAD PORT', 1, $2, '2026-11-02 10:00:00', FALSE), ($1, 'IT PTN DISCHARGE PORT', 2, $3, '2026-11-09 08:30:00', TRUE)`,
    [ids.shipA, ids.portLoad, ids.portDisc],
  );

  // B: arrived at the loading port (an ATA moves the stage), a different vessel found only by its SAP code.
  const cB = await newContract('B');
  ids.shipB = await newShipment(cB, 'B', 'IT PTN SAPONLY', { vessel_code: 'ITPTNSAP9', eta_arrival: '2026-11-03', ata_arrival: '2026-11-03' });
  // C: finished (an ATC in the past).
  const cC = await newContract('C');
  ids.shipC = await newShipment(cC, 'C', 'IT PTN BARGE ONE', {
    master_vessel_id: ids.vesselBg,
    eta_arrival: '2026-10-01',
    ata_discharge_complete: '2026-10-20',
  });
  // D: no vessel at all that KLIP can name by DHM code.
  const cD = await newContract('D');
  ids.shipD = await newShipment(cD, 'D', 'IT PTN NAMEONLY', { eta_arrival: '2026-11-04' });

  await refreshPartnerRecords({ force: true });
  const res = await request(app).post('/api/partner/v1/auth/token').send({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
  token = res.body.token;
}, 180_000);

afterAll(async () => {
  await cleanup();
  replaceIntegrationOverrides(new Map());
});

describe('the records', () => {
  it('a full read returns the active shipments only, with DHM codes, ports, legs, plant, product, price and the page stage', async () => {
    const rows = await records('/shipments');
    const a = byShipmentNo(rows, 'A');
    expect(a).toBeDefined();
    expect(byShipmentNo(rows, 'C')).toBeUndefined();
    expect(a).toMatchObject({
      deleted: false,
      active: true,
      status: 'PLANNED',
      statusLabel: 'Planned',
      voyageNo: 'V-07',
      transportMode: 'SEA',
      loadingPort: { dhmCode: 'PRT-9001', name: 'IT PTN LOAD PORT' },
      dischargePort: { dhmCode: 'PRT-9002', name: 'IT PTN DISCHARGE PORT' },
      plant: { dhmCode: 'PLT-9001', name: 'IT PTN PLANT' },
    });
    expect(a!.id).toMatch(/^shp_[a-z0-9]{10}$/);
    expect(a!.vessel).toMatchObject({ code: 'VSL-9001', sapCode: 'ITPTNBG1', role: 'BARGE', charterType: 'TC' });
    expect(a!.vessel.pair).toEqual({ code: 'VSL-9002', name: 'IT PTN TUG ONE', role: 'TUG' });
    expect(a!.schedule.loading.arrival).toEqual({ eta: '2026-11-02', ata: null });
    expect(a!.schedule.discharge.arrival).toEqual({ eta: '2026-11-09', ata: null });
    expect(a!.legs).toEqual([
      { role: 'loading', sequence: 1, port: { dhmCode: 'PRT-9001', name: 'IT PTN LOAD PORT' }, eta: '2026-11-02T10:00:00.000+07:00', ata: null },
      { role: 'discharge', sequence: 2, port: { dhmCode: 'PRT-9002', name: 'IT PTN DISCHARGE PORT' }, eta: '2026-11-09T08:30:00.000+07:00', ata: null },
    ]);
    expect(a!.lines).toHaveLength(1);
    expect(a!.lines[0]).toMatchObject({
      contractNo: `${P}-A`,
      poNumber: `${P}-PO-A`,
      product: { dhmCode: 'CMD-9001' },
      quantity: 5000,
      unit: 'MT',
      commercial: { unitPrice: 12850000, currency: 'IDR' },
    });
  });

  it('an ATA moves the stage the way the page does (an arrival at the loading port is Arrived LP)', async () => {
    const b = byShipmentNo(await records('/shipments'), 'B');
    expect(b).toMatchObject({ status: 'ARRIVED_LP', statusLabel: 'Arrived LP', active: true });
  });

  it('a vessel KLIP can only name by SAP code has vessel.code null and vessel.sapCode set', async () => {
    const b = byShipmentNo(await records('/shipments'), 'B');
    expect(b!.vessel.code).toBeNull();
    expect(b!.vessel.sapCode).toBe('ITPTNSAP9');
  });

  it('a shipment with no vessel code at all is still sent (KMAPS lists it as unmapped)', async () => {
    const d = byShipmentNo(await records('/shipments'), 'D');
    expect(d).toBeDefined();
    expect(d!.vessel.code).toBeNull();
    expect(d!.vessel.sapCode).toBeNull();
  });

  it('is complete and honest per vessel: by DHM code, by SAP code, both at once, and nothing for an unknown code', async () => {
    const byDhm = await records('/shipments?vesselCode=VSL-9001');
    expect(byDhm.map((r) => r.shipmentNo)).toEqual([`${P}-S-A`]);

    const bySap = await records('/shipments?sapCode=itptnsap9');
    expect(bySap.map((r) => r.shipmentNo)).toEqual([`${P}-S-B`]);

    const both = await records('/shipments?vesselCode=VSL-9001&sapCode=ITPTNSAP9');
    expect(both.map((r) => r.shipmentNo).sort()).toEqual([`${P}-S-A`, `${P}-S-B`]);

    const unknown = await get('/shipments?vesselCode=VSL-0000');
    expect(unknown.status).toBe(200);
    expect(unknown.body).toMatchObject({ records: [], hasMore: false, nextCursor: null });
  });

  it('a shipment already finished when first seen is in no answer: KMAPS never held it, so there is nothing to retire', async () => {
    expect((await records('/shipments?vesselCode=VSL-9001')).some((r) => r.shipmentNo === `${P}-S-C`)).toBe(false);
    expect(byShipmentNo(await records('/shipments?updatedSince=2000-01-01T00:00:00Z'), 'C')).toBeUndefined();
    const stored = await one<{ active: boolean; status: string }>(`SELECT active, status FROM partner_shipment_records WHERE payload->>'shipmentNo' = $1`, [`${P}-S-C`]);
    expect(stored).toMatchObject({ active: false, status: 'COMPLETED' });
  });

  it('more than 100 codes is a 400, and a bad limit or cursor is a 400', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `VSL-${i}`).join(',');
    expect((await get(`/shipments?vesselCode=${many}`)).status).toBe(400);
    expect((await get(`/shipments?sapCode=${many}`)).status).toBe(400);
    expect((await get('/shipments?limit=0')).status).toBe(400);
    expect((await get('/shipments?limit=501')).status).toBe(400);
    expect((await get('/shipments?cursor=garbage')).status).toBe(400);
    expect((await get('/shipments?updatedSince=yesterday')).status).toBe(400);
  });

  it('pages with a cursor to the end, once each', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const res = await get(`/shipments?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      for (const r of res.body.records) seen.push(r.id);
      if (!res.body.hasMore) {
        expect(res.body.nextCursor).toBeNull();
        break;
      }
      cursor = res.body.nextCursor;
    }
    const all = (await records('/shipments')).map((r) => r.id);
    expect(seen.sort()).toEqual(all.sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('GET /shipments/{id} serves one record and 404s an unknown id', async () => {
    const a = byShipmentNo(await records('/shipments'), 'A');
    const one = await get(`/shipments/${a!.id}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(a!.id);
    expect((await get('/shipments/shp_0000000000')).status).toBe(404);
    expect((await get('/shipments/nonsense')).status).toBe(404);
  });
});

describe('identity and version', () => {
  it('nothing changed: a forced rebuild keeps every id and version', async () => {
    const before = await records('/shipments');
    await refreshPartnerRecords({ force: true });
    const after = await records('/shipments');
    expect(after.map((r) => [r.id, r.version, r.updatedAt])).toEqual(before.map((r) => [r.id, r.version, r.updatedAt]));
  });

  it('an unchanged source is skipped without a rebuild', async () => {
    const res = await refreshPartnerRecords();
    expect(res).toMatchObject({ refreshed: false, skippedReason: 'unchanged' });
  });

  it('a change KMAPS can see raises the version by one and moves updatedAt; the id stays', async () => {
    const before = byShipmentNo(await records('/shipments'), 'A')!;
    await query(`UPDATE shipments SET eta_discharge_arrival = '2026-11-12' WHERE id = $1`, [ids.shipA]);
    const res = await refreshPartnerRecords();
    expect(res.refreshed).toBe(true);
    expect(res.changedRecordIds).toEqual([before.id]);
    const after = byShipmentNo(await records('/shipments'), 'A')!;
    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedAt > before.updatedAt).toBe(true);
    expect(after.schedule.discharge.arrival.eta).toBe('2026-11-12');
    // and the incremental read since the old updatedAt now has it
    const inc = await records(`/shipments?updatedSince=${encodeURIComponent(before.updatedAt)}`);
    expect(inc.map((r) => r.id)).toContain(before.id);
  });

  it('a change in a leg, or in the contract price, is seen too', async () => {
    const before = byShipmentNo(await records('/shipments'), 'A')!;
    await query(`UPDATE vessel_loading_ports SET eta_vessel_arrival = '2026-11-03 06:00:00' WHERE shipment_id = $1 AND port_sequence = 1`, [ids.shipA]);
    await refreshPartnerRecords();
    const mid = byShipmentNo(await records('/shipments'), 'A')!;
    expect(mid.version).toBe(before.version + 1);
    expect(mid.legs[0].eta).toBe('2026-11-03T06:00:00.000+07:00');

    await query(`UPDATE contracts SET unit_price = 13000000 WHERE id = $1`, [ids.contractA]);
    await refreshPartnerRecords();
    const after = byShipmentNo(await records('/shipments'), 'A')!;
    expect(after.version).toBe(mid.version + 1);
    expect(after.lines[0].commercial.unitPrice).toBe(13000000);
  });

  it('an ATA override (the manual ATA the page shows) moves the stage and the version', async () => {
    const before = byShipmentNo(await records('/shipments'), 'A')!;
    await query(`INSERT INTO shipment_ata_overrides (shipment_id, ata_arrival) VALUES ($1, '2026-11-05')`, [ids.shipA]);
    await refreshPartnerRecords();
    const after = byShipmentNo(await records('/shipments'), 'A')!;
    expect(after.status).toBe('ARRIVED_LP');
    expect(after.schedule.loading.arrival.ata).toBe('2026-11-05');
    expect(after.version).toBe(before.version + 1);
    // clearing the override (the row is deleted) is a change as well
    await query(`DELETE FROM shipment_ata_overrides WHERE shipment_id = $1`, [ids.shipA]);
    await refreshPartnerRecords();
    const cleared = byShipmentNo(await records('/shipments'), 'A')!;
    expect(cleared.status).toBe('PLANNED');
    expect(cleared.version).toBe(after.version + 1);
  });

  it('the record keeps its id when SAP assigns the STO number (the list key changes)', async () => {
    const before = byShipmentNo(await records('/shipments'), 'A')!;
    expect(before.stoNumber).toBeNull();
    await query(`UPDATE contracts SET sto_number = '1006099001' WHERE id = $1`, [ids.contractA]);
    await refreshPartnerRecords();
    const after = byShipmentNo(await records('/shipments'), 'A')!;
    expect(after.id).toBe(before.id);
    expect(after.stoNumber).toBe('1006099001');
    expect(after.version).toBe(before.version + 1);
    const stored = await one<{ sto_key: string }>(`SELECT sto_key FROM partner_shipment_records WHERE record_id = $1`, [before.id]);
    expect(stored.sto_key).toBe('1006099001');
  });

  it('a shipment that finishes leaves the active set once, and is never reused for another shipment', async () => {
    const before = byShipmentNo(await records('/shipments'), 'D')!;
    await query(`UPDATE shipments SET ata_discharge_complete = '2026-11-05' WHERE id = $1`, [ids.shipD]);
    await refreshPartnerRecords();
    expect(byShipmentNo(await records('/shipments'), 'D')).toBeUndefined();
    const inc = byShipmentNo(await records('/shipments?updatedSince=2000-01-01T00:00:00Z'), 'D');
    expect(inc).toMatchObject({ id: before.id, active: false, status: 'COMPLETED' });
    expect(inc!.version).toBeGreaterThan(before.version);
  });

  it('a deleted shipment becomes a tombstone with the same id, only when includeDeleted is true', async () => {
    const b = byShipmentNo(await records('/shipments'), 'B')!;
    await query(`DELETE FROM shipments WHERE id = $1`, [ids.shipB]);
    await query(`DELETE FROM contracts WHERE contract_id = $1`, [`${P}-B`]);
    await refreshPartnerRecords();
    expect((await records('/shipments?updatedSince=2000-01-01T00:00:00Z')).some((r) => r.id === b.id)).toBe(false);
    const withDeleted = await records('/shipments?updatedSince=2000-01-01T00:00:00Z&includeDeleted=true');
    const tomb = withDeleted.find((r) => r.id === b.id);
    expect(tomb).toEqual({ id: b.id, deleted: true, active: false, version: expect.any(Number), updatedAt: expect.any(String) });
    expect(tomb!.version).toBeGreaterThan(b.version);
    expect((await get(`/shipments/${b.id}`)).status).toBe(404);
    expect((await get(`/shipments/${b.id}?includeDeleted=true`)).status).toBe(200);
  });
});

describe('GET /vessel-pairs', () => {
  it('lists a pair with both DHM codes and leaves out one KLIP cannot name', async () => {
    const tbNoCode = (await one<{ id: string }>(
      `INSERT INTO master_vessels (vessel_name, normalized_vessel_name, vessel_code, vessel_role) VALUES ('IT PTN TUG NOCODE', 'IT PTN TUG NOCODE', 'ITPTNTB2', 'TB') RETURNING id`,
    )).id;
    await query(`INSERT INTO vessel_pairs (pair_code, tb_master_vessel_id, bg_master_vessel_id) VALUES ('ITPTN-T02', $1, $2)`, [tbNoCode, ids.vesselBg]);
    const res = await get('/vessel-pairs');
    expect(res.status).toBe(200);
    const mine = (res.body.records as Array<Record<string, any>>).filter((r) => String(r.pairCode).startsWith('ITPTN-'));
    expect(mine).toEqual([
      {
        pairCode: 'ITPTN-T01',
        active: true,
        barge: { dhmCode: 'VSL-9001', name: 'IT PTN BARGE ONE' },
        tug: { dhmCode: 'VSL-9002', name: 'IT PTN TUG ONE' },
        lastContractDate: '2026-10-28',
      },
    ]);
    expect(res.body).toMatchObject({ hasMore: false, nextCursor: null });
  });
});

describe('before the first build', () => {
  it('answers 503 server_error, never an empty list that would retire everything KMAPS holds', async () => {
    await query(`UPDATE partner_snapshot_state SET refreshed_at = NULL`);
    const res = await get('/shipments');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('server_error');
    await refreshPartnerRecords({ force: true });
  });
});

describe('Integrations > KMAPS settings save', () => {
  it('stores the private key only as a sealed scrypt hash, and the saved pair opens the API', async () => {
    const { saveIntegrationSettings, loadIntegrationSettings } = await import('../../integrations/settingsStore');
    const actor = await one<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
    const newPublic = 'kmaps_pk_savedthroughmenu01';
    const newPrivate = 'kmaps_sk_savedthroughmenu0123456789';
    try {
      await saveIntegrationSettings(
        'kmaps',
        { values: { KMAPS_ENABLED: 'true', KMAPS_PUBLIC_KEY: newPublic, KMAPS_PRIVATE_KEY: newPrivate } },
        { id: actor.id },
      );
      const row = await one<{ is_secret: boolean; value_plain: string | null; value_encrypted: string; secret_hint: string }>(
        `SELECT is_secret, value_plain, value_encrypted, secret_hint FROM integration_settings WHERE setting_key = 'KMAPS_PRIVATE_KEY'`,
      );
      expect(row.is_secret).toBe(true);
      expect(row.value_plain).toBeNull();
      expect(row.value_encrypted).not.toContain(newPrivate);
      expect(row.secret_hint).toMatch(/^kmaps_sk_\.\.\./);
      expect(row.secret_hint).not.toContain('savedthroughmenu01');

      const ok = await request(app).post('/api/partner/v1/auth/token').send({ publicKey: newPublic, privateKey: newPrivate });
      expect(ok.status).toBe(200);
      const wrong = await request(app).post('/api/partner/v1/auth/token').send({ publicKey: newPublic, privateKey: PRIVATE_KEY });
      expect(wrong.status).toBe(401);
      // the menu shows a hint, never the key, and never the hash
      const { describeIntegrations } = await import('../../integrations/settingsStore');
      const view = JSON.stringify(describeIntegrations());
      expect(view).not.toContain(newPrivate);
      expect(view).not.toContain('scrypt$');
    } finally {
      await query(`DELETE FROM integration_settings WHERE integration = 'kmaps'`);
      await query(`DELETE FROM audit_logs WHERE action = 'INTEGRATION_SETTINGS_UPDATE' AND entity_type = 'integration:kmaps'`);
      await loadIntegrationSettings();
      replaceIntegrationOverrides(new Map());
    }
  });
});
