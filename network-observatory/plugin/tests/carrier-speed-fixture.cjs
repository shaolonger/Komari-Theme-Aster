const crypto = require("crypto");
const { registerReportController, BASE } = require("../src/report-controller.js");
const { normalizeSuite, planSlots } = require("../src/report-model.js");
const A = "c388e74d-a922-4ae1-bd10-1fb30e2e53de";
async function speedFixture(root, finish = true, missing = e => e.code === "ENOENT", family = "4") {
  const state = { revision: 0, inventory: [{ uuid: A, name: "VPS", publicVisible: true }], reportSuites: [] }, routes = new Map();
  const ctx = { storageDir: root, isMissingFile: missing,
    server: { route: (m, p, f) => routes.set(m + " " + p, f) },
    authorized: (req, res) => { if (req.admin) return true; res.status = 403; return false; },
    readBody: req => req.body, respond: (res, status, body) => Object.assign(res, { status, body }) };
  const native = { read: () => state, lock: fn => Promise.resolve(fn()), save: () => {} };
  const controller = registerReportController(ctx, native);
  const suite = normalizeSuite({ clients: [A], trafficAccepted: true,
    modules: [{ module: "china-speed", preset: "china-public", family, streams: [1, 4] }] });
  const roundId = crypto.randomUUID();
  const plan = planSlots({ endpoints: {}, probes: {} }, suite, suite.modules[0], A, roundId);
  controller.store.create({ id: roundId, nodeUuid: A, module: "china-speed", suiteId: suite.id,
    parameters: suite.modules[0], slots: plan.slots, _jobs: plan.jobs });
  const data = (i) => ({ kind: "speed", state: "ok", actualEndpoint: { ip: "SECRET_IP", name: "SECRET_NAME" },
    runs: [1, 4].flatMap(streams => ["download", "upload"].map(vpsDirection => ({
      state: "ok", streams, vpsDirection, bitsPerSecond: (streams === 1 ? (vpsDirection === "download" ? 200 : 100) + i + (family === "6" ? 1000 : 0) : 9999) * 1e6,
      intervalSource: vpsDirection === "download" ? "receiver-read" : "sender-tcp-acked",
    }))) });
  if (finish) plan.jobs.forEach((job, i) => controller.complete(job, data(i), { ...job.source, token: "SECRET_TOKEN" }));
  async function invoke(method, suffix, body, admin = true) {
    const res = {}; await routes.get(method + " " + BASE + suffix.split("?", 1)[0])({ url: BASE + suffix, body, admin }, res); return res;
  }
  return { A, state, routes, ctx, native, controller, plan, roundId, data, invoke };
}
module.exports = { speedFixture, A };
