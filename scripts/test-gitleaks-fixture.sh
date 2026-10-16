#!/bin/sh
set -eu

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

fixture_path="$work_dir/fake-credential.txt"
raw_report="$work_dir/gitleaks.json"
safe_report="$work_dir/leak-report.json"
fake_key="mk_live_$(printf '0123456789ABCDEFGHIJKLMNOPQRSTUV')"

printf 'Authorization: Bearer %s\n' "$fake_key" > "$fixture_path"

set +e
gitleaks dir "$work_dir" \
  --config .gitleaks.toml \
  --redact \
  --no-banner \
  --report-format json \
  --report-path "$raw_report"
scan_status=$?
set -e

if [ "$scan_status" -eq 0 ]; then
  echo 'fixture scan unexpectedly passed'
  exit 1
fi

node scripts/build-leak-report.mjs "$raw_report" "$safe_report" fixture-commit
node scripts/assert-leak-report.mjs "$safe_report" "$fixture_path"
echo 'fixture leak scan correctly failed and produced a safe report'
