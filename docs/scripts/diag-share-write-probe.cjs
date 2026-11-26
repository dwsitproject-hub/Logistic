/**
 * Which step of a document upload stalls on the Synology share? Times each file operation of an upload, on the share and on the local disk.
 *
 *   docker cp docs/scripts/diag-share-write-probe.cjs klip-backend:/app/
 *   docker exec klip-backend node /app/diag-share-write-probe.cjs
 *
 * WRITES, but only scratch files: a folder `.perf-probe-<time>` under the upload root holds 15 temporary files of 300 KB, and the folder is removed
 * at the end (and on an error). No document, no database row. It takes about a minute (share operations cost about a second each when they stall).
 *
 * Per iteration it times, on the share ("direct", what the upload does today: multer writes the file there, then the app renames and reads it back):
 *   write      open + write + close of a 300 KB file
 *   stat       stat right after the close
 *   exists     existsSync of a name that is not there (the naming loop)
 *   rename     rename to the final name
 *   readback   stat of the final name (the size check after the rename)
 *   unlink     removal
 * and the alternative ("local-then-copy": the file is written on the container's own disk, scanned there, and copied to the share once):
 *   local-write, copy-to-share, readback.
 * Output: min / median / p90 / max in ms per step. A step whose median or p90 is near 1000 ms is the stall.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const N = 15;
const PAYLOAD = crypto.randomBytes(300 * 1024);
const root = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(process.cwd(), 'uploads');
const shareDir = path.join(root, `.perf-probe-${Date.now()}`);
const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-probe-'));

const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e5) / 10;
const timed = (fn) => {
  const t = process.hrtime.bigint();
  fn();
  return ms(t);
};
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const row = (label, arr) =>
  `  ${label.padEnd(18)} min=${String(pct(arr, 0)).padStart(7)}  median=${String(pct(arr, 50)).padStart(7)}  p90=${String(pct(arr, 90)).padStart(7)}  max=${String(Math.max(...arr)).padStart(7)} ms`;

function directOn(dir) {
  const out = { write: [], stat: [], exists: [], rename: [], readback: [], unlink: [] };
  for (let i = 0; i < N; i += 1) {
    const tmp = path.join(dir, `t${i}.tmp`);
    const fin = path.join(dir, `final${i}.pdf`);
    out.write.push(
      timed(() => {
        const fd = fs.openSync(tmp, 'w');
        fs.writeSync(fd, PAYLOAD);
        fs.closeSync(fd);
      }),
    );
    out.stat.push(timed(() => fs.statSync(tmp)));
    out.exists.push(timed(() => fs.existsSync(path.join(dir, `missing${i}.pdf`))));
    out.rename.push(timed(() => fs.renameSync(tmp, fin)));
    out.readback.push(timed(() => fs.statSync(fin)));
    out.unlink.push(timed(() => fs.unlinkSync(fin)));
  }
  return out;
}

function localThenCopy() {
  const out = { 'local-write': [], 'copy-to-share': [], readback: [] };
  for (let i = 0; i < N; i += 1) {
    const tmp = path.join(localDir, `c${i}.tmp`);
    const fin = path.join(shareDir, `copy${i}.pdf`);
    out['local-write'].push(timed(() => fs.writeFileSync(tmp, PAYLOAD)));
    out['copy-to-share'].push(timed(() => fs.copyFileSync(tmp, fin)));
    out.readback.push(timed(() => fs.statSync(fin)));
    fs.unlinkSync(tmp);
    fs.unlinkSync(fin);
  }
  return out;
}

/** Creating a NEW folder on the share and copying the first file into it: what the first document of a PO does (every other document finds the folder there). */
function newFolderOn(base) {
  const out = { 'folder exists?': [], 'mkdir new': [], 'copy into it': [], 'readback': [], 'unlink+rmdir': [] };
  const tmp = path.join(localDir, 'nf.tmp');
  fs.writeFileSync(tmp, PAYLOAD);
  for (let i = 0; i < N; i += 1) {
    const dir = path.join(base, `po-${Date.now()}-${i}`);
    const file = path.join(dir, 'first.pdf');
    out['folder exists?'].push(timed(() => fs.existsSync(dir)));
    out['mkdir new'].push(timed(() => fs.mkdirSync(dir, { recursive: true })));
    out['copy into it'].push(timed(() => fs.copyFileSync(tmp, file, fs.constants.COPYFILE_EXCL)));
    out.readback.push(timed(() => fs.statSync(file)));
    out['unlink+rmdir'].push(
      timed(() => {
        fs.unlinkSync(file);
        fs.rmdirSync(dir);
      }),
    );
  }
  return out;
}

function cleanup() {
  try {
    fs.rmSync(shareDir, { recursive: true, force: true });
  } catch {
    /* nothing to remove */
  }
  try {
    fs.rmSync(localDir, { recursive: true, force: true });
  } catch {
    /* nothing to remove */
  }
}

try {
  fs.mkdirSync(shareDir, { recursive: true });
  console.log(`\nshare folder (scratch, removed at the end): ${shareDir}`);
  console.log(`${N} iterations of a 300 KB file\n`);

  console.log('=== direct on the share (what the upload does today)');
  const share = directOn(shareDir);
  for (const k of Object.keys(share)) console.log(row(k, share[k]));
  const sumShare = share.write.map((_, i) => Math.round((share.write[i] + share.exists[i] + share.rename[i] + share.readback[i]) * 10) / 10);
  console.log(row('write+name+rename+read', sumShare));

  console.log('\n=== the same steps on the container\'s local disk (reference)');
  const local = directOn(localDir);
  for (const k of ['write', 'rename', 'readback']) console.log(row(k, local[k]));

  console.log('\n=== alternative: write locally, copy to the share once');
  const alt = localThenCopy();
  for (const k of Object.keys(alt)) console.log(row(k, alt[k]));
  const sumAlt = alt['local-write'].map((_, i) => Math.round((alt['local-write'][i] + alt['copy-to-share'][i] + alt.readback[i]) * 10) / 10);
  console.log(row('local+copy+read', sumAlt));

  console.log('\n=== the FIRST document of a PO: a new folder, then the file in it (the folders are created inside the scratch folder)');
  const nf = newFolderOn(shareDir);
  for (const k of Object.keys(nf)) console.log(row(k, nf[k]));
  const sumNf = nf['mkdir new'].map((_, i) => Math.round((nf['folder exists?'][i] + nf['mkdir new'][i] + nf['copy into it'][i] + nf.readback[i]) * 10) / 10);
  console.log(row('exists+mkdir+copy+read', sumNf));

  console.log('\nHow to read it: the step with median or p90 near 1000 ms is the stall. If "write+name+rename+read" is much slower than "local+copy+read", writing locally first and copying once to the share is worth building. If copy-to-share stalls as well, the share itself is the limit and fewer operations is all that can be saved.');
} finally {
  cleanup();
}
