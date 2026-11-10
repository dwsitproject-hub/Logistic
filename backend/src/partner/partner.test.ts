import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replaceIntegrationOverrides } from '../integrations/integrationEnv';
import { deriveSubKey } from '../integrations/secretBox';
import { hashSecret, verifySecret } from '../integrations/secretHash';
import { INTEGRATIONS } from '../integrations/registry';
import { createPartnerRouter } from './routes';
import { issuePartnerToken, verifyPartnerToken } from './token';

const PUBLIC_KEY = 'kmaps_pk_test0123456789';
const PRIVATE_KEY = 'kmaps_sk_test0123456789abcdef';
const MASTER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** One stored hash for the whole file: re-hashing on every configure() would change the key version and end the tokens, which is not what a settings change like Enabled does. */
const STORED_HASH = hashSecret(PRIVATE_KEY);

function configure(overrides: Record<string, string> = {}) {
  replaceIntegrationOverrides(
    new Map(
      Object.entries({
        KMAPS_ENABLED: 'true',
        KMAPS_PUBLIC_KEY: PUBLIC_KEY,
        KMAPS_PRIVATE_KEY: STORED_HASH,
        ...overrides,
      }),
    ),
  );
}

function appWith(options?: { tokenLimit?: number; apiLimit?: number }) {
  const app = express();
  app.use('/api/partner/v1', createPartnerRouter(options));
  return app;
}

