#!/bin/sh
set -eu

mkdir -p /data /secrets
chown -R app:app /data /secrets
exec su-exec app "$@"
