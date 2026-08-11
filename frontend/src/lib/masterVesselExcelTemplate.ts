import * as XLSX from 'xlsx';
import { formatVesselCodeDisplay } from './formatVesselCodeDisplay';

export const JOVIN_SHEET_NAME = 'Jovin';
export const KLIP_SHEET_NAME = 'KLIP';

export const JOVIN_TEMPLATE_HEADERS = [
  'Vessel Name',
  'Vessel Code',
  'Company Code',
  'Company Name',
  'Vessel Capacity',
  'Vessel Type',
  'Heating',
  'Type Lambung',
  'Terms',
] as const;

export const KLIP_TEMPLATE_HEADERS = ['Vessel Name', 'Vessel Code'] as const;

export interface MasterVesselTemplateRow {
  vessel_name: string;
  vessel_code: string | null;
  sap_vendor_code: string | null;
  vessel_owner: string | null;
  vessel_capacity_mt: number | null;
  vessel_type: string | null;
  heating: boolean | null;
  lambung_type: string | null;
  terms: string | null;
}

function formatHeating(value: boolean | null | undefined): string {
  if (value == null) return '';
  return value ? 'Yes' : 'No';
}

function exportVesselCode(code: string | null | undefined): string {
  if (!code) return '';
  const display = formatVesselCodeDisplay(code);
  return display === '-' ? '' : display;
}

export function masterVesselToJovinRow(v: MasterVesselTemplateRow): string[] {
  return [
    v.vessel_name ?? '',
    exportVesselCode(v.vessel_code),
    v.sap_vendor_code ?? '',
    v.vessel_owner ?? '',
    v.vessel_capacity_mt != null ? String(v.vessel_capacity_mt) : '',
    v.vessel_type ?? '',
    formatHeating(v.heating),
    v.lambung_type ?? '',
    v.terms ?? '',
  ];
}

export function masterVesselToKlipRow(v: MasterVesselTemplateRow): string[] {
  const code = exportVesselCode(v.vessel_code);
  if (!code) return [];
  return [v.vessel_name ?? '', code];
}

export function buildMasterVesselTemplateWorkbook(
  vessels: MasterVesselTemplateRow[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const jovinRows: string[][] = [
    [...JOVIN_TEMPLATE_HEADERS],
    ...vessels.map((v) => masterVesselToJovinRow(v)),
  ];
  const jovinSheet = XLSX.utils.aoa_to_sheet(jovinRows);
  XLSX.utils.book_append_sheet(wb, jovinSheet, JOVIN_SHEET_NAME);

  const klipRows: string[][] = [[...KLIP_TEMPLATE_HEADERS]];
  for (const v of vessels) {
    const row = masterVesselToKlipRow(v);
    if (row.length) klipRows.push(row);
  }
  const klipSheet = XLSX.utils.aoa_to_sheet(klipRows);
  XLSX.utils.book_append_sheet(wb, klipSheet, KLIP_SHEET_NAME);

  return wb;
}

export function buildMasterVesselTemplateBlob(vessels: MasterVesselTemplateRow[]): Blob {
  const wb = buildMasterVesselTemplateWorkbook(vessels);
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function downloadMasterVesselTemplate(vessels: MasterVesselTemplateRow[]): void {
  const blob = buildMasterVesselTemplateBlob(vessels);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Master Vessel Template.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
