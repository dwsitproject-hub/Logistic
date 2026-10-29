# Partner integrations — Admin guide (API keys & webhooks)

**Audience:** JPS administrators with **Admin** page permission.

**Related:** Partner self-service contract — [INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md) (v5.6). TECH-SPEC **§0.37**, **§0.42**, **§0.43**, **§0.44** (monitoring).

---

## Where to open it

**Admin → Partner integrations** (`/admin/partner-api`).

Layout:

1. **Partners (left)** — select a registered integration key (EOS, KLIP, etc.). A red **failed** badge means that partner had failed webhook deliveries in the last 24 hours.
2. **Health (right, top)** — last 24 hours for the selected partner: API calls, API errors (4xx / 5xx), webhooks sent / failed / pending, and the last API call and last webhook sent. A warning shows when the partner has **no active webhook**.
3. **Credentials** — masked key prefix, active/revoked, last used, **Revoke key**.
4. **Webhooks** — outbound URLs JPS POSTs to when plans are approved, berthing milestones change, or KLIP **Hose On/Off** window changes (**`schedule.updated`**, v5.5 **`cargo_ops_start_at`** / **`cargo_ops_end_at`**).
5. **Activity** — webhook delivery log and inbound API request log (see below).

Partners can register the same webhooks via **`POST /api/v1/integrations/webhooks`** with their **`x-api-key`**. Admin UI is for onboarding and support when the partner cannot call the API.

---

## Register a webhook (admin)

1. Select the partner key.
2. **Add webhook**.
3. Enter **HTTP or HTTPS URL** (internal apps often use plain HTTP).
4. Choose events: **All events (`*`)**, **`status.changed`**, and/or **`schedule.updated`**.
5. Copy the **webhook secret** when shown — it is displayed **once** (HMAC verification on the partner side).

Limits: **3 active** endpoints per API key (same as partner API).

---

## Activity (webhook log and API log)

The **Activity** card has two tabs. **Scope** switches between **This partner** and **All partners**. Pick a time window (1h, 24h, 7d, 30d), filter by status or result, search, and optionally turn on **Auto-refresh (30 s)**. Rows are newest first; use **Load more** for older rows. Click the arrow on a row for details.

The **Activity** link on a webhook row opens the **Webhook deliveries** tab filtered to that URL.

### Webhook deliveries

| Column | Meaning |
|--------|---------|
| Time | When it was sent, or when it was queued if not yet sent |
| Event | `status.changed` or `schedule.updated` |
| Reference | Partner `external_reference` (the KLIP Operation ID) |
| Endpoint | Host of the partner URL |
| Status | `pending`, `sent`, or `failed`. A failed row shows the last error. A pending row older than 2 minutes is highlighted. |
| HTTP / time | HTTP status the partner returned and how long the call took (empty for timeouts and connection errors, and for deliveries made before this feature) |
| Tries | Attempt count |
| Expanded row | Delivery ID (`X-JPS-Delivery-Id` on the partner request), endpoint URL, and the JSON payload sent |

**Retry** on a **failed** row re-queues it for the in-process webhook worker.

### API requests

One row per partner API call, including rejected calls (bad key, 4xx, 5xx, rate limited) and polling GETs.

| Column | Meaning |
|--------|---------|
| Time, Partner | When, and which key (unknown keys show the key prefix only) |
| Method, Route | For example `PATCH /shipping-instructions/:id` |
| Result | HTTP status and duration |
| Error code | Partner API error code, for example `INVALID_API_KEY` or `RATE_LIMITED` |
| Reference | `external_reference` when the call carried one |
| Expanded row | Request ID (matches `request_id` in error responses), full path, client IP, key prefix |

JPS does not store headers, API keys, or request and response bodies. API log rows are kept **30 days** (`INTEGRATION_API_LOG_RETENTION_DAYS` on the API server). Webhook delivery rows are not purged.

### Reading the log

- A shipment shows **Allocated** in KLIP but the webhook log is empty: check **Health**. If it says no active webhook, KLIP is seeing the status by polling; look for `GET /shipping-instructions` rows in **API requests**.
- A webhook row stays `failed`: read the error and HTTP status, fix the partner URL, then **Retry**.
- The partner says an API call failed: search **API requests** by the Request ID from their error response.

---

## Document links (v5.1)

Partners may send HTTPS links on submit:

- `shipping_instruction_document_url`
- `contract_document_url`
- `bl_document_url`

JPS stores URLs on the shipping instruction; operators see **Partner document links** in the SI detail modal (read-only). JPS does not download or mirror partner files.

---

## Operating company (v5.6)

Partners send **`company_hub_code`** on submit (required when that port has more than one mapped company). JPS stores it on the shipping instruction. GET and webhook payloads echo **`company_hub_code`** and **`company_name`**. This is the operating company, not the cargo-line shipper.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Deliveries stuck `pending` | API process running; webhook worker started in `Backend/src/index.js`. System Health shows **degraded** when the oldest pending delivery is older than 10 minutes. |
| Repeated `failed` | Partner URL down, TLS issues, or non-2xx/timeout (>15s). Read the error and HTTP status in **Activity**. |
| Activity log empty for a partner | Confirm the right partner is selected (deliveries belong to the key that submitted the instruction), the partner has an active webhook, and the time window covers the change. |
| API requests tab empty | Migration `138` applied? Rows exist only for calls made after it was deployed. |
| Invalid URL on create | Must be valid **HTTP or HTTPS** URL |
| Partner locked out | Key revoked — create a new key and share plaintext once |

For signature verification and event shapes, point partners to **§3.4–3.6** of the partner API guide.

---

## Schedule milestones (internal mapping, v5.5 — KLIP)

Partners map industry labels to fields in webhook/GET **`data.schedule`**:

| Partner label | JPS field | Operator source (summary) |
|---------------|-----------|---------------------------|
| ATA | `ta` | Arrival / TA |
| ATB | `tb` | Berthing |
| ATS (Hose On) | **`cargo_ops_start_at`** | **Cargo Operations → Operation Window → Start** |
| ATC (Hose Off) | **`cargo_ops_end_at`** | **Cargo Operations → Operation Window → End** |
| Vessel sailed | `cast_off_at`, `sailed_at` | Clearance / depart — not Hose Off |

**`schedule.updated`** fires when these schedule fields change (including Cargo Operations window start/end on create/update/delete). Load-segment-only edits do not change Hose On/Off.

## Partner status stages (v5.7)

The partner `status` follows the vessel, derived from the same times as the Management Dashboard:

| Status | Set when |
|--------|----------|
| `Allocated` | Jetty assigned, TB not set |
| `Berthed` | TB set |
| `Start Cargo` | Cargo Operations window start saved (`cargo_ops_start_at`) |
| `Cargo Done` | Latest end among Cargo Operations, final inspection and final sounding (`cargo_done_at`). Stays empty while any cargo segment is open. |
| `Sailed Off` | Depart recorded |

Each change sends **`status.changed`**, once per status. In **Activity**, a `status.changed` row whose expanded payload shows the next stage is the proof that the partner was told. Hose Off (`cargo_ops_end_at`) comes before Cargo Done when final checks follow the hoses. Clearing a time (for example TB) moves the stage back and sends a new `status.changed`.
