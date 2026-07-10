/**
 * Generates SAP UAT Status & Qty Delivery test report DOCX.
 * Run: node docs/scripts/generate-sap-uat-test-report-docx.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } =
  await import('docx');

const outDir = path.join(__dirname, '..', 'test-reports');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'SAP-UAT-Status-QtyDelivery-Test-Report.docx');

const p = (text, opts = {}) =>
  new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 100 },
  });

const h1 = (text) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 120 } });

const h2 = (text) =>
  new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 100 } });

const bullet = (text) =>
  new Paragraph({
    children: [new TextRun({ text: `• ${text}` })],
    spacing: { after: 60 },
    indent: { left: 360 },
  });

const tableHeader = (cells) =>
  new TableRow({
    children: cells.map(
      (t) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
          width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
        }),
    ),
  });

const tableRow = (cells) =>
  new TableRow({
    children: cells.map(
      (t) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: t })] })],
        }),
    ),
  });

const makeTable = (headers, rows) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
    rows: [tableHeader(headers), ...rows.map((r) => tableRow(r))],
  });

const children = [
  new Paragraph({
    text: 'KLIP — Laporan Uji SAP UAT: Status & Quantity Delivery',
    heading: HeadingLevel.TITLE,
    spacing: { after: 200 },
  }),
  p('Tanggal: 1 Juli 2026 | Environment: Local Docker (localhost:3001 / :5001)'),
  p(
    'Scope: Validasi format import SAP baru untuk routing Status kontrak (GR PO vs GR STO) dan Quantity Delivery (Trucking vs Vessel + transport/STO type) di view table dan modal.',
  ),

  h1('Ringkasan'),
  makeTable(
    ['Layer', 'Hasil', 'Keterangan'],
    [
      ['Unit test backend (36)', 'PASS 36/36', 'sapIncotermMetrics, contractDeliveryStatus, qty_move, STO scope'],
      ['Integration SQL+API (80 check)', 'PASS 55 / FAIL 25', 'Gagal pada CIF/FOB qty — belum transport+STO Type'],
      ['API spot-check (4 kontrak)', '2 PASS / 2 FAIL', 'Lihat detail TC di bawah'],
    ],
  ),
  p('Status overall: PARTIAL PASS', { bold: true }),

  h1('Aturan bisnis target'),
  h2('Status'),
  bullet('CIF, FRC → GR PO Status'),
  bullet('FOB, LCO → GR STO Status'),
  h2('Quantity Delivery'),
  bullet('FRC, LCO + LAND → Quantity Delivery Trucking'),
  bullet('CIF, FOB + SEA → Quantity Delivery Vessel'),
  bullet('CIF, FOB + MIX + STO Type T → Quantity Delivery Trucking'),
  bullet('CIF, FOB + MIX + STO Type V → Quantity Delivery Vessel'),

  h1('Matriks surface UI/API'),
  makeTable(
    ['Surface', 'Status', 'Qty Delivery', 'Sesuai UAT?'],
    [
      ['Contracts view table + Detail Modal', 'GR PO only (raw JSON)', 'Incoterm-only', 'Status FAIL; Qty PARTIAL'],
      ['Trucking view table', 'sqlContractImportStatusExpr', 'Outstanding rules lama', 'Status PASS; Qty PARTIAL'],
      ['Shipments view table + Edit Modal', 'sqlContractImportStatusExpr', 'Mixed / global outstanding', 'Status PASS; Qty PARTIAL'],
      ['Dashboard / Oil Loss / Late Perf', 'Legacy', 'Legacy receive/delivery', 'FAIL'],
    ],
  ),

  h1('Test case detail (API + SAP ground truth)'),
  h2('TC-01 PASS — 1004030657 (FRC, LAND)'),
  bullet('SAP: GR PO=Close, Qty Trucking=100,060 kg, Vessel=0'),
  bullet('API contracts list: import_status=Close, quantity_delivery=100060'),
  bullet('Modal Qty Delivery: ~100.06 MT (fix NULLIF + incoterm trucking aktif)'),

  h2('TC-02 FAIL — 1364001990 (LCO, GR PO≠GR STO)'),
  bullet('SAP: GR PO=Close, GR STO=Open → expected status Open'),
  bullet('API contracts list: import_status=Close (salah — ambil GR PO)'),
  bullet('Root cause: contractsListOuterSql.ts import_status dari contract.status (GR PO)'),

  h2('TC-03 FAIL — 1014003049 (CIF, MIX, STO Type T)'),
  bullet('SAP: Qty Trucking=300,550, Vessel=0 → expected 300,550'),
  bullet('API contracts list: quantity_delivery=0'),
  bullet('Root cause: sqlIncotermQuantityDeliveryCase CIF selalu vessel; belum MIX+STO T'),

  h2('TC-04 — 1014003019 (FOB, MIX, STO Type V)'),
  bullet('SAP: Vessel=249,490 — perlu verifikasi di shipments list (tidak muncul di contracts search slice)'),

  h1('Skenario positif (PASS)'),
  bullet('FRC/LCO + LAND → qty dari kolom Trucking'),
  bullet('Trucking & Shipments list → contract_import_status pakai GR PO/STO by incoterm'),
  bullet('SAP UAT field mapping ter-parse (unit test sapMasterV2UatFormat)'),
  bullet('qty_move tidak mask trucking saat vessel=0 (NULLIF fix)'),

  h1('Skenario negatif / gap (FAIL)'),
  bullet('LCO/FOB dengan GR PO ≠ GR STO → contracts list/modal salah status'),
  bullet('CIF/FOB MIX + STO T → qty delivery 0 (25 kontrak di integration test)'),
  bullet('Dashboard, Oil Loss, Late Performance masih logic lama'),
  bullet('fieldHelpText.ts & ContractDetailModal label masih rules lama'),

  h1('Rekomendasi perbaikan'),
  bullet('P0: contractsListOuterSql — ganti import_status ke sqlContractImportStatusExpr'),
  bullet('P0: Extend sapIncotermMetrics dengan transport + STO Type untuk qty delivery'),
  bullet('P1: Selaraskan trucking/shipment outstanding dengan kolom SAP split'),
  bullet('P2: Dashboard, Oil Loss, Late Performance, help text UI'),

  h1('Screenshot checklist (manual UI)'),
  makeTable(
    ['#', 'Halaman', 'Contract sampel', 'Verifikasi'],
    [
      ['1', 'Contracts table', '1004030657, 1364001990, 1014003049', 'Status + Qty Delivery column'],
      ['2', 'Contract Detail Modal', 'Same', 'Qty Delivery MT, Status badge'],
      ['3', 'Trucking table', '1004026972', 'Contract Status column'],
      ['4', 'Shipments table', '1014003049', 'Contract Status + Outstanding'],
      ['5', 'Edit Shipment Modal', 'CIF/FOB MIX', 'PO outstanding qty'],
    ],
  ),
  p('Hard refresh browser: Ctrl+Shift+R setelah deploy backend.'),

  h1('Cara reproduksi otomatis'),
  p('Unit test: npm test -- sapIncoterm contractDelivery contractGlobalOutstanding (di folder backend)'),
  p('Integration: npx ts-node src/scripts/testSapUatStatusQtyDelivery.ts (DB_PORT=5433)'),
  p('API: docs/test-reports/sap-uat-status-qty-api-test.ps1'),

  p('Tester: KLIP Agent (automated) | Dokumen markdown: docs/test-reports/SAP-UAT-Status-QtyDelivery-Test-Report.md', {
    italics: true,
  }),
];

const doc = new Document({ sections: [{ children }] });
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log(`Written: ${outPath}`);
