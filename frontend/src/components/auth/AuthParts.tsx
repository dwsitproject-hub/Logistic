import { AlertCircle, CheckCircle2, Info, Loader2, type LucideIcon } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { AuthFrame } from './AuthFrame'

/** A labelled input with its icon inside the field. Every other input attribute passes through. */
export function AuthField({
  id,
  label,
  icon: Icon,
  ...input
}: { id: string; label: string; icon: LucideIcon } & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'>) {
  return (
    <div className="klip-auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="klip-auth-ic">
        <Icon aria-hidden />
        <input className="klip-auth-input" id={id} {...input} />
      </div>
    </div>
  )
}

const ALERT_ICON = { bad: AlertCircle, ok: CheckCircle2, info: Info } as const

/** A note under the heading: `bad` for an error, `ok` for a success, `info` for a neutral notice. Renders nothing when empty. */
export function AuthAlert({ tone, children }: { tone: keyof typeof ALERT_ICON; children: ReactNode }) {
  if (!children) return null
  const Icon = ALERT_ICON[tone]
  return (
    <div className={`klip-auth-alert ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <span>{children}</span>
    </div>
  )
}

/** A whole page in the frame that only says what it is doing (session check, link check, SSO hand-over). */
export function AuthLoading({ label }: { label: string }) {
  return (
    <AuthFrame>
      <div className="klip-auth-center" role="status">
        <Loader2 width={18} height={18} className="klip-auth-spin" aria-hidden />
        <span>{label}</span>
      </div>
    </AuthFrame>
  )
}
