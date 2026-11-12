'use client'

import { Loader2, MapPin, ShieldCheck } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Props {
  displayName: string
  roleName: string
  description: string
  usesRegionScope: boolean
  isAdmin: boolean
  level: string
  onLevel: (value: string) => void
  levelOptions: readonly string[]
  transport: string
  onTransport: (value: string) => void
  transportOptions: readonly string[]
  /** One sentence on how this role's scopes work. */
  hint: string
  loading: boolean
}

/** Who the permissions below belong to: the role, and the level and transport that pick WHICH set of permissions is being edited. */
export function RoleHeader(props: Props) {
  const { displayName, roleName, description, usesRegionScope, isAdmin, level, onLevel, levelOptions, transport, onTransport, transportOptions, hint, loading } = props
  return (
    <div className="border-b border-gray-200 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900">{displayName}</h3>
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{roleName}</code>
        {isAdmin ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            Full access
          </span>
        ) : null}
        {usesRegionScope ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700" title="Users of this role can be given a Region/Plant, which becomes their default filter">
            <MapPin className="h-3 w-3" aria-hidden />
            Region/Plant default
          </span>
        ) : null}
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-label="Loading permissions" /> : null}
      </div>
      {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Editing the permissions of</span>
        <Select value={level} onValueChange={onLevel}>
          <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {levelOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={transport} onValueChange={onTransport}>
          <SelectTrigger className="h-8 w-[190px] text-xs" aria-label="Transport">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Transport (unscoped)</SelectItem>
            {transportOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mt-2 text-xs text-gray-500">{hint}</p>
    </div>
  )
}
