#!/bin/sh
set -eu
runtime_root=$(CDPATH= cd "$(dirname "$0")/plugin-runtime" && pwd)
plugin_root=$(CDPATH= cd "$runtime_root/../../network-observatory/plugin" && pwd)
cd "$runtime_root"
# Official Komari 1.4.3, pinned in go.mod.
go run . "$plugin_root"
# Also exercise the same code against the official stable 1.5.1 runtime.
runtime_tmp=$(mktemp -d)
trap 'rm -rf "$runtime_tmp"' EXIT HUP INT TERM
cp go.mod "$runtime_tmp/runtime.mod"
cp go.sum "$runtime_tmp/runtime.sum"
go mod edit -modfile="$runtime_tmp/runtime.mod" -require=github.com/komari-monitor/komari@v0.0.0-20260924152105-f0cc0fba38ce
go mod tidy -modfile="$runtime_tmp/runtime.mod"
go run -modfile="$runtime_tmp/runtime.mod" . "$plugin_root"
