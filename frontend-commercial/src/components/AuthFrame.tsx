import { FileText, ReceiptText } from 'lucide-react'
import type { ReactNode } from 'react'
import { Brand } from './ui'

/** The two-column frame of the sign-in, forgot-password and set-password pages. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <section className="login-art" aria-hidden="true">
        <Brand />
        <div style={{ display: 'grid', gap: 14 }}>
          <h2>Every PO&apos;s papers, in one place.</h2>
          <p>Contracts, BA, Bea Cukai, DO and invoices filed per PO, straight from SAP. No more digging through shared folders.</p>
        </div>
        <div className="stack-papers">
          <div className="paper">
            <span className="ic">
              <FileText width={18} height={18} />
            </span>
            <div>
              <b>Contract</b>
              <small>Every version kept, newest on top</small>
            </div>
          </div>
          <div className="paper">
            <span className="ic">
              <ReceiptText width={18} height={18} />
            </span>
            <div>
              <b>Tanda Terima</b>
              <small>One PDF for several POs at once</small>
            </div>
          </div>
        </div>
      </section>
      <section className="login-form">
        <div className="card-login">
          <Brand />
          {children}
        </div>
      </section>
    </div>
  )
}
