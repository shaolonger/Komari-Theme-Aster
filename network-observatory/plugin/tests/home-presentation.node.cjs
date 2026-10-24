const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { carrierFixture } = require("./carrier-route-fixture.cjs");
const { speedFixture } = require("./carrier-speed-fixture.cjs");
test("route presentation defaults are concise; settings save without rescanning retained reports and apply to visitors", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-route-presentation-"));
  try {
    const f = await carrierFixture(root);
    const initial = (await f.invoke("GET", "/home-routes")).body;
    assert.equal(initial.labelMode, "preferred"); assert.equal(initial.showDetails, false);
    assert.deepEqual(initial.nodes[f.A]["4"][0].forward.networkLabels.sort(), ["163", "CN2"]);
    assert.equal((await f.invoke("PUT", "/home-routes", { revision: 0, nodeUuids: [f.A], labelMode: "full", showDetails: true }, false)).status, 403);
    assert.equal((await f.invoke("PUT", "/home-routes", { revision: 0, nodeUuids: [f.A], labelMode: "invalid" })).status, 400);
    assert.equal((await f.invoke("PUT", "/home-routes", { revision: 0, nodeUuids: [f.A], showDetails: "true" })).status, 400);
    assert.equal(f.state.revision, 0);
    await f.invoke("PUT", "/home-routes", { revision: 0, nodeUuids: [f.A] });
    const originalRead = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (String(file).includes("report-v3")) throw new Error("Presentation-only change scanned raw reports");
      return originalRead(file, ...args);
    };
    try {
      const saved = await f.invoke("PUT", "/home-routes", { revision: 1, nodeUuids: [f.A], labelMode: "full", showDetails: true });
      assert.equal(saved.status, 200);
      const output = (await f.invoke("GET", "/public/routes", undefined, false)).body;
      assert.equal(output.labelMode, "full"); assert.equal(output.showDetails, true);
      assert.ok(output.nodes[f.A]["4"][0].forward.networkLabels.includes("CN2"));
    } finally { fs.readFileSync = originalRead; }
    assert.equal((await f.invoke("PUT", "/home-routes", { revision: 1, nodeUuids: [f.A], labelMode: "preferred" })).status, 409);
    assert.equal((await f.invoke("GET", "/public/routes", undefined, false)).body.labelMode, "full");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("speed captions are opt-in, independently stored and revision/permission guarded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-speed-presentation-"));
  try {
    const f = await speedFixture(root);
    assert.equal((await f.invoke("GET", "/home-speeds?families=1")).body.showDetails, false);
    assert.equal((await f.invoke("PUT", "/home-speeds", { revision: 0, nodeUuids: [f.A], showDetails: true }, false)).status, 403);
    assert.equal((await f.invoke("PUT", "/home-speeds", { revision: 0, nodeUuids: [f.A], showDetails: "yes" })).status, 400);
    const response = await f.invoke("PUT", "/home-speeds", { revision: 0, nodeUuids: [f.A], showDetails: true });
    assert.equal(response.status, 200); assert.equal(f.state.homeSpeedShowDetails, true);
    assert.equal((await f.invoke("GET", "/public/speeds?families=1", undefined, false)).body.showDetails, true);
    assert.equal(f.state.homeRouteShowDetails, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
