import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../database/connection';
import { replaceIntegrationOverrides } from '../../integrations/integrationEnv';
import { hashSecret } from '../../integrations/secretHash';
import { refreshPartnerRecords } from '../../partner/refresh';
import { listDeliveries, resendDeliveries, sendDueDeliveries } from '../../partner/deliveries';
import { signKmapsWebhook } from '../../partner/webhook';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

/**
 * The bells to KMAPS against a real Postgres and a real local HTTP server standing in for KMAPS: what is queued for which change, what is sent (and what is
 * not), the signature as KMAPS would verify it, the retry schedule, the FAILED state and Resend.
 */

const P = 'ITEST-WHK';
const PRIVATE_KEY = 'kmaps_sk_webhooktest0123456789abcdef';
const SECRET = 'whsec_integration_0123456789';
const MASTER = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

let server: Server;
let url = '';
let answer = 200;
const received: Array<{ headers: Record<string, string | string[] | undefined>; raw: string }> = [];
const ids = { vessel: '', shipA: '', shipD: '', contractD: '' };

async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  return (await query(text, params)).rows[0] as T;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM kmaps_webhook_deliveries`);
  await query(`DELETE FROM partner_shipment_records`);
  await query(`UPDATE partner_snapshot_state SET signature = NULL, refreshed_at = NULL`);
  await query(`DELETE FROM shipments WHERE contract_id IN (SELECT id FROM contracts WHERE contract_id LIKE $1)`, [`${P}-%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${P}-%`]);
  await query(`DELETE FROM master_vessels WHERE vessel_name LIKE 'IT WHK %'`);
}

const withWebhook = (extra: Record<string, string> = {}) =>
  replaceIntegrationOverrides(
    new Map(
      Object.entries({
        KMAPS_ENABLED: 'true',
        KMAPS_PUBLIC_KEY: 'kmaps_pk_whk',
        KMAPS_PRIVATE_KEY: hashSecret(PRIVATE_KEY),
        KMAPS_WEBHOOK_URL: url,
        KMAPS_WEBHOOK_SECRET: SECRET,
        ...extra,
      }),
    ),
  );

async function newShipment(key: string, name: string, extra: Record<string, unknown> = {}): Promise<{ shipment: string; contract: string }> {
  const contract = (
    await one<{ id: string }>(
      `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm, status, transport_mode, po_number, unit_price, currency, contract_value, contract_date)
       VALUES ($1, 'IT Buyer', 'IT Supplier', 'IT WHK CPO', 5000000, 'KG', 'CIF', 'Open', 'SEA', $2, 12850000, 'IDR', 64250000000, CURRENT_DATE) RETURNING id`,
      [`${P}-${key}`, `${P}-PO-${key}`],
    )
  ).id;
  const cols: Record<string, unknown> = { shipment_id: `${P}-S-${key}`, contract_id: contract, vessel_name: name, status: 'PLANNED', eta_arrival: '2026-11-02', ...extra };
  const names = Object.keys(cols);
  const shipment = (
    await one<{ id: string }>(`INSERT INTO shipments (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, names.map((n) => cols[n]))
  ).id;
  return { shipment, contract };
}