async function tokenFrom(app: express.Express): Promise<string> {
  const res = await request(app).post('/api/partner/v1/auth/token').send({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

const saved = { master: process.env.INTEGRATION_SECRETS_KEY, jwt: process.env.JWT_SECRET };

beforeEach(() => {
  process.env.INTEGRATION_SECRETS_KEY = MASTER;
  process.env.JWT_SECRET = 'a-user-secret-that-is-not-the-partner-key';
  configure();
});

afterEach(() => {
  replaceIntegrationOverrides(new Map());
  if (saved.master === undefined) delete process.env.INTEGRATION_SECRETS_KEY;
  else process.env.INTEGRATION_SECRETS_KEY = saved.master;
  if (saved.jwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = saved.jwt;
});

describe('scrypt storage of the private key', () => {
  it('verifies the key that made the hash and nothing else', () => {
    const stored = hashSecret(PRIVATE_KEY);
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toContain(PRIVATE_KEY);
    expect(verifySecret(PRIVATE_KEY, stored)).toBe(true);
    expect(verifySecret(`${PRIVATE_KEY}x`, stored)).toBe(false);
    expect(verifySecret('', stored)).toBe(false);
  });

  it('salts: the same key hashes differently each time, and both verify', () => {
    const a = hashSecret(PRIVATE_KEY);
    const b = hashSecret(PRIVATE_KEY);
    expect(a).not.toBe(b);
    expect(verifySecret(PRIVATE_KEY, a)).toBe(true);
    expect(verifySecret(PRIVATE_KEY, b)).toBe(true);
  });

  it('a malformed stored value is a plain false, never a throw', () => {
    for (const bad of ['', 'plain', 'scrypt$x$y$z', 'scrypt$16384$$', 'bcrypt$1$2$3']) {
      expect(verifySecret(PRIVATE_KEY, bad)).toBe(false);
    }
  });

  it('the registry marks the KMAPS private key as hash-on-store and nothing else', () => {
    const hashed = INTEGRATIONS.flatMap((i) => i.settings).filter((s) => s.hashOnStore);
    expect(hashed.map((s) => s.key)).toEqual(['KMAPS_PRIVATE_KEY']);
    expect(hashed[0].kind).toBe('secret');
  });
});

describe('token signing key', () => {
  it('is derived per purpose, is 32 bytes, and is not the master key or JWT_SECRET', () => {
    const a = deriveSubKey('partner-token-v1');
    const b = deriveSubKey('something-else');
    expect(a?.length).toBe(32);
    expect(a?.equals(b as Buffer)).toBe(false);
    expect(a?.toString('hex')).not.toBe(MASTER);
  });

  it('is null (the API stays closed) when the master key is missing', () => {
    delete process.env.INTEGRATION_SECRETS_KEY;
    expect(deriveSubKey('partner-token-v1')).toBeNull();
    expect(issuePartnerToken()).toBeNull();
  });
});

describe('GET /health', () => {
  it('answers without a token', async () => {
    const res = await request(appWith()).get('/api/partner/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: '1' });
  });
});

describe('POST /auth/token', () => {
  it('returns a one hour Bearer token for the right keys', async () => {
    const res = await request(appWith())
      .post('/api/partner/v1/auth/token')
      .send({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600, scope: 'shipments:read' });
    const claims = jwt.decode(res.body.token) as jwt.JwtPayload;
    expect(claims).toMatchObject({ aud: 'klip-partner', sub: 'kmaps', scope: 'shipments:read' });
    expect((claims.exp as number) - (claims.iat as number)).toBe(3600);
  });

  it('answers 401 invalid_credentials with ONE message for a wrong private key, a wrong public key and unknown keys', async () => {
    const app = appWith();
    const bodies = [
      { publicKey: PUBLIC_KEY, privateKey: 'kmaps_sk_wrong' },
      { publicKey: 'kmaps_pk_wrong', privateKey: PRIVATE_KEY },
      { publicKey: 'kmaps_pk_wrong', privateKey: 'kmaps_sk_wrong' },
    ];
    const messages = new Set<string>();
    for (const body of bodies) {
      const res = await request(app).post('/api/partner/v1/auth/token').send(body);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_credentials');
      messages.add(res.body.error.message);
    }
    expect(messages.size).toBe(1);
  });

  it('answers 401, never 500, when no key has been saved yet', async () => {
    replaceIntegrationOverrides(new Map());
    const res = await request(appWith()).post('/api/partner/v1/auth/token').send({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('refuses a plain private key placed in .env instead of a hash', async () => {
    configure({ KMAPS_PRIVATE_KEY: PRIVATE_KEY });
    const res = await request(appWith()).post('/api/partner/v1/auth/token').send({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
    expect(res.status).toBe(401);
  });

  it('answers 403 application_disabled for the right keys on a switched-off application', async () => {
    configure({ KMAPS_ENABLED: 'false' });
    const res = await request(appWith()).post('/api/partner/v1/auth/token').send({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('application_disabled');
  });

  it('answers 400 validation_error when a key is missing, and never echoes a key', async () => {
    const res = await request(appWith()).post('/api/partner/v1/auth/token').send({ publicKey: PUBLIC_KEY });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(JSON.stringify(res.body)).not.toContain(PUBLIC_KEY);
  });

  it('answers a malformed JSON body in the contract error shape, as JSON', async () => {
    const res = await request(appWith())
      .post('/api/partner/v1/auth/token')
      .set('Content-Type', 'application/json')
      .send('{"publicKey": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('is rate limited per address, with Retry-After', async () => {
    const app = appWith({ tokenLimit: 2 });
    const send = () => request(app).post('/api/partner/v1/auth/token').send({ publicKey: 'x', privateKey: 'y' });
    expect((await send()).status).toBe(401);
    expect((await send()).status).toBe(401);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('rate_limited');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('Bearer routes', () => {
  it('answers /catalog for a partner token', async () => {
    const app = appWith();
    const token = await tokenFrom(app);
    const res = await request(app).get('/api/partner/v1/catalog').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.limits).toMatchObject({ maxPage: 500, maxVesselCodes: 100 });
    expect(res.body.transportModes).toEqual(['SEA', 'MIX']);
  });

  it('answers 401 token_invalid for a missing, malformed or garbage token', async () => {
    const app = appWith();
    for (const header of [undefined, 'Bearer', 'Bearer not.a.jwt', 'Basic abc']) {
      const req = request(app).get('/api/partner/v1/catalog');
      const res = await (header ? req.set('Authorization', header) : req);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('token_invalid');
    }
  });

  it('a USER token (signed with JWT_SECRET) is refused here', async () => {
    const userToken = jwt.sign({ id: 'u1', username: 'ryan', email: 'r@x', role: 'ADMIN' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    const res = await request(appWith()).get('/api/partner/v1/catalog').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(401);
  });

  it('a PARTNER token is refused by the user middleware check (it does not verify under JWT_SECRET)', async () => {
    const token = await tokenFrom(appWith());
    expect(() => jwt.verify(token, process.env.JWT_SECRET as string)).toThrow();
  });

  it('a token signed with the right audience but another key is refused', () => {
    const forged = jwt.sign({ scope: 'shipments:read' }, 'another-key', { audience: 'klip-partner', issuer: 'klip', subject: 'kmaps' });
    expect(verifyPartnerToken(forged).ok).toBe(false);
  });

  it('an expired token is refused', async () => {
    const key = deriveSubKey('partner-token-v1') as Buffer;
    const expired = jwt.sign({ scope: 'shipments:read', kv: 'x' }, key, {
      audience: 'klip-partner',
      issuer: 'klip',
      subject: 'kmaps',
      expiresIn: -10,
    });
    expect(verifyPartnerToken(expired).ok).toBe(false);
  });

  it('saving a new private key ends every token issued under the old one at once', async () => {
    const app = appWith();
    const token = await tokenFrom(app);
    expect((await request(app).get('/api/partner/v1/catalog').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    configure({ KMAPS_PRIVATE_KEY: hashSecret('kmaps_sk_a_new_key_0123456789') });
    expect((await request(app).get('/api/partner/v1/catalog').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('switching the application off ends access at once, with 403 application_disabled', async () => {
    const app = appWith();
    const token = await tokenFrom(app);
    configure({ KMAPS_ENABLED: 'false' });
    const res = await request(app).get('/api/partner/v1/catalog').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('application_disabled');
  });

  it('answers an unknown path with a JSON 404, and one without a token with 401', async () => {
    const app = appWith();
    const token = await tokenFrom(app);
    const res = await request(app).get('/api/partner/v1/nothing-here').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('not_found');
    expect((await request(app).get('/api/partner/v1/nothing-here')).status).toBe(401);
  });

  it('is rate limited for the one application, with Retry-After', async () => {
    const app = appWith({ apiLimit: 2 });
    const token = await tokenFrom(app);
    const get = () => request(app).get('/api/partner/v1/catalog').set('Authorization', `Bearer ${token}`);
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    const third = await get();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('rate_limited');
  });

  it('a closed API (master key missing) answers 503 server_error, not a crash', async () => {
    const app = appWith();
    const token = await tokenFrom(app);
    delete process.env.INTEGRATION_SECRETS_KEY;
    const res = await request(app).get('/api/partner/v1/catalog').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('server_error');
  });
});
