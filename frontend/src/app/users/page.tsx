'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  UserPlus,
  Shield,
  Settings,
  CheckCircle,
  AlertCircle,
  Activity,
  Save,
  Loader2,
  Send,
} from 'lucide-react'
import api from '@/lib/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'
import { alignSelectedToRegionSiteOptions, filterRegionSiteOptions } from '@/lib/globalScopeFilters'
import { formatRoleLabel } from '@/lib/userRoles'
import { UserKpis } from '@/components/users/UserKpis'
import { UserFilterBar, type RoleFilterOption } from '@/components/users/UserFilterBar'
import { UserTable } from '@/components/users/UserTable'
import {
  countUsersByRole,
  filterDirectoryUsers,
  summarizeUsers,
  type UserStatusFilter,
} from '@/lib/userDirectory'

interface User {
  id: string
  username: string
  email: string
  full_name: string
  role: string
  level?: string
  transport_type?: string
  plant?: string
  plants?: string[]
  group_plants?: string[]
  products?: string[]
  is_active: boolean
  is_first_login: boolean
  phone?: string
  department?: string
  created_at: string
  updated_at: string
}

interface Role {
  id: string
  role_name: string
  display_name: string
  description: string
  uses_region_scope?: boolean
}

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [plantOptions, setPlantOptions] = useState<string[]>([])

  const emptyFormData = {
    email: '',
    full_name: '',
    role: 'TRADING',
    level: 'Staff',
    transport_type: '',
    plants: [] as string[],
    phone: '',
    department: '',
  }

  // Form states
  const [formData, setFormData] = useState(emptyFormData)

  /** A reset link or an invitation is being sent (the request waits for the SMTP server). */
  const [sendingLink, setSendingLink] = useState(false)
  const showTransportType = formData.role === 'LOGISTICS' && ['Section Head', 'Staff', 'Admin'].includes(formData.level)
  // Region/Plant follows the role's own flag (roles.uses_region_scope, set on the Roles page). Users no longer carry a product: the product default filter is retired.
  const showRegion =
    roles.find((role) => role.role_name === formData.role)?.uses_region_scope ??
    ['LOGISTICS', 'TRADING'].includes(formData.role)

  useEffect(() => {
    // Check if user is admin
    const userStr = localStorage.getItem('user')
    if (userStr) {
      const user = JSON.parse(userStr)
      setCurrentUser(user)
      if (user.role !== 'ADMIN') {
        router.push('/dashboard')
        return
      }
    } else {
      router.push('/login')
      return
    }

    fetchData()
  }, [router])

  const fetchData = async () => {
    try {
      const [usersRes, rolesRes, groupPlantsRes] = await Promise.all([
        api.get('/users'),
        api.get('/roles'),
        api.get('/contracts/filter-options/group-plants'),
      ])

      setUsers(usersRes.data.data)
      setRoles(rolesRes.data.data)
      const groupPlants = (groupPlantsRes.data?.data?.groupPlants ?? []) as string[]
      setPlantOptions(filterRegionSiteOptions(Array.isArray(groupPlants) ? groupPlants : []))
    } catch (err) {
      console.error('Error fetching data:', err)
      setError('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      const response = await api.post('/users', {
        email: formData.email,
        full_name: formData.full_name,
        role: formData.role,
        level: formData.level,
        plants: showRegion ? formData.plants : [],
      })
      const created = response.data?.data
      // The account exists either way; the message says whether the invitation went out, so the admin knows to resend it.
      setSuccess(
        created?.invitation_sent
          ? `User created. An invitation e-mail was sent to ${created.email}.`
          : `User created, but the invitation e-mail could not be sent (SMTP is not configured or failed). Use "Resend invitation" once e-mail works.`,
      )
      setShowAddModal(false)
      setFormData(emptyFormData)
      fetchData()
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to create user')
    }
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

    setError('')
    setSuccess('')

    try {
      await api.put(`/users/${selectedUser.id}`, {
        email: formData.email,
        full_name: formData.full_name,
        role: formData.role,
        level: formData.level,
        transport_type: showTransportType ? formData.transport_type : null,
        plants: showRegion ? formData.plants : [],
        phone: formData.phone,
        department: formData.department,
        is_active: selectedUser.is_active,
      })
      setSuccess('User updated successfully')
      setShowEditModal(false)
      setSelectedUser(null)
      fetchData()
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to update user')
    }
  }

  /** Mail a user a link to set a password: a reset link for an active account, the invitation again for a pending one. */
  const sendPasswordLink = async (user: User, kind: 'reset' | 'invitation') => {
    setError('')
    setSuccess('')
    setSendingLink(true)
    try {
      const path = kind === 'invitation' ? 'resend-invitation' : 'reset-password'
      const response = await api.post(`/users/${user.id}/${path}`)
      const sent = Boolean(response.data?.data?.email_sent)
      if (sent) {
        setSuccess(
          kind === 'invitation'
            ? `Invitation sent to ${user.email}.`
            : `Password reset link sent to ${user.email}. Their current password keeps working until they use it.`,
        )
      } else {
        setError('The e-mail could not be sent (SMTP is not configured or failed). Nothing was changed for the user.')
      }
      setShowResetModal(false)
      setSelectedUser(null)
      fetchData()
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to send the link')
    } finally {
      setSendingLink(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return
    await sendPasswordLink(selectedUser, 'reset')
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to deactivate this user?')) return

    setError('')
    setSuccess('')

    try {
      await api.delete(`/users/${userId}`)
      setSuccess('User deactivated successfully')
      fetchData()
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to delete user')
    }
  }

  const openEditModal = (user: User) => {
    setSelectedUser(user)
    setError('')
    setSuccess('')
    setFormData({
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      level: user.level || 'Staff',
      transport_type: user.transport_type || '',
      plants: alignSelectedToRegionSiteOptions(
        user.group_plants?.length
          ? user.group_plants
          : user.plants?.length
            ? user.plants
            : user.plant
              ? user.plant.split(',').map((part) => part.trim())
              : [],
        plantOptions,
      ),
      phone: user.phone || '',
      department: user.department || '',
    })
    setShowEditModal(true)
  }

  const openResetModal = (user: User) => {
    setSelectedUser(user)
    setShowResetModal(true)
  }

  const filteredUsers = filterDirectoryUsers(users, { search: searchTerm, role: roleFilter, status: statusFilter })
  const userSummary = summarizeUsers(users)
  const roleCounts = countUsersByRole(users)
  // Every role with its head count; a role code on a user but missing from the roles list (a deactivated role) still gets an entry.
  const roleFilterOptions: RoleFilterOption[] = [
    ...roles.map((role) => ({ value: role.role_name, label: role.display_name, count: roleCounts[role.role_name] ?? 0 })),
    ...Object.keys(roleCounts)
      .filter((code) => !roles.some((role) => role.role_name === code))
      .map((code) => ({ value: code, label: formatRoleLabel(code), count: roleCounts[code] })),
  ]

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500">Manage accounts, roles and what each person can see.</p>
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

        <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <span>
            Menu and page access come from role permissions: open <strong>Manage Roles</strong> and use the Pages tab. Daily
            activity (clicks, edits, active time) is in the <strong>User Activity Log</strong>.
          </span>
        </p>

        <UserKpis summary={userSummary} />

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <UserFilterBar
            search={searchTerm}
            onSearch={setSearchTerm}
            role={roleFilter}
            onRole={setRoleFilter}
            roleOptions={roleFilterOptions}
            totalCount={users.length}
            status={statusFilter}
            onStatus={setStatusFilter}
            statusCounts={{ all: userSummary.total, active: userSummary.active, pending: userSummary.pending, inactive: userSummary.inactive }}
            actions={
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  title="User Activity Log"
                  aria-label="User Activity Log"
                  onClick={() => router.push('/users/activity-log')}
                >
                  <Activity className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  title="Manage Roles"
                  aria-label="Manage Roles"
                  onClick={() => router.push('/users/roles')}
                >
                  <Settings className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title="Add User"
                  aria-label="Add User"
                  onClick={() => {
                    setFormData(emptyFormData)
                    setError('')
                    setSuccess('')
                    setShowAddModal(true)
                  }}
                >
                  <UserPlus className="h-4 w-4" aria-hidden />
                </Button>
              </>
            }
          />
          {filteredUsers.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-500">No users match these filters</div>
          ) : (
            <UserTable
              users={filteredUsers}
              currentUserId={currentUser?.id}
              sendingLink={sendingLink}
              roleLabel={formatRoleLabel}
              onEdit={openEditModal}
              onResendInvitation={(user) => void sendPasswordLink(user, 'invitation')}
              onResetPassword={openResetModal}
              onDeactivate={(user) => void handleDeleteUser(user.id)}
              onFilterRole={setRoleFilter}
            />
          )}
          <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
            Showing {filteredUsers.length.toLocaleString('en-US')} of {users.length.toLocaleString('en-US')} users · click a row to edit
          </div>
        </div>

        {/* Add User Modal */}
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account. An invitation e-mail is sent so the user can set their own password.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddUser} autoComplete="off">
              {error && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      autoComplete="off"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name *</Label>
                    <Input
                      id="full_name"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  No password is set here. After you save, the user receives an e-mail with a one-time link (valid 72
                  hours) to choose their own password and sign in for the first time.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="role">Role *</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        role: value,
                        transport_type: value === 'LOGISTICS' ? formData.transport_type : '',
                        plants: ['LOGISTICS', 'TRADING'].includes(value) ? formData.plants : [],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.role_name}>
                          {role.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="level">Level *</Label>
                  <Select value={formData.level} onValueChange={(value) => setFormData({ ...formData, level: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Dept Head">Dept Head</SelectItem>
                      <SelectItem value="Section Head">Section Head</SelectItem>
                      <SelectItem value="Staff">Staff</SelectItem>
                      <SelectItem value="Admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className={showRegion ? '' : 'opacity-50 pointer-events-none'}>
                  <SearchableMultiSelect
                    label="Region/Plant"
                    options={plantOptions}
                    selected={formData.plants}
                    onChange={(plants) => setFormData({ ...formData, plants })}
                    placeholder="Select region/plant(s)"
                    emptyMessage="No region/plant values"
                    uppercaseOptionLabels
                  />
                </div>

              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit"><UserPlus className="mr-2 h-4 w-4" aria-hidden />Create User</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit User Modal */}
        <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>
                Update user information and role
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpdateUser}>
              {error && (
                <div className="mb-3 flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit_email">Email *</Label>
                    <Input
                      id="edit_email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_full_name">Full Name *</Label>
                    <Input
                      id="edit_full_name"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit_role">Role</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        role: value,
                        transport_type: value === 'LOGISTICS' ? formData.transport_type : '',
                        plants: ['LOGISTICS', 'TRADING'].includes(value) ? formData.plants : [],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.role_name}>
                          {role.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit_level">Level</Label>
                    <Select
                      value={formData.level}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          level: value,
                          transport_type:
                            formData.role === 'LOGISTICS' && ['Section Head', 'Staff', 'Admin'].includes(value)
                              ? formData.transport_type
                              : '',
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Dept Head">Dept Head</SelectItem>
                        <SelectItem value="Section Head">Section Head</SelectItem>
                        <SelectItem value="Staff">Staff</SelectItem>
                        <SelectItem value="Admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_transport_type">Transport Type {showTransportType ? '*' : ''}</Label>
                    <Select
                      value={formData.transport_type || 'none'}
                      onValueChange={(value) =>
                        setFormData({ ...formData, transport_type: value === 'none' ? '' : value })
                      }
                      disabled={!showTransportType}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={showTransportType ? 'Select transport type' : '-'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">-</SelectItem>
                        <SelectItem value="ALL">ALL</SelectItem>
                        <SelectItem value="SEA">SEA</SelectItem>
                        <SelectItem value="LAND">LAND</SelectItem>
                        <SelectItem value="MIX">MIX</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className={showRegion ? '' : 'opacity-50 pointer-events-none'}>
                  <SearchableMultiSelect
                    label="Region/Plant"
                    options={plantOptions}
                    selected={formData.plants}
                    onChange={(plants) => setFormData({ ...formData, plants })}
                    placeholder="Select region/plant(s)"
                    emptyMessage="No region/plant values"
                    uppercaseOptionLabels
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit_phone">Phone</Label>
                    <Input
                      id="edit_phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit_department">Department</Label>
                    <Input
                      id="edit_department"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
                  Cancel
                </Button>
                <Button type="submit"><Save className="mr-2 h-4 w-4" aria-hidden />Update User</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Reset Password Modal */}
        <Dialog open={showResetModal} onOpenChange={setShowResetModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Send Password Reset Link</DialogTitle>
              <DialogDescription>
                E-mail {selectedUser?.full_name} ({selectedUser?.email}) a link to choose a new password
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleResetPassword}>
              <div className="py-4">
                <p className="text-sm text-gray-600">
                  The link works once and expires in 60 minutes. You do not see or set the password. Their current
                  password keeps working until they use the link.
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowResetModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={sendingLink}>
                  {sendingLink ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
                  {sendingLink ? 'Sending...' : 'Send reset link'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}
