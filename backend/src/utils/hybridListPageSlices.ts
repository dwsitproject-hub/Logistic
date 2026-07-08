/** Slice hybrid list pages: execution rows (with STO) first, contract backlog second. */

export interface HybridListPageSlices {
  executionLimit: number;
  executionOffset: number;
  contractLimit: number;
  contractOffset: number;
}

export function computeHybridListPageSlices(input: {
  offset: number;
  limit: number;
  executionRows: number;
}): HybridListPageSlices {
  const { offset, limit, executionRows } = input;

  if (offset < executionRows) {
    const executionOffset = offset;
    const executionLimit = Math.min(limit, executionRows - offset);
    const contractLimit = limit - executionLimit;
    return {
      executionOffset,
      executionLimit,
      contractLimit,
      contractOffset: 0,
    };
  }

  return {
    executionOffset: 0,
    executionLimit: 0,
    contractLimit: limit,
    contractOffset: offset - executionRows,
  };
}
