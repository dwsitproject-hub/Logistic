import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPLOADS_MARKER_FILE, requireUploadsShare, resetUploadsGuardCache, uploadsRootProblem } from './uploadsGuard';

let dir: string;
const saved = { dir: process.env.UPLOAD_DIR, req: process.env.UPLOADS_REQUIRE_MARKER };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klip-uploads-'));
  process.env.UPLOAD_DIR = dir;
  resetUploadsGuardCache();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (saved.dir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = saved.dir;
  if (saved.req === undefined) delete process.env.UPLOADS_REQUIRE_MARKER;
  else process.env.UPLOADS_REQUIRE_MARKER = saved.req;
  resetUploadsGuardCache();
});

describe('uploadsRootProblem', () => {
  it('does nothing when the marker check is off (SIT and development)', () => {
    delete process.env.UPLOADS_REQUIRE_MARKER;
    expect(uploadsRootProblem()).toBeNull();
  });
  it('flags an upload root without the marker, e.g. an empty Docker volume', () => {
    process.env.UPLOADS_REQUIRE_MARKER = 'true';
    expect(uploadsRootProblem()).toContain(UPLOADS_MARKER_FILE);
  });
  it('accepts an upload root that has the marker, i.e. the share', () => {
    process.env.UPLOADS_REQUIRE_MARKER = 'true';
    fs.writeFileSync(path.join(dir, UPLOADS_MARKER_FILE), '');
    expect(uploadsRootProblem()).toBeNull();
  });
  it('reuses a verdict for a few seconds, then looks again', () => {
    process.env.UPLOADS_REQUIRE_MARKER = 'true';
    const t0 = 1_000_000;
    expect(uploadsRootProblem(t0)).not.toBeNull();
    fs.writeFileSync(path.join(dir, UPLOADS_MARKER_FILE), '');
    expect(uploadsRootProblem(t0 + 1000)).not.toBeNull(); // cached
    expect(uploadsRootProblem(t0 + 6000)).toBeNull(); // looked again
  });
});

describe('requireUploadsShare', () => {
  const run = () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();
    requireUploadsShare({} as never, { status, json } as never, next);
    return { status, json, next };
  };
  it('lets the upload through when storage is fine', () => {
    delete process.env.UPLOADS_REQUIRE_MARKER;
    const r = run();
    expect(r.next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });
  it('refuses with 503 and a clear message when the share is not mounted, and never reaches multer', () => {
    process.env.UPLOADS_REQUIRE_MARKER = 'true';
    const r = run();
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(r.json.mock.calls[0][0])).toContain('Nothing was saved');
  });
});
