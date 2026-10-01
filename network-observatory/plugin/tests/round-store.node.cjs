const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { roundStore } = require("../src/round-store.js");
const { normalizeSuite, planSlots } = require("../src/report-model.js");
const { ENDPOINTS, PRESETS } = require("../src/report-catalog.js");
const A = "c388e74d-a922-4ae1-bd10-1fb30e2e53de";
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-round-"));
  let now = Date.parse("2026-09-30T23:59:00Z");
  const store = roundStore(
    root,
    (e) => e.code === "ENOENT",
    () => now,
  );
  return {
    root,
    store,
    advance: (ms) => {
      now += ms;
    },
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
function input(size = 1) {
  return {
    nodeUuid: A,
    module: "international",
    suiteId: crypto.randomUUID(),
    batchId: crypto.randomUUID(),
    slots: Array.from({ length: size }, (_, i) => ({
      id: "target:" + i,
      jobId: crypto.randomUUID(),
      target: "example.net",
    })),
  };
}
function job(round, i = 0) {
  return {
    id: round.slots[i].jobId,
    roundId: round.id,
    slotId: round.slots[i].id,
    nodeUuid: A,
    executor: "node:" + A,
    operation: "latency",
    target: "example.net",
    options: {},
    source: { provider: "runner" },
  };
}
test("first round on missing directories, 250 targets, replay, and ownership remain intact", () => {
  const f = fixture();
  try {
    const r = f.store.create(input(250));
    for (let i = 0; i < 250; i++)
      f.store.complete(job(r, i), {
        kind: "latency",
        state: i % 2 ? "ok" : "missing",
        diagnostic: "coverage",
      });
    const first = f.store.get(A, r.id);
    assert.equal(first.measurements.length, 250);
    assert.equal(first.counts.completed, 250);
    assert.equal(first.state, "partial");
    const replay = f.store.complete(job(r), {
      kind: "latency",
      state: "failed",
    });
    assert.equal(replay.data.state, "missing");
    assert.equal(f.store.get(A, r.id).measurements.length, 250);
    assert.equal(f.store.receipt(job(r).id, "node:" + A), true);
    assert.equal(f.store.receipt(job(r).id, "probe:" + A), false);
    assert.throws(() => f.store.get("../secrets", r.id), /UUID/);
    assert.throws(
      () => f.store.complete({ ...job(r), slotId: "other" }, { state: "ok" }),
      /目标/,
    );
  } finally {
    f.close();
  }
});
test("cursor crosses UTC days and index can be recovered without daily report files", () => {
  const f = fixture();
  try {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(f.store.create(input()).id);
      f.advance(120000);
    }
    const one = f.store.list(A, "international", { limit: 2 });
    const two = f.store.list(A, "international", {
      limit: 2,
      cursor: one.nextCursor,
    });
    const three = f.store.list(A, "international", {
      limit: 2,
      cursor: two.nextCursor,
    });
    assert.deepEqual(
      [...one.rounds, ...two.rounds, ...three.rounds].map((r) => r.id),
      ids.reverse(),
    );
    assert.equal(three.nextCursor, null);
    fs.rmSync(path.join(f.root, "report-v3", "nodes", A, "indexes"), {
      recursive: true,
    });
    assert.equal(f.store.rebuild(A), 5);
    assert.equal(f.store.list(A, "international").rounds.length, 5);
    assert.throws(
      () => f.store.list(A, "international", { cursor: "../../../state.json" }),
      /游标/,
    );
  } finally {
    f.close();
  }
});
test("result committed before manifest is recovered after a simulated crash", () => {
  const f = fixture();
  try {
    const r = f.store.create(input());
    const original = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to.endsWith("manifest.json")) throw new Error("crash");
      return original(from, to);
    };
    try {
      assert.throws(
        () => f.store.complete(job(r), { kind: "latency", state: "ok" }),
        /crash/,
      );
    } finally {
      fs.renameSync = original;
    }
    const restarted = roundStore(f.root, (e) => e.code === "ENOENT");
    const recovered = restarted.get(A, r.id);
    assert.equal(recovered.state, "complete");
    assert.equal(recovered.measurements.length, 1);
  } finally {
    f.close();
  }
});
test("detail expiry retains summaries, and rebuild cannot revive expired details", () => {
  const f = fixture();
  try {
    const r = f.store.create(input());
    f.store.complete(job(r), {
      kind: "latency",
      state: "ok",
      method: "TCP connect",
      tcpQuality: { address: "1.1.1.1", medianMs: 8, sent: 10, received: 9 },
    });
    f.advance(8 * 86400000);
    f.store.cleanup(A);
    assert.equal(f.store.get(A, r.id).measurements.length, 0);
    assert.equal(f.store.get(A, r.id).detailAvailable, false);
    assert.equal(f.store.get(A, r.id).slots[0].metrics.medianMs, 8);
    assert.equal(f.store.get(A, r.id).slots[0].metrics.address, "1.1.1.1");
    assert.equal(f.store.get(A, r.id).slots[0].metrics.method, "TCP connect");
    f.store.rebuild(A);
    assert.equal(
      f.store.list(A, "international").rounds[0].detailAvailable,
      false,
    );
    f.advance(83 * 86400000);
    f.store.cleanup(A);
    assert.equal(f.store.list(A, "international").rounds.length, 0);
    assert.equal(f.store.get(A, r.id), null);
    assert.equal(f.store.rebuild(A), 0);
    assert.equal(
      fs.readdirSync(path.join(f.root, "report-v3", "nodes", A, "rounds"))
        .length,
      0,
    );
  } finally {
    f.close();
  }
});
test("presets plan actual endpoints, separate family, and pair both directions within one round", () => {
  const suite = normalizeSuite({
    clients: [A],
    modules: [{ module: "international", preset: "international-complete" }],
  });
  const plan = planSlots(
    { probes: {}, endpoints: {} },
    suite,
    suite.modules[0],
    A,
    crypto.randomUUID(),
  );
  assert.equal(
    plan.slots.length,
    PRESETS.find((p) => p.id === "international-complete").endpoints.length,
  );
  assert.equal(new Set(plan.jobs.map((j) => j.slotId)).size, plan.slots.length);
  assert.ok(
    plan.jobs.every(
      (j) => j.operation === "latency" && j.options.reportVersion === 3,
    ),
  );
  const probeId = crypto.randomUUID(),
    roundId = crypto.randomUUID();
  const routeSuite = normalizeSuite({
    clients: [A],
    modules: [
      {
        module: "routes",
        endpoints: [],
        sources: [probeId],
        publicSources: false,
      },
    ],
  });
  const routes = planSlots(
    {
      probes: {
        [probeId]: {
          name: "home",
          city: "北京",
          carrier: "电信",
          publicAddress: "8.8.8.8",
        },
      },
      endpoints: { [A]: { address: "1.1.1.1" } },
    },
    routeSuite,
    routeSuite.modules[0],
    A,
    roundId,
  );
  assert.equal(routes.jobs.length, 2);
  assert.equal(routes.jobs[0].pairId, routes.jobs[1].pairId);
  assert.ok(routes.jobs[0].pairId.startsWith(roundId + ":"));
  assert.equal(
    ENDPOINTS.filter((e) => e.category === "telegram" && e.family === "4")
      .length,
    5,
  );
});
test("unavailable mainland speed resources become nine explicit slots, with no invented Mbps", () => {
  const suite = normalizeSuite({
    clients: [A],
    trafficAccepted: true,
    modules: [{ module: "china-speed" }],
  });
  assert.deepEqual(suite.modules[0].streams, [1]);
  const plan = planSlots(
    { probes: {}, endpoints: {} },
    suite,
    suite.modules[0],
    A,
    crypto.randomUUID(),
  );
  assert.equal(plan.slots.length, 9);
  assert.ok(plan.jobs.every((j) => j.missingReason && !j.target));
  assert.throws(
    () =>
      normalizeSuite({ clients: [A], modules: [{ module: "china-speed" }] }),
    /流量/,
  );
});
