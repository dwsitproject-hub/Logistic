'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { AuthFrame } from '@/components/auth/AuthFrame'
import { AuthAlert, AuthField } from '@/components/auth/AuthParts'
import api from '@/lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [doneMessage, setDoneMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await api.post('/auth/forgot-password', { email: email.trim() })
      setDoneMessage(
        response.data?.data?.message ||
          'If that e-mail belongs to an active KLIP account, a link to reset the password has been sent to it.',
      )
    } catch (err: any) {
      if (err.code === 'ERR_NETWORK' || !err.response) {
        setError('Cannot reach KLIP server. Check your connection or try again later.')
      } else {
        setError(err.response?.data?.error?.message || 'Failed to send the reset link')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthFrame>
      <div>
        <h1>Forgot your password?</h1>
        <p className="klip-auth-hint" style={{ marginTop: 4 }}>
          Enter the e-mail address of your KLIP account. We will send you a link to choose a new password.
        </p>
      </div>
      {doneMessage ? (
        <div style={{ display: 'grid', gap: 18 }}>
          <AuthAlert tone="ok">{doneMessage}</AuthAlert>
          <p className="klip-auth-hint">
            The link works once and expires in 60 minutes. Check your spam folder if it does not arrive.
          </p>
          <Link className="klip-auth-btn" href="/login">
            Back to login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 18 }}>
          <AuthField
            id="email"
            label="Email"
            icon={Mail}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <AuthAlert tone="bad">{error}</AuthAlert>
          <button className="klip-auth-btn" type="submit" disabled={loading}>
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
          <p className="klip-auth-hint" style={{ textAlign: 'center' }}>
            <Link className="klip-auth-link" href="/login">
              Back to login
            </Link>
          </p>
        </form>
      )}
    </AuthFrame>
  )
}
