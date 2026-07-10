/**
 * Generates KLIP SIT deployment checklist DOCX.
 * Run from repo root: node docs/scripts/generate-deploy-checklist-docx.mjs
 * Requires: npm install docx (from repo root or run once: npm install docx in same folder as this script's node_modules)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let Document, Packer, Paragraph, TextRun, HeadingLevel;
try {
  const docx = await import('docx');
  Document = docx.Document;
  Packer = docx.Packer;
  Paragraph = docx.Paragraph;
  TextRun = docx.TextRun;
  HeadingLevel = docx.HeadingLevel;
} catch {
  console.error('Install docx first: npm install docx');
  console.error('  from Logistic repo root: npm install docx --no-save');
  process.exit(1);
}

const p = (text, opts = {}) =>
  new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });

const boldLine = (text) =>
  new Paragraph({
    children: [new TextRun({ text, bold: true })],
    spacing: { before: 180, after: 120 },
  });

const code = (text) =>
  new Paragraph({
    children: [new TextRun({ text, font: 'Consolas', size: 20 })],
    spacing: { after: 80 },
  });

const children = [
  new Paragraph({
    text: 'KLIP — Checklist deploy SIT (Backend + Frontend)',
    heading: HeadingLevel.TITLE,
    spacing: { after: 240 },
  }),
  p(
    'Dokumen ini merangkum langkah deploy berurutan agar tidak ada proses yang terlewat. Sesuaikan path (/opt/klip atau /home/klip/apps/klip) dan IP server dengan lingkungan Anda. Acuan teknis: docs/DEPLOYMENT.md, docker-compose.backend.yml, docker-compose.frontend.yml.'
  ),

  new Paragraph({ text: 'Sebelum mulai', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
  p('1. Pastikan topology: server backend (Postgres + API) dan server frontend (Next.js + Nginx) — atau satu VM jika digabung.'),
  p('2. Siapkan akses SSH ke server yang relevan.'),
  p('3. Deploy dari branch SIT (bukan main, kecuali kebijakan internal lain).'),
  p('4. Setelah pull, verifikasi commit terbaru (contoh perbaikan SAP: 8767bd7 atau lebih baru pada origin/SIT).'),

  new Paragraph({ text: 'Fase A — Server backend (Postgres + API)', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
  boldLine('A1. Masuk direktori aplikasi'),
  code('cd /opt/klip'),
  p('(atau cd /home/klip/apps/klip — pastikan ada docker-compose.backend.yml dan folder backend/).'),
  boldLine('A2. Cek status container (opsional, disarankan)'),
  code('docker compose -f docker-compose.backend.yml ps'),
  boldLine('A3. Pull kode branch SIT'),
  code('git fetch origin'),
  code('git checkout SIT'),
  code('git pull origin SIT'),
  boldLine('A4. Verifikasi commit'),
  code('git log -1 --oneline'),
  boldLine('A5. Environment'),
  p('Pastikan backend/.env ada (JWT, DB, dll.). Compose memakai env_file: ./backend/.env. Variabel untuk Compose bisa di .env di root repo; jika deploy rutin biasanya tidak diubah kecuali ada perubahan konfigurasi.'),
  boldLine('A6. Rebuild dan restart service backend'),
  code('docker compose -f docker-compose.backend.yml build backend'),
  code('docker compose -f docker-compose.backend.yml up -d backend'),
  p('Opsi rebuild penuh tanpa cache: tambahkan --no-cache pada perintah build.'),
  p('Catatan: docker-entrypoint backend menjalankan migrate + seed saat start; pantau log pada deploy pertama.'),
  boldLine('A7. Verifikasi health'),
  code('docker compose -f docker-compose.backend.yml ps'),
  code('curl -s http://127.0.0.1:5001/health'),
  boldLine('A8. Log jika ada error'),
  code('docker compose -f docker-compose.backend.yml logs --tail=100 backend'),
  boldLine('A9. Firewall (jika belum)'),
  p('Izinkan TCP 5001 dari IP server frontend ke backend, contoh: sudo ufw allow from <IP_FRONTEND> to any port 5001 && sudo ufw reload'),

  new Paragraph({ text: 'Fase B — Server frontend (Next.js)', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
  boldLine('B1. Masuk direktori clone repo'),
  code('cd /opt/klip'),
  boldLine('B2. Pull branch SIT'),
  code('git fetch origin && git checkout SIT && git pull origin SIT'),
  boldLine('B3. Verifikasi commit'),
  code('git log -1 --oneline'),
  boldLine('B4. File .env di root (sejajar docker-compose.frontend.yml)'),
  p('Jika API lewat Nginx same-origin: NEXT_PUBLIC_API_URL=/api (nilai ini terbakar saat build). Set FRONTEND_PORT=80 atau 3001 sesuai setup Nginx. Jika .env berubah untuk NEXT_PUBLIC_*, wajib rebuild frontend.'),
  boldLine('B5. Rebuild dan restart container frontend'),
  code('docker compose -f docker-compose.frontend.yml build frontend'),
  code('docker compose -f docker-compose.frontend.yml up -d frontend'),
  boldLine('B6. Verifikasi HTTP lokal'),
  p('Port 80: curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1/'),
  p('Port 3001: ganti URL ke http://127.0.0.1:3001/ — harus 200.'),

  new Paragraph({ text: 'Fase C — Nginx (server frontend, jika dipakai)', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
  code('sudo nginx -t'),
  code('sudo systemctl reload nginx'),
  p('Verifikasi: curl -s -o /dev/null -w "%{http_code}\\n" http://localhost/api/health harus 200.'),
  p('Import SAP file besar: proxy_read_timeout di location /api/ mungkin perlu dinaikkan (default contoh dokumen 60s) agar request panjang tidak terputus.'),

  new Paragraph({ text: 'Fase D — Smoke test browser', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
  p('1. Buka URL aplikasi, login.'),
  p('2. Uji halaman kritis (mis. SAP Data — import).'),
  p('3. DevTools → Network: periksa status import-upload.'),
  p('4. DevTools → Console: periksa pesan error detail jika ada.'),

  new Paragraph({ text: 'Ringkasan urutan wajib', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),
  p('Backend: pull SIT → build + up backend → /health OK.'),
  p('Frontend: pull SIT → .env API → build + up frontend → curl lokal OK.'),
  p('Nginx: nginx -t → reload → /api/health OK.'),
  p('Browser: login + fitur yang baru di-deploy.'),

  new Paragraph({
    children: [
      new TextRun({
        text: 'Dibuat otomatis dari checklist deploy KLIP. Untuk detail arsitektur dan contoh nginx penuh, lihat docs/DEPLOYMENT.md.',
        italics: true,
        size: 20,
      }),
    ],
    spacing: { before: 360 },
  }),
];

const doc = new Document({
  sections: [{ properties: {}, children }],
});

const outPath = path.join(__dirname, '..', 'KLIP_Checklist_Deploy_SIT.docx');
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log('Written:', outPath);
