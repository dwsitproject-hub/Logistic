/**
 * Type the vitest globals the test files already use at runtime.
 *
 * `vitest.config.ts` sets `globals: true`, so `describe` / `it` / `expect` exist when the suite
 * runs - but nothing told TypeScript that, so `tsc --noEmit` reported 104 "Cannot find name"
 * errors across four test files while all 521 tests passed. A reference file rather than a
 * `types` entry in tsconfig: setting `types` would stop TypeScript auto-including every
 * `@types/*` package (node, react, d3, ...) and trade these errors for a different set.
 */
/// <reference types="vitest/globals" />
