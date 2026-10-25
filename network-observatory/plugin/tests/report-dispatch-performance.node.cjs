const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { registerReportController, BASE } = require("../src/report-controller.js");
const { normalizeSuite } = require("../src/report-model.js");
const { ENDPOINTS } = require("../src/report-catalog.js");

function fixture({ root, previous, online = false } = {}) {
  root ||= fs.mkdtempSync(path.join(os.tmpdir(), "aster-dispatch-performance-"));
  const nodes = Array.from({ length: 52 }, (_, i) => ({ uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: "VPS " + i, publicVisible: true }));
  const suite = (clients, module, family = "4") => normalizeSuite({ clients, modules: [{ module, family, publicSources: false, timing: { type: "interval", minutes: 60 },
    endpoints: module === "routes" ? ENDPOINTS.filter(e => e.category === "china-route" && e.family === family && /电信 163|联通 169|移动 CMNET/.test(e.name)).map(e => e.id).slice(0, 9) : ["aws:ap-east-1"] }] });
  const s = previous || { revision: 0, homeRouteProjectionVersion: 3, inventory: nodes, jobs: [], probes: {}, workers: {},
    endpoints: Object.fromEntries(nodes.map(n => [n.uuid, { ipv4: "8.8.8.8", ipv6: "2606:4700:4700::1111", address: "8.8.8.8", port: 25201 }])),
    provider: { used: 0, probes: [] }, reportSuites: [suite(nodes.slice(0, 40).map(n => n.uuid), "international"), suite(nodes.slice(0, 15).map(n => n.uuid), "routes"), suite(nodes.slice(0, 15).map(n => n.uuid), "routes", "6")] };
  if (online) for (const node of nodes) s.workers["node:" + node.uuid] = { seenAt: Date.now(), tools: ["mtr", "curl"], features: ["latency-samples", "full-mtr", "report-v3"] };
  const routes = new Map(); let writes = 0;
  const native = { read: () => s, lock: fn => Promise.resolve().then(fn), save: () => { writes++; }, coverage: () => "", catalogTick: () => {}, finish: () => {} };
  const c = registerReportController({ storageDir: root, isMissingFile: e => e.code === "ENOENT", server: { route: (m, p, f) => routes.set(m + " " + p, f) },
    authorized: () => true, readBody: req => req.body, respond: (res, status, body) => Object.assign(res, { status, body }) }, native);
  const due = () => { for (const p of s.reportSuites) for (const m of p.modules) m.nextAt = Date.now() - 1000; };
  return { root, s, c, nodes, due, writes: () => writes, close: () => fs.rmSync(root, { recursive: true, force: true }),
    invoke: async (method, suffix, body) => { const res = {}; await routes.get(method + " " + BASE + suffix)({url: BASE + suffix.replace(":id", s.reportSuites[0].id), body}, res); return res; } };
}

