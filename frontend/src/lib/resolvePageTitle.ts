import { NAV_ITEMS } from '@/lib/navigationConfig'

const CHILD_PAGE_TITLES: Record<string, string> = {
  '/users/roles': 'Roles',
  '/users/activity-log': 'User Activity Log',
}

/** Header title: exact child override, then longest matching NAV_ITEMS href. */
export function resolvePageTitle(pathname: string): string {
  const exactChild = CHILD_PAGE_TITLES[pathname]
  if (exactChild) return exactChild

  const exactNav = NAV_ITEMS.find((item) => item.href === pathname)
  if (exactNav) return exactNav.name

  const prefixMatch = NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0]

  return prefixMatch?.name ?? 'KLIP'
}
