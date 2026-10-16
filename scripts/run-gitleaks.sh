#!/bin/sh
set -eu

report_path=${1:-leak-report.json}
source_path=${2:-.}
raw_report=$(mktemp)
trap 'rm -f "$raw_report"' EXIT

set +e
gitleaks dir "$source_path" \
  --config .gitleaks.toml \
  --redact \
  --no-banner \
  --report-format json \
  --report-path "$raw_report"
scan_status=$?
set -e

node scripts/build-leak-report.mjs "$raw_report" "$report_path" "${CI_COMMIT_SHA:-$(git rev-parse HEAD)}"
exit "$scan_status"
