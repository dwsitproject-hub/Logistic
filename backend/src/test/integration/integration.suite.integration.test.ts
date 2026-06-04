import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../server';
import { query } from '../../database/connection';
import { seedIntegrationFixtures, type IntegrationFixtureIds } from './seedFixtures';

let fx: IntegrationFixtureIds;

async function login(username: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password }).expect(200);
  return res.body.data.token as string;
}

beforeAll(async () => {
  fx = await seedIntegrationFixtures();
});

describe('Integration: fixtures + getContracts (Postgres)', () => {

  it('lists ITEST contracts via API and search filters server-side', async () => {
    const token = await login('admin', 'admin123');
    const all = await request(app)
      .get('/api/contracts?limit=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ids = (all.body.data.contracts as { contract_id: string }[]).map((c) => c.contract_id);
    expect(ids).toContain('ITEST-A');
    expect(ids).toContain('ITEST-B');

    const filtered = await request(app)
      .get('/api/contracts?limit=100&search=IT-Supplier-Unique')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const rows = filtered.body.data.contracts as { contract_id: string }[];
    expect(rows.every((r) => r.contract_id === 'ITEST-A')).toBe(true);
    expect(Number(filtered.body.data.pagination.total)).toBeGreaterThanOrEqual(1);
  });

  it('outstanding quantity matches contract qty minus summed STO (500 delivered)', async () => {
    const token = await login('admin', 'admin123');
    const res = await request(app)
      .get('/api/contracts?limit=100&contract_id=ITEST-A')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = (res.body.data.contracts as { outstanding_quantity: string | number }[])[0];
    expect(Number(row.outstanding_quantity)).toBe(500);
  });
});

describe('Integration: dashboard stats vs raw SQL', () => {
  it('contracts.total matches COUNT DISTINCT contract_id', async () => {
    const token = await login('management', 'management123');
    const api = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const raw = await query(`SELECT COUNT(DISTINCT contract_id)::int AS n FROM contracts`);
    expect(api.body.data.contracts.total).toBe(Number(raw.rows[0].n));
  });

  it('totalQuantity matches SUM(quantity_ordered) over contracts', async () => {
    const token = await login('admin', 'admin123');
    const api = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const raw = await query(`SELECT COALESCE(SUM(quantity_ordered), 0)::numeric AS q FROM contracts`);
    expect(Number(api.body.data.contracts.totalQuantity)).toBeCloseTo(Number(raw.rows[0].q), 5);
  });
});

describe('Integration: finance summary vs duplicate SQL', () => {
  it('finance summary totals match controller SQL', async () => {
    const token = await login('finance', 'finance123');
    const api = await request(app)
      .get('/api/finance/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const computedCte = `
      WITH computed AS (
        SELECT
          COALESCE(NULLIF(p.payment_amount, 0), c.contract_value, (c.quantity_ordered * c.unit_price), p.payment_amount) AS payment_amount,
          COALESCE(mv.due_date_payment, p.payment_due_date) AS due_date_payment,
          mv.dp_date,
          mv.payoff_date,
          (CASE
            WHEN mv.dp_date IS NOT NULL AND mv.payoff_date IS NOT NULL THEN 'PAID'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) <= CURRENT_DATE AND mv.dp_date IS NOT NULL THEN 'PARTIAL'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) <= CURRENT_DATE AND mv.dp_date IS NULL THEN 'PENDING'
            WHEN mv.payoff_date IS NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) IS NOT NULL AND COALESCE(mv.due_date_payment, p.payment_due_date) > CURRENT_DATE THEN 'OVERDUE'
            ELSE UPPER(COALESCE(p.payment_status, 'PENDING'))
          END) AS payment_status
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id
        LEFT JOIN mv_contract_payment_dates mv ON mv.contract_id = c.contract_id
      )
    `;
    const totalsRes = await query(
      `${computedCte}
       SELECT
         COUNT(*) AS total_records,
         COALESCE(SUM(payment_amount), 0) AS total_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PENDING'), 0) AS pending_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PARTIAL'), 0) AS partial_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'PAID'), 0) AS paid_amount,
         COALESCE(SUM(payment_amount) FILTER (WHERE payment_status = 'OVERDUE'), 0) AS overdue_amount
       FROM computed`
    );
    const row = totalsRes.rows[0];
    const t = api.body.data.totals;
    expect(t.totalRecords).toBe(Number(row.total_records));
    expect(Number(t.totalAmount)).toBeCloseTo(Number(row.total_amount), 4);
    expect(Number(t.pendingAmount)).toBeCloseTo(Number(row.pending_amount), 4);
    expect(Number(t.partialAmount)).toBeCloseTo(Number(row.partial_amount), 4);
    expect(Number(t.paidAmount)).toBeCloseTo(Number(row.paid_amount), 4);
    expect(Number(t.overdueAmount)).toBeCloseTo(Number(row.overdue_amount), 4);
  });

  it('getPayments returns seeded invoice and pagination', async () => {
    const token = await login('finance', 'finance123');
    const res = await request(app)
      .get('/api/finance/payments?search=INV-ITEST')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    const hit = (res.body.data as { invoice_number: string }[]).find((r) => r.invoice_number === 'INV-ITEST-1');
    expect(hit).toBeTruthy();
  });
});

describe('Integration: role-permission matrix (sample of routes)', () => {
  let adminT: string;
  let tradingT: string;
  let financeT: string;

  beforeAll(async () => {
    adminT = await login('admin', 'admin123');
    tradingT = await login('trading', 'trading123');
    financeT = await login('finance', 'finance123');
  });

  it('GET /api/users ADMIN ok, TRADING forbidden', async () => {
    await request(app).get('/api/users').set('Authorization', `Bearer ${adminT}`).expect(200);
    await request(app).get('/api/users').set('Authorization', `Bearer ${tradingT}`).expect(403);
  });

  it('GET /api/finance/summary TRADING ok', async () => {
    await request(app).get('/api/finance/summary').set('Authorization', `Bearer ${tradingT}`).expect(200);
  });

  it('GET /api/finance/payments/:id FINANCE only (TRADING 403)', async () => {
    await request(app)
      .get(`/api/finance/payments/${fx.paymentId}`)
      .set('Authorization', `Bearer ${financeT}`)
      .expect(200);
    await request(app)
      .get(`/api/finance/payments/${fx.paymentId}`)
      .set('Authorization', `Bearer ${tradingT}`)
      .expect(403);
  });

  it('GET /api/audit requires ADMIN or SUPPORT', async () => {
    const logisticsT = await login('logistics', 'logistics123');
    await request(app).get('/api/audit').set('Authorization', `Bearer ${adminT}`).expect(200);
    await request(app).get('/api/audit').set('Authorization', `Bearer ${logisticsT}`).expect(403);
  });
});

describe('Integration: document upload validation and optional ClamAV', () => {
  let adminT: string;

  beforeAll(async () => {
    adminT = await login('admin', 'admin123');
  });

  it('rejects unsupported MIME type (400)', async () => {
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${adminT}`)
      .field('contract_id', fx.contractAId)
      .field('document_type', 'OTHER')
      .attach('file', Buffer.from('MZ fake exe'), { filename: 'x.exe', contentType: 'application/x-msdownload' })
      .expect(400);
  });

  it('accepts minimal PDF when ClamAV not configured', async () => {
    const prev = process.env.CLAMD_HOST;
    delete process.env.CLAMD_HOST;
    delete process.env.CLAMAV_HOST;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const res = await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${adminT}`)
      .field('contract_id', fx.contractAId)
      .field('document_type', 'OTHER')
      .attach('file', pdf, { filename: 't.pdf', contentType: 'application/pdf' })
      .expect(200);
    expect(res.body.success).toBe(true);
    if (prev) process.env.CLAMD_HOST = prev;
  });

  it('returns 503 when ClamAV is configured but unreachable', async () => {
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = '1';
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${adminT}`)
      .field('contract_id', fx.contractAId)
      .field('document_type', 'OTHER')
      .attach('file', pdf, { filename: 't2.pdf', contentType: 'application/pdf' })
      .expect(503);
    delete process.env.CLAMD_HOST;
  });
});

describe('Integration: EICAR blocked when ClamAV is up', () => {
  it.skipIf(!process.env.CLAMD_HOST)('rejects EICAR test string as infected', async () => {
    const adminT = await login('admin', 'admin123');
    const eicar =
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const pdfWrapped = Buffer.from(
      `%PDF-1.4\n${eicar}\ntrailer<<>>\n%%EOF`,
      'utf8'
    );
    await request(app)
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${adminT}`)
      .field('contract_id', fx.contractAId)
      .field('document_type', 'OTHER')
      .attach('file', pdfWrapped, { filename: 'eicar.pdf', contentType: 'application/pdf' })
      .expect(400);
  });
});
