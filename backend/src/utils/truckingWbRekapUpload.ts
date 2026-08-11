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
  /**
   * First/representative STO seen for this PO+date (informational only — WB storage is
   * always PO-level; see `stoNumbers` for the full distinct list used in failure messages).
   */
  stoNumber: string;
  /** Distinct STO values across tickets aggregated into this PO+date row. */
  stoNumbers: string[];
};

export type WbRekapParseFailure = {
  sheetName: string;
  rowNumber: number;
  po_number: string;
  sto_number?: string;
  reason: string;
  /** Stringified cell values from the failed Excel row (for failed-rows export). */
  cells?: string[];
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
  // Palembang / Tj Buton: "No. PO" (period-tolerant)
  if (h === 'no. po') return true;
  // Kumai: bare "PO" column
  if (h === 'po') return true;
  return false;
}

function isDateHeader(h: string): boolean {
  if (!h) return false;
  if (h.includes('tanggal masuk')) return true;
  // Tj Pura ticket sheets use Tanggal Laporan (not Tanggal Pengiriman / Tanggal 1st)
  if (h === 'tanggal laporan') return true;
  // SPC / Palembang / Tj Buton layout uses a plain TANGGAL column
  // (avoid matching "Tanggal Muat/Bongkar/Pengiriman Vendor…")
  if (h === 'tanggal') return true;
  // Kumai: Tanggal Penerimaan (receipt date) is the report's primary date column
  if (h === 'tanggal penerimaan') return true;
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

/** Normalize + strip all whitespace, so "TOTAL" and "T O T A L " both collapse to "total". */
function normalizeCompact(value: unknown): string {
  return normalizeHeader(value).replace(/\s+/g, '');
}

/**
 * Grand-total / subtotal footer rows embedded in ticket data (e.g. a period's "TOTAL" or
 * "T O T A L" row, sometimes landing in the PO/STO cell due to a merged-cell shift).
 * These already fail safely today (rejected for missing/unparseable PO or date), but are
 * skipped silently here so they don't surface as confusing noise in the failure list.
 */
function isWbTotalFooterRow(
  cells: unknown[],
  cols: { poIdx: number; stoIdx: number },
): boolean {
  const candidates = [
    cells[0],
    cells[cols.poIdx],
    cols.stoIdx >= 0 ? cells[cols.stoIdx] : undefined,
  ];
  return candidates.some((c) => normalizeCompact(c) === 'total');
}

function normalizePoNumber(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^\d+\.0+$/.test(s)) return String(Math.trunc(Number(s)));
  return s;
}

