# Downstream Hub — SSO Integration Guide

> **KLIP operators:** Hub now requires **OIDC (strict)**. Use [`SSO-OIDC-KLIP-SETUP.md`](SSO-OIDC-KLIP-SETUP.md) for the current KLIP setup.  
> This document describes the **legacy HS256 JWT bridge** (`POST /auth/hub`), retained in KLIP only when `SSO_LEGACY_BRIDGE=true`.

This guide is for any team integrating a **target application** with Downstream Hub.  
Hand it to an engineer (or paste it into Cursor) and implement in one pass with no back-and-forth.

---

## How It Works — Full Flow

```
User clicks app in Hub dashboard
        │
        ▼
Hub checks first-time access gate
  ├── [First access ever] → send verification email → 403 APP_VERIFICATION_REQUIRED
  │         User clicks email link → /verify-app-login → access unlocked
  │         User returns to Hub and clicks app again ───────────────────┐
  │                                                                     │
  └── [Already verified] ──────────────────────────────────────────────┘
        │
        ▼
Hub mints short-lived JWT, wraps it in a signed ref
        │
        ▼
Hub redirects user to /api/sso/bridge?ref=...
        │
        ▼
Bridge page auto-POSTs HTML form  →  POST /auth/hub  →  Your App
                                      body: token=<JWT>
        │
        ▼
Your app verifies JWT, maps user by email, creates local session, redirects to dashboard
```

> **Important:** The first-time access gate runs entirely on the Hub side. Your app does **not** need to implement it. Once a user has verified their first access to your app, subsequent logins go directly to the bridge step.

---

## 1) What Hub Sends to Your App

### Delivery contract (must match exactly)

| Field | Value |
|---|---|
| HTTP method | `POST` |
| Content-Type | `application/x-www-form-urlencoded` |
| Body field | `token` |
| URL | Your configured `target_url` in Hub Admin |

**URL resolution rule:** If your `target_url` does **not** already contain `/auth/`, the Hub automatically appends `/auth/hub`.

| target_url configured in Hub Admin | Actual POST destination |
|---|---|
| `https://myapp.example.com` | `https://myapp.example.com/auth/hub` |
| `https://myapp.example.com/auth/hub` | `https://myapp.example.com/auth/hub` (unchanged) |
| `http://localhost:5173` | `http://localhost:5173/auth/hub` |

---

## 2) JWT Contract

The Hub signs the token using:

- **Algorithm:** `HS256`
- **Secret:** `SSO_TOKEN_SECRET` — a shared secret set in Hub's environment
- **Expiry:** `SSO_TOKEN_EXPIRY_SECONDS` (default: `60` seconds)
- **Library used by Hub:** [`jose`](https://github.com/panva/jose) — secret is encoded as **UTF-8 bytes**

### Payload claims

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@company.com",
  "iat": 1713345000,
  "exp": 1713345060
}
```

| Claim | Type | Description |
|---|---|---|
| `user_id` | string (UUID) | Hub user's stable ID. Use for cross-system identity mapping. |
| `email` | string (lowercase) | User's email address. Recommended lookup key in your app. |
| `iat` | number | Issued-at Unix timestamp (seconds). |
| `exp` | number | Expiry Unix timestamp (seconds). Always enforce this. |

### Minimum verification requirements in your app

1. Verify the JWT **signature** using the shared `SSO_TOKEN_SECRET` and `HS256`
2. Reject if `exp` is in the past
3. Reject if `email` or `user_id` is missing from the payload

---

## 3) What Your App Must Implement

Expose a single endpoint — `POST /auth/hub` — that does the following:

1. Read the `token` field from the POST body (`application/x-www-form-urlencoded`)
2. Verify the JWT (HS256, shared secret, enforce expiry)
3. Extract `email` and `user_id` from the payload
4. Look up the user in your local database by `email` (case-insensitive)
5. Optionally create the user if they don't exist (see Section 5)
6. Create a local session / cookie / JWT for your app
7. Redirect the user to your app's dashboard or home page

---

## 4) Node.js Reference Handler (jose — matches Hub's library)

```js
// CommonJS example (matches Hub's own implementation)
const express = require('express');
const { jwtVerify } = require('jose');

const router = express.Router();
const SSO_SECRET = process.env.SSO_TOKEN_SECRET;
const APP_PUBLIC_ORIGIN = process.env.APP_PUBLIC_ORIGIN || 'http://localhost:3000';

