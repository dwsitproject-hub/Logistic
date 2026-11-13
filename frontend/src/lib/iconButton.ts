/**
 * The icon-only action buttons of a page (New, Sync, Upload, Download, Roles...): a 36px square with no outline, the icon in the colour of what
 * the button does, and a light wash of the same colour behind it while the cursor is over it, like the icon buttons in a table's Actions column.
 * The colour says the kind of action, not the page, so Sync and Add never look alike:
 *
 *   add      blue     New / Add
 *   sync     violet   Sync / Refresh
 *   upload   amber    Upload / Import
 *   download green    Download / Export / Template
 *   neutral  slate    look at something or go somewhere (Roles, Activity log, Back, Columns)
 *   danger   rose     Delete / Reject
 *
 * Put it on a `<Button variant="ghost" size="icon" className={iconButtonClass('add')}>`, and give the button a `title` and an `aria-label`.
 */
export type IconButtonTone = 'add' | 'sync' | 'upload' | 'download' | 'neutral' | 'danger'

const BASE = 'h-9 w-9 shrink-0 disabled:opacity-60'

export const ICON_BUTTON_TONE_CLASS: Record<IconButtonTone, string> = {
  add: 'text-blue-600 hover:bg-blue-50 hover:text-blue-700',
  sync: 'text-violet-600 hover:bg-violet-50 hover:text-violet-700',
  upload: 'text-amber-600 hover:bg-amber-50 hover:text-amber-700',
  download: 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700',
  neutral: 'text-slate-600 hover:bg-slate-100 hover:text-slate-800',
  danger: 'text-rose-600 hover:bg-rose-50 hover:text-rose-700',
}

export function iconButtonClass(tone: IconButtonTone): string {
  return `${BASE} ${ICON_BUTTON_TONE_CLASS[tone]}`
}
