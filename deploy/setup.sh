#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo 'run deploy/setup.sh as root' >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
app_dir=/opt/mistakeys
deploy_dir=$app_dir/deploy
runtime_dir=/etc/mistakeys
runtime_file=$runtime_dir/runtime.env
deploy_user=mistakeys-deploy
deploy_group=mistakeys-deploy
public_key=${MISTAKEYS_DEPLOY_PUBLIC_KEY:-}

say() {
  printf '[mistakeys] %s\n' "$*"
}

changed() {
  say "changed: $*"
}

unchanged() {
  say "unchanged: $*"
}

write_if_changed() {
  target=$1
  mode=$2
  owner=$3
  group=$4
  temp_file=$(mktemp)
  cat > "$temp_file"
  if [ -f "$target" ] && cmp -s "$temp_file" "$target"; then
    rm -f "$temp_file"
    unchanged "$target"
    return
  fi
  install -o "$owner" -g "$group" -m "$mode" "$temp_file" "$target"
  rm -f "$temp_file"
  changed "$target"
}

say 'installing prerequisites and Docker from the official Docker apt repository'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg ufw openssh-server

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  changed '/etc/apt/keyrings/docker.asc'
else
  unchanged '/etc/apt/keyrings/docker.asc'
fi

# shellcheck disable=SC1091
. /etc/os-release
docker_arch=$(dpkg --print-architecture)
write_if_changed /etc/apt/sources.list.d/docker.sources 0644 root root <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: $docker_arch
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
if systemctl is-active --quiet docker; then
  unchanged 'Docker service is active'
else
  systemctl enable --now docker
  changed 'Docker service enabled and started'
fi

if id "$deploy_user" >/dev/null 2>&1; then
  unchanged "user $deploy_user"
else
  useradd --create-home --shell /usr/sbin/nologin "$deploy_user"
  changed "user $deploy_user"
fi

if getent group "$deploy_group" >/dev/null 2>&1; then
  unchanged "group $deploy_group"
else
  groupadd "$deploy_group"
  changed "group $deploy_group"
fi

usermod -aG docker "$deploy_user"
changed "added $deploy_user to the docker group"

install -d -o root -g "$deploy_group" -m 0750 "$app_dir" "$deploy_dir" "$runtime_dir"
cp -a "$script_dir/." "$deploy_dir/"
chown -R root:"$deploy_group" "$deploy_dir"
find "$deploy_dir" -type d -exec chmod 0750 {} \;
find "$deploy_dir" -type f -exec chmod 0640 {} \;
chmod 0750 "$deploy_dir/setup.sh" "$deploy_dir/deployctl.sh" "$deploy_dir/mistakeys-deploy-command"
changed "deployment files copied to $deploy_dir"

if [ -f "$runtime_file" ]; then
  unchanged "$runtime_file already exists"
else
  write_if_changed "$runtime_file" 0640 root "$deploy_group" <<'EOF'
REGISTRY_HOST=registry.gitlab.com
REGISTRY_IMAGE=registry.gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43339651/showcase
REGISTRY_USER=replace-with-gitlab-deploy-token-username
REGISTRY_PASSWORD=replace-with-gitlab-deploy-token
ROTATOR_TOKEN=replace-with-a-long-random-rotator-token
CADDY_BIND_ADDRESS=127.0.0.1
HTTP_PORT=18080
HTTPS_PORT=18443
SITE_ADDRESS=:80
EOF
  say "edit $runtime_file before the first deployment; placeholders are not working credentials"
fi

install -d -o "$deploy_user" -g "$deploy_group" -m 0750 "$app_dir/state"

install -o root -g root -m 0755 "$script_dir/mistakeys-deploy-command" /usr/local/libexec/mistakeys-deploy-command
changed '/usr/local/libexec/mistakeys-deploy-command'

if [ -n "$public_key" ]; then
  case "$public_key" in
    ssh-ed25519\ *) ;;
    *) echo 'MISTAKEYS_DEPLOY_PUBLIC_KEY must start with ssh-ed25519' >&2; exit 1 ;;
  esac
  authorized_line="command=\"/usr/local/libexec/mistakeys-deploy-command\",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc $public_key"
  install -d -o "$deploy_user" -g "$deploy_user" -m 0700 "/home/$deploy_user/.ssh"
  touch "/home/$deploy_user/.ssh/authorized_keys"
  chown "$deploy_user:$deploy_user" "/home/$deploy_user/.ssh/authorized_keys"
  chmod 0600 "/home/$deploy_user/.ssh/authorized_keys"
  if grep -Fqx "$authorized_line" "/home/$deploy_user/.ssh/authorized_keys"; then
    unchanged 'forced deploy key in authorized_keys'
  else
    printf '%s\n' "$authorized_line" >> "/home/$deploy_user/.ssh/authorized_keys"
    changed 'forced deploy key in authorized_keys'
  fi
else
  say 'no public key supplied; add the forced authorized_keys line before using CI deploy'
fi

write_if_changed /etc/ssh/sshd_config.d/99-mistakeys-hardening.conf 0644 root root <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
EOF
sshd -t
if systemctl reload ssh 2>/dev/null; then
  changed 'SSH configuration reloaded'
else
  systemctl reload sshd
  changed 'SSH configuration reloaded'
fi

ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
if ufw status | grep -q '^Status: active'; then
  unchanged 'UFW is active with ports 22, 80, and 443 allowed'
else
  ufw --force enable >/dev/null
  changed 'UFW enabled with ports 22, 80, and 443 allowed'
fi

caddy_image=mistakeys-caddy:2.11.7-ratelimit
if docker image inspect "$caddy_image" >/dev/null 2>&1; then
  unchanged "Caddy image $caddy_image"
else
  docker build --pull -t "$caddy_image" "$deploy_dir/caddy"
  changed "Caddy image $caddy_image"
fi

say 'setup complete; the application was not started'
say 'Mistakeys Caddy will bind to 127.0.0.1:18080; add the host Caddy reverse_proxy before deployment'
say 'the rotator has no host port and is reachable only through Caddy /rotator/*'
say "next: edit $runtime_file, configure the host Caddy route, then run ssh -i <deploy-key> $deploy_user@<host> status"
