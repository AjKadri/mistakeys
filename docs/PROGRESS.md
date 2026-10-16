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
- Completed the local Docker rotation demo: the seeded key was rotated, the old key returned HTTP 401, and the consumer continued returning HTTP 200 with the replacement fingerprint.

## Next

- Add GitLab Duo agent files in a later step.
- Add VPS deployment and DNS instructions only after the agent workflow is implemented and reviewed.

## Still unverified

- Product scope and hackathon judging criteria for this project.
- Application framework, runtime version, and dependency strategy.
- GitLab CI runner availability and project CI/CD settings.
- Docker image build, Compose runtime behavior, and the complete local rotation demo are verified.
- GitLab Duo agent behavior, GitLab CI execution, VPS deployment, DNS, and public HTTPS remain unverified.
- VPS provider, operating system, access method, firewall, reverse proxy, HTTPS, and DNS.
- Public deployment URL and any required secrets or environment variables.

## Working rule

No real secrets, private keys, or tokens belong in this repository or in chat. Secrets will be entered locally in the approved VPS or GitLab CI/CD variable locations when the deployment design is known.
