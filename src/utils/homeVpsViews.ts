export interface HomeFacetDimension {
  id: string;
  label: string;
  visible: boolean;
  order: number;
}

export type HomeFacetValues = Record<string, string[]>;
export type HomeNodeFacets = Record<string, HomeFacetValues>;
export type HomeFacetFilters = Record<string, string[]>;

export interface HomeSavedView {
  id: string;
  name: string;
  selectedNodeUuids: string[];
  filters: HomeFacetFilters;
  groupBy: string;
  sortKey: string;
  sorts: VpsListSortCondition[];
}

export interface HomeFacetNodeSource {
  uuid: string;
  name: string;
  group?: string | null;
  region?: string | null;
  tags?: string | null;
  provider?: string | null;
  business_role?: string | null;
  public_remark?: string | null;
  remark?: string | null;
}

export interface HomeFacetNode {
  uuid: string;
  name: string;
  facets: HomeFacetValues;
}

export const HOME_FACET_LEGACY_GROUP = "legacyGroup";
export const HOME_FACET_PROVIDER = "provider";
export const HOME_FACET_REGION = "region";
export const HOME_FACET_LINE = "line";
export const HOME_FACET_PURPOSE = "purpose";
export const HOME_FACET_CUSTOM = "custom";

export const DEFAULT_HOME_FACET_DIMENSIONS: HomeFacetDimension[] = [
  { id: HOME_FACET_LEGACY_GROUP, label: "分组", visible: true, order: 10 },
  { id: HOME_FACET_PROVIDER, label: "厂商", visible: true, order: 20 },
  { id: HOME_FACET_REGION, label: "地区", visible: true, order: 30 },
  { id: HOME_FACET_LINE, label: "线路", visible: true, order: 40 },
  { id: HOME_FACET_PURPOSE, label: "用途", visible: true, order: 50 },
  { id: HOME_FACET_CUSTOM, label: "自定义", visible: true, order: 60 },
];

const DEFAULT_DIMENSION_IDS = new Set(DEFAULT_HOME_FACET_DIMENSIONS.map((item) => item.id));
const FACET_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const SPLIT_PATTERN = /[;,\n，、]+/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeHomeFacetId(value: unknown) {
  const id = String(value ?? "").trim();
  return FACET_ID_PATTERN.test(id) ? id : "";
}

function normalizeHomeFacetLabel(value: unknown, fallback: string) {
  const label = String(value ?? "").trim();
  return label || fallback;
}

export function normalizeHomeFacetValues(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(SPLIT_PATTERN)
      : value == null
        ? []
        : [value];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawValues) {
    const label = String(raw ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }

  return result;
}

function mergeFacetValues(...groups: unknown[]) {
  return normalizeHomeFacetValues(groups.flatMap((group) => normalizeHomeFacetValues(group)));
}

export function normalizeHomeFacetDimensions(value: unknown): HomeFacetDimension[] {
  const byId = new Map(DEFAULT_HOME_FACET_DIMENSIONS.map((item) => [item.id, { ...item }]));
  const items = Array.isArray(value) ? value : [];

  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = normalizeHomeFacetId(item.id);
    if (!id) continue;
    const existing = byId.get(id);
    const fallbackLabel = existing?.label ?? id;
    const fallbackOrder = existing?.order ?? byId.size * 10 + 10;
    const order = Number(item.order);
    byId.set(id, {
      id,
      label: normalizeHomeFacetLabel(item.label, fallbackLabel),
      visible: item.visible !== false,
      order: Number.isFinite(order) ? order : fallbackOrder,
    });
  }

  return Array.from(byId.values()).sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    const leftDefault = DEFAULT_DIMENSION_IDS.has(left.id) ? 0 : 1;
    const rightDefault = DEFAULT_DIMENSION_IDS.has(right.id) ? 0 : 1;
    if (leftDefault !== rightDefault) return leftDefault - rightDefault;
    return left.label.localeCompare(right.label, "zh-CN");
  });
}

export function normalizeHomeNodeFacets(value: unknown): HomeNodeFacets {
  if (!isRecord(value)) return {};
  const result: HomeNodeFacets = {};

  for (const [uuid, facets] of Object.entries(value)) {
    const nodeUuid = String(uuid).trim();
    if (!nodeUuid || !isRecord(facets)) continue;
    const nextFacets: HomeFacetValues = {};
    for (const [dimensionId, rawValues] of Object.entries(facets)) {
      const id = normalizeHomeFacetId(dimensionId);
      const values = normalizeHomeFacetValues(rawValues);
      if (id && values.length > 0) nextFacets[id] = values;
    }
    if (Object.keys(nextFacets).length > 0) result[nodeUuid] = nextFacets;
  }

  return result;
}

export function normalizeHomeFacetFilters(value: unknown): HomeFacetFilters {
  if (!isRecord(value)) return {};
  const result: HomeFacetFilters = {};

  for (const [dimensionId, rawValues] of Object.entries(value)) {
    const id = normalizeHomeFacetId(dimensionId);
    const values = normalizeHomeFacetValues(rawValues);
    if (id && values.length > 0) result[id] = values;
  }

  return result;
}

export function normalizeHomeSelectedNodeUuids(value: unknown): string[] {
  return normalizeHomeFacetValues(value);
}

