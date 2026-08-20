import { describe, expect, it } from 'vitest';
import {
  isSapImportInFlightStatus,
  SQL_ACTIVE_SAP_IMPORT,
  SQL_SAP_IMPORT_IN_FLIGHT_EXISTS,
} from './sapImportInFlightSql';

describe('sapImportInFlightSql', () => {
  it('detects processing and pending as in-flight', () => {
    expect(isSapImportInFlightStatus('processing')).toBe(true);
    expect(isSapImportInFlightStatus('pending')).toBe(true);
    expect(isSapImportInFlightStatus('completed')).toBe(false);
    expect(isSapImportInFlightStatus(null)).toBe(false);
  });

  it('active import SQL filters in-flight statuses only', () => {
    expect(SQL_ACTIVE_SAP_IMPORT).toContain("'processing', 'pending'");
    expect(SQL_ACTIVE_SAP_IMPORT).toContain('LIMIT 1');
  });

  it('existence SQL is suitable for middleware guard', () => {
    expect(SQL_SAP_IMPORT_IN_FLIGHT_EXISTS).toContain('LIMIT 1');
    expect(SQL_SAP_IMPORT_IN_FLIGHT_EXISTS).toContain("'processing', 'pending'");
  });
});
