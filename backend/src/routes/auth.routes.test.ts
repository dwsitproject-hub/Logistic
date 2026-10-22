import { describe, expect, it } from 'vitest';
import router from './auth.routes';

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> } };
const layers = (router as unknown as { stack: Layer[] }).stack;

function routeOf(path: string, method: string) {
  return layers.find((l) => l.route?.path === path && l.route.methods[method])?.route;
}

describe('auth routes', () => {
  it('has no public registration (it used to accept any role and hand back a token)', () => {
    expect(routeOf('/register', 'post')).toBeUndefined();
  });

  it('exposes the three public password-link endpoints, each behind a rate limiter', () => {
    for (const path of ['/forgot-password', '/password-token/validate', '/set-password']) {
      const route = routeOf(path, 'post');
      expect(route, path).toBeDefined();
      // a limiter first, the controller last; none of them asks for a login
      expect(route!.stack.length, path).toBe(2);
      expect(route!.stack.map((s) => s.name), path).not.toContain('authenticateToken');
    }
  });
});
