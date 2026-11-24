const path = require("path"), fs = require("fs");
const { UUID } = require("./model.js");
const { jsonState } = require("./json-state.js");

const DIAGNOSTICS = ["ip-quality", "media-unlock"];
const DIAGNOSTIC_TOOLS = ["bash", "curl", "jq", "python3", "bc", "dig"];
const SECTIONS = ["traffic-reset", ...DIAGNOSTICS];
const PROVIDERS = ["IPinfo", "ipregistry", "ipapi", "IP2Location", "AbuseIPDB"];
const RISK_PROVIDERS = ["IP2Location", "Scamalytics", "ipapi", "AbuseIPDB"];
const SERVICES = ["TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Reddit", "ChatGPT"];
const TYPES = ["isp", "line-isp", "hosting", "business", "education", "government", "banking",
  "organization", "military", "library", "cdn", "mobile-isp", "web-spider", "reserved", "other"];
const STATUSES = ["unlocked", "blocked", "partial", "unsupported"];
const object = value => value && typeof value === "object" && !Array.isArray(value);
const score = value => typeof value === "string" && /^\d{1,3}(?:\.\d{1,4})?%?$/.test(value);
const region = value => typeof value === "string" && /^[A-Z]{2}$/.test(value);
const mediaRow = (row, evidence = false) => object(row) &&
  (STATUSES.includes(row.status) || (evidence && ["failed", "unknown"].includes(row.status))) &&
  Object.entries(row).every(([field, item]) => field === "status" || (field === "region" ? region(item)
    : field === "mode" && ["native", "dns"].includes(item)));

function validateDiagnostics(data, kind) {
  if (!DIAGNOSTICS.includes(kind)) return;
  const ip = kind === "ip-quality", rows = data[ip ? "providers" : "services"];
  if (data.riskScores !== undefined && (!ip || !object(data.riskScores) ||
      Object.entries(data.riskScores).some(([name, value]) => !RISK_PROVIDERS.includes(name) || !score(value))))
    throw new Error("风险评分格式无效");
  if ((data.ipMode !== undefined && (!ip || !["full", "lite"].includes(data.ipMode))) ||
      (data.dbIpScore !== undefined && (!ip || !["0", "50", "100"].includes(data.dbIpScore))))
    throw new Error("IP 质量覆盖格式无效");
  if (data.mediaEvidence !== undefined && (ip || !object(data.mediaEvidence) ||
      Object.entries(data.mediaEvidence).some(([name, checks]) => !SERVICES.includes(name) || !object(checks) ||
        !Object.keys(checks).length || Object.entries(checks).some(([source, row]) =>
          !["ipQuality", "regionRestriction"].includes(source) || !mediaRow(row, true)))))
    throw new Error("解锁判定依据格式无效");
  if (rows === undefined && data.state === "failed") return;
  const keys = ip ? PROVIDERS : SERVICES;
  if (!object(rows) || (!Object.keys(rows).length && (!ip || (!Object.keys(data.riskScores || {}).length && data.dbIpScore === undefined))) || Object.entries(rows).some(([key, value]) =>
    !keys.includes(key) || !object(value) || (ip
      ? !Object.keys(value).length || Object.entries(value).some(([field, item]) =>
        field === "score" ? !score(item) : !["usage", "company"].includes(field) || !TYPES.includes(item))
      : !mediaRow(value)))) {
    throw new Error("主页检测结果格式无效");
  }
}

function resetCycle(value, now = Date.now()) {
  if (!object(value)) return null;
  const { day, elapsed, total, nextAt } = value;
  if (![day, elapsed, total, nextAt].every(Number.isSafeInteger) ||
    day < 1 || day > 31 || total < 28 || total > 31 || elapsed < 0 || elapsed >= total ||
    nextAt <= now || nextAt - now > 32 * 86400000) return null;
  return { day, elapsed, total, nextAt };
}

function homeDiagnosticsStore(root, isMissingFile) {
  const directory = path.join(root, "home-diagnostics");
  fs.mkdirSync(directory, { recursive: true });
  const files = new Map();
  function file(uuid) {
    if (!UUID.test(uuid)) throw new Error("节点 UUID 无效");
    if (!files.has(uuid)) {
      files.set(uuid, jsonState(path.join(directory, uuid + ".json"), isMissingFile, () => ({})));
      if (files.size > 2048) files.delete(files.keys().next().value);
    }
    return files.get(uuid);
  }

  function observe(job, result) {
    const { operation: kind, options, completedAt: at, data } = result;
    const family = options?.family;
    if (!DIAGNOSTICS.includes(kind) || !["4", "6"].includes(family) ||
        !["ok", "partial", "failed"].includes(data?.state)) return;
    const ip = kind === "ip-quality", field = ip ? "providers" : "services";
    const store = file(result.nodeUuid), all = store.read();
    const families = all[kind] || {}, current = families[family];
    const order = job.plannedAt || job.queuedAt || Date.parse(at);
    if (current && (current.order > order || (current.order === order && current.at >= at))) return;
    // Strictly project only the bounded fields, even for internal failures.
    const rows = {};
    try {
      validateDiagnostics(data, kind);
      if (data.state !== "failed") {
        for (const [name, value] of Object.entries(data[field])) rows[name] = ip
          ? { usage: value.usage, company: value.company, score: value.score }
          : { status: value.status, region: value.region, mode: value.mode };
      }
    } catch (_error) { return; }
    const risk = ip && data.state !== "failed"
      ? { riskScores: data.riskScores, ipMode: data.ipMode, dbIpScore: data.dbIpScore } : {};
    store.write({ ...all, [kind]: { ...families, [family]: { at, state: data.state, order, [field]: rows, ...risk } } });
  }

  function summary(settings, workers, visible, display) {
    const nodes = {};
    for (const section of SECTIONS) {
      if (display?.[section] === false) continue;
      for (const uuid of settings?.[section] || []) {
        if (!visible.has(uuid)) continue;
        const node = nodes[uuid] ||= {};
        if (section === "traffic-reset") {
          const worker = workers["node:" + uuid];
          node[section] = worker && Date.now() - worker.seenAt < 90000 ? resetCycle(worker.trafficReset) : null;
          continue;
        }
        let families;
        try { families = file(uuid).read()[section] || {}; }
        catch (_error) { families = {}; }
        const keys = ["4", "6"].filter(family => families[family]);
        node[section] = Object.fromEntries(keys.map(family => {
          const { order: _order, ...value } = families[family];
          return [family, value];
        }));
      }
    }
    return nodes;
  }
  return { observe, summary };
}
module.exports = { DIAGNOSTICS, DIAGNOSTIC_TOOLS, SECTIONS, validateDiagnostics, resetCycle, homeDiagnosticsStore };
