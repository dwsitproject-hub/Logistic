import { describe, expect, it } from 'vitest';
import {
  AgentLesson,
  detectStatedPreferences,
  renderLessonsForPrompt,
} from './agentAiMemory.service';

const lesson = (kind: AgentLesson['kind'], text: string): AgentLesson => ({
  id: `id-${text.slice(0, 8)}`,
  kind,
  lesson: text,
  learnedFromUserId: null,
});

describe('detectStatedPreferences', () => {
  it('captures a brevity complaint', () => {
    const found = detectStatedPreferences('this is too long, be brief next time');
    expect(found.some((f) => /short/i.test(f.lesson))).toBe(true);
  });

  it('does not invent a preference from an ordinary question', () => {
    expect(detectStatedPreferences('what is the outstanding quantity for CPO?')).toEqual([]);
    // A bare mention of a unit is not a request to switch to it.
    expect(detectStatedPreferences('the report shows 500 MT')).toEqual([]);
  });

  it('stores no figures — lessons must outlive the data', () => {
    for (const q of [
      'too long, keep it short',
    ]) {
      for (const f of detectStatedPreferences(q)) {
        // "1 MT = 1,000 Kg" is a unit definition, not app data; allow only that.
        const withoutConversion = f.lesson.replace(/1 MT = 1,000 Kg\.?/i, '');
        expect(withoutConversion).not.toMatch(/\d/);
      }
    }
  });
});

describe('team-wide scope', () => {
  it('applies a lesson regardless of who taught it', () => {
    // learnedFromUserId is attribution only; it must never gate application.
    const taughtByColleague: AgentLesson = {
      id: 'x',
      kind: 'preference',
      lesson: 'Report quantities in MT (metric tonnes) rather than Kg.',
      learnedFromUserId: 'some-other-user-uuid',
    };
    expect(renderLessonsForPrompt([taughtByColleague])).toContain('Report quantities in MT');
  });
});

describe('renderLessonsForPrompt', () => {
  it('returns nothing when there is nothing learned yet', () => {
    expect(renderLessonsForPrompt([])).toBe('');
  });

  it('groups by kind and leads with corrections', () => {
    const out = renderLessonsForPrompt([
      lesson('definition', 'Area names mean Group Plant.'),
      lesson('correction', 'Never answer an area question with company-wide totals.'),
      lesson('preference', 'Report quantities in MT.'),
    ]);
    expect(out.indexOf('Corrections already made')).toBeLessThan(out.indexOf('How this user wants'));
    expect(out.indexOf('How this user wants')).toBeLessThan(out.indexOf('What these terms mean'));
    expect(out).toContain('- Area names mean Group Plant.');
    expect(out).toContain('standing instructions');
  });

  it('omits a heading whose kind has no lessons', () => {
    const out = renderLessonsForPrompt([lesson('preference', 'Report quantities in MT.')]);
    expect(out).toContain('How this user wants');
    expect(out).not.toContain('Corrections already made');
    expect(out).not.toContain('What these terms mean');
  });
});
