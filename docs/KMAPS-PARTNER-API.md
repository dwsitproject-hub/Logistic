# KMAPS partner API (KLIP is the data provider)

KMAPS (KPN Downstream Maps) reads shipments and tug / barge pairs from KLIP. The contract is owned by KMAPS: `docs/KLIP-SHIPMENT-API.md` in the KMAPS repository (Draft 5). This page is the KLIP side: where the code is, how to switch it on, how to check it.

## What exists

| Contract | KLIP |
|---|---|
| `GET /api/partner/v1/health` | no token, `{ ok, version }` |
| `POST /api/partner/v1/auth/token` | keys in a JSON body, 1 h Bearer token, 10 requests per minute per address |
| `GET /catalog` | the contract describing itself, including `maxStalenessSeconds` |
| `GET /shipments` | per vessel (`vesselCode`, `sapCode`, up to 100 each), full read, incremental (`updatedSince`, `cursor`), `includeDeleted`, 500 per page |
| `GET /shipments/{id}` | one record |
| `GET /vessel-pairs` | whole list, only pairs where both vessels have a DHM code |
| Webhook to KMAPS | a bell (`shipment.created / updated / status_changed / deleted`), HMAC-signed, retried 30 s, 2 min, 10 min, 1 h, 6 h |

Code: `backend/src/partner/` (router, token, records, webhook), migrations 256 to 258, Integrations menu entry `kmaps` (`backend/src/integrations/registry.ts`), panel `frontend/src/components/integrations/KmapsWebhookPanel.tsx`.

## How the records are made

A shipment's stage is derived on the Shipments page from the ATA ladder, own-STO milestones, SAP close flags and the OS band. That is a full-scope derivation, so it is not run per request. `partner/refresh.ts` runs the **same derivation the pipeline summary uses** (`buildShipmentDailyBaseCteSql`, read with `shipmentPageEffectiveStatusExpr`), builds the records into `partner_shipment_records`, and keeps three promises:

- `id` is opaque and issued by KLIP (`shp_` + 10 characters). It is **not** the STO key: an `OP-` / `MNL-` shipment gets its STO number later and a PO moved to its own operation changes the key. The shipments behind the group (`member_ids`) carry the identity across such a change (`partner/identity.ts`).
- `version` only goes up. It is bumped when a hash of everything the record exposes (including active and status) changes. `updatedAt` is the time KLIP detected the change.
- A record is never served before the first build finished (503, so KMAPS does not read an empty list as "nothing is active").

The records are rebuilt only when a source table changed (a cheap signature), never more often than every 2 minutes, by a loop started from `server.ts` (`partner/loop.ts`). The freshness is `maxStalenessSeconds` (300) in `/catalog`.

## Switching it on (SIT, then production)

1. `INTEGRATION_SECRETS_KEY` must be set on the backend host (it already is where DHM / JPS secrets are saved). The partner tokens are signed with a key **derived** from it (HKDF), never with `JWT_SECRET`, so no new variable is needed.
2. KMAPS issues the keys (public `kmaps_pk_...`, private `kmaps_sk_...`, webhook secret `whsec_...`). Hand them over through a secure channel, not chat, email or git.
3. Integrations > KMAPS > Edit: paste the public key, the private key, the webhook secret and the webhook URL, set Enabled = true, Save. The private key is stored only as a sealed scrypt hash, so it cannot be shown again. Saving a new private key ends every token issued under the old one.
4. The first build starts when the settings are saved (otherwise about 3 minutes after boot).
5. Integrations > KMAPS > Test connection reports whether KLIP can authenticate KMAPS now. History shows every call KMAPS makes (path, parameters, status, duration, record count; never a body, a price or a key).

Base URL for KMAPS: SIT `http://172.28.92.57:5001/api/partner/v1`, the backend itself (KMAPS's backend runs on the same host); production to be agreed (HTTPS is not set up on the production nginx yet).

Not `http://172.28.92.56/api/partner/v1`: nginx on the SIT frontend host chooses a site by the Host header, the KLIP site answers only to `test-klip.kpndomain.com`, and a request by IP lands on the default site for port 80 (Commercial Documents), which answers 404 for this path. Found by testing on SIT 2026-11-10: with `Host: test-klip.kpndomain.com` the same URL answers correctly. The frontend container (`http://172.28.92.56:3001/api/partner/v1`) answers correctly too.

## Check by hand

```bash
curl -s http://<host>/api/partner/v1/health
TOKEN=$(curl -s -X POST http://<host>/api/partner/v1/auth/token -H 'Content-Type: application/json' \
  -d '{"publicKey":"<public>","privateKey":"<private>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s "http://<host>/api/partner/v1/shipments?vesselCode=VSL-0537" -H "Authorization: Bearer $TOKEN"
```

## Known limits

- The price is sent as stored (`contracts.unit_price`, `currency`, `contract_value`). The unit it is quoted in is not stored with it: confirm with Commercial before KMAPS shows it as per MT.
- `quantityShipped` is `null`: KLIP has no verified "shipped" figure for a line.
- Quantities are KLIP kilograms converted to MT (a kilolitre unit stays `KL`).
- On production only about 1 in 4 active shipments has a vessel DHM code, so most records have `vessel.code: null` until vessels are linked to DHM. `vessel.sapCode` and the `sapCode` filter help KMAPS find the DHM vessel meanwhile.
- `/vessel-pairs` lists only pairs whose two vessels both have a DHM code. The vessel master loader has not run on production, so the list is empty there until it does.
- The cost of one rebuild on production has not been measured (it is the same derivation as the pipeline summary). The log line `KMAPS partner records refreshed` carries the milliseconds.
