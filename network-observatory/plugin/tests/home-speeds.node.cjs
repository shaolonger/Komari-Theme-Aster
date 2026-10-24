const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { speedFixture, A } = require("./carrier-speed-fixture.cjs");
const { projectRound, homeSpeedStore } = require("../src/home-speeds.js");
const { registerReportController } = require("../src/report-controller.js");
test("IPv4 and IPv6 retain independent rounds, rebuild legacy snapshots and keep the old response compatible", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-speed-families-"));
  try {
    const a = await speedFixture(root), b = await speedFixture(root, true, undefined, "6");
    const snapshot = (await b.invoke("GET", "/home-speeds?families=1")).body.nodes[A];
    assert.equal(snapshot["4"].reportId, a.roundId);
    assert.equal(snapshot["6"].reportId, b.roundId);
    assert.equal(snapshot["4"].cities[0].rows[0].download.bitsPerSecond, 200e6);
    assert.equal(snapshot["6"].cities[0].rows[0].download.bitsPerSecond, 1200e6);
    assert.equal((await b.invoke("GET", "/home-speeds")).body.nodes[A].family, "6");
    fs.writeFileSync(path.join(root, "home-speeds", A + ".json"), JSON.stringify(snapshot["4"]));
    registerReportController(b.ctx, b.native);
    const recovered = (await b.invoke("GET", "/home-speeds?families=1")).body.nodes[A];
    assert.equal(recovered["4"].reportId, a.roundId); assert.equal(recovered["6"].reportId, b.roundId);
    registerReportController(b.ctx, b.native);
    const originalRead = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (String(file).includes("report-v3")) throw new Error("Recovered history was scanned after restart");
      return originalRead(file, ...args);
    };
    try { assert.equal((await b.invoke("GET", "/home-speeds?families=1")).body.nodes[A]["4"].reportId, a.roundId); }
    finally { fs.readFileSync = originalRead; }
    const store = homeSpeedStore(root, e => e.code === "ENOENT");
    const failed = b.controller.store.get(A, b.roundId, false);
    failed.id = "failed-six";
    failed.plannedAt = new Date(Date.parse(failed.plannedAt) + 1000).toISOString();
    failed.slots = failed.slots.map(s => ({ ...s, state: "failed", metrics: { runs: [] } }));
    assert.equal(store.observe(failed), true);
    assert.equal(store.summary([A], true)[A]["6"].cities[0].rows[0].download.bitsPerSecond, null);
    assert.equal(store.summary([A], true)[A]["4"].cities[0].rows[0].download.bitsPerSecond, 200e6);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("legacy history recovery yields between batches and public reads never advance the scan", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-speed-backfill-"));
  try {
    const f = await speedFixture(root), template = f.controller.store.get(A, f.roundId, false);
    const directory = path.join(root, "report-v3", "nodes", A, "indexes", "china-speed");
    fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory, { recursive: true });
    const rows = [];
    for (let i = 0; i < 130; i++) {
      const id = require("node:crypto").randomUUID(), at = new Date(Date.parse(template.plannedAt) - i * 60000).toISOString();
      const round = { ...template, id, plannedAt: at, completedAt: at, parameters: { ...template.parameters, family: i === 129 ? "6" : "4" } };
      const folder = path.join(root, "report-v3", "nodes", A, "rounds", id);
      fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(round));
      rows.push({ id, plannedAt: at, completedAt: at });
    }
    fs.writeFileSync(path.join(directory, "2026-10-24.json"), JSON.stringify(rows));
    fs.unlinkSync(path.join(root, "home-speeds", A + ".json"));
    registerReportController(f.ctx, f.native);
    let result = await f.invoke("GET", "/home-speeds?families=1");
    assert.equal(result.body.backfillPending, true);
    f.state.homeSpeedNodes = [A];
    const originalRead = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (String(file).includes("report-v3")) throw new Error("Public API scanned history");
      return originalRead(file, ...args);
    };
    try { assert.ok((await f.invoke("GET", "/public/speeds?families=1", undefined, false)).body.nodes[A]["4"]); }
    finally { fs.readFileSync = originalRead; }
    for (let i = 0; i < 100 && result.body.backfillPending; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      result = await f.invoke("GET", "/home-speeds?families=1");
    }
    assert.equal(result.body.backfillPending, false);
    assert.equal(result.body.nodes[A]["4"].reportId, rows[0].id);
    assert.equal(result.body.nodes[A]["6"].reportId, rows[129].id);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("rebuilding simultaneous suites chooses the later completed round rather than UUID order", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-speed-tie-"));
  try {
    const f = await speedFixture(root);
    const round = f.controller.store.get(A, f.roundId, false);
    const earlier = "ffffffff-ffff-4fff-8fff-ffffffffffff", later = "00000000-0000-4000-8000-000000000001";
    const plannedAt = "2026-10-24T00:00:00.000Z";
    for (const [id, completedAt] of [[earlier, "2026-10-24T00:01:00.000Z"], [later, "2026-10-24T00:02:00.000Z"]]) {
      const target = path.join(root, "report-v3", "nodes", A, "rounds", id);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({ ...round, id, plannedAt, completedAt }));
    }
    const index = path.join(root, "report-v3", "nodes", A, "indexes", "china-speed", "2026-10-24.json");
    fs.rmSync(path.dirname(index), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(index), { recursive: true });
    fs.writeFileSync(index, JSON.stringify([earlier, later].map(id => ({ id, plannedAt, completedAt: id === earlier ? "2026-10-24T00:01:00.000Z" : "2026-10-24T00:02:00.000Z" }))));
    fs.unlinkSync(path.join(root, "home-speeds", A + ".json"));
    const result = await f.invoke("POST", "/home-speeds/rebuild", {});
    assert.equal(result.body.nodes[A].reportId, later);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("real public-speed preset projects the finished round only, P1 directions and dates without private fields", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-speed-home-"));
  try {
    const f = await speedFixture(root, false);
    for (const [i, job] of f.plan.jobs.entries()) {
      f.controller.complete(job, f.data(i), job.source);
      const node = (await f.invoke("GET", "/home-speeds")).body.nodes[A];
      if (i < f.plan.jobs.length - 1) assert.equal(node, undefined);
      else {
        assert.equal(node.family, "4"); assert.equal(node.reportId, f.roundId);
        assert.ok(Number.isFinite(Date.parse(node.at)));
        assert.equal(node.cities[0].rows[0].download.bitsPerSecond, 200e6);
        assert.equal(node.cities[0].rows[0].upload.bitsPerSecond, 100e6);
        assert.equal(node.cities[0].rows[0].upload.basis, "tcp-acked");
        assert.equal(node.cities.length, 3);
        assert.equal(JSON.stringify(node).includes("SECRET"), false);
        assert.equal(JSON.stringify(node).includes("9999"), false);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("publication is separate from routes, admin-only, revision-checked and immediately excludes hidden/deleted nodes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-speed-publish-"));
  try {
    const f = await speedFixture(root);
    f.state.homeRouteNodes = [A];
    assert.deepEqual((await f.invoke("GET", "/public/speeds", undefined, false)).body.nodes, {});
    assert.equal((await f.invoke("GET", "/home-speeds", undefined, false)).status, 403);
    assert.equal((await f.invoke("PUT", "/home-speeds", { revision: 0, nodeUuids: [A] }, false)).status, 403);
    assert.equal((await f.invoke("PUT", "/home-speeds", { revision: 9, nodeUuids: [A] })).status, 409);
    f.state.inventory[0].publicVisible = false;
    assert.equal((await f.invoke("PUT", "/home-speeds", { revision: 0, nodeUuids: [A] })).status, 400);
    f.state.inventory[0].publicVisible = true;
    assert.equal((await f.invoke("PUT", "/home-speeds", { revision: 0, nodeUuids: [A], display: true })).status, 200);
    const published = (await f.invoke("GET", "/public/speeds", undefined, false)).body;
    assert.equal(published.nodes[A].reportId, f.roundId);
    assert.equal(JSON.stringify(published).includes("SECRET"), false);
    const originalRead = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (String(file).includes("report-v3")) throw new Error("Public summary scanned report history");
      return originalRead(file, ...args);
    };
    try { for (let i = 0; i < 20; i++) assert.ok((await f.invoke("GET", "/public/speeds", undefined, false)).body.nodes[A]); }
    finally { fs.readFileSync = originalRead; }
    f.state.inventory[0].publicVisible = false;
    assert.deepEqual((await f.invoke("GET", "/public/speeds", undefined, false)).body.nodes, {});
    f.state.inventory = [];
    assert.deepEqual((await f.invoke("GET", "/public/speeds", undefined, false)).body.nodes, {});
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("history rebuild uses retained metrics after raw-detail expiry and a new failed round replaces older successes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-speed-rebuild-"));
  try {
    const f = await speedFixture(root), round = f.controller.store.get(A, f.roundId, false);
    fs.rmSync(path.join(root, "home-speeds"), { recursive: true, force: true });
    fs.rmSync(path.join(root, "report-v3", "nodes", A, "rounds", f.roundId, "measurements"), { recursive: true, force: true });
    registerReportController(f.ctx, f.native);
    const rebuilt = (await f.invoke("GET", "/home-speeds")).body.nodes[A];
    assert.equal(rebuilt.cities[0].rows[0].download.bitsPerSecond, 200e6);
    fs.writeFileSync(path.join(root, "home-speeds", A + ".json"), "broken-cache");
    assert.equal((await f.invoke("POST", "/home-speeds/rebuild", {})).body.nodes[A].cities[0].rows[0].download.bitsPerSecond, 200e6);
    const store = homeSpeedStore(root, e => e.code === "ENOENT");
    const later = { ...round, id: "next-round", plannedAt: new Date(Date.parse(round.plannedAt) + 1).toISOString(),
      completedAt: new Date(Date.parse(round.completedAt) + 1).toISOString(), state: "failed",
      parameters: { ...round.parameters, family: "6" },
      slots: round.slots.map(s => ({ ...s, state: "failed", metrics: { runs: [] } })) };
    assert.equal(store.observe(later), true);
    assert.equal(store.observe(round), false);
    assert.equal(store.summary([A])[A].family, "6");
    assert.equal(store.summary([A])[A].cities[0].rows[0].download.bitsPerSecond, null);
    assert.equal(homeSpeedStore(root, e => e.code === "ENOENT").summary([A])[A].reportId, "next-round");
    assert.equal(homeSpeedStore(root, e => e.code === "ENOENT", () => Date.parse(later.completedAt) + 86400001).summary([A])[A].stale, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("partial, zero, estimated, missing P1 and non-mainland rounds preserve their actual semantics", () => {
  const base = { module: "china-speed", id: A, completedAt: new Date().toISOString(), parameters: { family: "4" },
    slots: [{ state: "partial", source: { city: "上海", carrier: "联通" }, metrics: { runs: [
      { streams: 1, vpsDirection: "download", bitsPerSecond: 0, state: "partial", intervalSource: "receiver-read" },
      { streams: 1, vpsDirection: "upload", bitsPerSecond: 20e6, state: "partial", measurementBasis: "sender-write" },
      { streams: 4, vpsDirection: "download", bitsPerSecond: 900e6, state: "ok" },
    ] } }] };
  const row = projectRound(base).cities[1].rows[1];
  assert.equal(row.download.bitsPerSecond, 0); assert.equal(row.download.state, "partial");
  assert.equal(row.upload.basis, "estimated");
  assert.equal(projectRound({ ...base, completedAt: null }), null);
  assert.equal(projectRound({ ...base, module: "international-speed" }), null);
  assert.equal(projectRound({ ...base, slots: [{ ...base.slots[0], metrics: { runs: base.slots[0].metrics.runs.slice(2) } }] }).cities[1].rows[1].download.bitsPerSecond, null);
});