router.post('/auth/hub', express.urlencoded({ extended: false }), async (req, res) => {
  const tokenString = req.body?.token;
  if (!tokenString) return res.status(400).send('Missing token');
  if (!SSO_SECRET) return res.status(503).send('SSO not configured');

  let payload;
  try {
    const secret = new TextEncoder().encode(SSO_SECRET);
    const result = await jwtVerify(tokenString, secret, { algorithms: ['HS256'] });
    payload = result.payload;
  } catch {
    return res.status(401).send('Invalid or expired token');
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !payload.user_id) {
    return res.status(400).send('Invalid token payload');
  }

  // 1) Find user by email (case-insensitive)
  // const user = await db.users.findByEmail(email);

  // 2) If not found: return 403 (invite-only) or create JIT user (see Section 5)
  // if (!user) return res.status(403).send('Access not provisioned');

  // 3) Create local session / set cookie
  // await createSession(res, user.id);

  return res.redirect(302, `${APP_PUBLIC_ORIGIN}/`);
});
```

> **Note:** `jose` encodes the secret as UTF-8 bytes (`new TextEncoder().encode(...)`). This matches exactly how the Hub signs the token. Do not base64-decode the secret.

---

## 5) Reference Handlers — Other Languages

All examples use the same contract: **HS256**, shared secret as **UTF-8 bytes**.

### Python (PyJWT)

```python
import jwt  # pip install PyJWT
import os

SSO_SECRET = os.environ["SSO_TOKEN_SECRET"]

def handle_hub_post(request):
    token = request.form.get("token")
    if not token:
        return error_response(400, "Missing token")
    try:
        payload = jwt.decode(token, SSO_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return error_response(401, "Token expired")
    except jwt.InvalidTokenError:
        return error_response(401, "Invalid token")

    email = payload.get("email", "").strip().lower()
    user_id = payload.get("user_id")
    if not email or not user_id:
        return error_response(400, "Invalid payload")

    # find/create user, create session, redirect
```

### Java (jjwt)

```java
import io.jsonwebtoken.Jwts;
import java.nio.charset.StandardCharsets;

byte[] keyBytes = System.getenv("SSO_TOKEN_SECRET").getBytes(StandardCharsets.UTF_8);
SecretKey key = Keys.hmacShaKeyFor(keyBytes);

Claims claims = Jwts.parserBuilder()
    .setSigningKey(key)
    .build()
    .parseClaimsJws(token)
    .getBody();

String email = claims.get("email", String.class).trim().toLowerCase();
String userId = claims.get("user_id", String.class);
```

### .NET

```csharp
var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("SSO_TOKEN_SECRET")));
var handler = new JwtSecurityTokenHandler();
var validationParams = new TokenValidationParameters {
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = key,
    ValidateIssuer = false,
    ValidateAudience = false,
    ValidateLifetime = true,
    ClockSkew = TimeSpan.Zero
};
var principal = handler.ValidateToken(token, validationParams, out _);
var email = principal.FindFirst("email")?.Value?.Trim().ToLower();
var userId = principal.FindFirst("user_id")?.Value;
```

---

## 6) Local Login + SSO Coexistence

SSO must be additive only — it **must not** break existing local login:

- Keep your existing username/password login unchanged
- Do not overwrite an existing password hash on SSO login
- Existing local users should still be able to log in directly
- SSO login is an **additional entry path**, not a replacement

---

## 7) User Mapping Policy

Choose one policy and document it clearly for your app.

### Option A: Invite-only (recommended default)

```
Email found in local DB  →  allow SSO, create session
Email not found          →  return 403, friendly error message
```

### Option B: JIT (Just-In-Time) user creation

```
Email found  →  allow SSO
Email not found  →  create user automatically with:
  - random password hash (never expose a plain-text password)
  - default role and minimum permissions
  - flag account as "SSO-provisioned"
```

---

## 8) Reverse Proxy / Dev Server Note

If your frontend runs on a different port than your backend:

- Set Hub `target_url` to your **frontend** origin (e.g. `http://localhost:5173`)
- Add a dev proxy for `/auth` to your backend

**Vite example:**

```js
// vite.config.js
server: {
  proxy: {
    '/auth': {
      target: 'http://localhost:3000',
      changeOrigin: true
    }
  }
}
```

Without this proxy you will see: `Cannot POST /auth/hub`

In production, your reverse proxy (Nginx, etc.) should route `/auth` to your backend service.

---

## 9) Hub Admin Setup Checklist (per app)

In Downstream Hub → Admin → Applications:

1. **Name** — your app's display name (shown to users in the dashboard)
2. **Target URL** — the base URL of your app:
   - Single-host backend: `http://localhost:3000`
   - Frontend with proxy: `http://localhost:5173`
   - Production: `https://myapp.example.com`
