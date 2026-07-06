const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const MONTH_LOOKUP: Record<string, number> = {};
for (let i = 0; i < MONTH_ABBR.length; i += 1) {
  MONTH_LOOKUP[MONTH_ABBR[i].toLowerCase()] = i + 1;
}

function sliceIsoDate10(iso: string): { yyyy: number; mm: number; dd: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const cal = new Date(yyyy, mm - 1, dd);
  if (cal.getFullYear() !== yyyy || cal.getMonth() !== mm - 1 || cal.getDate() !== dd) return null;
  return { yyyy, mm, dd };
}

function toIso10(yyyy: number, mm: number, dd: number): string {
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Format ISO date for trucking planning template headers (e.g. `6-Jul` or `6-Jul-2026`). */
export function formatPlanningTemplateDateHeader(
  iso: string,
  options?: { includeYear?: boolean },
): string {
  const parts = sliceIsoDate10(iso);
  if (!parts) return iso;
  const { yyyy, mm, dd } = parts;
  const mon = MONTH_ABBR[mm - 1];
  if (!mon) return iso;
  if (options?.includeYear) {
    return `${dd}-${mon}-${yyyy}`;
  }
  return `${dd}-${mon}`;
}

/**
 * Parse planning template date text (`6-Jul`, `6-Jul-2026`) to YYYY-MM-DD.
 * Returns null when the text is not a recognized planning date format.
 */
export function parsePlanningTemplateDateText(
  text: string,
  referenceIso?: string,
): string | null {
  const t = text.trim().replace(/^"|"$/g, '');
  if (!t) return null;

  const withYear = /^(\d{1,2})[-\s]+([A-Za-z]{3,})[-\s]+(\d{2,4})$/.exec(t);
  if (withYear) {
    const dd = Number(withYear[1]);
    const mon = withYear[2].slice(0, 3).toLowerCase();
    let yyyy = Number(withYear[3]);
    if (withYear[3].length === 2) {
      yyyy = yyyy + (yyyy >= 70 ? 1900 : 2000);
    }
    const mm = MONTH_LOOKUP[mon];
    if (!mm) return null;
    const cal = new Date(yyyy, mm - 1, dd);
    if (cal.getFullYear() !== yyyy || cal.getMonth() !== mm - 1 || cal.getDate() !== dd) return null;
    return toIso10(yyyy, mm, dd);
  }

  const noYear = /^(\d{1,2})[-\s]+([A-Za-z]{3,})$/.exec(t);
  if (noYear) {
    const dd = Number(noYear[1]);
    const mon = noYear[2].slice(0, 3).toLowerCase();
    const mm = MONTH_LOOKUP[mon];
    if (!mm) return null;

    const ref = referenceIso?.trim().slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const refParts = sliceIsoDate10(ref);
    const refYear = refParts?.yyyy ?? new Date().getFullYear();

    const candidates: string[] = [];
    for (const year of [refYear, refYear + 1, refYear - 1]) {
      const cal = new Date(year, mm - 1, dd);
      if (cal.getFullYear() !== year || cal.getMonth() !== mm - 1 || cal.getDate() !== dd) continue;
      candidates.push(toIso10(year, mm, dd));
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const refTime = refParts
      ? new Date(refParts.yyyy, refParts.mm - 1, refParts.dd).getTime()
      : Date.now();
    let best = candidates[0];
    let bestDiff = Infinity;
    for (const c of candidates) {
      const p = sliceIsoDate10(c);
      if (!p) continue;
      const candidateTime = new Date(p.yyyy, p.mm - 1, p.dd).getTime();
      const diff = Math.abs(candidateTime - refTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = c;
      }
    }
    return best;
  }

  return null;
}
