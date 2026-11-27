/**
 * The email that goes out when a user presses Submit to Jetty and JPS accepts the instruction (Pending).
 *
 * Who receives it, the subject and the body are RULES, one per discharge port plus a default (Integrations > JPS > Email notifications, table jps_notify_rules), so a
 * change of recipients or wording needs no deploy and no code change, and Bontang can differ from Lubuk Gaung. The master switch JPS_NOTIFY_ENABLED turns all of it off.
 * The wording used while a rule's subject or body is empty follows the "UPCOMING Vessel" mail the shipping team writes by hand today (the default rule is seeded with it).
 *
 * It is a notification, never a step of the submit: it runs after JPS answered, it never throws, and a failure is logged and nothing else. It is sent only for a NEW
 * instruction ('submitted'); a duplicate JPS already held ('recovered') and a refusal send nothing. Only the button sends it: the automatic sweep does not.
 */
import fs from 'fs';
import { query } from '../database/connection';
import { resolveUploadAbsolutePath } from '../utils/fileUpload';
import { COD_FILES_SQL, groupCodFiles, latestCodContracts, type CodFileRow } from '../utils/codFiles';
import { sendEmail } from '../services/email.service';
import { isEmailFeatureEnabled } from '../services/emailFeatures';
import { parseEmailList } from '../integrations/registry';
import { chooseNotifyRule, listNotifyRules } from './notifyRules';
import logger from '../utils/logger';
import type { EligibleSto } from './eligibility';
import { loadPoDeliveryQty, hasDeliveryQty, type PoDeliveryRow } from './deliveryQty';

export const DEFAULT_NOTIFY_SUBJECT = 'UPCOMING Vessel EUP {discharge_port} - {vessel} - {loading_port} to {discharge_port}{revision_note}';

export const DEFAULT_NOTIFY_BODY = [
  'Dengan Hormat,',
  '',
  'Berikut saya informasikan detail pengapalan {discharge_port}, dengan detail sebagai berikut :',
  '',
  'VESSEL : {vessel}',
  'COMMODITY : {commodity}',
  'SHIPPER : {shipper}',
  'LOADING PORT : {loading_port}',
  'QTY : {qty_kg} Kg',
  'ETA {discharge_port} : {eta}',
  'TERM : {incoterm}',
  '',
  '{po_table}',
  '',
  'Demikian saya sampaikan, terima kasih.',
].join('\n');

export interface NotifyPoRow {
  shipper: string;
  contract: string;
  po: string;
  qtyKg: number | null;
}

export interface NotifyData {
  vessel: string;
  commodity: string;
  shipper: string;
  loadingPort: string;
  dischargePort: string;
  /** The discharge Master Port as its rule is keyed (upper case, "PORT BONTANG"); empty when the shipment has none. */
  masterPort: string;
  qtyKg: number | null;
  eta: string;
  incoterm: string;
  stoNumber: string;
  revision: number;
  rows: NotifyPoRow[];
}

const DASH = '-';

/** 2645542 -> "2.645.542", the way the shipping team writes a quantity in kilograms. */
export function formatNotifyQty(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(Number(kg))) return DASH;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(Number(kg));
}

/** "22 Nov 2026" in Jakarta time; "-" when there is no usable date. */
export function formatNotifyDate(value: unknown): string {
  if (value == null || value === '') return DASH;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return DASH;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(d);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function distinct(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw ?? '').trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/** "PORT LABANAN" -> "LABANAN". */
export function stripPortPrefix(name: string | null | undefined): string {
  return String(name ?? '').trim().replace(/^PORT\s+/i, '');
}

/** The values a subject or body can name, as plain text. */
export function notifyPlaceholders(data: NotifyData): Record<string, string> {
  return {
    vessel: data.vessel || DASH,
    commodity: data.commodity || DASH,
    shipper: data.shipper || DASH,
    loading_port: data.loadingPort || DASH,
    discharge_port: data.dischargePort || DASH,
    qty_kg: formatNotifyQty(data.qtyKg),
    eta: data.eta || DASH,
    incoterm: data.incoterm || DASH,
    sto_number: data.stoNumber || DASH,
    revision: String(data.revision),
    revision_note: data.revision > 1 ? ` (Revisi R${data.revision})` : '',
  };
}

/** Replaces {name} with its value; a name nobody defined is left as typed, so a typo in the setting shows in the email instead of vanishing. */
export function fillPlaceholders(template: string, values: Record<string, string>, escape = false): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) return whole;
    return escape ? escapeHtml(values[name] as string) : (values[name] as string);
  });
}

