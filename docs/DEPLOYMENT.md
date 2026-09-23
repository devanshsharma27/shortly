# Deploy it yourself, one step at a time

Start with the local Docker walkthrough in the README. The same containers run on one Linux VM. This keeps deployment understandable: one machine, one Compose file, one Nginx entry point. No Kubernetes is needed.

## 1. Verify locally

```sh
docker compose up --build -d --wait
docker compose ps
node scripts/smoke.mjs
```

PowerShell: `1..8 | ForEach-Object { (Invoke-RestMethod http://localhost:8080/api/health).instance }`

Bash: `for i in 1 2 3 4 5 6 7 8; do curl -s http://localhost:8080/api/health; echo; done`

You should see `backend-1` and `backend-2`. Nginx uses round robin, and a shared upstream zone coordinates balancing state across workers. It is normal for ordering to vary when other browser/health requests run concurrently.

```sh
docker compose stop backend1
# Repeat health checks, create/open links, then restore the instance.
docker compose start backend1
```

## 2. Prepare one Linux VM

Use an Ubuntu VM with enough memory to build Node images (2 GB is a reasonable starting point, not a measured minimum). You can use an AWS EC2 instance or another provider. Select region, pricing, and access in your own account; nothing in this repository provisions or pays for infrastructure.

Install Git, Docker Engine, and the Compose plugin using the official Ubuntu instructions:
https://docs.docker.com/engine/install/ubuntu/

Permit SSH only from your IP. Permit public TCP 80 and 443 when enabling HTTPS. Keep PostgreSQL 5432, Redis 6379, Express 3000, and development 8080 closed to the internet.

SSH into the machine and clone the branch containing these changes (or `main` after merge):

```sh
git clone --branch feat/frontend-hld-deployment https://github.com/devanshsharma27/url-shortner.git
cd url-shortner
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
```

Put the two generated values into `.env`. Retain `BIND_ADDRESS=127.0.0.1` so the temporary HTTP endpoint is only local. Start with:

```sh
docker compose up --build -d --wait
```

To inspect it privately from your laptop, create an SSH tunnel:

```sh
ssh -L 8080:127.0.0.1:8080 YOUR_SSH_USER@YOUR_SERVER_IP
```

Then open `http://localhost:8080` on your laptop. Keep `BASE_URL=http://localhost:8080` for this private exercise. Those links are not public yet.

## 3. Add a domain and HTTPS

Create a DNS A record such as `links.your-domain.com` pointing to the VM. If you add an AAAA record, it must point to working IPv6 on the same server. Wait until the record resolves correctly. Ensure ports 80 and 443 are permitted by both the provider firewall and host firewall.

Install Certbot on the host using its supported instructions: https://certbot.eff.org/instructions

For the first certificate, port 80 must be free. The default local Compose stack binds only 8080. Obtain a certificate with a stable certificate directory name:

```sh
sudo certbot certonly --standalone --cert-name shortly -d links.your-domain.com
```

Certbot will ask for your email and agreement to its terms. Edit `.env`:

```dotenv
BASE_URL=https://links.your-domain.com
BIND_ADDRESS=127.0.0.1
WEB_PORT=8080
```

Run the HTTPS override, which mounts certificates into the SAME Nginx load balancer:

```sh
docker compose -f docker-compose.yml -f deploy/compose.https.yml up --build -d --wait
```

Open the real HTTPS address, register/sign in, create a link, and open it from another device. The backend generates links using `BASE_URL`, so it must match the public HTTPS origin. Clipboard copying works in HTTPS contexts and on localhost.

There is no additional proxy hop in this setup. Nginx overwrites the forwarded IP and the API trusts exactly one hop; backend ports remain private. If adding a CDN or another proxy later, revise this trust model before relying on per-IP rate limits.

## 4. Renewal, updates, and recovery

The standalone renewal method needs port 80. For a simple learning deployment, briefly stop web during renewal and restart afterward:

```sh
docker compose -f docker-compose.yml -f deploy/compose.https.yml stop web
sudo certbot renew
docker compose -f docker-compose.yml -f deploy/compose.https.yml up -d web
```

Practice with `sudo certbot renew --dry-run` while port 80 is free. Configure a scheduled renewal with pre/post hooks that perform the stop/start commands from this repository directory, and verify its logs. This causes brief downtime; use webroot/DNS challenges for uninterrupted renewal later. Do not assume an installed Certbot timer can renew while Nginx owns port 80.

For updates, back up the database first, pull the intended commit, then use the same complete HTTPS Compose command above. The migration job runs before API startup. After API containers are recreated, restart web to refresh Nginx's startup DNS resolution:

```sh
docker compose -f docker-compose.yml -f deploy/compose.https.yml restart web
```

Inspect problems with:

```sh
docker compose logs --tail=100 migrate backend1 backend2 web
docker compose exec web nginx -t
```

If Nginx fails with missing certificate files, check that Certbot used `--cert-name shortly` and that the host `/etc/letsencrypt` is mounted. If registration returns 503, inspect Redis. If redirects contain localhost, fix `BASE_URL` and recreate the API containers.

Take a backup on the server (bash):

```sh
docker compose exec -T postgres pg_dump -U shortener_user shortener_db > backup.sql
```

Store backups somewhere separate from the VM. A named Docker volume survives container replacement but is not a backup. Never run `docker compose down -v` on data you want to keep.

## Why this is useful for HLD

You can distinguish packaging (Docker), orchestration on one host (Compose), reverse proxy/load balancing (Nginx), durable state (PostgreSQL), temporary shared state (Redis), and public addressing/encryption (DNS/TLS). Once these are understood, replace Nginx with a managed load balancer and put APIs on separate hosts. That is a future step, not a feature this deployment already claims.
