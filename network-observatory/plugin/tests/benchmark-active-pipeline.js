// Optional developer benchmark, run by scripts/plugin-runtime/benchmark-active-pipeline.
// Fresh 52-node inventory; 70 real round manifests / 750 successful results.
// Only the claim/result phase is metered. No report I/O method is stubbed.
async function runFullActivePipelineBenchmark() {
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const R = require("./src/report-model.js"), C = require("./src/report-catalog.js");
  const meter = require("aster-benchmark-meter"), handlers = new Map();
  let queueState;
  try { queueState = require("./src/native-queue-state.js"); }
  catch (error) {
    if (__benchmarkShardedQueue__) throw error;
  }
  const token = "e".repeat(64), nodes = Array.from({length:52}, (_, i) => ({
    uuid:"00000000-0000-4000-8000-" + String(i).padStart(12, "0"), name:"Synthetic VPS " + i,
    ipv4:"8.8.8.8", ipv6:"2606:4700:4700::1111", hidden:false,
  }));
  const credentials = {nodes:Object.fromEntries(nodes.map(node => [node.uuid,
    {tokenHash:crypto.createHash("sha256").update(token).digest("hex")},
  ]))};
  let networkAttempts = 0;
  const rejectNetwork = async () => { networkAttempts++; throw new Error("Synthetic benchmark forbids outbound lookups"); };
  const controller = require("./src/native-controller.js").registerNativeController({
    storageDir:__storageDir__, isMissingFile, readState:() => credentials,
    server:{route:(method, url, handler) => handlers.set(method + " " + url, handler), call:async() => nodes},
    authorized:() => true, readBody:req => JSON.parse(req.body || "{}"),
    respond:(response, status, body) => Object.assign(response, {status, body, payload:JSON.stringify(body)}),
    enrichmentOptions:{fetcher:rejectNetwork, fetch:rejectNetwork},
  });
  // Isolate the requested poll/result workload from unrelated startup backfill,
  // scheduled fanout, retention and public-provider polling. Keep complete(),
  // progress(), batch(), receipts, actual stores and projections intact.
  controller.roundController.tick = () => false;
  controller.roundController.publicTick = async () => {};
  await new Promise(resolve => setTimeout(resolve, 30));
  await controller.lock(() => {});
  const rounds = [], planned = [], bodies = new Map(), remaining = new Map();
  await controller.lock(() => {
    const state = controller.read();
    state.inventory = nodes.map(node => ({uuid:node.uuid, name:node.name, publicVisible:true, ip:node.ipv4, ipv6:node.ipv6}));
    state.homeRouteProjectionVersion = 3;
    state.reportSuites = [];
    state.homeRouteNodes = [];
    for (const node of nodes) {
      state.endpoints[node.uuid] = {address:node.ipv4, ipv4:node.ipv4, ipv6:node.ipv6, port:25201};
      state.workers["node:" + node.uuid] = {seenAt:Date.now(), version:"synthetic-fixture", tools:["curl", "mtr", "traceroute"],
        features:["report-v3", "latency-samples", "full-mtr"], authScheme:"unavailable"};
    }
    const routePreset = C.PRESETS.find(value => value.id === "china-routes");
    const route6 = routePreset.endpoints.map(id => id.replace("_ipv4_", "_ipv6_"));
    if (route6.some(id => !C.ENDPOINTS.some(endpoint => endpoint.id === id))) throw new Error("Fixture needs matching three-city, three-carrier IPv6 endpoints");
    for (const config of [
      {start:0, count:40, module:"international", family:"4", preset:"international-basic"},
      {start:0, count:15, module:"routes", family:"4", preset:"china-routes"},
      {start:15, count:15, module:"routes", family:"6", preset:"china-routes", endpoints:route6},
    ]) {
      const clients = nodes.slice(config.start, config.start + config.count).map(node => node.uuid);
      const suite = R.normalizeSuite({clients, modules:[{module:config.module, preset:config.preset,
        family:config.family, endpoints:config.endpoints, publicSources:false}]});
      for (const node of clients) {
        const id = crypto.randomUUID(), plan = R.planSlots(state, suite, suite.modules[0], node, id);
        controller.roundController.store.create({id, nodeUuid:node, module:config.module, suiteId:suite.id,
          parameters:suite.modules[0], catalogVersion:suite.catalogVersion, slots:plan.slots, _jobs:plan.jobs});
        rounds.push({id, node, module:config.module, count:plan.jobs.length, family:config.family});
        planned.push(...plan.jobs);
      }
    }
    state.jobs = planned;
    if (queueState) queueState.writeNativeState(path.join(__storageDir__, "native-state.json"), state, isMissingFile);
    else fs.writeFileSync(path.join(__storageDir__, "native-state.json"), JSON.stringify(state));
  });
  if (planned.length !== 750 || rounds.length !== 70) throw new Error("Incorrect fixture target/round count");
  for (const job of planned) {
    remaining.set(job.nodeUuid, (remaining.get(job.nodeUuid) || 0) + 1);
    let data;
    if (job.operation === "latency") {
      data = {kind:"latency", state:"ok", method:"TCP connect", tcpQuality:{method:"TCP connect", address:"8.8.8.8",
        state:"ok", sent:10, received:10, failurePercent:0, avgMs:24.5, medianMs:24.5, minMs:20, maxMs:29, stdevMs:2.872281,
        samples:Array.from({length:10}, (_, i) => ({index:i + 1, state:"ok", rttMs:20 + i, address:"8.8.8.8", error:""}))}};
    } else {
      const family = job.options.family, target = family === "6" ? "2606:4700:4700::1111" : "8.8.4.4";
      const networks = job.source.carrierId === "telecom" ? ["1054", "4134", "4809", "4134"]
        : job.source.carrierId === "unicom" ? ["1054", "10099", "9929", "4837"] : ["1054", "58807", "58453", "9808"];
      data = {kind:"route", state:"ok", target:job.target, resolvedIp:target, family,
        protocol:"tcp", port:443, method:"mtr", exitCode:0, complete:true, stopReason:"destination_reached",
        diagnostic:"Synthetic successful route; no actual probe or DNS lookup was run",
        hops:Array.from({length:12}, (_, i) => ({ttl:i + 1,
          address:i === 11 ? target : family === "6" ? "2606:4700::" + (i + 1).toString(16) : "1.0.0." + (i + 1),
          asn:networks[Math.floor(i / 3)], asnStatus:"available", asnSource:"synthetic fixture",
          network:"Synthetic observed network", location:"Synthetic location", whois:"Synthetic WHOIS", domain:"fixture.invalid",
          geoSource:"synthetic fixture", rttMs:20 + i, avgMs:20 + i, bestMs:19 + i, worstMs:23 + i,
          sent:20, received:20, lossPercent:0, stdevMs:1}))};
    }
    bodies.set(job.id, JSON.stringify({id:job.id, data}));
  }
  // Warm native cache / queue migration outside the metered phase. Preparation
  // intentionally creates real stores, not replacement report-controller mocks.
  if (controller.read().jobs.length !== 750) throw new Error("Queue preparation did not persist all jobs");
  const original = {write:fs.writeFileSync, read:fs.readFileSync, rename:fs.renameSync, unlink:fs.unlinkSync};
  fs.writeFileSync = function(file, ...args) { const value = original.write(file, ...args); meter.note("write", String(file)); return value; };
  fs.readFileSync = function(file, ...args) { const value = original.read(file, ...args); meter.note("read", String(file)); return value; };
  fs.renameSync = function(from, to, ...args) { const value = original.rename(from, to, ...args); meter.note("rename", String(to)); return value; };
  fs.unlinkSync = function(file, ...args) { const value = original.unlink(file, ...args); meter.note("unlink", String(file)); return value; };
  let done = 0, pollRequests = 0, resultRequests = 0;
  try {
    meter.start();
    while (done < 750) {
      // Interleave real workers instead of keeping a single round artificially
      // warm in the candidate's bounded manifest cache.
      for (const node of nodes) {
        if (!remaining.get(node.uuid)) continue;
        const prefix = "/api/aster-network-observatory/v2/workers/node/" + node.uuid;
        const response = {};
        await handlers.get("GET /api/aster-network-observatory/v2/workers/node/:id/poll")(
          {url:prefix + "/poll", headers:{authorization:"Bearer " + token}}, response);
        pollRequests++;
        if (response.status !== 200 || !response.body.task) throw new Error("Claim failed: " + JSON.stringify(response));
        const task = response.body.task, reply = {}, body = bodies.get(task.id);
        if (!body) throw new Error("Claim returned a task outside the fixture");
        await handlers.get("POST /api/aster-network-observatory/v2/workers/node/:id/result")(
          {url:prefix + "/result", headers:{authorization:"Bearer " + token}, body}, reply);
        resultRequests++;
        if (reply.status !== 200) throw new Error("Result failed: " + JSON.stringify(reply));
        remaining.set(node.uuid, remaining.get(node.uuid) - 1); done++;
      }
    }
    meter.stop();
  } finally {
    fs.writeFileSync = original.write; fs.readFileSync = original.read;
    fs.renameSync = original.rename; fs.unlinkSync = original.unlink;
  }
  // Verify persistence and normal result/projection semantics after timing.
  const persisted = queueState ? queueState.readNativeState(path.join(__storageDir__, "native-state.json"), isMissingFile)
    : JSON.parse(fs.readFileSync(path.join(__storageDir__, "native-state.json"), "utf8"));
  if (persisted.jobs.length) throw new Error("Completed queue was not durable");
  let measurements = 0;
  for (const round of rounds) {
    const saved = controller.roundController.store.get(round.node, round.id, false);
    if (!saved.completedAt || saved.state !== "complete" || saved.counts.ok !== round.count || saved.counts.completed !== round.count)
      throw new Error("Persisted successful round was incomplete");
    measurements += saved.counts.completed;
  }
  for (const job of planned) if (!controller.roundController.receipt(job.id, job.executor)) throw new Error("Missing authenticated result receipt");
  const response = {};
  await handlers.get("GET /api/aster-network-observatory/v3/home-routes")({url:"/api/aster-network-observatory/v3/home-routes"}, response);
  let projectionCells = 0;
  for (const round of rounds.filter(value => value.module === "routes")) {
    const rows = response.body.nodes[round.node]?.[round.family];
    if (!rows || rows.some(row => !row.return || row.return.state !== "ok" || row.return.reportId !== round.id))
      throw new Error("Successful carrier projection did not match its real round");
    projectionCells += rows.length;
  }
  if (networkAttempts || done !== 750 || measurements !== 750 || projectionCells !== 90) throw new Error("Fixture verification failed");
  meter.report(JSON.stringify({workers:52, activeWorkers:40, rounds:70, measurements, successfulClaims:done,
    pollRequests, resultRequests, routeResults:270, latencyResults:480, routeProjectionCells:projectionCells,
    queueLayout:queueState ? "sharded" : "legacy inline", networkAttempts,
    order:"round-robin workers", history:"fresh store; no previous completed rounds",
    exclusions:["fixture preparation", "verification", "unrelated scheduled fanout / retention ticks"],
    reportMethods:"real complete / progress / batch / receipts / manifest / index / home projection"}));
  return true;
}
