# GitLab Duo recovery flow setup

This document covers the project-specific setup for `flows/mistakeys-recovery.yaml`. The flow is designed for one trigger only: a human push that produces a failed pipeline. It must not be enabled for mentions, assignments, merge requests, passed pipelines, or canceled pipelines.

The flow is not locally executable. Local checks can validate the YAML and the shell script, but only GitLab can validate the custom-flow registry, the trigger payload, the available service-account permissions, the runner network policy, and the flow's environment variables.

## 1. Commit the configuration

From the repository checkout:

```sh
git add .env.example .gitlab/duo/agent-config.yml deploy/.env.local.example deploy/docker-compose.yml docker-compose.yml docs/FLOW_SETUP.md docs/PROGRESS.md docs/SERVER_SETUP.md flows/mistakeys-recovery.yaml package-lock.json package.json src/gitlab-id-token.ts src/rotator-app.ts src/rotator.ts test/gitlab-id-token.test.ts
git commit -m "fix: authenticate recovery flow with GitLab ID token"
```

Push only after the updated deploy kit has been copied to the VPS in section 5. The pipeline for this commit should run the existing test, leak scan, build, and deployment jobs. The new `.gitlab/duo/agent-config.yml` is read from the default branch for flow execution.

## 2. Create the flow in GitLab

1. Open the Mistakeys project in GitLab.
2. In the left sidebar, select `AI` > `Flows`.
3. Select `New flow` or `Create flow`.
4. Give it a clear UI name such as `Mistakeys recovery`.
5. Choose the option to define or paste a custom flow configuration.
6. Open `flows/mistakeys-recovery.yaml` locally and paste its complete contents into the YAML editor.
7. Save the flow.
8. If GitLab reports a schema error, stop and copy only the validation message and the affected field. Do not paste any secret or token.

The current custom-flow schema requires `version: "v1"`, `environment: ambient`, components, routers, and an entry point. It rejects top-level `name`, `description`, and `product_group`, model fields inside prompts, and `stop` inside prompt parameters. These constraints are reflected in the checked-in YAML.

## 3. Configure exactly one trigger

1. On the flow page, open `Trigger conditions`, or open the project sidebar `AI` > `Triggers` and select `New flow trigger`.
2. Select `Pipeline events`.
3. Under `Run when`, select `Failed` only.
4. Do not select `Running`, `Passed`, `Canceled`, `Mention`, `Assign`, `Assign reviewer`, or any merge-request/work-item event.
5. Select the service account/composite identity that has permission to read pipeline jobs and artifacts, create branches and commits, create merge requests, and create issues.
6. Select this custom flow as the configuration source.
7. Save or enable the trigger.

GitLab's current docs say pipeline triggers receive the full pipeline webhook payload as `context:goal`, and that triggers run only after a human action. The live test recorded in the project also showed an empty `builds` list, so the flow deliberately looks up failed jobs through GitLab tools.

## 4. Use the GitLab ID token

No token setup is needed in GitLab CI/CD variables. `.gitlab/duo/agent-config.yml` declares an ID token named `MISTAKEYS_ID_TOKEN` with audience `https://mistakeys.ajkadri.dev`. The flow passes it as `Authorization: Bearer ${MISTAKEYS_ID_TOKEN}`. The rotator accepts that token after verifying GitLab's RS256 signature, issuer, audience, expiration, and exact `project_path`. `ROTATOR_TOKEN` remains available only for manual use.

Do not paste any token into chat, the repository, the flow YAML, an issue, or a merge request.

GitLab documents ID tokens for flow jobs, but this project has not verified whether the `MISTAKEYS_ID_TOKEN` environment variable is visible to `run_command` inside the agent sandbox. The first cheap live test must check that without printing the token.

Use this first-test procedure:

