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
export function auroraNodes(size = 1) {
  return Array.from({ length: size }, (_, i) => ({
    uuid: `node-${i}`,
    name: i ? `Aurora Node ${i}` : "PPFlight LAX Global S2",
    group: "PPFlight",
    region: "US",
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
    traffic_limit: 2.93 * 1024 ** 4,
    traffic_limit_type: "max",
    ipv4: `192.0.2.${i + 1}`,
    ipv6: `2001:db8::${i + 1}`,
  }));
}
export function auroraStatus() {
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
    net_total_down: 20.8 * 1024 ** 3,
    connections: 1057,
    connections_udp: 8,
    uptime: 4 * 86400,
    process: 24,
    time: Math.floor(Date.now() / 1000),
  };
}
export function auroraStats(entityIds) {
  return {
    stats: entityIds.flatMap((uuid) =>
      latency.map((value, i) => ({
        entity_id: uuid,
        task_id: String(i + 1),
        name: auroraNames[i],
        type: "icmp",
        interval: 60,
        total: 1000,
        valid: 1000 - Math.round(loss[i] * 10),
        loss: loss[i],
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
export function auroraSeries(series) {
  const now = Date.now();
  return series.flatMap((s) =>
    s.metric_key.startsWith("ping.")
      ? latency.map((v, i) => ({
          ...s,
          tags: { task_id: String(i + 1) },
          points: Array.from({ length: 16 }, (_, n) => ({
            time: new Date(now - (15 - n) * 60000).toISOString(),
            value:
              s.metric_key === "ping.latency_ms"
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
export function auroraRoutes() {
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
      ["CMI", "CMI"],
    ],
    6: [
      ["CTGNet", "CN2"],
      ["10099", "9929"],
      ["CMI", "CMIN2"],
    ],
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
          })),
        ]),
      ),
    },
  };
}
export function auroraSpeeds() {
  const download = { 4: [921.6, 886.3, 905.8], 6: [908.4, 872.1, 916.7] },
    upload = { 4: [168.2, 152.7, 176.4], 6: [162.6, 148.5, 181.2] };
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
            cities: ["北京", "上海", "广州"].map((city, c) => ({
              city,
              rows: carriers.map((carrier, i) => ({
                carrier,
                at: new Date().toISOString(),
                provider: carrier,
                download: value(download[f][i] - c * 100),
                upload: value(upload[f][i] - c * 10),
              })),
            })),
          },
        ]),
      ),
    },
  };
}
