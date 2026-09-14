# Global Display Time Zone TODO

Scope: add a global theme-level display time zone setting. The theme must keep all stored and queried timestamps unchanged, and only change how wall-clock time is shown or interpreted in the UI.

Context recovery note: if LLM context compaction happens, resume from this file. Run `git status --short`, `git log --oneline -10`, and continue from the first unchecked task. Each task must be implemented, checked, committed, and then marked complete before moving on.

## Product Decisions

- Default behavior stays compatible: `displayTimeZone: "system"` follows the browser/system time zone.
- Specific IANA zones such as `UTC`, `Asia/Shanghai`, `Asia/Tokyo`, `America/Los_Angeles`, and `Europe/London` can be selected.
- The setting affects absolute wall-clock displays: chart axes, chart tooltips, custom range inputs, last update labels, Ping hover windows, and 3D replay labels.
- The setting must not affect durations or relative values: uptime, "x days remaining", "x minutes ago", record retention windows, refresh intervals, or API query timestamps.
- Invalid saved time zones must normalize back to `system`.

## Tasks

- [x] Save this global time zone TODO with scope, product decisions, and recovery instructions.
- [x] Add theme setting normalization and a reusable display-time utility for IANA time zones.
- [x] Add a theme settings UI control with quick presets, custom IANA input, validation, and live preview.
- [x] Apply the display time zone to shared instance/compare chart axes, tooltips, coverage labels, export range labels, and compare custom range parsing.
- [x] Apply the display time zone to instance details, homepage Ping hover windows, and 3D replay/snapshot time labels.
- [x] Add targeted tests for time zone normalization, absolute formatting, custom datetime conversion, and Ping bucket labels.
- [x] Run typecheck, targeted tests, package build, and browser smoke verification.
- [x] Update version, build package, tag, push to GitHub, and create a GitHub release with the new zip asset.

## Acceptance Criteria

- The theme can be set to follow browser/system time or a concrete IANA time zone.
- Existing installations without the setting behave exactly as before.
- Absolute timestamps are displayed consistently across homepage, instance details, charts, compare, and 3D replay.
- Compare custom range inputs represent and parse wall-clock time in the selected display time zone.
- Raw data, stored timestamps, and API query semantics remain UTC/epoch based and unchanged.
- Invalid custom time zones cannot break the UI and are normalized back to `system`.
- Tests, typecheck, package build, push, tag, and GitHub release all complete.

## Verification Notes

- Targeted tests: `npx vitest run src/utils/__tests__/timeDisplay.test.ts src/components/node/__tests__/pingBucketText.test.ts src/utils/__tests__/themeSettings.test.ts`.
- Typecheck: `npm run typecheck`.
- Package build: `npm run package`.
- Browser smoke: `/`, `/compare?range=custom&from=0&to=3600&metric=cpu&tab=trend`, and `/fleet-3d?demo=1` render without console errors in local dev.
- Local standalone limitation: `/?view=theme-manage` is gated by Komari auth and shows `Request /api/me failed: 404`; no frontend crash or console errors were observed.
