#!/bin/sh
# Docker is deliberately required: never install services on the developer host.
set -eu
cd "$(dirname "$0")/.."
node scripts/package-network-observatory.mjs
docker run --rm --memory=128m --cpus=1 --pids-limit=128 \
  -v "$PWD:/fixture:ro" alpine:3.21 \
  sh /fixture/scripts/alpine-runner-fixture.sh
