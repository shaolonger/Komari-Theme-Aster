import type { NodeInfo } from "@/types/komari";
import type { WorkbenchSortKey, VpsWorkbenchNode } from "@/utils/vpsWorkbench";
import type { VpsRisk } from "@/utils/vpsRisk";
import type { HomeNodeSummary } from "@/services/wsStore";

export type HomeWorkspaceStatus = "all" | "online" | "attention" | "offline" | "favorites";

export interface HomeWorkspaceProps {
  nodes: VpsWorkbenchNode[];
  summaries: HomeNodeSummary[];
  risks: (VpsRisk & { name: string })[];
  search: string;
  onSearch: (value: string) => void;
  toolsOpen: boolean;
  onToggleTools: () => void;
  status: HomeWorkspaceStatus;
  onStatus: (value: HomeWorkspaceStatus) => void;
  todayTraffic: { label: string; detail: string };
  costSummary: { remainingCny: number } | null;
  costLoading: boolean;
  onOpenMetric: (metric: "status" | "bandwidth" | "traffic" | "expiry") => void;
  onOpenCost: () => void;
  showOverview: boolean;
  showCost: boolean;
  resourceMetadata?: ReadonlyMap<string, NodeInfo>;
  searchTexts?: ReadonlyMap<string, string>;
  searchResultCount?: number;
  searchHasFilters?: boolean;
  region: string;
  onRegion: (value: string) => void;
  group: string;
  onGroup: (value: string) => void;
  facets?: { dimension: {id:string;label:string}; options:string[] }[];
  selectedFacets?: Record<string,string[]>;
  onFacet?: (dimension:string,value:string)=>void;
  sortKey?: WorkbenchSortKey;
  onSort?: (value:WorkbenchSortKey)=>void;
}
