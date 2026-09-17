/** Max concurrent DB queries per attention-insights load (reduces pool saturation). */
export const ATTENTION_INSIGHTS_QUERY_BATCH_SIZE = 4;

/**
 * Run async tasks in sequential batches to cap peak connection usage.
 */
export async function runQueriesInBatches<T>(
  tasks: Array<() => Promise<T>>,
  batchSize = ATTENTION_INSIGHTS_QUERY_BATCH_SIZE,
): Promise<T[]> {
  const size = Math.max(1, batchSize);
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += size) {
    const batch = tasks.slice(i, i + size);
    const batchResults = await Promise.all(batch.map((task) => task()));
    results.push(...batchResults);
  }
  return results;
}
