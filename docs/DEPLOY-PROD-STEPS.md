# KLIP production deploy - steps

Two hosts, deployed separately. Backend first when a release carries migrations.

| Host | What | SSH |
|---|---|---|
| ECS-DB (8.215.56.98) | backend (API, migrations, crons, SAP import) | port 1819 |
| ECS-App | frontend (Next.js) | port 1818 |

Both scripts deploy whatever `origin/main` is at the moment you run them. Another agent may push to main at any time, so always look at
what you are about to ship (step 1) and at what actually shipped (`commit now` at the end of the deploy log).

## 1. Before the deploy (ECS-DB)

```bash
cd /opt/klip && git status --porcelain | head
```
Column 1 must be empty on every line (`??` = untracked, fine). A letter in column 1 is a STAGED edit that `git diff` does not show - stop.

```bash
cd /opt/klip && git fetch origin && git log --oneline -1 origin/main && git log --oneline HEAD..origin/main
```
The first line is the commit you will deploy; the list is everything new since the running one. Check it holds what you expect and
nothing you did not agree to ship.

If the release touches outstanding / OS (Shipments, Shipping Performance, Contract Performance), take the BEFORE figures now:
```bash
cd /opt/klip && git show origin/main:docs/scripts/diag-cross-page-invariants.cjs | docker exec -i klip-backend node -
```

## 2. Backend (ECS-DB)

```bash
cd /opt/klip && git fetch origin && git show origin/main:docs/scripts/deploy-prod-backend.sh > /tmp/deploy-prod-backend.sh && bash /tmp/deploy-prod-backend.sh
```
Must end with `all checks passed` and `commit now : <the commit from step 1>`. In the cron lines, `DHM sync cron is disabled` and
`JPS sync cron is disabled` are expected in production.

## 3. Frontend (ECS-App) - only when the release changes `frontend/`

Check first:
```bash
cd /opt/klip && git fetch origin && git diff --stat HEAD origin/main -- frontend | tail -1
```
Empty = nothing to deploy on this host. Otherwise:
```bash
cd /opt/klip && git fetch origin && git show origin/main:docs/scripts/deploy-prod-frontend.sh > /tmp/deploy-prod-frontend.sh && bash /tmp/deploy-prod-frontend.sh
```
Then prove the new UI is in the bundle, with a text only the new code has:
```bash
cd /opt/klip && docker compose -f docker-compose.frontend.yml exec -T frontend sh -c "grep -rl '<text only the new code has>' .next | head -3"
```

## 3b. Commercial Documents app (ECS-App) - only when the release changes `frontend-commercial/`

Its own container (`klip-commercial-docs`) next to KLIP's, on the same backend. Check first:
```bash
cd /opt/klip && git fetch origin && git diff --stat HEAD origin/main -- frontend-commercial | tail -1
```
Empty = nothing to deploy. Otherwise:
```bash
cd /opt/klip && git fetch origin && git show origin/main:docs/scripts/deploy-commercial-docs.sh > /tmp/deploy-commercial-docs.sh && bash /tmp/deploy-commercial-docs.sh prod
```
Must end with `healthy` and the expected `commit now`. First time only: the Nginx block on port 8081
(`docs/nginx/commercial-docs.conf.example`, production backend address), port 8081 open for users, and on ECS-DB
`COMMERCIAL_DOCS_URL=http://<ECS-App IP>:8081` in `backend/.env` followed by a backend restart.

## 4. After the deploy (ECS-DB)

Outstanding / OS releases - the same check as step 1, compare with the BEFORE figures:
```bash
cd /opt/klip && git show origin/main:docs/scripts/diag-cross-page-invariants.cjs | docker exec -i klip-backend node -
```
Invariant 1 must be 0. If Invariant 2 drifts, break it down contract by contract:
```bash
cd /opt/klip && git show origin/main:docs/scripts/diag-invariant2-gap.cjs | docker exec -i klip-backend node - --explain
```

Master Vessel - the sheet and KLIP must still agree (0 renamed / 0 created / 0 archived):
```bash
cd /opt/klip && git show origin/main:docs/scripts/replace-master-vessel-from-sheet.cjs | docker exec -i klip-backend node - --blank-clears --details
```

One shipment row looks wrong - every way KLIP links POs to its STO (read-only):
```bash
cd /opt/klip && git show origin/main:docs/scripts/diag-sto-po-links.cjs | docker exec -i klip-backend node - <STO number>
```

## If something goes wrong

- `commit now` is not the commit you expected: someone pushed between step 1 and step 2. Look at `git log --oneline -5 origin/main`
  and decide whether to keep it; deploying again picks up the newest main.
- The backend stays `Created` with no logs: the SAP share (Synology) is not mounted - see the SAP share notes before anything else.
- To go back, deploy the previous commit: `git checkout <commit>` in /opt/klip and run the deploy script from that checkout, then
  `git checkout main` afterwards.
