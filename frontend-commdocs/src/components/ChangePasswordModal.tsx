'use client'

import { useState, type FormEvent } from 'react'
import { apiJson, errorMessage } from '@/lib/api'
import { ErrorNote, Modal } from './ui'

const MIN_LENGTH = 6 // backend MIN_PASSWORD_LENGTH

/**
 * POST /api/users/change-password. On a first sign-in the backend ignores the current password, so the field is hidden and the
 * dialog cannot be dismissed (the user must choose their own password before working).
 */
export function ChangePasswordModal({
  firstLogin,
  onClose,
  onDone,
}: {
  firstLogin: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    if (next.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`)
    if (next !== repeat) return setError('The two new passwords do not match.')
    setBusy(true)
    setError('')
    try {
      // A wrong current password answers 401; that must not sign the user out.
      await apiJson('/users/change-password', {
        method: 'POST',
        body: { currentPassword: firstLogin ? '' : current, newPassword: next },
        expectAuthError: true,
      })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={firstLogin ? 'Choose your own password' : 'Change password'}
      subtitle={firstLogin ? 'You signed in with a temporary password. Choose your own before you continue.' : undefined}
      onClose={firstLogin ? () => undefined : onClose}
      busy={busy || firstLogin}
      narrow
      footer={
        <>
          {firstLogin ? null : (
            <button className="btn" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
          <button className="btn primary" type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        {firstLogin ? null : (
          <div className="field">
            <label htmlFor="cp0">Current password</label>
            <input
              className="input"
              id="cp0"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="cp1">New password</label>
          <input
            className="input"
            id="cp1"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <span className="hint">At least {MIN_LENGTH} characters. It changes for KLIP too.</span>
        </div>
        <div className="field">
          <label htmlFor="cp2">Repeat new password</label>
          <input
            className="input"
            id="cp2"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
