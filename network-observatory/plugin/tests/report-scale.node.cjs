const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { registerNativeController } = require("../src/native-controller.js");
const { ENDPOINTS } = require("../src/report-catalog.js");
const { normalizeSuite } = require("../src/report-model.js");
test("50 VPS × 150 latency targets fit one round, survive queue recovery, allow four local tasks and isolate histories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-report-scale-")),
    routes = new Map(),
    inventory = Array.from({ length: 50 }, (_, i) => ({
      uuid: crypto.randomUUID(),
      name: "Scale " + i,
      ipv4: "8.8.8.8",
      group: "Scale",
    })),
    token = "c".repeat(64);
  const c = registerNativeController({
    storageDir: root,
    isMissingFile: (e) => e.code === "ENOENT",
    server: {
      route: (m, p, f) => routes.set(m + " " + p, f),
      call: async () => inventory,
    },
    readState: () => ({
      tasks: [],
      nodes: Object.fromEntries(
        inventory.map((n) => [
          n.uuid,
          {
            tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
          },
        ]),
      ),
    }),
    authorized: () => true,
    readBody: (r) => JSON.parse(r.body || "{}"),
    respond: (res, status, body) => Object.assign(res, { status, body }),
  });
  try {
    await c.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await c.lock(() => {
      const s = c.read();
      s.inventory = inventory.map((n) => ({ ...n, ip: n.ipv4 }));
      for (const n of inventory)
        s.workers["node:" + n.uuid] = {
          seenAt: Date.now(),
          version: "v3",
          tools: [],
          features: ["report-v3", "latency-samples"],
        };
      fs.writeFileSync(path.join(root, "native-state.json"), JSON.stringify(s));
    });
    const endpoints = ENDPOINTS.filter(
      (e) => e.uses.includes("latency") && e.family !== "6",
    )
      .slice(0, 150)
      .map((e) => e.id);
    // Latency directory presently has fewer than 150 entries; extra declared
    // endpoints exercise the stated capacity without inventing production hosts.
    const s = c.read();
    for (let i = endpoints.length; i < 150; i++) {
      const id = "custom:" + crypto.randomUUID();
      s.reportResources ||= [];
      s.reportResources.push({
        ...ENDPOINTS[0],
        id,
        address: "scale" + i + ".example.net",
        family: "auto",
      });
      endpoints.push(id);
    }
    const suite = normalizeSuite(
      {
        clients: inventory.map((n) => n.uuid),
        modules: [
          {
            module: "international",
            endpoints,
            timing: { type: "interval", minutes: 30 },
          },
        ],
      },
      s.reportResources,
    );
    const preview = c.roundController.preview(s, suite);
    assert.equal(preview.exceedsCapacity, false);
    assert.equal(preview.nodes.length, 50);
    assert.equal(preview.nodes[0].capacity.samplesPerDay, 72000);
    const started = performance.now(),
      batch = crypto.randomUUID();
    for (const n of inventory)
      c.roundController.enqueue(
        s,
        suite,
        suite.modules[0],
        n.uuid,
        batch,
        Date.now(),
      );
    assert.equal(s.jobs.length, 7500);
    fs.writeFileSync(path.join(root, "native-state.json"), JSON.stringify(s));
    for (const n of inventory) {
      const page = c.roundController.store.list(n.uuid, "international");
      assert.equal(page.rounds.length, 1);
      assert.equal(page.rounds[0].counts.expected, 150);
      assert.equal(c.roundController.store.pending(n.uuid).length, 150);
    }
    async function poll() {
      const res = {};
      await routes.get(
        "GET /api/aster-network-observatory/v2/workers/node/:id/poll",
      )(
        {
          url:
            "/api/aster-network-observatory/v2/workers/node/" +
            inventory[0].uuid +
            "/poll",
          headers: { authorization: "Bearer " + token },
        },
        res,
      );
      return res;
    }
    const tasks = [];
    for (let i = 0; i < 4; i++) tasks.push((await poll()).body.task);
    assert.equal(tasks.filter(Boolean).length, 4);
    assert.equal((await poll()).body.task, null);
    const firstRound = tasks[0].roundId;
    assert.equal(
      c.roundController.store.get(inventory[1].uuid, firstRound),
      null,
    );
    const elapsed = performance.now() - started;
    console.log(
      "7500-target queue, 50 isolated indexes, four-way claims:",
      Math.round(elapsed),
      "ms",
    );
    assert.ok(elapsed < 30000, "queue/store setup exceeded 30 seconds");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
