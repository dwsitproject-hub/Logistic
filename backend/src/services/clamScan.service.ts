import net from 'net';
import fs from 'fs';
import logger from '../utils/logger';

const CHUNK = 2048;

/**
 * Stream a file to clamd INSTREAM. If CLAMD_HOST is unset, scanning is skipped (dev/test).
 * Protocol: zINSTREAM\\0 then [4-byte BE length][bytes]... then 4 zero bytes.
 */
export async function scanFileWithClamdIfConfigured(absPath: string): Promise<{
  clean: boolean;
  skipped: boolean;
  reason?: string;
}> {
  const host = process.env.CLAMD_HOST || process.env.CLAMAV_HOST;
  const port = parseInt(process.env.CLAMD_PORT || process.env.CLAMAV_PORT || '3310', 10);
  if (!host) {
    return { clean: true, skipped: true };
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(Buffer.from('zINSTREAM\0'));
      const fd = fs.openSync(absPath, 'r');
      try {
        for (;;) {
          const buf = Buffer.alloc(CHUNK);
          const n = fs.readSync(fd, buf, 0, CHUNK, null);
          if (n <= 0) break;
          const len = Buffer.alloc(4);
          len.writeUInt32BE(n, 0);
          socket.write(len);
          socket.write(buf.subarray(0, n));
        }
      } finally {
        fs.closeSync(fd);
      }
      socket.write(Buffer.alloc(4));
    });

    let out = '';
    const done = () => {
      const u = out.toUpperCase();
      if (u.includes('FOUND')) resolve({ clean: false, skipped: false, reason: out.trim() });
      else if (u.includes('OK')) resolve({ clean: true, skipped: false });
      else resolve({ clean: false, skipped: false, reason: out.trim() || 'unknown_clamd_response' });
    };
    socket.on('data', (d) => {
      out += d.toString('utf8');
    });
    socket.on('close', done);
    socket.on('error', (err) => {
      logger.warn('ClamAV connection failed', { err: String(err) });
      reject(err);
    });
    socket.setTimeout(120_000, () => {
      socket.destroy();
      reject(new Error('ClamAV scan timeout'));
    });
  });
}
