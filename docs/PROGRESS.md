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
- Adapted the VPS kit for the existing host Caddy: public ports 80 and 443 remain with the existing service, while Mistakeys Caddy binds only to loopback port 18080. The setup script does not start the application or alter existing sites.
- Added [docs/SERVER_SETUP.md](SERVER_SETUP.md) with exact VPS, SSH key, GitLab variable, HTTPS, and rollback instructions.

## Verified locally in this milestone

- `npm test`: 7 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Gitleaks v8.30.1 checksum-verified binary: generated fixture scan failed as expected, safe report assertion passed, and the repository scan found no leaks.
- ShellCheck v0.10.0 container: all deployment and leak-scan scripts passed.
- Caddy v2.11.7 with the pinned `caddy-ratelimit` v0.1.0 module: Caddyfile validation passed and local HTTPS Compose returned health HTTP 200, unauthenticated API HTTP 401, unauthenticated rotator HTTP 401, and an authenticated safe rotator status response.
- The loopback-safe Compose configuration parses locally. The local HTTPS rerun after this VPS adaptation passed: health HTTP 200, seeded consumer HTTP 200, old key HTTP 401 after rotation, and replacement consumer HTTP 200.
- ShellCheck v0.10.0 passed again after the deployment adjustment, and the generated gitleaks fixture still failed safely with a fingerprint-only report.

## Next

- Add GitLab Duo agent files in a later step.
- Copy the deployment kit to the VPS and run `setup.sh` as root. The target VPS has already partly run setup, but no application containers have been started.
- Add the `mistakeys.ajkadri.dev` reverse proxy to the existing host Caddy and configure the VPS runtime registry credentials and tokens without sharing them in chat.
- Create the server registry pull token, rotator token, SSH key variables, and protected GitLab CI/CD variables locally in their approved locations.
- Push a protected default-branch commit and verify the real GitLab pipeline, Container Registry, forced SSH deployment, public DNS, HTTPS certificate, and rollback.

## Still unverified

- GitLab CI runner availability, the included template behavior in this project, Container Registry permissions, and the real pipeline result.
- Ubuntu 26.04 package availability from Docker's official repository on the target VPS.
- VPS runtime credentials, the existing host Caddy route, loopback port 18080, public DNS, Caddy certificate issuance, public API, rotator rate limiting, deployment, and rollback.
- The VPS manager reported Docker installed, SSH password and keyboard-interactive login disabled, and UFW active for 22, 80, and 443. These host-side reports have not been independently verified from this workspace.
- VPS inspection then found `/opt/mistakeys/deploy/docker-compose.yml` was still an older copy with public-port defaults. The direct Compose render also lacked the derived `API_IMAGE`, `ROTATOR_IMAGE`, and `CONSUMER_IMAGE` variables that `deployctl.sh` supplies. Recopy the current deploy directory before starting anything.
- The current deploy directory has been recopied to the VPS, and the VPS runtime file now reports non-empty `REGISTRY_USER`, `REGISTRY_PASSWORD`, and `ROTATOR_TOKEN` values. Secret contents remain unverified by design.
- GitLab Duo agent behavior and hackathon submission requirements.

## Working rule

No real secrets, private keys, or tokens belong in this repository or in chat. Secrets must be entered only in the VPS runtime file, a local password manager or environment variable, and protected GitLab CI/CD variables.
