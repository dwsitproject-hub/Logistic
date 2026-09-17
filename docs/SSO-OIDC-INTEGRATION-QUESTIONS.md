# KLIP ↔ Downstream Hub — OIDC (strict) Integration Questions

> **Answered (2026-07):** KLIP implemented OIDC per [`SSO-TARGET-APP-INTEGRATION.md`](SSO-TARGET-APP-INTEGRATION.md).  
> Operational setup: [`SSO-OIDC-KLIP-SETUP.md`](SSO-OIDC-KLIP-SETUP.md).  
> The questions below remain as historical context for the Hub integration discussion.

**Context:** KLIP ("Logistic" app in Downstream Hub Admin) was originally integrated using the
custom JWT-bridge flow described in `docs/SSO-INTEGRATION-GUIDE.md` (`POST /auth/hub` with a
Hub-signed HS256 JWT). We've since discovered:

- The Hub Admin "SSO Mode" dropdown for our app now only offers **"Without SSO"** or **"OIDC
  (strict)"** — the old bridge mode is not selectable.
- `GET /api/sso/bridge` on the Hub now returns **`410 Gone`**, confirming the old bridge endpoint
  has been intentionally retired.
- To let users click "Logistic" in the Hub dashboard and land already-authenticated in KLIP, we
  need to implement a real **OpenID Connect (Authorization Code flow)** client on the KLIP side.

We could not find a working OIDC discovery document (`/.well-known/openid-configuration` returns
the Hub SPA's `index.html`, not JSON — likely served by SPA catch-all, not caught by the API), so
we need these details directly from you.

---

## What we've already configured on our side (Hub Admin → Applications → Logistic)

| Field | Value |
|---|---|
| Target URL | `http://test-klip.kpndomain.com/login` |
| SSO Mode | `OIDC (strict)` |
| OAuth Client ID | `logistic` |
| OIDC Redirect URIs | `http://test-klip.kpndomain.com/auth/oidc/callback` |

Please confirm these are acceptable, especially the Redirect URI — it must match **exactly** what
KLIP's backend will send in the `redirect_uri` parameter of the token exchange request.

---

## Questions

### 1. Token endpoint

What is the exact URL of the **token endpoint** we should `POST` to in order to exchange an
`authorization code` for tokens (e.g. `grant_type=authorization_code`)?

> Example we'd expect: `http://test-dwshub.kpndomain.com/api/oidc/token` (please confirm the real path)

### 2. Authorization endpoint (if applicable)

Since users click the app icon directly from the already-authenticated Hub dashboard (not from a
"Login with Hub" button inside KLIP), does Hub:

- (a) internally construct the authorization request and redirect the browser straight to our
  `redirect_uri` with `?code=...&state=...` — i.e. **we do not need to build an initiation
  endpoint** on the KLIP side, or
- (b) expect **KLIP to redirect the user** to Hub's `authorization_endpoint` first (standard
  RP-initiated OIDC), in which case please share that URL too?

### 3. Client authentication — is there a `client_secret`?

Is `client_id = logistic` paired with a **`client_secret`** that we need for the token exchange
(confidential client), or is this a **public client** (no secret, authenticated only by matching
`client_id` + exact `redirect_uri`, optionally with PKCE)?

- If there is a secret, how do we obtain it? (e.g. shown once after Save in the Admin form, sent
  out-of-band, etc.)
- If this is a public client, is **PKCE** (`code_challenge` / `code_verifier`) required or
  optional for the authorization request?

### 4. ID token verification — JWKS / signing algorithm

- What is the **JWKS URI** (public key set) we should use to verify the `id_token` signature?
- What signing algorithm is used — `RS256` (asymmetric, via JWKS) or `HS256` (shared secret, like
  the old bridge JWT)?
- What is the expected **`iss` (issuer)** claim value we should validate against?
- What is the expected **`aud` (audience)** claim value — should it equal our `client_id`
  (`logistic`)?

### 5. Token endpoint response shape

Does the token endpoint return a standard OIDC response body, e.g.:

```json
{
  "access_token": "...",
  "id_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Please confirm the actual field names, and which claims are present in the `id_token` payload
(we specifically need **`email`** and a stable **`user_id`**, matching the same claims the old
bridge JWT used per `docs/SSO-INTEGRATION-GUIDE.md` Section 2).

### 6. Scopes

What `scope` value(s) should we request in the authorization request (assuming we do initiate
it per Q2) — e.g. `openid email profile`? Are there any KLIP-specific scopes required?

### 7. Redirect URI matching rules

Does the Redirect URI need to match **byte-for-byte** (including trailing slash, query string
absence, etc.), or is there any normalization? Confirm `http://test-klip.kpndomain.com/auth/oidc/callback`
(no trailing slash) is exactly correct.

### 8. Error handling

If authentication fails on the Hub side (user not permitted, token expired, etc.), how does Hub
communicate that to our `redirect_uri`? (e.g. `?error=access_denied&error_description=...` per
standard OAuth2, or something custom?)

### 9. HTTPS

Current SIT environment for both Hub (`test-dwshub.kpndomain.com`) and KLIP
(`test-klip.kpndomain.com`) is plain HTTP (port 443 is closed on `test-dwshub.kpndomain.com`).
Is HTTPS required/enforced for OIDC in this environment, or is HTTP acceptable for SIT/staging
testing purposes?

---

## Once we have these answers

We will implement, on the KLIP backend:

- (If needed per Q2b) a login-initiation redirect to the `authorization_endpoint`.
- `GET/POST` callback handling for `/auth/oidc/callback` → exchange `code` for tokens at the
  `token_endpoint` → verify `id_token` (JWKS or shared secret, per Q4) → look up the KLIP user by
  `email` (invite-only, same policy as before) → issue a normal KLIP session → redirect into the
  app.

This mirrors the JWT-bridge implementation we already built and tested (`sso.controller.ts`),
just swapping the token-verification step for real OIDC.