/** The Shipper / Kontrak / PO / Qty table with its total, in the layout of the hand-written mail. */
export function buildPoTableHtml(rows: NotifyPoRow[]): string {
  const cell = 'border:1px solid #999;padding:4px 10px;';
  const head = ['Shipper', 'Kontrak', 'PO', 'Qty (kg)']
    .map((h) => `<th style="${cell}background:#f2f2f2;text-align:left;">${h}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr><td style="${cell}">${escapeHtml(r.shipper || DASH)}</td><td style="${cell}">${escapeHtml(r.contract || DASH)}</td><td style="${cell}">${escapeHtml(r.po || DASH)}</td><td style="${cell}text-align:right;">${escapeHtml(formatNotifyQty(r.qtyKg))}</td></tr>`,
    )
    .join('');
  const total = rows.reduce((sum, r) => sum + (r.qtyKg ?? 0), 0);
  const foot = `<tr><td colspan="3" style="${cell}font-weight:bold;">TOTAL</td><td style="${cell}font-weight:bold;text-align:right;">${escapeHtml(formatNotifyQty(total))}</td></tr>`;
  return `<table style="border-collapse:collapse;font-size:13px;"><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>`;
}

/** Subject (plain) and body (HTML) from the two templates; an empty template falls back to the built-in wording. */
export function buildNotifyEmail(data: NotifyData, templates: { subject?: string | null; body?: string | null }): { subject: string; html: string } {
  const values = notifyPlaceholders(data);
  const subjectTemplate = String(templates.subject ?? '').trim() || DEFAULT_NOTIFY_SUBJECT;
  const bodyTemplate = String(templates.body ?? '').replace(/\r\n/g, '\n').trim() || DEFAULT_NOTIFY_BODY;

  const subject = fillPlaceholders(subjectTemplate, values).replace(/\s+/g, ' ').trim();
  const poTable = buildPoTableHtml(data.rows);
  const html = bodyTemplate
    .split(/(\{po_table\})/)
    .map((part) => (part === '{po_table}' ? poTable : escapeHtml(fillPlaceholders(part, values)).replace(/\n/g, '<br>')))
    .join('');
  return { subject, html: `<div style="font-family:Calibri,Arial,sans-serif;font-size:14px;">${html}</div>` };
}

/**
 * The PO rows of the mail: one per cargo line, with the quantity of its shipment. A B2B CHILD is written as its PARENT (parent's PO, contract and supplier): KLIP knows the chain by
 * its parent, and SAP books the STO on the child, so the child's shipment quantity is the chain's quantity. Two lines of one chain would repeat the cargo, so a parent is listed once.
 */
export function notifyRowsFromCargo(
  cargo: Array<{ contract_no: string | null; po_no: string | null }>,
  delivery: PoDeliveryRow[],
  supplierByContract: Map<string, string>,
): NotifyPoRow[] {
  const deliveryByContract = new Map(delivery.map((r) => [r.contract, r] as const));
  const rows: NotifyPoRow[] = [];
  const parents = new Set<string>();
  for (const c of cargo) {
    const own = String(c.contract_no ?? '');
    const d = deliveryByContract.get(own);
    const qtyKg = d && hasDeliveryQty(d) ? (d.qtyKg as number) : null;
    if (d && d.originContract) {
      if (parents.has(d.originContract)) continue;
      parents.add(d.originContract);
      rows.push({ shipper: d.originSupplier || supplierByContract.get(own) || '', contract: d.originContract, po: d.originPo || String(c.po_no ?? ''), qtyKg });
      continue;
    }
    rows.push({ shipper: supplierByContract.get(own) ?? '', contract: own, po: String(c.po_no ?? ''), qtyKg });
  }
  return rows;
}

