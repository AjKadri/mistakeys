# Devpost draft

## Inspiration

Small teams without a security engineer can detect a leaked key and still be left with the hardest part: changing the credential without breaking the application, proving the old key is dead, or cleaning up the repository. Mistakeys turns that response into a bounded, auditable workflow.

## What it does

Mistakeys watches for a deliberately failing leak-scan job. A GitLab Duo flow checks that the failure is the expected one, reads the safe leak report, and calls a typed rotator. The rotator creates a replacement, updates the consumer, verifies the consumer still returns HTTP 200, activates the replacement, revokes the leaked key, and verifies that the old key returns HTTP 401. The flow then opens a cleanup merge request and a confidential incident issue with fingerprints and evidence only.

The live demo uses `orders-api`, which stands in for any application API key whose consumer can be updated and verified. The rotator has a provider-adapter boundary: an adapter must implement typed operations for status, replacement, consumer update, verification, activation, revocation, and rejection checks. Honest next adapters are GitLab project or deploy tokens, cloud provider keys, and database passwords. They are not implemented in this project.

## How we built it

GitLab CI runs tests, Secret Detection, a pinned Gitleaks scan, image builds, a protected production deployment, and a public `/healthz` verification job. The failed scan is the trigger for a GitLab Duo flow. The flow uses a short-lived GitLab ID token. The rotator verifies the issuer, audience, project path, expiration, RS256 signature, and cached GitLab JWKS before accepting the request. Its endpoints are typed operations, and the agent has no long-lived rotator secret.

The consumer switches to the replacement without exposing the replacement outside the VPS. Reports and agent sessions use fingerprints only. Rotation is replacement-first, has a bounded overlap, and is idempotent. Re-running the failed pipeline produces `already_handled` instead of another incident or cleanup branch.

## Challenges

The main challenges were getting an OIDC token into a flow job, giving the rotator outbound access only for JWKS retrieval, and making the gatekeeper ignore unrelated failed jobs. The demo also needed to prove both service continuity and rejection of the leaked key.

## Accomplishments

The live run kept the consumer at HTTP 200, changed the credential fingerprint, and made the leaked fingerprint return HTTP 401. It produced a cleanup MR and incident evidence. A repeat run was handled idempotently.

## What we learned

Credential rotation is only trustworthy when the replacement is verified before the old key is revoked, and when the agent records enough evidence for a human to audit without receiving the secret itself. Provider-specific work belongs behind a typed adapter boundary.

## What’s next

Implement additional provider adapters, support more consumer types, and preserve the same replacement-first and evidence requirements for each adapter.

## Submission media

- [VIDEO LINK]
- [SCREENSHOT: 200→401 terminal]
- [SCREENSHOT: incident #10]
- [SCREENSHOT: agent session]
- [SCREENSHOT: already_handled session]

Capture the consumer status poll while it remains at 200, the old-key poll changing to 401, the incident issue with fingerprints only, the successful agent session with its cleanup MR, and the repeat session showing `already_handled`. Do not capture or include any raw credential.
