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
 * The folder a shipment document lands in under the upload root.
 *
 * Production mounts that root at `\\172.30.1.94\APPs\dev\KLIP`, so a Contract file for shipment
 * `abc` is `documents\shipment\contract\abc\`. SI and BL use their own folders beside it.
 * `sld` and `sdd` stay in the same tree so files uploaded before 2026-09-25 stay reachable;
 * nothing writes to them any more.
 */
export type ShipmentStructuredDocKind = 'contract' | 'si' | 'bl' | 'sld' | 'sdd';

const SHIPMENT_STRUCTURED_DOC_KINDS = new Set<ShipmentStructuredDocKind>([
  'contract',
  'si',
  'bl',
  'sld',
  'sdd',
]);

/** Relative subdir under upload root: `documents/shipment/<kind>/<shipment id>`. */
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
  return path.posix.join('documents', 'shipment', kind, safeId);
}

const SHIPMENT_NAS_FILE_TOKEN: Partial<Record<ShipmentStructuredDocKind, 'ctr' | 'si' | 'bl'>> = {
  contract: 'ctr',
  si: 'si',
  bl: 'bl',
};

/** Contract, SI, and BL use a short token in the Synology file name. SLD/SDD do not. */
export function shipmentNasFileToken(
  kind: ShipmentStructuredDocKind,
): 'ctr' | 'si' | 'bl' | null {
  return SHIPMENT_NAS_FILE_TOKEN[kind] ?? null;
}

/** Upload calendar date in Asia/Jakarta as ddmmyy. */
export function formatUploadDateDdmmyy(uploadedAt: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(uploadedAt);
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const year = parts.find((part) => part.type === 'year')?.value ?? '00';
  return `${day}${month}${year}`;
}

/** Keep a path segment readable: letters, digits, dot, underscore, hyphen. */
export function sanitizeNasNamePart(value: string, fallback: string): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * `operation_id-ctr|si|bl-ddmmyy-username`, without the extension.
 * The username is the KLIP login, not the original PDF name.
 */
export function buildShipmentNasFileStem(input: {
  operationId: string;
  token: 'ctr' | 'si' | 'bl';
  uploadedBy: string;
  uploadedAt?: Date;
}): string {
  const operationId = sanitizeNasNamePart(input.operationId, 'operation');
  const uploadedBy = sanitizeNasNamePart(input.uploadedBy, 'user');
  const date = formatUploadDateDdmmyy(input.uploadedAt ?? new Date());
  return `${operationId}-${input.token}-${date}-${uploadedBy}`;
}

/** First free name in `dir`. A second upload the same day becomes `...-2.pdf`. */
export function allocateShipmentNasFilename(dir: string, stem: string, extension: string): string {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  const safeExt = ext === '.' ? '.pdf' : ext;
  let candidate = `${stem}${safeExt}`;
  let sequence = 2;
  while (fs.existsSync(path.join(dir, candidate)) && sequence < 100) {
    candidate = `${stem}-${sequence}${safeExt}`;
    sequence += 1;
  }
  return candidate;
}

/**
 * Map API document_type to its structured shipment subfolder.
 *
 * A type that is not listed returns null and the file lands in the flat upload root - which is what
 * happened to Contract, SI and BL documents until they were added here, so they never reached
 * `documents/shipment/<kind>/<shipment id>` on the Synology share.
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
  const primary = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
  if (fs.existsSync(primary)) return primary;
  // Commercial Documents moved from "COMMERCIAL DOCS" to "commercial-docs" on the share. A path stored under either name finds its file under the other while the folder and
  // the database are being brought in step (and after a rollback), so nothing reads "File not found" in between.
  for (const alt of commercialDocsAlternates(primary)) {
    if (fs.existsSync(alt)) return alt;
  }
  return primary;
}

/** The Commercial Documents folder on the upload root: the name it has now, and the one it had until 2026-10-29. */
export const COMMERCIAL_DOCS_FOLDER = 'commercial-docs';
export const COMMERCIAL_DOCS_LEGACY_FOLDER = 'COMMERCIAL DOCS';

/** The same path with the Commercial Documents folder spelled the other way (both directions); empty when the path does not go through that folder. */
export function commercialDocsAlternates(absOrStored: string): string[] {
  const out: string[] = [];
  for (const [from, to] of [
    [COMMERCIAL_DOCS_LEGACY_FOLDER, COMMERCIAL_DOCS_FOLDER],
    [COMMERCIAL_DOCS_FOLDER, COMMERCIAL_DOCS_LEGACY_FOLDER],
  ]) {
    for (const sep of ['/', '\\']) {
      const needle = `${sep}${from}${sep}`;
      const at = absOrStored.indexOf(needle);
      if (at >= 0) out.push(absOrStored.slice(0, at) + sep + to + sep + absOrStored.slice(at + needle.length));
    }
  }
  return out;
}

/**
 * The folder a document uploaded from the Trucking page lands in under the upload root: `documents/trucking/<subject>`, where the subject is the operation id
 * (OP-LAND-...) of the operation it was uploaded on, or the contract number for a contract that has no operation yet. Production mounts the upload root at
 * the share \\172.30.1.94\APPs\dev\KLIP, so these are documents\trucking\OP-LAND-271020260001\ on Synology, beside documents\shipment\...
 */
export function buildTruckingDocumentUploadSubdir(subject: string): string {
  return path.posix.join('documents', 'trucking', sanitizeNasNamePart(subject, 'unassigned'));
}

/**
 * Folder of the upload root that holds what is imported into KLIP from files: on the Synology share, `IMPORT DATA` beside `documents` (Ryan, 2026-10-29). SAP's own export
 * folders live in the same `IMPORT DATA`, separate mounts that this does not touch.
 *
 * Quality Claim and Shortage Claim: the folder itself, `IMPORT DATA/claim-mutu` and `IMPORT DATA/claim-susut`, is where a scheduled import will pick workbooks up (not built
 * yet); a workbook a user imports by hand in the application is kept as a backup in its `manual` subfolder, so a scan of the folder never meets it and imports it twice.
 */
export const IMPORT_DATA_FOLDER = 'IMPORT DATA';

/** `IMPORT DATA/<part>/<part>...`; each part is cleaned like a file-name part, so none can climb out. */
export function importDataSubdir(...parts: string[]): string {
  return path.posix.join(IMPORT_DATA_FOLDER, ...parts.map((p) => sanitizeNasNamePart(p, 'unassigned')));
}
