import crypto from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { recordApiCall, MAX_JSON_CHARS } from '../integrations/apiCallLog';
import { isKmapsEnabled } from './config';
import { PARTNER_SCOPE, verifyPartnerToken } from './token';

/**
 * Shared HTTP pieces of the KMAPS partner API (/api/partner/v1): the one error shape, per-request context, rate limits, the Bearer check and the call log.
 */

export type PartnerErrorCode =
  | 'validation_error'
  | 'invalid_credentials'
  | 'token_invalid'
  | 'application_disabled'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'server_error';

/** Every error is `{ error: { code, message } }`, JSON, never HTML (KMAPS treats an HTML body as "this is a portal, not the API"). No keys, tokens or SQL in `message`. */
export function sendPartnerError(
  res: Response,
  status: number,
  code: PartnerErrorCode,
  message: string,
  headers?: Record<string, string>,
): void {
  res.locals.partnerErrorCode = code;
  res.locals.partnerErrorMessage = message;
  if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).json({ error: { code, message } });
}

/** What a handler can tell the call log: a short description of what was asked, and how many records went back. Never a body. */
export function noteForCallLog(res: Response, note: { subject?: string; records?: number }): void {
  if (note.subject !== undefined) res.locals.partnerSubject = note.subject.slice(0, 100);
  if (note.records !== undefined) res.locals.partnerRecords = note.records;
}

/**
 * Time every request and write one row to Integrations > KMAPS > History when it ends. Health checks are left out (a monitor would fill the history).
 * The row holds the path, the query string parameters, the status and the duration. Not the body, not the price, and never the keys: the token request body
 * is not read here, and a Bearer token lives in a header that is never copied.
 */
export const partnerRequestContext: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const path = `${req.baseUrl}${req.path}`;
    if (path.endsWith('/health')) return;
    const isToken = path.endsWith('/auth/token');
    const params = isToken ? null : boundedParams(req.query as Record<string, unknown>);
    void recordApiCall('kmaps', {
      kind: isToken ? 'auth' : 'read',
      method: req.method,
      url: path,
      subject: (res.locals.partnerSubject as string | undefined) ?? null,
      reference: null,
      requestParams: params,
      requestBody: null,
      responseStatus: res.statusCode,
      responseBody: typeof res.locals.partnerRecords === 'number' ? { records: res.locals.partnerRecords } : null,
      ok: res.statusCode < 400,
      errorCode: (res.locals.partnerErrorCode as string | undefined) ?? null,
      errorMessage: (res.locals.partnerErrorMessage as string | undefined) ?? null,
      requestId,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
};

/** Query parameters worth keeping (vessel codes, cursor, limit). A long code list is cut so a row stays small. */
function boundedParams(query: Record<string, unknown>): Record<string, unknown> | null {
  const entries = Object.entries(query);
  if (entries.length === 0) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    const text = Array.isArray(v) ? v.join(',') : String(v ?? '');
    out[k] = text.length > 2_000 ? `${text.slice(0, 2_000)}...(${text.length} chars)` : text;
  }
  return JSON.stringify(out).length > MAX_JSON_CHARS ? { truncated: true } : out;
}

function rateLimited(res: Response, retryAfterSeconds: number): void {
  sendPartnerError(res, 429, 'rate_limited', 'Too many requests', {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
}

/** Token endpoint: 10 requests per minute per address (contract 3.2). */
export function tokenRateLimiter(limit = 10): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res) => rateLimited(res, 60),
  });
}

/** Data routes: 600 requests per minute for the one application (contract 8). Keyed by a constant: a single client, whatever address the proxy shows. */
export function apiRateLimiter(limit = 600): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: () => 'kmaps',
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => rateLimited(res, 60),
  });
}

/**
 * Bearer check for every route except /health and /auth/token: a partner token only. A user token (signed with JWT_SECRET) fails the signature check here,
 * exactly as a partner token fails user routes.
 */
export const requirePartnerToken: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const header = String(req.headers.authorization ?? '');
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const check = verifyPartnerToken(token);
  if (!check.ok) {
    if (check.reason === 'unavailable') {
      sendPartnerError(res, 503, 'server_error', 'The partner API is not configured');
      return;
    }
    sendPartnerError(res, 401, 'token_invalid', 'Missing, expired or malformed token');
    return;
  }
  if (!isKmapsEnabled()) {
    sendPartnerError(res, 403, 'application_disabled', 'This application was disabled in KLIP');
    return;
  }
  if (!check.scope.includes(PARTNER_SCOPE)) {
    sendPartnerError(res, 403, 'forbidden', 'The token does not carry the required scope');
    return;
  }
  next();
};
