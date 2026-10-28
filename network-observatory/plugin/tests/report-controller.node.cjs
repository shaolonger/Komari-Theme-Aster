const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { registerNativeController } = require("../src/native-controller.js");
const { readNativeState, writeNativeState } = require("../src/native-queue-state.js");
const G = require("../src/globalping.js");
const A = "c388e74d-a922-4ae1-bd10-1fb30e2e53de",
  B = "59d6e276-1d4b-4657-9021-908460853ba3",
  token = "a".repeat(64);
async function fixture(existingRoot, clients = [A]) {
  const root =
      existingRoot ||
      fs.mkdtempSync(path.join(os.tmpdir(), "aster-report-api-")),
    routes = new Map();
  const c = registerNativeController({
    server: {
      route: (m, p, f) => routes.set(m + " " + p, f),
      call: async () => clients.map(uuid => ({ uuid, name: "VPS", ipv4: "8.8.8.8" })),
    },
    storageDir: root,
    isMissingFile: (e) => e.code === "ENOENT",
    respond: (res, status, body) => Object.assign(res, { status, body }),
    authorized: (req, res) => {
      if (req.admin) return true;
      res.status = 403;
      return false;
    },
    readBody: (r) => JSON.parse(r.body),
    readState: () => ({
      tasks: [],
      nodes: {
        [A]: {
          tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        },
        [B]: {
          tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        },
      },
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  async function invoke(method, url, body = {}, admin = true, worker = false) {
    const key = [...routes.keys()].find((k) => {
      const [m, p] = k.split(" ");
      return (
        m === method &&
        new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+") + "$").test(
          url.split("?", 1)[0],
        )
      );
    });
    assert.ok(key, url);
    const res = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(value) {
        this.output = value;
      },
    };
    await routes.get(key)(
      {
        url,
        body: JSON.stringify(body),
        admin,
        headers: {
          authorization: worker
            ? "Bearer " + (typeof worker === "string" ? worker : token)
            : "",
        },
      },
      res,
    );
    return res;
  }
  return {
    c,
    root,
    invoke,
    routes,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
const v3 = "/api/aster-network-observatory/v3",
  v2 = "/api/aster-network-observatory/v2";
const draft = () => ({
  clients: [A],
  revision: 0,
  modules: [{ module: "international", endpoints: ["aws:ap-east-1"] }],
});
test("card presentation preferences survive native controller restart and remain independent", async () => {
  const first = await fixture();
  try {
    assert.equal((await first.invoke("PUT", v3 + "/home-routes", {revision:0,nodeUuids:[],labelMode:"full",showDetails:true})).status,200);
    assert.equal((await first.invoke("PUT", v3 + "/home-speeds", {revision:1,nodeUuids:[],showDetails:true})).status,200);
    const restarted = await fixture(first.root);
    const catalog = (await restarted.invoke("GET", v3 + "/catalog")).body;
    assert.equal(catalog.homeRouteLabelMode,"full");
    assert.equal(catalog.homeRouteShowDetails,true);
    assert.equal(catalog.homeSpeedShowDetails,true);
    assert.equal((await restarted.invoke("PUT", v3 + "/home-speeds", {revision:2,nodeUuids:[],showDetails:false})).status,200);
    const routes = (await restarted.invoke("GET", v3 + "/public/routes",{},false)).body;
    const speeds = (await restarted.invoke("GET", v3 + "/public/speeds",{},false)).body;
    assert.equal(routes.labelMode,"full"); assert.equal(routes.showDetails,true); assert.equal(speeds.showDetails,false);
  } finally { first.close(); }
});
const result = () => ({
  kind: "latency",
  state: "ok",
  method: "TCP connect",
  tcpQuality: {
    method: "TCP connect",
    address: "1.1.1.1",
    state: "ok",
    sent: 10,
    received: 10,
    failurePercent: 0,
    avgMs: 2,
    medianMs: 2,
    minMs: 2,
    maxMs: 2,
    stdevMs: 0,
    samples: Array.from({ length: 10 }, (_, i) => ({
      index: i + 1,
      state: "ok",
      rttMs: 2,
      address: "1.1.1.1",
      error: "",
    })),
  },
});
test("card checks enforce admin scope, reuse active rounds and report real queue/running/completion counts", async () => {
 const f=await fixture(undefined,[A,B]);
 try {
  const hello={version:'1.12.0',tools:['mtr'],features:['report-v3','full-mtr']};
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,hello,false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A,B],modules:[{module:'routes',family:'4',protocols:['tcp'],publicSources:false,endpoints:['route:pek_ipv4_4134']},{module:'international',endpoints:['aws:ap-east-1']}]});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal((await f.invoke('POST',`${v3}/nodes/${A}/card-check`,{module:'routes',family:'4'},false)).status,403);
  assert.equal((await f.invoke('POST',v3+'/card-checks/progress',{checks:[]},false)).status,403);
  assert.equal(f.c.read().jobs.length,0);
  const clicks=await Promise.all([1,2].map(()=>f.invoke('POST',`${v3}/nodes/${A}/card-check`,{module:'routes',family:'4'})));
  assert.equal(clicks[0].status,202,JSON.stringify(clicks[0].body));
  assert.equal(clicks[0].body.id,clicks[1].body.id);
  assert.deepEqual(clicks[0].body.counts,{expected:1,completed:0,ok:0,partial:0,missing:0,failed:0,cancelled:0});
  assert.ok(f.c.read().jobs.every(j=>j.nodeUuid===A&&j.reportModule==='routes'&&j.options.family==='4'));
  assert.equal(f.c.read().jobs.length,1);
  const ref={nodeUuid:A,id:clicks[0].body.id};
  const status=async()=> (await f.invoke('POST',v3+'/card-checks/progress',{checks:[ref]})).body.checks[0];
  assert.equal((await status()).phase,'queued');
  const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  assert.equal((await status()).phase,'running');
  const originalRead=fs.readFileSync;let jsonReads=0;
  fs.readFileSync=function(file,...args){if(String(file).startsWith(f.root)&&String(file).endsWith('.json'))jsonReads++;return originalRead.call(this,file,...args);};
  try {for(let i=0;i<20;i++) await status();}finally{fs.readFileSync=originalRead;}
  assert.equal(jsonReads,0,'unchanged progress repeatedly parsed report or queue JSON');
  await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{kind:'route',state:'ok',complete:true,hops:[{ttl:1,address:'8.8.8.8',asn:'4134',rttMs:10}]}},false,true);
  const final=await status();
  assert.equal(final.phase,'finished');assert.equal(final.counts.completed,1);assert.equal(final.counts.ok,1);
  assert.equal((await f.invoke('POST',`${v3}/nodes/${A}/card-check`,{module:'routes',family:'6'})).status,400);
  assert.equal((await f.invoke('POST',`${v3}/nodes/${A}/card-check`,{module:'international',family:'4'})).status,400);
  assert.equal((await f.invoke('POST',v3+'/card-checks/progress',{checks:Array(65).fill(ref)})).status,400);
  const missing=await f.invoke('POST',v3+'/card-checks/progress',{checks:[{nodeUuid:A,id:crypto.randomUUID()}]});
  assert.equal(missing.body.checks[0].phase,'unavailable');
 }finally{f.close();}
});

