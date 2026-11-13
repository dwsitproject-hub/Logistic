'use client'

import type { ReactNode } from 'react'
import { CircleDot, Search, Shield, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { UserStatusFilter } from '@/lib/userDirectory'

export interface RoleFilterOption {
  /** The role code (users.role). */
  value: string
  label: string
  count: number
}

interface Props {
  search: string
  onSearch: (value: string) => void
  /** A role code; empty = every role. */
  role: string
  onRole: (value: string) => void
  roleOptions: RoleFilterOption[]
  totalCount: number
  status: UserStatusFilter
  onStatus: (value: UserStatusFilter) => void
  /** How many users each status holds (all = everyone), shown after the name like the role filter. */
  statusCounts?: Partial<Record<UserStatusFilter, number>>
  /** Icon buttons at the right end of the row (Add user, Roles, Activity log), like the action icons of a table row. */
  actions?: ReactNode
}

const ALL_ROLES = '__all__'

const STATUS_OPTIONS: ReadonlyArray<{ id: UserStatusFilter; label: string }> = [
  { id: 'all', label: 'All statuses' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Invitation pending' },
  { id: 'inactive', label: 'Inactive' },
]

const statusLabel = (id: UserStatusFilter, label: string, counts?: Props['statusCounts']) => {
  const n = counts?.[id]
  return n == null ? label : `${label} (${n.toLocaleString('en-US')})`
}

/** One row: search, the role filter (every role with its head count), the status as a field, and the icon buttons. */
export function UserFilterBar({ search, onSearch, role, onRole, roleOptions, totalCount, status, onStatus, statusCounts, actions }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search name, e-mail or department"
          className="h-9 pl-9"
          aria-label="Search users"
        />
      </div>

      <Select value={role || ALL_ROLES} onValueChange={(value) => onRole(value === ALL_ROLES ? '' : value)}>
        <SelectTrigger className="h-9 w-[230px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by role">
          <Shield className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_ROLES}>All roles ({totalCount.toLocaleString('en-US')})</SelectItem>
          {roleOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label} ({option.count.toLocaleString('en-US')})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(value) => onStatus(value as UserStatusFilter)}>
        <SelectTrigger className="h-9 w-[230px] gap-2 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left" aria-label="Filter by status">
          <CircleDot className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {statusLabel(option.id, option.label, statusCounts)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {role || status !== 'all' || search ? (
        <button
          type="button"
          onClick={() => {
            onSearch('')
            onRole('')
            onStatus('all')
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear filters
        </button>
      ) : null}

      {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