1. Trigger one controlled failed pipeline using an unregistered demo-only key in the exact job `mistakeys_leak_scan`.
2. Watch the flow session. It must reach the rotator status request and receive either a normal status response or a controlled HTTP 401. A normal response for the unregistered fingerprint must create a needs-human incident with no rotation, branch, or merge request. A 401 or command failure must create a needs-human incident stating that rotator authentication was unavailable, without mentioning token contents, and create no branch or merge request.
3. Never print, inspect, or paste the token. A successful status response proves visibility and authentication. A controlled 401 proves the command reached the rotator but the token was not accepted, so stop and diagnose before any rotation test.

The existing public proxy is already configured at `https://mistakeys.ajkadri.dev`. The flow runner must be able to resolve and reach that hostname over HTTPS. The domain allowlist is checked into `.gitlab/duo/agent-config.yml`, but reachability from GitLab's actual runner cannot be verified from this workspace.

## 5. Redeploy before the flow test

The rotator must run the code containing the GitLab ID-token verifier before the flow test.

1. Commit the reviewed changes from section 1.
2. Copy the updated public deploy kit to the VPS. The CI deploy job promotes images but does not copy the mounted Caddyfile or install the forced SSH command:

   ```sh
   cd /Users/admin/Documents/Hackathons/mistakeys
   scp -P "${VPS_SSH_PORT:-22}" -r deploy/. root@"$MISTAKEYS_VPS_HOST":/root/mistakeys-deploy/
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" 'cp -a /root/mistakeys-deploy/. /opt/mistakeys/deploy/'
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" 'chown -R root:mistakeys-deploy /opt/mistakeys/deploy'
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" 'find /opt/mistakeys/deploy -type d -exec chmod 0750 {} \;'
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" 'find /opt/mistakeys/deploy -type f -exec chmod 0640 {} \;'
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" 'chmod 0750 /opt/mistakeys/deploy/setup.sh /opt/mistakeys/deploy/deployctl.sh /opt/mistakeys/deploy/mistakeys-deploy-command'
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" 'install -o root -g root -m 0755 /opt/mistakeys/deploy/mistakeys-deploy-command /usr/local/libexec/mistakeys-deploy-command'
   ```

3. Push `main` after the copy completes:

   ```sh
   git push origin main
   ```

4. Wait for the `build_images` and `deploy_production` jobs on `main` to pass.
5. Confirm the public health endpoint is healthy and manually confirm the existing static bearer path still works. Keep the manual token in a password manager or local shell only.
6. Only after deployment succeeds, run the first cheap flow test from section 4.

## 6. Live production-key demo

The full demo intentionally leaks the current `orders-api` consumer key. This is a deliberate test fixture, not a normal credential workflow. The `demo-key` forced SSH command refuses unless `/etc/mistakeys/runtime.env` contains exactly `MISTAKEYS_DEMO_MODE=1`. When allowed, it reads the key only from the running consumer container, logs one fingerprint-only line, and sends the key over the restricted deploy SSH connection to `scripts/demo-leak.sh`.

The script writes the key to a demo-only branch so the leak scanner produces a real finding. The recovery agent then calls the rotator, updates the consumer to a replacement that never leaves the VPS, verifies the replacement, and revokes the leaked production key. The intentional exposure lasts only for the short recovery run, normally seconds; use the recorded overlap and HTTP results as the evidence. The flow sees fingerprints and statuses, never the replacement key.

Before the live demo, set the flag directly on the VPS and verify that the deploy key is available to the local `ssh` command:

```sh
ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" \
  'if grep -q "^MISTAKEYS_DEMO_MODE=" /etc/mistakeys/runtime.env; then
     sed -i "s/^MISTAKEYS_DEMO_MODE=.*/MISTAKEYS_DEMO_MODE=1/" /etc/mistakeys/runtime.env
   else
     printf "\\nMISTAKEYS_DEMO_MODE=1\\n" >> /etc/mistakeys/runtime.env
   fi'
ssh-add ~/.ssh/mistakeys-ci-deploy
./scripts/demo-leak.sh
```

Immediately after the demo, set `MISTAKEYS_DEMO_MODE=0` or remove the line. Do not leave live-key export enabled.

