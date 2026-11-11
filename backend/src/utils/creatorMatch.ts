/**
 * Which SAP user is this COD user? Used to pre-select "Created by" on the Documents page for the person who opens it.
 *
 * There is no stored link between a COD account and a SAP user (SAP gives a NIK and a name; the account has an e-mail and a full name), so the link is
 * the name: the e-mail follows first.last (vicky.vicky@energi-up.com is VICKY, a one-word name written twice), so the words of the part before the "@"
 * - or of the full name - must be the same words as the SAP user's name, in any order and ignoring repeats. Only a single match counts: two SAP users with
 * the same name, or none, give no default, and the filter is simply left empty. This is a convenience, never an access rule, and the person can clear it.
 * When the PRC sync brings a real link, it replaces this.
 */

export type CreatorOption = { userId: string; name: string };

/** The distinct lowercase words of a name or an e-mail's local part (letters only). */
function words(s: string): string[] {
  return [...new Set(String(s || '').toLowerCase().split(/[^a-z]+/).filter(Boolean))];
}

function sameWords(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((w) => b.includes(w));
}

export function matchCreatorForUser(user: { email?: string | null; fullName?: string | null }, options: CreatorOption[]): CreatorOption | null {
  const byEmail = words(String(user.email || '').split('@')[0]);
  const byName = words(user.fullName || '');
  const hits = options.filter((o) => {
    const w = words(o.name);
    return sameWords(byEmail, w) || sameWords(byName, w);
  });
  return hits.length === 1 ? hits[0] : null;
}
