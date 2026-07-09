import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

export interface TandaTerimaContractLine {
  contractExtNo: string;
  supplier: string | null;
}

export interface TandaTerimaPdfInput {
  lines: TandaTerimaContractLine[];
  sendDateIso: string;
  senderEmail: string;
  senderFullName: string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

/** Display date for document footer — e.g. "10 Jun 2026". */
export function formatTandaTerimaSendDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!match) return String(iso);
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Unique suppliers in row order, comma-separated. */
export function buildTandaTerimaSuppliersLabel(lines: TandaTerimaContractLine[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const line of lines) {
    const s = String(line.supplier ?? '').trim();
    if (!s) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(s);
  }
  return parts.length > 0 ? parts.join(', ') : '-';
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i]!;
    }
  }
  lines.push(current);
  return lines;
}

function drawWrapped(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const lines = wrapText(text, font, size, maxWidth);
  let cursorY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursorY, size, font, color: rgb(0, 0, 0) });
    cursorY -= lineHeight;
  }
  return cursorY;
}

function drawTable(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  startY: number,
  rows: TandaTerimaContractLine[],
): number {
  const colWidths = [28, 150, CONTENT_WIDTH - 28 - 150 - 36, 36];
  const headers = ['No', 'Deskripsi', 'Nomor Kontrak', 'Qty'];
  const headerHeight = 22;
  const rowHeight = 20;
  let y = startY;

  const drawRowBorder = (topY: number, h: number) => {
    page.drawRectangle({
      x: MARGIN_X,
      y: topY - h,
      width: CONTENT_WIDTH,
      height: h,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.75,
    });
    let x = MARGIN_X;
    for (let i = 0; i < colWidths.length - 1; i += 1) {
      x += colWidths[i]!;
      page.drawLine({
        start: { x, y: topY },
        end: { x, y: topY - h },
        thickness: 0.75,
        color: rgb(0, 0, 0),
      });
    }
  };

  drawRowBorder(y, headerHeight);
  let x = MARGIN_X + 4;
  for (let i = 0; i < headers.length; i += 1) {
    page.drawText(headers[i]!, {
      x,
      y: y - 15,
      size: 10,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    x += colWidths[i]!;
  }
  y -= headerHeight;

  rows.forEach((row, idx) => {
    drawRowBorder(y, rowHeight);
    const cells = [
      String(idx + 1),
      'KONTRAK JUAL BELI',
      row.contractExtNo,
      '1',
    ];
    let cx = MARGIN_X + 4;
    for (let i = 0; i < cells.length; i += 1) {
      const cellText = cells[i]!;
      const maxW = colWidths[i]! - 8;
      const truncated =
        font.widthOfTextAtSize(cellText, 9) > maxW
          ? `${cellText.slice(0, Math.max(0, Math.floor(maxW / 5)))}…`
          : cellText;
      page.drawText(truncated, {
        x: cx,
        y: y - 14,
        size: 9,
        font,
        color: rgb(0, 0, 0),
      });
      cx += colWidths[i]!;
    }
    y -= rowHeight;
  });

  return y - 16;
}

export async function buildTandaTerimaPdf(input: TandaTerimaPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const suppliersLabel = buildTandaTerimaSuppliersLabel(input.lines);
  const sendDateLabel = formatTandaTerimaSendDate(input.sendDateIso);
  const senderName = String(input.senderFullName || input.senderEmail || 'User').trim();
  const senderParen = `(${senderName.toUpperCase()})`;

  let y = PAGE_HEIGHT - 60;

  const title = 'TANDA TERIMA';
  const titleWidth = fontBold.widthOfTextAtSize(title, 16);
  page.drawText(title, {
    x: (PAGE_WIDTH - titleWidth) / 2,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  y -= 36;

  page.drawText('Kepada :', { x: MARGIN_X, y, size: 11, font: fontBold });
  y = drawWrapped(page, font, suppliersLabel, MARGIN_X + 62, y, 11, CONTENT_WIDTH - 62, 14);
  y -= 6;

  page.drawText('UP :', { x: MARGIN_X, y, size: 11, font: fontBold });
  page.drawText('-', { x: MARGIN_X + 62, y, size: 11, font });
  y -= 24;

  y = drawTable(page, font, fontBold, y, input.lines);

  const returnNote = `Mohon untuk Tanda Terima di paraf dan dikembalikan atau diemail kembali ke: ${input.senderEmail || '-'}`;
  y = drawWrapped(page, font, returnNote, MARGIN_X, y, 10, CONTENT_WIDTH, 13);
  y -= 14;

  y = drawWrapped(
    page,
    font,
    'Demikian disampaikan untuk dapat diterima dengan baik',
    MARGIN_X,
    y,
    10,
    CONTENT_WIDTH,
    13,
  );
  y -= 20;

  page.drawText(`Jakarta, ${sendDateLabel}`, { x: MARGIN_X, y, size: 10, font });
  y -= 40;

  const sigColWidth = CONTENT_WIDTH / 2;
  page.drawText('Pengirim,', { x: MARGIN_X, y, size: 10, font });
  page.drawText('Penerima,', { x: MARGIN_X + sigColWidth, y, size: 10, font });
  y -= 50;

  page.drawText(senderParen, { x: MARGIN_X, y, size: 10, font: fontBold });

  return pdf.save();
}

export function tandaTerimaDownloadFilename(sendDateIso: string): string {
  const safe = String(sendDateIso).trim().replace(/[^\d-]/g, '') || 'document';
  return `Tanda_Terima_${safe}.pdf`;
}
