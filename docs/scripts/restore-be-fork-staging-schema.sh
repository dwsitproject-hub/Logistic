#!/usr/bin/env bash
# Deprecated: use load-be-fork-to-remote-staging.sh instead.
# This wrapper kept for runbook compatibility.
echo "NOTE: restore-be-fork-staging-schema.sh is deprecated." >&2
echo "Use: bash docs/scripts/load-be-fork-to-remote-staging.sh" >&2
exec bash "$(dirname "$0")/load-be-fork-to-remote-staging.sh" "$@"
