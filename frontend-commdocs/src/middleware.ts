import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Documents and RSC payloads name the current chunk hashes. A browser or proxy that keeps them after a deploy
 * asks for files the new container no longer has (ChunkLoadError, then React #423). Hashed files under
 * /_next/static stay immutable via next.config.js and are excluded here. See docs/COD-BUGFIX-HISTORY.md.
 */
export function middleware(_request: NextRequest) {
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pdf)$).*)'],
}
