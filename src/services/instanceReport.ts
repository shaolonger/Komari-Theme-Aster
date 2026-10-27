import { getKomariBackendProfile } from "./backendProfile";
import { getRpc2Client, RpcResponseError } from "./rpc2Client";
import { queryOfficialMetrics } from "./officialKomariAdapter";
import {
  METRIC_FIELDS,
  timestamp,
  validateReportRange,
  throwIfReportAborted,
} from "@/utils/instanceReport/model";
import type {
  NetworkEvidence,
  ReportInput,
  ReportMetric,
  ReportNode,
  ReportPing,
  ReportRange,
  ReportSource,
} from "@/utils/instanceReport/model";
import { projectEvidence, redactReport } from "@/utils/instanceReport/privacy";
import { overlayAdminClientMeta } from "@/utils/nodeMetaOverlay";
import { AdminClientSchema } from "@/types/komari";
import type {
  NodeInfo,
  NodeMetrics,
  PingRecord,
  PingTask,
} from "@/types/komari";

const POINT_LIMIT = 20000;
const INPUT_LIMIT = 128 * 1024 * 1024;
type Obj = Record<string, unknown>;
const object = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const array = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(object) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const metricValue = (v: unknown, unit: string) =>
  unit === "°C" && typeof v === "number" && Number.isFinite(v) ? v : num(v);
const check = throwIfReportAborted;
class ReportHttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}
function sourceError(id: string, name: string, error: unknown): ReportSource {
  const status =
    error instanceof ReportHttpError
      ? error.status
      : error instanceof RpcResponseError &&
          /unauthori[sz]ed|forbidden|permission|权限/i.test(error.message)
        ? 403
        : 0;
  return {
    id,
    name,
    state:
      status === 401 || status === 403
        ? "forbidden"
        : status === 404 || status === 405
          ? "unavailable"
          : "failed",
    detail:
      status === 401 || status === 403
        ? "当前用户无权限读取。"
        : status === 404 || status === 405
          ? "未安装此版本的网络观测接口。"
          : "查询失败，未使用其他日期或补零替代。可重新生成报告重试。",
  };
}

