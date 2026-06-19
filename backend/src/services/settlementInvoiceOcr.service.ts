import fs from 'fs';
import Tesseract from 'tesseract.js';
import pdfParse from 'pdf-parse';
import {
  countExtractedFields,
  parseSettlementInvoiceText,
  SETTLEMENT_INVOICE_FIELD_COUNT,
  type SettlementInvoiceFields,
} from '../utils/settlementInvoiceParser';
import logger from '../utils/logger';

const OCR_LANG = 'ind+eng';

export interface SettlementInvoiceOcrResult {
  fields: SettlementInvoiceFields;
  extractedCount: number;
  totalFields: number;
  partial: boolean;
  source: 'pdf-text' | 'tesseract-image' | 'tesseract-pdf-page';
}

function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|webp|bmp|tiff?)$/i.test(mime);
}

function isPdfMime(mime: string, fileName: string): boolean {
  return mime === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
}

async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const parsed = await pdfParse(buffer);
  return String(parsed.text || '').trim();
}

async function ocrImageBuffer(buffer: Buffer): Promise<string> {
  const worker = await Tesseract.createWorker(OCR_LANG);
  try {
    const { data } = await worker.recognize(buffer);
    return String(data.text || '').trim();
  } finally {
    await worker.terminate();
  }
}

/** Render first PDF page to PNG when the text layer is empty (scanned invoices). */
async function renderPdfFirstPageToPng(buffer: Buffer): Promise<Buffer | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');

    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');

    await page.render({
      canvasContext: context,
      viewport,
      canvas,
    } as Parameters<typeof page.render>[0]).promise;

    return canvas.toBuffer('image/png');
  } catch (err) {
    logger.warn('PDF page render for OCR failed; falling back to text-only', err);
    return null;
  }
}

async function extractTextWithTesseract(
  buffer: Buffer,
  mime: string,
  fileName: string,
): Promise<{ text: string; source: SettlementInvoiceOcrResult['source'] }> {
  if (isImageMime(mime)) {
    const text = await ocrImageBuffer(buffer);
    return { text, source: 'tesseract-image' };
  }

  if (isPdfMime(mime, fileName)) {
    const pdfText = await extractTextFromPdfBuffer(buffer);
    if (pdfText.length >= 80) {
      return { text: pdfText, source: 'pdf-text' };
    }

    const pngBuffer = await renderPdfFirstPageToPng(buffer);
    if (pngBuffer) {
      const text = await ocrImageBuffer(pngBuffer);
      return { text: text || pdfText, source: 'tesseract-pdf-page' };
    }

    return { text: pdfText, source: 'pdf-text' };
  }

  throw new Error('Unsupported file type for OCR. Use PDF or image (PNG/JPEG).');
}

export async function runSettlementInvoiceOcr(
  buffer: Buffer,
  mime: string,
  fileName: string,
): Promise<SettlementInvoiceOcrResult> {
  const { text, source } = await extractTextWithTesseract(buffer, mime, fileName);
  const fields = parseSettlementInvoiceText(text);
  const extractedCount = countExtractedFields(fields);
  const partial = extractedCount < SETTLEMENT_INVOICE_FIELD_COUNT;

  return {
    fields,
    extractedCount,
    totalFields: SETTLEMENT_INVOICE_FIELD_COUNT,
    partial,
    source,
  };
}

export async function runSettlementInvoiceOcrFromPath(
  filePath: string,
  mime: string,
  fileName: string,
): Promise<SettlementInvoiceOcrResult> {
  const buffer = fs.readFileSync(filePath);
  return runSettlementInvoiceOcr(buffer, mime, fileName);
}
