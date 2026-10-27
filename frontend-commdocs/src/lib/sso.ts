/**
 * Hub SSO: the backend sends the browser back to /login?error=<code> when a sign-in through DWS Hub does not complete, and to
 * /sso/callback?t=<jwt> when it does (same contract as KLIP's login page).
 */
export function ssoErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'sso_no_access':
      return 'Your account is not registered for SSO access. Contact your administrator.'
    case 'sso_failed':
    case 'sso_not_configured':
      return 'SSO login failed. Please try again or use your email and password.'
    default:
      return ''
  }
}
