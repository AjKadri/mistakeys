#!/bin/sh
set -eu

app_dir=${MISTAKEYS_APP_DIR:-/opt/mistakeys}
deploy_dir=$app_dir/deploy
compose_file=$deploy_dir/docker-compose.yml
env_file=/etc/mistakeys/runtime.env
state_dir=$app_dir/state

if [ ! -r "$env_file" ]; then
  echo 'runtime configuration is missing; ask root to configure /etc/mistakeys/runtime.env' >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$env_file"
: "${REGISTRY_HOST:?REGISTRY_HOST is required}"
: "${REGISTRY_IMAGE:?REGISTRY_IMAGE is required}"
: "${REGISTRY_USER:?REGISTRY_USER is required}"
: "${REGISTRY_PASSWORD:?REGISTRY_PASSWORD is required}"
: "${ROTATOR_TOKEN:?ROTATOR_TOKEN is required}"

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

set_current_images() {
  API_IMAGE="$REGISTRY_IMAGE/api:current"
  ROTATOR_IMAGE="$REGISTRY_IMAGE/rotator:current"
  CONSUMER_IMAGE="$REGISTRY_IMAGE/consumer:current"
  export API_IMAGE ROTATOR_IMAGE CONSUMER_IMAGE
}

set_sha_images() {
  deploy_sha=$1
  API_SHA_IMAGE="$REGISTRY_IMAGE/api:$deploy_sha"
  ROTATOR_SHA_IMAGE="$REGISTRY_IMAGE/rotator:$deploy_sha"
  CONSUMER_SHA_IMAGE="$REGISTRY_IMAGE/consumer:$deploy_sha"
}

read_state() {
  state_name=$1
  state_path=$state_dir/$state_name
  if [ -f "$state_path" ]; then
    tr -d '\n' < "$state_path"
  fi
}

write_state() {
  state_name=$1
  state_value=$2
  state_tmp=$state_dir/$state_name.tmp.$$
  printf '%s\n' "$state_value" > "$state_tmp"
  mv "$state_tmp" "$state_dir/$state_name"
}

valid_sha() {
  sha=$1
  [ "${#sha}" -eq 40 ] || return 1
  case "$sha" in
    *[!0123456789abcdefABCDEF]*) return 1 ;;
  esac
}

registry_login() {
  printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" --username "$REGISTRY_USER" --password-stdin >/dev/null
}

health_check() {
  compose exec -T api node -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null
  compose exec -T rotator node -e "fetch('http://127.0.0.1:3002/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null
}

promote_sha_to_current() {
  docker tag "$API_SHA_IMAGE" "$REGISTRY_IMAGE/api:current"
  docker tag "$ROTATOR_SHA_IMAGE" "$REGISTRY_IMAGE/rotator:current"
  docker tag "$CONSUMER_SHA_IMAGE" "$REGISTRY_IMAGE/consumer:current"
}

promote_previous_to_current() {
  docker tag "$REGISTRY_IMAGE/api:previous" "$REGISTRY_IMAGE/api:current"
  docker tag "$REGISTRY_IMAGE/rotator:previous" "$REGISTRY_IMAGE/rotator:current"
  docker tag "$REGISTRY_IMAGE/consumer:previous" "$REGISTRY_IMAGE/consumer:current"
}

deploy_sha() {
  deploy_sha=$1
  valid_sha "$deploy_sha" || {
    echo 'deploy requires a 40-character hexadecimal commit SHA' >&2
    exit 64
  }

  registry_login
  set_sha_images "$deploy_sha"
  docker pull "$API_SHA_IMAGE" >/dev/null
  docker pull "$ROTATOR_SHA_IMAGE" >/dev/null
  docker pull "$CONSUMER_SHA_IMAGE" >/dev/null

  old_sha=$(read_state current || true)
  if [ -n "$old_sha" ]; then
    docker tag "$REGISTRY_IMAGE/api:current" "$REGISTRY_IMAGE/api:previous"
    docker tag "$REGISTRY_IMAGE/rotator:current" "$REGISTRY_IMAGE/rotator:previous"
    docker tag "$REGISTRY_IMAGE/consumer:current" "$REGISTRY_IMAGE/consumer:previous"
    write_state previous "$old_sha"
  fi

  promote_sha_to_current
  set_current_images
  compose up -d --no-build --remove-orphans >/dev/null

  if ! health_check; then
    echo 'deployment health check failed' >&2
    if [ -n "$old_sha" ]; then
      promote_previous_to_current
      compose up -d --no-build --remove-orphans >/dev/null || true
      write_state current "$old_sha"
    fi
    exit 1
  fi

  write_state current "$deploy_sha"
  echo "deployed $deploy_sha"
}

rollback() {
  old_sha=$(read_state current || true)
  previous_sha=$(read_state previous || true)
  if [ -z "$old_sha" ] || [ -z "$previous_sha" ]; then
    echo 'no previous deployment is available' >&2
    exit 1
  fi

  docker tag "$REGISTRY_IMAGE/api:current" "$REGISTRY_IMAGE/api:rollback-backup"
  docker tag "$REGISTRY_IMAGE/rotator:current" "$REGISTRY_IMAGE/rotator:rollback-backup"
  docker tag "$REGISTRY_IMAGE/consumer:current" "$REGISTRY_IMAGE/consumer:rollback-backup"
  promote_previous_to_current
  set_current_images
  compose up -d --no-build --remove-orphans >/dev/null

  if ! health_check; then
    echo 'rollback health check failed' >&2
    docker tag "$REGISTRY_IMAGE/api:rollback-backup" "$REGISTRY_IMAGE/api:current"
    docker tag "$REGISTRY_IMAGE/rotator:rollback-backup" "$REGISTRY_IMAGE/rotator:current"
    docker tag "$REGISTRY_IMAGE/consumer:rollback-backup" "$REGISTRY_IMAGE/consumer:current"
    compose up -d --no-build --remove-orphans >/dev/null || true
    exit 1
  fi

  docker tag "$REGISTRY_IMAGE/api:rollback-backup" "$REGISTRY_IMAGE/api:previous"
  docker tag "$REGISTRY_IMAGE/rotator:rollback-backup" "$REGISTRY_IMAGE/rotator:previous"
  docker tag "$REGISTRY_IMAGE/consumer:rollback-backup" "$REGISTRY_IMAGE/consumer:previous"
  write_state current "$previous_sha"
  write_state previous "$old_sha"
  echo "rolled back to $previous_sha"
}

status() {
  set_current_images
  compose ps
  printf 'current_sha=%s\n' "$(read_state current || true)"
  printf 'previous_sha=%s\n' "$(read_state previous || true)"
}

case "${1:-}" in
  deploy)
    [ "$#" -eq 2 ] || { echo 'deploy requires one commit SHA' >&2; exit 64; }
    deploy_sha "$2"
    ;;
  rollback)
    [ "$#" -eq 1 ] || { echo 'rollback takes no arguments' >&2; exit 64; }
    rollback
    ;;
  status)
    [ "$#" -eq 1 ] || { echo 'status takes no arguments' >&2; exit 64; }
    status
    ;;
  *)
    echo 'unsupported deployment operation' >&2
    exit 64
    ;;
esac
