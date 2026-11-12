'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowLeft, CheckCircle, AlertCircle, Plus } from 'lucide-react'
import api from '@/lib/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { deriveRoleCode, isValidRoleCode } from '@/lib/roleCode'
import { RoleList } from '@/components/roles/RoleList'
import { RoleHeader } from '@/components/roles/RoleHeader'
import { PermissionMatrix } from '@/components/roles/PermissionMatrix'
import { RoleSaveBar } from '@/components/roles/RoleSaveBar'
import { countUsersByRole } from '@/lib/userDirectory'
import {
  PERMISSION_ACTION_FIELDS,
  countPermissionChanges,
  type PermissionField,
  type PermissionRow,
} from '@/lib/rolePermissionsView'

interface Role {
  id: string
  role_name: string
  display_name: string
  description: string
  uses_region_scope?: boolean
}

type Permission = PermissionRow

const LEVEL_OPTIONS = ['Dept Head', 'Section Head', 'Staff', 'Admin'] as const
const DEFAULT_LEVEL = LEVEL_OPTIONS[2] // Staff
const TRANSPORT_OPTIONS = ['SEA', 'LAND', 'ALL', 'MIX'] as const

function sortRolesForEditor(roles: Role[]): Role[] {
  const weight: Record<string, number> = {
    FINANCE: 1,
    MANAGEMENT: 2,
    SUPPORT: 3,
    ADMIN_SUPPORT: 3.5,
    TRADING: 4,
    LOGISTICS: 5,
    ADMIN: 99,
  }
  return [...roles].sort((a, b) => {
    const wa = weight[a.role_name] ?? 50
    const wb = weight[b.role_name] ?? 50
    return wa - wb || a.display_name.localeCompare(b.display_name)
  })
}

function getScopeHint(roleName?: string): string {
  switch (roleName) {
    case 'FINANCE':
      return 'Pick one level (e.g. Staff or Admin) per scope. Finance + Staff + All Transport is separate from Finance + Admin + All Transport.'
    case 'MANAGEMENT':
      return 'Management permissions are configured per level. Each level (Dept Head, Section Head, Staff, Admin) has its own permission set.'
    case 'SUPPORT':
    case 'ADMIN_SUPPORT':
      return 'Select Role + Level + Transport. One level per scope is required; transport can stay All Transport unless you need SEA/LAND/ALL/MIX.'
    case 'TRADING':
      return 'Example: Trading + Admin + All Transport is a separate scope from Trading + Staff + All Transport.'
    case 'LOGISTICS':
      return 'Logistics scopes combine one level with transport (All, SEA, LAND, ALL, or MIX). Each combination is stored independently.'
    default:
      return 'One level is required per scope. Transport can remain All Transport. Wait for loading to finish before editing or saving.'
  }
}

