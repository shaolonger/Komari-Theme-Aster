import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  publishHomeSpeeds,
  rebuildHomeSpeeds,
  type ReportCatalog,
} from "@/services/reportObservatory";
import { getHomeSpeeds } from "@/services/homeSpeeds";

export function HomeSpeedsPublishPanel({
  catalog,
}: {
  catalog: ReportCatalog;
}) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const [display, setDisplay] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const cache = useQueryClient();
  const speeds = useQuery({
    queryKey: ["home-carrier-speeds", true],
    queryFn: ({ signal }) => getHomeSpeeds({ signal }, true),
    staleTime: 30000,
    retry: false,
    refetchInterval: query => query.state.data?.backfillPending ? 5000 : false,
  });
  const nodes = catalog.inventory.filter((n) => n.publicVisible);
  const selected = (selection ?? catalog.homeSpeedNodes).filter((id) =>
    nodes.some((n) => n.uuid === id),
  );
  async function action(rebuild = false) {
    setBusy(true);
    setMessage("");
    try {
      if (rebuild) await rebuildHomeSpeeds();
      else
        await publishHomeSpeeds(
          selected,
          catalog.revision,
          display ?? catalog.homeSpeedDisplay,
        );
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["report-catalog"] }),
        cache.invalidateQueries({ queryKey: ["home-carrier-speeds"] }),
      ]);
      if (!rebuild) {
        setSelection(null);
        setDisplay(null);
      }
      setMessage(
        rebuild
          ? "已启动双栈测速摘要恢复，完成后自动刷新"
          : "显示与访客发布范围已保存到网络插件",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (speeds.data?.available === false) return <p role="status">当前插件尚不支持主页测速摘要，请更新网络观测插件至 1.12.0 或更新版本。</p>;
  return (
    <div className="network-form home-speeds-publish">
      <p>
        管理员可直接预览已有测速结果。访客仅能查看下方明确发布的可见节点摘要。IPv4、IPv6 分别展示最近一轮已结束的大陆测速、P1 单连接及测试时间。
      </p>
      <label className="report-checkbox">
        <input
          type="checkbox"
          checked={display ?? catalog.homeSpeedDisplay}
          onChange={(e) => setDisplay(e.target.checked)}
        />
        在首页卡片显示三网测速
      </label>
      <div className="home-speeds-publish-nodes">
        {nodes.map((n) => {
          const values = Object.values(speeds.data?.nodes[n.uuid] || {}).flatMap(snapshot => snapshot?.cities.flatMap(city => city.rows.flatMap(row => [row.download, row.upload])) || []);
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
                  {values.some((value) => value.bitsPerSecond !== null)
                    ? "已有测速观测"
                    : values.length > 0
                      ? "测量缺少覆盖，查看报告原因"
                      : "尚无测速观测"}{" "}
                  ·{" "}
                  {catalog.homeSpeedNodes.includes(n.uuid)
                    ? "访客可见"
                    : "仅管理员预览"}
                </small>
                <a href={`/instance/${n.uuid}?focus=network&tab=speed`}>
                  查看报告
                </a>
              </span>
            </label>
          );
        })}
      </div>
      {speeds.error && (
        <p role="alert">测速状态读取失败：{speeds.error.message}</p>
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