export function normalizeHomeDefaultFacetDimension(value: unknown, dimensions: HomeFacetDimension[]) {
  const id = normalizeHomeFacetId(value);
  const visibleIds = new Set(dimensions.filter((item) => item.visible).map((item) => item.id));
  if (id && visibleIds.has(id)) return id;
  return dimensions.find((item) => item.visible)?.id ?? HOME_FACET_LEGACY_GROUP;
}

function normalizeSavedViewId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!id) return "";
  return id.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

export function normalizeHomeSavedViews(
  value: unknown,
  dimensions: HomeFacetDimension[] = DEFAULT_HOME_FACET_DIMENSIONS,
): HomeSavedView[] {
  if (!Array.isArray(value)) return [];
  const dimensionIds = new Set(dimensions.map((item) => item.id));
  const seen = new Set<string>();
  const result: HomeSavedView[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = normalizeSavedViewId(item.id);
    const name = String(item.name ?? "").trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const filters = normalizeHomeFacetFilters(item.filters);
    const groupBy = normalizeHomeFacetId(item.groupBy);
    const sortKey = String(item.sortKey ?? "").trim() || "weight";
    result.push({
      id,
      name,
      selectedNodeUuids: normalizeHomeSelectedNodeUuids(item.selectedNodeUuids),
      filters,
      groupBy: groupBy && dimensionIds.has(groupBy) ? groupBy : HOME_FACET_LEGACY_GROUP,
      sortKey,
      sorts: normalizeVpsListSorts(item.sorts, sortKey),
    });
  }

  return result;
}

export function normalizeHomeDefaultSavedViewId(value: unknown, savedViews: HomeSavedView[]) {
  const id = normalizeSavedViewId(value);
  return id && savedViews.some((view) => view.id === id) ? id : "";
}

export function buildHomeFacetNode(
  node: HomeFacetNodeSource,
  configuredFacets: HomeNodeFacets = {},
): HomeFacetNode {
  const configured = configuredFacets[node.uuid] ?? {};
  const facets: HomeFacetValues = {};

  facets[HOME_FACET_LEGACY_GROUP] = mergeFacetValues(node.group, configured[HOME_FACET_LEGACY_GROUP]);
  facets[HOME_FACET_PROVIDER] = mergeFacetValues(node.provider, configured[HOME_FACET_PROVIDER]);
  facets[HOME_FACET_REGION] = mergeFacetValues(node.region, configured[HOME_FACET_REGION]);
  facets[HOME_FACET_LINE] = mergeFacetValues(configured[HOME_FACET_LINE]);
  facets[HOME_FACET_PURPOSE] = mergeFacetValues(node.business_role, configured[HOME_FACET_PURPOSE]);
  facets[HOME_FACET_CUSTOM] = mergeFacetValues(node.tags, configured[HOME_FACET_CUSTOM]);

  for (const [dimensionId, values] of Object.entries(configured)) {
    if (DEFAULT_DIMENSION_IDS.has(dimensionId)) continue;
    const normalized = normalizeHomeFacetValues(values);
    if (normalized.length > 0) facets[dimensionId] = normalized;
  }

  for (const [dimensionId, values] of Object.entries(facets)) {
    if (values.length === 0) delete facets[dimensionId];
  }

  return {
    uuid: node.uuid,
    name: node.name,
    facets,
  };
}

export function buildHomeFacetNodes(
  nodes: HomeFacetNodeSource[],
  configuredFacets: HomeNodeFacets = {},
): HomeFacetNode[] {
  return nodes.map((node) => buildHomeFacetNode(node, configuredFacets));
}

export function getHomeFacetOptions(nodes: HomeFacetNode[], dimensionId: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const node of nodes) {
    for (const value of node.facets[dimensionId] ?? []) {
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

export function homeNodeMatchesFacetFilters(
  node: HomeFacetNode,
  filters: HomeFacetFilters,
) {
  for (const [dimensionId, selectedValues] of Object.entries(filters)) {
    if (selectedValues.length === 0) continue;
    const values = node.facets[dimensionId] ?? [];
    if (!selectedValues.some((value) => values.includes(value))) return false;
  }

  return true;
}

export function filterHomeFacetNodes({
  nodes,
  filters,
  selectedNodeUuids,
}: {
  nodes: HomeFacetNode[];
  filters?: HomeFacetFilters;
  selectedNodeUuids?: string[];
}) {
  const selected = normalizeHomeSelectedNodeUuids(selectedNodeUuids);
  const selectedSet = new Set(selected);
  const normalizedFilters = normalizeHomeFacetFilters(filters);

  return nodes.filter((node) => {
    if (selectedSet.size > 0 && !selectedSet.has(node.uuid)) return false;
    return homeNodeMatchesFacetFilters(node, normalizedFilters);
  });
}

export function getHomeFacetSearchText(node: HomeFacetNodeSource, facets: HomeFacetValues) {
  return [
    node.name,
    node.uuid,
    node.group,
    node.region,
    node.provider,
    node.business_role,
    node.tags,
    node.public_remark,
    node.remark,
    ...Object.values(facets).flat(),
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}
import {
  normalizeVpsListSorts,
  type VpsListSortCondition,
} from "@/utils/vpsListSort";
