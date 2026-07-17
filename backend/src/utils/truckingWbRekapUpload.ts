/**
 * Optional legacy sheet name → KLIP product hint only (not used as a parse gate).
 * Matching / apply is by PO Number; product comes from SAP/contracts when needed.
 *
 * KLIP master products: CPO, PK, POME, SHELL (see supplier / product configuration).
 */
export const WB_REKAP_SHEET_TO_KLIP_PRODUCT: Record<string, string> = {
  CPO: 'CPO',
  'CPO-RSPO': 'CPO',
  CPKO: 'PK',
  POME: 'POME',
  PK_KEBUN: 'PK',
  PK_KAPAL: 'PK',
  'PKE KEBUN': 'PK',
  CANGKANG: 'SHELL',
  'CANGKANG KAPAL': 'SHELL',
  CANGKANG_KAPAL_GGL: 'SHELL',
};

export const KLIP_TRUCKING_PRODUCTS = ['CPO', 'PK', 'POME', 'SHELL'] as const;

export type WbRekapTicketRow = {
  sheetName: string;
  /** Optional legacy hint from sheet name; null when sheet is not in the legacy map. */
  klipProduct: string | null;
  rowNumber: number;
  poNumber: string;
  /** STO from file column when present — used to split daily actuals per STO. */
  stoNumber: string | null;
  progressDateIso: string;
  /** Qty Delivery (Netto PKS / Timbangan Kebun Netto). */
  nettoPksKg: number;
  /** Qty Receive (Netto EUP / Netto EOP / Timbangan SPC Netto). */
  nettoEupKg: number;
};

export type WbRekapAggregatedRow = {
  poNumber: string;
  progressDateIso: string;
  sumNettoPksKg: number;
  sumNettoEupKg: number;
  ticketCount: number;
  sheetNames: string[];
  /** STO for this aggregate row (empty = legacy PO-level / no STO on ticket). */
  stoNumber: string;
  /** Distinct STO values on tickets for this key (usually 0–1 after per-STO split). */
  stoNumbers: string[];
};

export type WbRekapParseFailure = {
  sheetName: string;
  rowNumber: number;
  po_number: string;
  sto_number?: string;
  reason: string;
};

export type WbRekapParseResult = {
  tickets: WbRekapTicketRow[];
  aggregated: WbRekapAggregatedRow[];
  rowParseFailures: WbRekapParseFailure[];
  sheetsProcessed: string[];
  sheetsSkipped: Array<{ sheetName: string; reason: string }>;
  rawTicketRows: number;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isPoHeader(h: string): boolean {
  if (!h) return false;
  if (h === 'po/so' || h === 'po / so') return true;
  if (h.includes('po/so')) return true;
  // SPC combined column — check before plain "no po"
  if (h.includes('no po/sto') || h.includes('no po / sto')) return true;
  // Tj Pura / plant layouts: dedicated NO PO column (not "No PO/STO")
  if (h === 'no po' || h === 'nomor po') return true;
  return false;
}

function isDateHeader(h: string): boolean {
  if (!h) return false;
  if (h.includes('tanggal masuk')) return true;
  // Tj Pura ticket sheets use Tanggal Laporan (not Tanggal Pengiriman / Tanggal 1st)
  if (h === 'tanggal laporan') return true;
  // SPC layout uses a plain TANGGAL column (avoid matching "Tanggal Muat/Bongkar/…")
  if (h === 'tanggal') return true;
  return false;
}

function isStoHeader(h: string): boolean {
  if (!h) return false;
  // Exact STO only — do not match "No PO/STO"
  if (h === 'sto') return true;
  if (h === 'no sto' || h === 'nomor sto') return true;
  if (h.startsWith('sto ') || h.endsWith(' sto')) return true;
  return false;
}

const WB_QTY_LABEL_TOKENS = new Set([
  'nett',
  'netto',
  'berat kotor',
  'tare',
  'n. pks',
  'n pks',
  'n. pabrik',
  'n pabrik',
  'b. pks',
  't. pks',
  'b. pabrik',
  't. pabrik',
  'total',
  'masuk',
  'keluar',
]);

const WB_PO_LABEL_TOKENS = new Set([
  'no po',
  'nomor po',
  'po/so',
  'po / so',
  'no po/sto',
  'no po / sto',
]);

/** True when the row is a repeated header / qty sub-label under a multi-row WB header. */
function looksLikeWbLabelOrSubheaderRow(
  cells: unknown[],
  cols: { poIdx: number; deliveryIdx: number; receiveIdx: number },
): boolean {
  const po = normalizeHeader(cells[cols.poIdx]);
  if (WB_PO_LABEL_TOKENS.has(po)) return true;
  const delivery =
    cols.deliveryIdx >= 0 ? normalizeHeader(cells[cols.deliveryIdx]) : '';
  const receive =
    cols.receiveIdx >= 0 ? normalizeHeader(cells[cols.receiveIdx]) : '';
  if (WB_QTY_LABEL_TOKENS.has(delivery) || WB_QTY_LABEL_TOKENS.has(receive)) return true;
  return false;
}

function findColumnIndex(headers: string[], predicate: (h: string) => boolean): number {
  for (let i = 0; i < headers.length; i += 1) {
    if (predicate(headers[i] ?? '')) return i;
  }
  return -1;
}

function findColumnIndexByCandidates(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i += 1) {
    const h = headers[i] ?? '';
    for (const candidate of candidates) {
      if (h === candidate || h.includes(candidate)) return i;
    }
  }
  return -1;
}

