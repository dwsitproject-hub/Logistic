/**
 * WB rekap sheet name → KLIP master product (products.product_name).
 * Sheets without mapping are skipped during import.
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
  klipProduct: string;
  rowNumber: number;
  poNumber: string;
  progressDateIso: string;
  nettoPksKg: number;
  nettoEupKg: number;
};

export type WbRekapAggregatedRow = {
  poNumber: string;
  progressDateIso: string;
  sumNettoPksKg: number;
  sumNettoEupKg: number;
  ticketCount: number;
  sheetNames: string[];
};

export type WbRekapParseFailure = {
  sheetName: string;
  rowNumber: number;
  po_number: string;
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

function findColumnIndex(headers: string[], candidates: string[]): number {
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

/** Locate header row containing PO/SO and Tanggal Masuk (within first 40 rows). */
export function findWbRekapHeaderRowIndex(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 40);
  for (let r = 0; r < limit; r += 1) {
    const headers = (matrix[r] ?? []).map(normalizeHeader);
    const hasPo = headers.some((h) => h === 'po/so' || h === 'po / so' || h.includes('po/so'));
    const hasDate = headers.some((h) => h.includes('tanggal masuk'));
    if (hasPo && hasDate) return r;
  }
  return -1;
}

export function parseWbRekapSheetMatrix(
  sheetName: string,
  matrix: unknown[][],
  parseDate: (raw: unknown) => string | null,
): {
  tickets: WbRekapTicketRow[];
  rowParseFailures: WbRekapParseFailure[];
} {
  const klipProduct = WB_REKAP_SHEET_TO_KLIP_PRODUCT[sheetName];
  if (!klipProduct) {
    return { tickets: [], rowParseFailures: [] };
  }

  const headerIdx = findWbRekapHeaderRowIndex(matrix);
  if (headerIdx < 0) {
    return {
      tickets: [],
      rowParseFailures: [
        {
          sheetName,
          rowNumber: 0,
          po_number: '-',
          reason: 'Header row with PO/SO and Tanggal Masuk not found',
        },
      ],
    };
  }

  const headerRow = matrix[headerIdx] ?? [];
  const headers = headerRow.map(normalizeHeader);
  const poIdx = findColumnIndex(headers, ['po/so', 'po / so']);
  const dateIdx = findColumnIndex(headers, ['tanggal masuk']);
  const nettoPksIdx = findColumnIndex(headers, ['netto pks']);
  const nettoEupIdx = findColumnIndex(headers, ['netto eup']);

  if (poIdx < 0 || dateIdx < 0) {
    return {
      tickets: [],
      rowParseFailures: [
        {
          sheetName,
          rowNumber: headerIdx + 1,
          po_number: '-',
          reason: 'Required columns PO/SO or Tanggal Masuk not found in header',
        },
      ],
    };
  }

  const tickets: WbRekapTicketRow[] = [];
  const rowParseFailures: WbRekapParseFailure[] = [];

  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const cells = matrix[r] ?? [];
    const rowNumber = r + 1;
    const poNumber = normalizePoNumber(cells[poIdx]);
    const dateRaw = cells[dateIdx];
    const pksRaw = nettoPksIdx >= 0 ? cells[nettoPksIdx] : null;
    const eupRaw = nettoEupIdx >= 0 ? cells[nettoEupIdx] : null;

    const hasAny =
      poNumber ||
      (dateRaw !== null && dateRaw !== undefined && String(dateRaw).trim() !== '') ||
      (pksRaw !== null && pksRaw !== undefined && String(pksRaw).trim() !== '') ||
      (eupRaw !== null && eupRaw !== undefined && String(eupRaw).trim() !== '');
    if (!hasAny) continue;

    if (!poNumber) {
      rowParseFailures.push({
        sheetName,
        rowNumber,
        po_number: '-',
        reason: 'PO/SO is missing',
      });
      continue;
    }

    const progressDateIso = parseDate(dateRaw);
    if (!progressDateIso) {
      rowParseFailures.push({
        sheetName,
        rowNumber,
        po_number: poNumber,
        reason: 'Tanggal Masuk is missing or could not be parsed',
      });
      continue;
    }

    const nettoPksKg = pksRaw != null ? parseQtyKg(pksRaw) : 0;
    const nettoEupKg = eupRaw != null ? parseQtyKg(eupRaw) : 0;
    if (nettoPksKg === null || nettoEupKg === null) {
      rowParseFailures.push({
        sheetName,
        rowNumber,
        po_number: poNumber,
        reason: 'Netto PKS or Netto EUP quantity is invalid',
      });
      continue;
    }

    if (nettoPksKg <= 0 && nettoEupKg <= 0) continue;

    tickets.push({
      sheetName,
      klipProduct,
      rowNumber,
      poNumber,
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
    const key = `${ticket.poNumber.toLowerCase()}::${ticket.progressDateIso}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.sumNettoPksKg += ticket.nettoPksKg;
      existing.sumNettoEupKg += ticket.nettoEupKg;
      existing.ticketCount += 1;
      if (!existing.sheetNames.includes(ticket.sheetName)) {
        existing.sheetNames.push(ticket.sheetName);
      }
    } else {
      byKey.set(key, {
        poNumber: ticket.poNumber,
        progressDateIso: ticket.progressDateIso,
        sumNettoPksKg: ticket.nettoPksKg,
        sumNettoEupKg: ticket.nettoEupKg,
        ticketCount: 1,
        sheetNames: [ticket.sheetName],
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

export function parseWbRekapWorkbook(
  sheets: WbRekapWorkbookSheet[],
  parseDate: (raw: unknown) => string | null,
): WbRekapParseResult {
  const allTickets: WbRekapTicketRow[] = [];
  const rowParseFailures: WbRekapParseFailure[] = [];
  const sheetsProcessed: string[] = [];
  const sheetsSkipped: Array<{ sheetName: string; reason: string }> = [];

  for (const { sheetName, matrix } of sheets) {
    if (!WB_REKAP_SHEET_TO_KLIP_PRODUCT[sheetName]) {
      sheetsSkipped.push({
        sheetName,
        reason: `Sheet not mapped to a KLIP product (${KLIP_TRUCKING_PRODUCTS.join(', ')}) — skipped`,
      });
      continue;
    }
    if (!matrix || matrix.length === 0) {
      sheetsSkipped.push({ sheetName, reason: 'Empty sheet — skipped' });
      continue;
    }

    const parsed = parseWbRekapSheetMatrix(sheetName, matrix, parseDate);
    if (parsed.tickets.length === 0 && parsed.rowParseFailures.some((f) => f.rowNumber === 0)) {
      sheetsSkipped.push({
        sheetName,
        reason: parsed.rowParseFailures[0]?.reason ?? 'Could not parse sheet',
      });
      rowParseFailures.push(...parsed.rowParseFailures);
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

export function resolveWbActualQtyKg(
  incoterm: string,
  sumNettoPksKg: number,
  sumNettoEupKg: number,
): { ok: true; quantityKg: number } | { ok: false; reason: string } {
  const inc = String(incoterm ?? '').trim().toUpperCase();
  if (inc === 'LCO') {
    if (sumNettoPksKg <= 0) {
      return { ok: false, reason: 'LCO contract but aggregated Netto PKS is zero for this PO/date' };
    }
    return { ok: true, quantityKg: sumNettoPksKg };
  }
  if (inc === 'FRC') {
    if (sumNettoEupKg <= 0) {
      return { ok: false, reason: 'FRC contract but aggregated Netto EUP is zero for this PO/date' };
    }
    return { ok: true, quantityKg: sumNettoEupKg };
  }
  return {
    ok: false,
    reason: `Incoterm "${inc || 'unknown'}" is not FRC/LCO — skipped for trucking WB actual`,
  };
}
