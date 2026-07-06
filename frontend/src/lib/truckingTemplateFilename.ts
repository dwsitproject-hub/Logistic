import { todayIsoDate } from '@/lib/truckingActualsTemplate'

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 64) || 'user'
}

export function getAuthUsernameForFilename(): string {
  if (typeof window === 'undefined') return 'user'
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return 'user'
    const user = JSON.parse(raw) as {
      username?: string
      full_name?: string
      name?: string
      email?: string
    }
    const candidate =
      user.username || user.full_name || user.name || user.email?.split('@')[0] || 'user'
    return sanitizeFilenamePart(String(candidate))
  } catch {
    return 'user'
  }
}

export function buildTruckingPlanningTemplateFilename(kind: 'unplanned' | 'planned'): string {
  const user = getAuthUsernameForFilename()
  const date = todayIsoDate()
  return `${kind}-daily-trucking-${user}-${date}.xlsx`
}
