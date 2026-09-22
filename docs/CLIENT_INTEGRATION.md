# DHM Client App Integration Guide

**Audience:** engineers on a consuming application (TOS, Jetty, KLIP, ERP, or similar)  
**Owner:** Data Hub Management (DHM)  
**Contract:** `GET {DHM_API}/openapi.json` (local: `http://localhost:4100/openapi.json`)  
**Version:** 1.0

DHM is the **canonical master-data hub**. Client apps are not the source of truth for shared masters. You post raw payloads, DHM inspects and deduplicates them into golden records, then you look up, sync, and receive change webhooks.

---

## Contents

1. [Choose an integration pattern](#1-choose-an-integration-pattern)
2. [Onboard the application](#2-onboard-the-application)
3. [Configure the client](#3-configure-the-client)
4. [Authenticate](#4-authenticate)
5. [Discover what you can create and get](#5-discover-what-you-can-create-and-get)
6. [Snapshot and incremental sync](#6-snapshot-and-incremental-sync)
7. [Lookup by code](#7-lookup-by-code)
8. [Create a master (inbound POST)](#8-create-a-master-inbound-post)
9. [Update when DHM is outdated (inbound PUT)](#9-update-when-dhm-is-outdated-inbound-put)
10. [Webhooks](#10-webhooks)
11. [Error contract](#11-error-contract)
12. [Worked examples](#12-worked-examples)
13. [Go-live checklist](#13-go-live-checklist)
14. [Field appendix](#14-field-appendix)

---

## 1. Choose an integration pattern

Most apps implement **A + C**. Jetty processing KLIP traffic is usually **B only**.

| Pattern | When | APIs |
| --- | --- | --- |
| **Discover** | Learn which masters this app may create and get | `GET /v1/catalog` |
| **A. Master owner** | Users create or edit masters in *your* UI | `POST /v1/inbound/{entity}` then, if the user says DHM is stale, `PUT /v1/inbound/{entity}/{code}` |
| **B. Lookup fallback** | You only need to resolve a master code. Do **not** insert. | `GET /v1/lookup/{entity}/{code}` |
| **C. Local replica** | Dropdowns, validations, and transactions against a local copy | `GET /v1/sync/{entity}` (snapshot + poll) and webhooks |

Do **not** use `POST /v1/ingest/{entity}` for new work. That path is last-write-wins and overwrites a golden record without a user prompt.

---

## 2. Onboard the application

A DHM System Integrator registers the app in the portal (`/integrations`). Client apps cannot self-register.

1. Create an **Application** (name + slug, e.g. `tos`).
2. Allowlist the **entity types** this app may call. A `403` means the slug is not assigned.
3. Copy credentials **once**:
   - Public key (`dhm_pk_…`) — the application's identifier; safe to log
   - Private key (`dhm_sk_…`) — vault only; never in the browser or git

   The key pair is the **only** credential set. If the private key leaks, the Integrator rotates the pair and you replace both values.
4. Register a **webhook URL** for `record.created`, `record.updated`, `record.deleted`. Store the HMAC secret. The URL must pass the standard below or registration is rejected with a `400`:
   - `https://` required; plain `http://` is accepted only for localhost testing (`localhost`, `127.0.0.1`, `[::1]`, `host.docker.internal`)
   - no embedded credentials (`user:pass@`) — authentication is the HMAC signature's job
   - no `#fragment`; max 2048 characters

Local demo (reset on every seed):

| Item | Value |
| --- | --- |
| API | `http://localhost:4100` |
| Portal | `http://localhost:2000` |
| Public key | `dhm_pk_tos_demo_public` |
| Private key | `dhm_sk_tos_demo_private_keep_secret` |

Health (no auth): `GET /health` → `{ "status": "ok", "service": "dhm-api" }`.

---

## 3. Configure the client

Keep credentials **server-side**. A SPA must proxy DHM through your backend.

```env
DHM_BASE_URL=https://dhm.example.com
DHM_PUBLIC_KEY=dhm_pk_...
DHM_PRIVATE_KEY=dhm_sk_...
DHM_WEBHOOK_SECRET=...
```

Canonical hub field names are required. DHM does not translate aliases. Map your columns in the client adapter (`your_vessel_name` → `Vessel_Name`). JSON body limit is **1 MB**.

Suggested module layout:

```
your-app/
  dhm/
    client.ts      # base URL, auth, retries
    catalog.ts     # GET /v1/catalog → required / unique fields
    mapper.ts      # your DTO ↔ hub keys
    sync.ts        # snapshot + cursor
    inbound.ts     # POST/PUT + 201/200/409
    lookup.ts      # GET lookup
    webhook.ts     # HMAC + deliveryId dedupe
```

Local store (per entity you use): DHM `id`, DHM-assigned `code`, `version`, `updated_at`, `is_deleted`, payload, last sync cursor.

---

## 4. Authenticate

Every `/v1` call needs application credentials — the **public/private key pair**, used one of two ways per request.

### A. Key pair headers (batch jobs)

```http
X-DHM-Public-Key: dhm_pk_...
X-DHM-Private-Key: dhm_sk_...
```

### B. Bearer token from the key pair

```http
POST /auth/token
Content-Type: application/json

{"publicKey":"dhm_pk_...","privateKey":"dhm_sk_..."}
```

Response:

```json
{
  "token": "<jwt>",
  "expiresIn": "8h",
  "application": { "id": "...", "slug": "tos", "entityTypeIds": ["..."] }
}
```

Then: `Authorization: Bearer <jwt>`.

Rules:

- Application tokens **cannot** call portal routes.
- Portal login tokens (`POST /auth/login`) **cannot** call `/v1`.
- Default TTL is **8 hours**. Cache and refresh before expiry.

After you have a token (or key pair), call **`GET /v1/catalog`** before hard-coding slugs. It is the live list of masters *this application* may create and get.

---

## 5. Discover what you can create and get

Do not assume the full hub catalog. Ask DHM which types are on **your** allowlist.

```http
GET /v1/catalog
Authorization: Bearer <jwt>
```

Key pair headers work the same way:

```bash
curl -s "$DHM/v1/catalog" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY"
```

Verified against the local demo TOS app (`count` is 13 when every hub type is assigned):

```json
{
  "application": { "slug": "tos", "name": "TOS" },
  "count": 13,
  "entities": [
    {
      "slug": "organization",
      "name": "Organization",
      "description": "Operating company that owns one or more sites and ports",
      "identityKey": "code",
      "displayNameKey": "name",
      "operations": { "read": true, "create": true, "update": true },
      "endpoints": {
        "sync": "/v1/sync/organization",
        "lookup": "/v1/lookup/organization/{code}",
        "inboundCreate": "/v1/inbound/organization",
        "inboundUpdate": "/v1/inbound/organization/{code}"
      },
      "fields": [
        { "key": "code", "name": "Code", "dataType": "STRING", "required": true, "unique": true },
        { "key": "name", "name": "Name", "dataType": "STRING", "required": true, "unique": false },
        { "key": "country", "name": "Country", "dataType": "STRING", "required": false, "unique": false },
        { "key": "is_active", "name": "Active", "dataType": "BOOLEAN", "required": false, "unique": false }
      ],
      "hasMany": [
        { "slug": "site", "foreignKey": "organization_id", "name": "Sites" }
      ]
    }
  ]
}
```

The live `entities` array has `count` items (`organization` through `vessel` for the demo TOS app). The block above is truncated to one type.

One type:

```http
GET /v1/catalog/organization
GET /v1/catalog/vessel
```

`GET /v1/catalog/{entity}` returns that entity object only (no `application` wrapper).

| HTTP | Meaning |
| --- | --- |
| `200` | Allowlisted types (list) or one type |
| `401` | `{ "error": "Application credentials required" }` (or invalid token/keys) |
| `403` | `{ "error": "Application is not permitted to call '{slug}'" }` — slug exists, not on this app |
| `400` | `{ "error": "Unknown master type '…'", "masterType": "…" }` — not a hub slug |

Notes:

- Assigned types currently grant **read, create, and update together**. If an app should only look up, do not allowlist types it must not create.
- `identityKey` is **`code`** for every entity, including vessel. Vessel `displayNameKey` is `Vessel_Name`.
- `code` is **assigned by DHM** as `{codePrefix}-NNNN` (organization `ORG-0001`, site `SITE-0001`, vessel `VSL-0001`, …). Omit it on create. `systemGenerated: true` on the catalog field.
- `referenceSlug` and `enumValues` appear only when set (for example vessel `Vessel_Type`: `barge`, `tanker`, `SPOB`).
- Cache the catalog at startup; it changes when the Integrator edits the allowlist, not on every record write.

Call only slugs returned by this API. Unique lookup key for every entity, including vessel, is **`code`** (DHM-assigned). Snapshot of the coded hub (all types; your app may see a subset):

| Slug | Unique key | Required on create | Notes |
| --- | --- | --- | --- |
| `organization` | `code` (ORG-NNNN) | `name` | Parent of Site |
| `site` | `code` (SITE-NNNN) | `name`, `organization_id` | Parent by UUID **or** org `code` |
| `port_master` | `code` (PORT-NNNN) | `name`, `site_id` | |
| `jetty` | `code` (JTY-NNNN) | `name`, `port_master_id` | Berth master, not the Jetty *application* |
| `incoterm` | `code` (INC-NNNN) | `name` | |
| `shipper` | `code` (SHP-NNNN) | `name` | Optional `country`, `email` |
| `forwarder` | `code` (FWD-NNNN) | `name` | Optional `country`, `email` |
| `loading_port` | `code` (LP-NNNN) | `name`, `port_master_id` | |
| `surveyor` | `code` (SVY-NNNN) | `name` | Optional `country`, `email` |
| `agent` | `code` (AGT-NNNN) | `name` | Optional `country`, `email` |
| `commodity` | `code` (CMD-NNNN) | `name` | Optional `hs_code`, `uom` |
| `freight_terms` | `code` (FRT-NNNN) | `name` | |
| `vessel` | `code` (VSL-NNNN) | `Vessel_Name` | `Vessel_Name` is also unique. Also matches on IMO / MMSI. No `name` / `is_active`. |

Create parents first:

`organization` → `site` → `port_master` → `jetty` / `loading_port`

REFERENCE fields accept a live parent **UUID** or the parent **`code`**. DHM stores the UUID. Unknown JSON keys are rejected (`400` + `unknownKeys`). Full field lists are in the [appendix](#14-field-appendix).

---

## 6. Snapshot and incremental sync

Do this once per assigned entity before go-live.

```http
GET /v1/sync/organization?limit=100
GET /v1/sync/organization?cursor=<nextCursor>
GET /v1/sync/organization/{id}
```

1. Page with `limit` (default 100, max 500).
2. Persist each `records[]` item by `id` and by `code`.
3. Follow `nextCursor` until `hasMore` is false.
4. Save the last cursor and newest `updatedAt`.

Record shape:

```json
{
  "id": "uuid",
  "version": 1,
  "isDeleted": false,
  "data": { "code": "ORG-0001", "name": "…", "country": "SG", "is_active": true },
  "updatedAt": "2026-09-15T02:00:00.000Z"
}
```

Ongoing pull: `?updatedSince=2026-09-15T02:00:00.000Z` or keep the saved `cursor`. If both are sent, `cursor` wins. Pages are ordered by (`updatedAt`, `id`) ascending. Use `includeDeleted=true` only if you need tombstones.

---

## 7. Lookup by code

Read-only. Does **not** write inbound staging.

```http
GET /v1/lookup/organization/ORG-0001
GET /v1/lookup/vessel/VSL-0001
```

| HTTP | Meaning | Client action |
| --- | --- | --- |
| `200` | Golden record | Use `data` / `code` and continue |
| `404` `{ "error": "data not found" }` | Missing or soft-deleted | Fail the transaction. Do **not** auto-insert. |

Jetty / KLIP: check the local store first; call DHM only if the code is unknown locally.

---

## 8. Create a master (inbound POST)

Every POST lands a row in `raw_master_inbound` even if inspection later rejects it.

```http
POST /v1/inbound/organization
Content-Type: application/json
X-DHM-Public-Key: ...
X-DHM-Private-Key: ...

{
  "name": "Exim Operations Jakarta",
  "country": "ID",
  "is_active": true
}
```

Optional envelope keys (stripped before validation): `source_app`, `master_type`. If you send `master_type`, it must match the URL slug.

Inspection **does not take a client-invented code**. Omit `code` on create. DHM assigns `{codePrefix}-NNNN` and returns it. If you send a `code` that already exists in the hub, that record is matched (duplicate / update). If you send a `code` that does not exist, the request is rejected (`400`). For vessel, `Vessel_Name` must also be unique. Vessel also matches on IMO / MMSI.

| HTTP | `status` | Meaning | Client action |
| --- | --- | --- | --- |
| `201` | `created` | New golden record | Store the returned `code` + `record`. Continue. |
| `200` | `updated` | Same `code`, fields changed | Hub was updated. Sync `record` locally. |
| `409` | `duplicate` | Same `code`, same data | Show existing `record`. Do not create a second local row. If the user says DHM is stale, `PUT`. |
| `400` | — | Schema, unknown field, dead REFERENCE, or unique name clash | Fix the payload. Staging row is `REJECTED`. |
| `403` | — | Slug not allowlisted | Stop. Ask the Integrator. |

`201` body:

```json
{
  "status": "created",
  "code": "ORG-0001",
  "inboundId": "uuid",
  "record": { "id": "…", "version": 1, "isDeleted": false, "data": { }, "updatedAt": "…" }
}
```

`409` includes `record` and `inboundId`. Do not retry the same POST in a loop.

**Transaction upload:** check your local replica first. If the master is missing, POST inbound, handle the table above, then continue the *business* transaction in your app. DHM only owns the master.

On network timeout after POST, you may not have received the assigned code. Do **not** invent one. Check sync / local replica by name (or unique fields), or POST again and handle `409` if inspection matches the existing row.

---

## 9. Update when DHM is outdated (inbound PUT)

Use this after a `409` when the user confirms local data is newer.

```http
PUT /v1/inbound/organization/ORG-0001
Content-Type: application/json

{
  "code": "ORG-0001",
  "name": "Exim Operations Jakarta (updated)",
  "country": "ID",
  "is_active": true
}
```

The URL `{code}` must equal the body `code`.

| HTTP | `status` | Meaning |
| --- | --- | --- |
| `200` | `updated` | Golden record rewritten; webhook `record.updated` |
| `200` | `unchanged` | Payload already matches DHM |
| `404` | — | `data not found` — create with POST |
| `400` | — | Validation failed |

---

## 10. Webhooks

DHM is the active side: its dispatcher POSTs JSON to your URL within ~2 seconds of the record change committing. Your endpoint just listens. Timeout is **3 seconds**. Return **2xx** immediately; process asynchronously.

**URL standard** (enforced at registration): `https://` required — plain `http://` only for localhost testing (`localhost`, `127.0.0.1`, `[::1]`, `host.docker.internal`); no `user:pass@` credentials; no `#fragment`; max 2048 characters. Your endpoint must be reachable *from the DHM server* — if it sits behind a firewall with no inbound access, rely on `/v1/sync` polling instead.

| Header | Purpose |
| --- | --- |
| `X-DHM-Signature` | `sha256=<hex HMAC of the raw body>` |
| `X-DHM-Event` | `record.created` \| `record.updated` \| `record.deleted` |
| `X-DHM-Event-Id` | Outbox / event id |
| `X-DHM-Delivery-Id` | Delivery id — **stable on replay**. Dedupe on this. |

```json
{
  "event": "record.updated",
  "occurredAt": "2026-09-15T02:11:00.000Z",
  "eventId": "uuid",
  "deliveryId": "uuid",
  "entityType": "organization",
  "recordId": "uuid",
  "version": 2,
  "data": { "code": "ORG-0001", "name": "…" },
  "sourceApplication": "tos"
}
```

Verify HMAC on the **raw bytes** (do not re-serialize JSON):

```js
const expected = "sha256=" + crypto
  .createHmac("sha256", process.env.DHM_WEBHOOK_SECRET)
  .update(rawBody)
  .digest("hex");
```

Failed deliveries retry with backoff up to **8** attempts. Portal replay keeps the same `deliveryId`. Apply `record.deleted` as a local tombstone (`isDeleted = true`).

---

## 11. Error contract

Every error is JSON: `{ "error": "<message>", ...extra }`.

| Status | Typical `error` | Extra |
| --- | --- | --- |
| 400 | `Unknown master type '…'` | `masterType` (catalog / inbound slug) |
| 400 | `Schema validation failed` | `details: string[]` |
| 400 | `Unknown fields in record data` | `unknownKeys` |
| 400 | `Invalid {field}: no live {slug} matched` | `field`, `value` |
| 400 | `Unique field Vessel_Name already exists` | `field`, `recordId` |
| 401 | `Application credentials required` / `Invalid token` | — |
| 403 | `Application is not permitted to call '{slug}'` | — |
| 404 | `data not found` / `Record not found` | — |
| 409 | `Master already exists` | `status`, `inboundId`, `matchKey`, `record` |

---

## 12. Worked examples

Assume `$DHM=http://localhost:4100` and the demo TOS keys.

### Catalog (what this app may create and get)

```bash
curl -s "$DHM/v1/catalog" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY"

curl -s "$DHM/v1/catalog/organization" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY"
```

### Organization

```bash
curl -s -X POST "$DHM/v1/inbound/organization" \
  -H "Content-Type: application/json" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY" \
  -d '{"name":"Exim Operations Jakarta","country":"ID","is_active":true}'
```

### Site (parent by code)

```bash
curl -s -X POST "$DHM/v1/inbound/site" \
  -H "Content-Type: application/json" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY" \
  -d '{"name":"Jakarta Terminal","organization_id":"ORG-0001","address":"Tanjung Priok"}'
```

### Vessel

Lookup key is `code`. `Vessel_Name` is also unique.

```bash
curl -s -X POST "$DHM/v1/inbound/vessel" \
  -H "Content-Type: application/json" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY" \
  -d '{"Vessel_Name":"MARINA BAY III","Vessel_IMO":"9123456","Vessel_Type":"tanker"}'
```

```http
GET  /v1/lookup/vessel/VSL-0001
PUT  /v1/inbound/vessel/VSL-0001
```

A second POST with the same `Vessel_Name` is rejected. A second POST with the same IMO is treated as an update of the existing vessel.

### Lookup and sync

```bash
curl -s "$DHM/v1/lookup/organization/ORG-0001" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY"

curl -s "$DHM/v1/sync/organization?limit=100" \
  -H "X-DHM-Public-Key: $DHM_PUBLIC_KEY" \
  -H "X-DHM-Private-Key: $DHM_PRIVATE_KEY"
```

---

## 13. Go-live checklist

- [ ] Application registered; only needed slugs allowlisted
- [ ] Private key and webhook secret in a vault, not in the SPA
- [ ] Webhook URL meets the standard (HTTPS, no credentials, no fragment) and is reachable from DHM
- [ ] `GET {DHM_API}/health` reachable from the client network
- [ ] `GET /v1/catalog` returns the expected slugs and field keys
- [ ] Snapshot sync completed for every assigned entity
- [ ] Incremental poll **and/or** webhooks in production (prefer both)
- [ ] Webhook HMAC verified on the raw body; `deliveryId` deduped
- [ ] Create path handles `201` / `200` / `409` without duplicate local rows
- [ ] Parents created before children; REFERENCE accepts UUID or code
- [ ] Vessel omits `code` on create and sends unique `Vessel_Name`
- [ ] Lookup `404` fails the transaction; it does not auto-insert
- [ ] Legacy `/v1/ingest` is not used
- [ ] Client timeouts ~10s for inbound/sync; webhook handler returns in under 3s

**Support**

| Role | Where |
| --- | --- |
| Client engineers | This document + `GET /v1/catalog` + `GET /openapi.json` |
| DHM System Integrator | Portal `/integrations` (keys, allowlist, webhooks, replay) |
| DHM Data Engineer | Portal `/inbound` (`RECEIVED`, `ACCEPTED`, `DUPLICATE`, `REJECTED`) |
| Data Steward | Portal `/hub/{slug}` |

---

## 14. Field appendix

Types: `STRING`, `NUMBER`, `BOOLEAN`, `ENUM`, `REFERENCE`. Empty optional fields may be omitted. `is_active` defaults to true when omitted on masters that have it.

Prefer **`GET /v1/catalog`** (or `GET /v1/catalog/{slug}`) over this appendix when mapping fields — the API is scoped to your allowlist and includes `enumValues`.

### organization

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `country` | STRING | | |
| `is_active` | BOOLEAN | | |

### site

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `organization_id` | REFERENCE → `organization` | yes | |
| `address` | STRING | | |
| `is_active` | BOOLEAN | | |

### port_master

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `site_id` | REFERENCE → `site` | yes | |
| `unlocode` | STRING | | |
| `country` | STRING | | |
| `is_active` | BOOLEAN | | |

### jetty

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `port_master_id` | REFERENCE → `port_master` | yes | |
| `max_loa` | NUMBER | | |
| `is_active` | BOOLEAN | | |

### incoterm / freight_terms

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `description` | STRING | | |
| `is_active` | BOOLEAN | | |

### shipper / forwarder / surveyor / agent

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `country` | STRING | | |
| `email` | STRING | | |
| `is_active` | BOOLEAN | | |

### loading_port

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `port_master_id` | REFERENCE → `port_master` | yes | |
| `is_active` | BOOLEAN | | |

### commodity

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes |
| `name` | STRING | yes | |
| `hs_code` | STRING | | |
| `uom` | STRING | | |
| `is_active` | BOOLEAN | | |

### vessel

| Key | Type | Required | Unique |
| --- | --- | --- | --- |
| `code` | STRING | assigned by DHM | yes (lookup / PUT / inbound identity) |
| `Vessel_Name` | STRING | yes | yes |
| `Vessel_IMO` | STRING | | unique when present |
| `Vessel_MMSI` | STRING | | unique when present |
| `Vessel_Code_SAP` | STRING | | |
| `Vessel_Capacity_MT` | NUMBER | | |
| `Vessel_Gross_Tonnage` | NUMBER | | |
| `Vessel_Draft` | NUMBER | | |
| `Vessel_Length_Overral` | STRING | | |
| `Vessel_Type` | ENUM `barge` \| `tanker` \| `SPOB` | | |
| `Heater` | BOOLEAN | | |
| `Type_lambung` | ENUM `Double hull Double Bottom` \| `Single hull Double Bottom` \| `Single hull Single Bottom` | | |
| `Type_Charter` | ENUM `Voyage Charter` \| `Time Charter` | | |