function parseQtyKg(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return 0;
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizePoNumber(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^\d+\.0+$/.test(s)) return String(Math.trunc(Number(s)));
  return s;
}

/**
 * Locate header row with a PO alias and a date alias (within first 40 rows).
 * Supports EUP/EOP (PO/SO + Tanggal Masuk), SPC (No PO/STO + TANGGAL),
 * and Tj Pura (NO PO + Tanggal Laporan).
 */
export function findWbRekapHeaderRowIndex(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 40);
  for (let r = 0; r < limit; r += 1) {
    const headers = (matrix[r] ?? []).map(normalizeHeader);
    const hasPo = headers.some(isPoHeader);
    const hasDate = headers.some(isDateHeader);
    if (hasPo && hasDate) return r;
  }
  return -1;
}

/**
 * Resolve Netto/NETT sub-column under a merged parent header (SPC / Tj Pura).
 * Parent is on headerIdx; subheaders (Keluar/Masuk/Netto/NETT/TOTAL) on headerIdx+1.
 */
function findMergedNettoColumnIndex(
  matrix: unknown[][],
  headerIdx: number,
  parentPredicate: (h: string) => boolean,
): number {
  const headerRow = matrix[headerIdx] ?? [];
  const headers = headerRow.map(normalizeHeader);
  const parentIdx = findColumnIndex(headers, parentPredicate);
  if (parentIdx < 0) return -1;

  const subRow = matrix[headerIdx + 1] ?? [];
  // Walk forward from parent until next non-empty top-level header or end.
  let end = headers.length;
  for (let i = parentIdx + 1; i < headers.length; i += 1) {
    if ((headers[i] ?? '').trim() !== '') {
      end = i;
      break;
    }
  }
  for (let i = parentIdx; i < end; i += 1) {
    const sub = normalizeHeader(subRow[i]);
    if (sub === 'netto' || sub === 'nett') return i;
  }
  // Fallback: parent cell itself if no subheader row
  return parentIdx;
}

type ResolvedWbColumns = {
  poIdx: number;
  stoIdx: number;
  dateIdx: number;
  deliveryIdx: number;
  receiveIdx: number;
  dataStartRow: number;
};