/** What the email says, read from the STO that was just submitted and the contracts and ports behind it. */
export async function loadNotifyData(sto: EligibleSto, revision: number): Promise<NotifyData> {
  const contractIds = distinct(sto.cargo.map((c) => c.contract_no));
  const supplierByContract = new Map<string, string>();
  if (contractIds.length > 0) {
    const res = await query(`SELECT contract_id, supplier FROM contracts WHERE contract_id = ANY($1::text[])`, [contractIds]);
    for (const r of res.rows as Array<{ contract_id: string; supplier: string | null }>) {
      supplierByContract.set(String(r.contract_id), String(r.supplier ?? '').trim());
    }
  }

  let loadingPorts: string[] = [];
  let dischargePort = '';
  let masterPort = '';
  if (sto.shipment_ids.length > 0) {
    const ports = await query(
      `SELECT v.port_name, COALESCE(v.is_discharge_port, FALSE) AS is_discharge, v.port_sequence,
              mp.port AS master_port
         FROM vessel_loading_ports v
         LEFT JOIN master_loading_ports mp ON mp.id = v.master_port_id
        WHERE v.shipment_id::text = ANY($1::text[]) AND COALESCE(v.is_cancelled, FALSE) IS NOT TRUE
        ORDER BY v.port_sequence NULLS LAST`,
      [sto.shipment_ids],
    );
    const rows = ports.rows as Array<{ port_name: string | null; is_discharge: boolean; master_port: string | null }>;
    // A Master Port reads "PORT LABANAN"; the mail writes "LABANAN", as it does for the discharge port.
    loadingPorts = distinct(rows.filter((r) => !r.is_discharge).map((r) => stripPortPrefix(r.port_name)));
    const discharge = rows.find((r) => r.is_discharge);
    // The Master Port reads "PORT BONTANG"; the mail writes "BONTANG". A plant name (EUP EDIBLE OIL BONTANG) is only the fallback.
    masterPort = String(discharge?.master_port || '').trim().replace(/\s+/g, ' ').toUpperCase();
    dischargePort = String(discharge?.master_port || discharge?.port_name || '')
      .trim()
      .replace(/^PORT\s+/i, '')
      .toUpperCase();
  }

  // The quantity written is the KLIP Delivery Qty of each PO (Edit Shipment), which Submit to Jetty requires to be filled; NOT the contract or the STO quantity.
  const rows = notifyRowsFromCargo(sto.cargo, await loadPoDeliveryQty(sto.sto_key), supplierByContract);
  const qtyKg = rows.some((r) => r.qtyKg != null) ? rows.reduce((sum, r) => sum + (r.qtyKg ?? 0), 0) : null;

  return {
    vessel: String(sto.vessel_name ?? '').trim(),
    commodity: distinct(sto.cargo.map((c) => c.product)).join(', '),
    shipper: distinct(rows.map((r) => r.shipper)).join(', '),
    loadingPort: loadingPorts.join(', '),
    dischargePort,
    masterPort,
    qtyKg,
    eta: formatNotifyDate(sto.eta_discharge_arrival),
    incoterm: String(sto.incoterm ?? '').trim(),
    stoNumber: sto.sto_key,
    revision,
    rows,
  };
}

/**
 * What goes out with the mail: the Contract of EACH PO of the STO (KLIP's own, else the newest uploaded in Commercial Documents), and the newest SI and BL of the STO, attached
 * as files. (JPS gets one Contract link, the newest of all; the mail carries every PO's contract.)
 */
export interface NotifyDocumentRow {
  document_type: string;
  file_name: string;
  file_path: string;
  /** What the "not attached" note calls this file, when the type alone is not enough (one Contract per PO: "Contract PO 1011003087"). */
  label?: string;
}

