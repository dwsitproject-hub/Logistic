import api from '@/lib/api';
import { isAuthenticatedLocally } from '@/lib/authSession';
import type { UserActivityEventPayload, UserActivityEventType } from '@/lib/userActivityLog';

const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE = 100;
const SKIP_URL_PREFIXES = ['/user-activity', '/auth/login', '/auth/'];

let queue: UserActivityEventPayload[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastPath = '';

function shouldSkipUrl(url?: string): boolean {
  if (!url) return false;
  return SKIP_URL_PREFIXES.some((p) => url.includes(p));
}

function enqueue(event: UserActivityEventPayload): void {
  if (typeof window === 'undefined') return;
  if (!isAuthenticatedLocally()) return;

  queue.push({
    ...event,
    eventAt: event.eventAt ?? new Date().toISOString(),
  });
  if (queue.length > MAX_QUEUE) {
    queue = queue.slice(-MAX_QUEUE);
  }
}

async function flush(): Promise<void> {
  if (!queue.length) return;
  const batch = queue.splice(0, 50);
  try {
    await api.post('/user-activity/events', { events: batch });
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
  }
}

function ensureFlushLoop(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  window.addEventListener('beforeunload', () => {
    if (!queue.length) return;
    if (!isAuthenticatedLocally()) return;
    const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:5001/api';
    const token = localStorage.getItem('token');
    const body = JSON.stringify({ events: queue });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    void fetch(`${baseURL}/user-activity/events`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body,
      keepalive: true,
    });
  });
}

export function startUserActivityTracker(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  ensureFlushLoop();

  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el =
        target.closest('button,[role="button"],a.btn,a[class*="Button"],input[type="submit"]') ??
        null;
      if (!el) return;

      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (el as HTMLButtonElement).innerText?.trim().slice(0, 120) ||
        el.tagName;

      enqueue({
        eventType: 'CLICK',
        pagePath: window.location.pathname,
        actionLabel: label,
      });
    },
    true,
  );
}

export function trackPageView(pathname: string): void {
  if (!pathname || pathname === lastPath) return;
  lastPath = pathname;
  if (pathname === '/login') return;
  enqueue({
    eventType: 'VIEW',
    pagePath: pathname,
    actionLabel: `View ${pathname}`,
  });
}

export function trackApiMutation(
  method: string,
  url: string,
  eventType: UserActivityEventType,
  actionLabel: string,
): void {
  if (shouldSkipUrl(url)) return;
  enqueue({
    eventType,
    pagePath: typeof window !== 'undefined' ? window.location.pathname : undefined,
    actionLabel,
    metadata: { method: method.toUpperCase(), url },
  });
}

export function mapHttpMethodToEventType(method: string): UserActivityEventType | null {
  const m = method.toUpperCase();
  if (m === 'POST') return 'CREATE';
  if (m === 'PUT' || m === 'PATCH') return 'UPDATE';
  if (m === 'DELETE') return 'EDIT';
  return null;
}

export async function flushUserActivityQueue(): Promise<void> {
  await flush();
}
