'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { accessFor, type Access } from './access'
import { apiData, apiJson, getToken, setToken, setUnauthorizedHandler } from './api'
import type { PermissionMap, SessionUser } from './types'

type Status = 'loading' | 'signedIn' | 'signedOut'

type Session = {
  status: Status
  user: SessionUser | null
  access: Access
  /** Signs in and loads permissions. Resolves to whether the user must set a new password first. */
  signIn: (email: string, password: string) => Promise<{ requirePasswordChange: boolean }>
  signOut: (reason?: 'expired') => Promise<void>
  /** Re-reads the user (after changing the password, is_first_login flips). */
  refresh: () => Promise<void>
}

const NO_ACCESS = accessFor(null, {})
const SessionContext = createContext<Session | null>(null)

/** The flag shown on the login page after a forced sign-out. */
export const SIGNED_OUT_REASON_KEY = 'cd.signedOutReason'

async function loadPermissions(): Promise<PermissionMap> {
  const data = await apiData<{ permissions: PermissionMap }>('/roles/my-permissions')
  return data?.permissions || {}
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [permissions, setPermissions] = useState<PermissionMap>({})
  const signingOut = useRef(false)

  const clear = useCallback(() => {
    setToken(null)
    setUser(null)
    setPermissions({})
    setStatus('signedOut')
  }, [])

  const load = useCallback(async () => {
    try {
      const [me, perms] = await Promise.all([apiData<SessionUser>('/auth/me'), loadPermissions()])
      setUser(me)
      setPermissions(perms)
      setStatus('signedIn')
    } catch {
      clear()
    }
  }, [clear])

  useEffect(() => {
    // Nothing to ask the server without a token; a KLIP session cookie on the same host would still sign the user in, which is
    // the same account - accept it.
    void load()
  }, [load])

  const signOut = useCallback(
    async (reason?: 'expired') => {
      if (signingOut.current) return
      signingOut.current = true
      try {
        if (reason) sessionStorage.setItem(SIGNED_OUT_REASON_KEY, reason)
      } catch {
        /* ignore */
      }
      try {
        await apiJson('/auth/logout', { method: 'POST', expectAuthError: true })
      } catch {
        /* the local sign-out below is what matters */
      }
      clear()
      signingOut.current = false
    },
    [clear],
  )

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (getToken() || status === 'signedIn') void signOut('expired')
    })
    return () => setUnauthorizedHandler(null)
  }, [signOut, status])

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await apiData<{ user: SessionUser; token: string; requirePasswordChange: boolean }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      expectAuthError: true,
    })
    setToken(data.token)
    const perms = await loadPermissions()
    setUser(data.user)
    setPermissions(perms)
    setStatus('signedIn')
    return { requirePasswordChange: Boolean(data.requirePasswordChange) }
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      access: user ? accessFor(user.role, permissions) : NO_ACCESS,
      signIn,
      signOut,
      refresh: load,
    }),
    [status, user, permissions, signIn, signOut, load],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
