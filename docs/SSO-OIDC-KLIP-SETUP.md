# KLIP — OIDC SSO Setup (Downstream Hub)

**Status:** Primary SSO path for KLIP SIT/production.  
**Reference:** [`SSO-TARGET-APP-INTEGRATION.md`](SSO-TARGET-APP-INTEGRATION.md) (Hub target-app contract).

The legacy HS256 JWT bridge (`POST /auth/hub`) is **retired on Hub** and gated in KLIP behind `SSO_LEGACY_BRIDGE=true` (default off). Use OIDC instead.

---

## Architecture

```
Browser (test-klip.kpndomain.com)
  ├── GET /auth/oidc/login        → backend → Hub authorize (PKCE)
  ├── GET /auth/oidc/callback     → backend token exchange (JSON) → session cookie
  └── GET/POST /api/*             → backend (cookie auth, no Bearer required)
```

**Session model:** HttpOnly `express-session` cookie on a **single origin** (browser hostname = API hostname).

**User mapping:** Invite-only by **email**; Hub `sub` stored in `users.hub_oidc_sub`; users are never auto-created.

---

## Hub Admin (Applications → Logistic)

**Copy-paste into Hub → Admin → Applications → Logistic → Edit → SSO settings:**

| Field | Value |
|---|---|
| SSO Mode | `OIDC (strict)` |
| OAuth Client ID | see block below |
| OIDC Redirect URIs | see block below |
| Target URL | `http://test-klip.kpndomain.com/login` |

**OAuth Client ID** (single line):

```
logistic
```

**OIDC Redirect URIs** (one URI per line, no trailing slash):

```
http://test-klip.kpndomain.com/auth/oidc/callback
```

Redirect URI must match **exactly** the `OIDC_REDIRECT_URI` env var on KLIP backend.

---

## Backend environment variables

Set in `/opt/klip/.env` (backend stack) or root `docker-compose.yml`:

```ini
OIDC_DISCOVERY_URL=http://test-dwshub.kpndomain.com/api/sso/.well-known/openid-configuration
OIDC_CLIENT_ID=logistic
OIDC_REDIRECT_URI=http://test-klip.kpndomain.com/auth/oidc/callback
OIDC_SCOPES=openid email profile

SESSION_SECRET=<openssl rand -base64 48>   # KLIP session signing — NOT from Hub
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=false                # true when HTTPS
FRONTEND_URL=http://test-klip.kpndomain.com
TRUST_PROXY=1                              # required behind nginx

# Legacy bridge (off by default):
SSO_LEGACY_BRIDGE=false
```

OIDC routes return **503** when `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, or `OIDC_REDIRECT_URI` is missing.

---

## Frontend build (single-origin)

Browser must call API on the **same hostname** as the Next.js app:

```ini
NEXT_PUBLIC_API_URL=/api
```

When Next.js serves traffic without nginx (Docker host port 80), also set at **build time**:

```ini
BACKEND_INTERNAL_URL=http://172.28.92.57:5001
```

so Next rewrites `/api/*` and `/auth/*` to the backend container.

See [`nginx/klip-single-origin.conf.example`](nginx/klip-single-origin.conf.example) for the recommended SIT nginx layout.

---

## Database

Migration `127_users_hub_oidc_sub.sql`:

- Column `users.hub_oidc_sub VARCHAR(255)`
- Partial unique index on non-null values

Runs automatically on backend startup.

---

## KLIP routes

| Route | Purpose |
|---|---|
| `GET /auth/oidc/login` | SP-initiated — redirect to Hub with PKCE |
| `GET /auth/oidc/callback` | SP + IdP-initiated callback; sets session; **303** to `FRONTEND_URL` |
| `GET /api/auth/me` | Bootstrap current user (cookie or Bearer) |
| `POST /api/auth/logout` | Destroy session |
| `POST /auth/hub` | Legacy bridge — only if `SSO_LEGACY_BRIDGE=true` |

Login page: **Sign in with DWS Hub** → `/auth/oidc/login`.

---

## Manual verification checklist

1. From backend host/container: `curl -s "$OIDC_DISCOVERY_URL"` returns JSON (not SPA HTML).
2. **SP-initiated:** Login → Hub → land on KLIP logged in.
3. **IdP-initiated:** Hub dashboard → Logistic tile → land logged in (`code_verifier` on callback query).
4. DevTools → Cookies: session cookie present for app hostname after redirect.
5. **Invite-only:** Hub user with unknown email → `/login?error=sso_no_access`.
6. API calls work with cookie only (no `Authorization` header).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login loop / no session | Split origin (3001 vs 5001) or wrong nginx `Host` header | Single origin; `proxy_set_header Host $host` |
| `sso_not_configured` / 503 on `/auth/oidc/*` | Missing OIDC env vars | Set all three OIDC_* vars; rebuild backend |
| `sso_failed` after Hub login | Wrong redirect URI, form token exchange, or bad JWKS | JSON token POST; verify redirect URI; curl discovery from backend |
| `sso_no_access` | Email not in KLIP `users` or inactive | Admin creates user with matching email |
| Cookie not sent | `Secure=true` on HTTP, or cross-site API URL | `SESSION_COOKIE_SECURE=false` on HTTP; `NEXT_PUBLIC_API_URL=/api` |
| Discovery returns HTML | Wrong discovery URL (SPA catch-all) | Use Hub API path from target doc |

---

## Related docs

- [`SSO-TARGET-APP-INTEGRATION.md`](SSO-TARGET-APP-INTEGRATION.md) — Hub contract
- [`SSO-OIDC-INTEGRATION-QUESTIONS.md`](SSO-OIDC-INTEGRATION-QUESTIONS.md) — answered Q&A
- [`SSO-INTEGRATION-GUIDE.md`](SSO-INTEGRATION-GUIDE.md) — legacy bridge (Appendix)
- [`DEPLOY-SIT-GITHUB.md`](DEPLOY-SIT-GITHUB.md) — SIT deploy steps
