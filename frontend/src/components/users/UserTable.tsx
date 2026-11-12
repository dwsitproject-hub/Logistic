'use client'

import type { KeyboardEvent, MouseEvent } from 'react'
import { Key, Mail, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  roleToneClass,
  userInitials,
  userRegionPlants,
  userStatus,
  type DirectoryUser,
  type UserStatus,
} from '@/lib/userDirectory'

interface Props<T extends DirectoryUser> {
  users: T[]
  currentUserId?: string
  sendingLink: boolean
  roleLabel: (role: string) => string
  onEdit: (user: T) => void
  onResendInvitation: (user: T) => void
  onResetPassword: (user: T) => void
  onDeactivate: (user: T) => void
  /** A role chip was clicked: filter the list to that role. */
  onFilterRole: (role: string) => void
}

const STATUS_CHIP: Record<UserStatus, { label: string; chip: string; dot: string }> = {
  active: { label: 'Active', chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  pending: { label: 'Invitation pending', chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  inactive: { label: 'Inactive', chip: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
}

const ICON_BUTTON = 'h-8 w-8 border-transparent bg-transparent'

function ScopeCell({ user }: { user: DirectoryUser }) {
  const places = userRegionPlants(user)
  const shown = places.slice(0, 2).join(', ')
  const more = places.length - 2
  const transport = String(user.transport_type ?? '').trim()
  return (
    <div className="min-w-0 text-sm">
      {places.length ? (
        <div className="truncate text-gray-800" title={places.join(', ')}>
          {shown}
          {more > 0 ? <span className="text-gray-500"> +{more}</span> : null}
        </div>
      ) : (
        <div className="text-gray-400">No Region/Plant default</div>
      )}
      {transport ? <div className="text-xs text-gray-500">Transport {transport}</div> : null}
    </div>
  )
}

/** The user list: avatar, name and e-mail, role and level, scope, status and quick actions. Clicking a row opens it for editing. */
export function UserTable<T extends DirectoryUser>({
  users,
  currentUserId,
  sendingLink,
  roleLabel,
  onEdit,
  onResendInvitation,
  onResetPassword,
  onDeactivate,
  onFilterRole,
}: Props<T>) {
  const stop = (event: MouseEvent | KeyboardEvent) => event.stopPropagation()

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
            <th scope="col" className="px-4 py-2.5">User</th>
            <th scope="col" className="px-4 py-2.5">Role and level</th>
            <th scope="col" className="px-4 py-2.5">Scope</th>
            <th scope="col" className="px-4 py-2.5">Status</th>
            <th scope="col" className="w-[7.5rem] px-2 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const status = STATUS_CHIP[userStatus(user)]
            const resend = user.is_first_login && user.is_active
            return (
              <tr
                key={user.id}
                tabIndex={0}
                onClick={() => onEdit(user)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget) onEdit(user)
                }}
                className="cursor-pointer border-b border-gray-100 outline-none transition-colors last:border-b-0 hover:bg-gray-50 focus-visible:bg-blue-50"
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${roleToneClass(user.role)}`}
                      aria-hidden
                    >
                      {userInitials(user.full_name, user.email)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-900">{user.full_name}</div>
                      <div className="truncate text-xs text-gray-500">
                        {user.email}
                        {user.department ? ` · ${user.department}` : ''}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      stop(event)
                      onFilterRole(user.role)
                    }}
                    title="Show only this role"
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium hover:opacity-80 ${roleToneClass(user.role)}`}
                  >
                    {roleLabel(user.role)}
                  </button>
                  <div className="mt-0.5 text-xs text-gray-500">{user.level || '-'}</div>
                </td>
                <td className="max-w-[16rem] px-4 py-3">
                  <ScopeCell user={user} />
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${status.chip}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden />
                    {status.label}
                  </span>
                </td>
                <td className="px-2 py-3" onClick={stop} onKeyDown={stop}>
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className={`${ICON_BUTTON} text-blue-600 hover:bg-blue-50`}
                      title="Edit user"
                      aria-label={`Edit ${user.full_name}`}
                      onClick={() => onEdit(user)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {resend ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={`${ICON_BUTTON} text-amber-600 hover:bg-amber-50`}
                        title="Resend invitation e-mail"
                        aria-label={`Resend invitation to ${user.email}`}
                        disabled={sendingLink}
                        onClick={() => onResendInvitation(user)}
                      >
                        <Mail className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="icon"
                        className={`${ICON_BUTTON} text-violet-600 hover:bg-violet-50`}
                        title="Send password reset link"
                        aria-label={`Send password reset link to ${user.email}`}
                        onClick={() => onResetPassword(user)}
                      >
                        <Key className="h-4 w-4" />
                      </Button>
                    )}
                    {user.id !== currentUserId ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={`${ICON_BUTTON} text-red-600 hover:bg-red-50`}
                        title="Deactivate user"
                        aria-label={`Deactivate ${user.full_name}`}
                        onClick={() => onDeactivate(user)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
