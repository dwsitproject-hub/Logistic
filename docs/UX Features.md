# UX: tooltips, app tour, page activity

## 1. Formula / logic tooltips

- Calculated fields use a small **(i)** icon next to the label (hover for help).
- Copy lives in `frontend/src/lib/fieldHelpText.ts` — extend `FIELD_HELP` when you add new derived fields.
- **Contracts** (compact headers + detail): Contract Aging, Log/Trade Cycle, Over/Under Delivery, Outstanding Qty, Company Name, B2B Parties.
- **Dashboard**: AI Insight + KPI cards (contracts, shipments, trucking, payments).

## 2. App tour

- Runs **automatically once per user** after login when they land on **Dashboard** (stored as `localStorage` key `klip_app_tour_v1_<userId>`).
- **App tour** button in the header runs the same tour anytime.
- Steps highlight: sidebar, header, main area, floating activity button, and (on Dashboard) AI Insight when that block is present.

## 3. Latest activity (per page)

- **Floating button** (bottom-right) on all pages that use `Layout`.
- Calls `GET /api/activity/recent?page=<first_path_segment>` — returns up to **20** latest `audit_logs` rows filtered by entity types for that area (see `backend/src/controllers/activity.controller.ts`).
- Requires a normal JWT (same as the rest of the app).
