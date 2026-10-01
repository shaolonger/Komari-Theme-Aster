const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { normalizeResource, migration } = require("../src/report-resources.js");
const { ENDPOINTS, PRESETS } = require("../src/report-catalog.js");
const M = require("../src/native-model.js");
const { html } = require("../src/report-share.js");
const uuid = "c388e74d-a922-4ae1-bd10-1fb30e2e53de";
const input = () => ({
  name: "北京电信",
  city: "北京",
  address: "speed.example.net",
  family: "4",
  method: "http",
  uses: ["speed"],
  port: 443,
  sourceUrl: "https://example.net/permission",
  conditions: "自有资源允许定时双向",
  authorized: true,
  path: "/download",
  uploadPath: "/upload",
});
test("resource permissions and fixed HTTP paths are data, not commands", () => {
  const e = normalizeResource(input());
  assert.equal(e.method, "http");
  assert.equal(e.uploadPath, "/upload");
  assert.ok(e.id.startsWith("custom:"));
  assert.throws(() => normalizeResource({ ...input(), authorized: false }));
  assert.throws(() => normalizeResource({ ...input(), address: "$(id)" }));
  assert.throws(() =>
    normalizeResource({ ...input(), path: "/\r\nAuthorization: x" }),
  );
  assert.equal(e.token, undefined);
});
test("official catalog separates IDC latency from authorized uncapped endpoints and covers ten international cities", () => {
  const cities = new Set(
    ENDPOINTS.filter((e) => e.uses.includes("speed")).map((e) => e.city),
  );
  for (const city of [
    "香港",
    "东京",
    "新加坡",
    "悉尼",
    "洛杉矶",
    "旧金山",
    "纽约",
    "法兰克福",
    "伦敦",
    "阿姆斯特丹",
  ])
    assert.ok(cities.has(city), city);
  assert.equal(ENDPOINTS.filter((e) => e.category === "idc").length, 42);
  assert.equal(new Set(ENDPOINTS.map((e) => e.id)).size, ENDPOINTS.length);
  assert.ok(PRESETS.find((p) => p.id === "idc-complete").endpoints.length > 30);
});
test("legacy migration preserves range and timing, creates missing custom site, and prevents P4 being named P1", () => {
  const old = M.normalizePolicy({
    clients: [uuid],
    kind: "websites",
    sites: ["api.example.net"],
    timing: {
      type: "daily",
      times: ["04:00", "21:00"],
      timezone: "Asia/Shanghai",
    },
  });
  const converted = migration(old, 4, []);
  assert.equal(converted.additional.length, 1);
  assert.equal(converted.suite.modules[0].timing.times.length, 2);
  assert.deepEqual(converted.suite.clients, [uuid]);
  assert.equal(converted.disableOldTrigger, true);
});
test("shared HTML escapes measured text and contains no scripts or credentials", () => {
  const round = {
    module: "international",
    plannedAt: new Date().toISOString(),
    state: "complete",
    counts: { completed: 1, expected: 1 },
    slots: [
      {
        id: "x",
        target: "<script>bad()</script>",
        source: { provider: "test" },
        state: "ok",
      },
    ],
    measurements: [],
  };
  const page = html(round, Date.now() + 1000, "/api/shares/token?format=json");
  assert.ok(!page.includes("<script>"));
  assert.ok(page.includes("&lt;script&gt;"));
  assert.ok(page.includes("TCP 建连失败不是 ICMP 丢包"));
});