export default function RolesPage() {
  const router = useRouter()
  const [roles, setRoles] = useState<Role[]>([])
  const [roleCounts, setRoleCounts] = useState<Record<string, number> | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  /** What was last loaded or saved for this scope: the unsaved-changes count compares against it. */
  const [savedPermissions, setSavedPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedLevel, setSelectedLevel] = useState<string>(DEFAULT_LEVEL)
  const [selectedTransportType, setSelectedTransportType] = useState<string>('all')
  const [permissionsLoading, setPermissionsLoading] = useState(false)
  const fetchRequestIdRef = useRef(0)
  const [showAddRole, setShowAddRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDescription, setNewRoleDescription] = useState('')
  const [newRoleRegionScope, setNewRoleRegionScope] = useState(false)
  const [creatingRole, setCreatingRole] = useState(false)
  const newRoleCode = deriveRoleCode(newRoleName)

  const sortedRoles = sortRolesForEditor(roles)
  const selectedRoleFromList = sortedRoles.find((role) => role.id === selectedRoleId) ?? null
  const activeRole = selectedRoleFromList ?? selectedRole
  const changeCount = countPermissionChanges(savedPermissions, permissions)
  const transportLabel = selectedTransportType === 'all' ? 'All Transport' : selectedTransportType

  useEffect(() => {
    // Check if user is admin
    const userStr = localStorage.getItem('user')
    if (userStr) {
      const user = JSON.parse(userStr)
      if (user.role !== 'ADMIN') {
        router.push('/dashboard')
        return
      }
    } else {
      router.push('/login')
      return
    }

    fetchRoles()
  }, [router])

  useEffect(() => {
    if (!selectedRoleId) return

    const requestId = ++fetchRequestIdRef.current
    setPermissionsLoading(true)
    setPermissions([])
    setSavedPermissions([])
    setSelectedRole(selectedRoleFromList)
    setError('')

    void fetchRolePermissions(selectedRoleId, requestId)
  }, [selectedRoleId, selectedLevel, selectedTransportType, selectedRoleFromList?.id])

  // Leaving the page with unsaved ticks would lose them without a word.
  useEffect(() => {
    if (changeCount === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [changeCount])

  /** Run `apply` unless it would throw away unsaved ticks the user then declines to lose. */
  const guardUnsaved = (apply: () => void) => {
    if (changeCount > 0 && !window.confirm('Discard the unsaved changes for this role?')) return
    apply()
  }

  const fetchRoles = async (selectId?: string) => {
    try {
      const response = await api.get('/roles')
      const rolesData = sortRolesForEditor(response.data.data)
      setRoles(rolesData)

      if (rolesData.length > 0) {
        const preferred = selectId ? rolesData.find((role: Role) => role.id === selectId) : undefined
        const defaultRole = preferred ?? rolesData.find((role: Role) => role.role_name !== 'ADMIN') ?? rolesData[0]
        setSelectedRoleId(defaultRole.id)
      }
    } catch (err) {
      console.error('Error fetching roles:', err)
      setError('Failed to load roles')
    } finally {
      setLoading(false)
    }

    // Head counts per role: nice to have, so a failure only leaves the numbers out.
    try {
      const usersResponse = await api.get('/users')
      setRoleCounts(countUsersByRole(usersResponse.data?.data ?? []))
    } catch {
      setRoleCounts(null)
    }
  }

  const handleCreateRole = async () => {
    const displayName = newRoleName.trim()
    if (!displayName || !isValidRoleCode(newRoleCode)) {
      setError('Enter a role name that contains letters.')
      return
    }
    setCreatingRole(true)
    setError('')
    setSuccess('')
    try {
      const response = await api.post('/roles', {
        role_name: newRoleCode,
        display_name: displayName,
        description: newRoleDescription.trim() || null,
        uses_region_scope: newRoleRegionScope,
      })
      await fetchRoles(response.data?.data?.id)
      setSuccess(
        `Role "${displayName}" created. It cannot open any page yet - tick the pages it may use below, then press Save Changes.`,
      )
      setNewRoleName('')
      setNewRoleDescription('')
      setNewRoleRegionScope(false)
      setShowAddRole(false)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Failed to create role')
    } finally {
      setCreatingRole(false)
    }
  }

  const fetchRolePermissions = async (roleId: string, requestId: number) => {
    try {
      const params: Record<string, string> = { level: selectedLevel }
      if (selectedTransportType !== 'all') params.transportType = selectedTransportType
      const response = await api.get(`/roles/${roleId}`, { params })

      if (requestId !== fetchRequestIdRef.current) return

      const roleData = response.data.data
      if (roleData.id !== roleId) return

      setSelectedRole(roleData)
      const loaded: Permission[] = roleData.permissions || []
      setPermissions(loaded)
      setSavedPermissions(loaded)
    } catch (err) {
      if (requestId !== fetchRequestIdRef.current) return
      console.error('Error fetching role permissions:', err)
      setError('Failed to load permissions')
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setPermissionsLoading(false)
      }
    }
  }

  const updatePermission = (permissionId: string, field: PermissionField, value: boolean) => {
    setPermissions((prev) =>
      prev.map((perm) =>
        perm.id === permissionId ? { ...perm, [field]: value } : perm
      )
    )
  }

  const setAllPermissionActions = (permissionId: string, value: boolean) => {
    if (permissionsLoading) return
    setPermissions((prev) =>
      prev.map((perm) => {
        if (perm.id !== permissionId) return perm
        return PERMISSION_ACTION_FIELDS.reduce(
          (acc, field) => ({ ...acc, [field]: value }),
          { ...perm }
        )
      })
    )
  }

  const handleSave = async () => {
    if (!selectedRoleId || permissionsLoading) return

    const roleLabel = activeRole?.display_name ?? 'selected role'
    const levelLabel = selectedLevel
    const confirmed = window.confirm(
      `Save permission changes for:\n\n` +
        `Role: ${roleLabel} (${activeRole?.role_name ?? '?'})\n` +
        `Level: ${levelLabel}\n` +
        `Transport: ${transportLabel}\n\n` +
        `This only updates permissions for this exact scope.`
    )
    if (!confirmed) return

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const permissionsToSave = permissions.map((perm) => ({
        permission_id: perm.id,
        can_view: perm.can_view || false,
        can_create: perm.can_create || false,
        can_edit: perm.can_edit || false,
        can_delete: perm.can_delete || false,
      }))

      await api.put(`/roles/${selectedRoleId}/permissions`, {
        permissions: permissionsToSave,
      }, {
        params: {
          level: selectedLevel,
          ...(selectedTransportType !== 'all' ? { transportType: selectedTransportType } : {}),
        }
      })

      setSuccess(
        `Permissions saved for ${roleLabel} · ${levelLabel} · ${transportLabel}`
      )
      const requestId = ++fetchRequestIdRef.current
      setPermissionsLoading(true)
      await fetchRolePermissions(selectedRoleId, requestId)

      setTimeout(() => setSuccess(''), 5000)
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to update permissions')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button variant="outline" size="sm" onClick={() => guardUnsaved(() => router.push('/users'))}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Users
            </Button>
            <h2 className="mt-3 text-lg font-semibold text-gray-900">Roles and access</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Pick a role, then choose what it can view, create, edit and delete.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowAddRole(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Add Role
          </Button>
        </div>

        {/* Alerts */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="border-green-500 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <RoleList
            roles={sortedRoles}
            selectedId={selectedRoleId}
            onSelect={(id) => guardUnsaved(() => setSelectedRoleId(id))}
            counts={roleCounts}
          />

          {activeRole ? (
            <section className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label="Permissions">
              <RoleHeader
                displayName={activeRole.display_name}
                roleName={activeRole.role_name}
                description={activeRole.description}
                usesRegionScope={Boolean(activeRole.uses_region_scope)}
                isAdmin={activeRole.role_name === 'ADMIN'}
                level={selectedLevel}
                onLevel={(value) => guardUnsaved(() => setSelectedLevel(value))}
                levelOptions={LEVEL_OPTIONS}
                transport={selectedTransportType}
                onTransport={(value) => guardUnsaved(() => setSelectedTransportType(value))}
                transportOptions={TRANSPORT_OPTIONS}
                hint={getScopeHint(activeRole.role_name)}
                loading={permissionsLoading}
              />
              <PermissionMatrix
                permissions={permissions}
                loading={permissionsLoading}
                roleLabel={activeRole.display_name}
                onChange={updatePermission}
                onSetAll={setAllPermissionActions}
              />
              <RoleSaveBar
                changeCount={changeCount}
                scopeLabel={`${activeRole.display_name}, ${selectedLevel}, ${transportLabel}`}
                saving={saving}
                loading={permissionsLoading}
                onSave={() => void handleSave()}
                onDiscard={() => setPermissions(savedPermissions)}
              />
            </section>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-500">
              Pick a role on the left.
            </div>
          )}
        </div>

        <details className="group rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm text-gray-700">
          <summary className="cursor-pointer select-none font-medium text-gray-900">How permissions work</summary>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-gray-600">
            <li><strong>View:</strong> the user can see this page or data. <strong>Create:</strong> add new records. <strong>Edit:</strong> change existing records. <strong>Delete:</strong> remove records.</li>
            <li><strong>Row:</strong> All ticks all four boxes of that permission; None clears them. It touches that row only.</li>
            <li>
              <strong>Scope:</strong> each permission set belongs to one Role + one Level + a Transport. Level is required (Dept Head, Section Head, Staff or
              Admin). Transport can be All Transport or a specific type (SEA, LAND, ALL, MIX). Saving only updates the scope shown above.
            </li>
            <li>
              <strong>Commercial Documents:</strong> turn on <code className="text-xs">page.commercial_documents</code> (View) under Pages and{' '}
              <code className="text-xs">data.commercial_documents</code> (Delete) under Data. Who may upload each document type is set by{' '}
              <code className="text-xs">Commercial Documents Upload: ...</code> (one row per type, Create/Edit); a role without that row cannot upload that
              type. LOGISTICS Staff should stay denied unless explicitly granted.
            </li>
            <li>Dashboard widgets control which statistics and charts appear on the user&apos;s dashboard.</li>
          </ul>
        </details>
      </div>

      <Dialog open={showAddRole} onOpenChange={setShowAddRole}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>
              A new role starts with no access. After creating it, choose the pages it may open and save. The code cannot be changed later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new_role_name">Role name *</Label>
              <Input
                id="new_role_name"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="e.g. AR UPSTREAM"
                maxLength={100}
              />
              <p className="text-xs text-gray-500">
                Code: <span className="font-mono">{newRoleCode || '-'}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new_role_description">Description</Label>
              <Input
                id="new_role_description"
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
                placeholder="What this role is for"
              />
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={newRoleRegionScope}
                onCheckedChange={(checked) => setNewRoleRegionScope(checked === true)}
              />
              <span>
                Users of this role can be given a Region/Plant
                <span className="block text-xs text-gray-500">
                  It becomes their default filter on the pages they open. They can still clear it.
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowAddRole(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateRole()} disabled={creatingRole || !isValidRoleCode(newRoleCode)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {creatingRole ? 'Creating...' : 'Create role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  )
}