/** The Contract file of one PO, from KLIP (documents) or from Commercial Documents; `poKey` is the PO number, or the contract number when SAP sent no PO. */
export interface NotifyContractSource {
  poKey: string;
  fileName: string;
  filePath: string;
}

/**
 * One Contract row per PO of the STO, in the order of `poKeys`. A PO's own KLIP Contract wins over the one in Commercial Documents (a file someone chose for the shipment is not
 * replaced by a newer upload elsewhere). A PO with neither is returned in `missing`. With more than one PO each file name starts with its PO number, so three contracts that
 * happen to share a name can be told apart by the person reading the mail. Pure: tested without a database.
 */
export function chooseContractRowsPerPo(
  poKeys: string[],
  klip: NotifyContractSource[],
  cod: NotifyContractSource[],
): { rows: NotifyDocumentRow[]; missing: string[] } {
  const rows: NotifyDocumentRow[] = [];
  const missing: string[] = [];
  const several = poKeys.length > 1;
  for (const po of poKeys) {
    const src = klip.find((s) => s.poKey === po) ?? cod.find((s) => s.poKey === po);
    if (!src) {
      missing.push(po);
      continue;
    }
    rows.push({
      document_type: 'CONTRACT',
      file_name: several ? `${po}_${src.fileName}` : src.fileName,
      file_path: src.filePath,
      label: several ? `Contract PO ${po}` : undefined,
    });
  }
  return { rows, missing };
}

export interface NotifyAttachments {
  attachments: Array<{ filename: string; path: string }>;
  /** Documents that exist but were left out, with the reason, so the mail can say so instead of silently going without. */
  skipped: Array<{ kind: string; reason: string }>;
}

/** Together the attachments must stay below this: base64 makes a mail about a third bigger and mail servers refuse large messages. */
export const NOTIFY_ATTACHMENT_LIMIT_BYTES = 15 * 1024 * 1024;

const DOCUMENT_ORDER = ['CONTRACT', 'SI', 'BL'];
const DOCUMENT_LABEL: Record<string, string> = { CONTRACT: 'Contract', SI: 'Shipping Instruction', BL: 'Bill of Lading' };

/**
 * Chooses which of the documents are attached, in the order Contract, SI, BL. A file that is not on disk is skipped, and so is one that would push the total over
 * the limit (a file is never cut). Pure apart from the two functions it is given, so the rules are tested without files.
 */
export function chooseNotifyAttachments(
  rows: NotifyDocumentRow[],
  fileSize: (absolutePath: string) => number | null,
  resolvePath: (storedPath: string) => string,
  limitBytes: number = NOTIFY_ATTACHMENT_LIMIT_BYTES,
): NotifyAttachments {
  const result: NotifyAttachments = { attachments: [], skipped: [] };
  const ordered = [...rows].sort(
    (a, b) => DOCUMENT_ORDER.indexOf(String(a.document_type).toUpperCase()) - DOCUMENT_ORDER.indexOf(String(b.document_type).toUpperCase()),
  );
  let total = 0;
  for (const row of ordered) {
    const kind = row.label ?? DOCUMENT_LABEL[String(row.document_type).toUpperCase()] ?? String(row.document_type);
    const absolute = resolvePath(row.file_path);
    const size = fileSize(absolute);
    if (size == null) {
      result.skipped.push({ kind, reason: 'file tidak ditemukan di server' });
      continue;
    }
    if (total + size > limitBytes) {
      result.skipped.push({ kind, reason: 'ukuran melebihi batas lampiran' });
      continue;
    }
    total += size;
    result.attachments.push({ filename: row.file_name, path: absolute });
  }
  return result;
}

/** A line under the mail naming what could not be attached; empty when everything was. */
export function skippedAttachmentsNote(skipped: NotifyAttachments['skipped']): string {
  if (skipped.length === 0) return '';
  const items = skipped.map((s) => `${escapeHtml(s.kind)} (${escapeHtml(s.reason)})`).join(', ');
  return `<p style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#8a4b00;">Catatan: lampiran berikut tidak disertakan: ${items}.</p>`;
}