function resolveWbColumns(matrix: unknown[][], headerIdx: number): ResolvedWbColumns | null {
  const headerRow = matrix[headerIdx] ?? [];
  const headers = headerRow.map(normalizeHeader);
  const poIdx = findColumnIndex(headers, isPoHeader);
  const dateIdx = findColumnIndex(headers, isDateHeader);
  if (poIdx < 0 || dateIdx < 0) return null;

  const stoIdx = findColumnIndex(headers, isStoHeader);

  // Simple single-row qty columns (EUP / EOP layouts)
  let deliveryIdx = findColumnIndexByCandidates(headers, ['netto pks']);
  let receiveIdx = findColumnIndexByCandidates(headers, ['netto eup', 'netto eop']);

  // SPC 2-row: Timbangan Kebun / Timbangan SPC(kg) → Netto
  // Tj Pura: Pihak Ketiga / Pabrik → NETT
  const hasKebun = headers.some((h) => h.includes('timbangan kebun'));
  const hasSpc = headers.some((h) => h.includes('timbangan spc'));
  const hasPihakKetiga = headers.some((h) => h.includes('pihak ketiga'));
  const hasPabrik = headers.some((h) => h === 'pabrik');
  let dataStartRow = headerIdx + 1;
  if (hasKebun || hasSpc || hasPihakKetiga || hasPabrik) {
    if (hasKebun || hasSpc) {
      const kebunNetto = findMergedNettoColumnIndex(matrix, headerIdx, (h) =>
        h.includes('timbangan kebun'),
      );
      const spcNetto = findMergedNettoColumnIndex(matrix, headerIdx, (h) =>
        h.includes('timbangan spc'),
      );
      if (kebunNetto >= 0) deliveryIdx = kebunNetto;
      if (spcNetto >= 0) receiveIdx = spcNetto;
    }
    if (hasPihakKetiga || hasPabrik) {
      const pihakNetto = findMergedNettoColumnIndex(matrix, headerIdx, (h) =>
        h.includes('pihak ketiga'),
      );
      const pabrikNetto = findMergedNettoColumnIndex(matrix, headerIdx, (h) => h === 'pabrik');
      if (pihakNetto >= 0) deliveryIdx = pihakNetto;
      if (pabrikNetto >= 0) receiveIdx = pabrikNetto;
    }
    const subRow = matrix[headerIdx + 1] ?? [];
    const subLooksLikeQty = subRow.some((c) => {
      const s = normalizeHeader(c);
      return (
        s === 'netto' ||
        s === 'nett' ||
        s === 'masuk' ||
        s === 'keluar' ||
        s === 'total' ||
        s === 'berat kotor' ||
        s === 'tare'
      );
    });
    if (subLooksLikeQty) dataStartRow = headerIdx + 2;
  }

  // Advance past repeated label rows (e.g. Tj Pura 3rd row: NO PO / N. PKS / N. PABRIK).
  const colsForLabelCheck = { poIdx, deliveryIdx, receiveIdx };
  while (
    dataStartRow < matrix.length &&
    looksLikeWbLabelOrSubheaderRow(matrix[dataStartRow] ?? [], colsForLabelCheck)
  ) {
    dataStartRow += 1;
  }

  return { poIdx, stoIdx, dateIdx, deliveryIdx, receiveIdx, dataStartRow };
}

/**
 * Parse one worksheet. Any sheet with a WB header (PO alias + date alias) is accepted —
 * sheet name does not gate import.
 */
