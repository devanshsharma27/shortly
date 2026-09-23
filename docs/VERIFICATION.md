# Backend review and verification

## Issues addressed

- Replaced hardcoded database-adjacent service settings and localhost link generation with environment configuration.
- Added a real frontend for the existing authenticated API.
- Restricted destinations to HTTP/HTTPS URLs without embedded credentials; bounded JSON and field sizes.
- Added random seven-character Base62 allocation with database-enforced uniqueness and collision retries.
- Made rate-limit increment/expiry atomic in Redis; preserved shared limits across instances.
- Set explicit reverse-proxy trust and keep internal service ports unexposed.
- Made cache operations fall back rather than fail every redirect during a Redis outage.
- Hashed refresh tokens in storage and rotated them transactionally with a single-use concurrency guard.
- Added the owner/date index, production migrations, same-origin API docs, and public short URLs in list responses.
- Added liveness/readiness checks, graceful SIGTERM shutdown, and generic JSON errors.
- Updated the affected transitive dependency identified by npm audit.

## Checks

The GitHub Actions workflow builds the actual Docker images, starts PostgreSQL/Redis/two APIs/Nginx, and executes `scripts/smoke.mjs`. It checks:

1. Both API instances receive requests through Nginx.
2. Registration/login and unauthorized access.
3. Unsafe URL rejection and seven-character codes.
4. Create/list/search/edit/delete, public redirects, and ownership enforcement.
5. Cache invalidation after editing/deletion.
6. Concurrent refresh requests: only one succeeds.
7. Logout refresh-token revocation.
8. Authentication rate limit shared across replicas.
9. Continued health responses after stopping one backend.

The smoke script assumes fresh Redis limits; run it against development/test data only. It leaves two test users. It is not a load test or security audit.

The `qs` finding was resolved. The backend audit still flags `deepmerge-ts` through the existing Prisma CLI toolchain; no forced major/downgrade workaround was applied. Review upstream updates before production use.

Passed locally: TypeScript compilation, Vite production build, and Chromium browser checks of registration, link creation/editing/deletion, search, logout, and a 390px mobile viewport. Browser checks used a mocked API; they do not verify real database behavior. Desktop and mobile screenshots were visually inspected. The implementation workspace did not have Docker, so the container integration result must be read from GitHub Actions or reproduced locally; compilation alone does not prove deployment works.

## Remaining limits

- sessionStorage tokens are readable by JavaScript; see the HttpOnly-cookie upgrade discussion in HLD.md.
- Single host/database/cache/load balancer; no automatic host-level disaster recovery.
- Bounded stale cache entries are possible during edits/deletions and outages.
- Click counting is asynchronous/best effort and still performs one DB write per redirect.
- Fixed-window IP limits can penalize shared networks and permit boundary bursts; no abuse-report/takedown workflow.
- No expiration, queue, sharding, URL safety reputation scanner, password-reset flow, or email verification.
- Public short links are deliberately public; private destinations should not be treated as access-controlled merely because their short codes are hard to guess.

Do not claim performance improvements or production readiness without measuring and addressing the relevant limits.