test("speed card progress excludes unconfigured grid cells and exposes configured address families only to admins", async () => {
 const f=await fixture();
 try {
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.12.0',tools:[],features:['report-v3','public-speed']},false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],trafficAccepted:true,modules:[{module:'china-speed',preset:'china-public',family:'6',endpoints:['taier:上海:电信']}]});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  const summary=await f.invoke('GET',v3+'/home-speeds?families=1');
  assert.equal(summary.body.quickCheck,true);assert.deepEqual(summary.body.quickFamilies[A],['6']);
  const publicView=await f.invoke('GET',v3+'/public/speeds?families=1',{},false);
  assert.equal(publicView.body.quickFamilies,undefined);assert.equal(publicView.body.quickCheck,undefined);
  const started=await f.invoke('POST',`${v3}/nodes/${A}/card-check`,{module:'china-speed',family:'6'});
  assert.equal(started.status,202,JSON.stringify(started.body));
  assert.equal(started.body.counts.expected,1);assert.equal(started.body.counts.completed,0);
  const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{kind:'speed',state:'failed',missingCoverage:true,runs:[],diagnostic:'无严格覆盖'}},false,true);
  const status=(await f.invoke('POST',v3+'/card-checks/progress',{checks:[{nodeUuid:A,id:started.body.id}]})).body.checks[0];
  assert.equal(status.phase,'finished');assert.equal(status.counts.missing,1);assert.equal(status.counts.ok,0);
 }finally{f.close();}
});
test("capabilities and catalog are admin-only; old workers finish with explicit missing coverage", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.invoke("GET", v3 + "/capabilities", {}, false)).status,
      403,
    );
    assert.equal((await f.invoke("GET", v3 + "/performance", {}, false)).status,403);
    const performance=(await f.invoke("GET",v3+"/performance")).body;
    assert.equal(performance.queuedJobs,0);assert.equal(performance.limits.gapMs,500);
    const saved = await f.invoke("POST", v3 + "/suites", draft());
    assert.equal(saved.status, 200);
    const run = await f.invoke(
      "POST",
      `${v3}/suites/${saved.body.suite.id}/run`,
    );
    assert.equal(run.status, 202);
    assert.equal(f.c.read().jobs.length, 0);
    const history = await f.invoke(
      "GET",
      `${v3}/nodes/${A}/rounds?module=international`,
    );
    assert.equal(history.body.rounds.length, 1);
    assert.equal(history.body.rounds[0].state, "missing");
    const round = await f.invoke(
      "GET",
      `${v3}/nodes/${A}/rounds/${run.body.rounds[0]}`,
    );
    assert.equal(round.body.measurements[0].data.state, "missing");
    assert.match(round.body.measurements[0].data.diagnostic, /升级/);
    assert.equal(round.body._jobs, undefined);
  } finally {
    f.close();
  }
});
test("capable worker completes a single round, malformed samples fail, replays ack, and cancellation closes it", async () => {
  const f = await fixture();
  try {
    await f.invoke(
      "POST",
      `${v2}/workers/node/${A}/heartbeat`,
      {
        version: "new",
        tools: ["curl"],
        features: ["report-v3", "latency-samples"],
      },
      false,
      true,
    );
    const saved = await f.invoke("POST", v3 + "/suites", draft());
    const url = `${v3}/suites/${saved.body.suite.id}/run`;
    const run = await f.invoke("POST", url);
    assert.equal((await f.invoke("POST", url)).body.rounds.length, 0);
    const poll = await f.invoke(
      "GET",
      `${v2}/workers/node/${A}/poll`,
      {},
      false,
      true,
    );
    assert.equal(poll.body.task.operation, "latency");
    const id = poll.body.task.id;
    const invalid = result();
    invalid.tcpQuality.samples[0].rttMs = -1;
    assert.equal(
      (
        await f.invoke(
          "POST",
          `${v2}/workers/node/${A}/result`,
          { id, data: invalid },
          false,
          true,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.invoke(
          "POST",
          `${v2}/workers/node/${A}/result`,
          { id, data: result() },
          false,
          true,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.invoke(
          "POST",
          `${v2}/workers/node/${A}/result`,
          { id, data: result() },
          false,
          true,
        )
      ).body.replay,
      true,
    );
    assert.equal(
      (
        await f.invoke(
          "POST",
          `${v2}/workers/node/${B}/result`,
          { id, data: result() },
          false,
          true,
        )
      ).status,
      409,
    );
    const report = await f.invoke(
      "GET",
      `${v3}/nodes/${A}/rounds/${run.body.rounds[0]}`,
    );
    assert.equal(report.body.state, "complete");
    assert.equal(
      report.body.measurements[0].data.tcpQuality.samples.length,
      10,
    );
    assert.equal(report.body.measurements.length, 1);
    const second = await f.invoke("POST", url);
    await f.invoke(
      "POST",
      `${v3}/nodes/${A}/rounds/${second.body.rounds[0]}/cancel`,
    );
    assert.equal(f.c.read().jobs.length, 0);
    assert.equal(
      (
        await f.invoke(
          "GET",
          `${v3}/nodes/${A}/rounds/${second.body.rounds[0]}`,
        )
      ).body.state,
      "cancelled",
    );
    assert.equal(
      (await f.invoke("GET", `${v3}/nodes/${B}/rounds/${run.body.rounds[0]}`))
        .status,
      404,
    );
  } finally {
    f.close();
  }
});
test("Globalping MTR uses official packet maximum, numeric IP version and raw hop statistics", async () => {
  const original = global.fetch,
    bodies = [];
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, text: async () => '{"id":"mtr"}' };
  };
  const job = {
    target: "example.net",
    source: { asn: 4134 },
    options: { fullMtr: true, packets: 20, family: "6", protocol: "tcp" },
  };
  try {
    await G.create(job);
    assert.equal(bodies[0].type, "mtr");
    assert.equal(bodies[0].measurementOptions.packets, 16);
    assert.equal(bodies[0].measurementOptions.ipVersion, 6);
    const row = G.normalize(job, {
      results: [
        {
          probe: { country: "CN", asn: 4134 },
          result: {
            status: "finished",
            resolvedAddress: "1.1.1.1",
            hops: [
              {
                resolvedAddress: "202.97.1.1",
                asn: [4134],
                timings: [{ rtt: 20 }, { rtt: 30 }],
                stats: {
                  total: 16,
                  rcv: 16,
                  loss: 0,
                  avg: 25,
                  min: 20,
                  max: 30,
                  stDev: 5,
                },
              },
              {
                resolvedAddress: "",
                timings: [],
                stats: {
                  total: 16,
                  rcv: 0,
                  loss: 100,
                  avg: 0,
                  min: 0,
                  max: 0,
                  stDev: 0,
                },
              },
            ],
          },
        },
      ],
    })[0];
    assert.equal(row.data.method, "Globalping MTR");
    assert.equal(row.data.hops[0].asn, "4134");
    assert.equal(row.data.hops[0].lastMs, 30);
    assert.equal(row.data.hops[1].avgMs, null);
  } finally {
    global.fetch = original;
  }
});
test("central resources redact tokens and shared JSON is revocable", async () => {
  const f = await fixture();
  try {
    const resource = await f.invoke("POST", v3 + "/resources", {
      revision: 0,
      name: "Tokyo receiver",
      city: "东京",
      address: "speed.example.net",
      family: "4",
      method: "http",
      uses: ["speed"],
      sourceUrl: "https://example.net/permission",
      conditions: "user owned",
      authorized: true,
      token: "s".repeat(32),
    });
    assert.equal(resource.status, 200);
    assert.equal(
      JSON.stringify((await f.invoke("GET", v3 + "/catalog")).body).includes(
        "s".repeat(32),
      ),
      false,
    );
    assert.equal(
      JSON.stringify((await f.invoke("GET", v2 + "/catalog")).body).includes(
        "s".repeat(32),
      ),
      false,
    );
    const saved = await f.invoke("POST", v3 + "/suites", {
      ...draft(),
      revision: 1,
    });
    const run = await f.invoke(
      "POST",
      `${v3}/suites/${saved.body.suite.id}/run`,
    );
    const share = await f.invoke(
      "POST",
      `${v3}/nodes/${A}/rounds/${run.body.rounds[0]}/share`,
    );
    assert.equal(share.status, 200, JSON.stringify(share.body));
    // JSON response fixture does not need HTML response headers.
    await f.c.tick();
    // Use registered handler with req.admin=false to prove possession-only scope.
    const shared = await f.invoke(
      "GET",
      share.body.url + "?format=json",
      {},
      false,
    );
    assert.equal(shared.status, 200);
    assert.equal(shared.body.nodeUuid, A);
    assert.equal(shared.body._jobs, undefined);
    await f.invoke(
      "DELETE",
      `${v3}/nodes/${A}/rounds/${run.body.rounds[0]}/shares`,
    );
    assert.equal(
      (await f.invoke("GET", share.body.url + "?format=json", {}, false))
        .status,
      404,
    );
  } finally {
    f.close();
  }
});
test("overlapping equal measurements share work across suites, while distinct targets remain queued", async () => {
  const f = await fixture();
  try {
    await f.invoke(
      "POST",
      `${v2}/workers/node/${A}/heartbeat`,
      {
        version: "v3",
        tools: ["curl"],
        features: ["report-v3", "latency-samples"],
      },
      false,
      true,
    );
    const first = await f.invoke("POST", v3 + "/suites", draft());
    const second = await f.invoke("POST", v3 + "/suites", {
      ...draft(),
      revision: 1,
      modules: [
        {
          module: "international",
          endpoints: ["aws:ap-east-1", "aws:ap-northeast-1"],
        },
      ],
    });
    await f.invoke("POST", `${v3}/suites/${first.body.suite.id}/run`);
    await f.invoke("POST", `${v3}/suites/${second.body.suite.id}/run`);
    assert.equal(f.c.read().jobs.length, 3);
    assert.equal(f.c.read().jobs.filter((j) => j.phase === "shared").length, 1);
    const poll = await f.invoke(
      "GET",
      `${v2}/workers/node/${A}/poll`,
      {},
      false,
      true,
    );
    await f.invoke(
      "POST",
      `${v2}/workers/node/${A}/result`,
      { id: poll.body.task.id, data: result() },
      false,
      true,
    );
    const history = await f.invoke(
      "GET",
      `${v3}/nodes/${A}/rounds?module=international`,
    );
    const rounds = await Promise.all(
      history.body.rounds.map((r) =>
        f.invoke("GET", `${v3}/nodes/${A}/rounds/${r.id}`),
      ),
    );
    assert.equal(
      rounds.reduce((n, r) => n + r.body.measurements.length, 0),
      2,
    );
    assert.equal(f.c.read().jobs.length, 1);
    assert.equal(f.c.read().jobs[0].target, "sts.ap-northeast-1.amazonaws.com");
  } finally {
    f.close();
  }
});


