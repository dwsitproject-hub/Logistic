import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyToFirstFreeName, incomingUploadDir } from './incomingUpload';

let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'incoming-test-'));
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

const makeLocal = (text = 'PDFDATA') => {
  const p = path.join(work, 'incoming.tmp');
  fs.writeFileSync(p, text);
  return p;
};

describe('copyToFirstFreeName', () => {
  it('copies under the first name and leaves the local file for the caller to remove', () => {
    const dest = path.join(work, 'share');
    fs.mkdirSync(dest);
    const r = copyToFirstFreeName(makeLocal('hello'), dest, (i) => (i === 0 ? 'A.pdf' : `A(${i + 1}).pdf`));
    expect(r?.name).toBe('A.pdf');
    expect(fs.readFileSync(path.join(dest, 'A.pdf'), 'utf8')).toBe('hello');
    expect(fs.existsSync(path.join(work, 'incoming.tmp'))).toBe(true);
  });
  it('walks up to the first free name and never overwrites a file that is there', () => {
    const dest = path.join(work, 'share');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'A.pdf'), 'old 1');
    fs.writeFileSync(path.join(dest, 'A(2).pdf'), 'old 2');
    const r = copyToFirstFreeName(makeLocal('new'), dest, (i) => (i === 0 ? 'A.pdf' : `A(${i + 1}).pdf`));
    expect(r?.name).toBe('A(3).pdf');
    expect(fs.readFileSync(path.join(dest, 'A.pdf'), 'utf8')).toBe('old 1');
    expect(fs.readFileSync(path.join(dest, 'A(2).pdf'), 'utf8')).toBe('old 2');
  });
  it('gives up with null when every name is taken', () => {
    const dest = path.join(work, 'share');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'X.pdf'), 'x');
    expect(copyToFirstFreeName(makeLocal(), dest, () => 'X.pdf', 3)).toBeNull();
  });
  it('throws any other error (a missing folder), leaving nothing behind', () => {
    expect(() => copyToFirstFreeName(makeLocal(), path.join(work, 'no-such-folder'), () => 'A.pdf')).toThrow();
  });
});

describe('incomingUploadDir', () => {
  it('is a local, existing folder', () => {
    const d = incomingUploadDir();
    expect(fs.statSync(d).isDirectory()).toBe(true);
    expect(d.startsWith(os.tmpdir())).toBe(true);
  });
});
