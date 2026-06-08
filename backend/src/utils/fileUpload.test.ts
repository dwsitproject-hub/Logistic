import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildUniqueStoredFilename,
  resolveUploadAbsolutePath,
  toRelativeUploadPath,
} from './fileUpload';

describe('fileUpload utils', () => {
  it('buildUniqueStoredFilename keeps extension and avoids collisions', () => {
    const a = buildUniqueStoredFilename('My Doc.pdf');
    const b = buildUniqueStoredFilename('My Doc.pdf');
    expect(a).toMatch(/^[0-9a-f-]{36}_My_Doc\.pdf$/i);
    expect(b).not.toEqual(a);
  });

  it('toRelativeUploadPath stores cwd-relative posix paths', () => {
    const abs = path.join(process.cwd(), 'uploads', 'abc.pdf');
    expect(toRelativeUploadPath(abs)).toBe('uploads/abc.pdf');
  });

  it('resolveUploadAbsolutePath supports relative and absolute stored paths', () => {
    const rel = 'uploads/abc.pdf';
    expect(path.normalize(resolveUploadAbsolutePath(rel))).toBe(
      path.normalize(path.join(process.cwd(), rel)),
    );
    const abs = path.join(process.cwd(), 'uploads', 'legacy.pdf');
    expect(path.normalize(resolveUploadAbsolutePath(abs))).toBe(path.normalize(abs));
  });
});
