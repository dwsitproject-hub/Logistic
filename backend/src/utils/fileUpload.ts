import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Physical upload root — defaults to `<cwd>/uploads`, overridable via UPLOAD_DIR. */
export function getUploadRootDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (!configured) {
    return path.join(process.cwd(), 'uploads');
  }
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

export function ensureUploadDir(subdir?: string): string {
  const dir = subdir ? path.join(getUploadRootDir(), subdir) : getUploadRootDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Unique on-disk name; original name is stored separately in DB `file_name`. */
export function buildUniqueStoredFilename(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  const stem = path
    .basename(originalname, ext)
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-]/g, '')
    .slice(0, 120);
  const safeStem = stem || 'file';
  return `${crypto.randomUUID()}_${safeStem}${ext}`;
}

/** Persist only a cwd-relative POSIX path (e.g. `uploads/<uuid>_file.pdf`). */
export function toRelativeUploadPath(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  const rel = path.relative(process.cwd(), resolved);
  if (!rel || rel.startsWith('..')) {
    // Fallback when UPLOAD_DIR is outside cwd — store relative to upload root instead.
    const uploadRel = path.relative(getUploadRootDir(), resolved);
    if (!uploadRel || uploadRel.startsWith('..')) {
      return resolved.split(path.sep).join('/');
    }
    const uploadDirName = path.basename(getUploadRootDir());
    return [uploadDirName, uploadRel].join('/').split(path.sep).join('/');
  }
  return rel.split(path.sep).join('/');
}

/**
 * The folder a shipment document lands in under the upload root, which is the Synology share in
 * production. `sld` and `sdd` remain so files uploaded before 2026-09-25 stay reachable; nothing
 * writes to them any more.
 */
export type ShipmentStructuredDocKind = 'contract' | 'si' | 'bl' | 'sld' | 'sdd';

const SHIPMENT_STRUCTURED_DOC_KINDS = new Set<ShipmentStructuredDocKind>([
  'contract',
  'si',
  'bl',
  'sld',
  'sdd',
]);

/** Relative subdir under upload root for Synology-ready shipment document layout. */
export function buildShipmentDocumentUploadSubdir(
  shipmentId: string,
  kind: ShipmentStructuredDocKind,
): string {
  const safeId = String(shipmentId ?? '')
    .trim()
    .replace(/[^\w-]/g, '_')
    .slice(0, 64);
  if (!safeId) {
    throw new Error('shipment_id is required for structured shipment document uploads');
  }
  if (!SHIPMENT_STRUCTURED_DOC_KINDS.has(kind)) {
    throw new Error(`Unsupported shipment document kind: ${kind}`);
  }
  return path.posix.join('shipments', safeId, kind);
}

/**
 * Map API document_type to its structured shipment subfolder.
 *
 * A type that is not listed returns null and the file lands in the flat upload root - which is what
 * happened to Contract, SI and BL documents until they were added here, so they never reached the
 * shipments/<id>/<kind> layout the Synology share expects.
 */
export function shipmentStructuredDocKindFromType(
  documentType: string,
): ShipmentStructuredDocKind | null {
  const normalized = String(documentType ?? '').trim().toUpperCase();
  if (normalized === 'CONTRACT') return 'contract';
  if (normalized === 'SI') return 'si';
  if (normalized === 'BL') return 'bl';
  if (normalized === 'SLD') return 'sld';
  if (normalized === 'SDD') return 'sdd';
  return null;
}

/** Resolve stored path for filesystem reads (supports legacy absolute rows). */
export function resolveUploadAbsolutePath(storedPath: string): string {
  const raw = String(storedPath ?? '').trim();
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }
  return path.resolve(process.cwd(), raw);
}
