'use client'

import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ErrorNote, Modal, Spinner, useToast } from '@/components/ui'
import { apiData, apiJson, errorMessage, toQuery } from '@/lib/api'
import { UPLOAD_PERMISSION_PREFIX } from '@/lib/access'
import { DOCUMENT_LABELS, DOCUMENT_TYPES } from '@/lib/documentTypes'
import type { ManagedUser, Role, RolePermissionRow } from '@/lib/types'

const LEVELS = ['Staff', 'Section Head', 'Dept Head', 'Admin']
const TRANSPORT = ['SEA', 'LAND', 'ALL', 'MIX']
const FLAGS = ['can_view', 'can_create', 'can_edit', 'can_delete'] as const
type Flag = (typeof FLAGS)[number]

/** The rows this app shows. Everything else in the catalog is KLIP's and is saved back unchanged. */
const PAGE_ROWS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'page.commercial_documents', label: 'Documents', hint: 'View opens the page' },
  { key: 'page.commercial_dashboard', label: 'Dashboard', hint: 'View opens the page' },
  { key: 'data.commercial_documents', label: 'Document files', hint: 'Delete removes a version' },
]

/**
 * Roles & access (GET/PUT /api/roles..., ADMIN only). Permissions are stored per role AND per user level (and, for LOGISTICS,
 * transport type), exactly as in KLIP's role editor, so the scope is chosen first.
 *
 * Saving sends the WHOLE catalog for that scope: the API replaces every row of the scope with what it receives. GET returns
 * the effective value of each permission (inherited rows included), so writing it back keeps every KLIP permission as it was.
 */