/** The PO key a shipment's contract has in Commercial Documents: the PO number, else the contract number (SAP sent no PO). Same expression everywhere the two apps meet. */
const PO_KEY_SQL = `COALESCE(NULLIF(TRIM(c.po_number), ''), TRIM(c.contract_id))`;

/**
 * What the mail attaches, as files on disk: the Contract of EACH PO of the STO (a PO's own KLIP Contract, else the newest one uploaded in Commercial Documents) and the newest SI
 * and BL of the STO's shipments. A PO with no Contract anywhere is named in the "not attached" note, but only when the STO has several POs: with one, a missing Contract is
 * what the mail has always looked like.
 */
export async function loadNotifyAttachments(sto: EligibleSto): Promise<NotifyAttachments> {
  if (sto.shipment_ids.length === 0) return { attachments: [], skipped: [] };
  const [siBl, pos, klipContracts] = await Promise.all([
    query(
      `SELECT DISTINCT ON (UPPER(d.document_type)) UPPER(d.document_type) AS document_type, d.file_name, d.file_path
         FROM documents d
        WHERE d.shipment_id::text = ANY($1::text[])
          AND d.deleted_at IS NULL
          AND UPPER(d.document_type) IN ('SI', 'BL')
        ORDER BY UPPER(d.document_type), d.upload_date DESC NULLS LAST`,
      [sto.shipment_ids],
    ),
    query(
      `SELECT DISTINCT ${PO_KEY_SQL} AS po_key
         FROM shipments s JOIN contracts c ON c.id = s.contract_id
        WHERE s.id::text = ANY($1::text[])
        ORDER BY 1`,
      [sto.shipment_ids],
    ),
    query(
      `SELECT DISTINCT ON (${PO_KEY_SQL}) ${PO_KEY_SQL} AS po_key, d.file_name, d.file_path
         FROM documents d
         JOIN shipments s ON s.id = d.shipment_id
         JOIN contracts c ON c.id = s.contract_id
        WHERE s.id::text = ANY($1::text[])
          AND d.deleted_at IS NULL
          AND UPPER(d.document_type) = 'CONTRACT'
        ORDER BY ${PO_KEY_SQL}, d.upload_date DESC NULLS LAST`,
      [sto.shipment_ids],
    ),
  ]);
  const poKeys = (pos.rows as Array<{ po_key: string | null }>).map((r) => String(r.po_key ?? '').trim()).filter(Boolean);
  const klip: NotifyContractSource[] = (klipContracts.rows as Array<{ po_key: string; file_name: string; file_path: string }>).map((r) => ({
    poKey: String(r.po_key).trim(),
    fileName: r.file_name,
    filePath: r.file_path,
  }));

  // The POs with no Contract of their own in KLIP: the newest one uploaded in Commercial Documents, if any.
  const cod: NotifyContractSource[] = [];
  const needCod = poKeys.filter((po) => !klip.some((k) => k.poKey === po));
  if (needCod.length > 0) {
    try {
      const codRows = await query(COD_FILES_SQL, [needCod, ['contract']]);
      const latest = latestCodContracts(groupCodFiles(codRows.rows as CodFileRow[]), needCod);
      if (latest.length > 0) {
        const paths = await query(`SELECT id::text AS id, file_path FROM commercial_document_files WHERE id = ANY($1::uuid[])`, [latest.map((l) => l.version.id)]);
        const pathById = new Map((paths.rows as Array<{ id: string; file_path: string }>).map((p) => [p.id, p.file_path]));
        for (const l of latest) {
          const filePath = pathById.get(l.version.id);
          if (filePath) cod.push({ poKey: l.poNumber, fileName: l.version.fileName, filePath });
        }
      }
    } catch (err) {
      // The mail goes out with what KLIP holds: Commercial Documents is an addition, never a reason for the mail not to be sent.
      logger.warn('Submit to Jetty mail: Commercial Documents contracts skipped', { error: (err as Error)?.message });
    }
  }

  const contracts = chooseContractRowsPerPo(poKeys, klip, cod);
  const out = chooseNotifyAttachments(
    [...contracts.rows, ...(siBl.rows as NotifyDocumentRow[])],
    (absolute) => {
      try {
        return fs.statSync(absolute).isFile() ? fs.statSync(absolute).size : null;
      } catch {
        return null;
      }
    },
    resolveUploadAbsolutePath,
  );
  if (poKeys.length > 1) {
    for (const po of contracts.missing) out.skipped.push({ kind: `Contract PO ${po}`, reason: 'belum diunggah di KLIP maupun Commercial Documents' });
  }
  return out;
}

