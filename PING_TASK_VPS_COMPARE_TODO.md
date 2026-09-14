# Ping Task VPS Compare TODO

Scope: add a Ping-task-focused comparison mode to `/compare` so users can quickly compare latency and loss across VPS nodes under the same Ping task and time range. This is an extension of the existing VPS comparison workspace, not a new route.

Context recovery note: if LLM context compaction happens, resume from this file. Run `git status --short`, `git log --oneline -10`, and continue from the first unchecked task. Each task must be implemented, checked, committed, and then marked complete before moving on.

## Product Decisions

- Keep `/compare` as the main entry point.
- Preserve existing behavior for load metrics and Ping metrics without a selected task.
- Use `pingTask=<id>` for the new "one Ping task, many VPS" mode.
- Keep existing `pingTasks=2,5` semantics for the current "one VPS, many Ping tasks" mode.
- Seed selected VPS from `homepagePingBindings[pingTask]` when a task deep link is opened without explicit `nodes`.
- Do not create, delete, or mutate Komari backend Ping tasks.

## Tasks

- [x] Add tested comparison utilities for filtering Ping records by one task, building task-aware compare URLs, and deriving task-bound VPS selections.
- [x] Extend `/compare` with Ping-task mode controls, URL state, task-filtered trend/ranking data, and clear summary copy.
- [x] Add responsive styling for the task selector and task-aware selected VPS hints.
- [x] Add task-level comparison entry points from homepage Ping source rows and theme Ping binding management.
- [x] Run targeted tests, typecheck, build, and browser smoke checks; then mark this TODO complete.
- [x] Bump version, package the theme, tag, push to GitHub, and create a GitHub release.

## Acceptance Criteria

- `/compare?metric=ping_latency&pingTask=2` opens task mode, seeds the bound VPS list from theme settings when possible, and shows only records from task `2`.
- `/compare?nodes=a,b&metric=ping_latency&pingTask=2` compares only those selected VPS for task `2`.
- Existing `/compare?nodes=a&metric=ping_latency&pingTasks=2,5` still renders one VPS split by multiple Ping tasks.
- Ping latency and loss charts retain the existing bucketed/smoothed visual treatment.
- Ranking, summary cards, Markdown export, and CSV export use the same task-filtered data as the chart.
- Homepage Ping source rows and theme Ping binding management expose direct links to task-level VPS comparison.
- Full build and release flow succeeds.
