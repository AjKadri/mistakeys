# GitLab Duo recovery flow setup

This document covers the project-specific setup for `flows/mistakeys-recovery.yaml`. The flow is designed for one trigger only: a human push that produces a failed pipeline. It must not be enabled for mentions, assignments, merge requests, passed pipelines, or canceled pipelines.

The flow is not locally executable. Local checks can validate the YAML and the shell script, but only GitLab can validate the custom-flow registry, the trigger payload, the available service-account permissions, the runner network policy, and the flow's environment variables.

## 1. Commit and push the configuration

From the repository checkout:

```sh
git add .gitignore README.md .gitlab/duo/agent-config.yml flows/mistakeys-recovery.yaml docs/FLOW_SETUP.md scripts/demo-leak.sh docs/PROGRESS.md
git commit -m "feat: add Duo leaked credential recovery flow"
git push origin main
```

The pipeline for this commit should run the existing test, leak scan, build, and deployment jobs. The new `.gitlab/duo/agent-config.yml` is read from the default branch for flow execution.

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

## 4. Make `ROTATOR_TOKEN` available to the flow

Do not paste the token into chat, the repository, the flow YAML, an issue, or a merge request.

The flow calls the existing HTTPS proxy with `Authorization: Bearer $ROTATOR_TOKEN`. The checked-in agent config fails closed when that variable is absent and only allows outbound access to `mistakeys.ajkadri.dev`.

There is an important current-platform caveat. GitLab's flow-execution documentation says custom project, group, and instance CI/CD variables are not available in flow jobs. It documents runner environment variables and `setup_script` as the supported ways to provide execution settings, but the exact secret-injection UI for GitLab-hosted flow runners was not verified here.

Use this order:

1. In the flow or trigger settings, look for a documented `Variables`, `Secrets`, or execution-environment field. If it exists, add `ROTATOR_TOKEN` there as a masked secret and verify that it is injected into the flow job without appearing in logs.
2. If that setting does not exist, use a runner you control. Configure `ROTATOR_TOKEN` in the runner's service environment, or in the runner configuration's environment list, directly on the runner host. Do not commit the value. Restart the runner and confirm the flow job sees a non-empty variable without printing it.
3. Do not assume that adding `ROTATOR_TOKEN` under `Settings` > `CI/CD` > `Variables` is sufficient. Current GitLab docs explicitly say custom CI/CD variables are unavailable to flow jobs. This is an unverified project setup assumption until a safe flow run confirms it.

The existing public proxy is already configured at `https://mistakeys.ajkadri.dev`. The flow runner must be able to resolve and reach that hostname over HTTPS. The domain allowlist is checked into `.gitlab/duo/agent-config.yml`, but reachability from GitLab's actual runner cannot be verified from this workspace.

## 5. Disable the old flow

After the new flow has been saved, go to `AI` > `Flows` and find the old flow named `test flow`.

1. Open its menu or configuration page.
2. Disable its trigger, or turn off its enabled toggle.
3. Confirm that `test flow` has no enabled trigger left.

Do this before the first failed-pipeline test. The old flow is not changed by this repository commit, and its current GitLab UI state is not visible from this workspace.

## 6. Cheapest test sequence

Run these tests in order and stop at the first failure:

1. Locally parse the YAML and run the shell syntax check:

   ```sh
   ruby -e 'require "yaml"; YAML.load_file("flows/mistakeys-recovery.yaml"); YAML.load_file(".gitlab/duo/agent-config.yml"); puts "YAML OK"'
   sh -n scripts/demo-leak.sh
   ```

2. In GitLab, save the flow and confirm it shows as valid. This costs no GitLab Credits.
3. Trigger one failed pipeline where the failed job is not named `mistakeys_leak_scan`. Confirm one agent session starts, then confirm it creates no issue, branch, note, or merge request. This tests the gatekeeper at the lowest live cost. The earlier live test consumed 1.26 GitLab Credits, so budget about that amount for a simple session and measure the actual result in `AI` > `Sessions` or the Credits dashboard.
4. Run a controlled leak-scan test with a demo-only key. Confirm the flow can retrieve `leak-report.json`, reach the public status endpoint, and recognize the fingerprint. If the fingerprint is not registered in the deployed rotator, the expected safe result is a `needs human` incident issue and no cleanup MR.
5. Only after the previous checks pass, run the full demo script. Confirm the cleanup MR contains no raw key, the MR warns that git history still contains the old value, and the incident issue contains fingerprints and step timestamps only.
6. Repeat the same failed pipeline or fingerprint only after the first run is complete. The expected rotator response is `already_handled`; the flow should report that result and make no second MR or issue.

## What remains unverified

- The GitLab UI labels and exact create-flow form may differ from the wording above.
- The project has not verified that the checked-in custom flow passes the live GitLab registry validator.
- The available tool names are documented by GitLab as `get_pipeline_failing_jobs`, `get_job_logs`, `gitlab_api_get`, `create_issue`, `create_merge_request`, and `run_command`, but their exact runtime parameter schemas and permissions are not locally testable.
- Current docs say pipeline event goals receive the full webhook payload, but the exact payload shape for this project must be confirmed from the first session.
- Current docs say custom CI/CD variables are unavailable to flow jobs. How to inject `ROTATOR_TOKEN` into a GitLab-hosted flow runner remains unverified. The flow therefore fails closed if the variable is missing.
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
