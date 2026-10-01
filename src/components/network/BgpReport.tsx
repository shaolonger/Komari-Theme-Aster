import { useRef, useState } from "react";
import { z } from "zod";
import { Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { ReportRound } from "@/services/reportObservatory";
import { formatNetworkTime } from "./shared";
const clock = z.union([z.string(), z.number()]).nullable();
const snapshotSchema = z.object({
  prefix: z.string(),
  originAsns: z.array(z.string()),
  coveringPrefixes: z.array(z.string()),
  queriedAt: z.string(),
  cacheHit: z.boolean(),
  sources: z.array(
    z.object({
      source: z.string(),
      state: z.string(),
      url: z.string(),
      dataTime: clock,
      retainedPaths: z.number(),
      returnedPaths: z.number(),
      truncated: z.boolean(),
      collectors: z.array(z.string()),
      peers: z.array(z.string()),
      diagnostic: z.string(),
    }),
  ),
  paths: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      prefix: z.string(),
      collector: z.string(),
      peer: z.string(),
      peerAsn: z.string(),
      path: z.array(z.string()),
      observedAt: clock,
      routeUpdatedAt: clock,
    }),
  ),
  graph: z.object({
    nodes: z.array(
      z.object({ id: z.string(), origin: z.boolean(), kind: z.string() }),
    ),
    edges: z.array(
      z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        pathIds: z.array(z.string()),
      }),
    ),
  }),
  rpki: z.array(
    z.object({
      asn: z.string(),
      state: z.string(),
      queriedAt: z.string(),
      validator: z.string(),
      diagnostic: z.string().optional(),
    }),
  ),
  changes: z
    .object({
      baseline: z.boolean(),
      comparableSources: z.array(z.string()),
      addedPaths: z.array(z.string()),
      removedPaths: z.array(z.string()),
      addedAdjacentAsns: z.array(z.string()),
      removedAdjacentAsns: z.array(z.string()),
      coverageChanged: z.boolean(),
    })
    .optional(),
});
type Snapshot = z.infer<typeof snapshotSchema>;
function nodeLabel(asn: string) {
  return /^\d+$/.test(asn) ? "AS" + asn : asn;
}
function layout(snapshot: Snapshot) {
  const depth = new Map(
    snapshot.graph.nodes.filter((n) => n.origin).map((n) => [n.id, 0]),
  );
  for (let level = 0; level < 6; level++)
    for (const edge of snapshot.graph.edges)
      if (depth.get(edge.to) === level && !depth.has(edge.from))
        depth.set(edge.from, level + 1);
  const nodes = [...snapshot.graph.nodes]
    .sort((a, b) => (depth.get(a.id) ?? 7) - (depth.get(b.id) ?? 7))
    .slice(0, 80);
  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const level = depth.get(node.id) ?? 7;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level)!.push(node.id);
  }
  const height = Math.max(
    380,
    ...[...columns.values()].map((c) => c.length * 42 + 60),
  );
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, ids] of columns)
    ids.forEach((id, i) =>
      positions.set(id, {
        x: 40 + level * 130,
        y: (height / (ids.length + 1)) * (i + 1),
      }),
    );
  return {
    positions,
    height,
    nodes,
    width: 1080,
    edges: snapshot.graph.edges.filter(
      (e) => positions.has(e.from) && positions.has(e.to),
    ),
  };
}
export function BgpReport({ round }: { round: ReportRound }) {
  const parsed = snapshotSchema.safeParse(round.measurements[0]?.data);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [selectedPaths, setSelectedPaths] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null),
    drag = useRef<{
      x: number;
      y: number;
      previousX: number;
      previousY: number;
    } | null>(null);
  if (!parsed.success)
    return (
      <div className="report-empty">
        {round.measurements[0]?.data.diagnostic || "BGP 快照尚未完成"}
      </div>
    );
  const snapshot = parsed.data,
    scene = layout(snapshot),
    scale = Math.min(900 / scene.width, 420 / scene.height) * zoom;
  const rpkiLabels: Record<string, string> = {
    valid: "有效",
    invalid_asn: "起源 ASN 不匹配",
    invalid_length: "前缀长度不匹配",
    "not-found": "未找到 ROA",
    unavailable: "查询不可用",
  };
  const selected = selectedPaths
    ? snapshot.paths.filter((p) => selectedPaths.includes(p.id))
    : snapshot.paths;
  return (
    <>
      <div className="report-bgp-summary">
        <strong>{snapshot.prefix}</strong>
        <span>
          Origin {snapshot.originAsns.map(nodeLabel).join(" / ") || "未取得"}
        </span>
        <span>
          采集 {formatNetworkTime(snapshot.queriedAt)}
          {snapshot.cacheHit ? " · 共用前缀缓存" : ""}
        </span>
      </div>
      {!!snapshot.coveringPrefixes.length && (
        <p className="report-caption">
          覆盖前缀（与当前最长匹配分开）：{snapshot.coveringPrefixes.join("、")}
        </p>
      )}
      <div ref={ref} className="report-bgp-graph">
        <div className="report-bgp-controls">
          <button
            aria-label="放大 BGP 图"
            onClick={() => setZoom(Math.min(6, zoom * 1.25))}
          >
            <ZoomIn size={16} />
          </button>
          <button
            aria-label="缩小 BGP 图"
            onClick={() => setZoom(Math.max(0.5, zoom / 1.25))}
          >
            <ZoomOut size={16} />
          </button>
          <button
            aria-label="重置 BGP 图"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
              setSelectedPaths(null);
            }}
          >
            <RotateCcw size={16} />
          </button>
          <button
            aria-label="全屏 BGP 图"
            onClick={() => void ref.current?.requestFullscreen?.()}
          >
            <Maximize size={16} />
          </button>
        </div>
        <svg
          viewBox="0 0 900 450"
          role="img"
          aria-label="公开 BGP AS 路径图；节点和边可以查看支持路径，完整文本路径在下方"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                previousX: pan.x,
                previousY: pan.y,
              };
            }
          }}
          onPointerMove={(e) => {
            if (drag.current)
              setPan({
                x:
                  drag.current.previousX +
                  ((e.clientX - drag.current.x) * 900) /
                    e.currentTarget.getBoundingClientRect().width,
                y:
                  drag.current.previousY +
                  ((e.clientY - drag.current.y) * 900) /
                    e.currentTarget.getBoundingClientRect().width,
              });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <g
            transform={`translate(${pan.x + 15} ${pan.y + 15}) scale(${scale})`}
          >
            {scene.edges.map((edge) => {
              const a = scene.positions.get(edge.from)!,
                b = scene.positions.get(edge.to)!;
              return (
                <g
                  key={edge.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${nodeLabel(edge.from)} 到 ${nodeLabel(edge.to)}，${edge.pathIds.length} 条路径证据`}
                  onClick={() => setSelectedPaths(edge.pathIds)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedPaths(edge.pathIds);
                    }
                  }}
                >
                  <title>{edge.pathIds.length} 条实际观测路径</title>
                  <path
                    d={`M${a.x + 48},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x + 48},${b.y}`}
                  />
                </g>
              );
            })}
            {scene.nodes.map((node) => {
              const p = scene.positions.get(node.id)!;
              return (
                <g
                  key={node.id}
                  transform={`translate(${p.x} ${p.y - 15})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${nodeLabel(node.id)}${node.origin ? " 起源 AS" : ""}，查看支持路径`}
                  onClick={() =>
                    setSelectedPaths(
                      snapshot.paths
                        .filter((path) => path.path.includes(node.id))
                        .map((path) => path.id),
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedPaths(
                        snapshot.paths
                          .filter((path) => path.path.includes(node.id))
                          .map((path) => path.id),
                      );
                    }
                  }}
                >
                  <rect
                    width={96}
                    height={30}
                    rx={5}
                    data-origin={node.origin}
                  />
                  <text x={48} y={19} textAnchor="middle">
                    {nodeLabel(node.id)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="report-caption">
        起源 AS 用强调色标记；AS_PATH 从采集器 peer
        指向起源。每条边保留实际路径证据；不推断商业上游关系或 Tier 1 身份。
        {snapshot.graph.nodes.length > 80
          ? "图中显示前 80 个 AS，完整观测路径仍可查看。"
          : ""}
      </p>
      <div className="report-bgp-sources">
        {snapshot.sources.map((source) => (
          <article key={source.source}>
            <strong>{source.source}</strong>
            <span>
              {source.collectors.length} 个采集器 · {source.peers.length} 个观测
              peer · {source.retainedPaths}/{source.returnedPaths} 条保存路径
            </span>
            <small>
              {source.dataTime
                ? `数据时刻 ${typeof source.dataTime === "string" ? formatNetworkTime(source.dataTime) : source.dataTime}`
                : "每条路径的时间单独保存"}
            </small>
            {source.truncated && <small>按采集器均衡抽样，已标记截断</small>}
            <p>{source.diagnostic}</p>
            <a href={source.url} target="_blank" rel="noreferrer">
              数据来源
            </a>
          </article>
        ))}
      </div>
      <div className="report-evidence">
        {snapshot.rpki.map((rpki) => (
          <span key={rpki.asn} title={`${rpki.validator} · ${rpki.queriedAt}`}>
            {nodeLabel(rpki.asn)} · RPKI {rpkiLabels[rpki.state] || rpki.state}
          </span>
        ))}
      </div>
      <details>
        <summary>观测到的路径与相邻 AS 变化</summary>
        {snapshot.changes?.baseline ? (
          <p>这是当前前缀的记录起点，没有可比较的更早快照。</p>
        ) : (
          <>
            <p>
              可比较来源：
              {snapshot.changes?.comparableSources.join("、") || "无"}。新增{" "}
              {snapshot.changes?.addedPaths.length || 0} 条 / 移除{" "}
              {snapshot.changes?.removedPaths.length || 0} 条保存路径。
            </p>
            <p>
              新增相邻 AS：
              {snapshot.changes?.addedAdjacentAsns.map(nodeLabel).join("、") ||
                "无"}
              ；移除：
              {snapshot.changes?.removedAdjacentAsns
                .map(nodeLabel)
                .join("、") || "无"}
              。
            </p>
            {snapshot.changes?.coverageChanged && (
              <p>
                观测 peer 或抽样覆盖发生变化；路径减少不能据此认定真实线路撤销。
              </p>
            )}
          </>
        )}
      </details>
      <details className="report-bgp-path-list">
        <summary>
          AS_PATH 原始证据 · {selected.length}/{snapshot.paths.length}
        </summary>
        {selectedPaths && (
          <button onClick={() => setSelectedPaths(null)}>显示全部路径</button>
        )}
        <div className="report-table-scroll">
          <table className="report-mtr-table">
            <thead>
              <tr>
                <th>来源 / collector</th>
                <th>Peer</th>
                <th>实际 AS_PATH</th>
                <th>路由时间</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((path) => (
                <tr key={path.id}>
                  <td>
                    {path.source}
                    <small>{path.collector}</small>
                  </td>
                  <td>{path.peer}</td>
                  <td>{path.path.map(nodeLabel).join(" → ")}</td>
                  <td>
                    {path.routeUpdatedAt
                      ? String(path.routeUpdatedAt)
                      : path.observedAt
                        ? String(path.observedAt)
                        : "未提供"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
