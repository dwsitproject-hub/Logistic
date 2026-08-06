import { MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS } from '../utils/missingEtaAlertSql';

/** One row of the Contract ETA reminder — a contract missing ETA near its Cargo Readiness Date. */
export interface ContractEtaReminderRow {
  contract_id: string;
  contract_ext_no: string | null;
  po_number: string | null;
  supplier: string | null;
  product: string | null;
  incoterm: string | null;
  transport_mode: string | null;
  cargo_readiness_date: string | Date;
  days_to_cargo_readiness: number;
  sea_missing_eta: boolean;
  land_missing_eta: boolean;
}

/** Rows shown inline in the email body; beyond this, only a "+N more" note is shown. */
const MAX_ROWS_IN_EMAIL = 100;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
}

function isTransportMode(transportMode: string | null | undefined, prefix: 'SEA' | 'LAND' | 'MIX'): boolean {
  return String(transportMode ?? '').trim().toUpperCase().startsWith(prefix);
}

/** "Shipment", "Trucking", or "Shipment & Trucking" — which leg(s) still have no ETA for this row. */
export function resolveMissingEtaLabel(row: ContractEtaReminderRow): string {
  const isSea = isTransportMode(row.transport_mode, 'SEA');
  const isLand = isTransportMode(row.transport_mode, 'LAND');
  const isMix = isTransportMode(row.transport_mode, 'MIX');

  const missingSea = (isSea || isMix) && row.sea_missing_eta;
  const missingLand = (isLand || isMix) && row.land_missing_eta;

  if (missingSea && missingLand) return 'Shipment & Trucking';
  if (missingSea) return 'Shipment';
  if (missingLand) return 'Trucking';
  return '-';
}

/** "3 days left" (amber) vs "Overdue by 2 days" (red) vs "Due today" for day 0. */
function daysRemainingCell(days: number): string {
  if (days < 0) {
    const overdueDays = Math.abs(days);
    return `<span style="color:#b91c1c;font-weight:600;">Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}</span>`;
  }
  if (days === 0) {
    return `<span style="color:#b91c1c;font-weight:600;">Due today</span>`;
  }
  const color = days <= 3 ? '#b45309' : '#374151';
  return `<span style="color:${color};font-weight:600;">${days} day${days === 1 ? '' : 's'} left</span>`;
}

export function buildContractEtaReminderEmailSubject(rows: ContractEtaReminderRow[]): string {
  return `KLIP Alert: ${rows.length} Open Contract${rows.length === 1 ? '' : 's'} Missing ETA — Cargo Ready Within ${MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} Days`;
}

export function buildContractEtaReminderEmailHtml(
  rows: ContractEtaReminderRow[],
  frontendUrl: string,
): string {
  const shownRows = rows.slice(0, MAX_ROWS_IN_EMAIL);
  const hiddenCount = rows.length - shownRows.length;

  const tableRows = shownRows
    .map((row) => {
      const poOrExtNo = row.po_number || row.contract_ext_no || row.contract_id;
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(poOrExtNo)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.supplier)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.product)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.incoterm)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.transport_mode)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(resolveMissingEtaLabel(row))}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${formatDate(row.cargo_readiness_date)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;white-space:nowrap;">${daysRemainingCell(row.days_to_cargo_readiness)}</td>
        </tr>`;
    })
    .join('');

  const moreNote =
    hiddenCount > 0
      ? `<p style="margin:12px 0 0;color:#6b7280;font-size:13px;">+${hiddenCount} more — please check KLIP for the full list.</p>`
      : '';

  const contractPerfUrl = `${frontendUrl.replace(/\/$/, '')}/contract-performance`;
  const generatedAt = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="700" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="background:#0f172a;padding:18px 24px;">
                <span style="color:#ffffff;font-size:16px;font-weight:700;">KLIP — Contract ETA Reminder</span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 8px;">
                <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">
                  The following <strong>${rows.length}</strong> open contract${rows.length === 1 ? '' : 's'} have a
                  <strong>Cargo Readiness Date</strong> within the next ${MISSING_ETA_ALERT_CARGO_READINESS_WINDOW_DAYS} days (or already passed) but do not yet
                  have a planned ETA for Shipment or Trucking. Please update the ETA in KLIP as soon as possible to
                  avoid delays.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                  <thead>
                    <tr style="background:#f9fafb;text-align:left;">
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">PO / Contract Ext No</th>
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">Supplier</th>
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">Product</th>
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">Incoterm</th>
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">Transport Mode</th>
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">Missing ETA</th>
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">Cargo Readiness Date</th>
                      <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb;">Days Remaining</th>
                    </tr>
                  </thead>
                  <tbody>${tableRows}</tbody>
                </table>
                ${moreNote}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;">
                <a href="${escapeHtml(contractPerfUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:6px;">
                  Open Contract Performance
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px 20px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5;">
                  This is an automated message from KLIP (KPN Logistics Intelligence Platform). Please do not reply.<br/>
                  Generated at ${generatedAt} (Asia/Jakarta).
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