test("restart reconstructs shared queues and finishes a result committed before queue save", async () => {
  for (const committed of [false, true]) {
    const f = await fixture();
    try {
      await f.invoke(
        "POST",
        `${v2}/workers/node/${A}/heartbeat`,
        {
          version: "v3",
          tools: ["curl"],
          features: ["report-v3", "latency-samples"],
        },
        false,
        true,
      );
      const a = await f.invoke("POST", v3 + "/suites", draft());
      const b = await f.invoke("POST", v3 + "/suites", {
        ...draft(),
        revision: 1,
      });
      await f.invoke("POST", `${v3}/suites/${a.body.suite.id}/run`);
      await f.invoke("POST", `${v3}/suites/${b.body.suite.id}/run`);
      const state = f.c.read(),
        leader = state.jobs.find((j) => !j.sharedJobId);
      if (committed) f.c.roundController.complete(leader, result());
      state.jobs = [];
      writeNativeState(path.join(f.root, "native-state.json"), state);
      const restarted = await fixture(f.root);
      await restarted.c.tick();
      assert.equal(restarted.c.read().jobs.length, committed ? 0 : 2);
      if (!committed) {
        assert.equal(
          restarted.c.read().jobs.filter((j) => j.phase === "shared").length,
          1,
        );
        const poll = await restarted.invoke(
          "GET",
          `${v2}/workers/node/${A}/poll`,
          {},
          false,
          true,
        );
        assert.equal(poll.body.task.operation, "latency");
        await restarted.invoke(
          "POST",
          `${v2}/workers/node/${A}/result`,
          { id: poll.body.task.id, data: result() },
          false,
          true,
        );
      }
      const history = await restarted.invoke(
        "GET",
        `${v3}/nodes/${A}/rounds?module=international`,
      );
      assert.equal(history.body.rounds.length, 2);
      assert.ok(history.body.rounds.every((r) => r.state === "complete"));
    } finally {
      f.close();
    }
  }
});
test("authenticated HTTP resources cannot send credentials over plaintext", async () => {
  const f = await fixture();
  try {
    const r = await f.invoke("POST", v3 + "/resources", {
      revision: 0,
      name: "owned receiver",
      city: "东京",
      address: "speed.example.net",
      family: "4",
      method: "http",
      uses: ["speed"],
      https: false,
      sourceUrl: "https://example.net/permission",
      conditions: "user owned",
      authorized: true,
      token: "s".repeat(32),
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /HTTPS/);
  } finally {
    f.close();
  }
});

test("controlled throughput listener respects endpoint busy backoff before opening a port", async () => {
  const f = await fixture();
  try {
    const p = await f.invoke("POST", v2 + "/probes", {
      id: B,
      name: "owned",
      city: "北京",
      carrier: "电信",
      accessType: "家庭宽带",
    });
    assert.equal(p.status, 200);
    const hello = {
      version: "v3",
      tools: ["iperf3", "openssl"],
      authScheme: "oaep",
      features: ["report-v3", "speed-intervals"],
    };
    await f.invoke(
      "POST",
      `${v2}/workers/node/${A}/heartbeat`,
      hello,
      false,
      true,
    );
    await f.invoke(
      "POST",
      `${v2}/workers/probe/${B}/heartbeat`,
      hello,
      false,
      p.body.token,
    );
    const suite = await f.invoke("POST", v3 + "/suites", {
      revision: 1,
      clients: [A],
      trafficAccepted: true,
      modules: [{ module: "china-speed", sources: [B] }],
    });
    assert.equal(suite.status, 200, JSON.stringify(suite.body));
    await f.invoke("POST", `${v3}/suites/${suite.body.suite.id}/run`);
    const s = f.c.read();
    assert.equal(s.jobs.length, 1);
    s.jobs[0].availableAt = Date.now() + 60000;
    writeNativeState(path.join(f.root, "native-state.json"), s);
    assert.equal(
      (await f.invoke("GET", `${v2}/workers/node/${A}/poll`, {}, false, true))
        .body.task,
      null,
    );
    s.jobs[0].availableAt = 0;
    writeNativeState(path.join(f.root, "native-state.json"), s);
    assert.equal(
      (await f.invoke("GET", `${v2}/workers/node/${A}/poll`, {}, false, true))
        .body.task.operation,
      "listen",
    );
  } finally {
    f.close();
  }
});

test("recovered active lease accepts durable results without repeating a measurement", async () => {
  const f = await fixture();
  try {
    await f.invoke(
      "POST",
      `${v2}/workers/node/${A}/heartbeat`,
      {
        version: "v3",
        tools: ["curl"],
        features: ["report-v3", "latency-samples"],
      },
      false,
      true,
    );
    const saved = await f.invoke("POST", v3 + "/suites", draft());
    const round = await f.invoke(
      "POST",
      `${v3}/suites/${saved.body.suite.id}/run`,
    );
    const poll = await f.invoke(
      "GET",
      `${v2}/workers/node/${A}/poll`,
      {},
      false,
      true,
    );
    const s = f.c.read();
    s.jobs = [];
    writeNativeState(path.join(f.root, "native-state.json"), s);
    const restarted = await fixture(f.root);
    assert.equal(restarted.c.read().jobs[0].phase, "running");
    assert.equal(
      (
        await restarted.invoke(
          "GET",
          `${v2}/workers/node/${A}/poll`,
          {},
          false,
          true,
        )
      ).body.task,
      null,
    );
    assert.equal(
      (
        await restarted.invoke(
          "POST",
          `${v2}/workers/node/${A}/result`,
          { id: poll.body.task.id, data: result() },
          false,
          true,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await restarted.invoke(
          "GET",
          `${v3}/nodes/${A}/rounds/${round.body.rounds[0]}`,
        )
      ).body.state,
      "complete",
    );
  } finally {
    f.close();
  }
});

test('instance run limits a shared suite to its current VPS and rejects nodes outside the suite',async()=>{
 const f=await fixture();
 try {
  const saved=await f.invoke('POST',v3+'/suites',{...draft(),clients:[A,B]});
  const run=await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`,{nodeUuids:[A]});
  assert.equal(run.status,202);assert.equal(run.body.rounds.length,1);
  assert.equal(f.c.roundController.store.get(A,run.body.rounds[0]).nodeUuid,A);
  assert.equal((await f.invoke('GET',`${v3}/nodes/${B}/rounds?module=international`)).body.rounds.length,0);
  assert.equal((await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`,{nodeUuids:['9f9bc89f-05fd-4b39-8b5b-342edee81d88']})).status,400);
 }finally{f.close();}
});

