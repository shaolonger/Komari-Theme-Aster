const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { registerNativeController } = require("../src/native-controller.js");
const G = require("../src/globalping.js");
const A = "c388e74d-a922-4ae1-bd10-1fb30e2e53de",
  B = "59d6e276-1d4b-4657-9021-908460853ba3",
  token = "a".repeat(64);
async function fixture(existingRoot) {
  const root =
      existingRoot ||
      fs.mkdtempSync(path.join(os.tmpdir(), "aster-report-api-")),
    routes = new Map();
  const c = registerNativeController({
    server: {
      route: (m, p, f) => routes.set(m + " " + p, f),
      call: async () => [{ uuid: A, name: "VPS", ipv4: "8.8.8.8" }],
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
test("capabilities and catalog are admin-only; old workers finish with explicit missing coverage", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.invoke("GET", v3 + "/capabilities", {}, false)).status,
      403,
    );
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
      fs.writeFileSync(
        path.join(f.root, "native-state.json"),
        JSON.stringify(state),
      );
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
    fs.writeFileSync(path.join(f.root, "native-state.json"), JSON.stringify(s));
    assert.equal(
      (await f.invoke("GET", `${v2}/workers/node/${A}/poll`, {}, false, true))
        .body.task,
      null,
    );
    s.jobs[0].availableAt = 0;
    fs.writeFileSync(path.join(f.root, "native-state.json"), JSON.stringify(s));
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
    fs.writeFileSync(path.join(f.root, "native-state.json"), JSON.stringify(s));
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

test("heartbeats coalesce, claims and results remain durable, and failed transactions discard cached mutations", async () => {
  const f = await fixture(), originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const disk = () => JSON.parse(fs.readFileSync(path.join(f.root, "native-state.json"), "utf8"));
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
