import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { diagnosticModules, type DiagnosticSection } from "@/services/homeDiagnostics";
import { publishHomeDiagnostics, type ReportCatalog } from "@/services/reportObservatory";
import { matchesNodeSearch } from "@/utils/nodeSearch";

const descriptions: Record<DiagnosticSection, string> = {
  "traffic-reset": "通过新版 VPS 探测器上报可读取的 Komari Agent 月重置周期。需要 Agent 以 --month-rotate 启动。",
  "ip-capability": "在同一卡片展示各地址族的 IP 质量、风险评分和流媒体及 AI 解锁结果。请先在检测方案中启用对应检测。",
};
const displayLabels = { "traffic-reset": "流量重置", "ip-capability": "IP能力" } as const;

export function HomeDiagnosticsPublishPanel({ section, catalog }: { section: DiagnosticSection; catalog: ReportCatalog }) {
  const cache = useQueryClient();
  const [selection, setSelection] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [display, setDisplay] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const known = new Set(catalog.inventory.map(node => node.uuid));
  const sections = section === "ip-capability" ? diagnosticModules : ["traffic-reset"] as const;
  const scopes = sections.map(key => ({
    nodes: (catalog.homeDiagnosticNodes[key] ?? []).filter(id => known.has(id)),
    display: catalog.homeDiagnosticDisplay[key] !== false,
  }));
  const published = new Set(scopes.flatMap(scope => scope.nodes));
  const selected = selection === null ? new Set(published) : new Set(selection.filter(id => known.has(id)));
  const nodes = catalog.inventory.filter(node => matchesNodeSearch(search, node.name, node.group, node.uuid, node.ip));
  const visibleIds = catalog.inventory.filter(node => node.publicVisible).map(node => node.uuid);
  const supportsDisplay = catalog.features.includes("home-diagnostic-display");
  const supportsExpanded = section === "ip-capability" && catalog.features.includes("home-ip-capability-default");
  const defaultExpanded = expanded ?? catalog.ipCapabilityExpanded;
  const previousDisplay = scopes.every(scope => scope.display) || scopes.some(scope => scope.display && scope.nodes.length > 0);
  const scopesDiffer = scopes.some(scope => scope.nodes.length !== published.size || scope.display !== previousDisplay);
  const displayChanged = display !== null && display !== previousDisplay;
  const expandedChanged = supportsExpanded && defaultExpanded !== catalog.ipCapabilityExpanded;
  const selectionChanged = selection !== null && (selected.size !== published.size || [...published].some(id => !selected.has(id)));

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await publishHomeDiagnostics(section, [...selected], catalog.revision,
        supportsDisplay ? display ?? previousDisplay : undefined, expandedChanged ? defaultExpanded : undefined);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["report-catalog"] }),
        cache.invalidateQueries({ queryKey: ["home-carrier-routes"] }),
      ]);
      setSelection(null);
      setDisplay(null);
      setExpanded(null);
      setMessage("已保存首页显示范围");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!catalog.features.includes(section === "ip-capability" ? "home-ip-capability" : "home-diagnostics")) {
    return <p role="status">更新网络观测插件后可配置此项目。</p>;
  }
  return (
    <div className="network-form">
      <p>{descriptions[section]} 公开 VPS 被勾选后，访客可查看其摘要。</p>
      {scopesDiffer && <p>已合并列出之前选过的 VPS。保存后，两项检测结果使用同一个显示范围。</p>}
      {supportsDisplay ? (
        <label className="report-checkbox">
          <input type="checkbox" checked={display ?? previousDisplay} disabled={saving} onChange={event => setDisplay(event.target.checked)} />
          在首页卡片显示{displayLabels[section]}
        </label>
      ) : <p>更新网络观测插件后可使用首页总开关。</p>}
      {section === "ip-capability" && (supportsExpanded ? (
        <label className="report-checkbox">
          <input type="checkbox" checked={defaultExpanded} disabled={saving} onChange={event => setExpanded(event.target.checked)} />
          默认展开首页卡片的IP能力
        </label>
      ) : <p>更新网络观测插件后可设置首页 IP 能力的默认展开状态。</p>)}
      <label>搜索 VPS<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {nodes.length ? (
        <div className="home-speeds-publish-nodes">
          {nodes.map(node => (
            <label key={node.uuid}>
              <input type="checkbox" checked={selected.has(node.uuid)} disabled={saving} onChange={event => {
                if (event.target.checked) selected.add(node.uuid);
                else selected.delete(node.uuid);
                setSelection([...selected]);
              }} />
              <span>{node.name || node.uuid}<small>{node.publicVisible ? node.group : "仅管理员可见"}</small></span>
            </label>
          ))}
        </div>
      ) : <p>没有匹配的 VPS。</p>}
      <div className="network-actions">
        <button type="button" disabled={saving || visibleIds.every(id => selected.has(id))}
          onClick={() => setSelection([...new Set([...selected, ...visibleIds])])}>选择全部可见节点</button>
        <button type="button" disabled={saving || selected.size === 0} onClick={() => setSelection([])}>取消全部选择</button>
        <button type="button" disabled={(!selectionChanged && !displayChanged && !expandedChanged && !scopesDiffer) || saving} onClick={() => void save()}>{saving ? "提交中…" : "保存显示范围"}</button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
