import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './server';

describe('API smoke (no database required for these paths)', () => {
  it('GET /health returns OK (positive)', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('OK');
  });

  it('GET /api/health returns OK (positive)', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('OK');
  });

  it('GET /api/contracts without token returns 401 (negative)', async () => {
    const res = await request(app).get('/api/contracts').expect(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/dashboard/stats without token returns 401 (negative)', async () => {
    await request(app).get('/api/dashboard/stats').expect(401);
  });

  it('GET /api/users without token returns 401 (negative)', async () => {
    await request(app).get('/api/users').expect(401);
  });
});
