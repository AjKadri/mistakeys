#!/bin/sh
set -eu

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

fixture_path="$work_dir/fake-credential.txt"
safe_report="$work_dir/leak-report.json"
fake_key="mk_live_$(printf '0123456789ABCDEFGHIJKLMNOPQRSTUV')"

printf 'Authorization: Bearer %s\n' "$fake_key" > "$fixture_path"

set +e
./scripts/run-gitleaks.sh "$safe_report" "$work_dir"
scan_status=$?
set -e

if [ "$scan_status" -eq 0 ]; then
  echo 'fixture scan unexpectedly passed'
  exit 1
fi

node scripts/assert-leak-report.mjs "$safe_report" "$fixture_path"
echo 'fixture leak scan correctly failed and produced a safe report'