test("native TCP quality and public speed use the same plans, claims, history and missing coverage semantics", async () => {
 const f=await fixture();
 try {
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.9.0',tools:[],features:['report-v3','tcp-quality','public-speed']},false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],trafficAccepted:true,modules:[{module:'tcp-quality',endpoints:['route:pek_ipv4_4134'],packetSizes:[0,1200]},{module:'china-speed',preset:'china-public',endpoints:['taier:北京:电信'],maxTrafficMiB:64}]});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  const started=await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  assert.equal(started.status,202);
  let claimed=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  assert.equal(claimed.operation,'tcp-quality');
  assert.deepEqual(claimed.options.packetSizes,[0,1200]);
  const quality={...result(),kind:'tcp-quality'};
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:claimed.id,data:quality},false,true)).status,200);
  claimed=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  assert.equal(claimed.operation,'public-speed');
  assert.equal(claimed.options.maxTrafficMiB,64);
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:claimed.id,data:{kind:'speed',state:'failed',missingCoverage:true,runs:[],diagnostic:'严格匹配无覆盖'}},false,true)).status,200);
  const rows=(await f.invoke('GET',`${v3}/nodes/${A}/rounds?module=china-speed`)).body.rounds;
  assert.equal(rows[0].counts.missing,9); // unselected grid cells and directory absence
  assert.equal(rows[0].counts.failed,0);
  const history=(await f.invoke('GET',`${v3}/nodes/${A}/rounds?module=tcp-quality`)).body.rounds;
  assert.equal(history[0].counts.ok,1);
 }finally{f.close();}
});

