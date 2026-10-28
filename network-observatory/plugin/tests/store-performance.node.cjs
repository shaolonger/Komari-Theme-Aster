const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { roundStore } = require("../src/round-store.js");
const NODE = "c388e74d-a922-4ae1-bd10-1fb30e2e53de", DAY = 86400000;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-store-performance-"));
  let now = Date.parse("2026-10-24T12:00:00Z");
  const make = () => roundStore(root, error => error.code === "ENOENT", () => now);
  return { root, make, set: value => { now = value; }, now: () => now, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function create(store, size = 1, extra = {}) {
  return store.create({ nodeUuid: NODE, module: "international", suiteId: crypto.randomUUID(), slots: Array.from({ length: size }, (_, i) => ({ id: "target:" + i, jobId: crypto.randomUUID(), target: "example.net" })), ...extra });
}
const job = (round, index = 0) => ({ id: round.slots[index].jobId, roundId: round.id, slotId: round.slots[index].id, nodeUuid: NODE, executor: "node:" + NODE, operation: "latency", target: "example.net", options: {} });
function drain(store, nodes = [NODE], options = { maxSteps: 3, maxMs: 100 }) {
  let calls = 0, result;
  do { result = store.maintenanceStep(nodes, options); assert.ok(++calls < 20000, "maintenance did not finish"); } while (result.pending);
  return calls;
}
test("full report deletion survives crashes and bounded maintenance removes its remnants", () => {
  for (const phase of ["rename", "index", "receipt", "directory", "intent"]) {
    const f = fixture(), store = f.make(), unlink = fs.unlinkSync, remove = fs.rmSync, rename = fs.renameSync;
    try {
      const round = create(store, 1, { module: "tcpquality-full" });
      const fullJob = { ...job(round), operation: "tcpquality-full" };
      store.complete(fullJob, { kind: "tcpquality-full", state: "failed", deadlineExpired: true });
      fs.unlinkSync = function(file, ...args) {
        const name = String(file);
        if ((phase === "index" && name.includes("/indexes/tcpquality-full/")) ||
            (phase === "receipt" && name.includes("/full-receipts/")) ||
            (phase === "intent" && name.includes("/full-delete-intents/"))) throw new Error("simulated deletion crash");
        return unlink(file, ...args);
      };
      fs.renameSync = function(from, to) {
        if (phase === "rename" && String(to).includes("/.deleting-")) throw new Error("simulated deletion crash");
        return rename(from, to);
      };
      fs.rmSync = function(file, ...args) {
        if (phase === "directory" && String(file).includes("/.deleting-")) throw new Error("simulated deletion crash");
        return remove(file, ...args);
      };
      assert.throws(() => store.deleteFullRound(NODE, round.id), /simulated deletion crash/);
      fs.unlinkSync = unlink; fs.rmSync = remove; fs.renameSync = rename;
      const restarted = f.make();
      assert.equal(restarted.get(NODE, round.id), null);
      assert.equal(restarted.acceptLateFull(fullJob.id, fullJob.executor, { kind: "tcpquality-full", state: "ok" }), false);
      assert.equal(restarted.rebuild(NODE), 0);
      drain(restarted);
      assert.deepEqual(restarted.list(NODE, "tcpquality-full").rounds, []);
      assert.equal(restarted.receipt(fullJob.id, fullJob.executor), false);
      assert.equal(fs.existsSync(path.join(f.root, "report-v3", "nodes", NODE, "rounds", ".deleting-" + round.id)), false);
      assert.equal(fs.existsSync(path.join(f.root, "report-v3", "full-delete-intents", NODE + "_" + round.id + ".json")), false);
    } finally { fs.unlinkSync = unlink; fs.rmSync = remove; fs.renameSync = rename; f.close(); }
  }
});
test("250-result batch keeps write-ahead results and coalesces manifest, index and active commits", () => {
  const f = fixture(), store = f.make(), originalWrite = fs.writeFileSync, originalAccess = fs.accessSync;
  let manifests = 0, indexes = 0, active = 0, measurements = 0, uncommittedProbes = 0;
  fs.writeFileSync = function(file, ...args) {
    const name = String(file);
    if (name.endsWith("manifest.json.tmp")) manifests++;
    if (name.includes("/indexes/")) indexes++;
    if (name.endsWith("active.json.tmp")) active++;
    if (name.includes("/measurements/")) measurements++;
    return originalWrite(file, ...args);
  };
  fs.accessSync = function(file, ...args) { if (String(file).includes("/measurements/")) uncommittedProbes++; return originalAccess(file, ...args); };
  try {
    let round;
    store.batch(() => {
      round = create(store, 250);
      for (let i = 0; i < 250; i++) store.complete(job(round, i), { kind: "latency", state: "missing" });
    });
    assert.equal(manifests, 2); assert.equal(indexes, 1); assert.equal(active, 2); assert.equal(measurements, 250);
    assert.equal(uncommittedProbes, 250, "normal result commits probed all unfinished slots");
    assert.equal(store.get(NODE, round.id, false).counts.completed, 250);
    assert.equal(store.receipt(job(round).id, "node:" + NODE), true);
    assert.equal(store.receipt(job(round).id, "probe:" + NODE), false);
  } finally { fs.writeFileSync = originalWrite; fs.accessSync = originalAccess; f.close(); }
});
test("batch interruption preserves committed measurements and resumes after a failed final manifest rename", () => {
  const f = fixture(), store = f.make(), originalRename = fs.renameSync;
  let round, written = false;
  try {
    assert.throws(() => store.batch(() => {
      round = create(store, 3);
      fs.renameSync = function(from, to) {
        if (String(to).endsWith("manifest.json")) { written = true; throw new Error("interrupted batch"); }
        return originalRename(from, to);
      };
      store.complete(job(round), { kind: "latency", state: "ok" });
    }), /interrupted batch/);
    fs.renameSync = originalRename;
    assert.equal(written, true);
    const restarted = f.make(), value = restarted.get(NODE, round.id);
    assert.equal(value.counts.completed, 1); assert.equal(value.measurements.length, 1);
    assert.equal(restarted.pending(NODE).length, 0); // no _jobs supplied in this storage fixture
    assert.equal(restarted.list(NODE, "international").rounds[0].counts.completed, 1);
  } finally { fs.renameSync = originalRename; f.close(); }
});
test("single-slot measurement reads one detail, validates membership, and respects expiry", () => {
  const f = fixture(), store = f.make(), originalRead = fs.readFileSync;
  try {
    const round = create(store, 12);
    store.batch(() => { for (let i = 0; i < 12; i++) store.complete(job(round, i), { kind: "latency", state: "ok" }); });
    let detailReads = 0;
    fs.readFileSync = function(file, ...args) { if (String(file).includes("/measurements/")) detailReads++; return originalRead(file, ...args); };
    assert.equal(store.measurement(NODE, round.id, round.slots[7].id).id, round.slots[7].jobId);
    assert.equal(detailReads, 1);
    assert.equal(store.measurement(NODE, round.id, "not-in-round"), null);
    f.set(f.now() + 8 * DAY); drain(store);
    assert.equal(store.measurement(NODE, round.id, round.slots[7].id), null);
  } finally { fs.readFileSync = originalRead; f.close(); }
});
test("incremental retention survives restart, follows completion time, protects active rounds and skips retained history", () => {
  const f = fixture(), start = f.now(); let store = f.make();
  const originalRead = fs.readFileSync;
  try {
    f.set(start - 91 * DAY);
    const expired = create(store, 3, { plannedAt: new Date(start).toISOString() });
    store.batch(() => { for (let i = 0; i < 3; i++) store.complete(job(expired, i), { kind: "latency", state: "ok" }); });
    const active = create(store);
    f.set(start - 8 * DAY);
    const details = create(store, 3);
    store.batch(() => { for (let i = 0; i < 3; i++) store.complete(job(details, i), { kind: "latency", state: "ok" }); });
    f.set(start - DAY);
    const recent = create(store, 1, { plannedAt: new Date(start - 100 * DAY).toISOString() });
    store.complete(job(recent), { kind: "latency", state: "ok" });
    const receiptRoot = path.join(f.root, "report-v3", "receipts");
    const legacy = crypto.randomUUID();
    fs.writeFileSync(path.join(receiptRoot, legacy + ".json"), JSON.stringify({ executor: "node:" + NODE, nodeUuid: NODE, at: start - DAY }));
    f.set(start);
    let calls = 0, result;
    do {
      result = store.maintenanceStep([NODE], { maxSteps: 1, maxMs: 100 });
      assert.equal(result.steps <= 1, true); assert.ok(++calls < 2000);
      if (calls % 3 === 0) store = f.make();
    } while (result.pending);
    assert.equal(store.get(NODE, expired.id), null);
    assert.equal(store.get(NODE, active.id, false).completedAt, null);
    assert.equal(store.get(NODE, details.id).detailAvailable, false);
    assert.equal(store.get(NODE, details.id).measurements.length, 0);
    assert.equal(store.get(NODE, recent.id).measurements.length, 1);
    assert.equal(store.receipt(legacy, "node:" + NODE), true);
    assert.equal(fs.existsSync(path.join(receiptRoot, legacy + ".json")), false);
    let historyReads = 0, receiptReads = 0;
    fs.readFileSync = function(file, ...args) {
      if (String(file).includes("/indexes/")) historyReads++;
      if (String(file).includes("/receipts/")) receiptReads++;
      return originalRead(file, ...args);
    };
    f.set(start + 3600001); drain(store);
    assert.equal(historyReads, 0); assert.equal(receiptReads, 0);
  } finally { fs.readFileSync = originalRead; f.close(); }
});
test("expiry schedule cannot be lost between a day-index commit and its metadata commit", () => {
  const f = fixture(), store = f.make(), originalRename = fs.renameSync;
  try {
    const round = create(store); let metadataCommits = 0;
    fs.renameSync = function(from, to) {
      if (String(to).endsWith("/retention.json") && ++metadataCommits === 2) throw new Error("metadata commit interrupted");
      return originalRename(from, to);
    };
    assert.throws(() => store.complete(job(round), { kind: "latency", state: "ok" }), /metadata commit interrupted/);
    fs.renameSync = originalRename;
    const metadata = JSON.parse(fs.readFileSync(path.join(f.root, "report-v3", "nodes", NODE, "retention.json"), "utf8"));
    assert.ok(Object.values(metadata.indexes).includes(0), "earlier expiry was not invalidated before the index write");
    f.set(f.now() + 8 * DAY); const restarted = f.make(); drain(restarted);
    assert.equal(restarted.get(NODE, round.id).detailAvailable, false);
    assert.equal(restarted.get(NODE, round.id).measurements.length, 0);
  } finally { fs.renameSync = originalRename; f.close(); }
});
test("a failed detail-expiry marker is replayed before any incremental file deletion", () => {
  const f = fixture(), originalRename = fs.renameSync;
  try {
    let store = f.make(); const round = create(store);
    store.complete(job(round), { kind: "latency", state: "ok" }); f.set(f.now() + 8 * DAY);
    const journal = path.join(f.root, "report-v3", "maintenance.json");
    let prepared = false;
    for (let i = 0; i < 100 && !prepared; i++) {
      store.maintenanceStep([NODE], { maxSteps: 1, maxMs: 100 });
      prepared = !!JSON.parse(fs.readFileSync(journal, "utf8")).cycle?.work?.deleting;
    }
    assert.equal(prepared, true);
    fs.renameSync = function(from, to) { if (String(to).endsWith("manifest.json")) throw new Error("expiry marker interrupted"); return originalRename(from, to); };
    assert.throws(() => store.maintenanceStep([NODE], { maxSteps: 1, maxMs: 100 }), /expiry marker interrupted/);
    fs.renameSync = originalRename;
    store = f.make(); drain(store);
    assert.equal(store.get(NODE, round.id).detailAvailable, false);
    assert.equal(store.get(NODE, round.id).measurements.length, 0);
    assert.equal(store.list(NODE, "international").rounds[0].detailAvailable, false);
  } finally { fs.renameSync = originalRename; f.close(); }
});

test("interleaved batched results survive dirty-round eviction from the 128-entry read cache", () => {
  const f = fixture(), store = f.make();
  try {
    const rounds = Array.from({ length: 129 }, () => create(store, 3));
    store.batch(() => {
      for (let slot = 0; slot < 3; slot++)
        for (const round of rounds) store.complete(job(round, slot), { kind: "latency", state: "ok" });
    });
    for (const round of rounds) {
      assert.equal(store.get(NODE, round.id, false).counts.completed, 3);
      assert.equal(store.get(NODE, round.id).measurements.length, 3);
    }
    assert.equal(store.pending(NODE).length, 0);
    const restarted = f.make();
    for (const row of restarted.list(NODE, "international", { limit: 50 }).rounds)
      assert.equal(row.counts.completed, 3);
  } finally { f.close(); }
});

test("round cache keeps small interleaved rounds hot and bounds large rounds to 4096 slots", () => {
  const f=fixture(),read=fs.readFileSync,rename=fs.renameSync;
  try {
    const store=f.make(),rounds=Array.from({length:17},()=>create(store,250));
    let manifests=0;
    fs.readFileSync=function(file,...args){if(String(file).endsWith("manifest.json"))manifests++;return read(file,...args);};
    store.get(NODE,rounds[16].id,false);assert.equal(manifests,0);
    store.get(NODE,rounds[0].id,false);assert.equal(manifests,1,"4250 slots exceeded the cache budget without eviction");
    store.get(NODE,rounds[0].id,false);store.get(NODE,rounds[16].id,false);assert.equal(manifests,1);
    const file=path.join(f.root,"report-v3","nodes",NODE,"rounds",rounds[16].id,"manifest.json");
    fs.unlinkSync(file);assert.equal(store.get(NODE,rounds[16].id,false),null);
    create(store,250);store.get(NODE,rounds[2].id,false);
    assert.equal(manifests,1,"removing a cached file did not release its slot budget");
    fs.renameSync=function(from,to){if(String(to).endsWith("manifest.json"))throw new Error("cache invalidation fixture");return rename(from,to);};
    assert.throws(()=>create(store,1),/cache invalidation/);fs.renameSync=rename;
    store.get(NODE,rounds[2].id,false);assert.equal(manifests,2);
    store.get(NODE,rounds[2].id,false);assert.equal(manifests,2,"failed write left a stale cache slot counter");
  }finally{fs.readFileSync=read;fs.renameSync=rename;f.close();}
});

test("an actual persisted queue reference protects a closed manifest until the job is removed", () => {
  const f = fixture(), { nativeQueueState, writeNativeState } = require("../src/native-queue-state.js");
  try {
    const store = f.make(), round = create(store);
    store.complete(job(round), { kind: "latency", state: "ok" }); f.set(f.now() + 8 * DAY);
    const file = path.join(f.root, "native-state.json");
    writeNativeState(file, { jobs: [{ ...job(round), phase: "running", expiresAt: f.now() + 60000 }] });
    const queue = nativeQueueState(file, error => error.code === "ENOENT");
    const options = { maxSteps: 2, maxMs: 100, isRoundActive: (node, id) => queue.read().jobs.some(value => value.nodeUuid === node && value.roundId === id) };
    drain(store, [NODE], options);
    assert.equal(store.get(NODE, round.id).detailAvailable, true);
    assert.equal(store.get(NODE, round.id).measurements.length, 1);
    writeNativeState(file, { jobs: [] }); f.set(f.now() + 3600001);
    drain(store, [NODE], options);
    assert.equal(store.get(NODE, round.id).detailAvailable, false);
  } finally { f.close(); }
});
test("a queue reference appearing after partial deletion survives a cursor restart without hiding the damage", () => {
  const f = fixture(), { nativeQueueState, writeNativeState } = require("../src/native-queue-state.js");
  try {
    let store = f.make(); const round = create(store, 3);
    store.batch(() => { for (let i = 0; i < 3; i++) store.complete(job(round, i), { kind: "latency", state: "ok" }); });
    f.set(f.now() + 8 * DAY);
    const folder = path.join(f.root, "report-v3", "nodes", NODE, "rounds", round.id, "measurements");
    let left = 3;
    for (let i = 0; i < 100 && left === 3; i++) {
      store.maintenanceStep([NODE], { maxSteps: 1, maxMs: 100 });
      left = fs.readdirSync(folder).length;
    }
    assert.equal(left, 2);
    const file = path.join(f.root, "native-state.json");
    writeNativeState(file, { jobs: [{ ...job(round), phase: "running", expiresAt: f.now() + 60000 }] });
    const queue = nativeQueueState(file, error => error.code === "ENOENT");
    const options = { maxSteps: 1, maxMs: 100, isRoundActive: (node, id) => queue.read().jobs.some(value => value.nodeUuid === node && value.roundId === id) };
    store = f.make(); drain(store, [NODE], options);
    assert.equal(fs.readdirSync(folder).length, left, "resumed expiry removed a file still referenced by the queue");
    assert.equal(store.get(NODE, round.id).detailAvailable, false, "partially expired details were incorrectly restored as complete");
    writeNativeState(file, { jobs: [] }); f.set(f.now() + 3600001); drain(store, [NODE], options);
    assert.equal(fs.existsSync(folder), false);
  } finally { f.close(); }
});
function recoveryRound(store, size = 3) {
  const id = crypto.randomUUID();
  const jobs = Array.from({ length: size }, (_, i) => ({ id: crypto.randomUUID(), roundId: id, slotId: "lease:" + i, nodeUuid: NODE, executor: "node:" + NODE, operation: "latency", target: "example.net", options: { reportVersion: 3 }, phase: "queued", expiresAt: 1792843200000 + 3600000 }));
  const round = create(store, size, { id, slots: jobs.map(value => ({ id: value.slotId, jobId: value.id, target: value.target })), _jobs: jobs });
  return { round, jobs };
}
test("partial manifests retain only unfinished recovery jobs and preserve their original active leases", () => {
  const f = fixture();
  try {
    const store = f.make(), { round, jobs } = recoveryRound(store, 4);
    Object.assign(jobs[1], { phase: "running", startedAt: new Date(f.now()).toISOString(), deadlineAt: f.now() + 300000, expiresAt: f.now() + 180000 });
    store.progress(jobs[1]); store.complete(jobs[0], { kind: "latency", state: "ok" });
    const manifest = JSON.parse(fs.readFileSync(path.join(f.root, "report-v3", "nodes", NODE, "rounds", round.id, "manifest.json"), "utf8"));
    assert.deepEqual(manifest._jobs.map(value => value.id), jobs.slice(1).map(value => value.id));
    const restarted = f.make(), pending = restarted.pending(NODE);
    assert.deepEqual(pending.map(value => value.id), jobs.slice(1).map(value => value.id));
    assert.equal(pending[0].phase, "running"); assert.equal(pending[0].startedAt, jobs[1].startedAt);
    assert.equal(pending[0].expiresAt, jobs[1].expiresAt); assert.equal(pending[0].deadlineAt, jobs[1].deadlineAt);
    for (const value of jobs.slice(1)) restarted.complete(value, { kind: "latency", state: "ok" });
    assert.equal(restarted.get(NODE, round.id, false)._jobs, undefined);
    assert.equal(f.make().pending(NODE).length, 0);
  } finally { f.close(); }
});
test("measurement-before-manifest crash recovery prunes terminal jobs without reissuing them", () => {
  const f = fixture(), originalRename = fs.renameSync;
  try {
    const store = f.make(), { round, jobs } = recoveryRound(store);
    fs.renameSync = function(from, to) { if (String(to).endsWith("manifest.json")) throw new Error("manifest interrupted after result"); return originalRename(from, to); };
    assert.throws(() => store.complete(jobs[0], { kind: "latency", state: "ok" }), /manifest interrupted/);
    fs.renameSync = originalRename;
    const restarted = f.make(), pending = restarted.pending(NODE);
    assert.deepEqual(pending.map(value => value.id), jobs.slice(1).map(value => value.id));
    assert.equal(restarted.get(NODE, round.id, false).counts.completed, 1);
    assert.equal(restarted.receipt(jobs[0].id, "node:" + NODE), true);
  } finally { fs.renameSync = originalRename; f.close(); }
});
test("lease progress skips unchanged day summaries, while missing indexes and explicit rebuild still write", () => {
  const f = fixture(), originalWrite = fs.writeFileSync;
  try {
    const store = f.make(), { round, jobs } = recoveryRound(store);
    let indexWrites = 0, manifestWrites = 0;
    fs.writeFileSync = function(file, ...args) {
      if (String(file).includes("/indexes/")) indexWrites++;
      if (String(file).endsWith("manifest.json.tmp")) manifestWrites++;
      return originalWrite(file, ...args);
    };
    jobs[0].phase = "running"; store.progress(jobs[0]);
    jobs[0].expiresAt += 30000; store.progress(jobs[0]);
    assert.equal(indexWrites, 0); assert.equal(manifestWrites, 2);
    store.complete(jobs[0], { kind: "latency", state: "ok" }); assert.equal(indexWrites, 1);
    jobs[1].phase = "running"; store.progress(jobs[1]); assert.equal(indexWrites, 1);
    assert.equal(store.rebuild(NODE), 1); assert.equal(indexWrites, 2, "explicit rebuild must not be suppressed");
    const indexFile = path.join(f.root, "report-v3", "nodes", NODE, "indexes", "international", round.plannedAt.slice(0, 10) + ".json");
    fs.unlinkSync(indexFile); store.progress(jobs[1]);
    assert.equal(indexWrites, 3, "a cached summary concealed the missing disk index");
    assert.equal(store.list(NODE, "international").rounds[0].counts.completed, 1);
  } finally { fs.writeFileSync = originalWrite; f.close(); }
});
test("a failed index rename after the partial manifest commit is repaired during restart recovery", () => {
  const f = fixture(), originalRename = fs.renameSync;
  try {
    const store = f.make(), { round, jobs } = recoveryRound(store);
    jobs[1].phase = "running"; jobs[1].deadlineAt = f.now() + 300000; store.progress(jobs[1]);
    fs.renameSync = function(from, to) { if (String(to).includes("/indexes/")) throw new Error("index commit interrupted"); return originalRename(from, to); };
    assert.throws(() => store.complete(jobs[0], { kind: "latency", state: "ok" }), /index commit interrupted/);
    fs.renameSync = originalRename;
    const restarted = f.make(), pending = restarted.pending(NODE);
    assert.deepEqual(pending.map(value => value.id), jobs.slice(1).map(value => value.id));
    assert.equal(pending[0].phase, "running"); assert.equal(pending[0].deadlineAt, jobs[1].deadlineAt);
    assert.equal(restarted.get(NODE, round.id, false).counts.completed, 1);
    assert.equal(restarted.list(NODE, "international").rounds[0].counts.completed, 1);
  } finally { fs.renameSync = originalRename; f.close(); }
});
test('full TcpQuality history survives retention and remains paginated after years', () => {
  const f=fixture(), store=f.make(), start=f.now();
  try {
    const ids=[];
    for(let i=0;i<52;i++) {
      f.set(start+i*DAY);
      const round=create(store,1,{module:'tcpquality-full'}); ids.push(round.id);
      store.complete({...job(round),operation:'tcpquality-full'},{kind:'tcpquality-full',state:'ok',cleanLog:'报告 '+i,csv:'x,y'});
    }
    f.set(start+3*365*DAY); drain(store);
    store.cleanup(NODE);
    const restarted=f.make(), first=restarted.list(NODE,'tcpquality-full',{limit:50});
    assert.equal(first.rounds.length,50); assert.ok(first.nextCursor);
    const next=restarted.list(NODE,'tcpquality-full',{limit:50,cursor:first.nextCursor});
    assert.equal(next.rounds.length,2); assert.equal(next.nextCursor,null);
    assert.equal(restarted.get(NODE,ids[0]).measurements[0].data.cleanLog,'报告 0');
    assert.equal(restarted.get(NODE,ids[51]).measurements[0].data.cleanLog,'报告 51');
  } finally {f.close();}
});
