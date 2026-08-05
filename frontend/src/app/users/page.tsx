'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  UserPlus,
  Edit2,
  Trash2,
  Key,
  Search,
  Shield,
  Settings,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Activity,
} from 'lucide-react'
import api from '@/lib/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SearchableMultiSelect } from '@/components/SearchableMultiSelect'

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
}

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [plantOptions, setPlantOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])

  const emptyFormData = {
    email: '',
    password: '',
    full_name: '',
    role: 'TRADING',
    level: 'Staff',
    transport_type: '',
    plants: [] as string[],
    products: [] as string[],
    phone: '',
    department: '',
  }

  // Form states
  const [formData, setFormData] = useState(emptyFormData)

  const [resetPassword, setResetPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const showTransportType = formData.role === 'LOGISTICS' && ['Section Head', 'Staff', 'Admin'].includes(formData.level)
  const showPlant = ['LOGISTICS', 'TRADING'].includes(formData.role)

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
      const [usersRes, rolesRes, groupPlantsRes, dashboardProductsRes, masterProductsRes] = await Promise.all([
        api.get('/users'),
        api.get('/roles'),
        api.get('/contracts/filter-options/group-plants'),
        api.get('/dashboard/filter-options/products'),
        api.get('/products', { params: { page: 1, limit: 500 } }),
      ])

      setUsers(usersRes.data.data)
      setRoles(rolesRes.data.data)
      const groupPlants = (groupPlantsRes.data?.data?.groupPlants ?? []) as string[]
      setPlantOptions(
        [...new Set(groupPlants.map((name) => String(name).trim()).filter(Boolean))].sort()
      )

      const productNames = new Set<string>()
      const dashboardProducts = dashboardProductsRes.data?.data
      if (Array.isArray(dashboardProducts)) {
        dashboardProducts.forEach((name) => {
          const trimmed = String(name).trim()
          if (trimmed) productNames.add(trimmed)
        })
      }
      const masterItems = (masterProductsRes.data?.data?.items ?? []) as Array<{ product_name: string }>
      masterItems.forEach((row) => {
        const trimmed = String(row.product_name ?? '').trim()
        if (trimmed) productNames.add(trimmed)
      })
      setProductOptions([...productNames].sort())
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
      await api.post('/users', {
        ...formData,
        plants: showPlant ? formData.plants : [],
        products: showPlant ? formData.products : [],
      })
      setSuccess('User created successfully')
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
        plants: showPlant ? formData.plants : [],
        products: showPlant ? formData.products : [],
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

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

    setError('')
    setSuccess('')

    try {
      await api.post(`/users/${selectedUser.id}/reset-password`, {
        newPassword: resetPassword,
      })
      setSuccess('Password reset successfully. User will be prompted to change password on next login.')
      setShowResetModal(false)
      setSelectedUser(null)
      setResetPassword('')
      fetchData()
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to reset password')
    }
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
      password: '',
      full_name: user.full_name,
      role: user.role,
      level: user.level || 'Staff',
      transport_type: user.transport_type || '',
      plants: user.group_plants?.length
        ? user.group_plants
        : user.plants?.length
          ? user.plants
          : user.plant
            ? [user.plant]
            : [],
      products: user.products ?? [],
      phone: user.phone || '',
      department: user.department || '',
    })
    setShowEditModal(true)
  }

  const openResetModal = (user: User) => {
    setSelectedUser(user)
    setResetPassword('')
    setShowResetModal(true)
  }

  const filteredUsers = users.filter((user) =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      ADMIN: 'bg-red-500',
      TRADING: 'bg-blue-500',
      LOGISTICS: 'bg-green-500',
      FINANCE: 'bg-yellow-500',
      MANAGEMENT: 'bg-purple-500',
      SUPPORT: 'bg-gray-500',
    }
    return colors[role] || 'bg-gray-500'
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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
            <p className="text-gray-600 mt-2">Manage system users and their roles</p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => router.push('/users/activity-log')}
            >
              <Activity className="h-4 w-4 mr-2" />
              User Activity Log
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/users/roles')}
            >
              <Settings className="h-4 w-4 mr-2" />
              Manage Roles
            </Button>
            <Button onClick={() => {
              setFormData(emptyFormData)
              setError('')
              setSuccess('')
              setShowAddModal(true)
            }}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
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

        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Shield className="h-5 w-5 text-slate-600 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-800">
                <p className="font-semibold mb-1">Page access &amp; activity monitoring</p>
                <p>
                  User menu visibility and page access are controlled by role permissions. Use{' '}
                  <strong>Manage Roles</strong> → <strong>Page Access</strong> to grant page permissions (e.g.{' '}
                  <code className="text-xs">page.commercial_documents</code>). Admins can review daily user
                  activity (clicks, edits, active time) via <strong>User Activity Log</strong>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search */}
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Users Table */}
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Transport Type</TableHead>
                    <TableHead>Group Plant</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>First Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-gray-500 py-8">
                        No users found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="font-medium">{user.full_name}</div>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge className={`${getRoleBadgeColor(user.role)} text-white`}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">
                            {user.level || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">
                            {user.transport_type || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">
                            {(user.group_plants?.length
                              ? user.group_plants.join(', ')
                              : user.plants?.length
                                ? user.plants.join(', ')
                                : user.plant) || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">
                            {user.products?.length ? user.products.join(', ') : '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600">
                            {user.department || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {user.is_active ? (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-800">
                              <XCircle className="h-3 w-3 mr-1" />
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.is_first_login ? (
                            <Badge variant="outline" className="border-orange-500 text-orange-700">
                              Pending
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-gray-300 text-gray-600">
                              Completed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditModal(user)}
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openResetModal(user)}
                            >
                              <Key className="h-3 w-3" />
                            </Button>
                            {user.id !== currentUser?.id && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteUser(user.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Add User Modal */}
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>
                Create a new user account with a default password
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

                <div className="space-y-2">
                  <Label htmlFor="password">Default Password *</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="User will change this on first login"
                      autoComplete="new-password"
                      required
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-gray-400" />
                      ) : (
                        <Eye className="h-4 w-4 text-gray-400" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Click the eye icon to show/hide password. User will be required to change it on first login.
                  </p>
                </div>

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
                        products: ['LOGISTICS', 'TRADING'].includes(value) ? formData.products : [],
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
                    <Label htmlFor="level">Level *</Label>
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
                    <Label htmlFor="transport_type">Transport Type {showTransportType ? '*' : ''}</Label>
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

                <div className={showPlant ? '' : 'opacity-50 pointer-events-none'}>
                  <SearchableMultiSelect
                    label="Group Plant"
                    options={plantOptions}
                    selected={formData.plants}
                    onChange={(plants) => setFormData({ ...formData, plants })}
                    placeholder="Select group plant(s)"
                    emptyMessage="No group plants found"
                  />
                </div>

                <div className={showPlant ? '' : 'opacity-50 pointer-events-none'}>
                  <SearchableMultiSelect
                    label="Product"
                    options={productOptions}
                    selected={formData.products}
                    onChange={(products) => setFormData({ ...formData, products })}
                    placeholder="Select products"
                    emptyMessage="No products found"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Input
                      id="department"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create User</Button>
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
                        products: ['LOGISTICS', 'TRADING'].includes(value) ? formData.products : [],
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

                <div className={showPlant ? '' : 'opacity-50 pointer-events-none'}>
                  <SearchableMultiSelect
                    label="Group Plant"
                    options={plantOptions}
                    selected={formData.plants}
                    onChange={(plants) => setFormData({ ...formData, plants })}
                    placeholder="Select group plant(s)"
                    emptyMessage="No group plants found"
                  />
                </div>

                <div className={showPlant ? '' : 'opacity-50 pointer-events-none'}>
                  <SearchableMultiSelect
                    label="Product"
                    options={productOptions}
                    selected={formData.products}
                    onChange={(products) => setFormData({ ...formData, products })}
                    placeholder="Select products"
                    emptyMessage="No products found"
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
                <Button type="submit">Update User</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Reset Password Modal */}
        <Dialog open={showResetModal} onOpenChange={setShowResetModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
              <DialogDescription>
                Set a new default password for {selectedUser?.full_name}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleResetPassword}>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="reset_password">New Default Password</Label>
                  <div className="relative">
                    <Input
                      id="reset_password"
                      type={showResetPassword ? "text" : "password"}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="Enter new password (min 6 characters)"
                      required
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                    >
                      {showResetPassword ? (
                        <EyeOff className="h-4 w-4 text-gray-400" />
                      ) : (
                        <Eye className="h-4 w-4 text-gray-400" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Click the eye icon to show/hide password. The user will be required to change it on their next login.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowResetModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">Reset Password</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}
