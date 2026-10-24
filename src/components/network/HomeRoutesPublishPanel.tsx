import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  publishHomeRoutes,
  rebuildHomeRoutes,
  type ReportCatalog,
} from "@/services/reportObservatory";
import { getHomeRoutes } from "@/services/homeRoutes";

export function HomeRoutesPublishPanel({
  catalog,
}: {
  catalog: ReportCatalog;
}) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const [display, setDisplay] = useState<boolean | null>(null);
  const [labelMode, setLabelMode] = useState<"preferred" | "full" | null>(null);
  const [showDetails, setShowDetails] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const cache = useQueryClient();
  const routes = useQuery({
    queryKey: ["home-carrier-routes", true],
    queryFn: ({ signal }) => getHomeRoutes({ signal }, true),
    staleTime: 30000,
    retry: false,
  });
  const nodes = catalog.inventory.filter((n) => n.publicVisible);
  const selected = (selection ?? catalog.homeRouteNodes).filter((id) =>
    nodes.some((n) => n.uuid === id),
  );
  async function action(rebuild = false) {
    setBusy(true);
    setMessage("");
    try {
      if (rebuild) await rebuildHomeRoutes();
      else
        await publishHomeRoutes(
          selected,
          catalog.revision,
          display ?? catalog.homeRouteDisplay,
          labelMode ?? catalog.homeRouteLabelMode,
          showDetails ?? catalog.homeRouteShowDetails,
        );
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["report-catalog"] }),
        cache.invalidateQueries({ queryKey: ["home-carrier-routes"] }),
      ]);
      if (!rebuild) {
        setSelection(null);
        setDisplay(null);
        setLabelMode(null); setShowDetails(null);
      }
      setMessage(
        rebuild
          ? "已从仍保留的大陆路由报告重建摘要"
          : "显示与访客发布范围已保存到网络插件",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="network-form home-routes-publish">
      <p>
        管理员可直接预览已测线路。访客仅能查看下方明确发布的可见节点摘要。去程、回程和
        IPv4/IPv6 分别使用实测结果；线路名称来自路径 ASN。
      </p>
      <label className="report-checkbox">
        <input
          type="checkbox"
          checked={display ?? catalog.homeRouteDisplay}
          onChange={(e) => setDisplay(e.target.checked)}
        />
        在首页卡片显示三网线路
      </label>
      <label>
        线路展示方式
        <select aria-label="线路展示方式" value={labelMode ?? catalog.homeRouteLabelMode} onChange={event => setLabelMode(event.target.value as "preferred" | "full")}>
          <option value="preferred">优选线路 · 每格一个结果</option>
          <option value="full">完整线路 · 全部观测网络</option>
        </select>
      </label>
      <p>展示优先级：CN2 ＞ CTGNet ＞ 163；9929 ＞ 10099 ＞ 4837；CMIN2 ＞ CMI ＞ 9808。跨运营商同级按观测顺序选择，仅作卡片摘要，不认证 GIA 或保证实测速率；点击数值可查看完整证据。</p>
      <label className="report-checkbox"><input type="checkbox" aria-label="显示线路确认说明" checked={showDetails ?? catalog.homeRouteShowDetails} onChange={event => setShowDetails(event.target.checked)} />显示同路径、差异与终点确认说明</label>
      <div className="home-routes-publish-nodes">
        {nodes.map((n) => {
          const values = Object.values(routes.data?.nodes[n.uuid] || {})
            .flat()
            .flatMap((row) => [row.forward, row.return]);
          return (
            <label key={n.uuid}>
              <input
                type="checkbox"
                checked={selected.includes(n.uuid)}
                onChange={(e) =>
                  setSelection(
                    e.target.checked
                      ? [...selected, n.uuid]
                      : selected.filter((id) => id !== n.uuid),
                  )
                }
              />
              <span>
                {n.name}
                <small>
                  {values.some((value) => value && value.state !== "missing")
                    ? "已有线路观测"
                    : values.some(Boolean)
                      ? "测量缺少覆盖，查看报告原因"
                      : "尚无线路观测"}{" "}
                  ·{" "}
                  {catalog.homeRouteNodes.includes(n.uuid)
                    ? "访客可见"
                    : "仅管理员预览"}
                </small>
                <a href={`/instance/${n.uuid}?focus=network&tab=routes`}>
                  查看报告
                </a>
              </span>
            </label>
          );
        })}
      </div>
      {routes.error && (
        <p role="alert">线路状态读取失败：{routes.error.message}</p>
      )}
      {!nodes.length && <p>当前没有可向访客发布的可见节点。</p>}
      <div className="network-actions">
        <button
          disabled={busy}
          onClick={() => setSelection(nodes.map((n) => n.uuid))}
        >
          选择全部可见节点
        </button>
        <button disabled={busy} onClick={() => setSelection([])}>
          取消全部发布
        </button>
        <button disabled={busy} onClick={() => void action()}>
          {busy ? "提交中…" : "保存显示与发布范围"}
        </button>
        <button disabled={busy} onClick={() => void action(true)}>
          从报告重建摘要
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
