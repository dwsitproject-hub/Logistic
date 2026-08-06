import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('assertProductionDbHost', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = envBackup;
    vi.resetModules();
  });

  it('refuses module load in production when DB_HOST is klip-postgres and KLIP_FAIL_ON_LOCAL_DB=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_HOST = 'klip-postgres';
    process.env.KLIP_FAIL_ON_LOCAL_DB = 'true';
    process.env.DB_PASSWORD = 'test';

    await expect(import('./connection')).rejects.toThrow(/co-located Postgres/);
  });

  it('loads in production when DB_HOST is remote', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_HOST = '172.28.92.60';
    process.env.KLIP_FAIL_ON_LOCAL_DB = 'true';
    process.env.DB_PASSWORD = 'test';

    const mod = await import('./connection');
    expect(mod.default).toBeDefined();
  });

  it('loads in development when DB_HOST is local', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DB_HOST = 'postgres';
    process.env.KLIP_FAIL_ON_LOCAL_DB = 'true';
    process.env.DB_PASSWORD = 'test';

    const mod = await import('./connection');
    expect(mod.default).toBeDefined();
  });
});
