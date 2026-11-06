'use client'

import { BookOpen, Download, X } from 'lucide-react'
import { GUIDE_FILE_NAME, GUIDE_URL, GUIDE_VERSION, GUIDE_VIEW_URL } from '@/lib/guide'
import { Modal } from './ui'

/** Shown once, at a user's first sign-in (the server remembers it: users.commdocs_guide_seen_at). The guide stays in the sidebar afterwards. */
export function GuidePrompt({ onClose, onDownload }: { onClose: () => void; onDownload?: () => void }) {
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
          <a className="btn primary" href={GUIDE_URL} download={GUIDE_FILE_NAME}
            onClick={() => {
              onDownload?.()
              onClose()
            }}
          >
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

/** The guide read inside the app (a same-origin PDF in an iframe, which the CSP's frame-src 'self' allows), with a Download button for keeping it. */
export function GuideViewer({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="User guide"
      subtitle={`COD | KPN Downstream Commercial Documents · ${GUIDE_VERSION}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            The guide does not show on your device? Download it instead.
          </span>
          <a className="btn" href={GUIDE_URL} download={GUIDE_FILE_NAME}>
            <Download aria-hidden />
            Download
          </a>
          <button className="btn primary" type="button" onClick={onClose}>
            <X aria-hidden />
            Close
          </button>
        </>
      }
    >
      <div className="guide-frame">
        <iframe src={GUIDE_VIEW_URL} title={`COD user guide ${GUIDE_VERSION}`} />
      </div>
    </Modal>
  )
}
