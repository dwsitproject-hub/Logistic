'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { Button } from './ui/button';
import { iconButtonClass } from '@/lib/iconButton'
import {
  describeSapFolderRun,
  findRunStartedSince,
  formatSapFolderTime,
  isSapFolderRunFinished,
  syncClickTimeMs,
  type SapFolderRun,
  type SapFolderRunTone,
} from '@/lib/sapFolderSync';

const POLL_MS = 3000;
/** A run that has not finished by now is hung; stop waiting so the button comes back. */
const GIVE_UP_MS = 20 * 60 * 1000;

const TONE_TEXT: Record<SapFolderRunTone, string> = {
  ok: 'text-emerald-700',
  info: 'text-blue-700',
  warn: 'text-amber-700',
  error: 'text-red-700',
};

const TONE_STRIP: Record<SapFolderRunTone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-800',
};

type Status = { running: boolean; cronEnabled: boolean; cron: string; runs: SapFolderRun[] };

function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return e?.response?.data?.error?.message || e?.message || 'Request failed';
}

export interface SapFolderSync {
  status: Status | null;
  syncing: boolean;
  message: { text: string; tone: SapFolderRunTone } | null;
  /** True while a sync (this one or a scheduled run) is going, so the button waits. */
  busy: boolean;
  sync: () => Promise<void>;
}

/**
 * Sync: pull the newest file from the SAP share now - the backup for when the schedule did not.
 * Only the newest file in the folder is considered, and only when KLIP does not have it yet. The page shows the outcome of the
 * latest run (schedule or Sync) next to it, so a skipped run no longer looks the same as a quiet morning.
 *
 * The state lives in this hook so the BUTTON (page header) and the STATUS line (under the header) can sit in different places.
 * `onTick` lets the page reload its import list while a sync runs, so the progress card appears and the new import shows up.
 */
export function useSapFolderSync(onTick: () => void): SapFolderSync {
  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: SapFolderRunTone } | null>(null);
  const timerRef = useRef<number | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const stopPolling = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<Status | null> => {
    try {
      const res = await api.get('/sap-master-v2/auto-import/status');
      const next = res.data?.data as Status;
      setStatus(next);
      return next;
    } catch {
      return null; // the status line is informational: a failed read must not break the page
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    return () => stopPolling();
  }, [loadStatus, stopPolling]);

  const sync = async () => {
    setMessage(null);
    setSyncing(true);
    const clickedLocalAt = Date.now();
    let clickedAt = clickedLocalAt;
    try {
      const res = await api.post('/sap-master-v2/auto-import/sync');
      clickedAt = syncClickTimeMs(res.data?.data?.serverNow, clickedLocalAt);
    } catch (error) {
      setSyncing(false);
      setMessage({ text: errorMessage(error), tone: 'warn' });
      return;
    }
    stopPolling();
    timerRef.current = window.setInterval(() => {
      void (async () => {
        onTickRef.current();
        const next = await loadStatus();
        const mine = next ? findRunStartedSince(next.runs, clickedAt) : null;
        if (isSapFolderRunFinished(mine)) {
          stopPolling();
          setSyncing(false);
          const described = describeSapFolderRun(mine!);
          setMessage({ text: `${described.label}${mine!.detail ? ` - ${mine!.detail}` : ''}`, tone: described.tone });
          onTickRef.current();
        } else if (Date.now() - clickedLocalAt > GIVE_UP_MS) {
          stopPolling();
          setSyncing(false);
          setMessage({ text: 'The sync is taking too long. Check the import list and the backend log.', tone: 'warn' });
        }
      })();
    }, POLL_MS);
  };

  return { status, syncing, message, busy: syncing || status?.running === true, sync };
}

/** The Sync button for the page header: a secondary button next to the primary Import button. */
export function SapFolderSyncButton({ folderSync, canSync }: { folderSync: SapFolderSync; canSync: boolean }) {
  if (!canSync) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void folderSync.sync()}
      disabled={folderSync.busy}
      title={folderSync.busy ? 'Syncing...' : 'Sync: pull the newest file from the SAP share now. Only the newest file is imported, and only if KLIP does not have it yet.'}
      aria-label={folderSync.busy ? 'Syncing' : 'Sync'}
      className={iconButtonClass('sync')}
    >
      {folderSync.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
    </Button>
  );
}

/** One slim strip under the header: how the last run (schedule or Sync) ended and which file the SAP folder holds. Shows the sync result instead while one is reported. */
export function SapFolderSyncStatus({ folderSync }: { folderSync: SapFolderSync }) {
  const { status, message } = folderSync;
  const last = status?.runs?.[0] ?? null;
  const lastText = last ? describeSapFolderRun(last) : null;
  const scheduleOff = Boolean(status && !status.cronEnabled);

  if (message) {
    return (
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${TONE_STRIP[message.tone]}`} role="status">
        <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">{message.text}</span>
      </div>
    );
  }
  if (!last && !scheduleOff) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"
      role="status"
    >
      {last && lastText ? (
        <>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            Last {last.trigger_source === 'cron' ? 'scheduled run' : 'sync'}: {formatSapFolderTime(last.started_at)}
            <span className={`font-medium ${TONE_TEXT[lastText.tone]}`}>{lastText.label}</span>
          </span>
          {last.newest_file ? (
            <span className="inline-flex min-w-0 items-center gap-1.5" title={last.newest_file}>
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
              <span className="shrink-0">Newest file in the share:</span>
              <span className="truncate font-medium text-gray-700">{last.newest_file}</span>
              <span className="shrink-0 text-gray-400">({formatSapFolderTime(last.newest_file_mtime)})</span>
            </span>
          ) : null}
        </>
      ) : null}
      {scheduleOff ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          The daily schedule is switched off on this server.
        </span>
      ) : null}
    </div>
  );
}