export default function RolesPage() {
  const { toast } = useToast()
  const [roles, setRoles] = useState<Role[]>([])
  const [userCounts, setUserCounts] = useState<Record<string, number>>({})
  const [roleId, setRoleId] = useState<string | null>(null)
  const [level, setLevel] = useState('Staff')
  const [transport, setTransport] = useState('')
  const [perms, setPerms] = useState<RolePermissionRow[] | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const loadRoles = useCallback(async (select?: string) => {
    try {
      const [r, u] = await Promise.all([apiData<Role[]>('/roles'), apiData<ManagedUser[]>('/users').catch(() => [])])
      setRoles(r || [])
      const counts: Record<string, number> = {}
      for (const user of u || []) if (user.is_active) counts[user.role] = (counts[user.role] || 0) + 1
      setUserCounts(counts)
      setRoleId((cur) => select || cur || r?.[0]?.id || null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load the roles.'))
    }
  }, [])

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])

  const role = roles.find((r) => r.id === roleId) || null
  const scopeQuery = toQuery({ level, transportType: role?.role_name === 'LOGISTICS' ? transport : '' })

  useEffect(() => {
    if (!roleId) return
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    apiData<{ permissions: RolePermissionRow[] }>(`/roles/${roleId}${scopeQuery}`, { signal: ctrl.signal })
      .then((d) => {
        setPerms(d.permissions || [])
        setSaved(JSON.stringify(d.permissions || []))
        setLoading(false)
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setError(errorMessage(err, 'Could not load the permissions.'))
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [roleId, scopeQuery])

  const dirty = perms !== null && JSON.stringify(perms) !== saved
  const byKey = useMemo(() => new Map((perms || []).map((p) => [p.permission_key, p])), [perms])

  const setFlags = (key: string, patch: Partial<Record<Flag, boolean>>) =>
    setPerms((cur) => (cur ? cur.map((p) => (p.permission_key === key ? { ...p, ...patch } : p)) : cur))

  const pickRole = (id: string) => {
    if (dirty && !window.confirm('Discard the unsaved changes for this role?')) return
    setRoleId(id)
  }

  const save = async () => {
    if (!roleId || !perms) return
    setSaving(true)
    try {
      await apiJson(`/roles/${roleId}/permissions${scopeQuery}`, {
        method: 'PUT',
        body: {
          permissions: perms.map((p) => ({
            permission_id: p.id,
            can_view: Boolean(p.can_view),
            can_create: Boolean(p.can_create),
            can_edit: Boolean(p.can_edit),
            can_delete: Boolean(p.can_delete),
          })),
        },
      })
      setSaved(JSON.stringify(perms))
      toast(`Access saved for ${role?.display_name || role?.role_name} · ${level}`)
    } catch (err) {
      toast(errorMessage(err), true)
    } finally {
      setSaving(false)
    }
  }

  const sw = (key: string, flag: Flag, label: string) => {
    const p = byKey.get(key)
    return (
      <label className="sw">
        <input
          type="checkbox"
          checked={Boolean(p?.[flag])}
          disabled={!p || saving}
          aria-label={label}
          onChange={(e) => setFlags(key, { [flag]: e.target.checked })}
        />
        <span />
      </label>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Roles &amp; access</h1>
          <p>What each role can see and which documents it may upload. Roles are shared with KLIP.</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            New role
          </button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      <div className="roles">
        <div className="panel role-list">
          {roles.map((r) => (
            <button key={r.id} type="button" aria-current={r.id === roleId} onClick={() => pickRole(r.id)}>
              <span style={{ color: 'inherit' }}>
                {r.display_name || r.role_name}
                {r.is_active ? '' : ' (inactive)'}
              </span>
              <span>{(userCounts[r.role_name] || 0).toLocaleString('en-US')} users</span>
            </button>
          ))}
          {!roles.length ? <Spinner /> : null}
        </div>
        <div className="panel">
          <div className="scope">
            <span className="flabel">Applies to users at level</span>
            <select
              className="select"
              aria-label="Level"
              value={level}
              onChange={(e) => {
                if (dirty && !window.confirm('Discard the unsaved changes?')) return
                setLevel(e.target.value)
              }}
            >
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {role?.role_name === 'LOGISTICS' ? (
              <select
                className="select"
                aria-label="Transport type"
                value={transport}
                onChange={(e) => {
                  if (dirty && !window.confirm('Discard the unsaved changes?')) return
                  setTransport(e.target.value)
                }}
              >
                <option value="">All transport</option>
                {TRANSPORT.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            ) : null}
            {dirty ? <span className="pill warn">Unsaved changes</span> : null}
          </div>
          <ErrorNote>{error}</ErrorNote>
          {role?.role_name === 'ADMIN' ? (
            <div className="alert info" style={{ margin: 12 }}>
              Administrators can always open every page and upload every document, whatever is set here.
            </div>
          ) : null}
          <div className="tbl-wrap">
            {loading ? (
              <div className="loading-veil">
                <Spinner />
              </div>
            ) : null}
            <table className="matrix compact">
              <thead>
                <tr>
                  <th>{role ? role.display_name || role.role_name : ''}</th>
                  <th>View</th>
                  <th>Create</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                <tr className="sec">
                  <td colSpan={5}>Pages</td>
                </tr>
                {PAGE_ROWS.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.label}
                      <span className="sub">{byKey.has(r.key) ? r.hint : 'Not set up in this database'}</span>
                    </td>
                    {FLAGS.map((f) => (
                      <td key={f}>{sw(r.key, f, `${r.label} ${f.replace('can_', '')}`)}</td>
                    ))}
                  </tr>
                ))}
                <tr className="sec">
                  <td colSpan={5}>May upload</td>
                </tr>
                {DOCUMENT_TYPES.map((t) => {
                  const key = `${UPLOAD_PERMISSION_PREFIX}${t}`
                  const p = byKey.get(key)
                  // The API lets create OR edit upload; this app sets both together.
                  const on = Boolean(p?.can_create || p?.can_edit)
                  return (
                    <tr key={t}>
                      <td>
                        {DOCUMENT_LABELS[t]}
                        {p ? null : <span className="sub">Not set up in this database</span>}
                      </td>
                      <td className="hint">·</td>
                      <td>
                        <label className="sw">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!p || saving}
                            aria-label={`Upload ${DOCUMENT_LABELS[t]}`}
                            onChange={(e) => setFlags(key, { can_create: e.target.checked, can_edit: e.target.checked })}
                          />
                          <span />
                        </label>
                      </td>
                      <td className="hint">·</td>
                      <td className="hint">·</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: 0, padding: '10px 14px' }}>
            KLIP pages of this role are not shown here and are saved unchanged.
          </p>
        </div>
      </div>
      {creating ? (
        <NewRoleModal
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false)
            toast(`Role ${r.role_name} created. Give it access, then save.`)
            void loadRoles(r.id)
          }}
        />
      ) : null}
    </>
  )
}

function NewRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Role) => void }) {
  const [name, setName] = useState('')
  const [display, setDisplay] = useState('')
  const [regional, setRegional] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    const roleName = name.trim().toUpperCase()
    if (!/^[A-Z_]+$/.test(roleName)) return setError('Code: capital letters and underscores only, e.g. AR_UPSTREAM.')
    if (!display.trim()) return setError('Name is required.')
    setBusy(true)
    setError('')
    try {
      const res = await apiJson<Role>('/roles', {
        method: 'POST',
        body: { role_name: roleName, display_name: display.trim(), uses_region_scope: regional },
      })
      onCreated(res.data)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New role"
      subtitle="The role is also available in KLIP."
      onClose={onClose}
      busy={busy}
      narrow
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={() => void create()} disabled={busy}>
            Create role
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="r-name">Code</label>
        <input className="input mono" id="r-name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="AR_UPSTREAM" />
      </div>
      <div className="field">
        <label htmlFor="r-display">Name</label>
        <input className="input" id="r-display" value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="AR Upstream" />
      </div>
      <label className="check">
        <input type="checkbox" checked={regional} onChange={(e) => setRegional(e.target.checked)} /> Users of this role get a default
        Region/Plant
      </label>
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  )
}
