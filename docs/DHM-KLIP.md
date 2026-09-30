# DHM integration (KLIP)

KLIP implements DHM patterns **A + C** for Master Vessel and the CPO masters below. See `docs/CLIENT_INTEGRATION.md` for the hub contract.

- Credentials (`DHM_PUBLIC_KEY`, `DHM_PRIVATE_KEY`, `DHM_WEBHOOK_SECRET`) stay on the backend. Default `DHM_ENABLED=false`.
- KLIP codes (`vessel_code_klip`, `KPRD-`, `KPRT-`, `KINT-`, `KEXT-`, `KINC-`) are never sent as the DHM `code`. DHM assigns `code` on create. KLIP stores it as `master_vessels.dhm_code` or `code_dhm` on the other masters.
- Create/edit posts or puts inbound after the local row is saved. A DHM failure does not roll back the KLIP row. A 409 asks the user to overwrite, then retries with `?dhmOverwrite=true`.
- Sync: `GET /v1/sync/{slug}` on `DHM_SYNC_CRON`, organizations and sites before ports. Webhook: `POST /api/dhm/webhooks` (HMAC raw body, `deliveryId` dedupe).
- Do not use `/v1/ingest`. Lookup `404` does not auto-insert.
- Truck Transporter has no hub slug and is not synced.

| KLIP master | DHM slug | Payload |
| --- | --- | --- |
| Master Vessel | `vessel` | Vessel hub fields. `vessel_code` is `Vessel_Code_SAP`. |
| Master Product | `commodity` | `name`. When the catalog also lists `short_name` and `long_name`, those are filled from the product name. |
| Master Incoterm | `incoterm` | `name` |
| Master Company (Ext) | `shipper` (or `external_party` when that is the allowlisted slug) | `name` = Ext Company Name. `group` is sent only when the catalog has that field. |
| Company (Int) | `company`, then `site` | Company `name` = company name. Site `name` = plant name (or plant code) and `company_id` = company code. `code_dhm` is the site code. `dhm_org_code` is the company code. |
| Master Port | `port_master` | `name` and `site_id` from a Company (Int) site that already has a DHM code. Without a site, the local row saves and DHM returns `Port needs a DHM site`. |

Integrator must register application `klip` and allowlist `vessel`, `commodity`, `incoterm`, `shipper`, `company`, `site`, and `port_master`. The live catalog (OpenAPI 1.7) uses `company` and `company_id`, not `organization`. A slug that is not allowlisted comes back as a DHM error on save and is skipped by the cron.

SIT API (from the KLIP backend host): `DHM_BASE_URL=http://172.28.92.56:2001/api`  
(`GET /health` on that base is `/api/health` → `{ "status": "ok", "service": "dhm-api" }`).  
The portal on `:2001` is not the API. SIT's `/api` proxy strips `X-DHM-*` headers — KLIP uses `POST /auth/token` then `Authorization: Bearer`.

Keys stay in `/opt/klip/.env` or `/opt/klip/backend/.env` on `172.28.92.57`. Do not commit them.
