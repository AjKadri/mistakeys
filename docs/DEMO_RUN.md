# Clean live demo run

Use this checklist to record one live recovery run. The demo intentionally leaks the current `orders-api` credential, so it must stay isolated from `main`.

Never paste or print the key. The only value to record is the fingerprint printed by `scripts/demo-leak.sh`.

## Before recording

- Confirm the Mistakeys recovery flow is enabled with its failed-pipeline trigger on.
- Confirm no other recovery session or relevant pipeline is running.
- Confirm the current production deployment is healthy and the rotator has GitLab JWKS egress.
- Confirm the VPS has `MISTAKEYS_DEMO_MODE=0`. Enable it only for the few seconds needed by the demo script.
- Load the restricted deployment key:

  ```sh
  ssh-add ~/.ssh/mistakeys-ci-deploy
  ```

- Choose a unique branch name and export it in every terminal used for the recording:

  ```sh
  export DEMO_BRANCH=demo/recording-YYYYMMDD-HHMMSS
  ```

Do not start a second demo until the first demo branch, cleanup MR, and session are finished.

## Open the tabs

Open these before starting:

1. Consumer status. The consumer is intentionally private, so use the status terminal poll below rather than exposing a port in a browser.
2. A terminal polling the old key's HTTP status. It waits for the demo branch, then prints status codes only.
3. GitLab `Build > Pipelines`.
4. GitLab `AI > Sessions`.
5. GitLab `Plan > Work items` or Issues.
6. GitLab `Code > Merge requests`.

Useful browser URLs:

- [Public health check](https://mistakeys.ajkadri.dev/healthz)
- [Pipelines](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/pipelines)
- [AI sessions](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/automate/agent-sessions)
- [Issues](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/issues)
- [Merge requests](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase/-/merge_requests)

Old-key status poll. Run this in a terminal tab. It never prints the key. It consumes the branch file as a temporary curl configuration and prints only `200`, `401`, or a waiting status:

```sh
while :; do
  if git cat-file -e "$DEMO_BRANCH:demo/leaked-orders-key.txt" 2>/dev/null; then
    code="$(git show "$DEMO_BRANCH:demo/leaked-orders-key.txt" |
      sed 's/^MISTAKEYS_TEST_KEY=/header = "Authorization: Bearer /; s/$/"/' |
      curl --silent --show-error --config - --output /dev/null --write-out '%{http_code}' \
        https://mistakeys.ajkadri.dev/v1/orders 2>/dev/null)" || code=000
    printf '%s leaked_key=%s\n' "$(date '+%H:%M:%S')" "$code"
  else
    printf '%s waiting_for_demo_branch\n' "$(date '+%H:%M:%S')"
  fi
  sleep 1
done
```

Consumer status poll. Run this in the consumer-status terminal tab. It prints status and fingerprints, never the key:

```sh
while :; do ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" \
  'docker exec deploy-consumer-1 node --input-type=module -e "const r=await fetch(\\"http://127.0.0.1:3001/status\\"); const b=await r.json(); console.log(JSON.stringify({status:b.status,last_result:b.last_result,fingerprint:b.fingerprint,last_checked_at:b.last_checked_at}));"' \
  2>/dev/null || true; sleep 1; done
```

## Run the demo

1. Turn on demo-key access for this run only:

   ```sh
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" \
     'if grep -q "^MISTAKEYS_DEMO_MODE=" /etc/mistakeys/runtime.env; then sed -i "s/^MISTAKEYS_DEMO_MODE=.*/MISTAKEYS_DEMO_MODE=1/" /etc/mistakeys/runtime.env; else printf "\nMISTAKEYS_DEMO_MODE=1\n" >> /etc/mistakeys/runtime.env; fi'
   ```

2. In the run terminal, create and push the intentional leak from `origin/main`:

   ```sh
   MISTAKEYS_DEMO_BRANCH="$DEMO_BRANCH" ./scripts/demo-leak.sh
   ```

   The only output should be the branch and a truncated SHA-256 fingerprint, for example:

   ```text
   branch=demo/recording-YYYYMMDD-HHMMSS fingerprint=sha256:xxxxxxxxxxxx
   ```

3. Turn demo-key access off immediately:

   ```sh
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" \
     'sed -i "s/^MISTAKEYS_DEMO_MODE=.*/MISTAKEYS_DEMO_MODE=0/" /etc/mistakeys/runtime.env'
   ```

4. Watch the UI in this order:

   - The new pipeline appears and `mistakeys_leak_scan` fails. That failure is intentional and is the trigger.
   - A new AI session appears. The gatekeeper accepts only that exact failed job and reads the safe report.
   - The rotator authenticates with the GitLab ID token, issues a replacement, updates the consumer, verifies HTTP 200, activates the replacement, revokes the old key, and verifies HTTP 401.
   - The consumer poll stays at HTTP 200 and changes to the replacement fingerprint.
   - The old-key poll changes from HTTP 200 to HTTP 401.
   - The session links to a cleanup MR and a confidential incident issue. Both contain fingerprints and evidence, not the raw key.

## Show idempotence

Before deleting the demo branch, re-run the failed pipeline from its pipeline page. Use the pipeline-level `Retry` action, not only the failed-job retry. If the UI does not offer a whole-pipeline retry, start a new pipeline on the same demo branch.

The second leak scan should fail again, the recovery flow should report `already_handled`, and no new incident issue, cleanup branch, commit, or merge request should be created. This is the scripted idempotence moment.

## After recording

1. Close the new cleanup MR without merging it. Its branch descends from the demo branch and contains the intentional leak commit. Merging it into `main` would put that commit on the default branch.
2. Stop both polling terminals with Ctrl-C.
3. Confirm demo mode is off:

   ```sh
   ssh -p "${VPS_SSH_PORT:-22}" root@"$MISTAKEYS_VPS_HOST" \
     'grep "^MISTAKEYS_DEMO_MODE=" /etc/mistakeys/runtime.env'
   ```

   The result must be `MISTAKEYS_DEMO_MODE=0`.

4. Delete the demo branch only after the idempotence session and evidence capture are complete:

   ```sh
   git switch main
   git branch -D "$DEMO_BRANCH"
   git push origin --delete "$DEMO_BRANCH"
   unset DEMO_BRANCH
   ```

5. Delete the closed cleanup-MR source branch as well if GitLab did not delete it automatically. Then rerun the all-ref secret audit before making the repository public.
