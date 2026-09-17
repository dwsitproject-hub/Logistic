import { describe, expect, it } from 'vitest';
import {
  buildSapAutoImportEmailHtml,
  buildSapAutoImportEmailSubject,
} from './sapAutoImportEmail.template';

describe('sapAutoImportEmail.template', () => {
  it('uses a short subject when no new files were found', () => {
    expect(
      buildSapAutoImportEmailSubject({
        kind: 'no_new_files',
        frontendUrl: 'http://localhost:3001',
      }),
    ).toBe('KLIP SAP Auto Import: no new files');
    const html = buildSapAutoImportEmailHtml({
      kind: 'no_new_files',
      frontendUrl: 'http://localhost:3001',
    });
    expect(html).toContain('no new files');
    expect(html).toContain('http://localhost:3001/sap-imports');
  });

  it('explains skipped-in-flight', () => {
    expect(
      buildSapAutoImportEmailSubject({
        kind: 'skipped_in_flight',
        frontendUrl: 'http://localhost:3001',
      }),
    ).toBe('KLIP SAP Auto Import: skipped (import already running)');
    expect(
      buildSapAutoImportEmailHtml({
        kind: 'skipped_in_flight',
        frontendUrl: 'http://localhost:3001',
      }),
    ).toContain('already running');
  });

  it('includes modal-style Processed/Skipped/Failed counts, history link, and failed-file download', () => {
    const html = buildSapAutoImportEmailHtml({
      kind: 'run_summary',
      frontendUrl: 'http://localhost:3001',
      filesSkippedChecksum: 1,
      files: [
        {
          fileName: 'SAP Data.xlsx',
          status: 'completed',
          importId: 'imp-1',
          processedRecords: 10,
          skippedRecords: 0,
          failedRecords: 2,
          failedFileName: '2026-08-27__SAP_Data_failed.xlsx',
          failedDownloadUrl:
            'http://localhost:3001/api/sap-master-v2/auto-import/failed-file?file=2026-08-27__SAP_Data_failed.xlsx',
          failedSharePath: 'Klip/SAP Data/Failed/2026-08-27__SAP_Data_failed.xlsx',
          errorLogSnippet: ['Row 4: PO number is required'],
        },
      ],
    });
    expect(html).toContain('Processed');
    expect(html).toContain('<strong>10</strong>');
    expect(html).toContain('<strong>0</strong>');
    expect(html).toContain('<strong style="color:#991b1b;">2</strong>');
    expect(html).toContain('/sap-imports/imp-1');
    expect(html).toContain('auto-import/failed-file?file=');
    expect(html).toContain('Klip/SAP Data/Failed/');
    expect(html).toContain('Row 4: PO number is required');
    expect(
      buildSapAutoImportEmailSubject({
        kind: 'run_summary',
        frontendUrl: 'http://localhost:3001',
        files: [{ fileName: 'a.xlsx', status: 'completed', failedRecords: 2 }],
      }),
    ).toBe('KLIP SAP Auto Import: 1 file(s) processed (2 failed rows)');
  });
});
