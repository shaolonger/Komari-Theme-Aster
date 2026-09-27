const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const vm = require("node:vm");
const {
  API_BASE,
  createDueRuns,
  isHost,
  normalizeConfig,
  parseProbeOutput,
  readAdminPrincipal,
} = require("../src/model.js");

const CLIENT = "c388e74d-a922-4ae1-bd10-1fb30e2e53de";
const CLIENT_TWO = "59d6e276-1d4b-4657-9021-908460853ba3";

function schedule(overrides = {}) {
  return {
    id: "test_plan_1",
    name: "Tokyo route",
    mode: "route",
    enabled: true,
    target: "198.51.100.10",
    carrier: "Telecom",
    region: "Tokyo",
    port: 0,
    intervalMinutes: 360,
    clients: [CLIENT],
    nextRunAt: 0,
    ...overrides,
  };
}

test("validates DNS, IPv4, and IPv6 probe targets", () => {
  assert.equal(isHost("route.example.net"), true);
  assert.equal(isHost("192.0.2.14"), true);
  assert.equal(isHost("2001:db8::1"), true);
  assert.equal(isHost("999.1.1.1"), false);
  assert.equal(isHost("2001:::1"), false);
  assert.equal(isHost("example.net; curl attacker"), false);
  assert.equal(isHost("https://example.net/path"), false);
});

test("rejects shell text and schedules that would run one batch across many VPSes", () => {
  assert.throws(() => normalizeConfig({ schedules: [schedule({ target: "route.example; id" })] }), /有效的目标/);
  assert.throws(() => normalizeConfig({ schedules: [schedule({ clients: [CLIENT, CLIENT_TWO] })] }), /只能选择一台 VPS/);
});

test("keeps throughput and each TcpQuality suite at daily cadence", () => {
  assert.throws(() => normalizeConfig({ schedules: [schedule({ mode: "throughput", intervalMinutes: 5, port: 5201 })] }), /间隔无效/);
  const quality = normalizeConfig({ schedules: [schedule({ mode: "tcpquality-route", target: "", port: 0, intervalMinutes: 1440 })] });
  assert.equal(quality.schedules[0].target, "default");
  assert.equal(quality.schedules[0].port, 0);
  assert.throws(() => normalizeConfig({ schedules: [schedule({ mode: "tcpquality-intl", intervalMinutes: 60 })] }), /间隔无效/);
});

test("normalizes only the fixed probe types and approved schedule intervals", () => {
  const input = schedule({ mode: "https", target: "status.example.net", port: 443, intervalMinutes: 5 });
  assert.equal(normalizeConfig({ schedules: [input] }).schedules[0].mode, "https");
  assert.equal(normalizeConfig({ schedules: [schedule({ mode: "tcpquality-intl", target: "default", intervalMinutes: 1440 })] }).schedules[0].mode, "tcpquality-intl");
  assert.throws(() => normalizeConfig({ schedules: [schedule({ mode: "route", target: "example.net; touch /tmp/x" })] }), /有效的目标/);
});

test("advances at most one due plan so probe work is staggered", () => {
  const config = normalizeConfig({ schedules: [schedule(), schedule({ id: "test_plan_2", name: "Europe HTTPS", mode: "https", target: "status.example.net", port: 443, intervalMinutes: 1 })] });
  const result = createDueRuns(config, 10_000);
  assert.equal(result.due.length, 1);
  assert.equal(result.due[0].id, "test_plan_1");
  assert.ok(result.config.schedules[0].nextRunAt > 10_000);
  assert.equal(result.config.schedules[1].nextRunAt, 0);
});

test("parses a versioned task marker and bounds the stored output", () => {
  const payload = Buffer.from('{"end":{"sum_sent":{"bits_per_second":12500000}}}', "utf8").toString("base64");
  const result = parseProbeOutput(`ASTER_NETWORK_RESULT_V1\tthroughput\tserver.example.net\t0\t${payload}`, {
    scheduleId: "test_plan_1",
    nodeUuid: CLIENT,
    nodeName: "Tokyo-01",
  });
  assert.equal(result.status, "success");
  assert.equal(result.rawOutput, '{"end":{"sum_sent":{"bits_per_second":12500000}}}');
  assert.equal(result.nodeUuid, CLIENT);
  assert.match(result.completedAt, /^\d{4}-/);
  assert.throws(() => parseProbeOutput("arbitrary command output"), /没有返回结果标记.*arbitrary command output/);
});