export function parseWbRekapSheetMatrix(
  sheetName: string,
  matrix: unknown[][],
  parseDate: (raw: unknown) => string | null,
): {
  tickets: WbRekapTicketRow[];
  rowParseFailures: WbRekapParseFailure[];
} {
  const klipProduct = WB_REKAP_SHEET_TO_KLIP_PRODUCT[sheetName] ?? null;

  const headerIdx = findWbRekapHeaderRowIndex(matrix);
  if (headerIdx < 0) {
    return {
      tickets: [],
      rowParseFailures: [
        {
          sheetName,
          rowNumber: 0,
          po_number: '-',
          reason:
            'Header row with PO (PO/SO, No PO/STO, or NO PO) and date (Tanggal Masuk, TANGGAL, or Tanggal Laporan) not found',
        },
      ],
    };
  }

  const cols = resolveWbColumns(matrix, headerIdx);
  if (!cols) {
    return {
      tickets: [],
      rowParseFailures: [
        {
          sheetName,
          rowNumber: headerIdx + 1,
          po_number: '-',
          reason: 'Required columns PO or date not found in header',
        },
      ],
    };
  }

  const tickets: WbRekapTicketRow[] = [];
  const rowParseFailures: WbRekapParseFailure[] = [];

  for (let r = cols.dataStartRow; r < matrix.length; r += 1) {
    const cells = matrix[r] ?? [];
    const rowNumber = r + 1;

    // Skip repeated label / subheader rows under multi-row headers (Tj Pura, SPC).
    if (looksLikeWbLabelOrSubheaderRow(cells, cols)) continue;

    const poNumber = normalizePoNumber(cells[cols.poIdx]);
    const stoNumber =
      cols.stoIdx >= 0 ? normalizePoNumber(cells[cols.stoIdx]) || null : null;
    const dateRaw = cells[cols.dateIdx];
    const pksRaw = cols.deliveryIdx >= 0 ? cells[cols.deliveryIdx] : null;
    const eupRaw = cols.receiveIdx >= 0 ? cells[cols.receiveIdx] : null;

    const hasAny =
      poNumber ||
      stoNumber ||
      (dateRaw !== null && dateRaw !== undefined && String(dateRaw).trim() !== '') ||
      (pksRaw !== null && pksRaw !== undefined && String(pksRaw).trim() !== '') ||
      (eupRaw !== null && eupRaw !== undefined && String(eupRaw).trim() !== '');
    if (!hasAny) continue;

    // Skip subheader-only rows that slipped through
    if (
      !poNumber &&
      !stoNumber &&
      ['netto', 'nett', 'masuk', 'keluar', 'total'].includes(normalizeHeader(dateRaw))
    ) {
      continue;
    }

    if (!poNumber && !stoNumber) {
      rowParseFailures.push({
        sheetName,
        rowNumber,
        po_number: '-',
        reason: 'PO/SO (or No PO/STO / NO PO) and STO are both missing',
      });
      continue;
    }

    const progressDateIso = parseDate(dateRaw);
    if (!progressDateIso) {
      rowParseFailures.push({
        sheetName,
        rowNumber,
        po_number: poNumber || stoNumber || '-',
        sto_number: stoNumber ?? undefined,
        reason:
          'Date (Tanggal Masuk / TANGGAL / Tanggal Laporan) is missing or could not be parsed',
      });
      continue;
    }

    const nettoPksKg = pksRaw != null ? parseQtyKg(pksRaw) : 0;
    const nettoEupKg = eupRaw != null ? parseQtyKg(eupRaw) : 0;
    if (nettoPksKg === null || nettoEupKg === null) {
      rowParseFailures.push({
        sheetName,
        rowNumber,
        po_number: poNumber || stoNumber || '-',
        sto_number: stoNumber ?? undefined,
        reason: 'Delivery or Receive quantity is invalid',
      });
      continue;
    }

    if (nettoPksKg <= 0 && nettoEupKg <= 0) continue;

    tickets.push({
      sheetName,
      klipProduct,
      rowNumber,
      // Prefer PO column; if blank, leave empty — apply layer resolves STO→PO
      poNumber: poNumber || '',
      stoNumber,
      progressDateIso,
      nettoPksKg,
      nettoEupKg,
    });
  }

  return { tickets, rowParseFailures };
}

