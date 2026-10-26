import { Ship, Truck } from 'lucide-react'
import Image from 'next/image'
import type { ReactNode } from 'react'
import './auth-frame.css'
// The frame sets no font of its own: it inherits KLIP's (Inter, from the body in app/layout.tsx), like the rest of the app.

export function AuthBrand() {
  return (
    <span className="klip-auth-brand">
      <Image className="klip-auth-mark" src="/icon.svg" alt="" width={32} height={32} unoptimized />
      KLIP
    </span>
  )
}

/** The two-column frame of the sign-in, forgot-password, set-password and SSO callback pages (same layout as the Commercial Documents sign-in). */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="klip-auth">
      <section className="klip-auth-art" aria-hidden="true">
        <AuthBrand />
        <div style={{ display: 'grid', gap: 14 }}>
          <h2>Every shipment and every truck, in one view.</h2>
          <p>KPN Logistics Intelligence Platform: sea shipments and trucking operations from SAP, with what needs action shown first.</p>
        </div>
        <div className="klip-auth-cards">
          <div className="klip-auth-card">
            <span className="ic">
              <Ship width={18} height={18} />
            </span>
            <div>
              <b>Shipments</b>
              <small>Vessel plans, ETA / ATA and milestones, per STO</small>
            </div>
          </div>
          <div className="klip-auth-card">
            <span className="ic">
              <Truck width={18} height={18} />
            </span>
            <div>
              <b>Trucking</b>
              <small>Land deliveries with daily actuals and weighbridge times</small>
            </div>
          </div>
        </div>
      </section>
      <section className="klip-auth-form">
        <div className="klip-auth-box">
          <AuthBrand />
          {children}
        </div>
      </section>
    </div>
  )
}
