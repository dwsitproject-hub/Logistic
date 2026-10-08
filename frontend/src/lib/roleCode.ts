/**
 * The code a role is stored under, derived from the name typed on the Add Role form.
 *
 * The API accepts uppercase letters and underscores only (POST /roles), and the code is permanent: users point at it and it
 * cannot be renamed. "AR UPSTREAM" -> AR_UPSTREAM, "Tax & Claim" -> TAX_AND_CLAIM. Digits and punctuation are dropped.
 */
export const ROLE_CODE_PATTERN = /^[A-Z][A-Z_]*$/

export function deriveRoleCode(displayName: string): string {
  return String(displayName ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
}

export function isValidRoleCode(code: string): boolean {
  return ROLE_CODE_PATTERN.test(code)
}
