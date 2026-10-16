# Mistakeys

Mistakeys is a local, MIT-licensed demonstration of a credential rotation control plane. It protects a demo orders API, rotates a leaked application key through a typed internal rotator, updates the consumer, verifies both sides, and records secret-free evidence.

This step contains only the services. GitLab Duo agent files are intentionally not included yet.

## Services

- `api` exposes `GET /healthz` and authenticated `GET /v1/orders`.
- `rotator` is internal-only and accepts typed, bearer-authenticated rotation operations.
- `consumer` reads its key file on every request to the API and exposes `GET /status`.

The registry stores key hashes and fingerprints, never raw keys. The raw key exists only in the consumer key file and transiently in the rotator process while it hands a replacement to that file.

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

## Verification

```sh
npm test
npm run typecheck
npm run build
```

The project does not make production safety claims. It demonstrates bounded local test behavior, secret-free audit evidence, and a verified replacement flow.