test("exposes the admin API below the expected same-origin path", () => {
  assert.equal(API_BASE, "/api/aster-network-observatory/v1");
  assert.equal(readAdminPrincipal({ type: "user", roles: ["Admin"] }), true);
  assert.equal(readAdminPrincipal({ type: "api_key", roles: ["admin"] }), true);
  assert.equal(readAdminPrincipal({ type: "user", roles: ["viewer"] }), false);
  assert.equal(readAdminPrincipal({ type: "anonymous", roles: [] }), false);
});

test("runner wraps an installed traceroute tool in a bounded structured result", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aster-network-runner-test-"));
  try {
    const fakeBin = path.join(temp, "bin");
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n");
    fs.chmodSync(path.join(fakeBin, "timeout"), 0o755);
    fs.writeFileSync(path.join(fakeBin, "nexttrace"), "#!/bin/sh\nprintf '%s' '{\"hops\":[]}'\n");
    fs.chmodSync(path.join(fakeBin, "nexttrace"), 0o755);
    const runner = path.resolve(__dirname, "../../runner/probe.sh");
    const process = spawnSync("/bin/sh", [runner, "route", "route.example.net"], {
      encoding: "utf8",
      env: { ...global.process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    });
    assert.equal(process.status, 0, process.stderr);
    const result = parseProbeOutput(process.stdout);
    assert.equal(result.mode, "route");
    assert.equal(result.target, "route.example.net");
    assert.equal(result.exitCode, 0);
    assert.equal(result.rawOutput, '{"hops":[]}');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("runner does not invoke tools when given an unknown mode", () => {
  const runner = path.resolve(__dirname, "../../runner/probe.sh");
  const process = spawnSync("/bin/sh", [runner, "arbitrary", "example.net"], { encoding: "utf8" });
  assert.equal(process.status, 0, process.stderr);
  const [, mode, target, exitCode, encoded] = process.stdout.trim().split("\t");
  assert.equal(mode, "invalid");
  assert.equal(target, "unknown");
  assert.equal(exitCode, "64");
  assert.match(Buffer.from(encoded, "base64").toString("utf8"), /类型无效/);
});

test("runner selects fixed TcpQuality commands and rejects floating code installs", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aster-network-tcpquality-test-"));
  try {
    const fakeBin = path.join(temp, "bin");
    const qualityDir = path.join(temp, "quality");
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(qualityDir);
    fs.writeFileSync(path.join(fakeBin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n", { mode: 0o755 });
    fs.writeFileSync(path.join(qualityDir, "runTcpQuality-core.sh"), "# pinned local core\n");
    fs.writeFileSync(path.join(qualityDir, "runTcpQuality.sh"), "#!/bin/sh\nprintf '%s\\n' \"$*\"\n", { mode: 0o755 });
    const runner = path.resolve(__dirname, "../../runner/probe.sh");
    const process = spawnSync("/bin/sh", [runner, "tcpquality-intl", "default"], {
      encoding: "utf8",
      env: { ...global.process.env, PATH: `${fakeBin}:/usr/bin:/bin`, ASTER_TCPQUALITY_BIN: path.join(qualityDir, "runTcpQuality.sh") },
    });
    const result = parseProbeOutput(process.stdout);
    assert.equal(result.mode, "tcpquality-intl");
    assert.equal(result.target, "default");
    assert.equal(result.exitCode, 0);
    assert.match(result.rawOutput, /--no-rootfs --intl --no-rank-upload/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("plugin queues admin plans for per-node HTTPS workers without system RPC", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aster-network-plugin-test-"));
  try {
    const routes = new Map();
    const cronJobs = [];
    const rpcCalls = [];
    const fakeServer = {
      route(method, route, handler) { routes.set(`${method} ${route}`, handler); },
      cron(expression, handler) { cronJobs.push({ expression, handler }); },
      async call(method, params) {
        rpcCalls.push({ method, params });
        throw new Error(`unexpected RPC: ${method}`);
      },
    };
    const pluginModule = { exports: {} };
    const nativeRequire = require;
    const pluginRequire = (name) => name === "server"
      ? fakeServer
      : ["fs", "path", "crypto"].includes(name)
        ? nativeRequire(name)
        : nativeRequire(path.resolve(__dirname, "..", name));
    const entry = fs.readFileSync(path.resolve(__dirname, "../script.js"), "utf8");
    vm.runInNewContext(entry, {
      require: pluginRequire,
      module: pluginModule,
      exports: pluginModule.exports,
      __storageDir__: temp,
      Buffer,
      console,
    }, { filename: "script.js" });
    pluginModule.exports.load();
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(cronJobs.length, 1);
    assert.equal(cronJobs[0].expression, "* * * * *");
    assert.ok(routes.has("GET /api/aster-network-observatory/v1/status"));
    assert.ok(routes.has("PUT /api/aster-network-observatory/v1/config"));
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../komari-plugin.json"), "utf8"));
    assert.equal(manifest.komari, ">=1.4.3");
    assert.equal(manifest.permissions.allowRoutes, true);
    assert.equal(manifest.permissions.allowSystemRPC, undefined);

    async function invoke(method, route, { body = "", roles = ["admin"], type = "user", headers = {} } = {}) {
      const handler = [...routes.entries()].find(([key]) => {
        const [registeredMethod, registeredPath] = key.split(" ");
        const matcher = new RegExp(`^${registeredPath.split("/").map((part) => part.startsWith(":") ? "[^/]+" : part).join("/")}$`);
        return method === registeredMethod && matcher.test(route);
      })?.[1];
      assert.ok(handler, `missing plugin route ${method} ${route}`);
      const response = {
        statusCode: 200,
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        end(content) { this.body = content; },
      };
      await handler({
        body,
        url: route,
        headers,
        context: { principal: { type, roles } },
      }, response);
      return { ...response, json: JSON.parse(response.body) };
    }

    const issued = await invoke("POST", `/api/aster-network-observatory/v1/nodes/${CLIENT}/token`);
    assert.equal(issued.statusCode, 201);
    assert.match(issued.json.token, /^[0-9a-f]{64}$/);
    const token = issued.json.token;
    const stored = fs.readFileSync(path.join(temp, "state.json"), "utf8");
    assert.equal(stored.includes(token), false, "server must persist only the credential hash");

    const config = { schedules: [schedule({ mode: "https", target: "health.example.net", port: 443, intervalMinutes: 5, nextRunAt: Date.now() + 60_000 })] };
    const saved = await invoke("PUT", "/api/aster-network-observatory/v1/config", { body: JSON.stringify(config) });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json.config.schedules[0].target, "health.example.net");

    const forbidden = await invoke("POST", "/api/aster-network-observatory/v1/run/test_plan_1", { roles: ["viewer"] });
    assert.equal(forbidden.statusCode, 403);

    const unauthorized = await invoke("POST", `/api/aster-network-observatory/v1/nodes/${CLIENT}/verify`);
    assert.equal(unauthorized.statusCode, 401);
    const verified = await invoke("POST", `/api/aster-network-observatory/v1/nodes/${CLIENT}/verify`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(verified.statusCode, 200);

    const run = await invoke("POST", "/api/aster-network-observatory/v1/run/test_plan_1");
    assert.equal(run.statusCode, 202);
    const taskId = run.json.task.taskId;
    assert.match(taskId, /^[0-9a-f-]{36}$/i);
    assert.equal(run.json.task.status, "queued");

    const blockedConcurrentRun = await invoke("POST", "/api/aster-network-observatory/v1/run/test_plan_1");
    assert.equal(blockedConcurrentRun.statusCode, 400);
    assert.match(blockedConcurrentRun.json.error, /已有节点检测任务/);

    const pollUnauthorized = await invoke("GET", `/api/aster-network-observatory/v1/nodes/${CLIENT}/poll`);
    assert.equal(pollUnauthorized.statusCode, 401);
    const poll = await invoke("GET", `/api/aster-network-observatory/v1/nodes/${CLIENT}/poll`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(poll.statusCode, 200);
    assert.equal(poll.json.task.taskId, taskId);
    assert.equal(poll.json.task.target, "health.example.net");
    const emptyPoll = await invoke("GET", `/api/aster-network-observatory/v1/nodes/${CLIENT}/poll`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(emptyPoll.json.task, null);

    const encodedOutput = Buffer.from("HTTPS probe passed", "utf8").toString("base64");
    const output = `ASTER_NETWORK_RESULT_V1\thttps\thealth.example.net\t0\t${encodedOutput}\n`;
    const submitted = await invoke("POST", `/api/aster-network-observatory/v1/nodes/${CLIENT}/result`, {
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ taskId, output }),
    });
    assert.equal(submitted.statusCode, 200);

    const status = await invoke("GET", "/api/aster-network-observatory/v1/status");
    assert.equal(status.json.pending, 0);
    assert.equal(status.json.config.schedules[0].enabled, true);
    assert.equal(status.json.registeredNodes[0].uuid, CLIENT);
    assert.equal(status.json.history[0].rawOutput, "HTTPS probe passed");
    assert.equal(rpcCalls.length, 0, "the plugin must not invoke remote execution RPCs");

    const revoked = await invoke("DELETE", `/api/aster-network-observatory/v1/nodes/${CLIENT}/token`);
    assert.equal(revoked.statusCode, 200);
    assert.equal(revoked.json.registeredNodes.length, 0);
    assert.equal(revoked.json.config.schedules[0].enabled, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
