import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("../dist/", import.meta.url).pathname;
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chrome) throw new Error("Chrome/Chromium is required for browser scale gates");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const BACKEND_PROFILES = Object.freeze({
  legacy: Object.freeze({
    id: "fork-rpc-v2.4",
    label: "fork RPC v2.4",
  }),
  official: Object.freeze({
    id: "official-komari-v1.4.3",
    label: "official Komari 1.4.3",
  }),
});

// `rpc.discover` is intentionally not listed here: upstream rejects that
// probe with -32601 so the client can negotiate `rpc.methods`. The calls
// below, by contrast, must never be made after a profile has been selected.
const LEGACY_ONLY_RPC_METHODS = [
  "common:getRealtimeDelta",
  "common:getPingOverview",
  "common:getRecords",
];
const OFFICIAL_ONLY_RPC_METHODS = [
  "rpc.methods",
  "common:getNodesLatestStatus",
  "public:getPublicPingTasks",
  "public:queryMetrics",
  "public:getPingMetricStats",
];
// The 1,800-request soak intentionally exercises the long-poll lifecycle,
// not a local-machine speed benchmark. GitHub hosted runners can take much
// longer than a desktop to schedule every React/network turn, so give the
// same workload a portable completion window instead of weakening the check.
const SOAK_TICK_TARGET = 1_800;
const SOAK_TIMEOUT_MS = 60_000;
// Startup is separate from the render/soak budgets. Hosted Linux runners may
// emit harmless DBus diagnostics and take several seconds before Chromium
// writes its DevTools endpoint, so wait for the actual endpoint rather than
// interpreting stderr as a startup signal.
const DEVTOOLS_STARTUP_TIMEOUT_MS = 30_000;

let activeFixture = {
  backend: BACKEND_PROFILES.legacy.id,
  nodes: 30,
  soak: false,
  run: "startup",
  docs: false,
};
const requestCounts = new Map();
const requestPayloads = new Map();
let savedUiSettings = null;
let rejectNextStudioSave = false;
let studioSaveBarrier = null;

function count(label, run = activeFixture.run) {
  const counts = requestCounts.get(run) ?? {};
  counts[label] = (counts[label] ?? 0) + 1;
  requestCounts.set(run, counts);
}

function recordRpcRequest(run, method, params) {
  count(`rpc:${method}`, run);
  const requests = requestPayloads.get(run) ?? [];
  requests.push({ method, params });
  requestPayloads.set(run, requests);
}

function isOfficialFixture(fixture) {
  return fixture.backend === BACKEND_PROFILES.official.id;
}

function nodeList(size) {
  const docsNames = [
    ["洛杉矶 Edge", "北美", "US", "Vultr"],
    ["东京 Core", "亚太", "JP", "Linode"],
    ["法兰克福 Relay", "欧洲", "DE", "Hetzner"],
    ["新加坡 Gateway", "亚太", "SG", "DigitalOcean"],
    ["香港 Transit", "中国港澳", "HK", "Gcore"],
    ["伦敦 Archive", "欧洲", "GB", "OVHcloud"],
    ["悉尼 Monitor", "大洋洲", "AU", "AWS"],
    ["多伦多 Backup", "北美", "CA", "Oracle Cloud"],
  ];
  return Array.from({ length: size }, (_, index) => {
    const docsNode = docsNames[index % docsNames.length];
    return {
    uuid: `node-${index}`,
    name: activeFixture.docs ? docsNode[0] : `Scale Node ${index}`,
    group: activeFixture.docs ? docsNode[1] : `Group ${index % 8}`,
    region: activeFixture.docs ? docsNode[2] : `R${index % 16}`,
    hidden: false,
    cpu_name: index % 2 === 0 ? "AMD EPYC 7B13" : "Intel Xeon Platinum",
    cpu_cores: 2 + (index % 4) * 2,
    mem_total: 2_147_483_648,
    disk_total: 21_474_836_480,
    weight: index,
    os: "linux",
    arch: "amd64",
    virtualization: "kvm",
    version: "1.0.0",
    provider: activeFixture.docs ? docsNode[3] : "",
    business_role: activeFixture.docs ? ["边缘加速", "核心服务", "监控探针"][index % 3] : "",
    price: activeFixture.docs ? 5 + index * 2 : 0,
    billing_cycle: activeFixture.docs ? "monthly" : "",
    auto_renewal: activeFixture.docs,
    currency: activeFixture.docs ? "USD" : "",
    expired_at: activeFixture.docs ? `2027-${String((index % 9) + 1).padStart(2, "0")}-20T00:00:00Z` : "",
    tags: activeFixture.docs ? ["production", "edge", "backup"][index % 3] : "",
    traffic_limit: 1_000_000_000_000,
    traffic_limit_type: "sum",
  };
  });
}

function legacyReport(index, sequence) {
  return {
    online: true,
    cpu: { usage: (index + sequence) % 100 },
    ram: { used: 536_870_912 + ((index + sequence) % 100) * 1_048_576, total: 2_147_483_648 },
    swap: { used: 0, total: 0 },
    disk: { used: 5_368_709_120, total: 21_474_836_480 },
    load: { load1: 0.5, load5: 0.4, load15: 0.3 },
    network: {
      up: sequence * 100 + index,
      down: sequence * 120 + index,
      totalUp: sequence * 1_000 + index,
      totalDown: sequence * 2_000 + index,
    },
    connections: { tcp: 10, udp: 2 },
    uptime: sequence,
    process: 20,
    updated_at: 1_700_000_000 + sequence,
  };
}

// Upstream's common:getNodesLatestStatus intentionally returns a flat report
// map instead of the fork's nested RealtimeDelta shape. Keep the fixture on
// that wire format so this gate exercises the actual normalizer.
function officialLatestStatus(index, sequence) {
  const docsOffline = activeFixture.docs && index === 0;
  return {
    online: !docsOffline,
    cpu: (index + sequence) % 100,
    ram: 536_870_912 + ((index + sequence) % 100) * 1_048_576,
    ram_total: 2_147_483_648,
    swap: 0,
    swap_total: 0,
    disk: 5_368_709_120,
    disk_total: 21_474_836_480,
    load: 0.5,
    load5: 0.4,
    load15: 0.3,
    net_in: sequence * 120 + index,
    net_out: sequence * 100 + index,
    net_total_up: sequence * 1_000 + index,
    net_total_down: sequence * 2_000 + index,
    connections: 12,
    connections_udp: 2,
    uptime: sequence,
    process: 20,
    time: docsOffline ? Math.floor((Date.now() - 3 * 60 * 60 * 1_000) / 1_000) : 1_700_000_000 + sequence,
  };
}