export function aggregateWbRekapTickets(tickets: WbRekapTicketRow[]): WbRekapAggregatedRow[] {
  const byKey = new Map<string, WbRekapAggregatedRow>();
  for (const ticket of tickets) {
    // Aggregate by PO (or STO identity) + date + STO so multi-STO POs stay separate.
    const identity = (ticket.poNumber || ticket.stoNumber || '').toLowerCase();
    if (!identity) continue;
    const sto = String(ticket.stoNumber ?? '').trim();
    const key = `${identity}::${ticket.progressDateIso}::${sto.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.sumNettoPksKg += ticket.nettoPksKg;
      existing.sumNettoEupKg += ticket.nettoEupKg;
      existing.ticketCount += 1;
      if (!existing.sheetNames.includes(ticket.sheetName)) {
        existing.sheetNames.push(ticket.sheetName);
      }
      if (sto && !existing.stoNumbers.includes(sto)) {
        existing.stoNumbers.push(sto);
      }
      if (!existing.poNumber && ticket.poNumber) {
        existing.poNumber = ticket.poNumber;
      }
    } else {
      byKey.set(key, {
        poNumber: ticket.poNumber || ticket.stoNumber || '',
        progressDateIso: ticket.progressDateIso,
        sumNettoPksKg: ticket.nettoPksKg,
        sumNettoEupKg: ticket.nettoEupKg,
        ticketCount: 1,
        sheetNames: [ticket.sheetName],
        stoNumber: sto,
        stoNumbers: sto ? [sto] : [],
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const poCmp = a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true });
    if (poCmp !== 0) return poCmp;
    const stoCmp = a.stoNumber.localeCompare(b.stoNumber, undefined, { numeric: true });
    if (stoCmp !== 0) return stoCmp;
    return a.progressDateIso.localeCompare(b.progressDateIso);
  });
}

export type WbRekapWorkbookSheet = { sheetName: string; matrix: unknown[][] };

/**
 * Parse every worksheet. Sheets are skipped only when empty or missing WB header —
 * never because of sheet product naming.
 */
export function parseWbRekapWorkbook(
  sheets: WbRekapWorkbookSheet[],
  parseDate: (raw: unknown) => string | null,
): WbRekapParseResult {
  const allTickets: WbRekapTicketRow[] = [];
  const rowParseFailures: WbRekapParseFailure[] = [];
  const sheetsProcessed: string[] = [];
  const sheetsSkipped: Array<{ sheetName: string; reason: string }> = [];

  for (const { sheetName, matrix } of sheets) {
    if (!matrix || matrix.length === 0) {
      sheetsSkipped.push({ sheetName, reason: 'Empty sheet — skipped' });
      continue;
    }

    const parsed = parseWbRekapSheetMatrix(sheetName, matrix, parseDate);
    const structuralFail = parsed.rowParseFailures.find(
      (f) =>
        f.reason.includes('Header row with PO') ||
        f.reason.includes('Required columns PO'),
    );
    if (structuralFail && parsed.tickets.length === 0) {
      sheetsSkipped.push({ sheetName, reason: structuralFail.reason });
      rowParseFailures.push(...parsed.rowParseFailures);
      continue;
    }
    if (parsed.tickets.length === 0 && parsed.rowParseFailures.length === 0) {
      sheetsSkipped.push({
        sheetName,
        reason: 'No ticket rows with Delivery/Receive qty — skipped',
      });
      continue;
    }

    sheetsProcessed.push(sheetName);
    allTickets.push(...parsed.tickets);
    rowParseFailures.push(...parsed.rowParseFailures);
  }

  return {
    tickets: allTickets,
    aggregated: aggregateWbRekapTickets(allTickets),
    rowParseFailures,
    sheetsProcessed,
    sheetsSkipped,
    rawTicketRows: allTickets.length,
  };
}

/**
 * Effective quantity_kg for OS/sync (LCO=Netto PKS delivery, FRC=Netto EUP receive).
 * Always callable when either side has qty — complementary PKS/EUP are persisted separately.
 */
export function resolveWbActualQtyKg(
  incoterm: string,
  sumNettoPksKg: number,
  sumNettoEupKg: number,
):
  | { ok: true; quantityKg: number; softWarning?: string }
  | { ok: false; reason: string } {
  const inc = String(incoterm ?? '').trim().toUpperCase();
  const pks = Number(sumNettoPksKg) || 0;
  const eup = Number(sumNettoEupKg) || 0;

  if (inc === 'LCO') {
    if (pks <= 0 && eup <= 0) {
      return { ok: false, reason: 'LCO contract but Netto PKS and Netto EUP are both zero for this PO/date' };
    }
    if (pks <= 0) {
      return {
        ok: true,
        quantityKg: 0,
        softWarning:
          'LCO: Netto PKS (Delivery) is zero — Qty Receive (EUP) stored as complementary; OS still uses Delivery/PKS',
      };
    }
    return { ok: true, quantityKg: pks };
  }
  if (inc === 'FRC') {
    if (pks <= 0 && eup <= 0) {
      return { ok: false, reason: 'FRC contract but Netto PKS and Netto EUP are both zero for this PO/date' };
    }
    if (eup <= 0) {
      return {
        ok: true,
        quantityKg: 0,
        softWarning:
          'FRC: Netto EUP (Receive) is zero — Qty Delivery (PKS) stored as complementary; OS still uses Receive/EUP',
      };
    }
    return { ok: true, quantityKg: eup };
  }
  return {
    ok: false,
    reason: `Incoterm "${inc || 'unknown'}" is not FRC/LCO — skipped for trucking WB actual`,
  };
}
