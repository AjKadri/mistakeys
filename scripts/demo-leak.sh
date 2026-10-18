#!/bin/sh
set -eu

remote=${MISTAKEYS_DEMO_REMOTE:-origin}
compose_file=${MISTAKEYS_COMPOSE_FILE:-docker-compose.yml}
demo_file=${MISTAKEYS_DEMO_FILE:-demo/leaked-orders-key.txt}
branch=${MISTAKEYS_DEMO_BRANCH:-demo/leak-$(date -u +%Y%m%d-%H%M%S)}

if ! command -v docker >/dev/null 2>&1; then
  echo 'docker is required' >&2
  exit 1
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo 'run this script from a Git checkout' >&2
  exit 1
fi

if ! docker compose -f "$compose_file" ps --services --filter status=running | grep -qx rotator; then
  echo 'the local rotator container is not running; start the local Compose stack first' >&2
  exit 1
fi

key=$(docker compose -f "$compose_file" exec -T rotator sh -c 'cat /secrets/orders-api.key')
case "$key" in
  mk_live_????????????????????????????????) ;;
  *)
    echo 'the local rotator did not return a demo-format application key' >&2
    exit 1
    ;;
esac

fingerprint=$(printf '%s' "$key" | shasum -a 256 | awk '{print "sha256:" substr($1, 1, 12)}')

mkdir -p "$(dirname "$demo_file")"
umask 077
printf 'MISTAKEYS_TEST_KEY=%s\n' "$key" > "$demo_file"
unset key

git switch -c "$branch"
git add "$demo_file"
git commit -m 'demo: intentionally leak a test credential'
git push --set-upstream "$remote" "$branch"

printf 'pushed demo branch %s with fingerprint %s\n' "$branch" "$fingerprint"
