# VA High/Medium remediation notes (ZAP 10 Aug 2026)

Source: `docs/Vulnerability-Assessment-Report (KPN Logistics Intelligence Platform).pdf`

## Completed in application code

### High — SQL Injection (`dateTo`, `eventAt`)

**Finding:** ZAP boolean-based alerts on `GET /api/contracts?dateTo=` and `POST /api/user-activity/events` (`eventAt`).

**Root cause:** Queries were already **parameterized** (`$N` + `pool.query`). Missing format validation allowed cast/side-channel differences for payloads like `2026-08-06%`.

**Fix:**
- Strict `YYYY-MM-DD` validation for list filters (`dateFrom`/`dateTo`) → HTTP **400** on invalid input.
- ISO-8601 validation for activity `eventAt` → invalid events **skipped** (no SQL bind of junk).
- ILIKE metacharacter escape (`%`, `_`, `\`) + `ESCAPE E'\\'` on contract list text filters.

**Qty / performance:** No change to Outstanding / Receive / Delivery Qty formulas. Validation is O(1).

### Medium — CSP Not Set / Missing Anti-clickjacking

**Finding:** HTML responses from Next.js lacked CSP / X-Frame-Options (API already had Helmet).

**Fix:**
- `frontend/next.config.js` → `headers()` for CSP, `X-Frame-Options: SAMEORIGIN`, nosniff, referrer-policy.
- `docs/nginx/klip-single-origin.conf.example` → matching `add_header` for edge defense-in-depth.

---

## Ops checklist — Medium: HTTP Only Site (TLS)

Deploy TLS on the SIT edge (not done by app containers alone):

1. Obtain cert/key for `test-klip.kpndomain.com` (corp PKI or Let's Encrypt).
2. Apply `docs/nginx/klip-single-origin.conf.example` (443 + HTTP→HTTPS redirect).
3. Update backend env:
   - `FRONTEND_URL=https://test-klip.kpndomain.com`
   - `OIDC_REDIRECT_URI=https://test-klip.kpndomain.com/auth/oidc/callback`
   - `TRUST_PROXY=1`
   - `SESSION_COOKIE_SECURE=true`
4. Rebuild frontend with `NEXT_PUBLIC_API_URL=/api` (relative).
5. Verify: `https://test-klip.kpndomain.com/login` loads; API health via same origin `/api` or backend health URL.
6. Re-run ZAP (or curl) confirming HTTPS responds and HTTP redirects.

---

## Phase 2 (deferred) — Medium: JWT in localStorage

**Current:** Bearer JWT stored in `localStorage` (`token`) from login / SSO callback; axios reads it in `frontend/src/lib/api.ts`.

**Recommended (not implemented this round):**
- Issue session as **HttpOnly + Secure + SameSite** cookie (single-origin nginx already required for SSO cookies).
- Stop persisting JWT in `localStorage` / `sessionStorage`.
- Add CSRF protection for cookie-authenticated mutating requests if cookie auth is used for API writes.
- Short TTL + refresh rotation; revoke tester tokens from the VA engagement.

**Why deferred:** Touches login, SSO callback, `api.ts`, and CSRF design. Does **not** affect qty calculations, but is a larger auth change than High SQLi hardening.

---

## Manual regression checklist (qty-aware)

1. Contracts / Contract Performance: valid `dateFrom`/`dateTo` → Outstanding / Delivery / Receive Qty unchanged vs baseline for 1–2 sample contracts.
2. `dateTo=2026-08-06%` → **400**, not a shrunk 200 result set.
3. Shipments & Trucking View Table: spot-check Delivery / Receive / OS qty.
4. Login + navigate: no critical CSP console blocks.
5. Activity tracker: valid ISO `eventAt` still inserts; payload with `%` is skipped (batch still 200).
6. Local: `http://localhost:3001` and `http://localhost:5001/health` after rebuild; hard refresh (Ctrl+Shift+R).
