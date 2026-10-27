import type { Request } from 'express';

/**
 * Which front end a request belongs to. KLIP and Commercial Documents are two apps on ONE backend, each on its own domain, and Hub SSO has to
 * know which of them the browser came from: the Hub registers a client id and redirect URI per application, and a successful sign-in must land
 * back on the same domain it started from (the session cookie is per host).
 */
export type AppName = 'klip' | 'commdocs';

/** The Commercial Documents app's public origin, or null when it is not deployed (everything then stays on KLIP). */
export function commdocsOrigin(): string | null {
  // COMMERCIAL_DOCS_URL is the name this had before the app was renamed CommDocs (SIT .env set it on 2026-10-26).
  const value = String(process.env.COMMDOCS_URL || process.env.COMMERCIAL_DOCS_URL || '').trim().replace(/\/$/, '');
  return value || null;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The app a request was made on, read from the host the browser used. Nginx keeps it (`proxy_set_header Host $host`); behind the Next rewrite
 * it arrives as X-Forwarded-Host. Anything that is not exactly the Commercial Documents host is KLIP, so an unset COMMDOCS_URL changes nothing.
 */
export function appForRequest(req: Pick<Request, 'headers'>): AppName {
  const origin = commdocsOrigin();
  const commdocsHost = origin ? hostOf(origin) : null;
  if (!commdocsHost) return 'klip';
  const raw = req.headers?.['x-forwarded-host'] ?? req.headers?.host;
  const host = String(Array.isArray(raw) ? raw[0] : raw ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return host === commdocsHost ? 'commdocs' : 'klip';
}
