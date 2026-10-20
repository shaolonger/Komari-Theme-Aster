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
const INPUT_LIMIT = 32 * 1024 * 1024;
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
      if (size > INPUT_LIMIT / 2) {
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
  if (profile.kind === "official-v1.4") {
    const response = await queryOfficialMetrics({
      metricKeys: METRIC_FIELDS.map((f) => f[3]).filter(Boolean),
      uuids: [uuid],
      window: { start: new Date(range.start), end: new Date(range.end) },
      maxPoints: POINT_LIMIT,
      fillEmpty: true,
      aggregationByMetric: { "net.total.up": "last", "net.total.down": "last" },
      options: { signal },
      strictResponse: true,
    });
    if (!Array.isArray(response.series)) throw new Error("历史指标响应无效");
    metrics = METRIC_FIELDS.flatMap(([key, label, unit, remoteKey]) => {
      const series = response.series.filter(
        (s) => s.entity_id === uuid && s.metric_key === remoteKey,
      );
      if (series.some((s) => s.points.length >= POINT_LIMIT)) limited = true;
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
    const payload = await getRpc2Client().call(
      "common:getRecords",
      {
        uuid,
        type: "load",
        start: new Date(range.start).toISOString(),
        end: new Date(range.end).toISOString(),
        hours: (range.end - range.start) / 3600000,
        maxCount: POINT_LIMIT,
      },
      { signal },
    );
    metrics = forkMetrics(payload, uuid, range);
    const raw = object(payload),
      records = Array.isArray(raw.records)
        ? array(raw.records)
        : array(object(raw.records)[uuid]);
    limited =
      records.length >= POINT_LIMIT || (num(raw.count) ?? 0) > records.length;
  }
  return {
    metrics,
    source: {
      id: "metrics",
      name: "资源与流量历史",
      state: limited ? "partial" : metrics.length ? "available" : "empty",
      detail: limited
        ? "返回点达到上限或响应计数超过明细；可能截断，不保证完整历史。"
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
    const data = object(
      await getRpc2Client().call(
        "common:getRecords",
        {
          uuid,
          type: "ping",
          start: new Date(range.start).toISOString(),
          end: new Date(range.end).toISOString(),
          hours: (range.end - range.start) / 3600000,
          maxCount: POINT_LIMIT,
        },
        { signal },
      ),
    );
    if (!Array.isArray(data.records) && !(uuid in object(data.records)))
      throw new Error("历史 Ping 响应无效");
    records = (Array.isArray(data.records)
      ? array(data.records)
      : array(object(data.records)[uuid])
    )
      .filter((r) => !r.client || r.client === uuid)
      .filter(
        (r) => typeof r.task_id === "number" && typeof r.value === "number",
      ) as unknown as PingRecord[];
    tasks = array(data.tasks)
      .filter((t) => typeof t.id === "number")
      .map((t) => ({
        id: Number(t.id),
        name: str(t.name),
        type: str(t.type) || "未知",
        interval: num(t.interval) ?? 0,
        target: str(t.target),
      })) as PingTask[];
    limited =
      records.length >= POINT_LIMIT || (num(data.count) ?? 0) > records.length;
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

async function networkV3(
  uuid: string,
  range: ReportRange,
  signal: AbortSignal,
) {
  const base = `/api/aster-network-observatory/v3`,
    nodePath = `${base}/nodes/${encodeURIComponent(uuid)}`;
  const caps = object(await readJson(`${base}/capabilities`, signal));
  if (!Array.isArray(caps.modules) || caps.schema !== 3)
    throw new Error("网络报告能力响应无效");
  const evidence: NetworkEvidence[] = [];
  let partial = false,
    bytes = 0;
  const warnings: string[] = [];
  for (const module of caps.modules.filter(
    (m): m is string => typeof m === "string",
  )) {
    try {
      let cursor = "";
      const seen = new Set<string>();
      let pages = 0;
      do {
        check(signal);
        if (seen.has(cursor) || pages++ >= 100) {
          partial = true;
          break;
        }
        seen.add(cursor);
        const page = object(
          await readJson(
            `${nodePath}/rounds?module=${encodeURIComponent(module)}&cursor=${encodeURIComponent(cursor)}`,
            signal,
          ),
        );
        if (!Array.isArray(page.rounds))
          throw new Error("网络轮次分页响应无效");
        for (const round of array(page.rounds)) {
          const start = timestamp(round.startedAt),
            end = timestamp(round.completedAt);
          if (
            !(start < range.end) ||
            (Number.isFinite(end) && end < range.start)
          )
            continue;
          if (evidence.length >= 1500 || bytes > INPUT_LIMIT / 2) {
            partial = true;
            break;
          }
          if (round.detailAvailable === false) {
            if (end >= range.start && end < range.end)
              evidence.push({
                id: `v3:${str(round.id)}`,
                module,
                time: end,
                startedAt: start,
                state: str(round.state),
                target: "",
                direction: "",
                source: "网络报告 v3",
                summaryOnly: true,
                detail: projectEvidence({
                  counts: round.counts,
                  detailAvailable: false,
                }),
              });
            partial = true;
            continue;
          }
          const full = object(
            await readJson(
              `${nodePath}/rounds/${encodeURIComponent(str(round.id))}`,
              signal,
            ),
          );
          if (!Array.isArray(full.measurements) || !Array.isArray(full.slots))
            throw new Error("网络轮次明细响应无效");
          for (const measurement of array(full.measurements)) {
            if (measurement.nodeUuid && measurement.nodeUuid !== uuid) {
              partial = true;
              continue;
            }
            const t = timestamp(measurement.completedAt),
              started = timestamp(measurement.startedAt);
            if (t < range.start || t >= range.end || !Number.isFinite(t))
              continue;
            const source = object(measurement.source);
            const entry: NetworkEvidence = {
              id: `v3:${str(round.id)}:${str(measurement.id)}`,
              module,
              time: t,
              startedAt: Number.isFinite(started) ? started : undefined,
              state: str(object(measurement.data).state),
              target: str(measurement.target),
              direction: str(measurement.direction),
              source: [
                source.provider,
                source.name,
                source.city,
                source.carrier,
              ]
                .filter((v) => typeof v === "string")
                .join(" · "),
              detail: projectEvidence({
                ...object(measurement.data),
                protocol: object(measurement.options).protocol,
                family: object(full.parameters).family,
              }),
            };
            bytes += JSON.stringify(entry).length * 2;
            evidence.push(entry);
          }
          // Missing/cancelled slots without a measurement are evidence too.
          if (end >= range.start && end < range.end && start >= range.start) {
            const slots = array(full.slots).filter(
              (s) => !array(full.measurements).some((m) => m.slotId === s.id),
            );
            for (const slot of slots)
              evidence.push({
                id: `v3:${str(round.id)}:slot:${str(slot.id)}`,
                module,
                time: end,
                state: str(slot.state),
                target: str(slot.target),
                direction: str(slot.direction),
                source: "未完成的检测项",
                detail: projectEvidence({
                  state: slot.state,
                  family: object(full.parameters).family,
                }),
              });
          }
        }
        cursor = str(page.nextCursor);
        if (evidence.length >= 1500 || bytes > INPUT_LIMIT / 2) {
          partial = true;
          break;
        }
      } while (cursor);
    } catch (error) {
      check(signal);
      partial = true;
      warnings.push(
        `${module} 查询失败${error instanceof ReportHttpError ? `（HTTP ${error.status}）` : ""}，其余模块已保留。`,
      );
    }
  }
  const retention = object(caps.retention);
  return {
    evidence,
    source: {
      id: "network-v3",
      name: "网络报告 v3",
      state: partial ? "partial" : evidence.length ? "available" : "empty",
      detail: `只汇总既有测量；明细保留 ${num(retention.detailDays) ?? "未知"} 天，摘要 ${num(retention.summaryDays) ?? "未知"} 天。${partial ? "存在明细过期、查询失败或预算限制，不能保证全部证据完整。" : "已完成所有模块分页。"}${warnings.join(" ")}`,
    } satisfies ReportSource,
  };
}

async function networkLegacy(
  uuid: string,
  range: ReportRange,
  version: 1 | 2,
  signal: AbortSignal,
) {
  const data = object(
    await readJson(
      version === 2
        ? `/api/aster-network-observatory/v2/nodes/${encodeURIComponent(uuid)}/reports`
        : "/api/aster-network-observatory/v1/status",
      signal,
    ),
  );
  if (!Array.isArray(version === 2 ? data.records : data.history))
    throw new Error("旧版网络历史响应无效");
  const rows = array(version === 2 ? data.records : data.history);
  const evidence: NetworkEvidence[] = rows
    .filter((r) => r.nodeUuid === uuid)
    .filter((r) => {
      const t = timestamp(r.completedAt);
      return t >= range.start && t < range.end;
    })
    .map((r) => ({
      id: `v${version}:${str(r.id) || str(r.taskId) || `${str(r.scheduleId)}:${str(r.completedAt)}`}`,
      module: str(r.operation) || str(r.mode),
      time: timestamp(r.completedAt),
      state: str(object(r.data).state) || str(r.status),
      target: str(r.target),
      direction: str(r.direction),
      source: `旧版 v${version} · ${str(object(r.source).name) || str(r.carrier)}`,
      detail: projectEvidence(r.data ?? { state: r.status }),
      summaryOnly: version === 1,
    }));
  if (version === 2)
    for (const r of array(data.summaries)) {
      const t = Date.parse(str(r.day) + "T00:00:00Z");
      if (t >= range.start && t + 86400000 <= range.end)
        evidence.push({
          id: `v2:summary:${str(r.day)}:${str(r.fingerprint)}`,
          module: `${str(r.operation)} · UTC 日摘要（不与明细累加）`,
          time: t,
          state: "summary",
          target: str(r.target),
          direction: str(r.direction),
          source: "旧版 v2 保留摘要",
          detail: projectEvidence(r),
          summaryOnly: true,
        });
    }
  return {
    evidence,
    source: {
      id: `network-v${version}`,
      name: `旧版网络记录 v${version}`,
      state: evidence.length ? "partial" : "empty",
      detail:
        "接口仅提供当前保留集合，无法证明完整历史。日摘要仅纳入完整落在区间内的 UTC 日，不与明细相加；旧版命令原文不进入档案。",
    } satisfies ReportSource,
  };
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
      for (const version of [3, 2, 1] as const) {
        progress(`正在读取网络观测 v${version} 的既有记录…`);
        try {
          const r =
            version === 3
              ? await networkV3(meta.uuid, range, signal)
              : await networkLegacy(meta.uuid, range, version, signal);
          network.push(...r.evidence);
          sources.push(r.source);
        } catch (e) {
          check(signal);
          sources.push(
            sourceError(`network-v${version}`, `网络观测 v${version}`, e),
          );
        }
      }
    })(),
  ]);
  check(signal);
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
    throw new Error("报告输入超过 32 MiB，请缩小日期范围后重试。");
  progress("正在计算统计、数据覆盖与报告结论…");
  return redactReport(input);
}
