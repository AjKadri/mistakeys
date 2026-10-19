#!/bin/sh
set -eu

remote=${MISTAKEYS_DEMO_REMOTE:-origin}
demo_file=${MISTAKEYS_DEMO_FILE:-demo/leaked-orders-key.txt}
branch=${MISTAKEYS_DEMO_BRANCH:-demo/leak-$(date -u +%Y%m%d-%H%M%S)}

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo 'run this script from a Git checkout' >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo 'run this script from a clean Git checkout' >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

: "${MISTAKEYS_VPS_HOST:?MISTAKEYS_VPS_HOST is required}"

git fetch "$remote" main >/dev/null 2>&1
git switch -c "$branch" "$remote/main" >/dev/null 2>&1

key=$(ssh "mistakeys-deploy@$MISTAKEYS_VPS_HOST" demo-key)
case "$key" in
  mk_live_????????????????????????????????) ;;
  *)
    echo 'the live rotator did not return a demo-format application key' >&2
    exit 1
    ;;
esac

fingerprint=$(printf '%s' "$key" | shasum -a 256 | awk '{print "sha256:" substr($1, 1, 12)}')

mkdir -p "$(dirname "$demo_file")"
umask 077
printf 'MISTAKEYS_TEST_KEY=%s\n' "$key" > "$demo_file"
unset key

git add "$demo_file"
git commit -m 'demo: intentionally leak a production credential' >/dev/null 2>&1
git push --set-upstream "$remote" "$branch" >/dev/null 2>&1

printf 'branch=%s fingerprint=%s\n' "$branch" "$fingerprint"
