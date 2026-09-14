export type VpsListSortDirection = "asc" | "desc";

export type VpsListSortKey =
  | "status"
  | "name"
  | "group"
  | "region"
  | "provider"
  | "weight"
  | "cpu"
  | "memory"
  | "disk"
  | "load"
  | "upload"
  | "download"
  | "trafficUsed"
  | "trafficRemaining"
  | "trafficUsage"
  | "trafficLimit"
  | "latency"
  | "loss"
  | "uptime"
  | "updatedAt"
  | "expiry"
  | "expireDays"
  | "price"
  | "risk"
  | "completeness";

export interface VpsListSortCondition {
  key: VpsListSortKey;
  direction: VpsListSortDirection;
}

export interface VpsListSortableNode {
  uuid: string;
  weight: number;
  online: boolean | null;
  name: string;
  group: string;
  region: string;
  provider: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  load: number | null;
  upload: number | null;
  download: number | null;
  trafficUsed: number | null;
  trafficRemaining: number | null;
  trafficUsage: number | null;
  trafficLimit: number | null;
  latency: number | null;
  loss: number | null;
  uptime: number | null;
  updatedAt: number | null;
  expiry: number | null;
  expireDays: number | null;
  price: number | null;
  risk: number | null;
  completeness: number | null;
}

export const VPS_LIST_SORT_KEYS: readonly VpsListSortKey[] = [
  "status",
  "name",
  "group",
  "region",
  "provider",
  "weight",
  "cpu",
  "memory",
  "disk",
  "load",
  "upload",
  "download",
  "trafficUsed",
  "trafficRemaining",
  "trafficUsage",
  "trafficLimit",
  "latency",
  "loss",
  "uptime",
  "updatedAt",
  "expiry",
  "expireDays",
  "price",
  "risk",
  "completeness",
] as const;

export const DEFAULT_VPS_LIST_SORTS: VpsListSortCondition[] = [
  { key: "weight", direction: "asc" },
];

const SORT_KEY_SET = new Set<string>(VPS_LIST_SORT_KEYS);
const TEXT_KEYS = new Set<VpsListSortKey>(["name", "group", "region", "provider"]);
const REALTIME_KEYS = new Set<VpsListSortKey>([
  "cpu",
  "memory",
  "disk",
  "load",
  "upload",
  "download",
  "latency",
  "loss",
  "uptime",
]);

const LEGACY_SORT_KEYS: Record<string, VpsListSortKey> = {
  weight: "weight",
  name: "name",
  expiry: "expiry",
  traffic: "trafficUsage",
  completeness: "completeness",
  risk: "risk",
};

export const VPS_LIST_SORT_LABELS: Record<VpsListSortKey, string> = {
  status: "在线状态",
  name: "名称",
  group: "分组",
  region: "地区",
  provider: "厂商",
  weight: "默认权重",
  cpu: "CPU",
  memory: "内存",
  disk: "磁盘",
  load: "负载",
  upload: "上传速度",
  download: "下载速度",
  trafficUsed: "已用流量",
  trafficRemaining: "剩余流量",
  trafficUsage: "流量使用率",
  trafficLimit: "流量额度",
  latency: "Ping 延迟",
  loss: "丢包率",
  uptime: "在线时长",
  updatedAt: "最后上报",
  expiry: "到期时间",
  expireDays: "剩余天数",
  price: "续费价格",
  risk: "风险等级",
  completeness: "资料完整度",
};

export const VPS_LIST_SORT_GROUPS: Array<{
  label: string;
  keys: VpsListSortKey[];
}> = [
  { label: "基础", keys: ["status", "name", "group", "region", "provider", "weight"] },
  { label: "资源", keys: ["cpu", "memory", "disk", "load"] },
  { label: "网络", keys: ["upload", "download", "trafficUsed", "trafficRemaining", "trafficUsage", "trafficLimit"] },
  { label: "质量", keys: ["latency", "loss"] },
  { label: "运维", keys: ["uptime", "updatedAt", "expiry", "expireDays", "price", "risk", "completeness"] },
];