test("legacy directory timeouts have bounded durable retries and do not block the whole fleet during network backoff", async () => {
 const f=await fixture(), originalNow=Date.now; let now=originalNow(); Date.now=()=>now;
 try {
  const hello={version:'1.10.0',tools:[],features:['report-v3','public-speed']};
  const heartbeat=()=>f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,hello,false,true);
  await heartbeat();
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],trafficAccepted:true,modules:[{module:'china-speed',preset:'china-public',family:'6',endpoints:['taier:上海:电信']}]});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  let finalTask;
  for(let attempt=1;attempt<=3;attempt++) {
   await heartbeat();
   const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
   assert.equal(task.operation,'public-speed'); finalTask=task;
   const response=await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{kind:'speed',state:'failed',runs:[],toolVersion:'aster-public-speed/1',retryable:false,diagnostic:'<urlopen error _ssl.c:975: The handshake operation timed out>'}},false,true);
   assert.equal(response.status,200,JSON.stringify(response.body));
   if(attempt<3) {
    assert.equal(response.body.retrying,true);
    const queued=f.c.read().jobs.find(j=>j.id===task.id);
    assert.equal(queued.busyAttempts,attempt);
    assert.ok(queued.availableAt>=now+attempt*60000 && queued.availableAt<now+attempt*60000+15000);
    assert.ok(f.c.read().publicSpeedBlockedUntil<queued.availableAt);
    assert.equal((await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task,null);
    const disk=readNativeState(path.join(f.root,'native-state.json'));
    assert.equal(disk.jobs.find(j=>j.id===task.id).publicSpeedFailures.length,attempt);
    now=queued.availableAt+1;
   } else assert.equal(response.body.retrying,undefined);
  }
  assert.equal(f.c.read().jobs.length,0);
  const measurement=f.c.roundController.store.measurement(A,finalTask.roundId,finalTask.slotId);
  assert.equal(measurement.data.queueAttempts,3);
  assert.equal(measurement.data.previousFailures.length,2);
 } finally {Date.now=originalNow;f.close();}
});

test("public speed never requeues transferred payload, partial success, certificates or an explicit permanent v2 failure", async () => {
 const failedRun={direction:'target-to-source',streams:1,state:'failed',trafficBytesObserved:16,diagnostic:'server busy'};
 const upload={direction:'source-to-target',streams:1,state:'ok',vpsDirection:'upload',trafficBytesObserved:100,bytes:100,bitsPerSecond:80,seconds:10};
 for(const data of [
  {state:'failed',runs:[failedRun],retryable:true,diagnostic:'server busy'},
  {state:'failed',runs:[],trafficBytesObserved:16,retryable:true,diagnostic:'timed out'},
  {state:'partial',runs:[{...failedRun,trafficBytesObserved:0},upload],retryable:true,diagnostic:'timed out'},
  {state:'failed',runs:[],retryable:false,diagnostic:'CERTIFICATE_VERIFY_FAILED'},
  {state:'failed',runs:[],retryable:false,toolVersion:'aster-public-speed/2',diagnostic:'timed out'},
 ]) {
  const f=await fixture();
  try {
   await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.12.0',tools:[],features:['report-v3','public-speed']},false,true);
   const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],trafficAccepted:true,modules:[{module:'china-speed',preset:'china-public',endpoints:['taier:上海:电信']}]});
   await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
   const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
   const response=await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{kind:'speed',...data}},false,true);
   assert.equal(response.status,200,JSON.stringify(response.body));
   assert.equal(response.body.retrying,undefined);
   assert.equal(f.c.read().jobs.length,0);
   const row=f.c.roundController.store.measurement(A,task.roundId,task.slotId);
   assert.equal(row.data.state,data.state);
   if(data.state==='partial') assert.deepEqual(row.data.runs[1],upload);
  } finally {f.close();}
 }
});

