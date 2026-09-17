import { describe, expect, it } from 'vitest';
import { normalizePipelineVesselNameList } from './pipelineVesselNames';

describe('normalizePipelineVesselNameList', () => {
  it('canonicalizes compound SAP tug/barge names and dedupes', () => {
    const names = normalizePipelineVesselNameList([
      'TB. AS MARINA 9 / BG. AS MARINA 12',
      'BG. AS MARINA 12',
      '  bg. as marina 12  ',
    ]);
    expect(names).toEqual(['BG. AS MARINA 12']);
  });

  it('returns sorted distinct names', () => {
    expect(normalizePipelineVesselNameList(['ZETA', 'ALPHA', 'ALPHA'])).toEqual(['ALPHA', 'ZETA']);
  });
});
