# Project progress

Last updated: 2026-10-18

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
- Completed a pre-publication secret audit over the full reachable history of the locally available refs. Both default Gitleaks rules and the custom `mistakeys-application-key` rule found zero findings. No credential rotation or history rewrite is indicated by this audit.
- Hardened `.gitignore` for runtime `.env` files, private key and certificate files, and registry or audit data files.
- Removed the image build's `apk add su-exec` dependency after repeated GitLab shared-runner stalls at that step. The entrypoint now uses BusyBox `su` already present in `node:22-alpine` while retaining non-root execution and volume initialization.

## Verified locally in this milestone

- `npm test`: 7 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Gitleaks v8.30.1 checksum-verified binary: generated fixture scan failed as expected, safe report assertion passed, and the repository scan found no leaks.
- ShellCheck v0.10.0 container: all deployment and leak-scan scripts passed.
- Caddy v2.11.7 with the pinned `caddy-ratelimit` v0.1.0 module: Caddyfile validation passed and local HTTPS Compose returned health HTTP 200, unauthenticated API HTTP 401, unauthenticated rotator HTTP 401, and an authenticated safe rotator status response.
- The loopback-safe Compose configuration parses locally. The local HTTPS rerun after this VPS adaptation passed: health HTTP 200, seeded consumer HTTP 200, old key HTTP 401 after rotation, and replacement consumer HTTP 200.
- ShellCheck v0.10.0 passed again after the deployment adjustment, and the generated gitleaks fixture still failed safely with a fingerprint-only report.
- Gitleaks v8.30.1 scanned all 23 commits reachable from `main`, `origin/main`, and `origin/HEAD` with `--log-opts=--all`; default rules and the custom rule both exited 0 with zero findings. A separate complete-key search found zero `mk_live_[A-Za-z0-9]{32}` occurrences.
- History checks found no private-key material, VPS IP, GitLab or API token prefixes, bearer literals, tracked runtime `.env` files, registry or audit data files, or raw key material. The only tracked environment files are `.env.example` and `deploy/.env.local.example`, both templates.
- The root `LICENSE` is the MIT License. Runtime registry, audit, and consumer-key data are Docker volumes and are not repository files.
- `npm test`, `npm run typecheck`, `npm run build`, and ShellCheck passed after the entrypoint change. A local Docker build completed successfully, and an image smoke test confirmed UID 100 execution, environment preservation, and writes to `/data` and `/secrets`.

## Verified in GitLab and on the VPS

- User-provided GitLab evidence shows pipeline `#2957137523` for commit `de7b353` passed all six jobs: `secret_detection`, `test`, `mistakeys_leak_scan`, `mistakeys_leak_scan_fixture`, `build_images`, and `deploy_production`.
- User-provided live checks returned HTTPS health `200`, unauthenticated orders `401`, unauthenticated rotator `401`, and consumer `last_result: 200` with fingerprint `sha256:529176425f23`.
- The real CI build and deploy path and the first public service checks are verified. No raw key was used in the chat or HTTP responses shown here.
- User-provided live rotation evidence shows `sha256:529176425f23` rotated to `sha256:87fd2bd64e9a` with overlap `0.023` seconds, new-key HTTP 200, old-key HTTP 401, and consumer HTTP 200 after the update. Repeating the same leaked fingerprint returned `already_handled` with the earlier result.
- User-provided deploy status shows current SHA `de7b35361adfe7a50dec6727639f8da91debb66c`, API and rotator healthy, consumer running, and Caddy bound only to loopback ports `18080` and `18443`. `previous_sha` is empty because this is the first deployment.
- User-provided second-deployment status shows current SHA `10e64530cf1d761fdbe1a0b3b0a7f808ecba1795` and previous SHA `de7b35361adfe7a50dec6727639f8da91debb66c`, with API and rotator healthy and the consumer running.
- User-provided rollback evidence shows the deployment returned to `de7b35361adfe7a50dec6727639f8da91debb66c`, retained `10e64530cf1d761fdbe1a0b3b0a7f808ecba1795` as `previous_sha`, kept API and rotator healthy, and preserved public HTTPS health `200`.
- User-provided public rate-limit evidence returned 30 HTTP 401 responses followed by HTTP 429 on the 31st unauthenticated rotator request.
- User-provided post-rollback consumer evidence returned `last_result: 200` with replacement fingerprint `sha256:87fd2bd64e9a`.
- User-provided GitLab evidence shows final pipeline `#295721880` for commit `4a03f3e2` passed all stage jobs, including the deployment job.
- User-provided GitLab evidence shows pipeline `#2960839313` for commit `4be7a65` passed all stages in 2 minutes 43 seconds after replacing the stalled `su-exec` package install. The image build and deployment jobs passed.

## Next

- Add GitLab Duo agent files in a later step.

## Still unverified

- GitLab Duo agent behavior and hackathon submission requirements.
- The patched image's post-deployment public health, consumer status, and VPS container status have not yet been rechecked after pipeline `#2960839313`.
- GitLab server-side refs that are not present in the local clone. The audit covered every commit reachable from the locally available refs: `main`, `origin/main`, and `origin/HEAD`; no local tags or other branches were present.
- Ubuntu 26.04 package availability from Docker's official repository on the target VPS.
- The VPS manager reported Docker installed, SSH password and keyboard-interactive login disabled, and UFW active for 22, 80, and 443. These host-side reports have not been independently verified from this workspace.
- The current deploy directory has been recopied to the VPS, and the VPS runtime file now reports non-empty `REGISTRY_USER`, `REGISTRY_PASSWORD`, and `ROTATOR_TOKEN` values. Secret contents remain unverified by design. A direct VPS `docker login` using those values returned `Login Succeeded`.
- The existing system Caddy is active. The `mistakeys.ajkadri.dev` reverse proxy to `127.0.0.1:18080` was added, validated successfully, and reloaded. Public HTTPS health and protected-route checks now pass. The Caddy formatter warning remains cosmetic.
- The restricted VPS deploy SSH path is now verified: the deploy key is accepted and `status` returns the deployed current and previous SHAs. The account shell was changed from `/usr/sbin/nologin` to `/bin/sh` so OpenSSH can run the authorized forced command. `deploy/setup.sh` now applies that shell idempotently for both new and existing accounts.

## Working rule

No real secrets, private keys, or tokens belong in this repository or in chat. Secrets must be entered only in the VPS runtime file, a local password manager or environment variable, and protected GitLab CI/CD variables.
