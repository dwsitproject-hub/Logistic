### 2.6 Updates and rollback (Docker staging)

**Backend server (172.28.92.57):**

**Environment / database (read this if credentials or port “don’t match” `.env`):**



```bash
cd /opt/klip
git pull
docker compose -f docker-compose.backend.yml up -d --build
```

New migrations run automatically when the backend container starts. To see logs: `docker compose -f docker-compose.backend.yml logs -f backend`.

**Frontend server (172.28.92.56):**

Because `NEXT_PUBLIC_API_URL` is fixed at build time, you must rebuild the image after pulling:

```bash
cd /opt/klip
git pull 
docker compose -f docker-compose.frontend.yml up -d --build
```