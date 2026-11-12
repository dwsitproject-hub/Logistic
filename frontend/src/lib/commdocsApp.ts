import { canViewPermission, type PermFlags } from '@/components/PermissionsContext'

/**
 * Commercial Documents moves to its own app (frontend-commdocs/, same backend), in two steps. Both switches are read at BUILD time, so each must be an ARG in frontend/Dockerfile.
 *
 * NEXT_PUBLIC_COMMDOCS_URL is that app's public origin. Empty = KLIP is unchanged. When set:
 * - Commercial Dashboard leaves KLIP's menu and its old KLIP address forwards to the app's dashboard (bookmarks keep working);
 * - the Commercial Documents page stays, with a notice that it is going away and a button to the app;
 * - a user with no KLIP page left who may use the new app (the document-only roles) is sent there instead of "no access".
 *
 * NEXT_PUBLIC_COMMDOCS_DOCUMENTS_MOVED=true is the second step. Commercial Documents then leaves the menu too and its old address forwards to the app's documents.
 */
export function commdocsUrl(raw: string | undefined = process.env.NEXT_PUBLIC_COMMDOCS_URL): string | null {
  const value = String(raw || '').trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(value) ? value : null
}

/** Second step: Commercial Documents also leaves KLIP (menu and address). Off until Ryan switches it on at build. */
export function commdocsDocumentsMoved(raw: string | undefined = process.env.NEXT_PUBLIC_COMMDOCS_DOCUMENTS_MOVED): boolean {
  return /^(1|true|yes)$/i.test(String(raw || '').trim())
}

/** KLIP path -> the page that replaces it in the new app, per step. */
const DASHBOARD_MOVED: Record<string, string> = { '/commercial-dashboard': '/dashboard' }
const DOCUMENTS_MOVED: Record<string, string> = { '/commercial-documents': '/documents' }

/** The pages that have left KLIP for the new app, given the address and whether the second step is on. Nothing without an address. */
export function movedToCommercialApp(
  appUrl: string | null = commdocsUrl(),
  documentsMoved: boolean = commdocsDocumentsMoved(),
): Record<string, string> {
  if (!appUrl) return {}
  return documentsMoved ? { ...DASHBOARD_MOVED, ...DOCUMENTS_MOVED } : { ...DASHBOARD_MOVED }
}

export function withoutMovedPages<T extends { href: string }>(
  items: T[],
  appUrl: string | null = commdocsUrl(),
  documentsMoved: boolean = commdocsDocumentsMoved(),
): T[] {
  const moved = movedToCommercialApp(appUrl, documentsMoved)
  return items.filter((item) => !(item.href in moved))
}

/** The new app's address for a KLIP path that moved there, or null. */
export function movedPageUrl(
  pathname: string,
  appUrl: string | null = commdocsUrl(),
  documentsMoved: boolean = commdocsDocumentsMoved(),
): string | null {
  const moved = movedToCommercialApp(appUrl, documentsMoved)
  const hit = Object.keys(moved).find((p) => pathname === p || pathname.startsWith(`${p}/`))
  return hit ? `${appUrl}${moved[hit]}` : null
}

/** Where the Commercial Documents notice sends a user: the app's documents page, or null when the app's address is not set. */
export function commercialDocumentsAppUrl(appUrl: string | null = commdocsUrl()): string | null {
  return appUrl ? `${appUrl}${DOCUMENTS_MOVED['/commercial-documents']}` : null
}

/** Where a user with no KLIP page goes: the new app when their role may open one of its pages, else nowhere (null). */
export function commercialAppDestination(
  perms: { byKey: Record<string, PermFlags>; loaded: boolean },
  appUrl: string | null = commdocsUrl(),
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