/** The Submit to Jetty email's switches (Integrations > Email): the master switch and its own, which is off until someone switches it on. */
export function isNotifyEnabled(): boolean {
  return isEmailFeatureEnabled('jps_submit');
}

/**
 * Where a test mail goes outside production. Written in the code on purpose (the owner's own address, asked for 2026-11-19): a SIT or local backend must never reach the
 * real recipient list, whatever the Integrations settings say, because SIT carries copies of real STOs and a button press there is a test.
 */
export const JPS_NOTIFY_NON_PRODUCTION_RECIPIENT = 'ryan.pohan@energi-up.com';

/**
 * True only on production: KLIP_ENV is `prod` or `production` (the same switch the commercial-documents NAS layout reads). It FAILS SAFE: an unset or any other KLIP_ENV
 * counts as not production, so a production host that lost the variable sends to the test address and is noticed, rather than mailing the whole list from a test.
 */
export function isProductionEnvironment(): boolean {
  const env = String(process.env.KLIP_ENV || '').trim().toLowerCase();
  return env === 'prod' || env === 'production';
}

export interface NotifyRecipients {
  to: string[];
  cc: string[];
  /** True when the configured list was replaced by the test address (not production). */
  redirected: boolean;
  /** How many people the configured list names; shown in the test mail so a tester sees what production would do. */
  configuredCount: number;
}

/**
 * Who gets the mail. Production: the settings' To and cc (an address in both gets one copy). Anywhere else: only the test address, no cc, whatever is configured,
 * and the settings do not even have to be filled in.
 */
export function resolveNotifyRecipients(configuredTo: string | undefined, configuredCc: string | undefined, production: boolean): NotifyRecipients {
  const to = parseEmailList(configuredTo).valid;
  const toKeys = new Set(to.map((a) => a.toLowerCase()));
  const cc = parseEmailList(configuredCc).valid.filter((a) => !toKeys.has(a.toLowerCase()));
  const configuredCount = to.length + cc.length;
  if (production) return { to, cc, redirected: false, configuredCount };
  return { to: [JPS_NOTIFY_NON_PRODUCTION_RECIPIENT], cc: [], redirected: true, configuredCount };
}

/** The mark a test mail carries, so nobody takes it for the real one. */
export function markAsTestMail(email: { subject: string; html: string }, configuredCount: number): { subject: string; html: string } {
  const note =
    configuredCount > 0
      ? `Email uji dari lingkungan non-produksi. Di produksi email ini dikirim ke ${configuredCount} penerima sesuai pengaturan.`
      : 'Email uji dari lingkungan non-produksi. Daftar penerima produksi belum diisi di pengaturan.';
  return {
    subject: `[TEST] ${email.subject}`,
    html: `<div style="background:#fff4e5;border:1px solid #f0b363;padding:8px 12px;margin-bottom:12px;font-family:Calibri,Arial,sans-serif;font-size:13px;">${note}</div>${email.html}`,
  };
}

/**
 * Example values for a test mail and for the modal's preview: a Bontang FOB shipment of the kind the hand-written mail describes.
 * Nothing here is a real shipment, shipper or contract.
 */