test("52-node hourly scheduler only records durable fanout; each dispatch slice respects its node budget", () => {
  const f = fixture(), read = fs.readFileSync, write = fs.writeFileSync;
  try {
    f.c.tick(f.s); // startup repair is independent of the scheduled workload.
    let manifests = 0, projections = 0;
    fs.readFileSync = function(file, ...args) {
      if (/\/(indexes|receipts)\//.test(String(file))) throw new Error("Hourly scheduler scanned historical JSON");
      return read(file, ...args);
    };
    fs.writeFileSync = function(file, ...args) {
      if (String(file).endsWith("manifest.json.tmp")) manifests++;
      return write(file, ...args);
    };
    f.due(); assert.equal(f.c.tick(f.s), true);
    assert.equal(manifests, 0); assert.equal(f.s.jobs.length, 0);
    assert.deepEqual(f.s.reportDispatch.map(w => w.nodes.length), [40, 15, 15]);
    fs.readFileSync = read;
    fs.writeFileSync = function(file, ...args) {
      if (String(file).endsWith("manifest.json.tmp")) manifests++;
      if (String(file).includes("/home-routes/")) projections++;
      return write(file, ...args);
    };
    let slices = 0;
    while (f.s.reportDispatch.length) {
      const before = manifests;
      assert.equal(f.c.dispatchStep(f.s, { maxSteps: 1, maxMs: 1000 }), true);
      assert.ok(manifests - before <= 2, "One node repeated its manifest commit per missing slot");
      assert.ok(++slices <= 73);
    }
    assert.equal(slices, 70); assert.equal(manifests, 140);
    assert.equal(projections, 30, "Each route round should flush its public projection once");
    assert.equal(f.c.tick(f.s), false);
    for (const [module, count] of [["international", 40], ["routes", 30]]) {
      let total = 0;
      for (const node of f.nodes) total += f.c.store.list(node.uuid, module, {limit:50}).rounds.length;
      assert.equal(total, count);
    }
  } finally { fs.readFileSync = read; fs.writeFileSync = write; f.close(); }
});

test("a dispatch cursor replay after a crash reuses its terminal round and never repeats traffic", () => {
  const f = fixture();
  try {
    f.due(); f.c.tick(f.s);
    const beforeCursorCommit = JSON.parse(JSON.stringify(f.s));
    f.c.dispatchStep(f.s, {maxSteps:1,maxMs:1000});
    const id = f.c.store.list(f.nodes[0].uuid, "international").rounds[0].id;
    const restarted = fixture({root:f.root,previous:beforeCursorCommit});
    restarted.c.tick(restarted.s);
    restarted.c.dispatchStep(restarted.s, {maxSteps:1,maxMs:1000});
    assert.deepEqual(restarted.c.store.list(f.nodes[0].uuid,"international").rounds.map(r=>r.id),[id]);
    assert.equal(restarted.s.reportDispatch.find(w=>w.module==="international").cursor,1);
    assert.equal(restarted.s.jobs.length,0);
  } finally { f.close(); }
});

test("an expired prior round or full queue defers a scheduled member instead of losing it", () => {
  const f = fixture({online:true});
  try {
    f.due(); f.c.tick(f.s);
    const work = f.s.reportDispatch[0], plannedAt = work.plannedAt;
    f.s.jobs.push({id:crypto.randomUUID(),nodeUuid:f.nodes[0].uuid,roundId:crypto.randomUUID(),policyId:work.suiteId,reportModule:work.module,expiresAt:Date.now()-1});
    assert.equal(f.c.dispatchStep(f.s,{maxSteps:1,maxMs:1000}),false);
    assert.equal(work.cursor,0); assert.equal(work.plannedAt,plannedAt);
    f.s.reportDispatch=[work];
    f.s.jobs=Array.from({length:10000},()=>({id:crypto.randomUUID(),nodeUuid:f.nodes[51].uuid,roundId:crypto.randomUUID(),policyId:"other",reportModule:"international"}));
    assert.equal(f.c.dispatchStep(f.s,{maxSteps:1,maxMs:1000}),false);
    assert.equal(work.cursor,0);
    f.s.jobs=[];
    assert.equal(f.c.dispatchStep(f.s,{maxSteps:1,maxMs:1000}),true);
    assert.equal(work.cursor,1); assert.equal(f.s.jobs.length,1);
  } finally { f.close(); }
});

test("manual execution consumes the same queued scheduled round; deleting the plan cancels remaining fanout", async () => {
  const f = fixture();
  try {
    f.due(); f.c.tick(f.s);
    const suiteId = f.s.reportSuites[0].id;
    const response = await f.invoke("POST","/suites/:id/run",{nodeUuids:[f.nodes[0].uuid]});
    assert.equal(response.status,202);
    const [id] = response.body.rounds;
    f.c.dispatchStep(f.s,{maxSteps:1,maxMs:1000});
    assert.deepEqual(f.c.store.list(f.nodes[0].uuid,"international").rounds.map(r=>r.id),[id]);
    const deleted = await f.invoke("DELETE","/suites/:id",{});
    assert.equal(deleted.status,200);
    assert.ok(f.s.reportDispatch.every(w=>w.suiteId!==suiteId));
  } finally { f.close(); }
});

for (const leaderFinished of [true, false]) test(`cursor replay ${leaderFinished ? "reuses the finished shared leader" : "detaches an orphan shared follower"}`, () => {
  const f=fixture({online:true});
  try {
    const first=f.s.reportSuites[0],node=f.nodes[0].uuid,at=Date.now(),leaderRound=f.c.enqueue(f.s,first,first.modules[0],node,crypto.randomUUID(),at);
    const leader=f.s.jobs[0];assert.equal(leader.roundId,leaderRound);
    const second={...JSON.parse(JSON.stringify(first)),id:crypto.randomUUID(),clients:[node]};f.s.reportSuites.push(second);
    const work={suiteId:second.id,module:"international",batchId:crypto.randomUUID(),plannedAt:at,nodes:[node],cursor:0};
    const retry=JSON.parse(JSON.stringify(work));f.s.reportDispatch=[work];
    f.c.dispatchStep(f.s,{maxSteps:1,maxMs:1000});
    const follower=f.s.jobs.find(job=>job.policyId===second.id);
    assert.equal(follower.sharedJobId,leader.id);
    // Follower manifest survived a queue/cursor checkpoint failure. The
    // original owner can finish before the durable dispatch cursor is replayed.
    f.s.jobs=[leader];
    if(leaderFinished)f.c.complete(leader,{kind:"latency",state:"ok",method:"fixture"});
    f.s.jobs=[];f.s.reportDispatch=[retry];
    f.c.dispatchStep(f.s,{maxSteps:1,maxMs:1000});
    if(leaderFinished){
      assert.equal(f.s.jobs.length,0);
      assert.equal(f.c.store.get(node,follower.roundId,false).counts.completed,1);
      assert.equal(f.c.store.measurement(node,follower.roundId,follower.slotId).data.sharedMeasurementId,leader.id);
    }else{
      assert.equal(f.s.jobs.length,1);assert.equal(f.s.jobs[0].id,follower.id);
      assert.equal(f.s.jobs[0].phase,"queued");assert.equal(f.s.jobs[0].sharedJobId,undefined);
      assert.equal(f.c.store.get(node,follower.roundId,false)._jobs[0].phase,"queued");
    }
  }finally{f.close();}
});
