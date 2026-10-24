async function runPollingPerformance() {
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const routes = new Map(), token = "e".repeat(64);
  const nodes = Array.from({ length: 50 }, (_, i) => ({
    uuid: "00000000-0000-4000-8000-" + String(i).padStart(12, "0"),
    name: "Load test " + i, ipv4: "8.8.8.8", hidden: false,
  }));
  const identities = { nodes: Object.fromEntries(nodes.map(n => [n.uuid, {
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
  }])) };
  let rpcCalls = 0;
  const c = require("./src/native-controller.js").registerNativeController({
    storageDir: __storageDir__, isMissingFile,
    server: {
      route: (m, p, f) => routes.set(m + " " + p, f),
      call: async () => { rpcCalls++; return nodes; },
    },
    readState: () => identities,
    authorized: () => true,
    readBody: req => JSON.parse(req.body || "{}"),
    respond: (res, status, body) => Object.assign(res, { status, body }),
  });
  // Wait for initialization and seed a realistic full pending queue without
  // including suite planning / historical disk setup in the polling benchmark.
  await new Promise(resolve => setTimeout(resolve, 30));
  await c.lock(() => {
    const s = c.read();
    s.jobs = Array.from({ length: 7500 }, (_, i) => ({
      id: crypto.randomUUID(), roundId: crypto.randomUUID(),
      nodeUuid: nodes[i % nodes.length].uuid,
      executor: "node:" + nodes[i % nodes.length].uuid,
      operation: "latency", phase: "shared", target: "latency.example.net",
      options: { reportVersion: 3, samples: 10, port: 443 },
      source: { provider: "native", family: "4" },
      expiresAt: Date.now() + 3600000,
    }));
    fs.writeFileSync(path.join(__storageDir__, "native-state.json"), JSON.stringify(s));
  });
  const originalRead = fs.readFileSync, originalWrite = fs.writeFileSync;
  let reads = 0, writes = 0;
  fs.readFileSync = function(file, ...args) {
    if (String(file).endsWith("native-state.json")) reads++;
    return originalRead(file, ...args);
  };
  fs.writeFileSync = function(file, ...args) {
    if (String(file).endsWith("native-state.json.tmp")) writes++;
    return originalWrite(file, ...args);
  };
  const started = Date.now();
  try {
    for (let i = 0; i < 100; i++) {
      const id = nodes[i % nodes.length].uuid, res = {};
      const action = i % 5 === 0 ? "heartbeat" : "poll";
      const method = action === "poll" ? "GET" : "POST";
      await routes.get(method + " /api/aster-network-observatory/v2/workers/node/:id/" + action)({
        url: "/api/aster-network-observatory/v2/workers/node/" + id + "/" + action,
        headers: { authorization: "Bearer " + token },
        body: JSON.stringify({ version: "load-test", tools: ["curl"], features: ["report-v3", "latency-samples"] }),
      }, res);
      if (res.status !== 200 || res.body.task) throw new Error("Unexpected load-test response");
    }
  } finally {
    fs.readFileSync = originalRead; fs.writeFileSync = originalWrite;
  }
  const elapsed = Date.now() - started;
  console.log("Official Komari polling: 50 workers / 7500 queued targets / 100 requests:",
    elapsed, "ms; state reads:", reads, "writes:", writes, "RPC calls:", rpcCalls);
  if (reads > 1 || writes > 1) throw new Error("Idle polling serialized the whole pending queue");
  if (elapsed > 2000) throw new Error("Official runtime polling exceeded its 2s performance budget");
  // Both management catalogs are mounted together; refreshing them must not
  // cause another inventory RPC / complete scheduler run within the minute.
  for (let i = 0; i < 10; i++) for (const version of [2, 3]) {
    const res = {};
    await routes.get("GET /api/aster-network-observatory/v" + version + "/catalog")({}, res);
    if (res.status !== 200) throw new Error("Catalog failed");
  }
  await c.lock(() => {});
  if (rpcCalls !== 1) throw new Error("Catalog refresh triggered redundant scheduler RPCs");
  return true;
}
