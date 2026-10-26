import { canViewPermission, type PermFlags } from '@/components/PermissionsContext'

/**
 * Commercial Documents moves to its own app (frontend-commercial/, same backend). The switch is NEXT_PUBLIC_COMMERCIAL_DOCS_URL,
 * that app's public origin - read at BUILD time, so it must be an ARG in frontend/Dockerfile. Empty = KLIP is unchanged.
 *
 * When set:
 * - KLIP's menu no longer lists Commercial Documents and Commercial Dashboard;
 * - their old KLIP addresses forward to the same page in the new app (bookmarks keep working);
 * - a user with no KLIP page left who may use the new app (the document-only roles) is sent there instead of "no access".
 */
export function commercialDocsUrl(raw: string | undefined = process.env.NEXT_PUBLIC_COMMERCIAL_DOCS_URL): string | null {
  const value = String(raw || '').trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(value) ? value : null
}

/** KLIP path -> the page that replaces it in the new app. */
export const MOVED_TO_COMMERCIAL_APP: Record<string, string> = {
  '/commercial-documents': '/documents',
  '/commercial-dashboard': '/dashboard',
}

export function withoutMovedPages<T extends { href: string }>(items: T[], appUrl: string | null = commercialDocsUrl()): T[] {
  return appUrl ? items.filter((item) => !(item.href in MOVED_TO_COMMERCIAL_APP)) : items
}

/** The new app's address for a KLIP path that moved there, or null. */
export function movedPageUrl(pathname: string, appUrl: string | null = commercialDocsUrl()): string | null {
  if (!appUrl) return null
  const hit = Object.keys(MOVED_TO_COMMERCIAL_APP).find((p) => pathname === p || pathname.startsWith(`${p}/`))
  return hit ? `${appUrl}${MOVED_TO_COMMERCIAL_APP[hit]}` : null
}

/** Where a user with no KLIP page goes: the new app when their role may open one of its pages, else nowhere (null). */
export function commercialAppDestination(
  perms: { byKey: Record<string, PermFlags>; loaded: boolean },
  appUrl: string | null = commercialDocsUrl(),
): string | null {
  if (!appUrl) return null
  const may = canViewPermission(perms, 'page.commercial_documents') || canViewPermission(perms, 'page.commercial_dashboard')
  return may ? `${appUrl}/` : null
}

/** router.replace for KLIP paths; a full page load for the other app's absolute URL. */
export function navigateTo(router: { replace: (href: string) => void }, href: string): void {
  if (/^https?:\/\//i.test(href)) window.location.assign(href)
  else router.replace(href)
}
