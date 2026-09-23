# Shortly — URL shortener

A small full-stack project for learning high-level design through working code. React dashboard, Express/TypeScript API, PostgreSQL/Prisma storage, Redis cache and rate limiter, and Nginx in front of two API instances.

## Run locally (Docker Desktop)

1. Install Docker Desktop with Compose. On Windows, enable its WSL 2 backend and use PowerShell or a WSL terminal.
2. Clone this repository and enter its directory.
3. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell; `cp .env.example .env` in bash).
4. Generate two different random hex values and place them in `POSTGRES_PASSWORD` and `JWT_SECRET`. With Node installed, run this twice:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Do not commit `.env`. Hex avoids special-character escaping in the database connection string.
5. Start the application:
   ```sh
   docker compose up --build -d --wait
   ```
6. Open **http://localhost:8080**, create an account, and shorten a URL. API docs: **http://localhost:8080/api/docs**.

`docker compose logs -f backend1 backend2 web` shows requests. `docker compose down` stops the app and preserves the database volume. **Adding `-v` deletes the database**; use it only for disposable tests.

## What works

- Register, sign in, rotating refresh tokens, and sign out.
- Create, copy, search, paginate, edit, and delete your links.
- Public redirects with `302` and `Cache-Control: no-store`.
- Per-link best-effort click counts; use the refresh button after opening a short link.
- Seven-character random Base62 codes, unique DB constraint, and collision retries.
- Cache-aside Redis reads; 60-second TTL, invalidation on edits/deletion, DB fallback.
- Redis-backed, atomic fixed-window limits shared by both API instances.
- Round-robin balancing and passive failover through Nginx.

## Read in this order

1. [File map and architecture](docs/HLD.md)
2. [Deployment walkthrough](docs/DEPLOYMENT.md)
3. [Verification and backend review](docs/VERIFICATION.md)

## Verify a fresh local stack

With Node 22 installed, run this once on a fresh development database/Redis:

```sh
node scripts/smoke.mjs
```

The script creates two test accounts and deletes its test link. Re-running within one minute can trigger the intentional authentication limit. CI uses a disposable stack, checks that both backends receive requests, then stops one to test failover.

## Frontend development

Keep the Docker stack running. In `frontend/vite.config.js`, change the proxy target to `http://localhost:8080`, then:

```sh
cd frontend
npm ci
npm run dev
```

Open Vite's printed URL. API calls are proxied to the real application; short links use `BASE_URL` and open the Nginx port. With a standalone API on port 3000, retain the default proxy target.

For standalone backend development, supply PostgreSQL/Redis yourself, copy `backend/.env.example` to `backend/.env`, and use Node 22:

```sh
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
node --env-file=.env dist/index.js
```

Prisma CLI reads `.env`; plain Node does not unless `--env-file` is supplied. The main Compose setup deliberately keeps DB, Redis, and API ports private.

## Scope

This is an educational implementation, not a claim of billion-link capacity or production high availability. There is no sharding, replication, queue, custom alias, or global deduplication. Read the documented limitations before describing it in interviews.
