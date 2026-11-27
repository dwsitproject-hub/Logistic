'use client'

import { Check, Download, ExternalLink, FileText, Info, Minus, ReceiptText, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { apiBlob, apiData, apiJson, errorMessage, toQuery } from '@/lib/api'
import type { Access } from '@/lib/access'
import {
  DOCUMENT_LABELS,
  DOCUMENT_TYPES,
  acceptsImages,
  documentKey,
  isB2bOrigin,
  typeLabel,
  isShipmentPo,
  slotsFor,
  typesDone,
  uploadProblem,
  versionsOf,
  type DocumentType,
} from '@/lib/documentTypes'
import { dateTime, longDate, num } from '@/lib/format'
import { saveBlob } from '@/lib/files'
import type { B2bParty, DocumentFile, DocumentRow, HistoryEntry } from '@/lib/types'
import { ErrorNote, Modal, Spinner, useToast } from '../ui'
import { SHIPMENT_DOCS_NOTE, ShipmentDocsPicker, useShipmentDocs } from './ShipmentDocsCard'

type Preview = { fileId: string; url: string; isImage: boolean } | { fileId: string; error: string }

const ACTION_TEXT: Record<HistoryEntry['action_type'], string> = { ADD: 'Uploaded', EDIT: 'Uploaded a new version of', DELETE: 'Deleted' }

/** Right-hand drawer for one PO: the eleven-type checklist, upload, versions, preview, delete and history. */
export function DocumentDrawer({
  row,
  access,
  onClose,
  onChanged,
  onTandaTerima,
}: {
  row: DocumentRow
  access: Access
  onClose: () => void
  /** A file was added or deleted: the list's checklist dots and the cards must reload. */
  onChanged: () => void
  onTandaTerima: (row: DocumentRow) => void
}) {
  const { toast } = useToast()
  const key = documentKey(row)
  const [files, setFiles] = useState<DocumentFile[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [parties, setParties] = useState<B2bParty[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState<'checklist' | 'history'>('checklist')
  const [type, setType] = useState<DocumentType | null>(null)
  // "Shipment Docs" is listed in the checklist like a document type but is not one of the eleven COD types: its files are the BL / SI uploaded in KLIP, picked in
  // the right-hand panel and shown in the same viewer.
  const [shipmentView, setShipmentView] = useState(false)
  const [shipmentFileId, setShipmentFileId] = useState<string | null>(null)
  const shipment = useShipmentDocs(key)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [actionError, setActionError] = useState('')
  const [dragType, setDragType] = useState<DocumentType | 'drop' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DocumentFile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const previewUrl = useRef<string | null>(null)
  // The files this person has uploaded in this drawer, by the id the server gave them. The preview of a version that was just uploaded is shown from the file the
  // browser already holds, instead of fetching it back from the server (a read of the share that took 1 - 2 s, and now and then 10 - 20 s).
  const justUploaded = useRef<Map<string, File>>(new Map())

  const qs = toQuery({ contract_ext_no: row.contract_ext_no })

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const [f, h] = await Promise.all([
        apiData<DocumentFile[]>(`/commercial-documents/files/${encodeURIComponent(key)}${qs}`),
        apiData<HistoryEntry[]>(`/commercial-documents/history/${encodeURIComponent(key)}${qs}`),
      ])
      setFiles(f || [])
      setHistory(h || [])
      return f || []
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load the documents. Please try again.'))
      return null
    } finally {
      setLoading(false)
    }
  }, [key, qs])

  // The Retry button of a failed load: the same opening choice as the first load, which a failed first load never made.
  const retryLoad = () => {
    setLoading(true)
    void load().then((f) => {
      if (f) setType((cur) => cur ?? DOCUMENT_TYPES.find((t) => versionsOf(f, t).length) ?? 'contract')
    })
  }

  // First load: open on the first type that has a file, else Contract.
  useEffect(() => {
    let alive = true
    void load().then((f) => {
      if (!alive || !f) return
      setType((cur) => cur ?? DOCUMENT_TYPES.find((t) => versionsOf(f, t).length) ?? 'contract')
    })
    if (isB2bOrigin(row)) {
      apiData<B2bParty[] | { parties: B2bParty[] }>(`/contracts/${row.id}/b2b-parties`)
        .then((d) => alive && setParties(Array.isArray(d) ? d : d?.parties || []))
        .catch(() => alive && setParties([]))
    }
    return () => {
      alive = false
    }
  }, [load, row])

  const versions = useMemo(() => (type ? versionsOf(files, type) : []), [files, type])
  const current = versions.find((v) => v.id === versionId) ?? versions[versions.length - 1] ?? null

  // Show the newest version whenever the type or its versions change.
  useEffect(() => setVersionId(null), [type, files])

  const shipmentCurrent = shipment.files.find((f) => f.id === shipmentFileId) ?? shipment.slotFiles[0] ?? shipment.files[0] ?? null
  // The file the viewer shows: a COD version, or (Shipment Docs) a file KLIP holds, which the open endpoint of the KLIP documents serves.
  const viewed = shipmentView
    ? shipmentCurrent
      ? { id: shipmentCurrent.id, name: shipmentCurrent.fileName, viewPath: `/documents/${encodeURIComponent(shipmentCurrent.id)}/view` }
      : null
    : current
      ? { id: current.id, name: current.file_name, viewPath: `/commercial-documents/file/${current.id}/view` }
      : null

  const dropPreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
    setPreview(null)
  }

  // Load the preview of the current version.
  useEffect(() => {
    dropPreview()
    if (!viewed) return
    let alive = true
    setPreviewLoading(true)
    const held = justUploaded.current.get(viewed.id)
    ;(held ? Promise.resolve({ blob: held as Blob }) : apiBlob(viewed.viewPath))
      .then(async ({ blob }) => {
        const isImage = blob.type.startsWith('image/')
        let shown = blob
        if (!isImage) {
          // The iframe follows the blob's type, and that is the server's Content-Type (the stored mime_type). Anything but
          // application/pdf (octet-stream, a missing type) makes Chrome download the file instead of showing it, which left
          // an empty panel and a "download blocked" notice. So the type is set here, as the KLIP viewer does, after checking
          // that the file really is a PDF: otherwise an error text would be shown as a blank viewer.
          const head = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer())
          if (!head.startsWith('%PDF')) {
            if (alive) setPreview({ fileId: viewed.id, error: 'This file is not a valid PDF and cannot be previewed. You can still download it.' })
            return
          }
          shown = new Blob([blob], { type: 'application/pdf' })
        }
        if (!alive) return
        const url = URL.createObjectURL(shown)
        previewUrl.current = url
        setPreview({ fileId: viewed.id, url, isImage })
      })
      .catch((err) => alive && setPreview({ fileId: viewed.id, error: errorMessage(err, 'The file could not be opened.') }))
      .finally(() => alive && setPreviewLoading(false))
    return () => {
      alive = false
    }
  }, [viewed?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      dropPreview()
      justUploaded.current.clear()
    },
    [],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog on top (delete, Tanda Terima) handles its own Escape.
      if (e.key === 'Escape' && !uploading && !document.querySelector('.modal')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, uploading])

  const upload = async (target: DocumentType, file: File) => {
    if (uploading) return
    const problem = uploadProblem(target, file)
    if (problem) {
      setType(target)
      setActionError(problem)
      return
    }
    setUploading(true)
    setActionError('')
    setShipmentView(false)
    setType(target)
    try {
      // Field order matters: the backend picks the folder and the file-type rule from the fields that arrive BEFORE the file.
      const form = new FormData()
      form.append('contract_ext_no', row.contract_ext_no)
      form.append('document_type', target)
      form.append('po_number', key)
      form.append('buyer_name', row.buyer || row.supplier || '')
      form.append('contract_date', row.contract_date || '')
      form.append('file', file)
      const res = await apiJson<{ file_name: string; file_id?: string }>('/commercial-documents/upload', { method: 'POST', body: form })
      toast(`${DOCUMENT_LABELS[target]} uploaded · ${res.data?.file_name || file.name}`)
      if (res.data?.file_id) {
        justUploaded.current.set(res.data.file_id, file)
        // A drawer open for a long session must not keep every file: only the latest few.
        while (justUploaded.current.size > 5) justUploaded.current.delete(justUploaded.current.keys().next().value as string)
      }
      // The upload is done: the spinner stops here. The file list and the table behind the drawer refresh without holding the person up.
      onChanged()
      void load()
    } catch (err) {
      setActionError(errorMessage(err, 'Upload failed. Please try again.'))
    } finally {
      setUploading(false)
    }
  }

  const download = async (file: DocumentFile) => {
    setActionError('')
    try {
      const { blob, fileName } = await apiBlob(`/commercial-documents/file/${file.id}/download`)
      saveBlob(blob, fileName || file.file_name)
    } catch (err) {
      setActionError(errorMessage(err, 'Download failed. Please try again.'))
    }
  }

  const remove = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await apiJson(`/commercial-documents/file/${confirmDelete.id}`, { method: 'DELETE' })
      toast('Version deleted · recorded in the history and audit trail')
      setConfirmDelete(null)
      await load()
      onChanged()
    } catch (err) {
      setActionError(errorMessage(err, 'Delete failed. Please try again.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const canUpload = (t: DocumentType) => access.upload(t) && !uploading
  const onDragOver = (e: DragEvent, target: DocumentType, mark: DocumentType | 'drop') => {
    if (!canUpload(target) || !Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragType(mark)
  }
  const onDrop = (e: DragEvent, target: DocumentType) => {
    e.preventDefault()
    setDragType(null)
    const file = e.dataTransfer.files?.[0]
    if (file && canUpload(target)) void upload(target, file)
  }

  const uploaderOf = (file: DocumentFile) =>
    history.find((h) => h.file_name === file.file_name && h.action_type !== 'DELETE')?.user_name || null
  // The twelfth slot (Shipment Docs) counts for a shipment PO only; it is read from what KLIP holds once that has loaded, before that from the list row.
  const shipmentDone = shipment.groups ? shipment.slotFiles.length > 0 : Boolean(row.doc_shipment_docs)
  const done = loading ? typesDone(row) : typesDone({ ...row, ...flagsFrom(files), doc_shipment_docs: shipmentDone })
  const slots = slotsFor(row)
  const po = row.po_number || row.contract_ext_no

  // The viewer, shared by the document types and Shipment Docs.
  const viewerBox = (
    <div className="viewer">
      {!viewed ? (
        <div className="placeholder">
          <FileText width={40} height={40} aria-hidden />
          <span>{shipmentView ? 'The document shows here once a BL or SI is uploaded in KLIP.' : 'The document shows here once it’s uploaded.'}</span>
        </div>
      ) : previewLoading || !preview ? (
        <div className="placeholder">
          <Spinner label="Loading preview" />
        </div>
      ) : 'error' in preview ? (
        <div className="placeholder">
          <ErrorNote>{preview.error}</ErrorNote>
        </div>
      ) : preview.isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.url} alt={viewed.name} />
      ) : (
        <iframe src={preview.url} title={`Preview of ${viewed.name}`} />
      )}
    </div>
  )

  return (
    <>
      <div className="scrim" onClick={() => !uploading && onClose()} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Documents for PO ${po}`}>
        <header className="d-head">
          <div style={{ minWidth: 0 }}>
            <h2>
              <span className="mono" style={{ fontSize: 16 }}>
                PO {po}
              </span>
              <span className={`pill ${done === slots ? 'ok' : done ? 'warn' : 'bad'}`}>{done} of {slots} documents</span>
            </h2>
            <div className="meta">
              <span>
                <b>Contract</b>
                {row.contract_ext_no}
              </span>
              <span>
                <b>Supplier</b>
                {row.supplier || '-'}
              </span>
              <span>
                <b>Buyer</b>
                {row.buyer || '-'}
              </span>
              <span>
                <b>
                  {row.product || '-'} · {row.incoterm || '-'}
                </b>
                {num(row.quantity_ordered)} kg
              </span>
              <span>
                <b>Plant</b>
                {row.plant_site || '-'}
              </span>
              <span>
                <b>Date</b>
                {longDate(row.contract_date)}
              </span>
            </div>
          </div>
          <div className="actions">
            <button className="btn" type="button" onClick={() => onTandaTerima(row)}>
              <ReceiptText aria-hidden />
              Tanda Terima for this PO
            </button>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
              <X aria-hidden />
            </button>
          </div>
        </header>
        <div className="d-body">
          <div className="d-left">
            <div className="tabs" role="tablist">
              <button role="tab" type="button" aria-selected={tab === 'checklist'} onClick={() => setTab('checklist')}>
                Checklist
              </button>
              <button role="tab" type="button" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
                History{history.length ? ` (${history.length})` : ''}
              </button>
            </div>
            <ErrorNote onRetry={retryLoad}>{loadError}</ErrorNote>
            {loading ? (
              <Spinner />
            ) : tab === 'checklist' ? (
              <div className="doc-list">
                {DOCUMENT_TYPES.map((t) => {
                  const v = versionsOf(files, t)
                  const latest = v[v.length - 1]
                  const by = latest ? uploaderOf(latest) : null
                  return (
                    <button
                      type="button"
                      key={t}
                      className={`doc${dragType === t ? ' over' : ''}`}
                      aria-pressed={type === t && !shipmentView}
                      onClick={() => {
                        setShipmentView(false)
                        setType(t)
                        setActionError('')
                      }}
                      onDragOver={(e) => onDragOver(e, t, t)}
                      onDragLeave={() => setDragType((c) => (c === t ? null : c))}
                      onDrop={(e) => onDrop(e, t)}
                    >
                      <span className={`st ${latest ? 'ok' : 'miss'}`}>{latest ? <Check aria-hidden /> : <Minus aria-hidden />}</span>
                      <div style={{ minWidth: 0 }}>
                        <b>{DOCUMENT_LABELS[t]}</b>
                        <small>
                          {latest
                            ? `v${v.length} · ${dateTime(latest.created_at)}${by ? ` · ${by}` : ''}`
                            : 'Not uploaded yet'}
                        </small>
                      </div>
                      {latest ? <span className="pill ok">Uploaded</span> : <span className="pill neutral">Missing</span>}
                    </button>
                  )
                })}
                {(() => {
                  // Shipment Docs: the same row as a document type (status, latest upload, who), opening the BL / SI that KLIP holds in the viewer.
                  const n = shipment.slotFiles.length // BL / SI only: Loading, Discharge and Others are shown in the picker but do not make the slot
                  const latestShip = shipment.latest
                  return (
                    <button
                      type="button"
                      className="doc"
                      aria-pressed={shipmentView}
                      onClick={() => {
                        setShipmentView(true)
                        setActionError('')
                      }}
                    >
                      <span className={`st ${n ? 'ok' : 'miss'}`}>{n ? <Check aria-hidden /> : <Minus aria-hidden />}</span>
                      <div style={{ minWidth: 0 }}>
                        <b>Shipment Docs</b>
                        <small>
                          {shipment.error
                            ? 'Could not load'
                            : shipment.groups === null
                              ? 'Loading…'
                              : latestShip
                                ? `${n} ${n === 1 ? 'file' : 'files'} · ${dateTime(latestShip.uploadedAt)}${latestShip.uploadedBy ? ` · ${latestShip.uploadedBy}` : ''} · via KLIP`
                                : 'Not uploaded yet'}
                        </small>
                      </div>
                      {n ? <span className="pill ok">Uploaded</span> : <span className="pill neutral">Missing</span>}
                    </button>
                  )
                })()}
              </div>
            ) : (
              <div className="timeline">
                {history.length ? (
                  history.map((h) => (
                    <div className="tl" key={h.id}>
                      <span className={`b${h.action_type === 'DELETE' ? ' del' : ''}`} />
                      <div style={{ minWidth: 0 }}>
                        <p>
                          {ACTION_TEXT[h.action_type] || h.action_type} {h.document_type_label || typeLabel(h.document_type)}
                        </p>
                        <small style={{ display: 'block', wordBreak: 'break-all' }}>{h.file_name || ''}</small>
                        <small>
                          {h.user_name || 'Unknown user'} · {dateTime(h.created_at)}
                          {h.source === 'KLIP' ? <span className="badge" title="Uploaded in KLIP (Shipments > Edit Shipment)">via KLIP</span> : null}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="hint">Nothing has been uploaded for this PO yet.</p>
                )}
              </div>
            )}
            {parties.length ? (
              <div className="panel" style={{ padding: 12 }}>
                <span className="flabel">B2B parties ({parties.length})</span>
                <div className="b2b" style={{ marginTop: 8 }}>
                  {parties.map((p) => (
                    <div className="r" key={p.contract_id}>
                      <span className="ellipsis">
                        <span className="mono">{p.po_numbers || p.contract_ext_no || '-'}</span>
                        <span className="sub hint">{p.company_name || p.buyer || p.supplier || '-'}</span>
                      </span>
                      <span className="num hint">{p.incoterm || ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="d-right">
            {shipmentView ? (
              <>
                <div className="viewer-bar">
                  <div className="file">
                    <FileText width={18} height={18} aria-hidden />
                    <div style={{ minWidth: 0 }}>
                      <b style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        Shipment Docs
                        <span className="sd-info" tabIndex={0} role="note" aria-label={SHIPMENT_DOCS_NOTE} title={SHIPMENT_DOCS_NOTE}>
                          <Info aria-hidden />
                        </span>
                      </b>
                      <span className="hint ellipsis" style={{ display: 'block' }}>
                        {shipmentCurrent ? shipmentCurrent.fileName : 'Nothing uploaded in KLIP yet'}
                      </span>
                    </div>
                  </div>
                  {shipmentCurrent ? (
                    <div className="actions">
                      {preview && 'url' in preview ? (
                        <a className="btn sm" href={preview.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink aria-hidden />
                          Open
                        </a>
                      ) : null}
                      <a className="btn sm" href={`/api/documents/${encodeURIComponent(shipmentCurrent.id)}/download`} download>
                        <Download aria-hidden />
                        Download
                      </a>
                    </div>
                  ) : null}
                </div>
                <ErrorNote>{shipment.error}</ErrorNote>
                {shipment.groups ? <ShipmentDocsPicker groups={shipment.groups} selectedId={shipmentCurrent?.id ?? null} onSelect={setShipmentFileId} /> : null}
                {viewerBox}
              </>
            ) : type ? (
              <>
                <div className="viewer-bar">
                  <div className="file">
                    <FileText width={18} height={18} aria-hidden />
                    <div style={{ minWidth: 0 }}>
                      <b style={{ display: 'block' }}>{DOCUMENT_LABELS[type]}</b>
                      <span className="hint ellipsis" style={{ display: 'block' }}>
                        {current ? current.file_name : 'No file yet for this document type'}
                      </span>
                    </div>
                  </div>
                  {current ? (
                    <div className="actions">
                      {versions.length > 1 ? (
                        <select
                          className="select"
                          style={{ height: 32, width: 'auto' }}
                          aria-label="Version"
                          value={current.id}
                          onChange={(e) => setVersionId(e.target.value)}
                        >
                          {versions
                            .map((v, i) => (
                              <option key={v.id} value={v.id}>
                                v{i + 1}
                                {i === versions.length - 1 ? ' · latest' : ''} · {dateTime(v.created_at)}
                              </option>
                            ))
                            .reverse()}
                        </select>
                      ) : null}
                      {preview && 'url' in preview ? (
                        <a className="btn sm" href={preview.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink aria-hidden />
                          Open
                        </a>
                      ) : null}
                      <button className="btn sm" type="button" onClick={() => void download(current)}>
                        <Download aria-hidden />
                        Download
                      </button>
                      {access.deleteFiles ? (
                        <button className="btn sm danger" type="button" onClick={() => setConfirmDelete(current)}>
                          <Trash2 aria-hidden />
                          Delete
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {access.upload(type) ? (
                  <label
                    className={`drop${dragType === 'drop' ? ' over' : ''}${uploading ? ' busy' : ''}`}
                    onDragOver={(e) => onDragOver(e, type, 'drop')}
                    onDragLeave={() => setDragType((c) => (c === 'drop' ? null : c))}
                    onDrop={(e) => onDrop(e, type)}
                  >
                    <Upload aria-hidden />
                    <b>{uploading ? 'Uploading…' : current ? 'Upload a new version' : `Upload ${DOCUMENT_LABELS[type]}`}</b>
                    <span className="hint">
                      Drag a {acceptsImages(type) ? 'PDF or image' : 'PDF'} here or click to choose · max 15 MB
                      {type === 'contract' && current ? ' · replaces the current contract' : ''}
                    </span>
                    <input
                      ref={fileInput}
                      className="sr"
                      type="file"
                      disabled={uploading}
                      accept={acceptsImages(type) ? 'application/pdf,image/png,image/jpeg,image/webp' : 'application/pdf'}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (f) void upload(type, f)
                      }}
                    />
                  </label>
                ) : (
                  <p className="hint" style={{ margin: 0 }}>
                    Your role may view {DOCUMENT_LABELS[type]} but not upload it.
                  </p>
                )}
                <ErrorNote>{actionError}</ErrorNote>

                {viewerBox}
              </>
            ) : (
              <Spinner />
            )}
          </div>
        </div>
      </aside>
      {confirmDelete ? (
        <Modal
          title="Delete this version?"
          onClose={() => setConfirmDelete(null)}
          busy={deleting}
          narrow
          footer={
            <>
              <button className="btn" type="button" onClick={() => setConfirmDelete(null)} disabled={deleting}>
                Keep it
              </button>
              <button className="btn danger-fill" type="button" onClick={() => void remove()} disabled={deleting}>
                <Trash2 aria-hidden />
                {deleting ? 'Deleting…' : 'Delete version'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--ink-2)' }}>
            <b>{confirmDelete.file_name}</b> leaves this PO&apos;s checklist. Other versions stay, and the delete is written to the
            history and the audit trail.
          </p>
        </Modal>
      ) : null}
    </>
  )
}

/** The doc_* flags implied by the files loaded in the drawer (fresher than the list row after an upload). */
function flagsFrom(files: DocumentFile[]): Partial<DocumentRow> {
  return Object.fromEntries(DOCUMENT_TYPES.map((t) => [`doc_${t}`, versionsOf(files, t).length > 0]))
}
