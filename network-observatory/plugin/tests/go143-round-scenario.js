// Executed with the official Komari 1.4.3 jsruntime, not a Node compatibility mock.
function runRoundScenario() {
  const crypto = require("crypto");
  let now = Date.now();
  const store = require("./src/round-store.js").roundStore(__storageDir__, isMissingFile, () => now);
  const model = require("./src/report-model.js");
  const node = "c388e74d-a922-4ae1-bd10-1fb30e2e53de";
  const suite = model.normalizeSuite({ clients: [node], modules: [{ module: "international", endpoints: ["aws:ap-east-1", "telegram:dc5:ipv4"] }] });
  const id = crypto.randomUUID();
  const plan = model.planSlots({ endpoints: {}, probes: {} }, suite, suite.modules[0], node, id);
  const round = store.create({ id, nodeUuid: node, suiteId: suite.id, module: "international", slots: plan.slots, _jobs: plan.jobs });
  store.complete(plan.jobs[0], { kind: "latency", state: "ok" });
  store.complete(plan.jobs[1], { kind: "latency", state: "missing", diagnostic: "source unavailable" });
  store.complete(plan.jobs[0], { kind: "latency", state: "failed" });
  const saved = store.get(node, round.id);
  if (saved.state !== "partial" || saved.measurements.length !== 2 || saved.measurements[0].data.state !== "ok") throw new Error("round mismatch: " + JSON.stringify(saved));
  if (store.get(node, round.id, false)._jobs !== undefined) throw new Error("completed recovery snapshot not compacted");
  if (store.pending(node).length !== 0) throw new Error("completed jobs recovered");
  if (store.list(node, "international").rounds.length !== 1) throw new Error("round index mismatch");
  if (!store.receipt(plan.jobs[0].id, "node:" + node)) throw new Error("receipt mismatch");
  store.rebuild(node);
  now += 8 * 86400000;
  store.cleanup(node);
  if (store.get(node, round.id).detailAvailable) throw new Error("expired detail revived");
  now += 83 * 86400000;
  store.cleanup(node);
  if (store.get(node, round.id) !== null || store.rebuild(node) !== 0) throw new Error("expired round revived");
  console.log("Official Komari runtime: first round, manifest, per-target files, index, replay, recovery and catalogue passed");
  return true;
}
