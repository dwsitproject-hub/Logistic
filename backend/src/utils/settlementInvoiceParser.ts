export interface SettlementInvoiceFields {
  gross_amount: number | null;
  discount_amount: number | null;
  down_payment: number | null;
  subtotal: number | null;
  tax_base_amount: number | null;
  vat_12_percent: number | null;
  total_payable: number | null;
}

export type SettlementInvoiceFieldKey = keyof SettlementInvoiceFields;

const FIELD_LABELS: { key: SettlementInvoiceFieldKey; patterns: RegExp[] }[] = [
  {
    key: 'total_payable',
    patterns: [/jumlah\s+yang\s+harus\s+dibayar/i],
  },
  {
    key: 'down_payment',
    patterns: [/dikurangi\s+uang\s+muka/i, /uang\s+muka/i],
  },
  {
    key: 'discount_amount',
    patterns: [/potongan\s+harga/i],
  },
  {
    key: 'gross_amount',
    patterns: [/jumlah\s+harga/i],
  },
  {
    key: 'tax_base_amount',
    patterns: [/dpp\s+nilai\s+lain/i, /dpp/i],
  },
  {
    key: 'vat_12_percent',
    patterns: [/ppn\s*12\s*%/i, /ppn\s*12/i],
  },
  {
    key: 'subtotal',
    patterns: [/^jumlah$/i, /\bjumlah\b(?!\.?\s*harga|\s+yang\s+harus)/i],
  },
];

/** Normalize OCR text for matching (collapse whitespace, fix common OCR quirks). */
export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[|]/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse Indonesian / mixed currency strings to decimal number.
 * Handles Rp., thousand separators (. or ,), and decimal comma/dot.
 */
export function parseIndonesianAmount(raw: string): number | null {
  let s = String(raw || '')
    .replace(/Rp\.?\s*/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!s) return null;

  // Keep only digits, dots, commas, minus
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || s === '-' || s === '.' || s === ',') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Both present — rightmost is decimal separator
    if (lastComma > lastDot) {
      // Indonesian: 1.234.567,89
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234,567.89
      s = s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const afterComma = s.length - lastComma - 1;
    if (afterComma === 2) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastDot > -1) {
    const afterDot = s.length - lastDot - 1;
    if (afterDot !== 2) {
      // Thousand separators only: 1.234.567
      s = s.replace(/\./g, '');
    }
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT_CAPTURE =
  /(?:Rp\.?\s*)?(-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)/i;

function extractAmountNearLine(line: string, labelMatched: boolean): number | null {
  const candidates: string[] = [];
  if (labelMatched) {
    const afterLabel = line.replace(/^[^:]*:?/, '').trim();
    if (afterLabel) candidates.push(afterLabel);
  }
  candidates.push(line);

  for (const chunk of candidates) {
    const matches = [...chunk.matchAll(new RegExp(AMOUNT_CAPTURE.source, 'gi'))];
    if (matches.length === 0) continue;
    const last = matches[matches.length - 1][1];
    const parsed = parseIndonesianAmount(last);
    if (parsed !== null) return parsed;
  }
  return null;
}

function lineMatchesLabel(line: string, pattern: RegExp): boolean {
  const normalized = line.toLowerCase().replace(/\s+/g, ' ');
  return pattern.test(normalized);
}

/**
 * Extract settlement invoice amounts from OCR / PDF text using Indonesian label heuristics.
 */
export function parseSettlementInvoiceText(text: string): SettlementInvoiceFields {
  const normalized = normalizeOcrText(text);
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);

  const result: SettlementInvoiceFields = {
    gross_amount: null,
    discount_amount: null,
    down_payment: null,
    subtotal: null,
    tax_base_amount: null,
    vat_12_percent: null,
    total_payable: null,
  };

  const assigned = new Set<SettlementInvoiceFieldKey>();

  for (const { key, patterns } of FIELD_LABELS) {
    if (assigned.has(key)) continue;

    for (const line of lines) {
      for (const pattern of patterns) {
        if (!lineMatchesLabel(line, pattern)) continue;

        // Subtotal "Jumlah" — skip if line also contains other keywords
        if (key === 'subtotal') {
          const lower = line.toLowerCase();
          if (
            lower.includes('harga') ||
            lower.includes('harus dibayar') ||
            lower.includes('uang muka')
          ) {
            continue;
          }
        }

        const amount = extractAmountNearLine(line, true);
        if (amount !== null) {
          result[key] = amount;
          assigned.add(key);
          break;
        }
      }
      if (assigned.has(key)) break;
    }
  }

  // Fallback: look at line after label line
  for (const { key, patterns } of FIELD_LABELS) {
    if (assigned.has(key)) continue;
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        if (!lineMatchesLabel(lines[i], pattern)) continue;
        const nextLine = lines[i + 1];
        if (nextLine) {
          const amount = extractAmountNearLine(nextLine, false);
          if (amount !== null) {
            result[key] = amount;
            assigned.add(key);
            break;
          }
        }
      }
      if (assigned.has(key)) break;
    }
  }

  return result;
}

export function countExtractedFields(fields: SettlementInvoiceFields): number {
  return Object.values(fields).filter((v) => v !== null && Number.isFinite(v)).length;
}

export const SETTLEMENT_INVOICE_FIELD_COUNT = 7;