function toIsoOrNow(value) {
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function requestedEntityIds(params, fixture) {
  const value = Array.isArray(params?.entity_ids) ? params.entity_ids : [];
  const allowed = new Set(nodeList(fixture.nodes).map((node) => node.uuid));
  const ids = value.filter((uuid) => typeof uuid === "string" && allowed.has(uuid));
  return ids.length > 0 ? ids : nodeList(fixture.nodes).map((node) => node.uuid);
}

function officialPingMetricSeries(params, fixture) {
  const metricKeys = Array.isArray(params?.metric_keys) ? params.metric_keys : [];
  const entityIds = requestedEntityIds(params, fixture);
  const end = new Date(toIsoOrNow(params?.end)).getTime();
  const start = new Date(toIsoOrNow(params?.start)).getTime();
  const windowStart = Number.isFinite(start) && start < end ? start : end - 3_600_000;
  const requestedPointCount = Math.max(1, Number(params?.max_points) || 24);
  // The interactive Ping regression run must exercise the long-history parser
  // and uPlot path with the same density requested in production. Scale tests
  // keep their compact response so the gate remains focused on node volume.
  const pointCount = Math.min(fixture.ui ? 4_320 : 24, requestedPointCount);
  const series = [];

  for (const metricKey of metricKeys) {
    if (metricKey !== "ping.latency_ms" && metricKey !== "ping.loss") continue;
    for (const [index, uuid] of entityIds.entries()) {
      const points = Array.from({ length: pointCount }, (_, point) => {
        const fraction = pointCount === 1 ? 1 : point / (pointCount - 1);
        const hasLoss = point === Math.floor(pointCount / 2);
        const count = hasLoss ? 2 : 1;
        return {
          time: new Date(windowStart + (end - windowStart) * fraction).toISOString(),
          value: metricKey === "ping.latency_ms"
            ? 20 + ((index + point) % 30)
            : hasLoss ? 0.5 : 0,
          count,
          tags: { task_id: "1" },
        };
      });
      series.push({
        metric_key: metricKey,
        entity_id: uuid,
        tags: { task_id: "1" },
        points,
      });
    }
  }

  return {
    start: new Date(windowStart).toISOString(),
    end: new Date(end).toISOString(),
    series,
    count: series.length,
  };
}

function officialPingStats(params, fixture) {
  const entityIds = requestedEntityIds(params, fixture);
  const start = toIsoOrNow(params?.start);
  const end = toIsoOrNow(params?.end);
  return {
    start,
    end,
    stats: entityIds.map((uuid, index) => ({
      entity_id: uuid,
      task_id: "1",
      name: "edge",
      type: "icmp",
      interval: 60,
      total: 60,
      valid: 59,
      loss: 1.67,
      loss_approximate: false,
      min: 10,
      max: 80,
      avg: 25 + (index % 3),
      latest: 20 + (index % 30),
      p99_p50_ratio: 1.2,
    })),
    count: entityIds.length,
  };
}

function sendJson(response, body) {
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendOfficialRestEnvelope(response, data) {
  sendJson(response, { status: "success", message: "ok", data });
}

function sendRpcResult(response, id, result) {
  sendJson(response, { jsonrpc: "2.0", id, result });
}

function sendRpcMethodMissing(response, id, method) {
  sendJson(response, {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  });
}

let backgroundAttempts = 0;
let failNextPreviewDocument = false;
const server = createServer(async (request, response) => {
  // Capture the immutable fixture at request start. A navigation can switch
  // profiles while an older long-poll is still unwinding; it must not be
  // counted against, or answered as, the next profile's run.
  const fixture = activeFixture;
  const url = new URL(request.url ?? "/", "http://fixture.local");
  if (url.searchParams.get('aster-preview') === '1' && failNextPreviewDocument) {
    failNextPreviewDocument = false;
    response.writeHead(503, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return response.end('<!doctype html><title>Preview temporarily unavailable</title>');
  }

  if (url.pathname === '/studio-retry.svg') {
    backgroundAttempts += 1;
    response.setHeader('Cache-Control', 'no-store');
    if (backgroundAttempts === 1) { response.writeHead(503); return response.end('try again'); }
    response.setHeader('Content-Type', 'image/svg+xml');
    return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
  }
  if (url.pathname === "/api/nodes") {
    count("nodes", fixture.run);
    const nodes = nodeList(fixture.nodes);
    return isOfficialFixture(fixture)
      ? sendOfficialRestEnvelope(response, nodes)
      : sendJson(response, nodes);
  }
  if (url.pathname === "/api/public") {
    count("public", fixture.run);
    const publicConfig = {
      sitename: fixture.docs ? "Aster 演示站" : "Komari Scale Gate",
      theme: "Aster",
      ...(fixture.ui ? { record_preserve_time: 744, ping_record_preserve_time: 24 } : {}),
      theme_settings: {
        showHomeOverview: Boolean(fixture.docs),
        showGroupTabs: Boolean(fixture.docs),
        desktopNodeViewMode: fixture.docs ? "large" : "compact",
        mobileNodeViewMode: "compact",
        showCostSummary: true,
        costRateApiUrl: "/api/docs-rates",
        homepagePingBindings: { "1": nodeList(fixture.nodes).map((node) => node.uuid) },
        ...(fixture.ui ? { showGroupTabs: true, showPingChart: true } : {}),
        ...(fixture.ui ? savedUiSettings : {}),
      },
    };
    return isOfficialFixture(fixture)
      ? sendOfficialRestEnvelope(response, publicConfig)
      : sendJson(response, publicConfig);
  }
  if (url.pathname === "/api/docs-rates") {
    return sendJson(response, {
      base: "USD",
      date: "2026-09-10",
      rates: { USD: 1, CNY: 7.12, EUR: 0.86, JPY: 147.2 },
    });
  }
  if (url.pathname === "/api/me") {
    count("me", fixture.run);
    return sendJson(response, { logged_in: Boolean(fixture.ui), username: "test", uuid: "test" });
  }
  if (fixture.ui && url.pathname === "/api/admin/client/list") return sendJson(response, nodeList(fixture.nodes).map(node => fixture.docs ? node : ({ ...node, capability_ping: false })));
  if (fixture.ui && url.pathname === "/api/admin/ping") return sendJson(response, Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: `Task ${index + 1}`, type: "icmp", interval: 60, clients: nodeList(fixture.nodes).map((node) => node.uuid) })));
  if (fixture.ui && url.pathname === "/api/admin/theme/settings") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (rejectNextStudioSave) {
      rejectNextStudioSave = false;
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Session expired' }));
      return;
    }
    if (studioSaveBarrier) await studioSaveBarrier;
    savedUiSettings = JSON.parse(Buffer.concat(chunks).toString());
    return sendJson(response, { status: "success" });
  }
  if (url.pathname === "/api/rpc2" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    recordRpcRequest(fixture.run, payload.method, payload.params);

    if (isOfficialFixture(fixture)) {
      if (payload.method === "rpc.discover") {
        return sendRpcMethodMissing(response, payload.id, payload.method);
      }
      if (payload.method === "rpc.methods") {
        return sendRpcResult(response, payload.id, [
          "common:getNodesLatestStatus",
          "public:getPublicPingTasks",
          "public:queryMetrics",
          "public:getPingMetricStats",
        ]);
      }
      if (payload.method === "common:getNodesLatestStatus") {
        const reports = Object.fromEntries(
          Array.from({ length: fixture.nodes }, (_, index) => [
            `node-${index}`,
            officialLatestStatus(index, 1),
          ]),
        );
        return sendRpcResult(response, payload.id, reports);
      }
      if (payload.method === "public:getPublicPingTasks") {
        if (fixture.ui) return sendRpcResult(response, payload.id, Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: `Task ${index + 1}`, weight: index, clients: nodeList(fixture.nodes).map((node) => node.uuid), default_on: true, type: "icmp", interval: 60 })));
        return sendRpcResult(response, payload.id, [{
          id: 1,
          weight: 1,
          name: "edge",
          clients: nodeList(fixture.nodes).map((node) => node.uuid),
          default_on: true,
          type: "icmp",
          interval: 60,
        }]);
      }
      if (payload.method === "public:queryMetrics") {
        return sendRpcResult(response, payload.id, officialPingMetricSeries(payload.params, fixture));
      }
      if (payload.method === "public:getPingMetricStats") {
        return sendRpcResult(response, payload.id, officialPingStats(payload.params, fixture));
      }
      return sendRpcMethodMissing(response, payload.id, payload.method);
    }

    if (payload.method === "rpc.discover") {
      return sendRpcResult(response, payload.id, {
        jsonrpc_version: "2.0",
        contract: "komari.rpc.v2.4",
        methods: ["common:getRealtimeDelta", "common:getPingOverview"],
        capabilities: { "realtime.delta": "1", "ping.overview": "2" },
      });
    }
    if (payload.method === "common:getRealtimeDelta") {
      const since = Number(payload.params?.since ?? 0);
      const sequence = since + 1;
      const reports = {};
      if (since === 0 || (fixture.soak && since < SOAK_TICK_TARGET)) {
        for (let index = 0; index < fixture.nodes; index += 1) {
          reports[`node-${index}`] = legacyReport(index, sequence);
        }
      }
      const result = {
        sequence,
        snapshot: since === 0,
        reports,
        online: since === 0 ? nodeList(fixture.nodes).map((node) => node.uuid) : undefined,
      };
      if (!fixture.soak && since > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      if (fixture.soak && since >= SOAK_TICK_TARGET) await new Promise((resolve) => setTimeout(resolve, 250));
      return sendRpcResult(response, payload.id, result);
    }
    if (payload.method === "common:getPingOverview") {
      const to = Math.floor(Date.now() / 1_000);
      const stats = {};
      const series = {};
      for (let index = 0; index < fixture.nodes; index += 1) {
        const uuid = `node-${index}`;
        stats[uuid] = { "1": { name: "edge", total: 60, lost: 1, latest: 20 + (index % 30), avg: 25, tail: 0.2, loss: 1.67, min: 10, max: 80 } };
        series[uuid] = { "1": Array.from({ length: 24 }, (_, point) => ({
          time: to - (23 - point) * 150,
          value: 20 + ((index + point) % 30),
          sample_count: 2,
          loss_count: point === 11 ? 1 : 0,
          loss: point === 11 ? 50 : 0,
        })) };
      }
      return sendRpcResult(response, payload.id, {
        from: to - 3_600,
        to,
        tasks: [{ id: 1, name: "edge", type: "icmp", interval: 60 }],
        stats,
        series,
      });
    }
    return sendRpcMethodMissing(response, payload.id, payload.method);
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = normalize(join(ROOT, requested));
  const path = safePath.startsWith(normalize(ROOT)) && existsSync(safePath)
    ? safePath
    : join(ROOT, "index.html");
  response.writeHead(200, {
    "Content-Type": mime[extname(path)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(path).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server did not bind TCP");
const profile = mkdtempSync(join(tmpdir(), "aster-browser-gate-"));
const child = spawn(chrome, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-dev-shm-usage",
  "--disable-sync",
  "--remote-debugging-address=127.0.0.1",
  // Let Chromium select an unused port. It writes that port to
  // DevToolsActivePort in this isolated profile, avoiding a flaky random-port
  // collision on parallel CI jobs.
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErrors = "";
let chromeExit = null;
let chromeLaunchError = null;
child.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });
child.once("exit", (code, signal) => { chromeExit = { code, signal }; });
child.once("error", (error) => { chromeLaunchError = error; });

function readDevToolsPort() {
  try {
    const [rawPort] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/, 1);
    const port = Number(rawPort);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

async function waitForDebugger() {
  const deadline = Date.now() + DEVTOOLS_STARTUP_TIMEOUT_MS;
  let port = null;
  while (Date.now() < deadline) {
    if (chromeLaunchError) {
      throw new Error(`Chrome could not start: ${chromeLaunchError.message}`);
    }
    if (chromeExit) {
      const exit = chromeExit.code ?? chromeExit.signal ?? "unknown";
      throw new Error(`Chrome exited before DevTools started (${exit}): ${chromeErrors.slice(-1_000)}`);
    }
    port ??= readDevToolsPort();
    if (!port) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      }).then((result) => result.json());
      const page = pages.find((item) => item.type === "page" && !String(item.url).startsWith("chrome-extension:"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chromium has written the port but has not exposed a page yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Chrome DevTools did not start within ${DEVTOOLS_STARTUP_TIMEOUT_MS}ms (port ${port ?? "not written"}): ${chromeErrors.slice(-1_000)}`,
  );
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async value(expression) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function waitUntil(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.value(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const diagnostics = await cdp.value(`({
    text: document.body?.innerText?.slice(0, 600),
    cards: document.querySelectorAll('.home-node-card-slot').length,
    rows: document.querySelectorAll('.node-list-row').length,
    url: location.href
    , focus: document.activeElement?.outerHTML, switcher: document.querySelector('.node-search-switcher')?.outerHTML
  })`);
  throw new Error(`browser condition timed out: ${expression}; ${JSON.stringify(diagnostics)}`);
}

async function captureScreenshot(cdp, path, { waitForImages = true } = {}) {
  if (waitForImages) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await new Promise((resolve) => setTimeout(resolve, 450));
  const screenshot = await cdp.call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(path, Buffer.from(screenshot.data, "base64"));
}

// The legacy fixture holds one long-poll request open. Tear down the previous
// document before switching `activeFixture`, otherwise a late request emitted
// by the old page can be attributed to the next backend profile and turn a
// real protocol assertion into a cross-navigation race.
async function clearFixturePage(cdp) {
  await cdp.call("Page.navigate", { url: "about:blank" });
  await waitUntil(cdp, "location.href === 'about:blank'", 2_000);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function failGate(condition, message) {
  if (!condition) throw new Error(message);
}

function rpcRequests(run, method) {
  return (requestPayloads.get(run) ?? []).filter((entry) => entry.method === method);
}

function assertNoRpcRequests(run, profileLabel, methods) {
  const requests = requestPayloads.get(run) ?? [];
  for (const method of methods) {
    const countForMethod = requests.filter((entry) => entry.method === method).length;
    failGate(
      countForMethod === 0,
      `${profileLabel} made incompatible RPC call ${method} (${countForMethod}x)`,
    );
  }
}

function assertOneNodeBatch(run, profileLabel, method, paramKey, nodes) {
  const requests = rpcRequests(run, method);
  failGate(
    requests.length === 1,
    `${profileLabel} expected one batched ${method} request, got ${requests.length}`,
  );
  const ids = requests[0]?.params?.[paramKey];
  failGate(
    Array.isArray(ids),
    `${profileLabel} ${method} did not send ${paramKey} as an array`,
  );
  const expected = new Set(Array.from({ length: nodes }, (_, index) => `node-${index}`));
  const actual = new Set(ids);
  failGate(
    actual.size === expected.size && [...expected].every((uuid) => actual.has(uuid)),
    `${profileLabel} ${method} was not a complete ${nodes}-node batch`,
  );
}

function assertLegacyRequestProfile(run, nodes) {
  const profileLabel = BACKEND_PROFILES.legacy.label;
  const counts = requestCounts.get(run) ?? {};
  if ((counts.nodes ?? 0) !== 1) {
    throw new Error(`${profileLabel} ${nodes}-node /api/nodes count=${counts.nodes ?? 0}`);
  }
  if ((counts["rpc:common:getPingOverview"] ?? 0) > 1) {
    throw new Error(`${profileLabel} ${nodes}-node Ping overview fanned out`);
  }
  assertNoRpcRequests(run, profileLabel, OFFICIAL_ONLY_RPC_METHODS);
}

function assertOfficialRequestProfile(run, nodes) {
  const profileLabel = BACKEND_PROFILES.official.label;
  const counts = requestCounts.get(run) ?? {};
  if ((counts.nodes ?? 0) !== 1) {
    throw new Error(`${profileLabel} ${nodes}-node /api/nodes count=${counts.nodes ?? 0}`);
  }

  // The failed discovery probe is required by capability negotiation. After
  // it, all data must come from upstream's batch current-status/metric APIs.
  failGate(
    rpcRequests(run, "rpc.discover").length === 1,
    `${profileLabel} expected one rpc.discover negotiation probe`,
  );
  failGate(
    rpcRequests(run, "rpc.methods").length === 1,
    `${profileLabel} expected one rpc.methods capability request`,
  );
  assertOneNodeBatch(run, profileLabel, "common:getNodesLatestStatus", "uuids", nodes);
  assertOneNodeBatch(run, profileLabel, "public:queryMetrics", "entity_ids", nodes);
  assertOneNodeBatch(run, profileLabel, "public:getPingMetricStats", "entity_ids", nodes);
  failGate(
    rpcRequests(run, "public:getPublicPingTasks").length === 1,
    `${profileLabel} expected one public:getPublicPingTasks request`,
  );

  const metricParams = rpcRequests(run, "public:queryMetrics")[0]?.params ?? {};
  const metricKeys = metricParams.metric_keys;
  failGate(
    Array.isArray(metricKeys) &&
      metricKeys.includes("ping.latency_ms") &&
      metricKeys.includes("ping.loss") &&
      Number(metricParams.max_points) === 24,
    `${profileLabel} Ping metric request did not use the shared 24-point trend batch`,
  );
  failGate(
    Number(rpcRequests(run, "public:getPingMetricStats")[0]?.params?.max_points) === 24,
    `${profileLabel} Ping statistics request did not use the shared 24-point trend batch`,
  );
  assertNoRpcRequests(run, profileLabel, LEGACY_ONLY_RPC_METHODS);
}

const results = [];
let cdp;
try {
  cdp = new CDP(await waitForDebugger());
  await cdp.open();
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("HeapProfiler.enable");

  for (const backend of Object.values(BACKEND_PROFILES)) {
    for (const [nodes, budgetMs] of [[30, 4_000], [300, 6_000], [1_000, 12_000]]) {
      const run = `${backend.id}-scale-${nodes}`;
      await clearFixturePage(cdp);
      activeFixture = { backend: backend.id, nodes, soak: false, run };
      requestCounts.set(run, {});
      requestPayloads.set(run, []);
      await cdp.call("Page.navigate", {
        url: `http://127.0.0.1:${address.port}/?fixture=${nodes}&backend=${backend.id}`,
      });
      await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === ${nodes}`, budgetMs);
      await waitUntil(cdp, "document.querySelectorAll('.ping-task-sparkline-line').length > 0", budgetMs);
      const metrics = await cdp.value(`(() => ({
      renderMs: performance.now(),
      cards: document.querySelectorAll('.home-node-card-slot').length,
      canvases: document.querySelectorAll('canvas').length,
      activeCanvases: document.querySelectorAll('canvas[data-render-active="true"]').length,
      pingTrendLines: document.querySelectorAll('.ping-task-sparkline-line').length,
      emptyPingTrends: document.querySelectorAll('.ping-task-sparkline-empty').length,
      contentVisibility: getComputedStyle(document.querySelector('.home-node-card-slot')).contentVisibility,
      bodyWidth: document.body.scrollWidth
    }))()`);
      if (metrics.renderMs > budgetMs) throw new Error(`${backend.label} ${nodes}-node render ${metrics.renderMs}ms > ${budgetMs}ms`);
      if (nodes >= 300 && metrics.contentVisibility !== "auto") {
        throw new Error(`${backend.label} ${nodes}-node browser card virtualization is disabled`);
      }
      if (nodes >= 300 && metrics.canvases > 0 && metrics.activeCanvases >= metrics.canvases) {
        throw new Error(`${backend.label} ${nodes}-node browser did not suspend offscreen canvases`);
      }
      if (metrics.pingTrendLines === 0 || metrics.emptyPingTrends !== 0) {
        throw new Error(`${backend.label} ${nodes}-node Ping trend regression: lines=${metrics.pingTrendLines}, empty=${metrics.emptyPingTrends}`);
      }
      if (backend === BACKEND_PROFILES.legacy) assertLegacyRequestProfile(run, nodes);
      else assertOfficialRequestProfile(run, nodes);
      results.push({ backend: backend.id, nodes, ...metrics, requests: requestCounts.get(run) ?? {} });
    }
  }

  const soakRun = `${BACKEND_PROFILES.legacy.id}-soak-30`;
  await clearFixturePage(cdp);
  activeFixture = {
    backend: BACKEND_PROFILES.legacy.id,
    nodes: 30,
    soak: true,
    run: soakRun,
  };
  requestCounts.set(activeFixture.run, {});
  requestPayloads.set(activeFixture.run, []);
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/?fixture=30&soak=1&backend=${BACKEND_PROFILES.legacy.id}` });
  await waitUntil(cdp, "document.querySelectorAll('.home-node-card-slot').length === 30", 4_000);
  await cdp.call("HeapProfiler.collectGarbage");
  const heapBefore = await cdp.call("Runtime.getHeapUsage");
  const soakDeadline = Date.now() + SOAK_TIMEOUT_MS;
  while ((requestCounts.get(soakRun)?.["rpc:common:getRealtimeDelta"] ?? 0) < SOAK_TICK_TARGET && Date.now() < soakDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const completedSoakTicks = requestCounts.get(soakRun)?.["rpc:common:getRealtimeDelta"] ?? 0;
  if (completedSoakTicks < SOAK_TICK_TARGET) {
    throw new Error(`browser soak did not finish: ${completedSoakTicks}/${SOAK_TICK_TARGET} long-poll turns in ${SOAK_TIMEOUT_MS}ms`);
  }
  await cdp.call("HeapProfiler.collectGarbage");
  const heapAfter = await cdp.call("Runtime.getHeapUsage");
  const heapGrowth = heapAfter.usedSize - heapBefore.usedSize;
  if (heapGrowth > 16 * 1024 * 1024) throw new Error(`browser soak heap grew ${heapGrowth} bytes`);
  assertLegacyRequestProfile(soakRun, 30);
  results.push({ backend: BACKEND_PROFILES.legacy.id, soakTicks: SOAK_TICK_TARGET, heapBefore: heapBefore.usedSize, heapAfter: heapAfter.usedSize, heapGrowth });

  await clearFixturePage(cdp);
  activeFixture = { backend: BACKEND_PROFILES.official.id, nodes: 3, soak: false, run: "ui-regressions", ui: true };
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.call("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/instance/node-0` });
  await waitUntil(cdp, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Ping')`, 6_000);
  const loadRangeLabels = await cdp.value(`Array.from(document.querySelectorAll('.instance-chart-controls .instance-segmented.is-scrollable button')).map(button => button.textContent.trim())`);
  failGate(loadRangeLabels.filter((label) => label === "1 月").length === 1, "load chart did not expose exactly one 1-month range");
  failGate(!loadRangeLabels.includes("30 天") && !loadRangeLabels.includes("31 天"), "load chart still exposes duplicate 30/31-day ranges");
  failGate(loadRangeLabels.includes("自定义"), "load chart custom range control is missing");
  await cdp.value(`Array.from(document.querySelectorAll('.instance-chart-controls .instance-segmented.is-scrollable button')).find(button => button.textContent.trim() === '自定义').click()`);
  await waitUntil(cdp, `document.querySelectorAll('input[type="datetime-local"]').length === 2`, 2_000);
  await cdp.value(`(() => {
    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '2026-08-01T18:00'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], '2026-08-02T00:00'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '应用时间范围').click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  failGate(rpcRequests("ui-regressions", "public:queryMetrics").some(({ params }) => Array.isArray(params.metric_keys) && params.metric_keys.includes("cpu.usage") && params.start === "2026-08-01T10:00:00.000Z" && params.end === "2026-08-01T16:00:00.000Z"), "custom load range was not sent in Beijing time");
  if (process.env.BROWSER_GATE_SCREENSHOT) {
    await captureScreenshot(cdp, `${process.env.BROWSER_GATE_SCREENSHOT}.load-custom.png`);
  }
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Ping').click()`);
  await waitUntil(cdp, `document.querySelector('.instance-ping-task') !== null`, 6_000);
  for (const label of ["6 小时", "1 天", "7 天", "1 月", "自定义"]) {
    await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
    if (label !== "自定义") {
      await waitUntil(cdp, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(label)} && b.dataset.active === 'true')`, 6_000);
    }
    await waitUntil(cdp, `document.querySelector('.instance-chart-view:not([hidden]) .uplot canvas') !== null`, 6_000);
    if (label === "7 天" || label === "1 月") {
      await waitUntil(cdp, `(() => {
        const chart = document.querySelector('.instance-chart-view:not([hidden]) .instance-uplot-wrap');
        const start = Number(chart?.dataset.windowStart);
        const end = Number(chart?.dataset.windowEnd);
        return chart?.dataset.queryHours === '24' &&
          chart?.dataset.retentionLimited === 'true' &&
          Math.abs((end - start) - ${24 * 3_600}) < 2;
      })()`, 6_000);
      failGate(
        await cdp.value(`document.querySelector('.instance-ping-retention-notice')?.textContent.includes('只保留 24 小时') === true`),
        `${label} Ping range did not explain the 24-hour server retention limit`,
      );
    }
    if (label === "1 月" && process.env.BROWSER_GATE_SCREENSHOT) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${process.env.BROWSER_GATE_SCREENSHOT}.ping.png`, Buffer.from(screenshot.data, "base64"));
    }
  }
  failGate(
    rpcRequests("ui-regressions", "public:queryMetrics").some(({ params }) => {
      const start = Date.parse(String(params.start));
      const end = Date.parse(String(params.end));
      return Number(params.max_points) === 160 && Math.abs(end - start - 24 * 3_600_000) < 2_000;
    }),
    "retention-limited Ping history did not request the available 24-hour slice at full density",
  );
  await waitUntil(cdp, `document.querySelectorAll('input[type="datetime-local"]').length === 2`, 2_000);
  await cdp.value(`(() => {
    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '2026-08-01T18:00'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], '2026-08-02T00:00'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '应用时间范围').click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  failGate(rpcRequests("ui-regressions", "public:queryMetrics").some(({ params }) => params.start === "2026-08-01T10:00:00.000Z" && params.end === "2026-08-01T16:00:00.000Z"), "custom Ping range was not sent in Beijing time");
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/?view=theme-manage` });
  await waitUntil(cdp, `document.querySelector('input[aria-label="搜索要配置的 VPS"]') !== null`, 6_000);
  await cdp.value(`(() => { const input = document.querySelector('.studio-time-editor input[type="search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '上海'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitUntil(cdp, `document.querySelectorAll('.studio-time-options input').length === 1`, 2_000);
  await cdp.value(`document.querySelector('.studio-time-options input').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-time-detail input').value === 'Asia/Shanghai'`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '撤销修改').click()`);
  const storageBeforePreview = await cdp.value(`JSON.stringify(Object.entries(localStorage).sort())`);
  failNextPreviewDocument = true;
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '打开首页预览').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-preview-status').textContent.includes('预览尚未响应')`, 11_000);
  await cdp.value(`document.querySelector('.studio-preview-status button').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-preview-status').textContent.includes('草稿已同步')`, 6_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '关闭预览').click()`);

  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '打开首页预览').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe')?.contentDocument?.querySelectorAll('.home-node-card-slot').length === 3`, 8_000);
  await waitUntil(cdp, `document.querySelector('.studio-preview-status').textContent.includes('草稿已同步')`, 4_000);
  await cdp.value(`document.querySelector('.studio-home-preview iframe').dataset.originalFrame = 'true'; document.querySelector('.studio-preview-status button').click()`);
  await waitUntil(cdp, `!document.querySelector('.studio-home-preview iframe').dataset.originalFrame && document.querySelector('.studio-preview-status').textContent.includes('草稿已同步')`, 6_000);
  await cdp.value(`document.querySelector('.studio-visual-options input[value="dark"]').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe').contentDocument.documentElement.dataset.appearance === 'dark'`, 4_000);
  failGate(await cdp.value(`JSON.stringify(Object.entries(localStorage).sort())`) === storageBeforePreview, 'preview changed outer storage');
  await cdp.value(`document.querySelectorAll('.studio-device-layouts fieldset')[0].querySelectorAll('input')[2].click()`);
  await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe').contentDocument.querySelectorAll('.node-list-row:not(.is-loading)').length === 3`, 4_000);
  await cdp.value(`document.querySelectorAll('.studio-device-layouts fieldset')[0].querySelectorAll('input')[0].click()`);
  await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe').contentDocument.querySelectorAll('.home-node-card-slot').length === 3`, 4_000);
  await cdp.value(`(() => { const input = document.querySelector('.studio-background-controls input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '/images/logo/linux.svg'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe').contentDocument.documentElement.style.getPropertyValue('--bg-image-desktop').includes('/images/logo/linux.svg')`, 4_000);
  failGate(await cdp.value(`JSON.stringify(Object.entries(localStorage).sort())`) === storageBeforePreview, 'background preview polluted outer cache');
  if (process.env.STUDIO_PREVIEW_SCREENSHOT) {
    await cdp.value(`document.querySelector('.studio-home-preview').scrollIntoView({ block: 'start' })`);
    await captureScreenshot(cdp, process.env.STUDIO_PREVIEW_SCREENSHOT);
  }

  await cdp.value(`document.querySelectorAll('[aria-label="首页预览设备"] button')[1].click()`);
  await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe').contentWindow.innerWidth === 390`, 3_000);
  await cdp.value(`document.querySelectorAll('.studio-device-layouts fieldset')[1].querySelectorAll('input')[2].click()`);
  await waitUntil(cdp, `document.querySelector('.studio-home-preview iframe').contentDocument.querySelectorAll('.node-list-row:not(.is-loading)').length === 3`, 4_000);

  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '关闭预览').click()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '撤销修改').click()`);
  await cdp.value(`(() => { const input = document.querySelector('.studio-background-controls input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '/studio-retry.svg'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '加载当前背景预览').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-background-preview [role="status"]').textContent.includes('图片未能加载')`, 3_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '加载当前背景预览').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-background-canvas img')?.naturalWidth === 20`, 3_000);
  failGate(backgroundAttempts >= 2, 'background retry did not issue a new request');
  await cdp.value(`(() => { const input = document.querySelector('.studio-background-controls input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '/images/logo/linux.svg'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '加载当前背景预览').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-background-canvas img')?.complete && document.querySelector('.studio-background-canvas img').naturalWidth > 0`, 3_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '移动背景').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-background-canvas').dataset.device === 'mobile'`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '撤销修改').click()`);
  await waitUntil(cdp, `!document.querySelector('.studio-background-canvas img')`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('资产与成本')).click()`);
  await waitUntil(cdp, `document.querySelector('.studio-asset-editor')?.getClientRects().length > 0`, 2_000);
  await cdp.value(`document.querySelector('.studio-asset-editor .studio-scope-list input[type="checkbox"]').click()`);
  await waitUntil(cdp, `document.querySelector('.aster-studio-state').textContent.includes('未保存')`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '撤销修改').click()`);
  await waitUntil(cdp, `!document.querySelector('.studio-asset-editor .studio-scope-list input[type="checkbox"]').checked`, 2_000);
  await cdp.value(`document.querySelector('.studio-asset-advanced summary').click()`);
  await cdp.value(`(() => { const input = document.querySelector('.studio-rate-input input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'invalid-address'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitUntil(cdp, `document.querySelector('.studio-rate-input input').getAttribute('aria-invalid') === 'true' && Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '保存设置').disabled`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '撤销修改').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-rate-input input').getAttribute('aria-invalid') === 'false'`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('节点与视图')).click()`);
  await waitUntil(cdp, `document.activeElement === document.querySelector('.aster-studio-heading h1')`, 2_000);
  failGate(await cdp.value(`document.querySelector('.aster-studio-heading h1').getBoundingClientRect().top >= 0`), 'section heading is outside viewport after navigation');
  const initialDimensionCount = await cdp.value(`document.querySelectorAll('.studio-dimensions ol > li').length`);
  failGate(await cdp.value(`Array.from(document.querySelectorAll('.studio-dimensions ol > li')).every(row => row.querySelector('.studio-drag-handle')?.draggable)`), 'dimension ordering is missing draggable handles');
  await cdp.value(`Array.from(document.querySelectorAll('.studio-dimensions button')).find(b => b.textContent.includes('新增维度')).click()`);
  await waitUntil(cdp, `document.querySelectorAll('.studio-dimensions ol > li').length === ${initialDimensionCount + 1}`, 2_000);
  await cdp.value(`(() => { const select = document.querySelector('.studio-dimension-default select'); select.value = select.options[select.options.length - 1].value; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await cdp.value(`Array.from(document.querySelectorAll('.studio-dimensions ol > li:last-child button')).find(b => b.textContent === '删除').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-dimension-removal') !== null`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.studio-dimension-removal button')).find(b => b.textContent.includes('删除维度及关联配置')).click()`);
  await waitUntil(cdp, `document.querySelectorAll('.studio-dimensions ol > li').length === ${initialDimensionCount}`, 2_000);
  failGate(await cdp.value(`document.querySelector('.studio-dimension-default select').value === 'legacyGroup'`), 'deleted default dimension did not fall back');
  await cdp.value(`(() => { const input = document.querySelector('.aster-studio-nav input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ping'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitUntil(cdp, `document.querySelector('input[aria-label="搜索要配置的 VPS"]').getClientRects().length > 0`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('节点与视图')).click()`);

  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '新增视图').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-saved-view') !== null`, 2_000);
  await waitUntil(cdp, `document.querySelector('.studio-saved-view').open && document.activeElement === document.querySelector('.studio-saved-view input[aria-label^="重命名视图"]')`, 2_000);
  await cdp.value(`(() => { const input = document.querySelector('.studio-saved-view input[aria-label^="重命名视图"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '日常巡检'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cdp.value(`Array.from(document.querySelectorAll('.studio-sort-editor header button')).find(b => b.textContent.includes('添加条件')).click()`);
  await waitUntil(cdp, `document.querySelectorAll('.studio-sort-editor li').length === 2`, 2_000);
  const initialSortOrder = await cdp.value(`Array.from(document.querySelectorAll('.studio-sort-editor li select:first-of-type')).map(s => s.value)`);
  failGate(await cdp.value(`Array.from(document.querySelectorAll('.studio-sort-editor li')).every(row => row.querySelector('.studio-drag-handle')?.draggable)`), 'saved-view ordering is missing draggable handles');
  await cdp.value(`document.querySelectorAll('.studio-sort-actions')[1].querySelector('button').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-sort-editor [role="status"]').textContent.includes('第 1 优先级')`, 2_000);
  failGate(await cdp.value(`document.querySelector('.studio-sort-editor li select').value`) !== initialSortOrder[0], 'sort priority did not change');
  await cdp.value(`(() => { const select = document.querySelector('.studio-saved-view select[aria-label="添加筛选维度"]'); select.value = 'region'; select.dispatchEvent(new Event('change', { bubbles: true })); const input = document.querySelector('.studio-saved-view input[aria-label="新条件的匹配值"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'US'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cdp.value(`Array.from(document.querySelectorAll('.studio-saved-view .studio-scope button')).find(b => b.textContent.trim() === '添加条件').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-saved-view input[aria-label="地区 的匹配值"]') !== null`, 2_000);
  await cdp.value(`(() => { const input = document.querySelector('.studio-saved-view input[aria-label="地区 的匹配值"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'US; JP; '); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  failGate(await cdp.value(`document.querySelector('.studio-saved-view input[aria-label="地区 的匹配值"]').value === 'US; JP; '`), 'filter editing discarded punctuation');
  await cdp.value(`document.querySelector('.studio-saved-view .studio-scope-list input').click()`);
  await waitUntil(cdp, `document.querySelector('.studio-saved-view summary').textContent.includes('1 台指定节点')`, 2_000);
  await cdp.value(`(() => { const field = Array.from(document.querySelectorAll('.studio-tag-field')).find(e => e.querySelector('label').textContent === 'Scale Node 0 · 厂商'); const input = field.querySelector('input'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Aster Test'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitUntil(cdp, `document.querySelector('.studio-tag-values').parentElement.parentElement.innerText.includes('Aster Test')`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('巡检与指标')).click()`);
  failGate(await cdp.value(`Array.from(document.querySelectorAll('.studio-group-order li')).every(row => row.querySelector('.studio-drag-handle')?.draggable)`), 'group ordering is missing draggable handles');
  await cdp.value(`(() => { const toggle = document.querySelector('.studio-rating-editor > .studio-setting-switch input'); if (!toggle.checked) toggle.click(); })()`);
  await waitUntil(cdp, `!document.querySelector('.studio-rating-editor fieldset').disabled`, 2_000);
  await cdp.value(`(() => { const input = document.querySelector('input[aria-label="今日流量 第 2 级名称"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '日常负载'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitUntil(cdp, `document.querySelector('input[aria-label="今日流量 第 2 级名称"]').value === '日常负载'`, 2_000);
  failGate(await cdp.value(`document.querySelector('.studio-change-summary').textContent.includes('保存视图')`), 'change summary omits edited views');
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('网络观测')).click()`);
  await waitUntil(cdp, `document.querySelector('input[aria-label="搜索要配置的 VPS"]').getClientRects().length > 0`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '选择当前结果').click()`);
  await waitUntil(cdp, `document.body.innerText.includes('批量配置 3 台 VPS')`, 2_000);
  await cdp.value(`(() => { const title = Array.from(document.querySelectorAll('strong')).find(e => e.textContent === '批量配置 3 台 VPS'); title.parentElement.querySelectorAll('input[type="checkbox"]').forEach(e => e.click()); })()`);
  failGate(await cdp.value(`Array.from(document.querySelectorAll('.studio-binding-batch [data-reorder-id]')).every(row => row.querySelector('.studio-drag-handle')?.draggable)`), 'batch task ordering is missing draggable handles');
  if (process.env.BROWSER_GATE_SCREENSHOT) {
    await cdp.value(`document.querySelector('.studio-binding-batch').scrollIntoView({ block: 'start' })`);
    await captureScreenshot(cdp, `${process.env.BROWSER_GATE_SCREENSHOT}.drag-ordering.png`, { waitForImages: false });
  }
  await cdp.value(`document.querySelector('button[aria-label="上移 Task 6"]').click()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '替换所选 VPS 的任务').click()`);
  await cdp.value(`Array.from(document.querySelectorAll('summary')).find(e => e.textContent.includes('汇总策略')).click()`);
  await cdp.value(`document.querySelectorAll('.studio-network-strategy input')[1].click()`);
  await cdp.value(`(() => { const select = document.querySelector('select[aria-label="设置 Scale Node 0 的首页 Ping 主任务"]'); select.value = '6'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await cdp.value(`(() => { const input = document.querySelector('input[aria-label="设置 Task 6 的展示分组"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '国际线路'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  rejectNextStudioSave = true;
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '保存设置').click()`);
  await waitUntil(cdp, `document.body.innerText.includes('草稿已保留')`, 4_000);
  failGate(await cdp.value(`document.querySelector('.aster-studio') !== null && document.querySelector('input[aria-label="今日流量 第 2 级名称"]').value === '日常负载'`), 'permission failure discarded the draft');
  let releaseStudioSave;
  studioSaveBarrier = new Promise(resolve => { releaseStudioSave = resolve; });

  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '保存设置').click()`);
  await waitUntil(cdp, `document.body.innerText.includes('保存中')`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('巡检与指标')).click()`);
  await cdp.value(`(() => { const input = document.querySelector('input[aria-label="今日流量 第 2 级名称"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '保存中继续编辑'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  releaseStudioSave();
  studioSaveBarrier = null;
  await waitUntil(cdp, `document.body.innerText.includes('新修改仍在草稿中')`, 4_000);
  failGate(await cdp.value(`document.querySelector('input[aria-label="今日流量 第 2 级名称"]').value === '保存中继续编辑'`), 'inflight edit was overwritten');
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('网络观测')).click()`);
  await waitUntil(cdp, `document.body.innerText.includes('保存成功') || document.body.innerText.includes('已保存')`, 6_000);
  failGate(Object.values(savedUiSettings?.homepagePingTaskOrder ?? {}).filter(ids => ids.length === 6).length === 3, "batch VPS task configuration was not saved");
  failGate(savedUiSettings.homepagePingTaskOrder["node-0"].join() === "1,2,3,4,6,5", "configured order was lost on save");
  failGate(savedUiSettings.homepagePingAggregationStrategy === 'primary' && savedUiSettings.homepagePingPrimaryTasks['node-0'] === 6 && savedUiSettings.homepagePingTaskGroups['6'] === '国际线路', 'network presentation settings did not persist');
  await waitUntil(cdp, `document.querySelector('.studio-diagnostics[aria-label="网络配置检查"] button[aria-expanded="false"]') !== null`, 2_000);
  failGate(await cdp.value(`document.querySelectorAll('.studio-diagnostics[aria-label="网络配置检查"] li').length === 6`), 'diagnostics initial limit is wrong');
  await cdp.value(`document.querySelector('.studio-diagnostics[aria-label="网络配置检查"] button').click()`);
  await waitUntil(cdp, `document.querySelectorAll('.studio-diagnostics[aria-label="网络配置检查"] li').length === 18`, 2_000);
  await cdp.value(`document.querySelector('.studio-diagnostics[aria-label="网络配置检查"] button').click()`);
  await waitUntil(cdp, `document.querySelectorAll('.studio-diagnostics[aria-label="网络配置检查"] li').length === 6`, 2_000);
  failGate(savedUiSettings.homeSavedViews.find(view => view.name === '日常巡检').sorts.length === 2, 'saved view sort priority was not persisted');
  failGate(savedUiSettings.homeSavedViews.find(view => view.name === '日常巡检').filters.region.join() === 'US,JP', 'filter edits were not persisted without blur');
  failGate(savedUiSettings.homeSavedViews.some(view => view.name === '日常巡检' && view.selectedNodeUuids.join() === 'node-0'), 'saved view scope was not persisted');
  failGate(savedUiSettings.homeNodeFacets['node-0'].provider.includes('Aster Test'), 'tag edit was not saved');
  failGate(savedUiSettings.trafficRatingLabels.split(',').length === 4 && savedUiSettings.trafficRatingLabels.split(',')[1] === '日常负载', 'rating levels were lost on save');
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '撤销修改').click()`);
  await waitUntil(cdp, `document.querySelector('input[aria-label="今日流量 第 2 级名称"]').value === '日常负载' && !document.querySelector('.studio-change-summary')`, 2_000);

  await cdp.call("Page.reload");
  await waitUntil(cdp, `document.querySelector('.aster-studio-nav button') !== null`, 6_000);
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('网络观测')).click()`);
  await waitUntil(cdp, `document.querySelector('input[aria-label="搜索要配置的 VPS"]') !== null && document.body.innerText.includes('Task 4 → Task 6 → Task 5')`, 6_000);
  failGate(await cdp.value(`document.querySelector('input[aria-label="今日流量 第 2 级名称"]').value === '日常负载'`), 'rating label did not survive reload');
  failGate(await cdp.value(`document.querySelector('.studio-saved-view summary').textContent.includes('日常巡检') && document.querySelector('.studio-saved-view summary').textContent.includes('1 台指定节点')`), 'saved view summary did not recover');

  failGate(await cdp.value(`document.querySelector('select[aria-label="设置 Scale Node 0 的首页 Ping 主任务"]').value === '6' && document.querySelector('input[aria-label="设置 Task 6 的展示分组"]').value === '国际线路' && document.querySelectorAll('.studio-network-strategy input')[1].checked`), 'network presentation settings did not reload');
  await cdp.value(`Array.from(document.querySelectorAll('.studio-bindings button')).find(b => b.textContent === '选择当前结果').click()`);
  await cdp.value(`Array.from(document.querySelectorAll('.studio-binding-batch button')).find(b => b.textContent === '替换所选 VPS 的任务').click()`);
  await waitUntil(cdp, `Array.from(document.querySelectorAll('.studio-binding-node')).every(e => e.innerText.includes('未配置'))`, 2_000);
  await cdp.value(`document.querySelector('.studio-binding-batch .studio-task-catalog input').click()`);
  await cdp.value(`Array.from(document.querySelectorAll('.studio-binding-batch button')).find(b => b.textContent === '追加任务').click()`);
  await waitUntil(cdp, `Array.from(document.querySelectorAll('.studio-binding-node')).every(e => e.querySelector('p')?.textContent === 'Task 1')`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === '撤销修改').click()`);
  await waitUntil(cdp, `Array.from(document.querySelectorAll('.studio-binding-node')).every(e => e.querySelector('p')?.textContent.includes('Task 4 → Task 6 → Task 5'))`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.studio-bindings button')).find(b => b.textContent === '取消选择').click()`);


  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('节点与视图')).click()`);
  await waitUntil(cdp, `Array.from(document.querySelectorAll('.studio-tag-field')).find(e => e.querySelector('label').textContent === 'Scale Node 0 · 厂商').innerText.includes('Aster Test')`, 2_000);
  await cdp.value(`document.querySelector('button[aria-label="移除 Scale Node 0 · 厂商 标签 Aster Test"]').click()`);
  await waitUntil(cdp, `!document.querySelector('button[aria-label="移除 Scale Node 0 · 厂商 标签 Aster Test"]')`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '撤销修改').click()`);
  await waitUntil(cdp, `document.querySelector('button[aria-label="移除 Scale Node 0 · 厂商 标签 Aster Test"]') !== null`, 2_000);
  await cdp.value(`Array.from(document.querySelectorAll('.aster-studio-nav button')).find(b => b.textContent.includes('网络观测')).click()`);


  if (process.env.BROWSER_GATE_SCREENSHOT) {
    await cdp.value(`document.querySelector('input[aria-label="搜索要配置的 VPS"]').scrollIntoView({ block: 'start' })`);
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${process.env.BROWSER_GATE_SCREENSHOT}.editor.png`, Buffer.from(screenshot.data, "base64"));
  }
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
  await waitUntil(cdp, `document.querySelectorAll('.ping-task-lane').length === 18`, 6_000);
  failGate(await cdp.value(`Array.from(document.querySelectorAll('.home-node-card-slot')[0].querySelectorAll('.ping-task-lane-name')).map(e => e.textContent).join() === 'Task 1,Task 2,Task 3,Task 4,Task 6,Task 5'`), "card did not preserve all six configured tasks in order");
  const facetBefore = await cdp.value(`Array.from(document.querySelectorAll('.home-facet-rail button')).map(e => e.querySelector('span')?.textContent)`);
  await cdp.value(`Array.from(document.querySelectorAll('.home-facet-rail button')).find(e => e.textContent.includes('Group 2')).click()`);
  failGate(JSON.stringify(await cdp.value(`Array.from(document.querySelectorAll('.home-facet-rail button')).map(e => e.querySelector('span')?.textContent)`)) === JSON.stringify(facetBefore), "selected facet moved from its position");
  await cdp.value(`document.querySelector('button[title="地区：R1"]').click()`);
  await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === 0`, 2_000);
  failGate(await cdp.value(`document.querySelector('button[title="分组：Group 2"]').getAttribute('aria-selected') === 'true'`), "cross-category empty results silently cleared group");
  await cdp.value(`document.querySelector('button[title="地区：R2"]').click()`);
  await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === 1`, 2_000);
  if (process.env.BROWSER_GATE_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${process.env.BROWSER_GATE_SCREENSHOT}.facets.png`, Buffer.from(screenshot.data, "base64"));
  }
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/instance/node-0` });
  await waitUntil(cdp, `document.querySelector('input[aria-label="搜索并切换 VPS"]') !== null`, 6_000);
  await waitUntil(cdp, `document.querySelector('.instance-uplot-wrap canvas') !== null`, 6_000);
  await cdp.value(`document.querySelector('input[aria-label="搜索并切换 VPS"]').focus()`);
  await waitUntil(cdp, `document.querySelectorAll('.node-switch-results [role="option"]').length === 3`, 4_000);
  await cdp.call("Input.insertText", { text: "scale 2" });
  await waitUntil(cdp, `document.querySelectorAll('.node-switch-results [role="option"]').length === 1`, 2_000);
  if (process.env.BROWSER_GATE_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${process.env.BROWSER_GATE_SCREENSHOT}.search.png`, Buffer.from(screenshot.data, "base64"));
  }
  await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await waitUntil(cdp, `location.pathname === '/instance/node-2'`, 4_000);
  if (process.env.BROWSER_GATE_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.env.BROWSER_GATE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  if (process.env.BROWSER_GATE_SCREENSHOT) {
    activeFixture = {
      backend: BACKEND_PROFILES.official.id,
      nodes: 8,
      soak: false,
      run: "docs-screenshots",
      ui: true,
      docs: true,
    };
    savedUiSettings = null;
    const screenshotBase = process.env.BROWSER_GATE_SCREENSHOT.replace(/\.png$/, "");

    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
    await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === 8`, 6_000);
    await cdp.value(`localStorage.setItem('appearance', JSON.stringify('light'))`);
    await cdp.call("Page.reload");
    await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === 8 && document.title === 'Aster 演示站'`, 6_000);
    await captureScreenshot(cdp, `${screenshotBase}-overview-light.png`);

    await cdp.value(`document.querySelector('[data-home-overview-trigger="status"]').click()`);
    await waitUntil(cdp, `document.querySelector('.home-overview-panel.show h3').textContent.includes('在线状态') && document.querySelectorAll('.home-overview-row').length === 8`, 6_000);
    failGate(await cdp.value(`document.querySelector('.home-overview-row:first-child').dataset.online === 'false' && document.querySelector('.home-overview-row:first-child').textContent.includes('离线于') && document.querySelector('.home-overview-row:first-child').textContent.includes('小时')`), 'online summary did not prioritize and describe the offline VPS');
    await captureScreenshot(cdp, `${screenshotBase}-online-summary.png`, { waitForImages: false });
    await cdp.value(`document.querySelector('[data-home-overview-trigger="bandwidth"]').click()`);
    await waitUntil(cdp, `document.querySelector('.home-overview-panel.show h3').textContent.includes('实时带宽') && document.querySelectorAll('.home-overview-row').length === 8`, 6_000);
    await cdp.value(`document.querySelector('[data-home-overview-trigger="traffic"]').click()`);
    await waitUntil(cdp, `document.querySelector('.home-overview-panel.show h3').textContent.includes('流量排行') && document.querySelectorAll('.home-overview-tabs [role="tab"]').length === 3`, 6_000);
    await cdp.value(`Array.from(document.querySelectorAll('.home-overview-tabs [role="tab"]')).find(button => button.textContent.includes('本月流量')).click()`);
    failGate(await cdp.value(`document.querySelector('.home-overview-tabs [role="tab"][aria-selected="true"]').textContent.includes('本月流量')`), 'traffic overview month tab did not activate');
    await cdp.value(`document.querySelector('[data-home-overview-trigger="expiry"]').click()`);
    await waitUntil(cdp, `document.querySelector('.home-overview-panel.show h3').textContent.includes('7 天到期')`, 6_000);
    await cdp.value(`document.querySelector('.home-overview-close').click()`);
    await waitUntil(cdp, `document.querySelector('.home-overview-panel.show') === null`, 2_000);

    await cdp.value(`document.querySelector('button[title="打开资产统计"]').click()`);
    await waitUntil(cdp, `document.querySelector('.cost-summary-panel.show') !== null`, 6_000);
    await captureScreenshot(cdp, `${screenshotBase}-asset-summary.png`, { waitForImages: false });
    await cdp.value(`document.querySelector('button[aria-label="关闭服务器花费"]').click()`);
    await waitUntil(cdp, `document.querySelector('.cost-summary-panel.show') === null`, 2_000);

    await cdp.value(`localStorage.setItem('appearance', JSON.stringify('dark'))`);
    await cdp.call("Page.reload");
    await waitUntil(cdp, `document.documentElement.dataset.appearance === 'dark' && document.querySelectorAll('.home-node-card-slot').length === 8`, 6_000);
    await captureScreenshot(cdp, `${screenshotBase}-overview-dark.png`);

    await cdp.value(`localStorage.setItem('appearance', JSON.stringify('light'))`);
    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/instance/node-1` });
    await waitUntil(cdp, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Ping')`, 6_000);
    await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Ping').click()`);
    await waitUntil(cdp, `document.querySelector('.instance-ping-task') !== null`, 6_000);
    await captureScreenshot(cdp, `${screenshotBase}-instance-ping.png`);

    await cdp.call("Page.navigate", {
      url: `http://127.0.0.1:${address.port}/compare?nodes=node-0,node-1,node-2&metric=ping_latency&hours=24`,
    });
    await waitUntil(cdp, `document.querySelector('.compare-page') !== null && document.querySelectorAll('.compare-selected-pill').length === 3 && document.querySelector('.compare-chart-wrap canvas') !== null`, 8_000);
    await captureScreenshot(cdp, `${screenshotBase}-compare.png`);

    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/?view=theme-manage` });
    await waitUntil(cdp, `document.body.innerText.includes('Aster 工作室')`, 8_000);
    await cdp.value(`scrollTo(0, 0)`);
    await captureScreenshot(cdp, `${screenshotBase}-theme-settings.png`);
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await captureScreenshot(cdp, `${screenshotBase}-studio-mobile.png`);
    failGate(await cdp.value(`document.documentElement.scrollWidth <= innerWidth + 1`), 'Studio overflows mobile viewport');
    for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'mobile' });
      for (const [index, section] of ['appearance', 'overview', 'views', 'assets', 'network'].entries()) {
        await cdp.value(`document.querySelectorAll('.aster-studio-nav nav button')[${index}].click()`);
        await waitUntil(cdp, `document.activeElement === document.querySelector('.aster-studio-heading h1')`, 2_000);
        failGate(await cdp.value(`document.documentElement.scrollWidth <= innerWidth + 1`), `Studio ${section} overflows ${device} viewport`);
        await captureScreenshot(cdp, `${screenshotBase}-studio-${section}-${device}.png`);
      }
    }
    await cdp.value(`localStorage.setItem('appearance', JSON.stringify('dark'))`);
    await cdp.call('Page.reload');
    await waitUntil(cdp, `document.documentElement.dataset.appearance === 'dark' && document.querySelector('.aster-studio-nav') !== null`, 8_000);
    for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'mobile' });
      for (const [index, section] of ['appearance', 'overview', 'views', 'assets', 'network'].entries()) {
        await cdp.value(`document.querySelectorAll('.aster-studio-nav nav button')[${index}].click()`);
        await waitUntil(cdp, `document.activeElement === document.querySelector('.aster-studio-heading h1')`, 2_000);
        failGate(await cdp.value(`document.documentElement.scrollWidth <= innerWidth + 1`), `Studio ${section} overflows ${device} viewport`);
        await captureScreenshot(cdp, `${screenshotBase}-studio-${section}-${device}-dark.png`);
      }
    }
    await cdp.value(`localStorage.setItem('appearance', JSON.stringify('light'))`);




    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: 430,
      height: 932,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
    await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === 8`, 8_000);
    await captureScreenshot(cdp, `${screenshotBase}-overview-mobile.png`);
  }
  results.push({ uiRegressions: "load/Ping ranges, online summary, draggable ordering, VPS task save/reload, cross-category filtering, keyboard VPS search" });
  console.log(JSON.stringify(results, null, 2));
} finally {
  cdp?.close();
  if (!chromeExit) {
    await new Promise((resolve) => {
      const onExit = () => resolve();
      child.once("exit", onExit);
      if (chromeExit) {
        child.off("exit", onExit);
        resolve();
        return;
      }
      child.kill("SIGTERM");
    });
  }
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
