const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { speedFixture, A } = require("./carrier-speed-fixture.cjs");
const { projectRound, homeSpeedStore } = require("../src/home-speeds.js");
const { registerReportController } = require("../src/report-controller.js");
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
