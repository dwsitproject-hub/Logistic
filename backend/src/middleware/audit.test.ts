import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';

vi.mock('../services/audit.service', () => ({ AuditService: { log: vi.fn().mockResolvedValue(undefined) } }));

import { AuditService } from '../services/audit.service';
import { auditLog } from './audit';
import type { AuthRequest } from './auth';

describe('auditLog', () => {
  it('does not copy a password or token from the request body into the audit row', async () => {
    const req = {
      method: 'PUT',
      params: { id: 'u2' },
      body: { full_name: 'Sari', password: 'p', newPassword: 'n', token: 't' },
      user: { id: 'admin', username: 'a', email: 'a@x.com', role: 'ADMIN' },
      ip: '127.0.0.1',
      get: () => 'ua',
    } as unknown as AuthRequest;
    const res = { json: vi.fn() } as unknown as Response;
    await auditLog('UPDATE', 'USER')(req, res, vi.fn() as NextFunction);
    res.json({ success: true, data: { id: 'u2', full_name: 'Sari' } });

    const entry = vi.mocked(AuditService.log).mock.calls[0][0];
    expect(entry.beforeData).toEqual({ full_name: 'Sari' });
    expect(entry.afterData).toEqual({ full_name: 'Sari' });
  });
});
