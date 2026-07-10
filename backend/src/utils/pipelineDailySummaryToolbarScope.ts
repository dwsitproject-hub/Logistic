/**
 * Toolbar scope (product / incoterm) for pipeline daily summary eligibility + read filters.
 * Supplier is not stored in daily summary — still forces live SQL when filtered.
 */

import type { ColumnFilterPayload } from './contractListFilters';

export const PIPELINE_DAILY_TOOLBAR_COLUMN_KEYS = new Set(['product', 'incoterm']);

export interface ToolbarScopeFromColumnFilters {
  products: string[];
  incoterms: string[];
  includeBlankProduct: boolean;
  includeBlankIncoterm: boolean;
}

export function sqlPipelineProductKey(columnExpr: string): string {
  return `COALESCE(NULLIF(TRIM(${columnExpr}::text), ''), 'Blank')`;
}

export function sqlPipelineIncotermKey(columnExpr: string): string {
  return `COALESCE(NULLIF(TRIM(UPPER(${columnExpr}::text)), ''), 'Blank')`;
}

function readMultiFilter(
  colFilters: ColumnFilterPayload | undefined,
  key: string,
): { values: string[]; includeBlank: boolean } {
  const raw = colFilters?.[key];
  if (!raw || typeof raw !== 'object') {
    return { values: [], includeBlank: false };
  }
  const obj = raw as { type?: string; values?: unknown; includeBlank?: boolean };
  if (obj.type !== 'multi' || !Array.isArray(obj.values)) {
    return { values: [], includeBlank: false };
  }
  const values = obj.values.map((v) => String(v).trim()).filter(Boolean);
  const includeBlank = Boolean(obj.includeBlank) || values.includes('Blank');
  return {
    values: values.filter((v) => v !== 'Blank'),
    includeBlank,
  };
}

export function extractToolbarScopeFromColumnFilters(
  colFilters?: ColumnFilterPayload,
): ToolbarScopeFromColumnFilters {
  const product = readMultiFilter(colFilters, 'product');
  const incoterm = readMultiFilter(colFilters, 'incoterm');
  return {
    products: product.values,
    incoterms: incoterm.values.map((v) => v.toUpperCase()),
    includeBlankProduct: product.includeBlank,
    includeBlankIncoterm: incoterm.includeBlank,
  };
}

export function hasNonToolbarColumnFilters(colFilters?: ColumnFilterPayload): boolean {
  if (!colFilters) return false;
  return Object.keys(colFilters).some((k) => {
    if (PIPELINE_DAILY_TOOLBAR_COLUMN_KEYS.has(k)) return false;
    const raw = colFilters[k];
    return raw != null && typeof raw === 'object';
  });
}

export function hasToolbarScopeColumnFilters(colFilters?: ColumnFilterPayload): boolean {
  if (!colFilters) return false;
  return Object.keys(colFilters).some((k) => PIPELINE_DAILY_TOOLBAR_COLUMN_KEYS.has(k));
}
