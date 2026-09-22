# DHM integration (KLIP)

KLIP implements DHM patterns **A + C** for **Master Vessel** only. See `docs/CLIENT_INTEGRATION.md` for the hub contract.

- Credentials (`DHM_PUBLIC_KEY`, `DHM_PRIVATE_KEY`, `DHM_WEBHOOK_SECRET`) stay on the backend. Default `DHM_ENABLED=false`.
- KLIP `vessel_code` is the SAP code (`Vessel_Code_SAP`). DHM `code` (`VSL-NNNN`) is stored as `master_vessels.dhm_code`.
- Create/edit in Master Vessel UI posts/puts inbound after the local row is saved. SAP/Jovin auto-create does not inbound.
- Sync: `GET /v1/sync/vessel` on `DHM_SYNC_CRON`. Webhook: `POST /api/dhm/webhooks` (HMAC raw body, `deliveryId` dedupe).
- Do not use `/v1/ingest`. Lookup `404` does not auto-insert.

Integrator must register application `klip` and allowlist `vessel` before turning `DHM_ENABLED` on.

SIT API (from the KLIP backend host): `DHM_BASE_URL=http://172.28.92.56:2001/api`  
(`GET /health` on that base is `/api/health` → `{ "status": "ok", "service": "dhm-api" }`).  
The portal on `:2001` is not the API. SIT's `/api` proxy strips `X-DHM-*` headers — KLIP uses `POST /auth/token` then `Authorization: Bearer`.

Keys stay in `/opt/klip/.env` or `/opt/klip/backend/.env` on `172.28.92.57`. Do not commit them.
