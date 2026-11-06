import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { verifySecret } from '../integrations/secretHash';
import logger from '../utils/logger';
import { isKmapsEnabled, kmapsPrivateKeyHash, kmapsPublicKey } from './config';
import {
  apiRateLimiter,
  partnerRequestContext,
  requirePartnerToken,
  sendPartnerError,
  tokenRateLimiter,
} from './http';
import { buildCatalog } from './catalog';
import { issuePartnerToken } from './token';
import { getShipment, listShipments, listVesselPairs } from './shipmentsRoute';

/** Express 4 does not catch a rejected promise from an async handler: hand it to the router's error handler, which answers in the contract's shape. */
const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

/**
 * KMAPS partner API, mounted at /api/partner/v1 (docs: the KMAPS repository, docs/KLIP-SHIPMENT-API.md, Draft 5).
 *
 * Read-only. It never uses the user middleware (authenticateToken), and user routes never accept a partner token: the two are signed with different keys
 * (token.ts). It is mounted BEFORE the app-wide express.json so that a malformed JSON body is answered here, in the contract's error shape.
 */
export function createPartnerRouter(options: { tokenLimit?: number; apiLimit?: number } = {}): express.Router {
  const router = express.Router();

  router.use(partnerRequestContext);
  router.use(express.json({ limit: '16kb' }));

  /** For monitoring. No token, no data. */
  router.get('/health', (_req, res) => {
    res.json({ ok: true, version: '1' });
  });

  /**
   * POST /auth/token with the keys in a JSON body (never headers: a proxy may strip custom ones). One message for an unknown and a wrong key. A correct pair
   * on a disabled application is 403, so KMAPS can tell "switched off in KLIP" from "wrong key".
   */
  router.post('/auth/token', tokenRateLimiter(options.tokenLimit), (req: Request, res: Response) => {
    const publicKey = typeof req.body?.publicKey === 'string' ? req.body.publicKey : '';
    const privateKey = typeof req.body?.privateKey === 'string' ? req.body.privateKey : '';
    if (!publicKey || !privateKey) {
      sendPartnerError(res, 400, 'validation_error', 'publicKey and privateKey are required');
      return;
    }

    const savedPublic = kmapsPublicKey();
    const savedHash = kmapsPrivateKeyHash();
    const publicMatches =
      savedPublic !== '' &&
      publicKey.length === savedPublic.length &&
      crypto.timingSafeEqual(Buffer.from(publicKey), Buffer.from(savedPublic));
    // The hash check always runs when a key is saved, so a wrong public key and a wrong private key take about the same time.
    const privateMatches = savedHash !== '' && verifySecret(privateKey, savedHash);
    if (!publicMatches || !privateMatches) {
      sendPartnerError(res, 401, 'invalid_credentials', 'Public or private key is wrong');
      return;
    }
    if (!isKmapsEnabled()) {
      sendPartnerError(res, 403, 'application_disabled', 'This application was disabled in KLIP');
      return;
    }
    const issued = issuePartnerToken();
    if (!issued) {
      sendPartnerError(res, 503, 'server_error', 'The partner API is not configured');
      return;
    }
    res.json({ token: issued.token, tokenType: 'Bearer', expiresIn: issued.expiresIn, scope: issued.scope });
  });

  // Everything below needs a partner token.
  router.use(requirePartnerToken);
  router.use(apiRateLimiter(options.apiLimit));

  router.get('/catalog', (_req, res) => {
    res.json(buildCatalog());
  });
  router.get('/shipments', asyncRoute(listShipments));
  router.get('/shipments/:id', asyncRoute(getShipment));
  router.get('/vessel-pairs', asyncRoute(listVesselPairs));

  // Unknown path under /api/partner/v1: JSON, not HTML.
  router.use((_req, res) => {
    sendPartnerError(res, 404, 'not_found', 'Unknown resource');
  });

  // Errors raised inside this router, including a malformed JSON body.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number })?.status;
    if (status === 400 || status === 413) {
      sendPartnerError(res, 400, 'validation_error', 'The request body is not valid JSON');
      return;
    }
    // Message and stack stay in the log: nothing that came from the request or the database goes back to the caller.
    logger.error('Partner API error', { error: err instanceof Error ? err.message : String(err) });
    sendPartnerError(res, 500, 'server_error', 'Internal error');
  });

  return router;
}