beforeAll(async () => {
  process.env.INTEGRATION_SECRETS_KEY = MASTER;
  const http = await import('http');
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, raw: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(answer, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: answer === 200 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/webhooks/klip`;

  await cleanup();
  ids.vessel = (
    await one<{ id: string }>(
      `INSERT INTO master_vessels (vessel_name, normalized_vessel_name, vessel_code, dhm_code, vessel_role) VALUES ('IT WHK BARGE', 'IT WHK BARGE', 'ITWHKBG1', 'VSL-9101', 'BG') RETURNING id`,
    )
  ).id;
  ids.shipA = (await newShipment('A', 'IT WHK BARGE', { master_vessel_id: ids.vessel })).shipment;
  const d = await newShipment('D', 'IT WHK OTHER', { eta_arrival: '2026-11-04' });
  ids.shipD = d.shipment;
  ids.contractD = d.contract;
  withWebhook();
  await refreshPartnerRecords({ force: true });
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
  replaceIntegrationOverrides(new Map());
});

describe('bells to KMAPS', () => {
  it('a change queues one bell with no data and no price; the signature verifies the way KMAPS verifies it; the delivery is marked delivered', async () => {
    withWebhook();
    await query(`DELETE FROM kmaps_webhook_deliveries`);
    received.length = 0;
    answer = 200;

    await query(`UPDATE shipments SET eta_discharge_arrival = '2026-11-20' WHERE id = $1`, [ids.shipA]);
    const res = await refreshPartnerRecords();
    expect(res.bellsQueued).toBe(1);

    expect(await sendDueDeliveries()).toEqual({ delivered: 1, failed: 0 });
    expect(received).toHaveLength(1);
    const { headers, raw } = received[0];
    const body = JSON.parse(raw);
    expect(Object.keys(body)).toEqual(['event', 'eventId', 'deliveryId', 'occurredAt', 'entityType', 'recordId', 'version', 'vesselCode']);
    expect(body).toMatchObject({ event: 'shipment.updated', entityType: 'shipment', vesselCode: 'VSL-9101' });
    expect(raw).not.toMatch(/price|quantity|unitPrice|commercial|supplier/i);
    expect(headers['x-klip-event']).toBe('shipment.updated');
    expect(headers['x-klip-delivery-id']).toBe(body.deliveryId);
    expect(headers['x-klip-signature']).toBe(`sha256=${signKmapsWebhook(SECRET, String(headers['x-klip-timestamp']), raw)}`);
    const row = await one<{ status: string; attempts: number }>(`SELECT status, attempts FROM kmaps_webhook_deliveries WHERE delivery_id = $1::uuid`, [body.deliveryId]);
    expect(row).toMatchObject({ status: 'DELIVERED', attempts: 1 });
  });

  it('a status change rings both updated and status_changed; a delete rings deleted', async () => {
    withWebhook();
    await query(`DELETE FROM kmaps_webhook_deliveries`);
    await query(`INSERT INTO shipment_ata_overrides (shipment_id, ata_arrival) VALUES ($1, '2026-11-06')`, [ids.shipA]);
    await refreshPartnerRecords();
    const events = (await query(`SELECT event FROM kmaps_webhook_deliveries ORDER BY event`)).rows.map((r: { event: string }) => r.event);
    expect(events).toEqual(['shipment.status_changed', 'shipment.updated']);
    await query(`DELETE FROM shipment_ata_overrides WHERE shipment_id = $1`, [ids.shipA]);
    await refreshPartnerRecords();

    await query(`DELETE FROM kmaps_webhook_deliveries`);
    await query(`DELETE FROM shipments WHERE id = $1`, [ids.shipD]);
    await query(`DELETE FROM contracts WHERE id = $1`, [ids.contractD]);
    await refreshPartnerRecords();
    expect((await query(`SELECT event FROM kmaps_webhook_deliveries`)).rows.map((r: { event: string }) => r.event)).toEqual(['shipment.deleted']);
  });

  it('bursts are coalesced: a pending bell for the same record is updated, not doubled', async () => {
    withWebhook();
    await query(`DELETE FROM kmaps_webhook_deliveries`);
    await query(`UPDATE shipments SET eta_discharge_arrival = '2026-11-21' WHERE id = $1`, [ids.shipA]);
    await refreshPartnerRecords();
    await query(`UPDATE shipments SET eta_discharge_arrival = '2026-11-22' WHERE id = $1`, [ids.shipA]);
    await refreshPartnerRecords();
    const rows = (await query(`SELECT event, version::int AS version FROM kmaps_webhook_deliveries WHERE event = 'shipment.updated'`)).rows;
    expect(rows).toHaveLength(1);
    const stored = await one<{ version: string }>(`SELECT version::text FROM partner_shipment_records WHERE payload->>'shipmentNo' = $1`, [`${P}-S-A`]);
    expect(rows[0].version).toBe(Number(stored.version));
  });

  it('with no webhook configured nothing is queued, so no backlog builds up while it is off', async () => {
    replaceIntegrationOverrides(new Map([['KMAPS_ENABLED', 'true'], ['KMAPS_PUBLIC_KEY', 'kmaps_pk_whk'], ['KMAPS_PRIVATE_KEY', hashSecret(PRIVATE_KEY)]]));
    await query(`DELETE FROM kmaps_webhook_deliveries`);
    await query(`UPDATE shipments SET eta_discharge_arrival = '2026-11-23' WHERE id = $1`, [ids.shipA]);
    const res = await refreshPartnerRecords();
    expect(res.bellsQueued).toBe(0);
    expect((await query(`SELECT COUNT(*)::int AS n FROM kmaps_webhook_deliveries`)).rows[0].n).toBe(0);
  });

  it('a failing KMAPS is retried with the SAME delivery id on the contract schedule, then waits as FAILED; Resend brings it back', async () => {
    withWebhook();
    await query(`DELETE FROM kmaps_webhook_deliveries`);
    received.length = 0;
    answer = 500;
    await query(`UPDATE shipments SET eta_discharge_arrival = '2026-11-24' WHERE id = $1`, [ids.shipA]);
    await refreshPartnerRecords();
    const first = await one<{ delivery_id: string }>(`SELECT delivery_id::text FROM kmaps_webhook_deliveries`);

    const delays: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await query(`UPDATE kmaps_webhook_deliveries SET next_attempt_at = NOW() WHERE status = 'PENDING'`);
      await sendDueDeliveries();
      const row = await one<{ status: string; attempts: number; secs: number | null }>(
        `SELECT status, attempts, EXTRACT(EPOCH FROM (next_attempt_at - NOW()))::int AS secs FROM kmaps_webhook_deliveries WHERE delivery_id = $1::uuid`,
        [first.delivery_id],
      );
      expect(row.attempts).toBe(attempt);
      if (row.status === 'PENDING') delays.push(row.secs as number);
    }
    const expected = [30, 120, 600, 3600, 21600];
    expect(delays).toHaveLength(5);
    delays.forEach((d, i) => expect(Math.abs(d - expected[i])).toBeLessThanOrEqual(3));
    expect((await one<{ status: string }>(`SELECT status FROM kmaps_webhook_deliveries WHERE delivery_id = $1::uuid`, [first.delivery_id])).status).toBe('FAILED');
    expect(new Set(received.map((r) => JSON.parse(r.raw).deliveryId)).size).toBe(1);

    expect((await listDeliveries('FAILED')).counts.FAILED).toBe(1);
    answer = 200;
    expect(await resendDeliveries(null)).toBe(1);
    await sendDueDeliveries();
    expect((await one<{ status: string }>(`SELECT status FROM kmaps_webhook_deliveries WHERE delivery_id = $1::uuid`, [first.delivery_id])).status).toBe('DELIVERED');
  });

  it('an unreachable KMAPS is a failed attempt, not a crash, and the error text holds no secret', async () => {
    withWebhook({ KMAPS_WEBHOOK_URL: 'http://127.0.0.1:1/api/v1/webhooks/klip' });
    await query(`DELETE FROM kmaps_webhook_deliveries`);
    await query(`UPDATE shipments SET eta_discharge_arrival = '2026-11-25' WHERE id = $1`, [ids.shipA]);
    await refreshPartnerRecords();
    const sent = await sendDueDeliveries();
    expect(sent.failed).toBe(1);
    const row = await one<{ status: string; last_error: string | null }>(`SELECT status, last_error FROM kmaps_webhook_deliveries`);
    expect(row.status).toBe('PENDING');
    expect(String(row.last_error)).not.toContain(SECRET);
  });
});
