# Mistakeys

Mistakeys: a hands-off GitLab Duo agent that turns a leaked application credential into a verified rotation, deployment update and cleanup merge request.

## The problem

Small teams without a security engineer need a safe response to leaked application credentials. Detection alone leaves a live credential in circulation and makes the next steps easy to get wrong.

[GitGuardian's State of Secrets Sprawl 2026](https://www.gitguardian.com/state-of-secrets-sprawl-report-2026) found that 64% of secrets that were valid in 2022 were still active and exploitable four years later. GitGuardian also reported [28.65 million new hardcoded secrets in public GitHub commits in 2025](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/).

## How it works

```mermaid
flowchart LR
    A[Push] --> B[mistakeys_leak_scan fails]
    B --> C[GitLab Duo recovery flow]
    C --> D[Gatekeeper checks exact failed job and safe report]
    D -->|GitLab ID token| E[Rotator verifies OIDC and runs typed operations]
    E --> F[Issue replacement and update consumer]
    F --> G[Verify consumer HTTP 200]
    G --> H[Activate replacement and revoke old key]
    H --> I[Verify old key HTTP 401]
    I --> J[Cleanup MR and incident issue]
```

The agent can read the intentionally leaked file and the redacted leak report. It never prints or puts the raw credential in an issue, session, merge request, or flow result.

## Proof it works

All evidence below uses fingerprints only.

- [OIDC and JWKS authentication session 9658871](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/automate/agent-sessions/9658871) reached the rotator and safely stopped on an unregistered fingerprint.
- [Gatekeeper session 9665909](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/automate/agent-sessions/9665909) ignored a different failed job without creating recovery artifacts.
- [Successful live rotation session 9677029](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/automate/agent-sessions/9677029) and [pipeline 2962697953](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/pipelines/2962697953) changed `sha256:87fd2bd64e9a` to `sha256:93a444b2e0f8`. The consumer stayed at HTTP 200, the old key returned HTTP 401, and the measured overlap was `0.021` seconds.
- The same session produced [cleanup MR !1](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/merge_requests/1) and [incident issue #9](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/work_items/9). MR !1 was closed after evidence capture and was not merged because its branch contains the intentional demo leak.
- [Idempotent repeat session 9677770](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/automate/agent-sessions/9677770) and [pipeline 2962758043](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/pipelines/2962758043) returned `already_handled` without creating another issue, branch, commit, or merge request.

## DevSecOps stages touched

| Stage | What Mistakeys does |
| --- | --- |
| Plan | Defines the exact failed-job gate, typed recovery steps, bounded overlap, and human escalation path. |
| Create | Creates a replacement credential, updates the running consumer, and opens cleanup evidence. |
| Verify | Checks the replacement with HTTP 200, the revoked key with HTTP 401, fingerprints, overlap, and idempotence. |
| Package | Builds API, consumer, rotator, and Caddy images tagged by commit SHA. |
| Secure | Runs Gitleaks and Secret Detection, uses OIDC plus JWKS, redacts reports, and keeps the rotator unpublished. |
| Release | Deploys protected main-branch images, records the production environment, verifies the public health endpoint, and retains a previous-image rollback tag. |
| Configure | Uses protected CI variables, a VPS runtime file, Caddy routing, and a GitLab flow trigger. |
| Monitor | Records audit steps, fingerprints, overlap, consumer status, and incident evidence. |
| Govern | Uses a fail-closed gatekeeper, needs-human outcomes, issue/MR evidence, and a close-only demo-branch policy. |

## Security design

- Rotator endpoints expose typed operations rather than general credential-management commands.
- The agent has no long-lived rotator secret. It uses a short-lived GitLab OIDC ID token. The rotator verifies the issuer, audience, project path, expiration, RS256 signature, and cached GitLab JWKS. A static bearer token remains available for manual use only.
- Reports and agent output contain fingerprints, file metadata, rule IDs, and commit IDs, never raw keys. The replacement key stays on the VPS while the consumer is updated.
- Rotation is replacement-first: issue, update, verify, activate, revoke, and verify rejection. Revoked keys cannot return to active or pending state.
- Repeated handling is idempotent, and the old/new overlap is measured against a configured bound.
- The agent is allowed to read the leaked file because recovery requires the old credential, but the flow limits where that value can go and never reports it.

## Try it

Live deployment: [mistakeys.ajkadri.dev](https://mistakeys.ajkadri.dev)

From a checkout with Node 22, npm, and Docker Compose:

```sh
cp .env.example .env
# Replace the local placeholder ROTATOR_TOKEN in .env.
npm install
npm test
npm run typecheck
npm run build
docker compose up --build -d
curl -fsS http://localhost:3000/healthz
curl -fsS http://localhost:3001/status
docker compose down -v
```

For the guarded live demonstration, follow [docs/DEMO_RUN.md](docs/DEMO_RUN.md). For GitLab flow setup, see [docs/FLOW_SETUP.md](docs/FLOW_SETUP.md). For VPS setup and deployment, see [docs/SERVER_SETUP.md](docs/SERVER_SETUP.md).

## Scope and extension boundary

`orders-api` is the demonstration credential, but it stands in for any application API key whose consumer can be updated and verified. The rotator has a provider-adapter boundary. Each provider adapter must implement the same typed operations for status, issuing a replacement, updating the consumer, verifying the replacement, activating it, revoking the old key, and verifying rejection. The current adapter is the VPS credential registry and consumer.

Honest next adapters are GitLab project or deploy tokens, cloud provider access keys, and database passwords. Those adapters are not implemented here.

Credential history is not rewritten by design. A leaked value remains in demo history, so demo branches must never be merged into `main`. This repository documents a completed focused demonstration rather than a general secret manager.

## License

[MIT](LICENSE)
