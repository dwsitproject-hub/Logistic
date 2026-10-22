/** Pure helpers of the e-mailed set-password link (invitation / forgot password), kept apart from the pages so they can be tested. */

export type PasswordLinkPurpose = 'INVITE' | 'RESET'

/** The same minimum the server enforces (`MIN_PASSWORD_LENGTH` in the backend authToken service). */
export const MIN_PASSWORD_LENGTH = 6

/** The `token` of a `?token=...` query string, or '' when there is none. */
export function readTokenFromSearch(search: string): string {
  const params = new URLSearchParams(String(search ?? '').replace(/^\?/, ''))
  return (params.get('token') ?? '').trim()
}

/** What the new-password form says, for the kind of link that was opened. */
export function describePasswordLink(purpose: PasswordLinkPurpose | null | undefined): {
  title: string
  description: string
  submitLabel: string
} {
  if (purpose === 'INVITE') {
    return {
      title: 'Set your password',
      description: 'Welcome to KLIP. Choose a password to activate your account.',
      submitLabel: 'Activate account',
    }
  }
  return {
    title: 'Reset your password',
    description: 'Choose a new password for your KLIP account.',
    submitLabel: 'Save new password',
  }
}

/** A message for the first problem with the new password, or null when it is fine. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password !== confirm) return 'Passwords do not match'
  return null
}
