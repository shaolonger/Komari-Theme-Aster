#!/bin/sh
set -eu
runtime_root=$(CDPATH= cd "$(dirname "$0")/plugin-runtime" && pwd)
plugin_root=$(CDPATH= cd "$runtime_root/../../network-observatory/plugin" && pwd)
cd "$runtime_root"
aster_full_pipeline=1
for aster_focus in "${ASTER_POLLING_ONLY:-0}" "${ASTER_NATIVE_MAINTENANCE_ONLY:-0}" "${ASTER_STORE_PERFORMANCE_ONLY:-0}" "${ASTER_DISPATCH_PERFORMANCE_ONLY:-0}" "${ASTER_QUEUE_STATE_PERFORMANCE_ONLY:-0}"; do
  if [ "$aster_focus" = 1 ]; then aster_full_pipeline=0; fi
done
run_active_pipeline() {
  aster_pipeline_label=$1
  shift
  if [ "$aster_full_pipeline" = 1 ]; then
    go run "$@" ./benchmark-active-pipeline --plugin "$plugin_root" --scenario "$plugin_root/tests/benchmark-active-pipeline.js" --label "$aster_pipeline_label" --gomaxprocs 1 --enforce-budgets
  fi
}
# Official Komari 1.4.3, pinned in go.mod.
go run . "$plugin_root"
run_active_pipeline official-1.4.3
# Also exercise the same code against the official stable 1.5.1 runtime.
runtime_tmp=$(mktemp -d)
trap 'rm -rf "$runtime_tmp"' EXIT HUP INT TERM
cp go.mod "$runtime_tmp/runtime.mod"
cp go.sum "$runtime_tmp/runtime.sum"
go mod edit -modfile="$runtime_tmp/runtime.mod" -require=github.com/komari-monitor/komari@v0.0.0-20260924152105-f0cc0fba38ce
go mod tidy -modfile="$runtime_tmp/runtime.mod"
go run -modfile="$runtime_tmp/runtime.mod" . "$plugin_root"
run_active_pipeline official-1.5.1 -modfile="$runtime_tmp/runtime.mod"