test("simultaneous VPS polls serialize public speed and persist the inter-measurement cooldown across restart", async () => {
 const f=await fixture(undefined,[A,B]), originalNow=Date.now; let now=originalNow(); Date.now=()=>now;
 try {
  for(const id of [A,B]) await f.invoke('POST',`${v2}/workers/node/${id}/heartbeat`,{version:'1.12.0',tools:[],features:['report-v3','public-speed']},false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A,B],trafficAccepted:true,modules:[{module:'china-speed',preset:'china-public',endpoints:['taier:上海:电信']}]});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  const claims=await Promise.all([A,B].map(id=>f.invoke('GET',`${v2}/workers/node/${id}/poll`,{},false,true)));
  assert.equal(claims.filter(r=>r.body.task).length,1);
  const first=claims.findIndex(r=>r.body.task), other=[A,B][1-first];
  await f.invoke('POST',`${v2}/workers/node/${[A,B][first]}/result`,{id:claims[first].body.task.id,data:{kind:'speed',state:'failed',runs:[],diagnostic:'permanent'}},false,true);
  assert.equal((await f.invoke('GET',`${v2}/workers/node/${other}/poll`,{},false,true)).body.task,null);
  const until=f.c.read().publicSpeedBlockedUntil;
  assert.ok(until>=now+4000 && until<now+7000);
  const restarted=await fixture(f.root,[A,B]);
  assert.equal(restarted.c.read().publicSpeedBlockedUntil,until);
  assert.equal((await restarted.invoke('GET',`${v2}/workers/node/${other}/poll`,{},false,true)).body.task,null);
  now=until+1;
  assert.equal((await restarted.invoke('GET',`${v2}/workers/node/${other}/poll`,{},false,true)).body.task.operation,'public-speed');
 } finally {Date.now=originalNow;f.close();}
});

test("malformed public-speed retry accounting is rejected without changing the active job", async () => {
 const f=await fixture();
 try {
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.12.0',tools:[],features:['report-v3','public-speed']},false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],trafficAccepted:true,modules:[{module:'china-speed',preset:'china-public',endpoints:['taier:上海:电信']}]});
  await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  for(const invalid of [{trafficBytesObserved:-1},{runs:[{direction:'target-to-source',streams:1,state:'failed',attempts:{}}]},
    {controlRequests:[{stage:'directory-match',state:'failed',attempt:1,durationMs:-1}]}]) {
   const response=await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{kind:'speed',state:'failed',runs:[],...invalid}},false,true);
   assert.equal(response.status,400);
   assert.equal(f.c.read().jobs.find(j=>j.id===task.id).phase,'running');
  }
 }finally{f.close();}
});

test("heartbeats coalesce, claims and results remain durable, and failed transactions discard cached mutations", async () => {
  const f = await fixture(), originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const disk = () => readNativeState(path.join(f.root, "native-state.json"));
  try {
    const heartbeat = { version: "live-test", tools: ["curl"], features: ["report-v3", "latency-samples"] };
    await f.invoke("POST", `${v2}/workers/node/${A}/heartbeat`, heartbeat, false, true);
    assert.equal(f.c.read().workers["node:" + A].version, "live-test");
    assert.equal(disk().workers["node:" + A], undefined);
    now += 31000;
    await f.invoke("POST", `${v2}/workers/node/${A}/heartbeat`, heartbeat, false, true);
    assert.equal(disk().workers["node:" + A].seenAt, now);
    const saved = await f.invoke("POST", v3 + "/suites", draft());
    await f.invoke("POST", `${v3}/suites/${saved.body.suite.id}/run`);
    const task = (await f.invoke("GET", `${v2}/workers/node/${A}/poll`, {}, false, true)).body.task;
    assert.equal(disk().jobs.find(j => j.id === task.id).phase, "running");
    await f.invoke("POST", `${v2}/workers/node/${A}/result`, { id: task.id, data: result() }, false, true);
    assert.equal(disk().jobs.length, 0);
    await assert.rejects(f.c.lock(() => {
      f.c.read().revision = 999;
      throw new Error("Aborted transaction");
    }));
    assert.equal(f.c.read().revision, disk().revision);
    // Index invalidation must include another newly queued round after results.
    await f.invoke("POST", `${v3}/suites/${saved.body.suite.id}/run`);
    const next = (await f.invoke("GET", `${v2}/workers/node/${A}/poll`, {}, false, true)).body.task;
    assert.ok(next && next.id !== task.id);
  } finally { Date.now = originalNow; f.close(); }
});

test("history summary exposes retained per-target metrics only to admins without reading raw files", async () => {
  const f = await fixture(), { roundStore } = require('../src/round-store.js');
  const store = roundStore(f.root, e => e.code === 'ENOENT');
  const originalRead = fs.readFileSync;
  try {
    const slotId = 'route:shanghai', jobId = crypto.randomUUID();
    const r = store.create({ nodeUuid: A, module: 'routes', suiteId: crypto.randomUUID(), batchId: crypto.randomUUID(), parameters: { family: '4' }, slots: [{ id: slotId, jobId, target: '8.8.8.8', direction: 'VPS→大陆', source: { city: '上海', carrier: '电信', provider: '测试', token: 'SECRET' }, options: { protocol: 'tcp' } }] });
    store.complete({ id: jobId, roundId: r.id, slotId, nodeUuid: A, executor: 'node:' + A, operation: 'route', target: '8.8.8.8', options: { family: '4', protocol: 'tcp' }, source: { city: '上海', carrier: '电信', provider: '测试' } }, { kind: 'route', state: 'ok', hops: [{ asn: '4809' }], routeEvidence: { headlineLabels: ['CN2'] } });
    const dir = path.join(f.root, 'report-v3', 'nodes', A), manifest = path.join(dir, 'rounds', r.id, 'manifest.json'), index = path.join(dir, 'indexes', 'routes', r.plannedAt.slice(0, 10) + '.json');
    const m = JSON.parse(fs.readFileSync(manifest)); m.detailAvailable = false; fs.writeFileSync(manifest, JSON.stringify(m));
    const rows = JSON.parse(fs.readFileSync(index)); rows[0].detailAvailable = false; fs.writeFileSync(index, JSON.stringify(rows));
    let rawReads = 0; fs.readFileSync = function(file, ...args) { if (String(file).includes('/measurements/')) rawReads++; return originalRead(file, ...args); };
    assert.equal((await f.invoke('GET', `${v3}/nodes/${A}/history-summary?module=routes`, {}, false)).status, 403);
    const response = await f.invoke('GET', `${v3}/nodes/${A}/history-summary?module=routes`);
    assert.equal(response.status, 200); assert.equal(rawReads, 0);
    assert.deepEqual(response.body.rounds[0].slots[0].metrics.routeEvidence.headlineLabels, ['CN2']);
    assert.equal(response.body.rounds[0].slots[0].source.city, '上海');
    assert.equal(JSON.stringify(response.body).includes('SECRET'), false);
  } finally { fs.readFileSync = originalRead; f.close(); }
});

