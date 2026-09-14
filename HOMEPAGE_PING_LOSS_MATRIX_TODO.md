# Homepage Ping/Loss Matrix Redesign Todo

## Final Design

Homepage VPS cards must show every related Ping task directly, without requiring users to open a source drawer. The card keeps the existing aggregate latency/loss trend as a fast summary, but no longer treats a "primary task" as the visual focus on the homepage.

### Product Principles

- The homepage answers "which VPS has a network problem, and from which task/source?" in one glance.
- All bound Ping sources are visible by default; no "X sources / collapse" step is required for routine inspection.
- Latency and packet loss are visually different because they describe different failure modes.
- The normal card and compact card must behave consistently.
- The design must stay dense enough for the homepage grid and safe for long task names.

### Visual Encoding

- Latency: show the latest value in milliseconds plus a thin continuous intensity rail. Low latency reads calm green; higher latency fills and warms the rail.
- Packet loss: show the latest loss percent plus discrete loss dots. No loss is quiet green dots; any loss creates stronger warning dots, making packet loss feel like interruptions rather than a smooth value.
- Source rows: task/group name on the left, latency/loss signals on the right, sorted by attention level so problematic sources rise first.
- Compare action: keep a small "Compare" link, but make it secondary to the always-visible source matrix.

## Todo

- [x] T0 Save this final design and implementation checklist locally.
- [x] T1 Extend homepage Ping source row modeling with numeric latency/loss fields, attention sorting, compact labels, titles, and visual ratios for latency rails/loss dots.
- [x] T2 Replace the normal NodeCard source drawer with an always-visible Ping source matrix and remove source-count badges from the primary latency/loss summary.
- [x] T3 Replace the CompactNodeCard source drawer with the same always-visible matrix, tuned for compact density.
- [x] T4 Add responsive CSS for the Ping source matrix, long names, many sources, dark/light appearance, and mobile card widths.
- [x] T5 Add and update unit tests for source modeling, sorting, labels, compare URLs, and edge states.
- [x] T6 Run validation: unit tests, typecheck/build, and a local visual smoke check of the homepage card rendering.
- [x] T7 Bump the theme version, package the release artifact, create a git tag, push to GitHub, and publish a GitHub release.

## Acceptance Checks

- A VPS with multiple bound Ping tasks shows all task rows immediately on the homepage.
- Users can distinguish high latency from packet loss without reading every word.
- No "primary task" or source drawer is visually emphasized on the homepage.
- Long task names and many sources do not overflow outside the card.
- `/compare` remains reachable for the selected VPS and its bound Ping tasks.
- `npm test`, `npm run typecheck`, and `npm run package` pass before release.
