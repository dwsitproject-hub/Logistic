import session from 'express-session';
import type { Application } from 'express';

function parseSameSite(value: string | undefined): boolean | 'lax' | 'strict' | 'none' {
  const normalized = String(value || 'lax').trim().toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'none') return 'none';
  return 'lax';
}

export function configureTrustProxy(app: Application): void {
  if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }
}

export function createSessionMiddleware(): ReturnType<typeof session> {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'change-me-session-secret';
  const secure = process.env.SESSION_COOKIE_SECURE === 'true';
  const sameSite = parseSameSite(process.env.SESSION_COOKIE_SAMESITE);

  return session({
    name: 'klip.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure,
      sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}
