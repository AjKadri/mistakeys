# Mistakeys VPS setup

This kit deploys the three Mistakeys services on an Ubuntu 26.04 LTS VPS. Caddy is the only internet-facing application container. It terminates HTTPS for `mistakeys.ajkadri.dev`, proxies normal traffic to `api`, and proxies `/rotator/*` to the internal rotator only after bearer-token and rate-limit checks.

The rotator has no published Docker port. Its external control path is `POST /rotator/v1/rotator/<operation>`. The Caddy route is deliberately narrow, requires the same `ROTATOR_TOKEN` as the rotator, and limits requests to 30 per source IP per minute. This gives the future agent a controlled HTTPS entry point while keeping the service off the public network. The token is still a secret and must only be stored in the VPS runtime file or a local environment variable.

The deploy SSH account has a forced command. Its authorized key can run only `deploy <40-hex-commit-sha>`, `rollback`, or `status`. It has no PTY, port forwarding, agent forwarding, X11 forwarding, or user startup file. The account has no login shell.

## 1. Generate the deploy key on your Mac

Run these commands on your Mac. The private key stays on your Mac and is never pasted into chat or committed. Use a separate CI-only key with an empty passphrase because the non-interactive GitLab job cannot answer an SSH passphrase prompt. The forced command limits what this key can do on the VPS.

```sh
ssh-keygen -t ed25519 -f ~/.ssh/mistakeys-ci-deploy -C mistakeys-gitlab-deploy
# Press Enter at both passphrase prompts to leave this restricted CI key empty.
chmod 600 ~/.ssh/mistakeys-ci-deploy
```

Set the VPS address for the commands below, using the IP or hostname you already use for root SSH:

```sh
export MISTAKEYS_VPS_HOST='YOUR_VPS_IP_OR_HOSTNAME'
```

## 2. Copy and run the root setup

Copy the public setup files and public key. This does not copy the private key.

```sh
cd /Users/admin/Documents/Hackathons/mistakeys
scp -r deploy root@"$MISTAKEYS_VPS_HOST":/root/mistakeys-deploy
scp ~/.ssh/mistakeys-ci-deploy.pub root@"$MISTAKEYS_VPS_HOST":/root/mistakeys-ci-deploy.pub
ssh root@"$MISTAKEYS_VPS_HOST" 'MISTAKEYS_DEPLOY_PUBLIC_KEY="$(cat /root/mistakeys-ci-deploy.pub)" /root/mistakeys-deploy/setup.sh'
```

The script installs Docker from Docker's official Ubuntu repository, creates `mistakeys-deploy`, builds the pinned Caddy image, configures UFW for TCP ports 22, 80, and 443, and disables SSH password and keyboard-interactive authentication. It is safe to run again. It keeps an existing `/etc/mistakeys/runtime.env` unchanged.

If the script reports that the Docker apt repository has no package for the VPS codename, stop there and paste the complete error output. Do not replace the repository with an unverified installation method.

## 3. Add the server-only runtime values

Create a GitLab project deploy token first:

1. Open the project in GitLab.
2. Select `Settings` > `Repository`.
3. Expand `Deploy tokens`.
4. Select `Add new token`.
5. Give it a name such as `mistakeys-vps-read-registry`.
6. Select only `read_registry`.
7. Create the token and copy its username and token once.

Enter those values directly on the VPS. Never paste them into chat, GitLab job output, or the repository.

```sh
ssh -t root@"$MISTAKEYS_VPS_HOST" 'vi /etc/mistakeys/runtime.env'
```

Replace these placeholders, keeping the variable names unchanged:

```dotenv
REGISTRY_HOST=registry.gitlab.com
REGISTRY_IMAGE=registry.gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase
REGISTRY_USER=the-deploy-token-username
REGISTRY_PASSWORD=the-deploy-token-value
ROTATOR_TOKEN=your-long-random-rotator-token
SITE_ADDRESS=mistakeys.ajkadri.dev
```

Use a password manager or a local command to generate `ROTATOR_TOKEN`. Do not use the placeholder value. The file must remain owned by `root:mistakeys-deploy` with mode `0640`.

## 4. Confirm the forced SSH account

The first status command uses the new key and does not open a shell:

```sh
ssh -i ~/.ssh/mistakeys-ci-deploy -o IdentitiesOnly=yes mistakeys-deploy@"$MISTAKEYS_VPS_HOST" status
```

You should see Docker Compose service status plus `current_sha=` and `previous_sha=`. Before the first CI deployment, the SHA values may be empty.

These must be rejected:

