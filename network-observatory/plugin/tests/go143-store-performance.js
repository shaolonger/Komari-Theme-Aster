async function runStorePerformance() {
  const fs = require("fs"), path = require("path");
  const { roundStore, MODULES } = require("./src/round-store.js");
  const DAY = 86400000, root = path.join(__storageDir__, "retention-benchmark");
  const base = Date.parse("2026-10-24T12:00:00Z"); let now = base;
  const uuid = number => "00000000-0000-4000-8000-" + String(number).padStart(12, "0");
  const nodes = Array.from({ length: 52 }, (_, i) => uuid(i + 1));
  let nextId = 1000, indexFiles = 0, roundRows = 0;
  // Real inventory/plan shape, with 14 retained days and a CI-sized receipt
  // subset. The local full-history benchmark separately uses 90d/100k receipts.
  for (let n = 0; n < nodes.length; n++) {
    const modules = [];
    if (n < 40) modules.push("international");
    if (n < 30) modules.push("routes");
    if (n < 30) modules.push("china-speed");
    for (const module of modules) for (let day = 0; day < 14; day++) {
      const at = new Date(base - day * DAY).toISOString(), date = at.slice(0, 10);
      const count = module === "china-speed" ? (n >= 10 ? 2 : 1) : 24;
      const rows = Array.from({ length: count }, (_, hour) => ({
        id: uuid(nextId++), nodeUuid: nodes[n], module,
        plannedAt: date + "T" + String(hour).padStart(2, "0") + ":00:00.000Z", completedAt: at,
        state: "complete", detailAvailable: day < 7, counts: { expected: 12, completed: 12, ok: 12 }, schema: 3,
      })).reverse();
      const dir = path.join(root, "report-v3", "nodes", nodes[n], "indexes", module);
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, date + ".json"), JSON.stringify(rows));
      indexFiles++; roundRows += rows.length;
    }
  }
  const receipts = path.join(root, "report-v3", "receipts"); fs.mkdirSync(receipts, { recursive: true });
  const receiptCount = 4096;
  for (let i = 0; i < receiptCount; i++) fs.writeFileSync(path.join(receipts, uuid(nextId++) + ".json"), JSON.stringify({ executor: "node:" + nodes[i % nodes.length], at: base - DAY }));
  const store = roundStore(root, isMissingFile, () => now);
  const oldRead = fs.readFileSync, oldWrite = fs.writeFileSync;
  let indexReads = 0, receiptReads = 0, metadataReads = 0, writes = 0;
  fs.readFileSync = function(file, ...args) {
    const name = String(file);
    if (name.includes("/indexes/")) indexReads++;
    if (name.includes("/receipts/")) receiptReads++;
    if (name.endsWith("retention.json") || name.endsWith("maintenance.json")) metadataReads++;
    return oldRead(file, ...args);
  };
  fs.writeFileSync = function(file, ...args) { writes++; return oldWrite(file, ...args); };
  let baselineMs, coldMs, maxSlice = 0, coldSlices = 0, steadyMs, steadySlices = 0;
  try {
    // Baseline algorithm from plugin 1.13.0: full per-node daily index parsing
    // and one global JSON receipt sweep, even when nothing has expired.
    const started = Date.now();
    for (const node of nodes) for (const module of MODULES) {
      const dir = path.join(root, "report-v3", "nodes", node, "indexes", module);
      let names;
      try { fs.accessSync(dir); names = fs.readdirSync(dir); } catch (_error) { names = []; }
      for (const name of names.filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name))) {
        for (const row of JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))) {
          if (row.completedAt) Date.parse(row.completedAt);
        }
      }
    }
    for (const name of fs.readdirSync(receipts)) JSON.parse(fs.readFileSync(path.join(receipts, name), "utf8"));
    baselineMs = Date.now() - started;
    if (indexReads !== indexFiles || receiptReads !== receiptCount) throw new Error("Baseline failed to scan the seeded workload");
    indexReads = receiptReads = metadataReads = writes = 0;
    let result, coldStart = Date.now();
    do {
      result = store.maintenanceStep(nodes, { maxSteps: 32, maxMs: 8 });
      maxSlice = Math.max(maxSlice, result.elapsedMs); coldSlices++;
      if (coldSlices > 10000) throw new Error("Cold retention migration never completed");
    } while (result.pending);
    coldMs = Date.now() - coldStart;
    if (indexReads !== indexFiles || receiptReads !== receiptCount) throw new Error("Cold migration repeatedly parsed retained history");
    now += 3600001; indexReads = receiptReads = metadataReads = writes = 0;
    const steadyStart = Date.now();
    do {
      result = store.maintenanceStep(nodes, { maxSteps: 32, maxMs: 8 });
      maxSlice = Math.max(maxSlice, result.elapsedMs); steadySlices++;
      if (steadySlices > 10000) throw new Error("Steady retention pass never completed");
    } while (result.pending);
    steadyMs = Date.now() - steadyStart;
    if (indexReads || receiptReads) throw new Error("Steady maintenance reparsed retained report/receipt JSON");
    console.log("Official Komari retention: 52 VPS /", roundRows, "rounds /", receiptCount,
      "legacy receipts; old full sweep:", baselineMs, "ms; cold migration:", coldMs, "ms /", coldSlices,
      "slices; steady full pass:", steadyMs, "ms /", steadySlices, "slices; largest slice:", maxSlice,
      "ms; steady history reads:", indexReads, "receipt reads:", receiptReads, "metadata reads:", metadataReads,
      "journal writes:", writes, "; cold scheduled minimum spread:", Math.max(0, coldSlices - 1) * 500, "ms");
    // The time budget cannot preempt a native filesystem call. Keep a generous
    // CI ceiling in addition to deterministic read/step gates, and print maxima.
    if (maxSlice > 500) throw new Error("Retention monopolized the JS runtime for >500ms in one slice");
    if (steadySlices > 60) throw new Error("Steady maintenance exceeded the 52-node operation budget");
  } finally { fs.readFileSync = oldRead; fs.writeFileSync = oldWrite; }
  const round = store.batch(() => {
    const value = store.create({ nodeUuid: nodes[0], module: "international", slots: Array.from({ length: 250 }, (_, i) => ({ id: "slot:" + i, jobId: uuid(nextId++), target: "example.net" })) });
    for (const slot of value.slots) store.complete({ id: slot.jobId, slotId: slot.id, roundId: value.id, nodeUuid: nodes[0], executor: "node:" + nodes[0], operation: "latency", target: "example.net", options: {} }, { kind: "latency", state: "missing" });
    return value;
  });
  if (store.get(nodes[0], round.id, false).counts.completed !== 250) throw new Error("Batched results were lost");
  if (!store.measurement(nodes[0], round.id, round.slots[0].id)) throw new Error("Single-slot lookup failed");
  const expiryRoot = path.join(__storageDir__, "retention-expiry");
  let expiryNow = base - 8 * DAY;
  let expiry = roundStore(expiryRoot, isMissingFile, () => expiryNow);
  const expired = expiry.create({ nodeUuid: nodes[0], module: "international", slots: [{ id: "expire", jobId: uuid(nextId++), target: "example.net" }] });
  expiry.complete({ id: expired.slots[0].jobId, slotId: "expire", roundId: expired.id, nodeUuid: nodes[0], executor: "node:" + nodes[0], operation: "latency", target: "example.net", options: {} }, { kind: "latency", state: "ok" });
  expiryNow = base;
  let maintenance, restartSteps = 0;
  do {
    maintenance = expiry.maintenanceStep([nodes[0]], { maxSteps: 1, maxMs: 8 });
    if (++restartSteps % 3 === 0) expiry = roundStore(expiryRoot, isMissingFile, () => expiryNow);
    if (restartSteps > 500) throw new Error("Restarted expiry cursor did not finish");
  } while (maintenance.pending);
  if (expiry.get(nodes[0], expired.id).detailAvailable !== false || expiry.measurement(nodes[0], expired.id, "expire") !== null) throw new Error("Incremental detail expiry was not durable");
  expiryNow += 83 * DAY;
  do { maintenance = expiry.maintenanceStep([nodes[0]], { maxSteps: 2, maxMs: 8 }); } while (maintenance.pending);
  if (expiry.get(nodes[0], expired.id) !== null) throw new Error("Incremental 90-day expiry retained the round");
  console.log("Official Komari retention: restart between one-step expiry slices, 7-day detail and 90-day summary expiry passed");
  return true;
}
