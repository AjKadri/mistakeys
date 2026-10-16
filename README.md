# Mistakeys

Mistakeys is an MIT-licensed credential rotation control plane for GitLab's Life After Code hackathon. It protects a demo orders API, rotates a leaked application key through typed operations, updates the consumer, verifies both sides, and records secret-free evidence.

The services and the GitLab.com CI/CD and VPS deployment kit are included. GitLab Duo agent files are intentionally not included yet.

## Services

- `api` exposes `GET /healthz` and authenticated `GET /v1/orders`.
- `rotator` is internal-only and accepts typed, bearer-authenticated rotation operations.
- `consumer` reads its key file on every request to the API and exposes `GET /status`.

The registry stores key hashes and fingerprints, never raw keys. The raw key exists only in the consumer key file and transiently in the rotator process while it hands a replacement to that file.

In production, Caddy is the only public application container. The API and consumer are on a private Docker network. The rotator has no published port and is reachable only through Caddy's `/rotator/*` path, which requires `ROTATOR_TOKEN` and is rate-limited to 30 requests per source IP per minute. This gives the future agent a narrow control-plane entry point without placing the rotator directly on the internet.

## Local run

Requirements: Node 22, npm, and Docker Compose.

```sh
cp .env.example .env
# Edit .env and replace the placeholder ROTATOR_TOKEN with a local value.
npm install
npm test
npm run typecheck
npm run build
docker compose up --build -d
```

Check the public API and consumer:

```sh
curl http://localhost:3000/healthz
curl http://localhost:3001/status
```

The seeded fingerprint is printed by the rotator without printing the key. The reproducible demo command in the project handoff uses `docker compose exec rotator` so the rotator stays internal-only.

For the internal-only demo, read the seeded fingerprint from the secret-free registry and call the rotator from inside its container:

```sh
SEED_FINGERPRINT="$(docker compose exec -T rotator node --input-type=module -e "const fs = await import('node:fs/promises'); const r = JSON.parse(await fs.readFile('/data/registry.json', 'utf8')); console.log(r.credentials['orders-api'].keys.find(k => k.state === 'active').fingerprint)")"
docker compose exec -T -e "SEED_FINGERPRINT=$SEED_FINGERPRINT" rotator node --input-type=module -e "const r = await fetch('http://127.0.0.1:3002/v1/rotator/rotate', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.ROTATOR_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ credential_id: 'orders-api', leaked_fingerprint: process.env.SEED_FINGERPRINT }) }); console.log(await r.text())"
curl http://localhost:3001/status
```

The command returns the replacement fingerprint and step results. It never returns the raw key. The rotator has no published host port.

Stop the stack with:

```sh
docker compose down -v
```

## Local HTTPS proxy

The deployment kit includes a local Caddy build with the rate-limit module. It uses `mistakeys.localhost` and Caddy's local certificate authority, so `curl` needs `-k` unless you install Caddy's local CA in your trust store.

```sh
cp deploy/.env.local.example deploy/.env.local
docker compose -p mistakeys-local-https --env-file deploy/.env.local \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local-https.yml \
  up --build -d
curl -k https://mistakeys.localhost:8443/healthz
docker compose -p mistakeys-local-https --env-file deploy/.env.local \
  -f deploy/docker-compose.yml \
  -f deploy/docker-compose.local-https.yml \
  down -v
```

## CI/CD and VPS deployment

`.gitlab-ci.yml` runs typecheck and unit tests, a redacted custom gitleaks scan, a fixture assertion job, image builds, and a protected-branch deployment. Images are tagged by commit SHA. The deploy job connects through a forced SSH command and keeps a local `previous` tag for one-command rollback.

The leak scan job is named `mistakeys_leak_scan`. It fails on a finding and uploads `leak-report.json`, which contains only file path, line, commit SHA, rule ID, and a SHA-256 fingerprint. GitLab's standard Secret Detection job is included with `allow_failure: true`.

Follow [docs/SERVER_SETUP.md](docs/SERVER_SETUP.md) for the Ubuntu VPS setup, protected CI/CD variables, HTTPS checks, and rollback command.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

The project does not make production safety claims. It demonstrates bounded local test behavior, secret-free audit evidence, a verified replacement flow, and a reproducible deployment path. GitLab CI, the VPS, DNS, public HTTPS, and the future Duo agent remain environment-dependent until checked in their real environments.
