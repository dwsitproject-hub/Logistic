/**
 * The icon-only action buttons of a page (New, Sync, Upload, Download, Roles...): a 36px square with no outline, the icon in the colour of what
 * the button does, and a light wash of the same colour behind it while the cursor is over it, like the icon buttons in a table's Actions column.
 * The colour says the kind of action, not the page, so Sync and Add never look alike:
 *
 *   add      green    New / Add
 *   sync     amber    Sync / Refresh
 *   upload   violet   Upload / Import
 *   download teal     Download / Export / Template
 *   orange   orange   a second kind of upload that sits beside the plain one (Trucking: Upload WB)
 *   pink     pink     a third (Trucking: Upload Daily Planning)
 *   insight  sky      history and activity (User Activity Log)
 *   access   fuchsia  roles and permissions (Manage Roles)
 *   neutral  slate    go somewhere or change a view (Back, Columns)
 *   danger   rose     Delete / Reject
 *
 * Blue is left to Edit (the pencil in a table's Actions column), so no toolbar button is blue.
 *
 * Put it on a `<Button variant="ghost" size="icon" className={iconButtonClass('add')}>`, and give the button a `title` and an `aria-label`.
 */
export type IconButtonTone = 'add' | 'sync' | 'upload' | 'download' | 'orange' | 'pink' | 'insight' | 'access' | 'neutral' | 'danger'

const BASE = 'h-9 w-9 shrink-0 disabled:opacity-60'

export const ICON_BUTTON_TONE_CLASS: Record<IconButtonTone, string> = {
  add: 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700',
  sync: 'text-amber-600 hover:bg-amber-50 hover:text-amber-700',
  upload: 'text-violet-600 hover:bg-violet-50 hover:text-violet-700',
  download: 'text-teal-600 hover:bg-teal-50 hover:text-teal-700',
  orange: 'text-orange-600 hover:bg-orange-50 hover:text-orange-700',
  pink: 'text-pink-600 hover:bg-pink-50 hover:text-pink-700',
  insight: 'text-sky-600 hover:bg-sky-50 hover:text-sky-700',
  access: 'text-fuchsia-600 hover:bg-fuchsia-50 hover:text-fuchsia-700',
  neutral: 'text-slate-600 hover:bg-slate-100 hover:text-slate-800',
  danger: 'text-rose-600 hover:bg-rose-50 hover:text-rose-700',
}

export function iconButtonClass(tone: IconButtonTone): string {
  return `${BASE} ${ICON_BUTTON_TONE_CLASS[tone]}`
}
