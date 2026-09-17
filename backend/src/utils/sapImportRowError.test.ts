import { describe, expect, it } from 'vitest';
import {
  dedupeImportRetryRows,
  formatSapImportIdentity,
  formatSapImportRowError,
  isDeadlockError,
  isFollowOnAbortedTransactionError,
  isRetryableFollowOnImportError,
  mergeFollowOnRetryCounts,
} from './sapImportRowError';

describe('formatSapImportIdentity', () => {
  it('shows PO and Contract, and STO when present', () => {
    expect(
      formatSapImportIdentity({ poNumber: '4500123', contractNumber: 'CTR-1', stoNumber: 'STO-9' }),
    ).toBe('PO 4500123 (Contract CTR-1, STO STO-9)');
    expect(formatSapImportIdentity({ poNumber: '4500123', contractNumber: 'CTR-1' })).toBe(
      'PO 4500123 (Contract CTR-1)',
    );
  });

  it('uses not found when identity is missing', () => {
    expect(formatSapImportIdentity({})).toBe('PO not found (Contract not found)');
  });
});

describe('formatSapImportRowError', () => {
  it('explains a missing PO without using a row number', () => {
    expect(
      formatSapImportRowError({
        poNumber: null,
        contractNumber: 'CTR-88',
        rawMessage: 'Row skipped: PO number is required',
      }),
    ).toBe('PO not found: this Excel row has no PO number, so it was skipped. Contract No: CTR-88.');
  });

  it('maps aborted-transaction follow-on errors to a batch explanation', () => {
    expect(isFollowOnAbortedTransactionError('current transaction is aborted, commands ignored')).toBe(
      true,
    );
    expect(
      formatSapImportRowError({
        poNumber: '4500999',
        contractNumber: 'CTR-2',
        rawMessage: 'current transaction is aborted, commands ignored until end of transaction block',
      }),
    ).toBe('PO 4500999 (Contract CTR-2): skipped because an earlier row in this batch failed.');
  });

  it('keeps PO and Contract on other database errors', () => {
    expect(
      formatSapImportRowError({
        poNumber: '4500111',
        contractNumber: 'CTR-3',
        rawMessage: 'invalid input syntax for type date: "32.13.2026"',
      }),
    ).toBe('PO 4500111 (Contract CTR-3): Invalid date value in this row.');
  });
});

describe('follow-on retry eligibility', () => {
  it('retries raw aborted-transaction and formatted follow-on messages only', () => {
    expect(isRetryableFollowOnImportError('current transaction is aborted, commands ignored')).toBe(
      true,
    );
    expect(
      isRetryableFollowOnImportError(
        'PO 1011003069 (Contract 1014003069, STO 1016011077): skipped because an earlier row in this batch failed.',
      ),
    ).toBe(true);
    expect(isRetryableFollowOnImportError('PO not found: this Excel row has no PO number, so it was skipped.')).toBe(
      false,
    );
    expect(isRetryableFollowOnImportError('PO 1 (Contract 2): Invalid date value in this row.')).toBe(false);
  });

  it('retries a genuine deadlock on the row itself, not just follow-on victims', () => {
    const deadlockMessage =
      'PO 1001027015 (Contract 1004027015): deadlock detected - Process 20167 waits for ' +
      'ShareLock on transaction 1178794; blocked by process 20521.';
    expect(isDeadlockError(deadlockMessage)).toBe(true);
    expect(isRetryableFollowOnImportError(deadlockMessage)).toBe(true);
    expect(
      formatSapImportRowError({
        poNumber: '1001027015',
        contractNumber: '1004027015',
        rawMessage: 'deadlock detected - Process 20167 waits for ShareLock on transaction 1178794',
      }),
    ).toBe(
      'PO 1001027015 (Contract 1004027015): deadlock detected - Process 20167 waits for ShareLock on transaction 1178794',
    );
  });

  it('dedupes retry rows by rowIndex and merges counts after one retry pass', () => {
    expect(
      dedupeImportRetryRows([
        { rowIndex: 2 },
        { rowIndex: 5 },
        { rowIndex: 2 },
      ]).map((r) => r.rowIndex),
    ).toEqual([2, 5]);

    expect(
      mergeFollowOnRetryCounts({
        originalProcessed: 100,
        originalSkipped: 10,
        originalFailed: 5,
        retriedFollowOnCount: 2,
        retryProcessed: 2,
        retrySkipped: 0,
        retryFailed: 0,
      }),
    ).toEqual({ processedRecords: 102, skippedRecords: 10, failedRecords: 3 });
  });
});