export function recommendedVpsListSortDirection(
  key: VpsListSortKey,
): VpsListSortDirection {
  switch (key) {
    case "name":
    case "group":
    case "region":
    case "provider":
    case "weight":
    case "trafficRemaining":
    case "expiry":
    case "expireDays":
    case "completeness":
      return "asc";
    default:
      return "desc";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeVpsListSorts(
  value: unknown,
  legacySortKey?: unknown,
): VpsListSortCondition[] {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<VpsListSortKey>();
  const result: VpsListSortCondition[] = [];

  for (const item of items) {
    if (!isRecord(item)) continue;
    const key = String(item.key ?? "") as VpsListSortKey;
    if (!SORT_KEY_SET.has(key) || seen.has(key)) continue;
    const direction = item.direction;
    if (direction !== "asc" && direction !== "desc") continue;
    seen.add(key);
    result.push({ key, direction });
  }

  if (result.length > 0) return result;
  const legacyKey = LEGACY_SORT_KEYS[String(legacySortKey ?? "").trim()];
  if (legacyKey) {
    return [{ key: legacyKey, direction: recommendedVpsListSortDirection(legacyKey) }];
  }
  return DEFAULT_VPS_LIST_SORTS.map((condition) => ({ ...condition }));
}

export function toggleVpsListSort(
  current: VpsListSortCondition[],
  key: VpsListSortKey,
  additive: boolean,
): VpsListSortCondition[] {
  const existing = current.find((condition) => condition.key === key);
  const recommended = recommendedVpsListSortDirection(key);
  let replacement: VpsListSortCondition | null;

  if (!existing) replacement = { key, direction: recommended };
  else if (existing.direction === recommended) {
    replacement = { key, direction: recommended === "asc" ? "desc" : "asc" };
  } else replacement = null;

  if (!additive) return replacement ? [replacement] : DEFAULT_VPS_LIST_SORTS.map((item) => ({ ...item }));
  const next = current.filter((condition) => condition.key !== key);
  if (replacement) next.push(replacement);
  return next.length > 0 ? next : DEFAULT_VPS_LIST_SORTS.map((item) => ({ ...item }));
}

function statusValue(online: boolean | null) {
  if (online === true) return 2;
  if (online == null) return 1;
  return 0;
}

function valueFor(node: VpsListSortableNode, key: VpsListSortKey): string | number | null {
  if (key === "status") return statusValue(node.online);
  if (REALTIME_KEYS.has(key) && node.online !== true) return null;
  return node[key];
}

function comparePresentValues(
  left: string | number,
  right: string | number,
  key: VpsListSortKey,
) {
  if (TEXT_KEYS.has(key)) return String(left).localeCompare(String(right), "zh-CN");
  return Number(left) - Number(right);
}

function compareCondition(
  left: VpsListSortableNode,
  right: VpsListSortableNode,
  condition: VpsListSortCondition,
) {
  const leftValue = valueFor(left, condition.key);
  const rightValue = valueFor(right, condition.key);
  const leftMissing = leftValue == null || (typeof leftValue === "number" && !Number.isFinite(leftValue));
  const rightMissing = rightValue == null || (typeof rightValue === "number" && !Number.isFinite(rightValue));
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  if (leftMissing || rightMissing) return 0;
  const result = comparePresentValues(leftValue, rightValue, condition.key);
  return condition.direction === "asc" ? result : -result;
}

export function sortVpsListNodes(
  nodes: VpsListSortableNode[],
  sorts: VpsListSortCondition[],
) {
  const normalizedSorts = normalizeVpsListSorts(sorts);
  return [...nodes].sort((left, right) => {
    for (const condition of normalizedSorts) {
      const result = compareCondition(left, right, condition);
      if (result !== 0) return result;
    }
    if (left.weight !== right.weight) return left.weight - right.weight;
    const nameResult = left.name.localeCompare(right.name, "zh-CN");
    if (nameResult !== 0) return nameResult;
    return left.uuid.localeCompare(right.uuid);
  });
}
