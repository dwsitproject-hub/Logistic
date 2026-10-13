import { hubSdkScriptConfig } from '@/lib/hubSdk'

/**
 * Downstream Hub SDK loader. Renders nothing unless NEXT_PUBLIC_HUB_SDK_URL and
 * NEXT_PUBLIC_HUB_SDK_KEY were set at build time.
 *
 * A plain server-rendered <script>, not next/script: the SDK reads its data-* attributes from
 * document.currentScript, which a plain tag in the initial HTML always provides. It sits in the
 * root layout, which persists across client navigations, so it loads once per page load — the
 * SDK picks up route changes itself.
 *
 * `defer`, never synchronous, so a slow or unreachable Hub cannot hold up KLIP's first paint.
 * The trade-off is that a request KLIP fires before the SDK has run is missing from the
 * breadcrumbs; everything after it is recorded. Calls KLIP makes in that window are not lost
 * — hubSdk.ts queues them for the SDK to replay.
 */
export function HubSdkScript() {
  const cfg = hubSdkScriptConfig()
  if (!cfg) return null
  return (
    <script
      src={cfg.src}
      data-app-key={cfg.appKey}
      data-release={cfg.release}
      data-debug={cfg.debug ? 'true' : undefined}
      // KLIP opens the dialog from its own header button instead — see hubOpenBugReport().
      data-bug-button="false"
      defer
    />
  )
}
