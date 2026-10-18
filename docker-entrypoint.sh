#!/bin/sh
set -eu

mkdir -p /data /secrets
chown -R app:app /data /secrets
# The inner shell must expand these positional parameters after su switches users.
# shellcheck disable=SC2016
exec su -s /bin/sh app -c 'exec "$0" "$@"' -- "$@"
