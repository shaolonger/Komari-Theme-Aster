import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { publishHomeRoutes, type ReportCatalog } from "@/services/reportObservatory";
export function HomeRoutesPublishPanel({ catalog }: { catalog: ReportCatalog }) {
  const [selection, setSelection] = useState<string[] | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const cache = useQueryClient();
  const selected = selection ?? catalog.homeRouteNodes;
  const nodes = catalog.inventory.filter(n => n.publicVisible);
  async function save() {
    setBusy(true); setMessage("");
    try {
      await publishHomeRoutes(selected, catalog.revision);
      await cache.invalidateQueries({ queryKey: ["report-catalog"] });
      await cache.invalidateQueries({ queryKey: ["home-carrier-routes"] });
      setSelection(null); setMessage("首页线路发布范围已保存");
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <details className="home-routes-publish"><summary>首页三网线路 · 已选择 {selected.length} 台</summary><p>完成「大陆路由」观测后，选择向首页发布摘要的可见节点。仅公开线路标签、ASN、方向和采样时间。隐藏节点不发布；去程与回程需分别探测。</p><div className="home-routes-publish-nodes">{nodes.map(n => <label key={n.uuid}><input type="checkbox" checked={selected.includes(n.uuid)} onChange={e => setSelection(e.target.checked ? [...selected, n.uuid] : selected.filter(id => id !== n.uuid))}/>{n.name}</label>)}</div>{!nodes.length && <p>请刷新网络观测清单；旧版插件需升级到 1.8.0。</p>}<div className="network-inline-fields"><button type="button" onClick={() => setSelection(nodes.map(n => n.uuid))}>选择全部可见节点</button><button type="button" onClick={() => setSelection([])}>取消全部发布</button><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存发布范围"}</button></div>{message && <p role="status">{message}</p>}</details>;
}