test("full TcpQuality is separately scheduled, leased for a long run, retained and replay-safe", async () => {
 const f=await fixture(), originalNow=Date.now; let now=originalNow(); Date.now=()=>now;
 try {
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.13.0',tools:[],features:['report-v3','tcpquality-full']},false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],modules:[{module:'tcpquality-full',profile:'LOWMEM',timeoutMinutes:120,timing:{type:'daily',times:['03:00','18:00'],timezone:'Asia/Shanghai'}}]});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.deepEqual(saved.body.suite.modules[0].timing.times,['03:00','18:00']);
  const started=await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  assert.equal(started.body.rounds.length,1);
  const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  assert.equal(task.operation,'tcpquality-full'); assert.equal(task.options.profile,'LOWMEM'); assert.equal(task.options.timeoutMinutes,120);
  assert.ok(task.deadlineAt-now>=135*60000); assert.equal(task.expiresAt, task.deadlineAt);
  const other=await f.invoke('POST',v3+'/suites',{revision:1,clients:[A],modules:[{module:'tcpquality-full'}]});
  assert.equal(other.status,200);
  const duplicate=await f.invoke('POST',`${v3}/suites/${other.body.suite.id}/run`);
  assert.equal(duplicate.body.rounds.length,0);
  const live=f.c.read(), otherSuite=live.reportSuites.find(p=>p.id===other.body.suite.id);
  const skipped=f.c.roundController.enqueue(live,otherSuite,otherSuite.modules[0],A,crypto.randomUUID(),now,true,crypto.randomUUID());
  assert.ok(skipped); const skippedRound=f.c.roundController.store.get(A,skipped);
  assert.equal(skippedRound.state,'missing'); assert.match(skippedRound.measurements[0].data.diagnostic,/已跳过/);
  now+=20*60000;
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.13.0',tools:[],features:['report-v3','tcpquality-full'],activeJobIds:[task.id]},false,true);
  const restarted=await fixture(f.root);
  const data={kind:'tcpquality-full',state:'ok',profile:'LOWMEM',cleanLog:'结果 '.repeat(40000),csv:'header,value\n',exitCode:0};
  assert.ok(Buffer.byteLength(JSON.stringify({id:task.id,data}))>131072);
  assert.equal((await restarted.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data},false,true)).status,200);
  assert.equal((await restarted.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data},false,true)).body.replay,true);
  const history=(await restarted.invoke('GET',`${v3}/nodes/${A}/rounds?module=tcpquality-full`)).body;
  assert.equal(history.rounds.find(r=>r.id===started.body.rounds[0]).counts.ok,1); assert.deepEqual(history.retention,{detailDays:null,summaryDays:null});
  const savedRound=restarted.c.roundController.store.get(A,started.body.rounds[0]);
  assert.equal(savedRound.measurements[0].data.cleanLog,data.cleanLog);
  const again=await restarted.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  assert.equal(again.body.rounds.length,1);
  const nextTask=(await restarted.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  assert.equal(nextTask.operation,'tcpquality-full');
  assert.equal((await restarted.invoke('POST',`${v3}/nodes/${A}/rounds/${again.body.rounds[0]}/cancel`)).status,200);
  const late=await restarted.invoke('POST',`${v2}/workers/node/${A}/result`,{id:nextTask.id,data},false,true);
  assert.equal(late.status,200); assert.equal(late.body.replay,true); // cancellation receipt never replaces the cancelled measurement
  assert.equal(restarted.c.roundController.store.get(A,again.body.rounds[0]).state,'cancelled');
  const afterCancel=await restarted.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  assert.equal(afterCancel.body.rounds.length,1);
  assert.equal((await restarted.invoke('DELETE',`${v3}/nodes/${A}/rounds/${afterCancel.body.rounds[0]}`)).status,400);
  assert.equal((await restarted.invoke('DELETE',`${v3}/nodes/${A}/rounds/${started.body.rounds[0]}`,{},false)).status,403);
  assert.equal((await restarted.invoke('DELETE',`${v3}/nodes/${A}/rounds/${started.body.rounds[0]}`)).status,200);
  assert.equal(restarted.c.roundController.store.get(A,started.body.rounds[0]),null);
  assert.equal((await restarted.invoke('GET',`${v3}/nodes/${A}/rounds?module=tcpquality-full`)).body.rounds.some(r=>r.id===started.body.rounds[0]),false);
  assert.equal((await restarted.invoke('DELETE',`${v3}/nodes/${A}/rounds/${started.body.rounds[0]}`)).status,404);
  assert.equal((await f.invoke('POST',v3+'/suites',{revision:2,clients:[A],modules:[{module:'tcpquality-full',timeoutMinutes:151}]})).status,400);
 } finally { Date.now=originalNow; f.close(); }
});

