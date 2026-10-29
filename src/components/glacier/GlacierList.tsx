import { regionLabel } from "./regionLabel";
import { memo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { Flag } from "@/components/ui/Flag";
import { TrafficSparkline } from "@/components/node/TrafficSparkline";
import { formatMetricPercent } from "@/utils/format";
import type { VpsListSortCondition, VpsListSortKey } from "@/utils/vpsListSort";

const Row = memo(function Row({
  uuid,
  attention,
  renderCard,
}: {
  uuid: string;
  attention: boolean;
  renderCard: (uuid: string) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const model = useNodeCardModel(uuid);
  if (!model.node) return null;
  const { node, ping, trafficTrend } = model;
  const state =
    node.online === false
      ? "离线"
      : node.online == null
        ? "待上报"
        : attention
          ? "关注"
          : "在线";
  return (
    <div className="glacier-list-item" data-state={state}>
      <div className="glacier-list-row" role="row">
        <div role="cell" className="glacier-list-name">
          <i className="glacier-status-dot" />
          <Link to={`/instance/${node.uuid}`} title={node.name}>
            {node.name}
          </Link>
        </div>
        <div role="cell" className="glacier-list-region">
          <Flag region={node.region} size={22} />
          <div>
            <strong>{regionLabel(node.region)}</strong>
            <small>{node.group || node.provider || "未分组"}</small>
          </div>
        </div>
        <div
          role="cell"
          className="glacier-list-meter"
          data-critical={node.cpuPct >= 85}
        >
          <span>{formatMetricPercent(node.cpuPct)}</span>
          <progress value={Math.max(0, node.cpuPct)} max={100} />
        </div>
        <div
          role="cell"
          className="glacier-list-meter is-memory"
          data-critical={node.ramPct >= 85}
        >
          <span>{formatMetricPercent(node.ramPct)}</span>
          <progress value={Math.max(0, node.ramPct)} max={100} />
        </div>
        <div
          role="cell"
          className="glacier-list-network"
          title={`上行 ${model.upRate.value} ${model.upRate.unit} · 下行 ${model.downRate.value} ${model.downRate.unit}`}
        >
          <TrafficSparkline
            samples={trafficTrend.down}
            color={attention ? "#ff416a" : "#298fff"}
            height={30}
          />
          <small>
            ↑{model.upRate.value} ↓{model.downRate.value}
          </small>
        </div>
        <div role="cell" className="glacier-list-ping">
          {ping.lastValue == null ? "—" : `${Math.round(ping.lastValue)} ms`}
        </div>
        <div role="cell" className="glacier-list-state">
          <i className="glacier-status-dot" />
          {state}
        </div>
        <button
          className="glacier-list-expand"
          aria-label={`${expanded ? "收起" : "展开"} ${node.name} 全部指标`}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </button>
      </div>
      {expanded && (
        <div className="glacier-list-expanded">{renderCard(uuid)}</div>
      )}
    </div>
  );
});

export default function GlacierList({
  uuids,
  attentionUuids,
  sorts,
  onSort,
  onInteractionChange,
  renderCard,
}: {
  renderCard: (uuid: string) => ReactNode;
  uuids: string[];
  attentionUuids: Set<string>;
  sorts: VpsListSortCondition[];
  onSort: (key: VpsListSortKey, additive: boolean) => void;
  onInteractionChange: (value: boolean) => void;
}) {
  const headers: { label: string; key?: VpsListSortKey }[] = [
    { label: "节点", key: "name" },
    { label: "地区", key: "region" },
    { label: "CPU", key: "cpu" },
    { label: "内存", key: "memory" },
    { label: "网络", key: "download" },
    { label: "Ping", key: "latency" },
    { label: "状态", key: "status" },
  ];
  return (
    <section
      className="glacier-list glacier-panel"
      role="table"
      aria-label="VPS 列表"
      onPointerEnter={() => onInteractionChange(true)}
      onPointerLeave={() => onInteractionChange(false)}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget))
          onInteractionChange(false);
      }}
    >
      <div className="glacier-list-scroll">
        <div className="glacier-list-head" role="row">
          {headers.map((h) => {
            const sort = sorts.find((s) => s.key === h.key);
            return (
              <div
                key={h.label}
                role="columnheader"
                aria-sort={
                  sort
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button onClick={(e) => h.key && onSort(h.key, e.shiftKey)}>
                  {h.label}
                  {sort && (
                    <span>{sort.direction === "asc" ? " ↑" : " ↓"}</span>
                  )}
                </button>
              </div>
            );
          })}
          <span />
        </div>
        <div role="rowgroup">
          {uuids.map((uuid) => (
            <Row
              key={uuid}
              uuid={uuid}
              attention={attentionUuids.has(uuid)}
              renderCard={renderCard}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
