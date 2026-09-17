/** Normalize email for storage and lookup (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

/** Derive internal username from email (DB column kept for JWT/audit compatibility). */
export function deriveUsernameFromEmail(email: string): string {
  return normalizeEmail(email);
}
