/**
 * User-facing SAP import row errors. Keeps PO / Contract identity in the message
 * instead of only "Row N", and maps common Postgres follow-on errors to English.
 */

export function isFollowOnAbortedTransactionError(message: string): boolean {
  return /current transaction is aborted/i.test(message);
}

/** Formatted or raw follow-on errors that are safe to retry once in a fresh transaction. */
export function isRetryableFollowOnImportError(message: string): boolean {
  return (
    isFollowOnAbortedTransactionError(message) ||
    /skipped because an earlier row in this batch failed/i.test(message)
  );
}

export function dedupeImportRetryRows<T extends { rowIndex: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.rowIndex)) continue;
    seen.add(row.rowIndex);
    out.push(row);
  }
  return out;
}

export function mergeFollowOnRetryCounts(input: {
  originalProcessed: number;
  originalSkipped: number;
  originalFailed: number;
  retriedFollowOnCount: number;
  retryProcessed: number;
  retrySkipped: number;
  retryFailed: number;
}): { processedRecords: number; skippedRecords: number; failedRecords: number } {
  return {
    processedRecords: input.originalProcessed + input.retryProcessed,
    skippedRecords: input.originalSkipped + input.retrySkipped,
    failedRecords: Math.max(0, input.originalFailed - input.retriedFollowOnCount + input.retryFailed),
  };
}

function blankToNotFound(value?: string | null): string {
  const text = String(value || '').trim();
  return text || 'not found';
}

export function formatSapImportIdentity(input: {
  poNumber?: string | null;
  contractNumber?: string | null;
  stoNumber?: string | null;
}): string {
  const po = blankToNotFound(input.poNumber);
  const contract = blankToNotFound(input.contractNumber);
  const sto = String(input.stoNumber || '').trim();
  return sto
    ? `PO ${po} (Contract ${contract}, STO ${sto})`
    : `PO ${po} (Contract ${contract})`;
}

function humanizeRawMessage(raw: string): string {
  if (/PO number is required/i.test(raw)) {
    return 'PO not found: this Excel row has no PO number, so it was skipped.';
  }
  if (/invalid input syntax for type date/i.test(raw) || /invalid date/i.test(raw)) {
    return 'Invalid date value in this row.';
  }
  if (/value too long/i.test(raw)) {
    return 'A value in this row is longer than the field allows.';
  }
  if (/null value in column/i.test(raw) || /violates not-null/i.test(raw)) {
    return 'A required field on this row is empty.';
  }
  if (/duplicate key/i.test(raw)) {
    return 'This row conflicts with an existing record (duplicate key).';
  }
  return raw.replace(/^Row\s+\d+:\s*/i, '').trim() || 'Unknown error';
}

export function formatSapImportRowError(input: {
  poNumber?: string | null;
  contractNumber?: string | null;
  stoNumber?: string | null;
  rawMessage: string;
}): string {
  const identity = formatSapImportIdentity(input);
  const raw = String(input.rawMessage || '').trim() || 'Unknown error';

  if (isFollowOnAbortedTransactionError(raw)) {
    return `${identity}: skipped because an earlier row in this batch failed.`;
  }

  if (/PO number is required/i.test(raw)) {
    const contract = String(input.contractNumber || '').trim();
    const contractPart = contract ? ` Contract No: ${contract}.` : '';
    return `PO not found: this Excel row has no PO number, so it was skipped.${contractPart}`;
  }

  const reason = humanizeRawMessage(raw);
  return `${identity}: ${reason}`;
}
