const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const M = require("../src/native-model.js"),
  G = require("../src/globalping.js");
const { archive } = require("../src/native-archive.js");
const {
  registerNativeController,
  BASE,
} = require("../src/native-controller.js");
const A = "c388e74d-a922-4ae1-bd10-1fb30e2e53de",
  B = "59d6e276-1d4b-4657-9021-908460853ba3",
  token = "a".repeat(64);
const missing = (e) => e.code === "ENOENT";
const draft = (x = {}) => ({
  kind: "websites",
  clients: [A],
  revision: 0,
  ...x,
});
function fixture(enrichmentOptions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-native-")),
    routes = new Map();
  let inventory = [
    { uuid: A, name: "VPS", group: "Asia", ipv4: "203.0.113.1" },
  ];
  const legacy = {
    nodes: {
      [A]: {
        tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      },
    },
    tasks: [],
  };
  const server = {
    route: (method, route, handler) =>
      routes.set(method + " " + route, handler),
    cron: () => {},
    call: async () => inventory,
  };
  const respond = (res, status, body) => {
    res.status = status;
    res.body = body;
  };
  const authorized = (req, res) => {
    if (req.admin) return true;
    respond(res, 403, { error: "admin" });
    return false;
  };
  const c = registerNativeController({
    server,
    storageDir: root,
    isMissingFile: missing,
    respond,
    authorized,
    readBody: (r) => JSON.parse(r.body),
    readState: () => legacy,
    enrichmentOptions,
  });
  async function invoke(method, url, body = {}, authToken, admin = true) {
    const key = [...routes.keys()].find((k) => {
      const [m, p] = k.split(" ");
      return (
        m === method &&
        new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+") + "$").test(BASE + url)
      );
    });
    assert.ok(key, url);
    const res = {};
    await routes.get(key)(
      {
        url: BASE + url,
        admin,
        body: JSON.stringify(body),
        headers: { authorization: authToken ? "Bearer " + authToken : "" },
      },
      res,
    );
    return res;
  }
  const mutate = async (fn) =>
    c.lock(async () => {
      const s = c.read();
      fn(s);
      fs.writeFileSync(path.join(root, "native-state.json"), JSON.stringify(s));
    });
  return {
    root,
    c,
    invoke,
    mutate,
    legacy,
    setInventory: (v) => (inventory = v),
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
test("IANA schedules use correct winter/summer offsets, DST gaps and future preview", () => {
  assert.equal(M.offset("America/Los_Angeles", Date.parse("2026-01-01")), -480);
  assert.equal(M.offset("America/Los_Angeles", Date.parse("2026-07-01")), -420);
  assert.equal(
    M.next(
      { type: "daily", times: ["21:00"], timezone: "Asia/Shanghai" },
      Date.parse("2026-09-29T12:59Z"),
    ),
    Date.parse("2026-09-29T13:00Z"),
  );
  assert.equal(
    M.next(
      { type: "daily", times: ["02:30"], timezone: "America/Los_Angeles" },
      Date.parse("2026-03-08T09:00Z"),
    ),
    Date.parse("2026-03-09T09:30Z"),
  );
  assert.throws(
    () => M.normalizePolicy(draft({ kind: "speed", sources: [B] })),
    /确认流量/,
  );
  assert.throws(
    () => M.normalizePolicy(draft({ sites: ["x;curl evil"] })),
    /域名/,
  );
});
test("controlled routes have distinct executors and pair IDs; NAT reverse stays empty", () => {
  const p = M.normalizePolicy(
      draft({ kind: "routes", sources: [B], publicSources: false }),
    ),
    jobs = M.planJobs(
      p,
      A,
      { address: "203.0.113.1" },
      {
        [B]: {
          name: "家庭端",
          city: "上海",
          carrier: "电信",
          accessType: "家庭宽带",
          publicAddress: "",
        },
      },
    );
  assert.equal(jobs[0].executor, "probe:" + B);
  assert.equal(jobs[1].executor, "node:" + A);
  assert.equal(jobs[1].target, "");
  assert.equal(jobs[0].pairId, jobs[1].pairId);
  assert.notEqual(M.fingerprint(jobs[0]), M.fingerprint(jobs[1]));
});
test("Globalping parses official metadata/hops and rejects mismatched source coverage", () => {
  const j = {
      source: { asn: 4134 },
      target: "example.net",
      options: { family: "4", protocol: "tcp" },
    },
    payload = {
      results: [
        {
          probe: {
            country: "CN",
            asn: 4134,
            city: "Shanghai",
            tags: ["eyeball-network"],
          },
          result: {
            status: "finished",
            resolvedAddress: "203.0.113.1",
            hops: [
              { resolvedAddress: "203.0.113.1", timings: [{ rtt: 24.3 }] },
            ],
          },
        },
      ],
    };
  assert.equal(G.normalize(j, payload)[0].data.hops[0].rttMs, 24.3);
  assert.equal(G.normalize(j, payload)[0].data.complete, true);
  payload.results[0].probe.country = "US";
  assert.equal(G.normalize(j, payload)[0].data.state, "missing");
  assert.equal(G.normalize(j, { results: [] })[0].data.state, "missing");
});
test("archive is idempotent, keeps 7-day details and 90-day summaries, protects corruption", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-archive-"));
  try {
    const a = archive(root, missing),
      record = {
        id: A,
        nodeUuid: A,
        completedAt: "2026-09-01T12:00:00Z",
        fingerprint: "sample",
        operation: "website",
        target: "example.net",
        source: { provider: "runner" },
        direction: "VPS→网站",
        data: {
          kind: "website",
          state: "application",
          timingsMs: { ttfb: 30 },
        },
      };
    a.append(record);
    a.append(record);
    assert.equal(a.history(A).summaries[0].samples, 1);
    a.cleanup(A, Date.parse("2026-09-29"));
    assert.equal(a.history(A).records.length, 0);
    assert.equal(a.history(A).summaries[0].application, 1);
    a.cleanup(A, Date.parse("2027-01-01"));
    assert.equal(a.history(A).summaries.length, 0);
    assert.throws(() => a.history("../other"), /标识/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("authenticated controlled two-worker session serializes speed, hides secrets and revokes tokens", async () => {
  const f = fixture();
  try {
    await f.c.tick();
    assert.equal(
      (
        await f.invoke(
          "POST",
          "/probes",
          {
            name: "Shanghai",
            city: "上海",
            carrier: "电信",
            accessType: "家庭宽带",
          },
          undefined,
          false,
        )
      ).status,
      403,
    );
    const probe = (
      await f.invoke("POST", "/probes", {
        name: "Shanghai",
        city: "上海",
        carrier: "电信",
        accessType: "家庭宽带",
      })
    ).body;
    assert.equal(
      (
        await f.invoke(
          "POST",
          `/workers/probe/${probe.id}/verify`,
          {},
          token,
          false,
        )
      ).status,
      401,
    );
    await f.invoke(
      "POST",
      `/workers/probe/${probe.id}/heartbeat`,
      { version: "1.5.0", tools: ["iperf3"], authScheme: "oaep" },
      probe.token,
      false,
    );
    await f.invoke(
      "POST",
      `/workers/node/${A}/heartbeat`,
      { version: "1.5.0", tools: ["iperf3", "openssl"], authScheme: "oaep" },
      token,
      false,
    );
    const p = (
      await f.invoke(
        "POST",
        "/policies",
        draft({
          kind: "speed",
          sources: [probe.id],
          trafficAccepted: true,
          revision: 1,
        }),
      )
    ).body.policy;
    assert.ok(p);
    await f.invoke("POST", `/policies/${p.id}/run`);
    f.legacy.tasks = [{ status: "running", mode: "speedtest" }];
    assert.equal(
      (await f.invoke("GET", `/workers/node/${A}/poll`, {}, token, false)).body
        .task,
      null,
    );
    f.legacy.tasks = [];
    const listen = (
      await f.invoke("GET", `/workers/node/${A}/poll`, {}, token, false)
    ).body.task;
    assert.equal(listen.operation, "listen");
    const saved = f.c.read();
    assert.equal(saved.jobs[0].phase, "listening");
    assert.ok(saved.jobs[0].password);
    assert.equal(
      (
        await f.invoke(
          "POST",
          `/workers/probe/${probe.id}/result`,
          { id: listen.id, data: { state: "ready" } },
          probe.token,
          false,
        )
      ).status,
      409,
    );
    await f.invoke(
      "POST",
      `/workers/node/${A}/result`,
      {
        id: listen.id,
        data: {
          state: "ready",
          publicKey: "-----BEGIN PUBLIC KEY-----\nx\n",
          scheme: "oaep",
        },
      },
      token,
      false,
    );
    const task = (
      await f.invoke(
        "GET",
        `/workers/probe/${probe.id}/poll`,
        {},
        probe.token,
        false,
      )
    ).body.task;
    assert.equal(task.operation, "benchmark");
    assert.equal(task.credentials.password, saved.jobs[0].password);
    assert.equal(task.options.streams.join(","), "1,4");
    await f.invoke(
      "POST",
      `/workers/probe/${probe.id}/result`,
      {
        id: task.id,
        data: {
          kind: "speed",
          state: "ok",
          runs: [
            {
              direction: "source-to-target",
              streams: 1,
              state: "ok",
              bitsPerSecond: 800e6,
              bytes: 1e9,
              seconds: 10,
            },
            {
              direction: "target-to-source",
              streams: 1,
              state: "ok",
              bitsPerSecond: 700e6,
              bytes: 875e6,
              seconds: 10,
            },
          ],
        },
      },
      probe.token,
      false,
    );
    assert.equal(f.c.read().jobs.length, 0);
    assert.equal(
      (await f.invoke("GET", `/workers/node/${A}/poll`, {}, token, false)).body
        .listeners.length,
      0,
    );
    assert.equal(f.c.reports.history(A).records[0].source.carrier, "电信");
    assert.ok(
      !JSON.stringify(f.c.reports.history(A)).includes(saved.jobs[0].password),
    );
    await f.invoke("DELETE", "/probes/" + probe.id);
    assert.equal(
      (
        await f.invoke(
          "POST",
          `/workers/probe/${probe.id}/verify`,
          {},
          probe.token,
          false,
        )
      ).status,
      401,
    );
  } finally {
    f.close();
  }
});
test("async provider ID persists, quota blocks creation, group inheritance and timeout recovery", async () => {
  const f = fixture(),
    originalRequest = G.request,
    originalCreate = G.create;
  let creates = 0;
  G.request = async (suffix) =>
    suffix === "/probes" ? [] : { status: "finished", results: [] };
  G.create = async (j) => {
    creates++;
    return { id: "public-measurement" };
  };
  try {
    await f.c.tick();
    const p = (
      await f.invoke(
        "POST",
        "/policies",
        draft({ kind: "routes", clients: [], groups: ["Asia"] }),
      )
    ).body.policy;
    assert.ok(p);
    await f.invoke("POST", `/policies/${p.id}/run`);
    await f.c.tick();
    assert.equal(creates, 3);
    assert.equal(
      f.c.read().jobs.filter((j) => j.phase === "provider").length,
      3,
    );
    await f.c.tick();
    assert.equal(
      f.c.reports.history(A).records.filter((r) => r.data.state === "missing")
        .length,
      3,
    );
    await f.mutate((s) => {
      s.provider.used = 120;
    });
    await f.invoke("POST", `/policies/${p.id}/run`);
    await f.c.tick();
    assert.equal(creates, 3);
    f.setInventory([
      { uuid: A, group: "Asia" },
      { uuid: B, group: "Asia" },
    ]);
    await f.c.tick();
    assert.equal(
      (
        await f.invoke(
          "POST",
          "/preview",
          draft({ kind: "routes", clients: [], groups: ["Asia"] }),
        )
      ).body.members.length,
      2,
    );
    await f.mutate((s) => {
      s.jobs.forEach((j) => (j.expiresAt = 0));
    });
    await f.c.tick();
    assert.equal(f.c.read().jobs.length, 0);
    assert.ok(
      f.c.reports
        .history(A)
        .records.some((r) => r.data.diagnostic.includes("超时")),
    );
  } finally {
    G.request = originalRequest;
    G.create = originalCreate;
    f.close();
  }
});
test("matching native presets are idempotent, paused tasks are canceled and malformed results rejected", async () => {
  const f = fixture();
  try {
    await f.c.tick();
    const p = (await f.invoke("POST", "/policies", draft())).body.policy;
    const again = (await f.invoke("POST", "/policies", draft({ revision: 1 })))
      .body.policy;
    assert.equal(p.id, again.id);
    assert.equal(f.c.read().policies.length, 1);
    await f.invoke("POST", `/policies/${p.id}/run`);
    assert.ok(f.c.read().jobs.length);
    await f.invoke("POST", "/policies", {
      ...again,
      revision: 2,
      enabled: false,
    });
    assert.equal(f.c.read().jobs.length, 0);
    assert.throws(
      () =>
        M.validateResult(
          {
            kind: "speed",
            state: "ok",
            runs: [{ direction: "up", streams: 1, state: "ok" }],
          },
          "speed",
        ),
      /格式无效/,
    );
    assert.throws(
      () =>
        M.validateResult(
          { kind: "website", state: "application", httpStatus: 403 },
          "website",
        ),
      /格式无效/,
    );
  } finally {
    f.close();
  }
});
test("provider request omits ipVersion for IP targets; 422 and 429 are distinct failures", async () => {
  const original = global.fetch;
  let bodies = [];
  global.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, text: async () => JSON.stringify({ id: "test" }) };
  };
  try {
    await G.create({
      target: "203.0.113.1",
      source: { asn: 4134 },
      options: { family: "4", protocol: "tcp" },
    });
    assert.ok(!("ipVersion" in bodies[0].measurementOptions));
    await G.create({
      target: "example.net",
      source: { asn: 4134 },
      options: { family: "6", protocol: "icmp" },
    });
    assert.equal(bodies[1].measurementOptions.ipVersion, 6);
    global.fetch = async () => ({ ok: false, status: 422 });
    await assert.rejects(
      G.request("/probes"),
      (e) => e.noCoverage && !e.rateLimited,
    );
    global.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(
      G.request("/probes"),
      (e) => e.rateLimited && !e.noCoverage,
    );
  } finally {
    global.fetch = original;
  }
});

test("international catalogue covers TcpQuality website/API and CDN groups, resource paths and legacy defaults", async () => {
  assert.equal(M.WEBSITE_CATALOG.filter(x => x.reference === "TcpQuality").length, 39);
  assert.equal(M.WEBSITE_CATALOG.filter(x => x.group === "静态资源 CDN").length, 8);
  const p = M.normalizePolicy(draft({ sites: M.WEBSITE_CATALOG.map(x => x.host) }));
  const jobs = M.planJobs(p, A, null, {});
  assert.equal(jobs.length, 48);
  const cdn = jobs.find(x => x.target === "cdnjs.cloudflare.com");
  assert.equal(cdn.options.path, "/ajax/libs/jquery/3.7.1/jquery.min.js");
  assert.equal(cdn.options.tcpSamples, 10);
  assert.equal(M.normalizePolicy(draft()).sites.length, 6);
  assert.throws(() => M.normalizePolicy(draft({ sites: M.WEBSITES, timing: {type:"interval",minutes:5} })), /每日安全容量/);
  assert.throws(() => M.normalizePolicy(draft({ sites: Array.from({length:65}, (_,i)=>`site${i}.example.net`) })), /1–64/);
  const f = fixture();
  try {
    const response = await f.invoke("GET", "/catalog");
    assert.equal(response.body.websites[0], "www.google.com");
    assert.equal(response.body.websiteCatalog.length, 48);
    assert.equal(response.body.websiteLimit, 64);
  } finally { f.close(); }
});
test("website volume cannot displace recent route and throughput reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-archive-volume-"));
  try {
    const dir = path.join(root, "native-reports", A);
    fs.mkdirSync(dir, {recursive:true});
    const row = (kind, completedAt) => ({ id: kind+completedAt, nodeUuid:A, fingerprint:kind, completedAt, data:{kind,state:"ok"} });
    fs.writeFileSync(path.join(dir,"2026-09-30.json"), JSON.stringify(Array.from({length:500}, (_,i)=>row("website",`2026-09-30T12:${String(i%60).padStart(2,'0')}:00Z`))));
    fs.writeFileSync(path.join(dir,"2026-09-29.json"), JSON.stringify([row("route","2026-09-29T12:00:00Z"),row("speed","2026-09-29T11:00:00Z")]));
    const h = archive(root, missing).history(A);
    assert.equal(h.records.filter(x=>x.data.kind==="website").length,200);
    assert.equal(h.records.filter(x=>x.data.kind==="route").length,1);
    assert.equal(h.records.filter(x=>x.data.kind==="speed").length,1);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("authenticated route upload enriches outside the state lock and stores provenance", async () => {
  let release;
  const gate = new Promise(resolve=>release=resolve), calls=[];
  const f = fixture({fetcher:async url=>{
    calls.push(url); await gate;
    const name=new URL(url).searchParams.get('name');
    const text=name.startsWith('AS')?'15169 | US | arin | 2000-03-30 | GOOGLE - Google LLC, US':'15169 | 8.8.8.0/24 | US | arin | 1992-12-01';
    return {ok:true,text:async()=>JSON.stringify({Status:0,Answer:[{type:16,name:name+'.',TTL:60,data:JSON.stringify(text)}]})};
  }});
  try {
    await f.c.tick();
    await f.mutate(s=>{
      s.workers['node:'+A]={version:'1.6.0',seenAt:Date.now(),tools:['curl','nexttrace']};
      s.jobs=[{id:B,nodeUuid:A,policyId:A,executor:'node:'+A,operation:'route',phase:'running',target:'8.8.8.8',source:{provider:'runner'},direction:'VPS→大陆',options:{family:'4'},expiresAt:Date.now()+180000}];
    });
    const body={id:B,data:{kind:'route',state:'ok',hops:[{ttl:1,address:'8.8.8.8',asn:'',rttMs:20}]}};
    assert.equal((await f.invoke('POST',`/workers/node/${A}/result`,body,'b'.repeat(64),false)).status,401);
    assert.equal(calls.length,0);
    const pending=f.invoke('POST',`/workers/node/${A}/result`,body,token,false);
    for(let i=0; !calls.length&&i<20;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(calls.length,1);
    const heartbeat=await f.invoke('POST',`/workers/node/${A}/heartbeat`,{version:'1.6.0',tools:['curl','nexttrace']},token,false);
    assert.equal(heartbeat.status,200);
    release();
    assert.equal((await pending).status,200);
    const report=f.c.reports.history(A).records[0];
    assert.equal(report.data.hops[0].asn,'15169');
    assert.equal(report.data.hops[0].network,'GOOGLE - Google LLC, US');
    assert.equal(report.source.runnerVersion,'1.6.0');
    assert.equal(f.c.read().jobs.length,0);
  } finally { release();f.close(); }
});
