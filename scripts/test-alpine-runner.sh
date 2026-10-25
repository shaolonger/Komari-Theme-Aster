#!/bin/sh
# Docker is deliberately required: never install services on the developer host.
set -eu
cd "$(dirname "$0")/.."
node scripts/package-network-observatory.mjs
# A shell with no remaining PID slots must explain the container limit using
# builtins, rather than die on its very first id/awk command substitution.
if resource_output=$(docker run --rm --memory=128m --cpus=1 --pids-limit=1 \
  -v "$PWD:/fixture:ro" alpine:3.21 \
  sh /fixture/network-observatory/runner/quick-install.sh --profile lite 2>&1); then
  printf '%s\n' 'PID-exhausted installation unexpectedly succeeded.' >&2
  exit 1
fi
case "$resource_output" in
  *'pids.current=1，pids.max=1'*) ;;
  *) printf '%s\n' "$resource_output" 'Missing no-fork resource diagnostic.' >&2; exit 1 ;;
esac
case "$resource_output" in
  *"can't fork"*) printf '%s\n' "$resource_output" >&2; exit 1 ;;
esac
docker run --rm --memory=128m --cpus=1 --pids-limit=128 \
  -v "$PWD:/fixture:ro" alpine:3.21 \
  sh /fixture/scripts/alpine-runner-fixture.sh
