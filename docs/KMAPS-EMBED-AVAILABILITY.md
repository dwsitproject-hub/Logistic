# KMAPS embed: which shipments can be shown on the map (request from the KLIP team to the KMAPS team)

Status: **Accepted.** Written by the KLIP team; answered by KMAPS in `KLIP-EMBED.md` **Draft 3 §8** (static access key `kmaps_ak_…`, Bearer auth). This file stays as the original ask; implement against Draft 3 §8.
Related: KMAPS `docs/KLIP-EMBED.md` Draft 3 §8.

## 0. Why this is needed

KLIP's Shipments page replaces the **View Documents** icon in the Action column with the **KMAPS icon**, which opens the frame of `KLIP-EMBED.md`.

Not every vessel is tracked on Podium yet, and KMAPS depends on Podium. For a shipment whose vessel KMAPS cannot show, the frame only says "Shipment tidak ditemukan" / "Kapal belum bisa ditampilkan" / "Kapal tidak tampil di KMAPS". **Product decision (KLIP owner, Nov 18, 2026): the KMAPS icon is shown only for shipments KMAPS can actually show; every other row keeps View Documents.**

KLIP has no Podium information (it knows a vessel's DHM code and charter type, nothing about tracking). Only KMAPS knows. `KLIP-EMBED.md` section 7 already lists this as a possible later addition; this document is that addition.

## 1. What KLIP asks for (smallest thing that works)

One **read-only list**: the shipments KMAPS can show right now. KLIP calls it from its backend, caches the answer for a few minutes, and checks each row of the Shipments list against it.

```
GET <KMAPS_ORIGIN>/api/v1/embed/available
Authorization: Bearer <token>        (see section 3)
```

Query: `cursor` (optional, opaque paging), `limit` (optional, default 500, max 1000).

Response `200`:

```json
{
  "generatedAt": "2026-11-18T03:10:00Z",
  "items": [
    {
      "op": "shp_9k2f7q1x",
      "sto": "4500012345",
      "shipment": "SHP-2026-0412",
      "vessel": "VSL-0537",
      "hasPosition": true
    }
  ],
  "nextCursor": null
}
```

| Field | Meaning |
|---|---|
| `op` | The record `id` KLIP sent in `/shipments` (same value as `op` in the frame URL). **Primary key of the answer.** |
| `sto`, `shipment`, `vessel` | Echoes of what KMAPS holds for that record (helps KLIP match when it only has an STO). Nullable. |
| `hasPosition` | `true` when the vessel currently has a position; `false` = it would show on the map without a vessel icon ("belum ada posisi"). KLIP treats **both as available**; the flag is informational. |

**Definition of "available" (KMAPS's rule, KLIP does not duplicate it):** the record is active, and the frame would show the vessel (vessel has a DHM code, is a T/C vessel, is known to DHM and tracked on Podium). Equivalently: the cases of `KLIP-EMBED.md` section 4 that end in a **map with a vessel**. Anything that would end in "not found" / "belum bisa ditampilkan" / "tidak tampil di KMAPS" is **left out** of the list.

Rules:

- A record **not in the list** is "not available". KLIP does not need the reason; if KMAPS wants to give one, add an optional second endpoint (section 5), but nothing here depends on it.
- The list covers **all** available records, paged by `cursor` until `nextCursor` is `null`.
- Must be cheap: KLIP calls it at most **once every 5 minutes** (plus when an ADMIN presses refresh).
- KMAPS can answer `404` while this is not deployed: KLIP then treats the capability as "not supported yet" (see section 4).

## 2. What KLIP does with it

| Situation | Action column of a Shipments row |
|---|---|
| Record's `op` (else `sto`, else `shipment`) is in the cached list | **KMAPS icon** (opens the frame) |
| Not in the list | **View Documents** icon; the row looks exactly as it did before KMAPS existed |
| KMAPS toggle is off in KLIP Integrations | View Documents on every row (already built) |
| KMAPS unreachable or error, last good list younger than 30 min | Use the last good list |
| KMAPS unreachable, no usable list | **View Documents on every row** (a frame would not work either) |
| KMAPS answers `404` (endpoint not deployed yet) | Show the KMAPS icon on every row that has a shipment, as today, until the endpoint exists |

The list is **never** used to block the View Documents button; documents are always reachable from the shipment itself.

## 3. Authentication (needs a decision)

Today the direction is KMAPS -> KLIP (`/api/partner/v1`, KMAPS holds the key pair, KLIP holds only the hash). This endpoint is the **reverse direction** (KLIP -> KMAPS), so it needs its own credential. KLIP proposes, in order of preference:

1. **Same pattern as today, reversed:** KMAPS issues a key pair for KLIP (`klip_pk_` / `klip_sk_`), KLIP stores the private key encrypted in Integrations > KMAPS, exchanges it for a short-lived bearer token, and calls the endpoint with it.
2. A static API key header issued by KMAPS (simpler, no token exchange).

KLIP also needs **the KMAPS API origin** (probably the same as `KMAPS_EMBED_URL`'s origin; SIT: `http://test-kmaps.kpndomain.com`). The endpoint returns no secrets and no prices, only record keys.

## 4. Rollout order (so nothing breaks)

1. KMAPS builds and deploys the endpoint to SIT, sends KLIP the credential. Until then KLIP behaves exactly as today (icon on every shipment row), because `404` means "not supported yet".
2. KLIP builds the client, the cache, and the per-row eligibility (small: one service next to `backend/src/partner/embedLink.ts`, one extra field on `GET /api/shipments/kmaps-status`, and the row action reads it).
3. Test on SIT with the checklist below, then production.

## 5. Optional extras (not required)

- `GET /api/v1/embed/available?op=<id>` returning `{available:false, reason:"vessel_not_tracked" | "not_tc" | "no_dhm_code" | "not_active" | "not_synced"}` for a single record, so KLIP could show a tooltip on the row. The KLIP owner did **not** ask for this; the plain list is enough.
- A webhook to KLIP when a record becomes available or unavailable (KLIP polls every 5 minutes instead; 5 minutes of lag is acceptable).

## 6. Test checklist

| # | Case | Expected in KLIP Shipments |
|---|---|---|
| 1 | Shipment of a T/C vessel tracked on Podium | KMAPS icon |
| 2 | Shipment of a vessel not tracked on Podium | View Documents |
| 3 | Shipment of a non-T/C vessel | View Documents |
| 4 | Shipment with no DHM vessel code | View Documents |
| 5 | Shipment new in KLIP, not yet synced to KMAPS | View Documents; becomes KMAPS icon within ~15 min (KMAPS sync) + 5 min (KLIP cache) after it appears |
| 6 | Vessel becomes tracked on Podium | KMAPS icon after the next KMAPS sync + KLIP cache refresh |
| 7 | KMAPS down | Last good list for 30 min, then View Documents everywhere |
| 8 | Endpoint answers 404 | KMAPS icon on every shipment row (today's behaviour) |
| 9 | KMAPS toggle off in KLIP | View Documents everywhere |

## 7. Questions for the KMAPS team

1. Is `GET /api/v1/embed/available` acceptable, or do you prefer another path/shape?
2. Which credential (section 3, option 1 or 2), and who issues it for SIT and Production?
3. Expected size of the list (number of available records), so KLIP can size paging and cache.
4. Is "tracked on Podium and T/C" exactly the rule that produces a map with a vessel, or are there other cases (for example plant not mapped) that KMAPS wants to treat differently?

## 8. Changes

| Draft | Date | Change |
|---|---|---|
| 1 | Nov 18, 2026 | First version, after the KLIP owner chose "KMAPS provides an eligibility API" over inferring it or a manual flag. |
