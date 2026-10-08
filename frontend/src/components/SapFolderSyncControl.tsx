'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { Button } from './ui/button';
import {
  describeSapFolderRun,
  findRunStartedSince,
  formatSapFolderTime,
  isSapFolderRunFinished,
  type SapFolderRun,
  type SapFolderRunTone,
} from '@/lib/sapFolderSync';

const POLL_MS = 3000;
/** A run that has not finished by now is hung; stop waiting so the button comes back. */
const GIVE_UP_MS = 20 * 60 * 1000;

const TONE_CLASS: Record<SapFolderRunTone, string> = {
  ok: 'text-green-700',
  info: 'text-blue-700',
  warn: 'text-amber-700',
  error: 'text-red-700',
};

type Status = { running: boolean; cronEnabled: boolean; cron: string; runs: SapFolderRun[] };

function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return e?.response?.data?.error?.message || e?.message || 'Request failed';
}

/**
 * Sync: pull the newest file from the SAP share now - the backup for when the schedule did not.
 * Only the newest file in the folder is considered, and only when KLIP does not have it yet. Under it, the outcome of the
 * latest run (schedule or Sync), so a skipped run no longer looks the same as a quiet morning.
 *
 * `onTick` lets the page reload its import list while a sync runs, so the progress card appears and the new import shows up.
 */
const SapFolderSyncControl: React.FC<{ canSync: boolean; onTick: () => void }> = ({ canSync, onTick }) => {
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
      return null; // the line under the button is informational: a failed read must not break the page
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    return () => stopPolling();
  }, [loadStatus, stopPolling]);

  const handleSync = async () => {
    setMessage(null);
    setSyncing(true);
    const clickedAt = Date.now();
    try {
      await api.post('/sap-master-v2/auto-import/sync');
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
        } else if (Date.now() - clickedAt > GIVE_UP_MS) {
          stopPolling();
          setSyncing(false);
          setMessage({ text: 'The sync is taking too long. Check the import list and the backend log.', tone: 'warn' });
        }
      })();
    }, POLL_MS);
  };

  if (!canSync && !status) return null;

  const last = status?.runs?.[0] ?? null;
  const lastText = last ? describeSapFolderRun(last) : null;

  return (
    <div className="ml-4 flex flex-col items-end gap-1 max-w-md">
      {canSync && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleSync()}
          disabled={syncing || status?.running === true}
          title="Pull the newest file from the SAP share now. Only the newest file is imported, and only if KLIP does not have it yet."
          className="border-indigo-600 text-indigo-700 hover:bg-indigo-50"
        >
          {syncing || status?.running ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync
            </>
          )}
        </Button>
      )}
      {message && <p className={`text-xs text-right ${TONE_CLASS[message.tone]}`}>{message.text}</p>}
      {!message && last && lastText && (
        <p className="text-xs text-right text-muted-foreground">
          Last {last.trigger_source === 'cron' ? 'scheduled run' : 'sync'}: {formatSapFolderTime(last.started_at)} -{' '}
          <span className={TONE_CLASS[lastText.tone]}>{lastText.label}</span>
          {last.newest_file ? (
            <>
              <br />
              Newest file in the share: {last.newest_file} ({formatSapFolderTime(last.newest_file_mtime)})
            </>
          ) : null}
        </p>
      )}
      {status && !status.cronEnabled && (
        <p className="text-xs text-right text-amber-700">The daily schedule is switched off on this server.</p>
      )}
    </div>
  );
};

export default SapFolderSyncControl;
