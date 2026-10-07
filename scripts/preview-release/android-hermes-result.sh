#!/usr/bin/env bash
# Persist actual compiler completion independently of systemd's clean-signal semantics.
set -u
receipt=$1
shift
/usr/bin/timeout --signal=TERM --kill-after=10s 30m /usr/bin/time -v "$@"
result=$?
printf '%s\n' "$result" > "$receipt"
exit "$result"
