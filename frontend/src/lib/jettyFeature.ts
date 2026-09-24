/**
 * Jetty Planning System columns on the Shipments table.
 *
 * Off unless `NEXT_PUBLIC_JPS_ENABLED=true`, so production shows nothing while SIT can test the
 * integration. With JPS disabled the two columns would read "Not Sent" and "-" on every row -
 * accurate, and only confusing.
 *
 * This mirrors `JPS_ENABLED` on the backend rather than reading it: the backend flag also needs a
 * base URL and an API key, and the browser must never see either. Set both on an environment where
 * the integration is live.
 */
export const JETTY_COLUMNS_ENABLED =
  (process.env.NEXT_PUBLIC_JPS_ENABLED ?? 'false').toLowerCase() === 'true';
