function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SapAutoImportEmailFile {
  fileName: string;
  status: 'completed' | 'failed' | 'skipped';
  importId?: string;
  processedRecords?: number;
  skippedRecords?: number;
  failedRecords?: number;
  failedFileName?: string | null;
  failedDownloadUrl?: string | null;
  failedSharePath?: string | null;
  errorMessage?: string;
  errorLogSnippet?: string[];
}

export type SapAutoImportEmailKind = 'skipped_in_flight' | 'no_new_files' | 'run_summary' | 'source_missing';

export interface SapAutoImportEmailInput {
  kind: SapAutoImportEmailKind;
  frontendUrl: string;
  files?: SapAutoImportEmailFile[];
  filesSkippedChecksum?: number;
  /** source_missing only: the folder the job looked for inside the backend container. */
  sourcePath?: string;
}

export function buildSapAutoImportEmailSubject(input: SapAutoImportEmailInput): string {
  if (input.kind === 'skipped_in_flight') {
    return 'KLIP SAP Auto Import: skipped (import already running)';
  }
  if (input.kind === 'no_new_files') {
    return 'KLIP SAP Auto Import: no new files';
  }
  if (input.kind === 'source_missing') {
    // Not "no new files": nothing was looked at. The two used to read the same, which hid a dead share for half a day.
    return 'KLIP SAP Auto Import: the SAP share cannot be read - nothing was imported';
  }
  const files = input.files ?? [];
  const failedRows = files.reduce((sum, f) => sum + (f.failedRecords ?? 0), 0);
  const processedFiles = files.filter((f) => f.status !== 'skipped').length;
  if (failedRows > 0) {
    return `KLIP SAP Auto Import: ${processedFiles} file(s) processed (${failedRows} failed row${failedRows === 1 ? '' : 's'})`;
  }
  return `KLIP SAP Auto Import: ${processedFiles} file(s) processed`;
}

function statsRow(file: SapAutoImportEmailFile, frontendUrl: string): string {
  const processed = file.processedRecords ?? 0;
  const skipped = file.skippedRecords ?? 0;
  const failed = file.failedRecords ?? 0;
  const history =
    file.importId != null
      ? `<a href="${escapeHtml(`${frontendUrl}/sap-imports/${file.importId}`)}">Import History</a>`
      : '—';
  const failedLinkParts: string[] = [];
  if (file.failedDownloadUrl) {
    failedLinkParts.push(`<a href="${escapeHtml(file.failedDownloadUrl)}">Download Failed workbook</a>`);
  }
  if (file.failedSharePath) {
    failedLinkParts.push(`File Station: <code>${escapeHtml(file.failedSharePath)}</code>`);
  }
  const errors = (file.errorLogSnippet ?? []).slice(0, 8);
  const errorBlock =
    errors.length > 0
      ? `<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:#7f1d1d;">${errors
          .map((e) => `<li>${escapeHtml(e)}</li>`)
          .join('')}</ul>`
      : file.errorMessage
        ? `<p style="margin:8px 0 0;font-size:12px;color:#7f1d1d;">${escapeHtml(file.errorMessage)}</p>`
        : '';

  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px;">
      <div style="font-weight:600;margin-bottom:8px;">${escapeHtml(file.fileName)}</div>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr>
          <td style="background:#f0fdf4;padding:8px;width:33%;">Processed<br><strong>${processed}</strong></td>
          <td style="background:#f8fafc;padding:8px;width:33%;">Skipped<br><strong>${skipped}</strong></td>
          <td style="background:#fef2f2;padding:8px;width:33%;">Failed<br><strong style="color:#991b1b;">${failed}</strong></td>
        </tr>
      </table>
      <p style="margin:8px 0 0;font-size:13px;">Status: ${escapeHtml(file.status)} · ${history}</p>
      ${failedLinkParts.length > 0 ? `<p style="margin:6px 0 0;font-size:13px;">${failedLinkParts.join(' · ')}</p>` : ''}
      ${errorBlock}
    </div>`;
}

export function buildSapAutoImportEmailHtml(input: SapAutoImportEmailInput): string {
  const frontendUrl = input.frontendUrl.replace(/\/$/, '');

  if (input.kind === 'skipped_in_flight') {
    return `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;">
        <h2 style="margin:0 0 12px;">SAP auto-import skipped</h2>
        <p>The 07:00 scheduler did not start because another SAP import is already running (processing or pending).</p>
        <p>Drop files stay in <code>Klip/SAP Data/Original</code> and will be picked up on the next run (or after you start a manual run).</p>
        <p><a href="${escapeHtml(`${frontendUrl}/sap-imports`)}">Open SAP Data → Import History</a></p>
      </div>`;
  }

  if (input.kind === 'source_missing') {
    return `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;">
        <h2 style="margin:0 0 12px;color:#991b1b;">SAP auto-import could not read the share</h2>
        <p>The scheduler ran, but the source folder${input.sourcePath ? ` <code>${escapeHtml(input.sourcePath)}</code>` : ''} is not readable inside the backend container, so <strong>no file was looked at and nothing was imported</strong>. This is not a quiet morning.</p>
        <p>Likely causes: the route from the server to the Synology is broken (for example a Docker network took the office LAN subnet 172.30.0.0/16), or the share mount on the host is dead. On the backend host: <code>ip route get 172.30.1.94</code> should not go through a <code>br-</code> device, and <code>ls /mnt/synology-apps</code> should list the share.</p>
        <p>Once the share is readable, open SAP Data and press <strong>Sync</strong> to import the newest file without waiting for the next schedule.</p>
        <p><a href="${escapeHtml(`${frontendUrl}/sap-imports`)}">Open SAP Data → Import History</a></p>
      </div>`;
  }

  if (input.kind === 'no_new_files') {
    return `
      <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;">
        <h2 style="margin:0 0 12px;">SAP auto-import — no new files</h2>
        <p>The scheduler ran at 07:00 Asia/Jakarta. There were no new Excel files in <code>Klip/SAP Data/Original</code> (or every file was already processed by checksum).</p>
        <p><a href="${escapeHtml(`${frontendUrl}/sap-imports`)}">Open SAP Data → Import History</a></p>
      </div>`;
  }

  const files = input.files ?? [];
  const skippedChecksum = input.filesSkippedChecksum ?? 0;
  const fileBlocks = files.map((f) => statsRow(f, frontendUrl)).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;max-width:720px;">
      <h2 style="margin:0 0 12px;">SAP auto-import results</h2>
      <p>MASTER v2 import from <code>Klip/SAP Data/Original</code>. Original files were left in place. Success/Failed workbooks (when non-empty) were written beside them.</p>
      ${skippedChecksum > 0 ? `<p>${skippedChecksum} file(s) skipped because the same SHA-256 was already imported.</p>` : ''}
      ${fileBlocks || '<p>No files were processed.</p>'}
      <p style="margin-top:16px;"><a href="${escapeHtml(`${frontendUrl}/sap-imports`)}">Open SAP Data → Import History</a></p>
    </div>`;
}
