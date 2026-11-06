/**
 * The user guide shipped with the app (public/COD-User-Guide.pdf).
 * When a new version of the guide is released: replace that PDF, raise GUIDE_VERSION here, and add a row to HISTORY in
 * docs/commdocs-user-guide/build-deck.cjs (the guide's own version-history slide). The two numbers must match.
 */
export const GUIDE_VERSION = 'v1'

/** Where this browser remembers which guide version the user has opened; the sidebar shows a "New" mark until it matches GUIDE_VERSION. */
export const GUIDE_SEEN_KEY = 'cd.guideSeenVersion'

/** Stable address, so links and bookmarks keep working after an update. */
export const GUIDE_URL = '/COD-User-Guide.pdf'

/** The name a downloaded copy gets, so a user can tell which version they hold. */
export const GUIDE_FILE_NAME = `COD-User-Guide-${GUIDE_VERSION}.pdf`

/** Viewer address: the version is in the query so a browser never shows a cached older guide after an update. */
export const GUIDE_VIEW_URL = `${GUIDE_URL}?v=${GUIDE_VERSION}#view=FitH`
