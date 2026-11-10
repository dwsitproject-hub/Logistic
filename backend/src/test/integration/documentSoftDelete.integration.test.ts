import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { query } from '../../database/connection';
import {
  deleteShipmentDocument,
  downloadDocument,
  listDocuments,
  viewDocument,
} from '../../controllers/document.controller';
import { getShipmentActivityLog } from '../../controllers/shipment.controller';
import { hasKlipShipmentActivity } from '../../utils/klipLogisticsActivity';

/**
 * Edit Shipment: delete an uploaded Contract / SI / BL. A soft delete against a real Postgres: the row stays (who, when, why), the file stays on the share, every read
 * path stops showing it, and the shipment's Activity History says what happened.
 */

const P = 'ITEST-DOC';
let actorId = '';
const ids = { contract: '', shipment: '', otherShipment: '' };

interface Captured {
  status: number;
  body: any;
}

function fakeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { status: 200, body: null };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    download() {
      captured.status = 200;
      captured.body = 'FILE';
      return this;
    },
    sendFile() {
      captured.status = 200;
      captured.body = 'FILE';
      return this;
    },
    setHeader() {
      return this;
    },
    removeHeader() {
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

async function call(handler: (req: any, res: Response) => unknown, req: Record<string, unknown>): Promise<Captured> {
  const { res, captured } = fakeRes();
  await handler({ params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', get: () => 'vitest', ...req } as Request, res);
  return captured;
}

async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  return (await query(text, params)).rows[0] as T;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM jps_shipping_instructions WHERE sto_key LIKE $1`, [`OP-${P}%`]);
  await query(`DELETE FROM audit_logs WHERE entity_type = 'DOCUMENT' AND (before_data->>'file_name') LIKE $1`, [`${P}%`]);
  await query(`DELETE FROM documents WHERE file_name LIKE $1`, [`${P}%`]);
  await query(`DELETE FROM shipments WHERE shipment_id LIKE $1`, [`MNL-${P}%`]);
  await query(`DELETE FROM contracts WHERE contract_id LIKE $1`, [`${P}-%`]);
}

async function doc(type: string, name: string, shipmentId: string | null = ids.shipment): Promise<string> {
  return (
    await one<{ id: string }>(
      `INSERT INTO documents (document_type, file_name, file_path, shipment_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [type, `${P}-${name}`, `documents/shipment/${name}`, shipmentId],
    )
  ).id;
}

const listed = async (shipmentId: string) => (await call(listDocuments, { query: { shipmentId } })).body.data as Array<{ id: string }>;
const del = (id: string, body: Record<string, unknown>) => call(deleteShipmentDocument, { params: { id }, body, user: { id: actorId } });

beforeAll(async () => {
  await cleanup();
  actorId = (await one<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).id;
  ids.contract = (
    await one<{ id: string }>(
      `INSERT INTO contracts (contract_id, buyer, supplier, product, quantity_ordered, unit, incoterm, status, transport_mode, po_number, contract_date)
       VALUES ($1, 'b', 's', 'CPO', 1000, 'KG', 'CIF', 'Open', 'SEA', $2, CURRENT_DATE) RETURNING id`,
      [`${P}-C`, `${P}-PO`],
    )
  ).id;
  ids.shipment = (
    await one<{ id: string }>(
      `INSERT INTO shipments (shipment_id, operation_id, contract_id, vessel_name, status) VALUES ($1, $2, $3, 'IT DOC VESSEL', 'PLANNED') RETURNING id`,
      [`MNL-${P}-1`, `OP-${P}-1`, ids.contract],
    )
  ).id;
  ids.otherShipment = (
    await one<{ id: string }>(
      `INSERT INTO shipments (shipment_id, operation_id, contract_id, vessel_name, status) VALUES ($1, $2, $3, 'IT DOC VESSEL 2', 'PLANNED') RETURNING id`,
      [`MNL-${P}-2`, `OP-${P}-2`, ids.contract],
    )
  ).id;
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe('delete a shipment document (soft)', () => {
  it('hides it from the list, the download and the view, keeps the row and records who, when and why; the file is not touched', async () => {
    const id = await doc('BL', 'bl-1.pdf');
    const keep = await doc('BL', 'bl-2.pdf');
    expect((await listed(ids.shipment)).map((d) => d.id)).toContain(id);

    const res = await del(id, { reason: 'Wrong file uploaded' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { id } });

    const ids2 = (await listed(ids.shipment)).map((d) => d.id);
    expect(ids2).not.toContain(id);
    expect(ids2).toContain(keep); // the other BL is untouched

    expect((await call(downloadDocument, { params: { id } })).status).toBe(404);
    expect((await call(viewDocument, { params: { id } })).status).toBe(404);

    const row = await one<{ deleted_at: string | null; deleted_by: string | null; deleted_reason: string | null; file_path: string }>(
      `SELECT deleted_at, deleted_by, deleted_reason, file_path FROM documents WHERE id = $1::uuid`,
      [id],
    );
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_by).toBe(actorId);
    expect(row.deleted_reason).toBe('Wrong file uploaded');
    expect(row.file_path).toBe('documents/shipment/bl-1.pdf'); // the stored path is unchanged: the file is still where it was
  });

  it('works for Contract and SI as well, and refuses SLD, SDD and a document that is not on a shipment', async () => {
    expect((await del(await doc('CONTRACT', 'c.pdf'), { reason: 'x' })).status).toBe(200);
    expect((await del(await doc('SI', 's.pdf'), { reason: 'x' })).status).toBe(200);
    const sld = await del(await doc('SLD', 'sld.pdf'), { reason: 'x' });
    expect(sld.status).toBe(403);
    const loose = await del(await doc('BL', 'loose.pdf', null), { reason: 'x' });
    expect(loose.status).toBe(403);
  });

  it('needs a reason, a valid id, and an existing (not already deleted) document', async () => {
    const id = await doc('SI', 'si-reason.pdf');
    expect((await del(id, {})).status).toBe(400);
    expect((await del(id, { reason: '   ' })).status).toBe(400);
    expect((await del(id, { reason: 'y'.repeat(501) })).status).toBe(400);
    expect((await del('not-a-uuid', { reason: 'x' })).status).toBe(404);
    expect((await del('00000000-0000-0000-0000-000000000000', { reason: 'x' })).status).toBe(404);
    expect((await listed(ids.shipment)).map((d) => d.id)).toContain(id); // nothing was deleted by the refusals
    expect((await del(id, { reason: 'now' })).status).toBe(200);
    expect((await del(id, { reason: 'again' })).status).toBe(404); // already deleted
  });

  it('asks first when the operation was sent to JPS, and deletes once confirmed', async () => {
    const id = await doc('CONTRACT', 'jps.pdf', ids.otherShipment);
    await query(
      `INSERT INTO jps_shipping_instructions (sto_key, external_reference, state, jps_id, jps_status, submitted_at) VALUES ($1, $2, 'SUBMITTED', 4711, 'Pending', now())`,
      [`OP-${P}-2`, `${P}-EXT`],
    );
    const first = await del(id, { reason: 'wrong' });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('SENT_TO_JPS');
    expect((await listed(ids.otherShipment)).map((d) => d.id)).toContain(id);
    const second = await del(id, { reason: 'wrong', confirmJps: true });
    expect(second.status).toBe(200);
    expect((await listed(ids.otherShipment)).map((d) => d.id)).not.toContain(id);
    const audit = await one<{ after_data: { sentToJps: boolean } }>(`SELECT after_data FROM audit_logs WHERE action = 'DELETE' AND entity_id = $1::uuid`, [id]);
    expect(audit.after_data.sentToJps).toBe(true);
  });

  it('a deleted document no longer counts as KLIP activity on the shipment (the SAP import protection)', async () => {
    const s = (
      await one<{ id: string }>(
        `INSERT INTO shipments (shipment_id, contract_id, vessel_name, status) VALUES ($1, $2, 'v', 'PLANNED') RETURNING id`,
        [`MNL-${P}-3`, ids.contract],
      )
    ).id;
    const id = await doc('BL', 'activity.pdf', s);
    expect(await hasKlipShipmentActivity(s)).toBe(true);
    await del(id, { reason: 'x' });
    expect(await hasKlipShipmentActivity(s)).toBe(false);
  });

  it("the shipment's Activity History lists the upload and the delete, with the file and the reason", async () => {
    const id = await doc('BL', 'history.pdf');
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, after_data) VALUES ($1, 'CREATE', 'DOCUMENT', $2::uuid, $3::jsonb)`,
      [actorId, id, JSON.stringify({ id, file_name: `${P}-history.pdf`, document_type: 'BL' })],
    );
    await del(id, { reason: 'Superseded by the final BL' });

    const history = await call(getShipmentActivityLog, { params: { shipmentId: ids.shipment } });
    expect(history.status).toBe(200);
    const rows = (history.body.data as Array<{ action: string; entity_type: string; entity_id: string; before_data: any; after_data: any }>).filter(
      (r) => r.entity_type === 'DOCUMENT' && r.entity_id === id,
    );
    expect(rows.map((r) => r.action).sort()).toEqual(['CREATE', 'DELETE']);
    const deleted = rows.find((r) => r.action === 'DELETE')!;
    expect(deleted.before_data).toMatchObject({ file_name: `${P}-history.pdf`, document_type: 'BL' });
    expect(deleted.after_data).toMatchObject({ reason: 'Superseded by the final BL' });
  });
});