function wbRekapRowCellsToStrings(cells: unknown[]): string[] {
  return cells.map((c) => {
    if (c === null || c === undefined) return '';
    if (c instanceof Date) {
      const y = c.getFullYear();
      const m = String(c.getMonth() + 1).padStart(2, '0');
      const d = String(c.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
    return String(c).trim();
  });
}

/**
 * SPC / multi-plant templates insert period subtotal rows with empty PO/STO/date but
 * aggregated Netto qty (or ticket-count + totals in cols ~11–14). Skip silently.
 */
function isWbPeriodSubtotalRow(
  cells: unknown[],
  poNumber: string,
  stoNumber: string | null,
  dateRaw: unknown,
  pksRaw: unknown,
  eupRaw: unknown,
): boolean {
  if (poNumber || stoNumber) return false;
  const dateStr = dateRaw !== null && dateRaw !== undefined ? String(dateRaw).trim() : '';
  if (dateStr !== '') return false;

  const pks = pksRaw != null ? parseQtyKg(pksRaw) : 0;
  const eup = eupRaw != null ? parseQtyKg(eupRaw) : 0;
  if ((pks ?? 0) > 0 || (eup ?? 0) > 0) return true;

  for (let i = 10; i <= 13; i += 1) {
    const ticketCount = parseQtyKg(cells[i]);
    const total1 = parseQtyKg(cells[i + 1]);
    const total2 = parseQtyKg(cells[i + 2]);
    if (
      ticketCount !== null &&
      ticketCount > 0 &&
      ticketCount <= 999 &&
      total1 !== null &&
      total1 >= 1000 &&
      (total2 === null || total2 >= 100)
    ) {
      return true;
    }
  }
  return false;
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

  // "No. Tiket Timbangan Kebun/Pabrik/RSB/EUP" ticket-id columns can precede the real
  // "Timbangan X (kg)" quantity column and would otherwise win the first-match lookup below.
  const isTimbanganQtyHeader = (needle: string) => (h: string) =>
    h.includes(needle) && !h.includes('tiket');

  // SPC 2-row: Timbangan Kebun / Timbangan SPC(kg) → Netto
  // Palembang 2-row: Timbangan Kebun / Timbangan EUP(kg) → Netto
  // Tj Buton 2-row: Timbangan pabrik(kg) / Timbangan RSB(kg) → Netto
  // Tj Pura: bare Pihak Ketiga / Pabrik (merged 2-row parent, Netto on sub-row) → NETT
  // Kumai: single-row "NETT (Pihak Ketiga)" / "NETT (Pabrik)" cells (Netto already in the header cell)
  const hasKebun = headers.some(isTimbanganQtyHeader('timbangan kebun'));
  const hasSpc = headers.some(isTimbanganQtyHeader('timbangan spc'));
  const hasTimbanganEup = headers.some(isTimbanganQtyHeader('timbangan eup'));
  const hasTimbanganPabrik = headers.some(isTimbanganQtyHeader('timbangan pabrik'));
  const hasTimbanganRsb = headers.some(isTimbanganQtyHeader('timbangan rsb'));
  const hasPihakKetiga = headers.some((h) => h.includes('pihak ketiga'));
  const hasPabrik = headers.some((h) => h === 'pabrik');
  let dataStartRow = headerIdx + 1;
  if (
    hasKebun ||
    hasSpc ||
    hasTimbanganEup ||
    hasTimbanganPabrik ||
    hasTimbanganRsb ||
    hasPihakKetiga ||
    hasPabrik
  ) {
    if (hasKebun || hasSpc) {
      const kebunNetto = findMergedNettoColumnIndex(
        matrix,
        headerIdx,
        isTimbanganQtyHeader('timbangan kebun'),
      );
      const spcNetto = findMergedNettoColumnIndex(
        matrix,
        headerIdx,
        isTimbanganQtyHeader('timbangan spc'),
      );
      if (kebunNetto >= 0) deliveryIdx = kebunNetto;
      if (spcNetto >= 0) receiveIdx = spcNetto;
    }
    if (hasTimbanganEup) {
      // Palembang receive-side (delivery side reuses the hasKebun branch above).
      const eupNetto = findMergedNettoColumnIndex(
        matrix,
        headerIdx,
        isTimbanganQtyHeader('timbangan eup'),
      );
      if (eupNetto >= 0) receiveIdx = eupNetto;
    }
    if (hasTimbanganPabrik) {
      // Tj Buton delivery-side — do NOT reuse the bare `pabrik` (Tj Pura) rule below,
      // this is a distinct 2-row merged header with the opposite delivery/receive sense.
      const pabrikMergedNetto = findMergedNettoColumnIndex(
        matrix,
        headerIdx,
        isTimbanganQtyHeader('timbangan pabrik'),
      );
      if (pabrikMergedNetto >= 0) deliveryIdx = pabrikMergedNetto;
    }
    if (hasTimbanganRsb) {
      // Tj Buton receive-side.
      const rsbNetto = findMergedNettoColumnIndex(
        matrix,
        headerIdx,
        isTimbanganQtyHeader('timbangan rsb'),
      );
      if (rsbNetto >= 0) receiveIdx = rsbNetto;
    }
    if (hasPihakKetiga || hasPabrik) {
      // Kumai: the header cell itself already says Nett/Netto — resolve directly,
      // do NOT use the merged-sub-row lookup (Kumai repeats "(Pihak Ketiga)"/"(Pabrik)"
      // across 3 sibling single-row headers — Berat Kotor / Tare / NETT — so the merged
      // lookup would grab the first one, "Berat Kotor", instead of "NETT").
      const nettPihakKetigaIdx = findColumnIndex(
        headers,
        (h) => (h.includes('nett') || h.includes('netto')) && h.includes('pihak ketiga'),
      );
      const nettPabrikIdx = findColumnIndex(
        headers,
        (h) => (h.includes('nett') || h.includes('netto')) && h.includes('pabrik'),
      );
      if (nettPihakKetigaIdx >= 0) {
        deliveryIdx = nettPihakKetigaIdx;
      } else {
        const pihakNetto = findMergedNettoColumnIndex(matrix, headerIdx, (h) =>
          h.includes('pihak ketiga'),
        );
        if (pihakNetto >= 0) deliveryIdx = pihakNetto;
      }
      if (nettPabrikIdx >= 0) {
        receiveIdx = nettPabrikIdx;
      } else {
        const pabrikNetto = findMergedNettoColumnIndex(matrix, headerIdx, (h) => h === 'pabrik');
        if (pabrikNetto >= 0) receiveIdx = pabrikNetto;
      }
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

    // Skip grand-total / subtotal footer rows silently (not a row-parse failure).
    if (isWbTotalFooterRow(cells, cols)) continue;

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

    if (isWbPeriodSubtotalRow(cells, poNumber, stoNumber, dateRaw, pksRaw, eupRaw)) {
      continue;
    }

    // Rows without PO/STO are not tickets (subtotal/rekap/blank) — skip silently.
    if (!poNumber && !stoNumber) {
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
        cells: wbRekapRowCellsToStrings(cells),
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
        cells: wbRekapRowCellsToStrings(cells),
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
    // Aggregate by PO (or STO identity) + date only — WB matching/storage is PO-level,
    // so multiple STO tickets for the same PO+date are summed into a single row.
    const identity = (ticket.poNumber || ticket.stoNumber || '').toLowerCase();
    if (!identity) continue;
    const sto = String(ticket.stoNumber ?? '').trim();
    const key = `${identity}::${ticket.progressDateIso}`;
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
    return a.progressDateIso.localeCompare(b.progressDateIso);
  });
}

export type WbRekapWorkbookSheet = { sheetName: string; matrix: unknown[][] };

/**
 * Parse every worksheet. Sheets are skipped only when empty or missing WB header —
 * never because of sheet product naming.
 */
/** User-facing row parse failures: PO/STO identity present but ticket invalid. */
export function filterWbRekapUserFacingRowParseFailures(
  failures: WbRekapParseFailure[],
): WbRekapParseFailure[] {
  return failures.filter(
    (f) =>
      f.rowNumber > 0 &&
      String(f.po_number ?? '').trim() !== '' &&
      f.po_number !== '-',
  );
}

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
