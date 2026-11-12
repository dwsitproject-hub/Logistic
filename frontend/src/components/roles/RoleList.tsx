'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { roleToneClass } from '@/lib/userDirectory'

export interface RoleListItem {
  id: string
  role_name: string
  display_name: string
}

interface Props {
  roles: RoleListItem[]
  selectedId: string
  onSelect: (id: string) => void
  /** Head count per role code; null when the users could not be loaded (the counts are then left out). */
  counts: Record<string, number> | null
}

/** The roles to pick from, with a search box and how many people hold each. The selected one is highlighted. */
export function RoleList({ roles, selectedId, onSelect, counts }: Props) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return roles
    return roles.filter((role) => role.display_name.toLowerCase().includes(needle) || role.role_name.toLowerCase().includes(needle))
  }, [roles, query])

  return (
    <aside className="rounded-xl border border-gray-200 bg-white p-2" aria-label="Roles">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find role"
          className="h-9 pl-8 text-sm"
          aria-label="Find role"
        />
      </div>
      <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
        {shown.map((role) => {
          const selected = role.id === selectedId
          const count = counts ? (counts[role.role_name] ?? 0) : null
          return (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => onSelect(role.id)}
                aria-current={selected ? 'true' : undefined}
                className={
                  selected
                    ? 'flex w-full items-center gap-2 rounded-lg bg-blue-50 px-2.5 py-2 text-left text-sm font-medium text-blue-800'
                    : 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-50'
                }
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${roleToneClass(role.role_name).split(' ')[0]}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{role.display_name}</span>
                {count != null ? (
                  <span className={selected ? 'text-xs tabular-nums text-blue-600' : 'text-xs tabular-nums text-gray-400'}>{count}</span>
                ) : null}
              </button>
            </li>
          )
        })}
        {shown.length === 0 ? <li className="px-2.5 py-6 text-center text-xs text-gray-500">No role matches</li> : null}
      </ul>
    </aside>
  )
}
