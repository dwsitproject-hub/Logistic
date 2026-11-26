import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Uploads are received on the container's own disk and copied to the share ONCE, not written to the share while they arrive.
 *
 * Why (measured on production, 2026-11-26): an operation on the Synology share stalls for about 0.85 - 0.95 s now and then, whatever the operation is (write, stat,
 * rename, unlink), and sometimes for 10 s or more. An upload used to make about eight operations there (the folder, the open / write / close of the incoming file, the
 * existence check of the name, the rename, the read-back), so most uploads met one or two stalls: 1 s or 2 s on the server. Receiving and virus-scanning locally and
 * copying once leaves two or three operations on the share. The share's stall is the same; there are fewer chances to meet it.
 */

/** Where an incoming file waits until it is copied to its folder on the share. Created on first use. */
export function incomingUploadDir(): string {
  const dir = path.join(os.tmpdir(), 'commdocs-incoming');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Copies a local file into destDir under the first name nameFor(0), nameFor(1), ... that is free. COPYFILE_EXCL makes "is it free" and "create it" ONE
 * operation on the share (it fails with EEXIST when the name is taken), instead of an existence check followed by a rename.
 * Returns the name and path it was saved under, or null when none of maxTries names was free. Any other error is thrown; a partly written copy is removed first.
 */
export function copyToFirstFreeName(
  localPath: string,
  destDir: string,
  nameFor: (attempt: number) => string,
  maxTries = 50,
): { name: string; absPath: string } | null {
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const name = nameFor(attempt);
    const absPath = path.join(destDir, name);
    try {
      fs.copyFileSync(localPath, absPath, fs.constants.COPYFILE_EXCL);
      return { name, absPath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') continue;
      fs.rmSync(absPath, { force: true });
      throw err;
    }
  }
  return null;
}
