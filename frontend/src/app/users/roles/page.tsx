'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Shield, ArrowLeft, Save, CheckCircle, AlertCircle } from 'lucide-react'
import api from '@/lib/api'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Role {
  id: string
  role_name: string
  display_name: string
  description: string
}

interface Permission {
  id: string
  permission_key: string
  permission_name: string
  description: string
  category: string
  can_view?: boolean
  can_create?: boolean
  can_edit?: boolean
  can_delete?: boolean
}

interface GroupedPermissions {
  [category: string]: Permission[]
}

const LEVEL_OPTIONS = ['Dept Head', 'Section Head', 'Staff', 'Admin'] as const
const DEFAULT_LEVEL = LEVEL_OPTIONS[2] // Staff
const TRANSPORT_OPTIONS = ['SEA', 'LAND', 'ALL', 'MIX'] as const

type PermissionField = 'can_view' | 'can_create' | 'can_edit' | 'can_delete'

const PERMISSION_ACTION_FIELDS: PermissionField[] = [
  'can_view',
  'can_create',
  'can_edit',
  'can_delete',
]

function sortRolesForEditor(roles: Role[]): Role[] {
  const weight: Record<string, number> = {
    FINANCE: 1,
    MANAGEMENT: 2,
    SUPPORT: 3,
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
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedLevel, setSelectedLevel] = useState<string>(DEFAULT_LEVEL)
  const [selectedTransportType, setSelectedTransportType] = useState<string>('all')
  const [permissionsLoading, setPermissionsLoading] = useState(false)
  const fetchRequestIdRef = useRef(0)

  const sortedRoles = sortRolesForEditor(roles)
  const selectedRoleFromList = sortedRoles.find((role) => role.id === selectedRoleId) ?? null
  const transportAppliesMostlyToLogistics = selectedRoleFromList?.role_name === 'LOGISTICS'

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
    setSelectedRole(selectedRoleFromList)
    setError('')

    void fetchRolePermissions(selectedRoleId, requestId)
  }, [selectedRoleId, selectedLevel, selectedTransportType, selectedRoleFromList?.id])

  const fetchRoles = async () => {
    try {
      const response = await api.get('/roles')
      const rolesData = sortRolesForEditor(response.data.data)
      setRoles(rolesData)
      
      if (rolesData.length > 0) {
        const defaultRole = rolesData.find((role: Role) => role.role_name !== 'ADMIN') ?? rolesData[0]
        setSelectedRoleId(defaultRole.id)
      }
    } catch (err) {
      console.error('Error fetching roles:', err)
      setError('Failed to load roles')
    } finally {
      setLoading(false)
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
      setPermissions(roleData.permissions || [])
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

  const updatePermission = (permissionId: string, field: string, value: boolean) => {
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

  const isAllPermissionActionsChecked = (permission: Permission): boolean =>
    PERMISSION_ACTION_FIELDS.every((field) => Boolean(permission[field]))

  const isAnyPermissionActionChecked = (permission: Permission): boolean =>
    PERMISSION_ACTION_FIELDS.some((field) => Boolean(permission[field]))

  const handleSave = async () => {
    if (!selectedRoleId || permissionsLoading) return

    const roleLabel = selectedRoleFromList?.display_name ?? selectedRole?.display_name ?? 'selected role'
    const levelLabel = selectedLevel
    const transportLabel = selectedTransportType === 'all' ? 'All Transport' : selectedTransportType
    const confirmed = window.confirm(
      `Save permission changes for:\n\n` +
        `Role: ${roleLabel} (${selectedRoleFromList?.role_name ?? selectedRole?.role_name ?? '?'})\n` +
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

  const groupPermissionsByCategory = (perms: Permission[]): GroupedPermissions => {
    return perms.reduce((acc: GroupedPermissions, perm) => {
      const category = perm.category || 'other'
      if (!acc[category]) {
        acc[category] = []
      }
      acc[category].push(perm)
      return acc
    }, {})
  }

  const sortPermissionsInCategory = (perms: Permission[]): Permission[] =>
    [...perms].sort((a, b) => {
      const keyOrder = (key: string) => {
        if (key === 'page.commercial_documents') return 'page.commercial_documents'
        if (key === 'data.commercial_documents') return 'data.commercial_documents'
        return key
      }
      return keyOrder(a.permission_key).localeCompare(keyOrder(b.permission_key))
        || a.permission_name.localeCompare(b.permission_name)
    })

  const getCategoryTitle = (category: string): string => {
    const titles: Record<string, string> = {
      page: 'Page Access',
      data: 'Data Access',
      dashboard: 'Dashboard Widgets',
      action: 'Actions',
      other: 'Other Permissions',
    }
    return titles[category] || category
  }

  const getCategoryIcon = (category: string): string => {
    const icons: Record<string, string> = {
      page: '📄',
      data: '💾',
      dashboard: '📊',
      action: '⚡',
      other: '🔧',
    }
    return icons[category] || '🔧'
  }

  const groupedPermissions = groupPermissionsByCategory(permissions)

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/users')}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Users
              </Button>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Shield className="h-8 w-8 text-blue-600" />
              Role & Permission Management
            </h1>
            <p className="text-gray-600 mt-2">
              Configure what each role can view, edit, and access in the system
            </p>
          </div>
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

        {/* Role Selector */}
        <Card>
          <CardHeader>
            <CardTitle>Select Role to Configure</CardTitle>
            <CardDescription>
              Choose a role and level (required). Transport defaults to All unless you need a specific type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          <span className="font-medium">{role.display_name}</span>
                          <span className="text-sm text-gray-500">({role.role_name})</span>
                          {role.role_name === 'ADMIN' ? (
                            <span className="text-xs text-amber-600">full access</span>
                          ) : null}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-52">
                <Select value={selectedLevel} onValueChange={setSelectedLevel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVEL_OPTIONS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-44">
                <Select value={selectedTransportType} onValueChange={setSelectedTransportType}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Transport" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Transport (unscoped)</SelectItem>
                    {TRANSPORT_OPTIONS.map((transport) => (
                      <SelectItem key={transport} value={transport}>
                        {transport}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSave} disabled={saving || permissionsLoading || !selectedRoleId}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : permissionsLoading ? 'Loading...' : 'Save Changes'}
              </Button>
            </div>

            {(selectedRoleFromList || selectedRole) && (
              <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-blue-900">
                  {selectedRoleFromList?.display_name ?? selectedRole?.display_name}
                </h3>
                <p className="text-sm text-blue-700 mt-1">
                  {selectedRoleFromList?.description ?? selectedRole?.description}
                </p>
                <p className="text-xs text-blue-700 mt-2">
                  Editing scope:{' '}
                  <span className="font-medium">
                    Role={selectedRoleFromList?.role_name ?? selectedRole?.role_name}
                  </span>
                  {' · '}
                  <span className="font-medium">Level={selectedLevel}</span>
                  {' · '}
                  <span className="font-medium">
                    Transport={selectedTransportType === 'all' ? 'All Transport' : selectedTransportType}
                  </span>
                </p>
                {permissionsLoading ? (
                  <p className="text-xs text-blue-600 mt-2">Loading permissions for this scope…</p>
                ) : (
                  <p className="text-xs text-blue-600 mt-2">
                    {getScopeHint(selectedRoleFromList?.role_name ?? selectedRole?.role_name)}
                    {!transportAppliesMostlyToLogistics ? (
                      <span className="block mt-1 text-blue-500">
                        Transport filter is optional for {selectedRoleFromList?.display_name ?? 'this role'} — leave as All unless you need a transport-specific override.
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Permissions */}
        {(selectedRoleFromList || selectedRole) && (
          <div className="space-y-4">
            {permissionsLoading ? (
              <Card>
                <CardContent className="py-12 text-center text-gray-500">
                  Loading permissions…
                </CardContent>
              </Card>
            ) : null}
            {Object.entries(groupedPermissions).map(([category, perms]) => (
              <Card key={category}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span>{getCategoryIcon(category)}</span>
                    {getCategoryTitle(category)}
                  </CardTitle>
                  <CardDescription>
                    Configure {category} permissions for{' '}
                    {selectedRoleFromList?.display_name ?? selectedRole?.display_name}
                    {category === 'page' ? (
                      <span className="block mt-1 text-gray-500">
                        Includes <strong>Commercial Documents</strong> (<code className="text-xs">page.commercial_documents</code>) for contract payment document access.
                      </span>
                    ) : null}
                    {category === 'data' ? (
                      <span className="block mt-1 text-gray-500">
                        <strong>Commercial Documents Data</strong> (<code className="text-xs">data.commercial_documents</code>) controls upload and file management on that page.
                      </span>
                    ) : null}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {sortPermissionsInCategory(perms).map((permission) => (
                      <div
                        key={permission.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{permission.permission_name}</div>
                          <div className="text-sm text-gray-500 mt-1">
                            {permission.description}
                          </div>
                          <div className="text-xs text-gray-400 mt-1 font-mono">
                            {permission.permission_key}
                          </div>
                        </div>

                        <div className="flex items-center gap-4 ml-4 shrink-0">
                          <div className="flex gap-6">
                            <label className={`flex items-center gap-2 ${permissionsLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <Checkbox
                                checked={permission.can_view || false}
                                disabled={permissionsLoading}
                                onCheckedChange={(checked) =>
                                  updatePermission(permission.id, 'can_view', checked as boolean)
                                }
                              />
                              <span className="text-sm">View</span>
                            </label>

                            <label className={`flex items-center gap-2 ${permissionsLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <Checkbox
                                checked={permission.can_create || false}
                                disabled={permissionsLoading}
                                onCheckedChange={(checked) =>
                                  updatePermission(permission.id, 'can_create', checked as boolean)
                                }
                              />
                              <span className="text-sm">Create</span>
                            </label>

                            <label className={`flex items-center gap-2 ${permissionsLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <Checkbox
                                checked={permission.can_edit || false}
                                disabled={permissionsLoading}
                                onCheckedChange={(checked) =>
                                  updatePermission(permission.id, 'can_edit', checked as boolean)
                                }
                              />
                              <span className="text-sm">Edit</span>
                            </label>

                            <label className={`flex items-center gap-2 ${permissionsLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                              <Checkbox
                                checked={permission.can_delete || false}
                                disabled={permissionsLoading}
                                onCheckedChange={(checked) =>
                                  updatePermission(permission.id, 'can_delete', checked as boolean)
                                }
                              />
                              <span className="text-sm">Delete</span>
                            </label>
                          </div>

                          <div className="flex flex-col items-center gap-1 border-l pl-4">
                            <span className="text-xs text-gray-500">Row</span>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={permissionsLoading || isAllPermissionActionsChecked(permission)}
                                onClick={() => setAllPermissionActions(permission.id, true)}
                              >
                                All
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={permissionsLoading || !isAnyPermissionActionChecked(permission)}
                                onClick={() => setAllPermissionActions(permission.id, false)}
                              >
                                None
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info Card */}
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-semibold mb-1">Permission Guidelines:</p>
                <ul className="list-disc list-inside space-y-1 text-blue-800">
                  <li><strong>View:</strong> User can see this page or data</li>
                  <li><strong>Create:</strong> User can add new records</li>
                  <li><strong>Edit:</strong> User can modify existing records</li>
                  <li><strong>Delete:</strong> User can remove records</li>
                  <li>
                    <strong>Row actions:</strong> Use <strong>All</strong> / <strong>None</strong> on each permission row to select or clear View, Create, Edit, and Delete for that item only.
                  </li>
                  <li>
                    <strong>Scope:</strong> Each permission scope is Role + one Level + Transport.
                    Level is required (Dept Head, Section Head, Staff, or Admin). Transport can be All Transport or a specific type (SEA, LAND, ALL, MIX).
                  </li>
                  <li>
                    <strong>Commercial Documents:</strong> Enable <code className="text-xs">page.commercial_documents</code> (View) and{' '}
                    <code className="text-xs">data.commercial_documents</code> (View/Create/Edit for upload) under Page Access and Data Access.
                    LOGISTICS Staff scope should remain denied unless explicitly granted.
                  </li>
                </ul>
                <p className="mt-2">
                  Dashboard widgets control which statistics and charts appear on the user's dashboard.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}

