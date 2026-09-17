import { describe, expect, it } from 'vitest';
import {
  isSapImportInProgressError,
  sapImportInProgressErrorMessage,
  SAP_IMPORT_IN_PROGRESS_CODE,
} from './sapImportInFlight';

describe('sapImportInFlight helpers', () => {
  it('detects SAP_IMPORT_IN_PROGRESS API errors', () => {
    const err = {
      response: { data: { error: { code: SAP_IMPORT_IN_PROGRESS_CODE, message: 'blocked' } } },
    };
    expect(isSapImportInProgressError(err)).toBe(true);
    expect(sapImportInProgressErrorMessage(err)).toBe('blocked');
  });

  it('returns empty string for unrelated errors', () => {
    expect(isSapImportInProgressError(new Error('nope'))).toBe(false);
    expect(sapImportInProgressErrorMessage(new Error('nope'))).toBe('');
  });
});
