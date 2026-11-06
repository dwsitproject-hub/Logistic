'use client'

import { BookOpen, Download } from 'lucide-react'
import { Modal } from './ui'

/** The user guide (PDF) lives in public/, so it is served from this app and stays on the same address after every release. */
export const GUIDE_URL = '/COD-User-Guide.pdf'
export const GUIDE_FILE_NAME = 'COD-User-Guide.pdf'

/** Shown once, at a user's first sign-in (the server remembers it: users.commdocs_guide_seen_at). The guide stays in the sidebar afterwards. */
export function GuidePrompt({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Welcome to COD"
      subtitle="KPN Downstream Commercial Documents"
      onClose={onClose}
      narrow
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Maybe later
          </button>
          <a className="btn primary" href={GUIDE_URL} download={GUIDE_FILE_NAME} onClick={onClose}>
            <Download aria-hidden />
            Download user guide
          </a>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span className="mark" style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', flex: 'none', background: 'var(--accent-2)', color: 'var(--accent)' }}>
          <BookOpen aria-hidden />
        </span>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>
          New here? The user guide shows how to find a PO, upload and check its documents, and download a Tanda Terima, step by step. You
          will not be asked again, and it stays in the sidebar under <b>Help</b> whenever you need it.
        </p>
      </div>
    </Modal>
  )
}
