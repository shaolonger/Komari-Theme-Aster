const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const vm = require("node:vm");
const {
  API_BASE,
  buildProbeCommand,
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

test("validates and safely quotes only known probe commands", () => {
  const input = schedule({ mode: "https", target: "status.example.net", port: 443, intervalMinutes: 5 });
  const command = buildProbeCommand(input);
  assert.match(command, /^timeout 150s sh '/);
  assert.match(command, /'https' 'status\.example\.net' '443'$/);
  assert.match(buildProbeCommand(schedule({ mode: "tcpquality-intl", target: "default", intervalMinutes: 1440 })), /^timeout 330s sh .*'tcpquality-intl' 'default'$/);
  assert.throws(() => buildProbeCommand(schedule({ mode: "route", target: "example.net; touch /tmp/x" })), /无效/);
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
    fs.writeFileSync(path.join(fakeBin, "nexttrace"), "#!/bin/sh\nprintf '{\\\"hops\\\":[]}'\n");
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

test("plugin persists admin schedules, dispatches a single node, and protects its routes", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aster-network-plugin-test-"));
  try {
    const routes = new Map();
    const cronJobs = [];
    const commands = [];
    const fakeServer = {
      route(method, route, handler) { routes.set(`${method} ${route}`, handler); },
      cron(expression, handler) { cronJobs.push({ expression, handler }); },
      async call(method, params) {
        if (method === "admin:exec") {
          commands.push(params);
          return { task_id: "task-42" };
        }
        throw new Error(`unexpected RPC: ${method}`);
      },
    };
    const pluginModule = { exports: {} };
    const nativeRequire = require;
    const pluginRequire = (name) => name === "server"
      ? fakeServer
      : ["fs", "path"].includes(name)
        ? nativeRequire(name)
        : nativeRequire(path.resolve(__dirname, "..", name));
    const entry = fs.readFileSync(path.resolve(__dirname, "../script.js"), "utf8");
    vm.runInNewContext(entry, {
      require: pluginRequire,
      module: pluginModule,
      exports: pluginModule.exports,
      __storageDir__: temp,
      console,
    }, { filename: "script.js" });
    pluginModule.exports.load();
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(cronJobs.length, 1);
    assert.equal(cronJobs[0].expression, "* * * * *");
    assert.ok(routes.has("GET /api/aster-network-observatory/v1/status"));
    assert.ok(routes.has("PUT /api/aster-network-observatory/v1/config"));

    async function invoke(method, route, { body = "", roles = ["admin"], type = "user" } = {}) {
      const key = `${method} ${route}`;
      const handler = routes.get(key) ?? (method === "POST" && route.includes("/run/")
        ? routes.get("POST /api/aster-network-observatory/v1/run/:id")
        : undefined);
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
        context: { principal: { type, roles } },
      }, response);
      return { ...response, json: JSON.parse(response.body) };
    }

    const config = { schedules: [schedule({ mode: "https", target: "health.example.net", port: 443, intervalMinutes: 5, nextRunAt: Date.now() + 60_000 })] };
    const saved = await invoke("PUT", "/api/aster-network-observatory/v1/config", { body: JSON.stringify(config) });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json.config.schedules[0].target, "health.example.net");

    const forbidden = await invoke("POST", "/api/aster-network-observatory/v1/run/test_plan_1", { roles: ["viewer"] });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(commands.length, 0);

    const run = await invoke("POST", "/api/aster-network-observatory/v1/run/test_plan_1");
    assert.equal(run.statusCode, 202);
    assert.equal(run.json.task.taskId, "task-42");
    assert.deepEqual(Array.from(commands[0].clients), [CLIENT]);
    assert.match(commands[0].command, /health\.example\.net/);

    const blockedConcurrentRun = await invoke("POST", "/api/aster-network-observatory/v1/run/test_plan_1");
    assert.equal(blockedConcurrentRun.statusCode, 400);
    assert.match(blockedConcurrentRun.json.error, /已有网络检测任务/);

    const status = await invoke("GET", "/api/aster-network-observatory/v1/status");
    assert.equal(status.json.pending, 1);
    assert.equal(status.json.config.schedules[0].enabled, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
