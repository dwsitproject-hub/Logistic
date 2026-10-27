import { afterEach, describe, expect, it } from 'vitest';
import { appForRequest, commdocsOrigin } from './appOrigins';

const req = (headers: Record<string, string | string[] | undefined>) => ({ headers }) as never;

describe('appOrigins: which app a request belongs to', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('without COMMDOCS_URL every request is KLIP', () => {
    delete process.env.COMMDOCS_URL;
    delete process.env.COMMERCIAL_DOCS_URL;
    expect(commdocsOrigin()).toBeNull();
    expect(appForRequest(req({ host: 'commercial-docs.kpndomain.com' }))).toBe('klip');
  });

  it('the Commercial Documents host is commdocs, anything else is KLIP', () => {
    process.env.COMMDOCS_URL = 'http://commercial-docs.kpndomain.com/';
    expect(commdocsOrigin()).toBe('http://commercial-docs.kpndomain.com');
    expect(appForRequest(req({ host: 'commercial-docs.kpndomain.com' }))).toBe('commdocs');
    expect(appForRequest(req({ host: 'Commercial-Docs.kpndomain.com' }))).toBe('commdocs');
    expect(appForRequest(req({ host: 'klip.kpndomain.com' }))).toBe('klip');
    expect(appForRequest(req({}))).toBe('klip');
  });

  it("reads X-Forwarded-Host first (behind a rewrite the Host is the backend's)", () => {
    process.env.COMMDOCS_URL = 'http://commercial-docs.kpndomain.com';
    expect(appForRequest(req({ host: '172.28.80.51:5001', 'x-forwarded-host': 'commercial-docs.kpndomain.com' }))).toBe('commdocs');
    expect(appForRequest(req({ 'x-forwarded-host': 'commercial-docs.kpndomain.com, proxy.local' }))).toBe('commdocs');
  });

  it('a port is part of the host', () => {
    process.env.COMMDOCS_URL = 'http://172.28.92.56:8081';
    expect(appForRequest(req({ host: '172.28.92.56:8081' }))).toBe('commdocs');
    expect(appForRequest(req({ host: '172.28.92.56' }))).toBe('klip');
  });

  it('the old COMMERCIAL_DOCS_URL name still counts', () => {
    delete process.env.COMMDOCS_URL;
    process.env.COMMERCIAL_DOCS_URL = 'http://test-commercial-docs.kpndomain.com';
    expect(appForRequest(req({ host: 'test-commercial-docs.kpndomain.com' }))).toBe('commdocs');
  });
});
