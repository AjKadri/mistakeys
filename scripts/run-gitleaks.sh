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
  --exit-code 1 \
  --report-format json \
  --report-path "$raw_report"
scan_status=$?
set -e

node scripts/build-leak-report.mjs "$raw_report" "$report_path" "${CI_COMMIT_SHA:-$(git rev-parse HEAD)}"

if [ "$scan_status" -ne 0 ]; then
  exit "$scan_status"
fi

report_count=$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const report = JSON.parse(readFileSync(process.argv.at(-1), "utf8"));
  process.stdout.write(String(Array.isArray(report) ? report.length : -1));
' "$report_path")

if [ "$report_count" -ne 0 ]; then
  echo "leak scan found $report_count finding(s)" >&2
  exit 1
fi
