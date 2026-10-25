# Offline complete claim/result benchmark

This optional developer tool compares real plugin report persistence, using the
official Komari Goja runtime pinned by the parent Go module. It is not a probe or
a production daemon. Its HTTP transport rejects every outbound request; results
and inventory are synthetic, and no external measurement is performed.

From the repository root:

```sh
go -C scripts/plugin-runtime run ./benchmark-active-pipeline \
  --plugin ../../network-observatory/plugin \
  --scenario ../../network-observatory/plugin/tests/benchmark-active-pipeline.js \
  --label candidate --gomaxprocs 1 > candidate-pipeline.json
```

For a baseline, extract commit `366ee48` into a separate empty directory with
`git archive`, then pass its **absolute plugin directory** to `--plugin`. Keep
`--scenario` pointing at the same candidate scenario for both runs. The driver
supports the old inline queue and the candidate sharded queue; it creates and
cleans its own temporary data store. The benchmark requires local Go modules;
it does not install new production dependencies. CPU numbers are specific to
the machine/runtime/filesystem used for the run.

The fixture creates 52 online workers, 40 international rounds of 12 targets,
15 IPv4 route rounds of nine targets and 15 IPv6 route rounds of nine targets:
70 real manifests and 750 tasks. It preloads successful ten-sample latency
results and successful 12-hop route results, with ASN/location metadata supplied.
Workers are interleaved round-robin rather than keeping one round warm in cache.

The metered region contains exactly 750 authenticated polls and 750 result
submissions, with response serialization and real `report.complete`, `progress`,
`batch`, manifests, indexes, receipts and homepage projections. Setup, startup
garbage collection, verification and unrelated scheduler/retention ticks are
excluded. Afterwards it verifies all 70 completed rounds, 750 durable receipts,
an empty durable queue and 90 correct carrier projection cells.

JSON output includes process user/system CPU, wall time, categorized reads,
writes, renames and unlinks, source fingerprints and a shared scenario hash.
Payload bytes come from the actual files after each successful read/write,
so UTF-8 Chinese text is counted correctly without copying large JSON strings
again. This adds one accounting `stat` per measured read/write in both variants.
These are logical application file bytes, not physical disk/NAND traffic.
The `nativeMetadata` category means `native-state.json`; the old version also
stores its whole inline queue in that file. Zero categories are included.

The store starts without historical completed rounds. Normal route-change
lookups still run, but historical retention/migration load needs its separate
benchmark. Queue-only persistence improvements must not be presented as the
CPU reduction of this complete pipeline.

`npm run test:plugin-runtime` also executes this full pipeline against both
official runtimes with `--enforce-budgets`: at most 64 MiB of logical writes,
64 KiB of manifest reads, 800 day-index writes, and a generous 30-second wall
ceiling for the 750-task measured phase. Focused `ASTER_*_ONLY=1` checks skip it.
Leave the budget flag off when running an older baseline, which is expected to
exceed the current implementation's work limits.
