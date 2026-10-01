import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteReportResource,
  reportCatalog,
  saveReportResource,
  type ReportEndpoint,
} from "@/services/reportObservatory";
const blank = {
  name: "",
  address: "",
  city: "",
  carrier: "",
  country: "",
  provider: "自定义",
  family: "4",
  port: 443,
  method: "http",
  category: "websites",
  path: "/download",
  uploadPath: "",
  sourceUrl: "",
  conditions: "",
  restrictions: "",
  uses: ["speed"],
  authorized: false,
  https: true,
};
export function ReportResourcesPanel({ onLegacy }: { onLegacy: () => void }) {
  const catalog = useQuery({
      queryKey: ["report-catalog"],
      queryFn: reportCatalog,
    }),
    cache = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>(blank),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function edit(endpoint: ReportEndpoint) {
    setDraft({ ...endpoint });
    setToken("");
  }
  async function save() {
    if (!catalog.data) return;
    setBusy(true);
    setError("");
    try {
      await saveReportResource({
        ...draft,
        token: token || undefined,
        revision: catalog.data.revision,
      });
      setDraft(blank);
      setToken("");
      await cache.invalidateQueries({ queryKey: ["report-catalog"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="network-form">
      <h3>集中测量资源</h3>
      <p className="report-caption">
        内置公开节点可直接选择；自定义端点仅需登记一次。大陆九格以地区与运营商匹配资源。授权密钥不会写入报告或分享内容。
      </p>
      <button onClick={onLegacy}>登记大陆测量点 / 配置 VPS 公网地址</button>
      <div className="network-inline-fields">
        <label>
          名称
          <input
            value={String(draft.name)}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          提供方
          <input
            value={String(draft.provider)}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          />
        </label>
      </div>
      <div className="network-inline-fields">
        <label>
          地区
          <input
            placeholder="北京、上海、广州或国际城市"
            value={String(draft.city)}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
          />
        </label>
        <label>
          运营商
          <select
            value={String(draft.carrier)}
            onChange={(e) => setDraft({ ...draft, carrier: e.target.value })}
          >
            <option value="">国际 / 未声明</option>
            {["电信", "联通", "移动", "其他"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {Array.isArray(draft.uses) && draft.uses.includes("latency") && (
        <label>
          延迟报告分类
          <select
            value={String(draft.category || "websites")}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          >
            <option value="websites">国际 · 网站</option>
            <option value="idc">IDC 接入</option>
          </select>
        </label>
      )}
      <label>
        目标域名或 IP
        <input
          value={String(draft.address)}
          onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        />
      </label>
      <div className="network-inline-fields">
        <label>
          地址族
          <select
            value={String(draft.family)}
            onChange={(e) => setDraft({ ...draft, family: e.target.value })}
          >
            <option value="4">IPv4</option>
            <option value="6">IPv6</option>
            <option value="auto">双栈域名 · 测量时确认</option>
          </select>
        </label>
        <label>
          端口
          <input
            type="number"
            min={1}
            max={65535}
            value={Number(draft.port)}
            onChange={(e) =>
              setDraft({ ...draft, port: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label>
        用途与协议
        <select
          value={String(draft.method)}
          onChange={(e) =>
            setDraft({
              ...draft,
              method: e.target.value,
              uses: e.target.value === "tcp-connect" ? ["latency"] : ["speed"],
              port: e.target.value === "iperf3" ? 5201 : 443,
            })
          }
        >
          <option value="http">HTTP 单连接吞吐</option>
          <option value="iperf3">iperf3 双向吞吐</option>
          <option value="tcp-connect">IDC TCP 接入延迟</option>
        </select>
      </label>
      {draft.method === "http" && (
        <>
          <label className="report-checkbox">
            <input
              type="checkbox"
              checked={draft.https !== false}
              onChange={(e) => setDraft({ ...draft, https: e.target.checked })}
            />
            HTTPS · 校验证书与 SNI
          </label>
          <label>
            下载路径
            <input
              value={String(draft.path || "")}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            />
          </label>
          <label>
            授权上传路径 · 可留空
            <input
              value={String(draft.uploadPath || "")}
              onChange={(e) =>
                setDraft({ ...draft, uploadPath: e.target.value })
              }
            />
          </label>
          <label>
            HTTP 接收器密钥 · 编辑时留空保留
            <input
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p className="report-caption">
            上传需支持 Aster
            接收端报告协议。普通网站上传接口不能提供可核实的吞吐数据；自建接收器见安装文档。
          </p>
        </>
      )}
      <label>
        官方来源 / 授权说明链接
        <input
          placeholder="https://…"
          value={String(draft.sourceUrl)}
          onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
        />
      </label>
      <label>
        使用条件
        <textarea
          value={String(draft.conditions)}
          onChange={(e) => setDraft({ ...draft, conditions: e.target.value })}
        />
      </label>
      <label className="report-checkbox">
        <input
          type="checkbox"
          checked={draft.authorized === true}
          onChange={(e) => setDraft({ ...draft, authorized: e.target.checked })}
        />
        我确认允许对此端点执行所选测速，并遵守其频率和流量条件
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !catalog.data} onClick={() => void save()}>
        保存资源
      </button>
      <details>
        <summary>自定义资源</summary>
        {catalog.data?.endpoints
          .filter((e) => e.id.startsWith("custom:"))
          .map((e) => (
            <div className="report-saved-suite" key={e.id}>
              <strong>{e.name}</strong>
              <small>
                {e.city} {e.carrier} · {e.address} · {e.method}
              </small>
              <div>
                <button onClick={() => edit(e)}>编辑</button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void deleteReportResource(e.id)
                      .then(() =>
                        cache.invalidateQueries({
                          queryKey: ["report-catalog"],
                        }),
                      )
                      .catch((e) => setError(String(e)))
                      .finally(() => setBusy(false));
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
      </details>
      <details>
        <summary>
          内置来源与使用条件 · {catalog.data?.endpoints.length || 0} 个
        </summary>
        {catalog.data?.endpoints.map((e) => (
          <p key={e.id}>
            <a href={e.sourceUrl} target="_blank" rel="noreferrer">
              {e.name} · {e.provider}
            </a>
            <small>
              {e.conditions} {e.restrictions} · 目录核对 {e.checkedAt} ·
              在线健康由每轮实测确认
            </small>
          </p>
        ))}
      </details>
    </div>
  );
}
