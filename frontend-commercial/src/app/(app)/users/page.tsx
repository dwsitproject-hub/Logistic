'use client'

import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ErrorNote, Modal, PageSize, Pager, Spinner, usePreference, useToast } from '@/components/ui'
import { apiData, apiJson, errorMessage } from '@/lib/api'
import { initials, longDate, plural } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { ManagedUser, Role } from '@/lib/types'

const LEVELS = ['Staff', 'Section Head', 'Dept Head', 'Admin']
const TRANSPORT = ['SEA', 'LAND', 'ALL', 'MIX']

type Status = 'active' | 'pending' | 'inactive'
function statusOf(u: ManagedUser): Status {
  if (!u.is_active) return 'inactive'
  return u.is_first_login ? 'pending' : 'active'
}
const STATUS_PILL: Record<Status, [string, string]> = {
  active: ['ok', 'Active'],
  pending: ['warn', 'Invitation pending'],
  inactive: ['neutral', 'Inactive'],
}

/** The same accounts as KLIP (GET/POST/PUT/DELETE /api/users, ADMIN only). */
export default function UsersPage() {
  const { user: me } = useSession()
  const { toast } = useToast()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [plants, setPlants] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | Status>('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePreference<number>('cd.pageSize.users', 10)
  const [editing, setEditing] = useState<ManagedUser | 'new' | null>(null)
  const [confirm, setConfirm] = useState<{ user: ManagedUser; kind: 'deactivate' | 'link' } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [u, r] = await Promise.all([apiData<ManagedUser[]>('/users'), apiData<Role[]>('/roles')])
      setUsers(u || [])
      setRoles(r || [])
    } catch (err) {
      setError(errorMessage(err, 'Could not load the users. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    apiData<{ groupPlants: string[] }>('/contracts/filter-options/group-plants')
      .then((d) => setPlants(d?.groupPlants || []))
      .catch(() => setPlants([]))
  }, [load])

  useEffect(() => setPage(1), [q, roleFilter, statusFilter, pageSize])

  const roleName = (name: string) => roles.find((r) => r.role_name === name)?.display_name || name
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return users.filter(
      (u) =>
        (!term || `${u.full_name || ''} ${u.email}`.toLowerCase().includes(term)) &&
        (!roleFilter || u.role === roleFilter) &&
        (!statusFilter || statusOf(u) === statusFilter),
    )
  }, [users, q, roleFilter, statusFilter])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

  const sendLink = async (u: ManagedUser) => {
    setBusy(true)
    const path = u.is_first_login ? 'resend-invitation' : 'reset-password'
    try {
      // app: 'commercial' - the link in the e-mail opens this app.
      const res = await apiJson<{ email_sent: boolean }>(`/users/${u.id}/${path}`, { method: 'POST', body: { app: 'commercial' } })
      toast(res.message || `A link was sent to ${u.email}.`, !res.data?.email_sent)
    } catch (err) {
      toast(errorMessage(err), true)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const setActive = async (u: ManagedUser, active: boolean) => {
    setBusy(true)
    try {
      if (active) await apiJson(`/users/${u.id}`, { method: 'PUT', body: { is_active: true } })
      else await apiJson(`/users/${u.id}`, { method: 'DELETE' })
      toast(active ? `${u.full_name || u.email} is active again` : `${u.full_name || u.email} can no longer sign in`)
      await load()
    } catch (err) {
      toast(errorMessage(err), true)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>The same accounts as KLIP. Changes here apply to both apps.</p>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            Add user
          </button>
        </div>
      </div>
      <div className="panel">
        <div className="filters">
          <div className="input-ic">
            <Search aria-hidden />
            <input className="input" placeholder="Search name or email" aria-label="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" aria-label="Role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Role: All</option>
            {roles.map((r) => (
              <option key={r.id} value={r.role_name}>
                {r.display_name || r.role_name}
              </option>
            ))}
          </select>
          <select className="select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | Status)}>
            <option value="">Status: All</option>
            <option value="active">Active</option>
            <option value="pending">Invitation pending</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Level</th>
                <th>Region/Plant</th>
                <th>Status</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="empty" colSpan={7}>
                    <Spinner />
                  </td>
                </tr>
              ) : null}
              {shown.map((u) => {
                const [tone, label] = STATUS_PILL[statusOf(u)]
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span className="avatar">{initials(u.full_name || u.email)}</span>
                        <div style={{ minWidth: 0 }}>
                          {u.full_name || '-'}
                          <span className="sub">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="pill neutral" title={roleName(u.role)}>
                        {u.role}
                      </span>
                    </td>
                    <td>{u.level || '-'}</td>
                    <td className="ellipsis" style={{ maxWidth: 200 }} title={u.plants?.join(', ')}>
                      {u.plants?.length ? u.plants.join(', ') : 'All'}
                    </td>
                    <td>
                      <span className={`pill ${tone}`}>{label}</span>
                    </td>
                    <td className="hint">{longDate(u.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn sm ghost" type="button" onClick={() => setEditing(u)}>
                        Edit
                      </button>
                      {u.is_active ? (
                        <button className="btn sm ghost" type="button" onClick={() => setConfirm({ user: u, kind: 'link' })}>
                          {u.is_first_login ? 'Resend invitation' : 'Reset password'}
                        </button>
                      ) : null}
                      {u.id === me?.id ? null : u.is_active ? (
                        <button className="btn sm ghost danger" type="button" onClick={() => setConfirm({ user: u, kind: 'deactivate' })}>
                          Deactivate
                        </button>
                      ) : (
                        <button className="btn sm ghost" type="button" disabled={busy} onClick={() => void setActive(u, true)}>
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!loading && !shown.length ? (
                <tr>
                  <td className="empty" colSpan={7}>
                    No user matches.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="tbl-foot">
          <div className="pp">
            <PageSize value={pageSize} onChange={setPageSize} />
            <span>
              {shown.length} of {plural(filtered.length, 'user')}
            </span>
          </div>
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      </div>

      {editing ? (
        <UserModal
          user={editing === 'new' ? null : editing}
          roles={roles.filter((r) => r.is_active || (editing !== 'new' && r.role_name === editing.role))}
          plants={plants}
          onClose={() => setEditing(null)}
          onSaved={(msg, bad) => {
            setEditing(null)
            toast(msg, bad)
            void load()
          }}
        />
      ) : null}

      {confirm ? (
        <Modal
          title={
            confirm.kind === 'deactivate'
              ? `Deactivate ${confirm.user.full_name || confirm.user.email}?`
              : confirm.user.is_first_login
                ? 'Send the invitation again?'
                : 'Send a password reset link?'
          }
          onClose={() => setConfirm(null)}
          busy={busy}
          narrow
          footer={
            <>
              <button className="btn" type="button" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </button>
              {confirm.kind === 'deactivate' ? (
                <button className="btn danger-fill" type="button" disabled={busy} onClick={() => void setActive(confirm.user, false)}>
                  Deactivate
                </button>
              ) : (
                <button className="btn primary" type="button" disabled={busy} onClick={() => void sendLink(confirm.user)}>
                  Send link
                </button>
              )}
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>
            {confirm.kind === 'deactivate'
              ? 'They can no longer sign in to Commercial Documents or KLIP. Their uploads and history stay. You can reactivate them later.'
              : confirm.user.is_first_login
                ? `A new invitation goes to ${confirm.user.email}; the earlier link stops working.`
                : `A link to choose a new password goes to ${confirm.user.email}. Their current password keeps working until they use it.`}
          </p>
        </Modal>
      ) : null}
    </>
  )
}

function UserModal({
  user,
  roles,
  plants,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null
  roles: Role[]
  plants: string[]
  onClose: () => void
  onSaved: (message: string, bad?: boolean) => void
}) {
  const [fullName, setFullName] = useState(user?.full_name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [role, setRole] = useState(user?.role || roles.find((r) => r.role_name !== 'ADMIN')?.role_name || '')
  // A new user defaults to Staff. An existing user without a level keeps none: saving must not change their KLIP permissions.
  const [level, setLevel] = useState(user ? user.level || '' : 'Staff')
  const [transport, setTransport] = useState(user?.transport_type || '')
  const [userPlants, setUserPlants] = useState<string[]>(user?.plants || [])
  const [plantQuery, setPlantQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const roleRow = roles.find((r) => r.role_name === role)
  const usesRegion = Boolean(roleRow?.uses_region_scope)
  const needsTransport = role === 'LOGISTICS' && ['Section Head', 'Staff', 'Admin'].includes(level)

  const save = async () => {
    if (!email.trim()) return setError('Email is required.')
    if (!role) return setError('Choose a role.')
    if (needsTransport && !transport) return setError('Choose a transport type for a LOGISTICS user.')
    setBusy(true)
    setError('')
    const body: Record<string, unknown> = {
      full_name: fullName.trim(),
      email: email.trim(),
      role,
      plants: usesRegion ? userPlants : [],
      // Sending plants re-syncs products too; send the current ones back so editing here never clears a KLIP user's products.
      products: user?.products || [],
    }
    if (level) body.level = level
    if (role === 'LOGISTICS' && transport) body.transport_type = transport
    try {
      if (user) {
        // Send only what changed: the audit trail records the fields a PUT carries as "changed".
        const before: Record<string, unknown> = {
          full_name: user.full_name || '',
          email: user.email,
          role: user.role,
          plants: user.plants || [],
          level: user.level || undefined,
          transport_type: user.transport_type || undefined,
        }
        const changed = Object.fromEntries(
          Object.entries(body).filter(([k, v]) => k !== 'products' && JSON.stringify(v) !== JSON.stringify(before[k])),
        )
        // The API re-syncs plants AND products when either key is present, so they always travel together.
        if ('plants' in changed || 'role' in changed) {
          changed.plants = body.plants
          changed.products = user.products || []
        }
        if (!Object.keys(changed).length) {
          onSaved('No changes')
          return
        }
        await apiJson(`/users/${user.id}`, { method: 'PUT', body: changed })
        onSaved('User saved')
      } else {
        const res = await apiJson<{ invitation_sent: boolean }>('/users', { method: 'POST', body: { ...body, app: 'commercial' } })
        onSaved(
          res.data?.invitation_sent
            ? `User added · invitation sent to ${email.trim()}`
            : 'User added, but the invitation e-mail could not be sent. Use "Resend invitation" later.',
          !res.data?.invitation_sent,
        )
      }
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={user ? 'Edit user' : 'Add user'}
      subtitle={user ? undefined : 'They get an e-mail with a link to choose their own password.'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : user ? 'Save' : 'Add user'}
          </button>
        </>
      }
    >
      <div className="grid2">
        <div className="field">
          <label htmlFor="u-name">Full name</label>
          <input className="input" id="u-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Budi Santoso" />
        </div>
        <div className="field">
          <label htmlFor="u-email">Email</label>
          <input
            className="input"
            id="u-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.co.id"
          />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="u-role">Role</label>
          <select className="select" id="u-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.role_name}>
                {r.display_name || r.role_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="u-level">Level</label>
          <select className="select" id="u-level" value={level} onChange={(e) => setLevel(e.target.value)}>
            {level ? null : <option value="">- (none)</option>}
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      {role === 'LOGISTICS' ? (
        <div className="field">
          <label htmlFor="u-transport">Transport type</label>
          <select className="select" id="u-transport" value={transport} onChange={(e) => setTransport(e.target.value)}>
            <option value="">-</option>
            {TRANSPORT.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      ) : null}
      {usesRegion ? (
        <div className="field">
          <span className="flabel">Default Region/Plant</span>
          <input
            className="input"
            placeholder="Search Region/Plant"
            aria-label="Search Region/Plant"
            value={plantQuery}
            onChange={(e) => setPlantQuery(e.target.value)}
            style={{ height: 34 }}
          />
          <div className="optlist scroll">
            {plants
              .filter((p) => !plantQuery || p.toLowerCase().includes(plantQuery.toLowerCase()))
              .map((p) => (
                <label className="opt" key={p}>
                  <input
                    type="checkbox"
                    checked={userPlants.includes(p)}
                    onChange={() => setUserPlants((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
                  />{' '}
                  {p}
                </label>
              ))}
          </div>
          <span className="hint">
            {userPlants.length ? `${userPlants.length} selected. ` : 'None selected = all. '}Only a default filter; the user can still
            change it.
          </span>
        </div>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  )
}
