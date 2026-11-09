'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { apiJson, errorMessage } from '@/lib/api'
import type { Role } from '@/lib/types'
import { ErrorNote, Modal } from './ui'

/**
 * Adds a role (POST /api/roles, ADMIN only). Used by the Roles page and by the user form, so a role never has to be added in code or SQL.
 * The code and the name are both capitals. A new role starts with no access: it is given in Roles & access.
 */
export function NewRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Role) => void }) {
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
        body: { role_name: roleName, display_name: display.trim().toUpperCase(), uses_region_scope: regional },
      })
      onCreated(res.data)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add role"
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
            <Plus aria-hidden />
            Add role
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
        <input className="input" id="r-display" value={display} onChange={(e) => setDisplay(e.target.value.toUpperCase())} placeholder="AR UPSTREAM" />
      </div>
      <label className="check">
        <input type="checkbox" checked={regional} onChange={(e) => setRegional(e.target.checked)} /> Users of this role get a default Region/Plant
      </label>
      <ErrorNote>{error}</ErrorNote>
    </Modal>
  )
}
