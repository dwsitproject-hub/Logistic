import { describe, expect, it } from 'vitest';
import { escapeControlCharsInJsonStrings } from './agentAi.controller';

/**
 * Regression: a live Claude answer emitted a raw newline inside a JSON string value,
 * so JSON.parse threw "Bad control character in string literal" and the whole reply
 * collapsed into `answer` with report/insights lost. Structured outputs are the primary
 * fix; this guards the repair fallback.
 */
describe('escapeControlCharsInJsonStrings', () => {
  it('repairs a raw newline inside a string value', () => {
    const broken = '{"answer": "step 1\nstep 2", "report": ""}';
    expect(() => JSON.parse(broken)).toThrow();
    const parsed = JSON.parse(escapeControlCharsInJsonStrings(broken));
    expect(parsed.answer).toBe('step 1\nstep 2');
    expect(parsed.report).toBe('');
  });

  it('repairs raw tabs and carriage returns', () => {
    const broken = '{"a": "x\ty", "b": "p\rq"}';
    const parsed = JSON.parse(escapeControlCharsInJsonStrings(broken));
    expect(parsed.a).toBe('x\ty');
    expect(parsed.b).toBe('p\rq');
  });

  it('leaves already-valid JSON byte-identical', () => {
    const valid = '{"answer":"line1\\nline2","report":"","insights":"ok","comparison":""}';
    expect(escapeControlCharsInJsonStrings(valid)).toBe(valid);
    expect(JSON.parse(escapeControlCharsInJsonStrings(valid)).answer).toBe('line1\nline2');
  });

  it('does not touch newlines between tokens, only inside strings', () => {
    const pretty = '{\n  "answer": "hi",\n  "report": ""\n}';
    expect(escapeControlCharsInJsonStrings(pretty)).toBe(pretty);
    expect(JSON.parse(escapeControlCharsInJsonStrings(pretty)).answer).toBe('hi');
  });

  it('preserves escaped quotes and backslashes inside strings', () => {
    const valid = '{"answer":"he said \\"hi\\" and a path C:\\\\tmp"}';
    const parsed = JSON.parse(escapeControlCharsInJsonStrings(valid));
    expect(parsed.answer).toBe('he said "hi" and a path C:\\tmp');
  });

  it('handles the real-world shape that failed in production', () => {
    // Mirrors the observed failure: most newlines escaped, one raw newline slipping through.
    const broken =
      '{\n  "answer": "Answer (direct):\\nThe headline KPI shows 0 late trucking.\n3. Some products show NEGATIVE outstanding quantity.",\n  "report": "",\n  "insights": "check it",\n  "comparison": ""\n}';
    expect(() => JSON.parse(broken)).toThrow(/control character/i);
    const parsed = JSON.parse(escapeControlCharsInJsonStrings(broken));
    expect(parsed.answer).toContain('Answer (direct):');
    expect(parsed.answer).toContain('NEGATIVE outstanding quantity');
    expect(parsed.insights).toBe('check it');
  });
});
