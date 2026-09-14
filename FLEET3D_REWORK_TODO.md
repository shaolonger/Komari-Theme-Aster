# Fleet3D Rework TODO

Scope: rebuild the VPS 3D view from a decorative star map into an operational, readable, and directly controllable 3D management view.

Context recovery note: if LLM context compaction happens, resume from this file. Run `git status --short`, `git log --oneline -10`, and continue from the first unchecked task. Each task must be implemented, checked, and committed with its checkbox marked complete before moving to the next task. Remote terminal, remote command execution, GPU controls, and automatic update controls remain out of scope.

## Product Acceptance Criteria

- A user can identify offline, risky, high-latency, high-loss, traffic-heavy, and expiring VPS nodes without opening the inspector.
- The 3D camera does not reset after passive data refresh, selection, cruise target changes, or elapsed animation time.
- Mouse and trackpad interaction works: drag rotates, wheel zooms, right/middle drag pans, hover identifies nodes, click selects, double-click focuses, and Shift-drag marquee-selects for compare.
- Manual camera control has priority. Cruise/story automation pauses when the user interacts with the scene.
- Visual validation must check more than nonblank pixels: it must verify camera persistence after drag, zoom response, node selection, and overlay non-overlap on desktop and mobile.

## Tasks

- [x] Create this rework TODO file with detailed scope, acceptance criteria, and recovery instructions.
- [x] Refactor `Fleet3DScene` into a stable Three.js runtime: initialize renderer/camera/controls once, update scene objects through refs, prevent camera resets, and add OrbitControls drag/zoom/pan support.
- [x] Redesign VPS node visual encoding so each node is glanceable: status core, risk ring, CPU/memory/disk mini arcs, ping halo, traffic plume, expiry/traffic/completeness badges, and consistent scale rules.
- [x] Add scene labels and hover affordances: viewport-aware node labels, hover tooltip with key metrics, click selection, double-click focus, Shift-drag compare marquee, and visible selected/focused state.
- [x] Update 3D page controls around the new interaction model: fit-all button, manual/auto state, cruise/story pause on user interaction, clearer legends, and reduced overlay obstruction.
- [x] Add deterministic unit tests for visual encoding, camera/automation state helpers, and interaction-facing data contracts.
- [x] Run browser visual and interaction verification on desktop and mobile: canvas nonblank, drag changes camera and persists, wheel zoom changes distance, click selects a VPS, no automatic reset after 8 seconds, overlays do not collide, and console has no errors.
- [x] Update version, build package, tag, push to GitHub, and create a GitHub release with the new zip asset.
