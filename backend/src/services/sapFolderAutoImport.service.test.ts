import { describe, expect, it } from 'vitest';
import { partitionOriginalFilesByChecksum } from './sapFolderAutoImport.service';

describe('partitionOriginalFilesByChecksum', () => {
  it('skips files whose SHA-256 was already completed and keeps new or changed content', () => {
    const files = [
      { fileName: 'a.xlsx', sha256: 'aaa' },
      { fileName: 'b.xlsx', sha256: 'bbb' },
      { fileName: 'a-copy.xlsx', sha256: 'aaa' },
    ];
    const { toProcess, skipped } = partitionOriginalFilesByChecksum(files, new Set(['aaa']));
    expect(skipped.map((f) => f.fileName)).toEqual(['a.xlsx', 'a-copy.xlsx']);
    expect(toProcess).toEqual([{ fileName: 'b.xlsx', sha256: 'bbb' }]);
  });
});
