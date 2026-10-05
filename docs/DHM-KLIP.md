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
| Master Plant | `plant` | `name` = plant name (or plant code). The DHM code of the plant's Master Site is sent as the site reference, so a plant whose site has no DHM code is not pushed (`Plant needs a DHM site. Sync Master Site first.`). The SAP plant code and the plant type are sent only when the catalog lists a matching field. |
| Master Port | `port_master` | `name`. `site_id` is sent only when the port is linked to a Master Site that already has a DHM code (stored `dhm_site_code`, else the linked Site's `code_dhm`); DHM no longer requires it, so a port without a Site is pushed as it is. If the catalog still marks `site_id` required, the answer is `DHM port_master needs site_id`. |

**Version guard (`backend/src/dhm/versionGuard.ts`).** Every DHM record has an integer `version`. A record whose version is LOWER than the one the replica already holds (`dhm_version`) is skipped and logged as `DHM record skipped: the replica already holds a newer version`; an equal version is applied (the same record again), and a webhook body without a version is applied as before. This covers the cron pull, the webhook and the vessel replica. A tombstone (`record.deleted`) only lands on a row whose version is not newer, decided inside the UPDATE. A snapshot sync (`snapshot: true`) bypasses the guard, because it rebuilds the replica and a DHM restored from a backup could have lower versions. The push path (KLIP to DHM) is not guarded: it stores the answer to a write KLIP just made. Left open: the guard reads the stored version and then writes, so two deliveries of one record in the same instant can still cross; and a local edit whose push failed is not protected from a LATER DHM change.

Integrator must register application `klip` and allowlist `vessel`, `commodity`, `incoterm`, `shipper`, `company`, `site`, `plant`, and `port_master`. The live catalog (OpenAPI 1.7) uses `company` and `company_id`, not `organization`. A slug that is not allowlisted comes back as a DHM error on save and is skipped by the cron. KLIP has its own list of slugs it will write to (`INBOUND_SLUGS` in `backend/src/dhm/inbound.ts`). A slug missing from it fails with `Unknown DHM slug` before any request is sent: the Master Plant Sync button did exactly that for all 31 plants on 2026-10-01 until `plant` was added. `inbound.test.ts` now fails when the push code sends a slug that is not in that list.

SIT API (from the KLIP backend host): `DHM_BASE_URL=http://172.28.92.56:2001/api`  
(`GET /health` on that base is `/api/health` → `{ "status": "ok", "service": "dhm-api" }`).  
The portal on `:2001` is not the API. SIT's `/api` proxy strips `X-DHM-*` headers — KLIP uses `POST /auth/token` then `Authorization: Bearer`.

Keys stay in `/opt/klip/.env` or `/opt/klip/backend/.env` on `172.28.92.57`. Do not commit them.
