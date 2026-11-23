import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DiagnosticSection } from "@/services/homeDiagnostics";
import { publishHomeDiagnostics, type ReportCatalog } from "@/services/reportObservatory";
import { matchesNodeSearch } from "@/utils/nodeSearch";

const descriptions: Record<DiagnosticSection, string> = {
  "traffic-reset": "通过新版 VPS 探测器上报可读取的 Komari Agent 月重置周期。需要 Agent 以 --month-rotate 启动。",
  "ip-quality": "展示此 VPS 通过 IP质量检测取得的使用类型、公司类型和风险分。请先在检测方案中启用 IP质量检测。",
  "media-unlock": "分别展示各地址族的流媒体和 AI 检测结果。请先在检测方案中启用流媒体和AI解锁检测。",
};

export function HomeDiagnosticsPublishPanel({ section, catalog }: { section: DiagnosticSection; catalog: ReportCatalog }) {
  const cache = useQueryClient();
  const [selection, setSelection] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const published = catalog.homeDiagnosticNodes[section] ?? [];
  const known = new Set(catalog.inventory.map(node => node.uuid));
  const selected = new Set((selection ?? published).filter(id => known.has(id)));
  const nodes = catalog.inventory.filter(node => matchesNodeSearch(search, node.name, node.group, node.uuid));
  const changed = selection !== null && (selected.size !== published.length || published.some(id => !selected.has(id)));

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await publishHomeDiagnostics(section, [...selected], catalog.revision);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["report-catalog"] }),
        cache.invalidateQueries({ queryKey: ["home-carrier-routes"] }),
      ]);
      setSelection(null);
      setMessage("已保存首页显示范围");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!catalog.features.includes("home-diagnostics")) {
    return <p role="status">更新网络观测插件后可配置此项目。</p>;
  }
  return (
    <div className="network-form">
      <p>{descriptions[section]} 公开 VPS 被勾选后，访客可查看其摘要。</p>
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
      <div className="network-form-actions">
        <button type="button" disabled={!changed || saving} onClick={() => void save()}>保存显示范围</button>
        {message && <span role="status">{message}</span>}
      </div>
    </div>
  );
}