test('full TcpQuality interval options accept two to eight hours without changing other modules', () => {
 const timing = require('../src/native-model.js').timing;
 for (const minutes of [60, 120, 180, 240, 360, 480, 720, 1440])
  assert.deepEqual(timing({type:'interval', minutes}, 'tcpquality-full'), {type:'interval', minutes});
 assert.throws(() => timing({type:'interval', minutes:120}, 'websites'));
 assert.throws(() => timing({type:'interval', minutes:30}, 'tcpquality-full'));
});

test('a queued full test closes as missing if the worker loses helper capability before claiming it', async () => {
 const f = await fixture();
 try {
  await f.invoke('POST', `${v2}/workers/node/${A}/heartbeat`, {version:'1.13.0',features:['report-v3','tcpquality-full'],tools:[]}, false, true);
  const saved = await f.invoke('POST', `${v3}/suites`, {revision:0,clients:[A],modules:[{module:'tcpquality-full'}]});
  assert.equal(saved.status, 200);
  const started = await f.invoke('POST', `${v3}/suites/${saved.body.suite.id}/run`);
  assert.equal(started.body.rounds.length, 1);
  await f.invoke('POST', `${v2}/workers/node/${A}/heartbeat`, {version:'1.13.0',features:['report-v3'],tools:[]}, false, true);
  const polled = await f.invoke('GET', `${v2}/workers/node/${A}/poll`, {}, false, true);
  assert.equal(polled.body.task, null);
  const round = f.c.roundController.store.get(A, started.body.rounds[0]);
  assert.equal(round.state, 'missing');
  assert.match(round.measurements[0].data.diagnostic, /执行器未就绪/);
  assert.equal(f.c.read().jobs.some(job => job.roundId === round.id), false);
 } finally { f.close(); }
});

test('late full benchmark recovers its expired round, rejects another worker, survives an interrupted manifest and years of retention', async () => {
 const f=await fixture(undefined,[A,B]), originalNow=Date.now, rename=fs.renameSync; let now=originalNow(); Date.now=()=>now;
 try {
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.13.0',tools:[],features:['report-v3','tcpquality-full']},false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],modules:[{module:'tcpquality-full',timeoutMinutes:30}]});
  const started=await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  now+=46*60000; await f.c.tick();
  assert.equal(f.c.roundController.store.get(A,started.body.rounds[0]).state,'failed');
  const data={kind:'tcpquality-full',state:'ok',profile:'AUTO',cleanLog:'迟到结果',csv:'a,b'};
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${B}/result`,{id:task.id,data},false,true)).status,409);
  // Force a crash after the result file is committed but before its manifest.
  fs.renameSync=function(from,to){if(String(to).endsWith('/manifest.json')) throw Error('simulated crash'); return rename(from,to)};
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data},false,true)).status,400);
  fs.renameSync=rename;
  now+=10*86400000; const restarted=await fixture(f.root,[A,B]);
  const late=await restarted.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data},false,true);
  assert.equal(late.status,200); assert.equal(late.body.replay,true);
  const recovered=restarted.c.roundController.store.get(A,started.body.rounds[0]);
  assert.equal(recovered.state,'complete'); assert.equal(recovered.counts.ok,1);
  assert.equal(recovered.measurements[0].data.cleanLog,'迟到结果'); assert.equal(recovered.measurements[0].data.lateAfterDeadline,true);
  const index=(await restarted.invoke('GET',`${v3}/nodes/${A}/rounds?module=tcpquality-full`)).body.rounds.find(r=>r.id===started.body.rounds[0]);
  assert.equal(index.state,'complete'); assert.equal(index.counts.ok,1);
 } finally {fs.renameSync=rename;Date.now=originalNow;f.close();}
});

test('full report upload recovery adds only a validated URL to the same partial task and is replay-safe', async () => {
 const f=await fixture(undefined,[A,B]), rename=fs.renameSync;
 try {
  await f.invoke('POST',`${v2}/workers/node/${A}/heartbeat`,{version:'1.13.0',tools:[],features:['report-v3','tcpquality-full']},false,true);
  const saved=await f.invoke('POST',v3+'/suites',{revision:0,clients:[A],modules:[{module:'tcpquality-full'}]});
  const started=await f.invoke('POST',`${v3}/suites/${saved.body.suite.id}/run`);
  const task=(await f.invoke('GET',`${v2}/workers/node/${A}/poll`,{},false,true)).body.task;
  const partial={kind:'tcpquality-full',state:'partial',reportUrl:'',diagnostic:'上传失败',csv:'header\n',cleanLog:'日志',exitCode:0};
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:partial},false,true)).status,200);
  const improved={...partial,reportUrl:'https://tcpquality.ibsgss.uk/r/test_ID'};
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${B}/result`,{id:task.id,data:improved},false,true)).status,409);
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{...improved,csv:'altered'}},false,true)).status,409);
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{...improved,reportUrl:'https://evil.example/r/a'}},false,true)).status,400);
  fs.renameSync=function(from,to){if(String(to).includes('/measurements/')) throw Error('simulated crash'); return rename(from,to)};
  assert.equal((await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:improved},false,true)).status,400);
  fs.renameSync=rename;
  assert.equal(f.c.roundController.store.get(A,started.body.rounds[0]).measurements[0].data.reportUrl,'');
  let response=await f.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:improved},false,true);
  assert.equal(response.status,200); assert.equal(response.body.reportUpdated,true);
  const restarted=await fixture(f.root,[A,B]);
  response=await restarted.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:improved},false,true);
  assert.equal(response.status,200); assert.equal(response.body.replay,true);
  const round=restarted.c.roundController.store.get(A,started.body.rounds[0]);
  assert.deepEqual(round.measurements[0].data,improved); assert.equal(round.state,'partial');
  assert.equal((await restarted.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:{...improved,reportUrl:'https://tcpquality.ibsgss.uk/r/another'}},false,true)).status,409);
  assert.equal((await restarted.invoke('DELETE',`${v3}/nodes/${A}/rounds/${started.body.rounds[0]}`)).status,200);
  assert.equal((await restarted.invoke('POST',`${v2}/workers/node/${A}/result`,{id:task.id,data:improved},false,true)).status,409);
 } finally {fs.renameSync=rename;f.close();}
});
