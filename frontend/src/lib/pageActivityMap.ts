/** First path segment for /api/activity/recent?page= */
export function pathToActivityPage(pathname: string | null): string {
  if (!pathname || pathname === '/') return 'dashboard'
  const seg = pathname.replace(/^\//, '').split('/')[0]
  return seg || 'dashboard'
}
