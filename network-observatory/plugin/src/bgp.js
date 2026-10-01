// Public control-plane observations. Never infer a paid transit agreement from AS adjacency.
const { originQuery } = require("./route-enrichment.js");
const RIS = "https://stat.ripe.net/data/",
  RV = "https://api.routeviews.org/prefix/";
function addressBytes(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((x) => x >= 0 && x <= 255) ? parts : null;
  }
  if (!/^[0-9a-f:]+$/i.test(ip)) return null;
  const halves = ip.split("::"),
    left = halves[0] ? halves[0].split(":") : [],
    right = halves[1] ? halves[1].split(":") : [];
  if (
    halves.length > 2 ||
    (halves.length === 2 && left.length + right.length >= 8)
  )
    return null;
  const parts =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/i.test(p)))
    return null;
  return parts.flatMap((p) => [parseInt(p, 16) >> 8, parseInt(p, 16) & 255]);
}
function contains(ip, prefix) {
  if (typeof prefix !== "string") return false;
  const split = prefix.split("/"),
    a = addressBytes(ip),
    b = addressBytes(split[0]),
    length = Number(split[1]);
  if (
    split.length !== 2 ||
    !a ||
    !b ||
    a.length !== b.length ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > a.length * 8
  )
    return false;
  for (let i = 0; i < a.length; i++) {
    const bits = Math.min(8, Math.max(0, length - i * 8)),
      mask = bits ? (255 << (8 - bits)) & 255 : 0;
    if ((a[i] & mask) !== (b[i] & mask)) return false;
  }
  return true;
}
function token(value) {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 4294967295
  )
    return String(value);
  if (Array.isArray(value)) {
    const members = value.map(token).filter((t) => /^\d+$/.test(t));
    return members.length
      ? "{" +
          [...new Set(members)]
            .sort((a, b) => Number(a) - Number(b))
            .join(",") +
          "}"
      : "?";
  }
  const text = String(value || "").replace(/^AS/i, "");
  if (/^\d+$/.test(text) && Number(text) > 0 && Number(text) <= 4294967295)
    return text;
  if (/^\{[\d, ]+\}$/.test(text))
    return token(text.slice(1, -1).split(/[, ]+/));
  return "?";
}
function asPath(value) {
  const parts = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.match(/\{[^}]+\}|[^\s]+/g) || []
      : [];
  return parts.slice(0, 128).map(token); // preserve prepends and AS_SET instead of flattening
}
function origins(paths) {
  return [
    ...new Set(
      paths.flatMap((p) => p.path[p.path.length - 1]?.match(/\d+/g) || []),
    ),
  ].sort((a, b) => Number(a) - Number(b));
}
function sampleByCollector(rows, collector) {
  const groups = new Map();
  for (const row of rows) {
    const key = collector(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const sampled = [],
    values = [...groups.values()];
  for (let i = 0; sampled.length < 300; i++) {
    let found = false;
    for (const group of values)
      if (group[i]) {
        sampled.push(group[i]);
        found = true;
        if (sampled.length === 300) break;
      }
    if (!found) break;
  }
  return sampled;
}
function topology(paths) {
  const nodes = new Map(),
    edges = new Map();
  paths.forEach((p) => {
    for (const asn of p.path) {
      if (!nodes.has(asn))
        nodes.set(asn, {
          id: asn,
          origin: false,
          kind: asn.startsWith("{")
            ? "as-set"
            : asn === "?"
              ? "unknown"
              : "asn",
        });
    }
    if (p.path.length) nodes.get(p.path[p.path.length - 1]).origin = true;
    for (let i = 1; i < p.path.length; i++) {
      const from = p.path[i - 1],
        to = p.path[i];
      if (from === to) continue;
      const key = from + ">" + to;
      if (!edges.has(key)) edges.set(key, { id: key, from, to, pathIds: [] });
      edges.get(key).pathIds.push(p.id);
    }
  });
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
function normalizeRis(payload, prefix) {
  const data = payload?.data || {},
    all = Array.isArray(data.bgp_state) ? data.bgp_state : [];
  const exact = all.filter((r) => r.target_prefix === prefix);
  const paths = sampleByCollector(
    exact,
    (r) => String(r.source_id || "").split("-", 1)[0],
  )
    .map((r, i) => {
      const source = String(r.source_id || "unknown").slice(0, 160),
        split = source.indexOf("-");
      return {
        id: "ris:" + i,
        source: "RIPE RIS",
        prefix,
        collector: "rrc" + (split < 0 ? "?" : source.slice(0, split)),
        peer: split < 0 ? source : source.slice(split + 1),
        peerAsn: token(r.path?.[0]),
        path: asPath(r.path),
        observedAt: data.timestamp || data.query_time || null,
        routeUpdatedAt: null,
        communities: Array.isArray(r.community)
          ? r.community.slice(0, 30).map(String)
          : [],
      };
    })
    .filter((p) => p.path.length);
  return {
    paths,
    coverage: {
      source: "RIPE RIS",
      state: "ok",
      url: RIS + "bgp-state/data.json?resource=" + encodeURIComponent(prefix),
      dataTime: data.timestamp || data.query_time || null,
      returnedPaths: exact.length,
      retainedPaths: paths.length,
      truncated: exact.length > 300,
      collectors: [...new Set(paths.map((p) => p.collector))],
      peers: [...new Set(paths.map((p) => p.collector + "/" + p.peer))],
      diagnostic: "",
    },
  };
}
function normalizeRouteViews(payload, prefix) {
  const rows = Array.isArray(payload)
      ? payload.filter((r) => r.prefix === prefix)
      : [],
    all = rows.flatMap((r) =>
      Array.isArray(r.reporting_peers) ? r.reporting_peers : [],
    );
  const paths = sampleByCollector(all, (p) => p.collector || "unknown")
    .map((p, i) => ({
      id: "rv:" + i,
      source: "RouteViews",
      prefix,
      collector: String(p.collector || "unknown").slice(0, 120),
      peer: String(p.peer_addr || "unknown").slice(0, 100),
      peerAsn: token(p.peer_asn),
      path: asPath(p.as_path),
      observedAt: null,
      routeUpdatedAt: p.timestamp || null,
      communities:
        typeof p.communities === "string"
          ? p.communities.split(/\s+/).slice(0, 30)
          : [],
    }))
    .filter((p) => p.path.length);
  return {
    paths,
    coverage: {
      source: "RouteViews",
      state: "ok",
      url: "https://api.routeviews.org/docs/",
      dataTime: null,
      returnedPaths: all.length,
      retainedPaths: paths.length,
      truncated: all.length > 300,
      collectors: [...new Set(paths.map((p) => p.collector))],
      peers: [...new Set(paths.map((p) => p.collector + "/" + p.peer))],
      diagnostic: "API 所覆盖的采集器子集；peer 时间为该路由的最近更新时间",
    },
  };
}
function rpkiStatus(status) {
  return status === "unknown" || status === "not-found"
    ? "not-found"
    : ["valid", "invalid_asn", "invalid_length"].includes(status)
      ? status
      : "unavailable";
}
function changes(previous, current) {
  if (!previous || previous.prefix !== current.prefix)
    return {
      baseline: true,
      comparableSources: [],
      addedPaths: [],
      removedPaths: [],
      addedAdjacentAsns: [],
      removedAdjacentAsns: [],
      addedOriginAsns: [],
      removedOriginAsns: [],
      coverageChanged: false,
    };
  const comparable = current.sources
    .filter(
      (s) =>
        s.state === "ok" &&
        previous.sources.some((p) => p.source === s.source && p.state === "ok"),
    )
    .map((s) => s.source);
  const keys = (snapshot) =>
    new Set(
      snapshot.paths
        .filter((p) => comparable.includes(p.source))
        .map((p) => `${p.source}:${p.collector}:${p.peer}:${p.path.join(" ")}`),
    );
  const a = keys(previous),
    b = keys(current);
  function adjacent(snapshot) {
    return new Set(
      snapshot.paths
        .filter((p) => comparable.includes(p.source))
        .map((p) => {
          const origin = p.path[p.path.length - 1];
          return [...p.path].reverse().find((t) => t !== origin) || "";
        })
        .filter(Boolean),
    );
  }
  const pa = adjacent(previous),
    ca = adjacent(current);
  return {
    baseline: false,
    comparableSources: comparable,
    addedPaths: [...b].filter((p) => !a.has(p)).slice(0, 100),
    removedPaths: [...a].filter((p) => !b.has(p)).slice(0, 100),
    addedAdjacentAsns: [...ca].filter((p) => !pa.has(p)),
    removedAdjacentAsns: [...pa].filter((p) => !ca.has(p)),
    addedOriginAsns: current.originAsns.filter(
      (asn) => !previous.originAsns.includes(asn),
    ),
    removedOriginAsns: previous.originAsns.filter(
      (asn) => !current.originAsns.includes(asn),
    ),
    coverageChanged: comparable.some((source) => {
      const old = previous.sources.find((s) => s.source === source),
        now = current.sources.find((s) => s.source === source);
      return (
        old.truncated !== now.truncated ||
        [...old.peers].sort().join("|") !== [...now.peers].sort().join("|")
      );
    }),
  };
}
function createBgpCollector({
  fetcher = (...args) => fetch(...args),
  budgetMs = 10000,
  clock = () => Date.now(),
} = {}) {
  const cache = new Map(),
    ipCache = new Map();
  let routeViewsQueue = Promise.resolve(),
    lastRouteViewsAt = 0;
  async function json(url, signal) {
    const response = await fetcher(url, {
      signal,
      redirect: "error",
      headers: {
        accept: "application/json",
        "user-agent": "Aster-Network-Observatory/BGP",
      },
    });
    if (!response.ok) throw new Error("公开 BGP 服务 HTTP " + response.status);
    const raw = await response.text();
    if (raw.length > 2 * 1024 * 1024) throw new Error("BGP 响应超过容量");
    const payload = JSON.parse(raw);
    if (payload.status && payload.status !== "ok")
      throw new Error("公开 BGP 服务未返回有效数据");
    return payload;
  }
  async function collect(ip) {
    if (!originQuery(ip))
      return {
        kind: "bgp",
        state: "missing",
        diagnostic: "BGP 目标需为符合地址族的公网 IP，不查询私网或保留地址",
      };
    const oldIp = ipCache.get(ip),
      old = oldIp && cache.get(oldIp);
    if (old && old.until > clock())
      return { ...old.data, target: ip, cacheHit: true };
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), budgetMs),
      queriedAt = new Date(clock()).toISOString();
    try {
      const routeViewsRequest = routeViewsQueue.then(async () => {
        const wait = 1000 - (clock() - lastRouteViewsAt);
        if (wait > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000, wait)),
          );
        lastRouteViewsAt = clock();
        return json(
          RV + encodeURIComponent(ip) + "/" + (ip.includes(":") ? 128 : 32),
          controller.signal,
        );
      });
      routeViewsQueue = routeViewsRequest.then(
        () => {},
        () => {},
      );
      const [network, routeViews] = await Promise.allSettled([
        json(
          RIS + "network-info/data.json?resource=" + encodeURIComponent(ip),
          controller.signal,
        ),
        routeViewsRequest,
      ]);
      const networkPrefix =
          network.status === "fulfilled" ? network.value.data?.prefix : "",
        rv =
          routeViews.status === "fulfilled" && Array.isArray(routeViews.value)
            ? routeViews.value
            : [];
      const prefixes = [
        ...new Set(
          [networkPrefix, ...rv.map((r) => r.prefix)].filter((p) =>
            contains(ip, p),
          ),
        ),
      ].sort((a, b) => Number(b.split("/")[1]) - Number(a.split("/")[1]));
      const prefix = prefixes[0];
      if (!prefix)
        return {
          kind: "bgp",
          state:
            network.status === "fulfilled" || routeViews.status === "fulfilled"
              ? "missing"
              : "failed",
          diagnostic:
            "未取得此 IP 的已宣告前缀；公开数据源暂不可用或当前没有路由记录",
        };
      const cached = cache.get(prefix);
      if (cached && cached.until > clock()) {
        ipCache.set(ip, prefix);
        return { ...cached.data, target: ip, cacheHit: true };
      }
      const sources = [],
        paths = [];
      let ris;
      try {
        ris = normalizeRis(
          await json(
            RIS + "bgp-state/data.json?resource=" + encodeURIComponent(prefix),
            controller.signal,
          ),
          prefix,
        );
      } catch (e) {
        ris = {
          paths: [],
          coverage: {
            source: "RIPE RIS",
            state: "failed",
            url: RIS + "bgp-state/data.json",
            dataTime: null,
            returnedPaths: 0,
            retainedPaths: 0,
            truncated: false,
            collectors: [],
            peers: [],
            diagnostic: String(e.message || e),
          },
        };
      }
      paths.push(...ris.paths);
      sources.push(ris.coverage);
      if (routeViews.status === "fulfilled") {
        const parsed = normalizeRouteViews(rv, prefix);
        paths.push(...parsed.paths);
        sources.push(parsed.coverage);
      } else
        sources.push({
          source: "RouteViews",
          state: "failed",
          url: "https://api.routeviews.org/docs/",
          dataTime: null,
          returnedPaths: 0,
          retainedPaths: 0,
          truncated: false,
          collectors: [],
          peers: [],
          diagnostic: String(routeViews.reason?.message || routeViews.reason),
        });
      const originAsns = origins(paths);
      if (
        !originAsns.length &&
        networkPrefix === prefix &&
        network.status === "fulfilled"
      )
        originAsns.push(
          ...(network.value.data?.asns || [])
            .map(token)
            .filter((s) => /^\d+$/.test(s)),
        );
      const rpki = await Promise.all(
        originAsns.slice(0, 8).map(async (asn) => {
          try {
            const response = await json(
              RIS +
                "rpki-validation/data.json?resource=" +
                asn +
                "&prefix=" +
                encodeURIComponent(prefix),
              controller.signal,
            );
            return {
              asn,
              prefix,
              state: rpkiStatus(response.data?.status),
              validator: String(response.data?.validator || "RIPEstat"),
              queriedAt,
              roas: (response.data?.validating_roas || []).slice(0, 20),
            };
          } catch (e) {
            return {
              asn,
              prefix,
              state: "unavailable",
              validator: "RIPEstat",
              queriedAt,
              roas: [],
              diagnostic: String(e.message || e),
            };
          }
        }),
      );
      const snapshot = {
        kind: "bgp",
        state:
          paths.length &&
          sources.every((s) => s.state === "ok" && !s.truncated) &&
          originAsns.length <= 8 &&
          rpki.every((r) => r.state !== "unavailable")
            ? "ok"
            : paths.length
              ? "partial"
              : "failed",
        target: ip,
        prefix,
        coveringPrefixes: prefixes.slice(1),
        originAsns,
        queriedAt,
        sources,
        paths,
        graph: topology(paths),
        rpki,
        rpkiCoverage: { expected: originAsns.length, queried: rpki.length },
        diagnostic: paths.length
          ? "BGP 控制平面观测；AS 相邻不证明付费上游、物理直连或完整全球覆盖"
          : "取得前缀，但没有可用的 AS_PATH",
        cacheHit: false,
      };
      cache.set(prefix, { until: clock() + 55 * 60000, data: snapshot });
      ipCache.set(ip, prefix);
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      if (ipCache.size > 2000) ipCache.delete(ipCache.keys().next().value);
      return snapshot;
    } finally {
      clearTimeout(timer);
    }
  }
  return { collect };
}
module.exports = {
  createBgpCollector,
  contains,
  asPath,
  topology,
  normalizeRis,
  normalizeRouteViews,
  rpkiStatus,
  changes,
};
