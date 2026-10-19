# Project progress

Last updated: 2026-10-19

## Verified

### Product and local implementation

- TypeScript, Node 22, Hono services are implemented: authenticated API, internal rotator, and polling consumer.
- Registry and audit storage are atomic and secret-free. The local tests cover authentication, non-disclosure, idempotence, revoked-state protection, post-revoke failure escalation, overlap reporting, and consumer key rereads.
- Dockerfiles, local Compose, MIT licensing, environment templates, VPS deployment kit, Caddy HTTPS proxy, rollback, and protected deployment SSH commands are implemented.
- The API, rotator, and consumer use the intended private network memberships. The rotator also has a separate non-internal egress network for GitLab JWKS access, with no published rotator port.
- The custom `mistakeys-application-key` Gitleaks rule and fingerprint-only report tooling are implemented.
- The CI leak gate fails when either Gitleaks detects a finding or the safe report is non-empty, while publishing only the redacted report artifact.
- The recovery flow uses a GitLab OIDC ID token, cached GitLab JWKS verification, exact issuer, audience, expiration, and project-path checks, and constant-time comparison for the manual static token.
- The rotator promotes a verified replacement to `active` before revoking the old key. The rotation record now includes the activation step.
- The forced `demo-key` command is gated by `MISTAKEYS_DEMO_MODE=1`, reads only from the running consumer, logs a fingerprint only, and refuses when the flag is disabled.
- `scripts/demo-leak.sh` retrieves the live key through the restricted SSH command, creates its branch from `origin/main`, never prints the key, and prints only the branch and fingerprint.

### Local verification

- `npm test`: 9 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Gitleaks fixture and intentional demo scans failed with fingerprint-only findings as expected. A clean `origin/main` scan passed with zero findings.
- Shell syntax, ShellCheck, YAML parsing, Docker image smoke checks, and local HTTPS routing checks passed.
- Local rotation checks confirmed old-key HTTP `401`, replacement-key HTTP `200`, consumer HTTP `200`, and idempotent repeat behavior.

### GitLab, flow, and VPS verification

- GitLab OIDC authentication and GitLab JWKS egress were verified by flow session `9658871`. The flow reached the rotator, authenticated successfully, and safely stopped because the test fingerprint was unregistered.
- The non-leak gatekeeper was verified by flow session `9665909`. A failed job other than the exact `mistakeys_leak_scan` job was ignored with no issue, branch, commit, or merge request.
- The live demo retrieved the production consumer key without printing it. Its safe fingerprint was `sha256:87fd2bd64e9a`.
- Successful live rotation was verified by flow session `9677029`, pipeline `2962697953`, and the exact failed job `mistakeys_leak_scan`.
- The successful rotation changed `sha256:87fd2bd64e9a` to replacement fingerprint `sha256:93a444b2e0f8`.
- All six rotation steps passed: issue replacement, update consumer, verify new key with HTTP `200`, activate replacement, revoke old key, and verify old key with HTTP `401`.
- The measured old/new overlap was `0.021` seconds and did not exceed the configured limit. The consumer continued returning HTTP `200`.
- The successful session created cleanup MR `!1` and incident issue `#9` with fingerprint-only evidence.
- Idempotence was verified by flow session `9677770`, pipeline `2962758043`. The rotator returned HTTP `200` with `already_handled`, and the flow created no new issue, branch, commit, or merge request.
- The leak-scan pipelines failed as designed because the intentional finding was detected. The recovery sessions, not a passing leak-scan pipeline, are the success signal for this demo.
- The default branch contains the activation fix in commit `da47828` and the direct running-container demo-key fix in commit `feeb05e`.

## MR and branch safety decision

MR `!1` must be closed, not merged. Session `9677029` explicitly records that its cleanup branch was created from the demo branch and that the old value remains in git history. Merging it into `main` would bring the intentional leak commit into the default branch and could make main pipelines fail and retrigger the recovery flow.

For future demos, use one of these safe patterns:

- Target the cleanup MR at the demo branch and never merge that demo branch into `main`.
- Or create the cleanup branch from `origin/main` and apply only the safe cleanup change, without the demo branch as an ancestor.

The demo branch and any cleanup branch descended from it should be deleted after the evidence is captured. Deleting the branch does not erase its historical value, so the repository must remain private until all leaked demo refs are gone and a fresh all-ref secret audit passes.

## Remaining before submission

- Produce the final demo video.
- Finish the judge-facing README.
- Write the Devpost submission.
- Delete the intentional demo refs, rerun the secret audit, and make the repository public.
- Submit the project.

## Working rule

No real secrets, private keys, or tokens belong in this repository or in chat. Secrets must be entered only in the VPS runtime file, a local password manager or environment variable, and protected GitLab CI/CD variables.
