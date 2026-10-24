// One completed mainland round per VPS. Store only public-safe P1 evidence;
// never mix cities, providers, families or connection counts across rounds.
const path = require("path"), fs = require("fs");
const { UUID } = require("./model.js");
const { jsonState } = require("./json-state.js");
const CITIES = ["北京", "上海", "广州"], CARRIERS = ["电信", "联通", "移动"];
function projectRound(round) {
  if (round?.module !== "china-speed" || !round.completedAt ||
      !["4", "6"].includes(round.parameters?.family) || !Number.isFinite(Date.parse(round.completedAt))) return null;
  function runValue(run, slot) {
    if (!run) return { bitsPerSecond: null, state: slot.state === "cancelled" ? "cancelled" : slot.state === "failed" ? "failed" : "missing", basis: "unavailable" };
    const valid = ["ok", "partial"].includes(run.state) && Number.isFinite(run.bitsPerSecond) && run.bitsPerSecond >= 0;
    const basis = run.measurementBasis === "sender-tcp-acked" || run.intervalSource === "sender-tcp-acked" ? "tcp-acked"
      : run.measurementBasis === "sender-write" || run.intervalSource === "sender-write" ? "estimated"
      : ["vps-receiver", "http-remote-receiver", "receiver-read", "server-receiver", "client-receiver"].includes(run.measurementBasis || run.intervalSource) ? "receiver" : "unspecified";
    return { bitsPerSecond: valid ? run.bitsPerSecond : null,
      state: valid ? run.state : run.state === "cancelled" ? "cancelled" : run.state === "failed" ? "failed" : "missing", basis: valid ? basis : "unavailable" };
  }
  return {
    reportId: round.id, plannedAt: round.plannedAt, at: round.completedAt,
    family: round.parameters.family, state: round.state,
    cities: CITIES.map(city => ({ city, rows: CARRIERS.map(carrier => {
      // The report planner chooses one canonical resource per city/operator.
      const slot = round.slots.find(s => s.source?.city === city && s.source?.carrier === carrier);
      const runs = slot?.metrics?.runs || [];
      return { carrier, at: slot?.completedAt || null,
        provider: slot?.endpoint?.method === "taier" ? "泰尔公共测速" : slot?.source?.provider === "controlled" ? "受控测量点"
          : slot?.endpoint?.method === "iperf3" ? "iperf3 端点" : slot?.endpoint?.method === "http" ? "HTTP 端点" : "",
        download: runValue(runs.find(r => r.streams === 1 && r.vpsDirection === "download"), slot || {}),
        upload: runValue(runs.find(r => r.streams === 1 && r.vpsDirection === "upload"), slot || {}) };
    }) })),
  };
}
function homeSpeedStore(root, isMissingFile, clock = () => Date.now()) {
  // Komari resolves symlinks before stat; materialize the parent so a missing
  // cache file reports that filename rather than a missing ancestor.
  fs.mkdirSync(path.join(root, "home-speeds"), { recursive: true });
  const files = new Map();
  function file(uuid) {
    if (!UUID.test(uuid)) throw new Error("节点 UUID 无效");
    if (!files.has(uuid)) files.set(uuid, jsonState(path.join(root, "home-speeds", uuid + ".json"), isMissingFile, () => null));
    return files.get(uuid);
  }
  function observe(round, force = false) {
    const value = projectRound(round);
    if (!value) return false;
    const store = file(round.nodeUuid), previous = force ? null : store.read();
    const key = row => [row.plannedAt || row.at, row.at, row.reportId].join("|");
    if (previous && key(previous) >= key(value)) return false;
    store.write(value); return true;
  }
  function summary(allowed) {
    const nodes = {};
    for (const uuid of allowed) {
      const value = file(uuid).read();
      if (value) nodes[uuid] = { ...value, stale: clock() - Date.parse(value.at) > 86400000 };
    }
    return nodes;
  }
  return { observe, summary };
}
module.exports = { projectRound, homeSpeedStore };