```sh
ssh -i ~/.ssh/mistakeys-ci-deploy -o IdentitiesOnly=yes mistakeys-deploy@"$MISTAKEYS_VPS_HOST" 'uname -a'
ssh -i ~/.ssh/mistakeys-ci-deploy -o IdentitiesOnly=yes mistakeys-deploy@"$MISTAKEYS_VPS_HOST" 'deploy latest'
```

Both should print `unsupported deployment operation` and exit nonzero. The account must not provide an interactive shell.

## 5. Create protected GitLab CI/CD variables

Open the project in GitLab, then select `Settings` > `CI/CD` > expand `Variables` > `Add variable`.

Create these project variables. Select `Protect variable` for every row. Select `Mask variable` for the two base64-encoded secret values.

| Variable | Type | Value | Mask | Protect |
| --- | --- | --- | --- | --- |
| `VPS_HOST` | Variable | VPS IP or hostname | no | yes |
| `VPS_SSH_PORT` | Variable | `22` | no | yes |
| `VPS_DEPLOY_USER` | Variable | `mistakeys-deploy` | no | yes |
| `VPS_SSH_PRIVATE_KEY_B64` | Variable | base64 of the private deploy key | yes | yes |
| `VPS_KNOWN_HOSTS_B64` | Variable | base64 of the VPS host key line | yes | yes |

Use base64 so the masked values contain no newlines. Generate the values locally and paste them only into their GitLab variable fields:

```sh
base64 < ~/.ssh/mistakeys-ci-deploy | tr -d '\n'
ssh-keyscan -H "$MISTAKEYS_VPS_HOST" | base64 | tr -d '\n'
```

The build job uses GitLab's predefined `CI_REGISTRY_USER` and `CI_REGISTRY_PASSWORD`. Do not create another CI variable for those. The VPS deploy-token value is used only on the VPS to pull the commit-SHA images.

## 6. Run the first pipeline deployment

Push the repository to the protected default branch, then open `Build` > `Pipelines` in GitLab. Open the pipeline and confirm these jobs appear:

- `test`
- `mistakeys_leak_scan`
- `mistakeys_leak_scan_fixture`
- `build_images`
- `deploy_production` on the default branch
- GitLab's `secret_detection` job, allowed to fail

The build job pushes `api:<commit-sha>`, `rotator:<commit-sha>`, and `consumer:<commit-sha>` to this project's GitLab Container Registry. The deploy job connects as `mistakeys-deploy` and promotes those images to the local `current` tag. The prior `current` tag is retained as `previous`.

## 7. Check HTTPS and routing

After `deploy_production` succeeds, run these commands locally:

```sh
curl -fsS https://mistakeys.ajkadri.dev/healthz
curl -sS -o /dev/null -w 'orders_without_auth=%{http_code}\n' https://mistakeys.ajkadri.dev/v1/orders
```

Expected results are a JSON health response and `orders_without_auth=401`. Caddy obtains and renews the public certificate automatically when DNS points at the VPS and ports 80 and 443 are reachable.

To check the protected rotator route, set the token only in your local shell from your password manager. Do not paste it into chat or save it in shell history:

```sh
export MISTAKEYS_LOCAL_ROTATOR_TOKEN='value-from-your-password-manager'
curl -fsS -X POST \
  -H "Authorization: Bearer $MISTAKEYS_LOCAL_ROTATOR_TOKEN" \
  -H 'Content-Type: application/json' \
  https://mistakeys.ajkadri.dev/rotator/v1/rotator/status \
  --data '{"credential_id":"orders-api"}'
unset MISTAKEYS_LOCAL_ROTATOR_TOKEN
```

The response should contain state and fingerprints only. It must not contain `mk_live_` or a raw key. A request without the bearer header must return HTTP 401.

## 8. Roll back

If a deployment is unhealthy, run this single command from your Mac:

```sh
ssh -i ~/.ssh/mistakeys-ci-deploy -o IdentitiesOnly=yes mistakeys-deploy@"$MISTAKEYS_VPS_HOST" rollback
```

Then confirm the active and previous SHAs:

```sh
ssh -i ~/.ssh/mistakeys-ci-deploy -o IdentitiesOnly=yes mistakeys-deploy@"$MISTAKEYS_VPS_HOST" status
```

## 9. Host checks

Run these on the VPS as root when you need to inspect the host. They must not show an SSH password-authentication path:

```sh
ufw status verbose
sshd -T | grep -E 'passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication'
docker ps
```

The expected firewall exposure is SSH 22, HTTP 80, and HTTPS 443. The rotator must not appear with a host port in `docker ps`.