The expected first run is one recovery session, a successful status and rotation, a consumer HTTP 200 with the replacement, the leaked fingerprint returning HTTP 401, one cleanup merge request, and one incident issue containing fingerprints, timestamps, and links only. The original demo branch retains the leaked value in history by design; the cleanup merge request must warn about that.

Repeat the same failed pipeline only after the first run is complete. The second session must report `already_handled` and create no second rotation, issue, branch, or merge request.

## 7. Disable the old flow

After the new flow has been saved, go to `AI` > `Flows` and find the old flow named `test flow`.

1. Open its menu or configuration page.
2. Disable its trigger, or turn off its enabled toggle.
3. Confirm that `test flow` has no enabled trigger left.

Do this before the first failed-pipeline test. The old flow is not changed by this repository commit, and its current GitLab UI state is not visible from this workspace.

## 8. Cheapest test sequence

Run these tests in order and stop at the first failure:

1. Locally parse the YAML and run the shell syntax check:

   ```sh
   ruby -e 'require "yaml"; YAML.load_file("flows/mistakeys-recovery.yaml"); YAML.load_file(".gitlab/duo/agent-config.yml"); puts "YAML OK"'
   sh -n scripts/demo-leak.sh
   ```

2. In GitLab, save the flow and confirm it shows as valid. This costs no GitLab Credits.
3. After the rotator redeploy, run the controlled `mistakeys_leak_scan` failure described in section 4. This is the first live test because it checks ID-token visibility inside `run_command` before any rotation.
4. If that passes, trigger one failed pipeline where the failed job is not named `mistakeys_leak_scan`. Confirm one agent session starts, then confirm it creates no issue, branch, note, or merge request. This tests the gatekeeper at the lowest live cost. The earlier live test consumed 1.26 GitLab Credits, so budget about that amount for a simple session and measure the actual result in `AI` > `Sessions` or the Credits dashboard.
5. Run the live production-key demo from section 6. Confirm the flow can retrieve `leak-report.json`, reach the public status endpoint, rotate the registered fingerprint, and recognize the replacement result.
6. Confirm the cleanup MR contains no raw key, the MR warns that git history still contains the old value, and the incident issue contains fingerprints and step timestamps only.
7. Repeat the same failed pipeline or fingerprint only after the first run is complete. The expected rotator response is `already_handled`; the flow should report that result and make no second MR or issue.

## What remains unverified

- The GitLab UI labels and exact create-flow form may differ from the wording above.
- The project has not verified that the checked-in custom flow passes the live GitLab registry validator.
- The available tool names are documented by GitLab as `get_pipeline_failing_jobs`, `get_job_logs`, `gitlab_api_get`, `create_issue`, `create_merge_request`, and `run_command`, but their exact runtime parameter schemas and permissions are not locally testable.
- Current docs say pipeline event goals receive the full webhook payload, but the exact payload shape for this project must be confirmed from the first session.
- Whether GitLab exposes `MISTAKEYS_ID_TOKEN` to `run_command` inside the agent sandbox remains unverified. The first exact `mistakeys_leak_scan` test checks this before any rotation attempt.
- The network policy allows only `mistakeys.ajkadri.dev`, but runner DNS, TLS, and outbound reachability must be tested in GitLab.
- Service-account permissions, issue/MR creation permissions, and the required composite identity setup must be tested in GitLab.
- The cleanup editor is instructed to preserve repository conventions. Its exact replacement may require a human review before merging.

## References

- [Custom flow YAML schema](https://docs.gitlab.com/user/duo_agent_platform/flows/custom_flows_schema/)
- [Flow Registry Framework v1](https://docs.gitlab.com/user/duo_agent_platform/flows/claude-edit-v1-flow-registry/)
- [Agent tools](https://docs.gitlab.com/user/duo_agent_platform/agents/tools/)
- [Triggers](https://docs.gitlab.com/user/duo_agent_platform/triggers/)
- [Flow execution](https://docs.gitlab.com/user/duo_agent_platform/flows/execution/)
- [Flow execution variables](https://docs.gitlab.com/user/duo_agent_platform/flows/execution_variables/)
