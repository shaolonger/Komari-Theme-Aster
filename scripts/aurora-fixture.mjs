// Reference values live only in the browser fixture, never in the product.
export const auroraNames = [
  "电信",
  "联通",
  "移动",
  "电信 IPv6",
  "联通 IPv6",
  "移动 IPv6",
];
const latency = [185, 166, 235, 160, 193, 235];
const loss = [0.7, 0, 15.3, 1.7, 2, 2.3];
const crystalLatency = [155.86, 190.74, 198.44, 160.09, 193.68, 235.06];
const crystalLoss = [6.9, 5.2, 3.4, 1.7, 2, 2.3];
const quotaBytes = 2.93 * 1024 ** 4;
export function auroraNodes(size = 1, crystal = false) {
  return Array.from({ length: size }, (_, i) => ({
    uuid: `node-${i}`,
    name: i ? `Aurora Node ${i}` : crystal ? "PPFlight-Global" : "PPFlight LAX Global S2",
    group: "PPFlight",
    region: crystal ? "US · 洛杉矶" : "US",
    hidden: false,
    cpu_name: "AMD EPYC",
    cpu_cores: 1,
    mem_total: 1024 ** 3,
    disk_total: 20 * 1024 ** 3,
    weight: i,
    os: "Debian GNU/Linux 12",
    arch: "amd64",
    virtualization: "kvm",
    version: "1.5.11",
    provider: "PPFlight",
    business_role: "落地",
    price: 4.4,
    billing_cycle: "monthly",
    auto_renewal: true,
    currency: "$",
    expired_at: new Date(Date.now() + 25.5 * 86400000).toISOString(),
    tags: "落地<gray>;BGP直连;1000M;PPFlight",
    public_remark: "洛杉矶",
    traffic_limit: quotaBytes,
    traffic_limit_type: "max",
    ipv4: `192.0.2.${i + 1}`,
    ipv6: `2001:db8::${i + 1}`,
  }));
}
export function auroraStatus(quotaFraction, crystal = false) {
  return {
    online: true,
    cpu: 5,
    ram: 360 * 1024 ** 2,
    ram_total: 1024 ** 3,
    swap: 0,
    swap_total: 0,
    disk: 2.58 * 1024 ** 3,
    disk_total: 20 * 1024 ** 3,
    load: 0.45,
    load5: 0.32,
    load15: 0.28,
    net_in: 1.98 * 1024,
    net_out: 2.32 * 1024,
    net_total_up: 11.5 * 1024 ** 3,
    net_total_down: quotaFraction == null ? 20.8 * 1024 ** 3 : Math.round(quotaBytes * quotaFraction),
    connections: 1057,
    connections_udp: 8,
    uptime: 4 * 86400,
    process: 24,
    time: Math.floor(Date.now() / 1000),
    ...(crystal && {
      cpu: 8.3, ram: Math.round(.309 * 1024 ** 3), disk: .232 * 20 * 1024 ** 3,
      load: .02, net_in: 1.96 * 1024, uptime: 46 * 3600,
    }),
  };
}
export function auroraStats(entityIds, crystal = false) {
  const losses = crystal ? crystalLoss : loss;
  return {
    stats: entityIds.flatMap((uuid) =>
      (crystal ? crystalLatency : latency).map((value, i) => ({
        entity_id: uuid,
        task_id: String(i + 1),
        name: auroraNames[i],
        type: "icmp",
        interval: 60,
        total: 1000,
        valid: 1000 - Math.round(losses[i] * 10),
        loss: losses[i],
        loss_approximate: false,
        min: value - 10,
        max: value + 10,
        avg: value,
        latest: value,
        p99_p50_ratio: 1.2,
      })),
    ),
    count: entityIds.length * 6,
  };
}
export function auroraSeries(series, pointCount = 16, crystal = false) {
  const now = Date.now();
  const crystalSamples = [
    [156, 158, 160, 160, 152, 90, 95, 250, 100],
    [175, 182, 160, 190, 185, 229, 231, 242, 130],
    [190, 171, 232, 239, 241, 170, 230, 130, 100],
    [161, 157, 160, 190, 185, 90, 130, 250, 210],
    [181, 180, 188, 192, 196, 200, 199, 222, 232],
    [241, 239, 243, 259, 250, 225, 242, 176, 100],
  ];
  const crystalLossSamples = [
    [0, 0, 0, 0, 1, 4, 4, 0, 0],
    [0, 0, 0, 0, 4, 4, 4, 0, 0],
    [0, 0, 0, 0, 0, 0, 12, 4, 0],
    [0, 0, 0, 0, 4, 4, 4, 0, 0],
    [0, 0, 0, 0, 4, 4, 4, 0, 0],
    [0, 0, 0, 0, 0, 0, 4, 0, 0],
  ];
  return series.flatMap((s) =>
    s.metric_key.startsWith("ping.")
      ? latency.map((v, i) => ({
          ...s,
          tags: { task_id: String(i + 1) },
          points: Array.from({ length: pointCount }, (_, n) => ({
            time: new Date(now - (pointCount - 1 - n) * 60000).toISOString(),
            value: crystal && n >= pointCount - 9
              ? s.metric_key === "ping.latency_ms"
                ? crystalSamples[i][n - pointCount + 9]
                : crystalLossSamples[i][n - pointCount + 9] / 100
              : s.metric_key === "ping.latency_ms"
                ? n < 7
                  ? v + n * 4
                  : 65 + n * 2
                : i === 2 && n > 7
                  ? 0.18
                  : 0,
            count: 100,
            tags: { task_id: String(i + 1) },
          })),
        }))
      : [s],
  );
}
const carriers = ["电信", "联通", "移动"];
export function auroraRoutes(crystal = false, regional = false) {
  const evidence = (label) => ({
    label,
    displayLabel: label,
    networkLabels: [label],
    pathKind: "single",
    asns: [],
    at: new Date().toISOString(),
    reportId: "aurora-routes",
    diagnostic: "",
    samples: 1,
    confirmed: 1,
    observed: 1,
    variants: 1,
    observations: [],
    state: "ok",
  });
  const values = {
    4: [
      ["163", "163"],
      ["4837", "4837"],
      ["CMI", crystal ? "CMIN2" : "CMI"],
    ],
    6: [
      crystal ? ["163", "4837"] : ["CTGNet", "CN2"],
      crystal ? ["4837", "4837"] : ["10099", "9929"],
      ["CMI", "CMIN2"],
    ],
  };
  const cityEvidence = (label, asn, city, registryLabels = []) => {
    const row = evidence(label);
    const asPath = registryLabels.length ? [asn, "?", asn] : [asn];
    return { ...row, asns: [asn], registryLabels, observations: [
      { label, at: row.at, city, provider: "NextTrace", protocol: "tcp", asPath, registryLabels, state: "ok" },
    ] };
  };
  return {
    available: true,
    quickCheck: true,
    quickFamilies: { "node-0": ["4", "6"] },
    access: "admin",
    published: [],
    display: true,
    labelMode: "preferred",
    showDetails: false,
    nodes: {
      "node-0": Object.fromEntries(
        ["4", "6"].map((f) => [
          f,
          carriers.map((carrier, i) => ({
            carrier,
            forward: evidence(values[f][i][0]),
            return: evidence(values[f][i][1]),
            ...(regional && f === "4" && i === 0 ? { cities: {
              北京: { forward: cityEvidence("163", "4134", "北京"), return: cityEvidence("163", "4134", "北京") },
              上海: { forward: cityEvidence("CTGNet", "23764", "上海"), return: cityEvidence("CN2", "4809", "上海") },
              广州: { forward: null, return: cityEvidence("163", "4134", "广州", ["CN2-BB"]) },
            } } : {}),
          })),
        ]),
      ),
    },
  };
}
export function auroraSpeeds(crystal = false, crystalControls = false) {
  const download = crystal ? { 4: [59.8, .2, 273.2], 6: [46.7, 46.7, 195.7] } : { 4: [921.6, 886.3, 905.8], 6: [908.4, 872.1, 916.7] };
  const upload = crystal ? { 4: [107.7, 75.1, 447.3], 6: [15.7, 14, 400.4] } : { 4: [168.2, 152.7, 176.4], 6: [162.6, 148.5, 181.2] };
  const value = (v) => ({
    bitsPerSecond: v * 1e6,
    state: "ok",
    basis: "receiver",
  });
  return {
    available: true,
    quickCheck: true,
    quickFamilies: { "node-0": ["4", "6"] },
    access: "admin",
    published: [],
    display: true,
    nodes: {
      "node-0": Object.fromEntries(
        ["4", "6"].map((f) => [
          f,
          {
            reportId: "aurora-speed-" + f,
            plannedAt: new Date().toISOString(),
            at: new Date().toISOString(),
            family: f,
            state: "ok",
            stale: false,
            cities: (crystal && !crystalControls ? ["北京"] : ["北京", "上海", "广州"]).map((city, c) => ({
              city,
              rows: carriers.map((carrier, i) => ({
                carrier,
                at: new Date().toISOString(),
                provider: carrier,
                download: value(Math.max(0, download[f][i] - c * 100)),
                upload: value(Math.max(0, upload[f][i] - c * 10)),
              })),
            })),
          },
        ]),
      ),
    },
  };
}
