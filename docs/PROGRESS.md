# Project progress

Last updated: 2026-10-16

## Done

- Built the TypeScript, Node 22, Hono services: authenticated API, internal rotator, and polling consumer.
- Added atomic secret-free registry and audit storage, seeded `orders-api`, and tests for authentication, secret non-disclosure, idempotence, revoked-state protection, post-revoke failure escalation, overlap reporting, and consumer key rereads.
- Added Dockerfiles, local Compose, MIT license, environment example, and minimal service documentation.
- Verified the full local Docker rotation demo. The old key returned HTTP 401 after rotation and the consumer continued returning HTTP 200 with the replacement fingerprint.
- Added `.gitleaks.toml` with the custom `mistakeys-application-key` rule for `mk_live_` keys and redacted safe-report tooling.
- Added GitLab CI stages for tests, the exact `mistakeys_leak_scan` job, a generated fixture failure assertion, image builds tagged by commit SHA, and protected default-branch deployment.
- Included GitLab's standard Secret Detection template with `allow_failure: true`.
- Added the VPS kit: official Docker apt setup, unprivileged forced-command deploy account, Caddy HTTPS proxy, private rotator network, rate-limited bearer-protected `/rotator/*`, current/previous image tags, and rollback.
- Added [docs/SERVER_SETUP.md](SERVER_SETUP.md) with exact VPS, SSH key, GitLab variable, HTTPS, and rollback instructions.

## Verified locally in this milestone

- `npm test`: 7 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Gitleaks v8.30.1 checksum-verified binary: generated fixture scan failed as expected, safe report assertion passed, and the repository scan found no leaks.
- ShellCheck v0.10.0 container: all deployment and leak-scan scripts passed.
- Caddy v2.11.7 with the pinned `caddy-ratelimit` v0.1.0 module: Caddyfile validation passed and local HTTPS Compose returned health HTTP 200, unauthenticated API HTTP 401, unauthenticated rotator HTTP 401, and an authenticated safe rotator status response.

## Next

- Add GitLab Duo agent files in a later step.
- Copy the deployment kit to the VPS and run `setup.sh` as root.
- Create the server registry pull token, rotator token, SSH key variables, and protected GitLab CI/CD variables locally in their approved locations.
- Push a protected default-branch commit and verify the real GitLab pipeline, Container Registry, forced SSH deployment, public DNS, HTTPS certificate, and rollback.

## Still unverified

- GitLab CI runner availability, the included template behavior in this project, Container Registry permissions, and the real pipeline result.
- Ubuntu 26.04 package availability from Docker's official repository on the target VPS.
- VPS firewall, SSH hardening, Docker service, public DNS, Caddy certificate issuance, public API, rotator rate limiting, deployment, and rollback.
- GitLab Duo agent behavior and hackathon submission requirements.

## Working rule

No real secrets, private keys, or tokens belong in this repository or in chat. Secrets must be entered only in the VPS runtime file, a local password manager or environment variable, and protected GitLab CI/CD variables.
