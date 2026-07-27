import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guard against parameter-numbering holes in parameterized SQL.
 *
 * PostgreSQL parses `$N` placeholders before executing: if a statement references
 * `$52` but never `$50`, it cannot infer $50's type and rejects the statement with
 * `42P18 could not determine data type of parameter $50` — 100% of the time, for
 * every row. That shipped once (SAP shipment UPDATE, 2026-07-27) and saturated the
 * staging DB with re-parses of a very large failing statement.
 *
 * A hole is always a bug: either a parameter is passed and never used, or the
 * numbering drifted from the values array.
 *
 * Statements that build part of their SET list from a helper (`${...}`) legitimately
 * look like they have holes here, because the helper's placeholders live outside the
 * literal. Those are listed in KNOWN_INTERPOLATED_PARAMS — when a helper changes,
 * update the list.
 */

const SRC_ROOT = path.join(__dirname, '..');
const STATEMENT_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;

/** Params supplied via `${...}` helper interpolation, keyed by file::first line of the statement. */
const KNOWN_INTERPOLATED_PARAMS: Record<string, number[]> = {
  // buildShipmentKlipProtectedSetSql(protectKlip, 'param')
  'services/sapDataDistribution.service.ts::UPDATE shipments SET': [3, 4, 14, 15, 19, 21],
  // buildTruckingKlipProtectedSetSql(protectKlip)
  'services/sapDataDistribution.service.ts::UPDATE trucking_operations SET': [4, 5, 11],
};

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

/** Backtick template literals, with the 1-based line where each starts. */
function templateLiterals(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('`', i);
    if (start === -1) break;
    let j = start + 1;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') j += 2;
      else j += 1;
    }
    if (j >= src.length) break;
    out.push({ text: src.slice(start + 1, j), line: src.slice(0, start).split('\n').length });
    i = j + 1;
  }
  return out;
}

describe('parameterized SQL placeholder numbering', () => {
  it('has no unreferenced $N holes in any statement', () => {
    const problems: string[] = [];

    for (const file of listTsFiles(SRC_ROOT)) {
      const relative = path.relative(SRC_ROOT, file).replace(/\\/g, '/');
      const source = fs.readFileSync(file, 'utf8');

      for (const literal of templateLiterals(source)) {
        if (!STATEMENT_START.test(literal.text)) continue;
        if (!/\$1\b/.test(literal.text)) continue;

        const referenced = new Set<number>();
        for (const match of literal.text.matchAll(/\$(\d+)/g)) referenced.add(Number(match[1]));
        const highest = Math.max(...referenced);

        const firstLine = literal.text.trim().split('\n')[0].trim();
        const allowed = new Set(KNOWN_INTERPOLATED_PARAMS[`${relative}::${firstLine}`] ?? []);

        const holes: number[] = [];
        for (let n = 1; n <= highest; n += 1) {
          if (!referenced.has(n) && !allowed.has(n)) holes.push(n);
        }
        if (holes.length > 0) {
          problems.push(
            `${relative}:${literal.line} — "${firstLine}" references up to $${highest} ` +
              `but never uses ${holes.map((n) => `$${n}`).join(', ')}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
