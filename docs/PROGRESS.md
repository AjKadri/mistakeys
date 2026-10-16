# Project progress

Last updated: 2026-10-16

## Done

- Confirmed the repository is on `main` and tracks the GitLab project at `gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase`.
- Confirmed the repository currently contains only the starter `README.md` and an intentionally failing placeholder `.gitlab-ci.yml`.
- Confirmed there is no application source, dependency manifest, test suite, Docker configuration, server configuration, or domain configuration yet.
- Added the TypeScript service implementation, typed rotator API, consumer worker, atomic registry and audit storage, Docker Compose topology, MIT license, and replacement GitLab CI verification job.
- Added seven automated tests covering API authentication, pending and revoked states, secret non-disclosure, idempotent rotation, revoked-state protection, post-revoke failure escalation, overlap reporting, and consumer key rereads.
- Verified `npm test`, `npm run typecheck`, `npm run build`, `docker compose config`, and dependency license metadata locally.
- Fixed the Docker build output path and consumer network attachment found during Step 4. Compose now starts all services, the API and rotator are healthy, and the consumer status endpoint returns HTTP 200.

## Next

- Run the remaining Docker Compose rotation demo: capture the seeded fingerprint, rotate, verify the old key returns 401, and verify the consumer continues returning 200.
- Add GitLab Duo agent files in a later step.
- Add VPS deployment and DNS instructions only after the local service demo is verified.

## Still unverified

- Product scope and hackathon judging criteria for this project.
- Application framework, runtime version, and dependency strategy.
- GitLab CI runner availability and project CI/CD settings.
- Docker image build and Compose runtime behavior are now verified through Step 4. The complete rotation demo remains unverified.
- VPS provider, operating system, access method, firewall, reverse proxy, HTTPS, and DNS.
- Public deployment URL and any required secrets or environment variables.

## Working rule

No real secrets, private keys, or tokens belong in this repository or in chat. Secrets will be entered locally in the approved VPS or GitLab CI/CD variable locations when the deployment design is known.
