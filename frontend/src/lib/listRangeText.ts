/** "1,240 contracts · 61–80": how many rows there are and which of them this page shows. With none, just "0 contracts". */
export function listRangeText(total: number, page: number, perPage: number, noun: string): string {
  const count = `${total.toLocaleString('en-US')} ${noun}`
  if (total <= 0 || perPage <= 0) return count
  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)
  return `${count} · ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')}`
}
