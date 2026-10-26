# Commercial Documents (frontend-commercial)

Its own front end for document management per PO, on the **same KLIP backend, database and Synology storage**. Users, roles,
permissions and the audit trail are KLIP's; a password changed here changes for KLIP too. There is no second backend on
purpose: every backend process runs the crons and boot jobs, and a second one would fail a running SAP import.

Pages: Documents (cards, filters, columns, drawer with checklist / upload / versions / preview / history, Tanda Terima for
several POs), Dashboard (completeness by plant), Users, Roles & access, Audit trail, plus sign-in, forgot password and the
set-password page that invitation and reset e-mails link to.

What a user sees follows the API gates exactly - see `src/lib/access.ts`.

## Run locally

```bash
npm install
BACKEND_INTERNAL_URL=http://127.0.0.1:5001 npx next dev -p 3092
```

`BACKEND_INTERNAL_URL` makes Next proxy `/api` and `/auth` to a running KLIP backend. `NEXT_PUBLIC_KLIP_URL` (optional) adds
a KLIP link to the sidebar.

```bash
npm run typecheck && npm test && npm run build
```

## Deploy

`docker-compose.frontend-commercial.yml`, `docs/nginx/commercial-docs.conf.example` and
`docs/scripts/deploy-commercial-docs.sh sit|prod` (frontend host). On the backend host set `COMMERCIAL_DOCS_URL` to this
app's public origin so reset and invitation e-mails sent from here link back here.
