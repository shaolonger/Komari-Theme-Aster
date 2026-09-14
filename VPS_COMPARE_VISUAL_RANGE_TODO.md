# VPS Compare Visual and Range Rework TODO

Scope: fix the `/compare` page so it works well for one or many VPS nodes, renders ping latency/loss as readable operational trends, starts with no surprise selections, and supports custom time ranges. Remote terminal, remote command execution, GPU controls, and automatic update controls remain out of scope.

Context recovery note: if LLM context compaction happens, resume from this file. Run `git status --short`, `git log --oneline -10`, and continue from the first unchecked task. Each task must be implemented, checked, and committed with its checkbox marked complete before moving on.

## Analysis

- Current ping trend rendering aligns every selected node by the exact raw timestamp union. Ping records from different VPS nodes and ping tasks often arrive at slightly different seconds, so the aligned matrix becomes sparse. This creates broken, vertical, or needle-like strokes rather than comparable curves.
- Ping latency currently mixes raw point-to-point changes directly into the visible line. Even when sample times are close, per-task and per-target jitter appears as strong sawtooth noise. The comparison view needs a trend-oriented visual layer: bucket by a stable time grid, aggregate within each bucket, bridge harmless off-phase gaps, break real long gaps, and apply light smoothing for ping latency/loss only.
- The page has product constraints that now work against the user: it auto-selects the first three VPS, refuses to query with one VPS, and caps selection at eight. These are front-end rules, not API constraints.
- Existing history APIs accept an `hours` window, not explicit `from/to`. Custom ranges can be implemented compatibly by requesting enough hours to cover the chosen start time, then trimming and visualizing records client-side inside the exact start/end range.

## Acceptance Criteria

- `/compare` opens with no VPS selected unless the URL includes `nodes=...`.
- Selecting one VPS fetches and displays that VPS history; selecting multiple VPS compares them.
- There is no front-end maximum selected VPS limit.
- Ping latency and ping loss trend charts use bucketed, aligned, lightly smoothed data so ordinary sampling offsets do not produce vertical needles or harsh sawtooth lines.
- Long real data gaps still break the chart, so the smoother display does not pretend an outage was continuous.
- A user can choose either preset ranges or a custom start/end range. URL params preserve custom ranges.
- Ranking, summary cards, Markdown export, and CSV export use the same selected/custom time range as the chart.
- Desktop and mobile browser checks verify empty initial selection, single-node rendering, multi-node ping rendering, custom range inputs, and console cleanliness.

## Tasks

- [x] Create this TODO with root-cause analysis, acceptance criteria, and recovery instructions.
- [x] Remove compare-page selection friction: no default first-three selection, allow one selected VPS to query/render, remove the eight-node cap, and update labels/disabled states.
- [x] Add a tested trend-preparation layer for ping comparison charts: fixed time buckets, per-bucket aggregation, off-phase gap bridging, long-gap breaks, light smoothing, and chart metadata.
- [x] Add custom time range state, URL params, datetime-local controls, compatible history fetch window calculation, and client-side series trimming.
- [x] Polish `/compare` chart copy, summary cards, export filenames, and responsive styles around the new single-node/custom-range flows.
- [x] Run desktop and mobile browser verification for the compare page and fix any visual or console issues.
- [x] Update version, build package, tag, push to GitHub, and create a GitHub release with the new zip asset.
