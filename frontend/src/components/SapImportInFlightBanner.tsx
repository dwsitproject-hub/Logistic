'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useSapImportInFlight } from '@/hooks/useSapImportInFlight';
import { cn } from '@/lib/utils';

/** Compact header badge — shown next to the page title while SAP import is running. */
export function SapImportInFlightBanner() {
  const { active, activeImport, progress, loading } = useSapImportInFlight();

  if (loading || !active || !activeImport) {
    return null;
  }

  const detailHref = activeImport.id
    ? `/sap-imports?import=${encodeURIComponent(activeImport.id)}`
    : '/sap-imports';

  return (
    <Link
      href={detailHref}
      title="SAP import in progress. Daily Planning and WB uploads are disabled until it finishes."
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50',
        'px-2 py-1 text-xs font-medium text-amber-900',
        'hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
      )}
    >
      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-700" aria-hidden />
      <span className="truncate">SAP import · {progress}%</span>
    </Link>
  );
}