export function buildSampleNotifyData(masterPort = 'PORT BONTANG'): NotifyData {
  const dischargePort = masterPort.replace(/^PORT\s+/i, '') || 'BONTANG';
  return {
    vessel: 'TB. CONTOH PERKASA / BG. CONTOH 3001',
    commodity: 'CRUDE PALM OIL (CPO)',
    shipper: 'PT. CONTOH SUMBER LESTARI',
    loadingPort: 'LABANAN',
    dischargePort,
    masterPort,
    qtyKg: 2645542,
    eta: formatNotifyDate(new Date(Date.now() + 3 * 86_400_000)),
    incoterm: 'FOB',
    stoNumber: '1006000000',
    revision: 1,
    rows: [{ shipper: 'PT. CONTOH SUMBER LESTARI', contract: '000/CONTOH/CPO_EUP/I/2026', po: '1001000000', qtyKg: 2645542 }],
  };
}

/** A rule as it is being edited: what the test mail and the preview are built from. */
export interface NotifyRuleDraft {
  port: string | null;
  subject: string;
  body: string;
}

/** Subject and HTML for a rule draft with example values, marked as a test. For the modal's "Send test to me" and the preview; sends nothing by itself. */
export function buildRuleTestEmail(draft: NotifyRuleDraft): { subject: string; html: string } {
  const built = buildNotifyEmail(buildSampleNotifyData(draft.port ?? 'PORT BONTANG'), { subject: draft.subject, body: draft.body });
  return {
    subject: `[TEST] ${built.subject}`,
    html: `<div style="background:#fff4e5;border:1px solid #f0b363;padding:8px 12px;margin-bottom:12px;font-family:Calibri,Arial,sans-serif;font-size:13px;">Email uji dengan data contoh dari menu Integrations. Bukan pengiriman sebenarnya.</div>${built.html}`,
  };
}

/**
 * Sends the notification for a submission JPS just accepted. Resolves to what happened (for the log and the tests); never throws.
 * Nothing is sent while the master switch is off, when no rule applies, or when the applying rule is switched off. In production nothing is sent without a valid
 * recipient either; elsewhere the test address always receives it.
 */
export async function notifySubmittedToJetty(sto: EligibleSto, revision: number): Promise<'sent' | 'off' | 'no_recipient' | 'failed'> {
  try {
    if (!isNotifyEnabled()) return 'off';
    const data = await loadNotifyData(sto, revision);
    const rule = chooseNotifyRule(await listNotifyRules(), data.masterPort);
    if (!rule || !rule.enabled) {
      logger.info('JPS: Submit to Jetty email not sent, no active rule for this port', { stoKey: sto.sto_key, port: data.masterPort || null, rule: rule ? 'switched off' : 'none' });
      return 'off';
    }
    const recipients = resolveNotifyRecipients(rule.emailTo, rule.emailCc, isProductionEnvironment());
    if (recipients.to.length === 0) {
      logger.warn('JPS: Submit to Jetty email rule has no recipient, nothing sent', { stoKey: sto.sto_key, port: rule.port });
      return 'no_recipient';
    }
    const built = buildNotifyEmail(data, { subject: rule.subject, body: rule.body });
    const marked = recipients.redirected ? markAsTestMail(built, recipients.configuredCount) : built;
    // The documents are attached after the rest is settled: a problem with a file must never stop the mail itself.
    let files: NotifyAttachments = { attachments: [], skipped: [] };
    try {
      files = await loadNotifyAttachments(sto);
    } catch (error) {
      logger.warn('JPS: Submit to Jetty email goes without attachments', { stoKey: sto.sto_key, error: error instanceof Error ? error.message : String(error) });
    }
    const subject = marked.subject;
    const html = marked.html + skippedAttachmentsNote(files.skipped);
    const ok = await sendEmail({ feature: 'jps_submit', to: recipients.to, cc: recipients.cc, subject, html, attachments: files.attachments });
    logger.info('JPS: Submit to Jetty email', {
      stoKey: sto.sto_key,
      revision,
      sent: ok,
      rulePort: rule.port,
      toCount: recipients.to.length,
      ccCount: recipients.cc.length,
      redirectedToTestAddress: recipients.redirected,
      attached: files.attachments.length,
      notAttached: files.skipped.length,
    });
    return ok ? 'sent' : 'failed';
  } catch (error) {
    logger.error('JPS: Submit to Jetty email failed', { stoKey: sto.sto_key, error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
}
