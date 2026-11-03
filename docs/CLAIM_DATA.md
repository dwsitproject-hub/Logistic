# Claim Data (OSCLAIM / REALCLAIM)

Shortage Claim (`/claim-susut`) and Quality Claim (`/claim-mutu`) are fed from two SAP exports, imported on
**Claim Data** (`/claim-data`, ADMIN only, permission `page.claim_data`). The upload buttons on the two claim
pages are retired (`POST /claim-susut/upload` and `/claim-mutu/upload` answer `410`).

| File | Meaning | Import mode |
| --- | --- | --- |
| `OSCLAIM_ALLREGION_MUTU SUSUT_*.xls` | Outstanding (not paid) | **Replaces** the Outstanding snapshot |
| `REALCLAIM_ALLREGION_MUTU SUSUT_*.xls` | Realised (paid) | **Upserted per CR number** (cumulative) |

Each file holds both claim kinds; rows are split by `TYPE OF CLAIM` (MUTU → Quality Claim, SUSUT → Shortage Claim).

## API

- `POST /api/claim-data/upload` — multipart `file`, `kind` (`os` | `real`), optional `dataAsOf` (`YYYY-MM-DD`). Max 100 MB.
- `GET /api/claim-data/uploads` — last 50 imports.
- `GET /api/claim-data/status` — latest file per kind and the live row counts.

## Parsing rules (`backend/src/utils/claimDataWorkbook.ts`)

- Header block = the row containing `VENDOR CODE`; continuation pages without a header reuse the previous layout.
- SUB TOTAL / GRAND TOTAL / repeated header rows are skipped; the vendor code and name carry forward.
- A duplicate CR number inside one file: the last row wins (warning). GRAND TOTAL is compared with the parsed sum (warning above 0.1%).
- Realised uses the approved block (`JUMLAH CLAIM DISETUJUI`); Outstanding uses `JLH CLAIM DIAJUKAN`.
- Dates: numeric Excel dates have day and month swapped in the export and are swapped back; text `dd.mm.yyyy` is read as-is.

## B2B status

Taken from the Logistics Report, as-is: claim PO → `contracts.po_number` → `contract_latest_spd_snapshot.b2b_flag_raw`
(`B2B` / `DIRECT`). Outstanding claims also try the contract id. Result per row: **B2B**, **Direct** or **Unmatched**
(PO not found in the Logistics Report). Origin B2B POs count as B2B; Reff PO is not used.
The B2B filter on both claim pages uses these three values. Quality Claim keeps its Include/Exclude B2B toggle
(Exclude = B2B only; Unmatched stays in); a B2B Status selection overrides the toggle.

## Derived fields

`refreshClaimDataDerived` (at upload, 00:30 and 07:30 Asia/Jakarta via `CLAIM_DATA_REFRESH_CRON`, and at startup)
re-matches `b2b_status` and recomputes `os_days` = today (Jakarta) − CR date, so aging stays current between uploads.

## Data model

- Migration `252_claim_data.sql`: `source_kind` / `data_as_of` on `claim_susut_imports` and `claim_mutu_imports`,
  `b2b_status` on the four claim row tables, history table `claim_data_uploads`.
- An OSCLAIM upload creates a new `source_kind = 'claim_data'` import in both claim import tables and moves the existing
  realised rows onto it. A REALCLAIM upload attaches to the latest claim-data import.
- Legacy monthly imports are archived: hidden from the claim pages once a claim-data import exists. The monthly
  "Summary Per Unit" trend on Quality Claim is hidden for the same reason.
- `SAP Data` was renamed **Logistics Data** in the UI only (route `/sap-imports`, permission `page.sap` unchanged).