3. Save, then click the app from the dashboard to test the full flow

> The Hub will automatically append `/auth/hub` to your target URL unless it already contains `/auth/`.

---

## 10) Environment Checklist

### Hub side (set by Hub operator)

| Variable | Description |
|---|---|
| `SSO_TOKEN_SECRET` | Shared secret for signing/verifying JWTs. Must match target app. |
| `SSO_TOKEN_EXPIRY_SECONDS` | JWT lifetime in seconds. Default: `60`. |
| `API_PUBLIC_URL` | Public URL of the Hub API (used to build the bridge redirect URL). |
| `PUBLIC_APP_URL` | Public URL of the Hub SPA (used in verification emails). |
| `APP_FIRST_LOGIN_MAGIC_TTL_MINUTES` | How long the first-access verification email link is valid. Default: `20`. |

### Target app side (set by your team)

| Variable | Description |
|---|---|
| `SSO_TOKEN_SECRET` | **Must be the exact same value** as on the Hub. Obtain securely from the Hub operator. |
| `APP_PUBLIC_ORIGIN` | Where to redirect after successful SSO (e.g. `https://myapp.example.com`). |

> **Security note:** `SSO_TOKEN_SECRET` must be shared out-of-band (secure channel, secrets manager). Never put it in version control, email, or public URLs. In production, generate a strong secret: `openssl rand -base64 32`

---

## 11) Quick Validation Commands

Use before full UI testing to confirm your endpoint is reachable:

```bash
# Should return 400 or 401 — NOT 404
curl -i -X POST "http://localhost:3000/auth/hub" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "token=fake"

# If using a Vite proxy — same expected result via frontend port
curl -i -X POST "http://localhost:5173/auth/hub" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "token=fake"
```

A `404` means the route is missing or the proxy is not set up. A `400`/`401` means the route exists and is working correctly.

---

## 12) Common Failures and Fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot POST /auth/hub` | Route missing in backend, or old process still running, or dev proxy not configured/restarted | Add `POST /auth/hub` route; restart backend; add Vite/Nginx `/auth` proxy |
| `Invalid or expired token` | Secret mismatch, or token TTL already elapsed by the time your app verifies | Confirm `SSO_TOKEN_SECRET` is identical on both sides; reduce processing time; increase `SSO_TOKEN_EXPIRY_SECONDS` if needed |
| SSO reaches app but user gets no session | User mapping failed (email not found), or session creation logic not reached | Log `email` from payload; check your DB lookup; trace session creation |
| User never arrives (stuck on Hub) | First-time access verification email not clicked | This is the App First Login gate. User must click the verification email once per app. After that, SSO proceeds normally. |
| Bridge page shows error | `ref` JWT expired (> 1 minute between redirect and bridge load) | Unlikely in practice; check for very slow networks or user delays |

---

## 13) Security Checklist (Target App)

- [ ] `SSO_TOKEN_SECRET` obtained securely; stored in env or secrets manager, never in code
- [ ] JWT signature verified before trusting any claim
- [ ] `exp` enforced — tokens past expiry are rejected
- [ ] HTTPS used for the `/auth/hub` endpoint in staging and production
- [ ] Raw token string is never logged
- [ ] `email` lookup is case-insensitive
- [ ] Local login still works independently of SSO

---

## 14) Cursor Handoff Prompt (Copy/Paste into Target App)

```text
Implement Downstream Hub SSO consumer endpoint for this app.

Requirements:
1) Add POST /auth/hub that accepts application/x-www-form-urlencoded with body field "token".
2) Verify the JWT using HS256 and env var SSO_TOKEN_SECRET. The secret is used as raw UTF-8 bytes (no base64/hex decoding). Use the jose library if Node.js: const { jwtVerify } = require('jose'); const secret = new TextEncoder().encode(SSO_TOKEN_SECRET);
3) Require payload fields user_id (UUID) and email (string). Reject if either is missing.
4) Enforce token expiry (exp claim). Reject expired tokens.
5) Look up the local user by email (case-insensitive). Keep all existing local login logic unchanged.
6) User mapping policy: invite-only by default — if email is not found, return 403 with a friendly message.
7) On success, create a local session/cookie for the user and redirect to APP_PUBLIC_ORIGIN + "/".
8) Do not log the raw token string or the secret.
9) If the frontend runs on a separate dev port, add a /auth proxy to the backend in the dev server config.
10) Add env var documentation: SSO_TOKEN_SECRET (required, shared with Hub) and APP_PUBLIC_ORIGIN (redirect destination).
```
