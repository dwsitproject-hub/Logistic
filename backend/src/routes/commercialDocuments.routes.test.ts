import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';

vi.mock('../database/connection', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  default: { query: vi.fn() },
}));

import { query } from '../database/connection';
import router from './commercialDocuments.routes';
import type { AuthRequest } from '../middleware/auth';

type Handler = (req: AuthRequest, res: Response, next: NextFunction) => unknown;
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: Handler }> } };
const routes = (router as unknown as { stack: Layer[] }).stack.filter((l) => l.route).map((l) => l.route!);

function mockRes() {
  const res = {
    statusCode: 200,
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json() {
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number };
}

describe('commercial documents routes', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    // the user's role has no row for any key
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
  });

  it('has routes to check', () => {
    expect(routes.length).toBeGreaterThanOrEqual(13);
  });

  // The Commercial Documents app talks to this API directly, so a signed-in user without the page permission must be stopped here.
  it.each(routes.map((r) => [`${Object.keys(r.methods)[0].toUpperCase()} ${r.path}`, r] as const))(
    '%s rejects a role without the permission',
    async (_name, route) => {
      expect(route.stack[0].name).toBe('authenticateToken');
      const guard = route.stack[1].handle;
      const res = mockRes();
      const next = vi.fn();
      await guard({ user: { id: 'u1', username: 'ops', email: 'ops@x.com', role: 'LOGISTICS' } } as AuthRequest, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    },
  );

  it('the completeness endpoint also opens for the dashboard permission alone', async () => {
    const route = routes.find((r) => r.path === '/completeness-by-plant')!;
    vi.mocked(query).mockImplementation(((_sql: string, params: unknown[]) =>
      Promise.resolve({ rows: [{ allowed: params[2] === 'page.commercial_dashboard' }] })) as never);
    const next = vi.fn();
    await route.stack[1].handle({ user: { id: 'u1', username: 'm', email: 'm@x.com', role: 'MANAGEMENT' } } as AuthRequest, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
