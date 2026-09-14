# Homepage Multi-Ping Phase 2 TODO

Scope: advanced multi-Ping UX after v1.11.0. Phase 1 made a VPS bindable to multiple homepage Ping tasks and produced a compact aggregate. Phase 2 adds the advanced layer requested by product direction: primary task settings, aggregation strategy selection, Ping task grouping, expandable homepage card details, and one-click navigation to compare trends for one VPS across its bound Ping tasks.

Core principle: homepage is for quickly discovering problems; theme settings clearly express binding relationships; instance details and compare views explain where the problem comes from.

Context recovery note: if LLM context compaction happens, resume from this file. Run `git status --short`, `git log --oneline -10`, and continue from the first unchecked task. Each task must be implemented, checked, committed, and then marked complete before moving on.

## Product Decisions

- Preserve the existing binding shape, `homepagePingBindings: Record<taskId, nodeUuid[]>`, for compatibility.
- Add separate optional settings for advanced behavior: aggregation strategy, per-VPS primary task, and Ping task grouping.
- Default behavior remains equivalent to v1.11.0: worst-first aggregation, no required primary task, no required task group.
- Do not create, delete, or mutate Komari backend Ping tasks. The theme only stores presentation/binding metadata.

## Tasks

- [x] Rewrite this Phase 2 TODO with the requested advanced scope, acceptance criteria, and recovery instructions.
- [x] Add normalized theme settings for homepage Ping aggregation strategy, per-VPS primary task, and Ping task groups.
- [x] Apply aggregation strategy and primary-task priority to homepage Ping aggregation while preserving worst-first defaults.
- [x] Upgrade theme settings with strategy controls, Ping task group editing, and a VPS-first primary-task overview.
- [x] Add expandable homepage card Ping source details with per-task status and compare-page jump links.
- [x] Extend `/compare` deep links so one VPS can show separate trend lines for its bound Ping tasks.
- [x] Add targeted tests for strategy normalization, aggregation behavior, settings overview helpers, card source labels, and compare task-series data.
- [x] Run browser smoke verification for Phase 2 routes and record local limitations.
- [x] Update version, build package, tag, push to GitHub, and create a GitHub release with the new zip asset.

## Acceptance Criteria

- Users can choose how homepage multi-Ping values are aggregated.
- Users can mark a primary Ping task for a VPS without breaking multi-task bindings.
- Users can assign readable groups to Ping tasks and see those groups in settings/card explanations.
- Homepage cards stay compact by default but can expand to explain contributing Ping sources.
- A card/detail control can open `/compare` directly into a single-VPS multi-task Ping trend view.
- Existing single-task configurations continue to behave as before.
- Tests, typecheck, package build, push, tag, and GitHub release all complete.

## Browser Smoke Notes

- Local dev server: `http://127.0.0.1:5173/`.
- Home route `/` renders the empty-data dashboard/workbench state without console errors.
- Compare deep link `/compare?nodes=node-a&metric=ping_latency&hours=4&tab=trend&pingTasks=2,5` renders without console errors; without real Komari node data it correctly shows no selected VPS/data.
- Theme manage route `/?view=theme-manage` is gated by Komari auth in local standalone dev and shows `Request /api/me failed: 404`; no frontend crash or console errors were observed.
