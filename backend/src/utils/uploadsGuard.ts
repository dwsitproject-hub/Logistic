import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { getUploadRootDir } from './fileUpload';
import logger from './logger';

/**
 * Guards against writing uploads to the WRONG place.
 *
 * Production keeps /app/uploads on the Synology share, bind-mounted by docker-compose.backend.synology.yml. When the container is started without that
 * overlay (a hand-typed `docker compose up`, a share that was unreadable at deploy time) the app still runs, /app/uploads is an empty Docker volume, and
 * every upload "succeeds" into the wrong place while every older file shows "File not found on server". That happened on 2026-11-12 and 2026-11-17.
 *
 * The defence lives in the app because the people and scripts that start the container cannot all be trusted to remember the overlay:
 * with UPLOADS_REQUIRE_MARKER=true the upload root must contain the marker file below. The marker is created ONCE on the share
 * (touch /mnt/synology-apps/dev/KLIP/.klip-uploads-root), so a Docker volume or any other empty folder does not have it, and uploads are refused with a clear
 * message instead of being written somewhere nobody looks. Off by default, so SIT and development are unaffected.
 */

export const UPLOADS_MARKER_FILE = '.klip-uploads-root';

/** How long a verdict is reused: a request burst does one stat on the share, not one per upload. */
const CACHE_MS = 5000;
let cached: { at: number; problem: string | null } | null = null;

export function uploadsMarkerRequired(): boolean {
  return String(process.env.UPLOADS_REQUIRE_MARKER || '').trim().toLowerCase() === 'true';
}

/** Why uploads must not be accepted right now, or null when they can be. Never throws. */
export function uploadsRootProblem(now: number = Date.now()): string | null {
  if (!uploadsMarkerRequired()) return null;
  if (cached && now - cached.at < CACHE_MS) return cached.problem;
  const root = getUploadRootDir();
  let problem: string | null = null;
  try {
    fs.accessSync(path.join(root, UPLOADS_MARKER_FILE), fs.constants.R_OK);
  } catch {
    problem = `${path.join(root, UPLOADS_MARKER_FILE)} is not there: the upload folder is not the Synology share (the container was started without the share mounted)`;
  }
  cached = { at: now, problem };
  return problem;
}

/** For tests. */
export function resetUploadsGuardCache(): void {
  cached = null;
}

/** Runs at start: an unmounted share is logged loudly the moment the container boots, not when the first user uploads. */
export function logUploadsRootStatusAtStart(): void {
  if (!uploadsMarkerRequired()) return;
  const problem = uploadsRootProblem();
  if (problem) logger.error(`UPLOADS NOT ON THE SHARE - uploads will be refused. ${problem}`);
  else logger.info(`Uploads root verified (${UPLOADS_MARKER_FILE} found in ${getUploadRootDir()})`);
}

/** Express middleware, placed BEFORE multer: multer writes the file to disk as soon as it reads the request. */
export function requireUploadsShare(_req: Request, res: Response, next: NextFunction): void {
  const problem = uploadsRootProblem();
  if (!problem) {
    next();
    return;
  }
  logger.error(`Upload refused: ${problem}`);
  res.status(503).json({
    success: false,
    error: {
      message: 'Document storage is not available right now. Nothing was saved. Please tell the administrator and try again later.',
    },
  });
}
