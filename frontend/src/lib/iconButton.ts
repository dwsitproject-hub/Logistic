/**
 * The look of the icon-only action buttons of a page (Add, Sync, Import, Refresh, Roles...): a 36px square, a blue outline and a blue icon, a light blue wash on hover.
 * One constant so every page's toolbar looks the same; put it on a `<Button variant="outline" size="icon">`, and give the button a `title` and an `aria-label`.
 */
export const ICON_BUTTON_CLASS =
  'h-9 w-9 shrink-0 border-blue-200 bg-white text-blue-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-60'