async function readJson(path: string, signal: AbortSignal): Promise<unknown> {
  check(signal);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException("读取报告数据超时", "TimeoutError")),
    30000,
  );
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new ReportHttpError(response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("响应缺少正文");
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("单次响应超过 16 MiB，请缩小范围");
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

// The fork can truncate a single getRecords response. Split only windows that
// actually hit its limit, retaining half-open boundaries and a bounded budget.
async function forkHistory(uuid: string, type: "load" | "ping", range: ReportRange, signal: AbortSignal) {
  // The fork collapses the recent four hours to 15-minute points when a
  // query also includes long-term rows. Read that tail separately.
  const tail = Date.now() - 4 * 3600000, windows: { start: number; end: number }[] = [];
  let cursor = range.end, span = 7 * 86400000, segments = 0;
  while (cursor > range.start) {
    let start = Math.max(range.start, cursor - span);
    if (type === "load" && start < tail && tail < cursor) start = tail;
    windows.push({ start, end: cursor }); cursor = start;
    // Bound recent database reads to a week, then widen empty/older windows.
    if (++segments >= 53) span *= 2;
  }
  windows.reverse(); // pop the newest window first when the input budget is reached
  const records: Obj[] = [], tasks = new Map<number, Obj>();
  let requests = 0, limited = false;
  while (windows.length) {
    check(signal);
    const window = windows.pop()!;
    const raw = object(await getRpc2Client().call("common:getRecords", {
      uuid, type, start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString(),
      maxCount: POINT_LIMIT,
    }, { signal }));
    requests++;
    if (!Array.isArray(raw.records) && !(uuid in object(raw.records))) throw new Error("历史响应缺少节点记录");
    const rows = Array.isArray(raw.records) ? array(raw.records) : array(object(raw.records)[uuid]);
    for (const task of array(raw.tasks)) if (typeof task.id === "number") tasks.set(task.id, task);
    const truncated = rows.length >= POINT_LIMIT || (num(raw.count) ?? 0) > rows.length;
    const middle = Math.floor((window.start + window.end) / 2);
    if (truncated && requests + windows.length + 2 <= 256 && middle > window.start && middle < window.end) {
      windows.push({ start: window.start, end: middle }, { start: middle, end: window.end });
    } else {
      if (truncated) limited = true;
      const available = rows.filter(row => { const t = timestamp(row.time); return t >= window.start && t < window.end; });
      const remaining = Math.max(0, 150000 - records.length);
      if (available.length > remaining) limited = true;
      records.push(...(remaining ? available.slice(-remaining) : []));
      if (records.length >= 150000 && windows.length) { limited = true; break; }
    }
  }
  records.sort((a, b) => timestamp(a.time) - timestamp(b.time));
  return { records, tasks: [...tasks.values()], limited };
}

export function reportNode(meta: NodeInfo, current?: NodeMetrics): ReportNode {
  const show = (v: unknown) => (v == null || v === "" ? "未知" : String(v));
  return {
    uuid: meta.uuid,
    name: meta.name || meta.uuid,
    memory: meta.mem_total,
    swap: meta.swap_total,
    disk: meta.disk_total,
    cores: meta.cpu_cores,
    ip: [meta.ipv4, meta.ipv6].filter(Boolean),
    trafficLimit: meta.traffic_limit,
    trafficRule: meta.traffic_limit_type,
    fields: [
      ["厂商", show(meta.provider)],
      ["地区", show(meta.region)],
      ["分组", show(meta.group)],
      ["用途", show(meta.business_role)],
      ["CPU", show(meta.cpu_name)],
      ["核心", meta.cpu_cores > 0 ? String(meta.cpu_cores) : "未知"],
      ["架构", show(meta.arch)],
      ["虚拟化", show(meta.virtualization)],
      ["系统", show(meta.os)],
      ["GPU", show(meta.gpu_name)],
      ["节点 UUID", meta.uuid],
      ["接入时间", show(meta.created_at)],
      ["元数据更新", show(meta.updated_at)],
      ["内核", show(meta.kernel_version)],
      ["Agent", show(meta.version)],
      ["标签", show(meta.tags)],
      [
        "续费配置",
        meta.price > 0
          ? `${meta.currency || "币种未知"} ${meta.price} / ${meta.billing_cycle || "周期未知"}`
          : "未配置价格",
      ],
      ["到期", show(meta.expired_at)],
      ["自动续费", meta.auto_renewal ? "已开启" : "未开启"],
      [
        "Ping 能力",
        meta.capability_ping == null
          ? "未知"
          : meta.capability_ping
            ? "已启用"
            : "未启用",
      ],
      [
        "私有目标 Ping",
        meta.capability_private_ping_targets == null
          ? "未知"
          : meta.capability_private_ping_targets
            ? "已启用"
            : "未启用",
      ],
      ["公开备注", show(meta.public_remark)],
    ],
    snapshot: {
      online: current?.online ?? null,
      uptime: current?.uptime ?? null,
      updatedAt: current?.updatedAt ?? null,
    },
  };
}

export function forkMetrics(
  payload: unknown,
  uuid: string,
  range: ReportRange,
): ReportMetric[] {
  const data = object(payload),
    records = Array.isArray(data.records)
      ? array(data.records)
      : array(object(data.records)[uuid]);
  if (!Array.isArray(data.records) && !(uuid in object(data.records)))
    throw new Error("历史资源响应缺少节点记录");
  return METRIC_FIELDS.map(([key, label, unit]) => ({
    key,
    label,
    unit,
    precision: (key.startsWith("net_total")
      ? "计数器末值"
      : "返回点") as ReportMetric["precision"],
    points: records
      .filter((r) => !r.client || r.client === uuid)
      .map((r) => ({ t: timestamp(r.time), v: metricValue(r[key], unit) }))
      .filter((p) => p.t >= range.start && p.t < range.end),
  })).filter((m) => m.points.some((p) => p.v != null));
}

export async function collectMetrics(
  uuid: string,
  range: ReportRange,
  signal: AbortSignal,
): Promise<{ metrics: ReportMetric[]; source: ReportSource }> {
  const profile = await getKomariBackendProfile();
  check(signal);
  let metrics: ReportMetric[],
    limited = false;
  const unsupported: string[] = [];
  if (profile.kind === "official-v1.4") {
    const query = async (metricKeys: string[]): Promise<Awaited<ReturnType<typeof queryOfficialMetrics>>["series"]> => {
      try { return (await queryOfficialMetrics({
      metricKeys,
      uuids: [uuid],
      window: { start: new Date(range.start), end: new Date(range.end) },
      maxPoints: POINT_LIMIT,
      fillEmpty: true,
      aggregationByMetric: { "net.total.up": "last", "net.total.down": "last" },
      options: { signal },
      strictResponse: true,
      })).series; } catch (error) {
        check(signal);
        if (!(error instanceof RpcResponseError) || !/unknown metric key/i.test(error.message)) throw error;
        if (metricKeys.length === 1) { unsupported.push(metricKeys[0]!); return []; }
        const middle = Math.floor(metricKeys.length / 2);
        return [...await query(metricKeys.slice(0, middle)), ...await query(metricKeys.slice(middle))];
      }
    };
    const availableSeries = await query(METRIC_FIELDS.map((f) => f[3]).filter(Boolean));
    if (unsupported.length) limited = true;
    metrics = METRIC_FIELDS.flatMap(([key, label, unit, remoteKey]) => {
      const series = availableSeries.filter(
        (s) => s.entity_id === uuid && s.metric_key === remoteKey,
      );
      if (series.some((s) => s.downsampled !== true && s.points.length >= POINT_LIMIT)) limited = true;
      const grouped = new Map<string, ReportMetric>();
      for (const s of series)
        for (const p of s.points) {
          const t = timestamp(p.time);
          if (t < range.start || t >= range.end || !Number.isFinite(t))
            continue;
          const tags = { ...s.tags, ...p.tags },
            index = tags.device_index ?? "",
            name = tags.device_name ?? "";
          const device = index !== "" || name !== "";
          const metricKey = device ? `${key}[${index}|${name}]` : key;
          const m: ReportMetric = grouped.get(metricKey) ?? {
            key: metricKey,
            label:
              label +
              (device
                ? ` · GPU ${index || "?"}${name ? " · " + name : ""}`
                : ""),
            unit,
            precision: key.startsWith("net_total")
              ? "计数器末值"
              : s.downsampled === false
                ? "返回点"
                : "聚合桶均值",
            points: [],
            provenance: {
              metricKey: remoteKey,
              aggregation: key.startsWith("net_total") ? "last" : "avg",
              downsampled:
                typeof s.downsampled === "boolean" ? s.downsampled : null,
              intervalSeconds: num(s.interval_seconds),
              retentionDays: num(s.retention_days),
              deviceIndex: index,
              deviceName: name,
            },
          };
          const value = metricValue(p.value, unit);
          m.points.push({ t, v: value, n: p.count });
          grouped.set(metricKey, m);
        }
      return [...grouped.values()].filter((m) =>
        m.points.some((p) => p.v != null),
      );
    });
  } else {
    const history = await forkHistory(uuid, "load", range, signal);
    metrics = forkMetrics({ records: history.records }, uuid, range);
    limited = history.limited;
  }
  return {
    metrics,
    source: {
      id: "metrics",
      name: "资源与流量历史",
      state: limited ? "partial" : metrics.length ? "available" : "empty",
      detail: limited
        ? `部分指标未提供或返回点达到上限；可能截断，不保证完整历史。${unsupported.length ? `后端未提供：${unsupported.join("、")}。` : ""}`
        : metrics.length
          ? "严格查询所选 UTC 起止时间；统计基于返回点，采样间距估计覆盖，缺字段不补零。"
          : "所选日期没有可读取的资源历史。",
    },
  };
}

export function normalizeReportPings(
  records: PingRecord[],
  tasks: PingTask[],
  range: ReportRange,
): ReportPing[] {
  const byId = new Map<number, ReportPing>();
  for (const task of tasks)
    byId.set(task.id, {
      id: task.id,
      name: task.name || `历史任务 #${task.id}`,
      protocol: task.type,
      target: task.target || "",
      interval: task.interval,
      points: [],
    });
  const dedup = new Map<string, PingRecord>();
  for (const r of records) {
    const t = timestamp(r.time);
    if (t >= range.start && t < range.end) dedup.set(`${r.task_id}:${t}`, r);
  }
  for (const r of dedup.values()) {
    const task = byId.get(r.task_id) ?? {
      id: r.task_id,
      name: `历史任务 #${r.task_id}`,
      protocol: "未知",
      target: "",
      interval: 0,
      points: [],
    };
    const count = r.sample_count == null ? 1 : (num(r.sample_count) ?? 0);
    const explicitLost =
      num(r.loss_count) ??
      (r.loss_rate != null && r.loss_rate >= 0 && r.loss_rate <= 1
        ? Math.round(r.loss_rate * count)
        : null);
    const sent = count > 0 && (count === 1 || explicitLost != null) ? count : 0;
    const lost = sent
      ? Math.min(sent, explicitLost ?? (r.value < 0 ? sent : 0))
      : 0;
    task.points.push({
      t: timestamp(r.time),
      v: sent && sent === lost ? null : num(r.value),
      sent,
      lost,
      valid: sent - lost,
    });
    byId.set(r.task_id, task);
  }
  return [...byId.values()].map((p) => ({
    ...p,
    points: p.points.sort((a, b) => a.t - b.t),
  }));
}

export async function collectPings(
  uuid: string,
  range: ReportRange,
  signal: AbortSignal,
) {
  const profile = await getKomariBackendProfile();
  check(signal);
  let records: PingRecord[],
    tasks: PingTask[],
    limited = false;
  if (profile.kind === "official-v1.4") {
    const [rawTasks, response] = await Promise.all([
      getRpc2Client().call("public:getPublicPingTasks", {}, { signal }),
      queryOfficialMetrics({
        metricKeys: ["ping.latency_ms", "ping.loss"],
        uuids: [uuid],
        window: { start: new Date(range.start), end: new Date(range.end) },
        maxPoints: POINT_LIMIT,
        fillEmpty: false,
        options: { signal },
        strictResponse: true,
      }),
    ]);
    if (!Array.isArray(rawTasks)) throw new Error("Ping 任务目录响应无效");
    const buckets = new Map<
      string,
      {
        id: number;
        time: string | number;
        latency?: number | null;
        latencyCount: number;
        loss?: number | null;
        lossCount: number;
      }
    >();
    for (const series of response.series) {
      if (series.entity_id !== uuid) continue;
      if (series.points.length >= POINT_LIMIT) limited = true;
      for (const p of series.points) {
        const id = Number(p.tags.task_id || series.tags.task_id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        const key = `${id}:${timestamp(p.time)}`,
          bucket = buckets.get(key) ?? {
            id,
            time: p.time,
            latencyCount: 0,
            lossCount: 0,
          };
        if (series.metric_key === "ping.latency_ms") {
          bucket.latency = p.value;
          bucket.latencyCount = p.count;
        }
        if (series.metric_key === "ping.loss") {
          bucket.loss = p.value;
          bucket.lossCount = p.count;
        }
        buckets.set(key, bucket);
      }
    }
    records = [];
    for (const b of buckets.values()) {
      let sent = b.lossCount,
        lost: number,
        latency: number | null = null;
      if (sent > 0 && b.loss != null && b.loss >= 0 && b.loss <= 1)
        lost = Math.round(b.loss * sent);
      else if (b.latencyCount === 1 && b.latency != null) {
        sent = 1;
        lost = b.latency < 0 ? 1 : 0;
      } else {
        limited = true;
        continue;
      }
      const valid = sent - lost;
      if (b.latency != null && b.latencyCount === sent && valid > 0)
        latency = (b.latency * sent + lost) / valid;
      else if (valid > 0) limited = true;
      records.push({
        task_id: b.id,
        time: b.time,
        value: latency != null && latency >= 0 ? latency : -1,
        sample_count: sent,
        loss_count: lost,
        client: uuid,
      });
    }
    const observed = new Set(records.map((r) => r.task_id));
    tasks = array(rawTasks)
      .filter(
        (t) =>
          typeof t.id === "number" &&
          (observed.has(t.id) ||
            (Array.isArray(t.clients) && t.clients.includes(uuid))),
      )
      .map((t) => ({
        id: Number(t.id),
        name: str(t.name),
        type: str(t.type) || "未知",
        interval: num(t.interval) ?? 0,
        target: "",
      })) as PingTask[];
  } else {
    const data = await forkHistory(uuid, "ping", range, signal);
    records = data.records
      .filter((r) => !r.client || r.client === uuid)
      .filter(
        (r) => typeof r.task_id === "number" && typeof r.value === "number",
      ) as unknown as PingRecord[];
    tasks = data.tasks
      .filter((t) => typeof t.id === "number")
      .map((t) => ({
        id: Number(t.id),
        name: str(t.name),
        type: str(t.type) || "未知",
        interval: num(t.interval) ?? 0,
        target: str(t.target),
      })) as PingTask[];
    limited = data.limited;
  }
  const pings = normalizeReportPings(records, tasks, range),
    any = pings.some((p) => p.points.length);
  if (pings.some((p) => p.points.some((point) => point.sent === 0)))
    limited = true;
  return {
    pings,
    source: {
      id: "ping",
      name: "Ping 历史",
      state: limited ? "partial" : any ? "available" : "empty",
      detail: limited
        ? "返回点达到上限，或桶的时延/丢包权重不匹配；无法恢复的成功时延不参与均值，不补零。"
        : "仅使用所选日期内的返回样本；成功时延按成功探测次数加权，失败探测另计。没有记录不表示 0% 丢包。",
    } satisfies ReportSource,
  };
}

async function networkV3(uuid: string, range: ReportRange, signal: AbortSignal) {
  const base = `/api/aster-network-observatory/v3`, nodePath = `${base}/nodes/${encodeURIComponent(uuid)}`;
  const caps = object(await readJson(`${base}/capabilities`, signal));
  if (!Array.isArray(caps.modules) || caps.schema !== 3) throw new Error("网络报告能力响应无效");
  const evidence: NetworkEvidence[] = [], warnings: string[] = [];
  const targetRefs = new Map<string, string>();
  const targetCounts = new Map<string, number>();
  const targetRef = (module: string, source: Obj, target: unknown, family: string, direction: unknown, protocol: unknown) => {
    const key = JSON.stringify([module, source.id || target || "", family, direction, protocol]);
    if (!targetRefs.has(key)) { const count = (targetCounts.get(module) || 0) + 1; targetCounts.set(module, count); targetRefs.set(key, `测点 ${count}`); }
    return targetRefs.get(key)!;
  };
  let partial = false, bytes = 0, unavailableRounds = 0, summaryApi: boolean | undefined;
  const append = (entry: NetworkEvidence) => {
    bytes += JSON.stringify(entry).length * 2;
    evidence.push(entry);
  };
  for (const module of caps.modules.filter((m): m is string => typeof m === "string")) {
    try {
      let cursor = "", pages = 0;
      const seen = new Set<string>();
      do {
        check(signal);
        if (seen.has(cursor) || pages++ >= 10000) { partial = true; warnings.push(`${module} 分页未正常结束。`); break; }
        seen.add(cursor);
        const suffix = `?module=${encodeURIComponent(module)}&limit=20&cursor=${encodeURIComponent(cursor)}`;
        let page: Obj;
        if (summaryApi !== false) {
          try { page = object(await readJson(`${nodePath}/history-summary${suffix}`, signal)); summaryApi = true; }
          catch (error) {
            if (!(error instanceof ReportHttpError) || ![404, 405].includes(error.status)) throw error;
            summaryApi = false;
            page = object(await readJson(`${nodePath}/rounds${suffix}`, signal));
          }
        } else page = object(await readJson(`${nodePath}/rounds${suffix}`, signal));
        if (!Array.isArray(page.rounds)) throw new Error("网络轮次分页响应无效");
        for (const round of array(page.rounds)) {
          const start = timestamp(round.startedAt || round.plannedAt || round.completedAt), end = timestamp(round.completedAt);
          if (!(start < range.end) || (Number.isFinite(end) && end < range.start)) continue;
          if (evidence.length >= 100000 || bytes > INPUT_LIMIT / 2) { partial = true; break; }
          let expired = round.detailAvailable === false;
          let full: Obj;
          try {
            if (expired && Array.isArray(round.slots)) full = round;
            else full = object(await readJson(`${nodePath}/rounds/${encodeURIComponent(str(round.id))}`, signal));
            expired = expired || full.detailAvailable === false;
            if (!Array.isArray(full.slots) || (!expired && !Array.isArray(full.measurements))) throw new Error("网络轮次明细响应无效");
          } catch (error) {
            check(signal); partial = true; unavailableRounds++;
            if (Number.isFinite(end) && end >= range.start && end < range.end)
              append({ id: `v3:${str(round.id)}`, module, time: end, state: str(round.state), target: "", direction: "", source: "轮次明细不可用", summaryOnly: true,
                family: str(round.family), detail: projectEvidence({ counts: round.counts, detailAvailable: false }) });
            continue;
          }
          const measurements = array(full.measurements), matched = new Set(measurements.map(m => str(m.slotId)));
          const family = str(object(full.parameters).family) || str(round.family);
          for (const measurement of measurements) {
            if (measurement.nodeUuid && measurement.nodeUuid !== uuid) { partial = true; continue; }
            const t = timestamp(measurement.completedAt), started = timestamp(measurement.startedAt);
            if (!Number.isFinite(t) || t < range.start || t >= range.end) continue;
            const source = object(measurement.source), options = object(measurement.options);
            append({ id: `v3:${str(round.id)}:${str(measurement.id)}`, module, time: t,
              startedAt: Number.isFinite(started) ? started : undefined, state: str(object(measurement.data).state),
              target: str(measurement.target), direction: str(measurement.direction),
              source: [source.provider, source.name, source.city, source.carrier].filter(v => typeof v === "string").join(" · "),
              family: str(options.family) || family, city: str(source.city), carrier: str(source.carrier),
              provider: str(source.provider), protocol: str(options.protocol), targetRef: targetRef(module, source, measurement.target, str(options.family) || family, measurement.direction, options.protocol),
              detail: projectEvidence({ ...object(measurement.data), protocol: options.protocol, family: str(options.family) || family }) });
          }
          if (expired) partial = true;
          for (const slot of array(full.slots)) {
            if (matched.has(str(slot.id))) continue;
            const slotTime = timestamp(slot.completedAt), t = Number.isFinite(slotTime) ? slotTime : end;
            if (!Number.isFinite(t) || t < range.start || t >= range.end) continue;
            const source = object(slot.source), options = object(slot.options), saved = object(slot.metrics);
            append({ id: `v3:${str(round.id)}:slot:${str(slot.id)}`, module, time: t,
              state: str(slot.state), target: str(slot.target), direction: str(slot.direction),
              source: [source.provider, source.name, source.city, source.carrier].filter(v => typeof v === "string").join(" · ") || "未完成的检测项",
              family, city: str(source.city), carrier: str(source.carrier), provider: str(source.provider), protocol: str(options.protocol), targetRef: targetRef(module, source, slot.target, family, slot.direction, options.protocol),
              summaryOnly: expired, detail: projectEvidence({ ...saved, state: slot.state, family, protocol: options.protocol, detailAvailable: !expired }) });
          }
          if (expired && !array(full.slots).length && Number.isFinite(end) && end >= range.start && end < range.end)
            append({ id: `v3:${str(round.id)}`, module, time: end, state: str(round.state), target: "", direction: "", source: "网络报告 v3", summaryOnly: true,
              family, detail: projectEvidence({ counts: round.counts, detailAvailable: false }) });
        }
        cursor = str(page.nextCursor);
        if (evidence.length >= 100000 || bytes > INPUT_LIMIT / 2) { partial = true; warnings.push("网络观测超过单份报告预算，已保留先读取的记录。"); break; }
      } while (cursor);
    } catch (error) {
      check(signal); partial = true;
      warnings.push(`${module} 查询失败${error instanceof ReportHttpError ? `（HTTP ${error.status}）` : ""}，其余模块已保留。`);
    }
  }
  if (unavailableRounds) warnings.push(`${unavailableRounds} 个轮次明细不可用，保留可读取的轮次摘要。`);
  const retention = object(caps.retention);
  return { evidence, source: { id: "network-v3", name: "网络报告 v3", state: partial ? "partial" : evidence.length ? "available" : "empty",
    detail: `只汇总既有测量；明细保留 ${num(retention.detailDays) ?? "未知"} 天，摘要 ${num(retention.summaryDays) ?? "未知"} 天。${partial ? "存在明细过期、查询失败或预算限制，不能保证全部证据完整。" : "已完成所有模块分页。"}${warnings.join(" ")}` } satisfies ReportSource };
}

export interface ReportRequest {
  meta: NodeInfo;
  current?: NodeMetrics;
  range: ReportRange;
  theme: "light" | "dark";
  showAddresses: boolean;
  compare: boolean;
  loggedIn: boolean;
}
export async function collectReportInput(
  request: ReportRequest,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<ReportInput> {
  const now = Date.now();
  validateReportRange(request.range, now);
  check(signal);
  const range = { ...request.range },
    sources: ReportSource[] = [];
  let meta = { ...request.meta },
    metrics: ReportMetric[] = [],
    pings: ReportPing[] = [],
    network: NetworkEvidence[] = [],
    backend = "未识别";
  progress("正在识别后端与冻结节点资料…");
  try {
    backend = (await getKomariBackendProfile()).kind;
  } catch {
    check(signal);
  }
  if (request.loggedIn) {
    try {
      const response = await readJson("/api/admin/client/list", signal),
        clients = array(object(response).data ?? response);
      const parsed = AdminClientSchema.safeParse(
        clients.find((c) => c.uuid === meta.uuid),
      );
      if (!parsed.success) throw new Error("管理端节点资料不可用");
      meta = overlayAdminClientMeta(meta, parsed.data);
    } catch (error) {
      check(signal);
      sources.push({
        ...sourceError("admin-meta", "管理端补充资料", error),
        detail: "管理端补充资料不可用，沿用当前已授权的节点元数据。",
      });
    }
  }
  const node = reportNode(meta, request.current);
  // Three independent collectors at a time; network GETs are sequential and bounded.
  await Promise.all([
    (async () => {
      try {
        const r = await collectMetrics(meta.uuid, range, signal);
        metrics = r.metrics;
        sources.push(r.source);
      } catch (e) {
        check(signal);
        sources.push(sourceError("metrics", "资源与流量历史", e));
      }
      progress("资源与流量收集完成，正在整理其他数据…");
    })(),
    (async () => {
      try {
        const r = await collectPings(meta.uuid, range, signal);
        pings = r.pings;
        sources.push(r.source);
      } catch (e) {
        check(signal);
        sources.push(sourceError("ping", "Ping 历史", e));
      }
    })(),
    (async () => {
      progress("正在读取网络观测的既有轮次…");
      try {
        const r = await networkV3(meta.uuid, range, signal);
        network.push(...r.evidence); sources.push(r.source);
      } catch (e) {
        check(signal); sources.push(sourceError("network-v3", "网络观测", e));
      }
    })(),
  ]);
  check(signal);
  if (range.allHistory) {
    let earliest = range.end;
    for (const metric of metrics) for (const point of metric.points) if (point.v != null && Number.isFinite(point.t)) earliest = Math.min(earliest, point.t);
    for (const ping of pings) for (const point of ping.points) if (point.sent > 0 && Number.isFinite(point.t)) earliest = Math.min(earliest, point.t);
    for (const item of network) if (Number.isFinite(item.time)) earliest = Math.min(earliest, item.time);
    if (earliest < range.end) {
      // First pass covers the Unix epoch onward. Tighten only the display and
      // repeat official rollups, so a 50-year empty prefix cannot turn a month
      // of available data into coarse daily buckets.
      range.start = Math.max(0, Math.floor(earliest / 86400000) * 86400000 - 86400000);
      if (backend === "official-v1.4" && range.start > 0) {
        progress("正在按最早可用数据提高历史曲线精度…");
        const refined = await Promise.allSettled([collectMetrics(meta.uuid, range, signal), collectPings(meta.uuid, range, signal)]);
        check(signal);
        if (refined[0].status === "fulfilled") { metrics = refined[0].value.metrics; const i = sources.findIndex(s => s.id === "metrics"); if (i >= 0) sources[i] = refined[0].value.source; }
        if (refined[1].status === "fulfilled") { pings = refined[1].value.pings; const i = sources.findIndex(s => s.id === "ping"); if (i >= 0) sources[i] = refined[1].value.source; }
      }
    }
    sources.push({ id: "all-history", name: "全部历史范围", state: "available", detail: "已从 1970 年起查询；图表从最早可读取数据附近开始。已过期、被删除或无权限的数据无法恢复。" });
  }
  const reportId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `rpt-${now.toString(36)}-${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const input: ReportInput = {
    schemaVersion: 1,
    reportId,
    generatedAt: now,
    range,
    theme: request.theme,
    showAddresses: request.showAddresses,
    backend,
    node,
    sources,
    metrics,
    pings,
    network: [...new Map(network.map((n) => [n.id, n])).values()].sort(
      (a, b) => b.time - a.time,
    ),
  };
  if (request.compare) {
    progress("正在读取前一等长区间…");
    const previousRange = {
      ...range,
      end: range.start,
      start: range.start - (range.end - range.start),
    };
    const [m, p] = await Promise.allSettled([
      collectMetrics(meta.uuid, previousRange, signal),
      collectPings(meta.uuid, previousRange, signal),
    ]);
    check(signal);
    input.previous = {
      range: previousRange,
      metrics: m.status === "fulfilled" ? m.value.metrics : [],
      pings: p.status === "fulfilled" ? p.value.pings : [],
      sources: [
        m.status === "fulfilled"
          ? m.value.source
          : sourceError("metrics", "上一期间资源", m.reason),
        p.status === "fulfilled"
          ? p.value.source
          : sourceError("ping", "上一期间 Ping", p.reason),
      ],
    };
  }
  const size = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (size > INPUT_LIMIT)
    throw new Error("报告输入超过 128 MiB，请缩小日期范围后重试。");
  progress("正在计算统计、数据覆盖与报告结论…");
  return redactReport(input);
}
