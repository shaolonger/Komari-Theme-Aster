import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { deleteNodeNetworkPlan, getNetworkCatalog, getNetworkHistory, getNodeNetworkStatus, issueNetworkObservatoryToken, revokeNetworkObservatoryToken, runNetworkObservatorySchedule, runNodeNetworkTest, saveNodeNetworkPlan, type NetworkResult, type NetworkSchedule } from "@/services/networkObservatory";
import { parseNetworkReport } from "@/utils/networkReport";
import { NetworkDrawer } from "./NetworkDrawer";
import { NetworkPlanEditor } from "./NetworkPlanEditor";
import { NetworkPolicyPanel } from "./NetworkPolicyPanel";
import { NetworkReport } from "./NetworkReport";
import { agentState, formatNetworkTime, installCommand, timingName, MODES, modeName, networkGuide } from "./shared";
import "@/styles/network-observatory.css";

export function NetworkWorkspace({ uuid, name }: { uuid: string; name: string }) {
  const { data: me } = useAuth();
  const cache = useQueryClient();
  const status = useQuery({ queryKey: ["node-network", uuid], queryFn: () => getNodeNetworkStatus(uuid), enabled: me?.logged_in === true, refetchInterval: 10_000, retry: false });
  const [mode, setMode] = useState("");
  const history = useInfiniteQuery({ queryKey: ["node-network-history", uuid, mode], initialPageParam: "", queryFn: ({ pageParam }) => getNetworkHistory(uuid, pageParam, mode), getNextPageParam: (page) => page.nextCursor || undefined, enabled: Boolean(status.data), refetchInterval: 30_000 });
  const [drawer, setDrawer] = useState<"agent" | "plan" | "policies" | "report" | null>(null);
  const catalog = useQuery({ queryKey: ["network-catalog"], queryFn: getNetworkCatalog, enabled: me?.logged_in === true && drawer === "plan", staleTime: 30_000, retry: false });
  const [plan, setPlan] = useState<NetworkSchedule | undefined>();
  const [result, setResult] = useState<NetworkResult | null>(null);
  const [token, setToken] = useState(""), [base, setBase] = useState(window.location.origin);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function refresh() { await Promise.all([cache.invalidateQueries({ queryKey: ["node-network", uuid] }), cache.invalidateQueries({ queryKey: ["node-network-history", uuid] }), cache.invalidateQueries({ queryKey: ["network-catalog"] })]); }
  async function action(operation: () => Promise<unknown>, success = "") {
    setPending(true); setError(""); setMessage("");
    try { await operation(); setMessage(success); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setPending(false); }
  }
  function open(value: typeof drawer) { setError(""); setDrawer(value); }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setMessage("已复制"); } catch { setError("复制失败，请手动选中文本复制。"); } }
  if (!me?.logged_in) return <div className="network-empty-state"><p>网络检测报告和配置仅管理员可见。</p><a href="/admin" target="_blank" rel="noreferrer">登录管理后台</a></div>;
  if (status.isPending) return <p role="status">正在读取本机网络检测…</p>;
  if (!status.data) return <div className="network-empty-state"><strong>网络检测数据暂不可用</strong><p>请检查插件是否已启用、权限是否批准，并查看下方错误及插件日志。</p><p role="alert">{status.error?.message}</p><a href={networkGuide} target="_blank" rel="noreferrer">查看排查指南</a><button type="button" onClick={() => void status.refetch()}>重新连接</button></div>;
  const data = status.data, agent = data.node;
  const rows = history.data?.pages.flatMap((page) => page.items) || data.history.items;
  const command = installCommand(uuid, base);
  const previous = result ? rows.find((row) => row.mode === result.mode && row.target === result.target && row.scheduleId === result.scheduleId && row.completedAt < result.completedAt) : undefined;
  function showReport(record: NetworkResult) { setResult(record); open("report"); }
  return <div className="network-workspace">
    <div className="network-node-banner"><div><strong>{agentState(agent)}</strong><small>{agent?.lastSeenAt ? `最近连接 ${formatNetworkTime(agent.lastSeenAt)}` : "仅安装 Komari Agent 不会自动启用网络探测"}</small></div><div className="network-actions"><button type="button" onClick={() => open("agent")}>{agent ? "管理探测器" : "为此 VPS 启用检测"}</button><button type="button" onClick={() => void refresh()}>刷新</button></div></div>
    {status.error && <p className="network-form-error">刷新失败，以下为缓存数据：{status.error.message}</p>}
    {data.inventoryError && <p className="network-inline-note">{data.inventoryError}</p>}
    {!agent && <p className="network-help">先复制本机安装命令，运行后页面会自动确认连接。也可以先套用方案，接入后再执行。</p>}
    {agent && <div className="network-capabilities">{["curl", "timeout", "nexttrace", "iperf3", "speedtest", "tcpquality"].map((tool) => <span key={tool} data-ready={agent.capabilities?.includes(tool)}>{tool === "speedtest" ? "全速双向" : tool} · {agent.capabilities ? agent.capabilities.includes(tool) ? "可用" : "未就绪" : "待检测"}</span>)}{!agent.capabilities && <small>升级探测器后可查看工具状态</small>}</div>}
    <div className="network-actions network-main-actions"><button type="button" className="network-primary-button" onClick={() => open("policies")}>套用方案 / 批量配置</button><button type="button" onClick={() => { setPlan(undefined); open("plan"); }}>自定义 / 临时检测</button><a href={networkGuide} target="_blank" rel="noreferrer">使用指南</a></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="network-form-error">{error}</p>}
    {data.tasks.length > 0 && <div className="network-task-list" role="status">{data.tasks.map((task) => <p key={task.taskId}><strong>{task.status === "running" ? "检测中" : "排队等待领取"}</strong> · {modeName(task.mode)} · {task.target === "default" ? "默认目标集" : task.target} · 已等待/运行 {Math.max(0, Math.floor((Date.now() - (task.startedAt || task.queuedAt)) / 1000))} 秒</p>)}</div>}
    <div className="network-latest-grid">{MODES.filter((item) => item.id !== "tcpquality-all").map((item) => {
      const latest = data.latest.find((row) => row.mode === item.id);
      const measurement = latest ? parseNetworkReport(latest).measurements[0] : null;
      const download = latest && item.id === "speedtest" ? parseNetworkReport(latest).measurements.find((value) => value.label === "下载速度") : null;
      return <button type="button" key={item.id} className="network-latest-card" disabled={!latest} onClick={() => latest && showReport(latest)}><span>{item.name}</span><strong>{latest ? latest.status === "success" ? measurement ? item.id === "speedtest" && download ? `↑ ${measurement.value.toFixed(1)} / ↓ ${download.value.toFixed(1)} Mbps` : `${measurement.value.toFixed(measurement.unit ? 1 : 0)} ${measurement.unit}` : "报告已生成" : "检测异常" : "尚无结果"}</strong><small>{latest ? `${formatNetworkTime(latest.completedAt)} · 查看报告` : "套用方案后开始记录"}</small></button>;
    })}</div>
    <section className="network-section"><h3>本机检测计划 <small>{data.schedules.length} 项</small></h3>{!data.schedules.length && <p className="network-help">还没有计划。点击「套用方案」即可自动填写目标和频率。</p>}{data.schedules.map((item) => <article className="network-instance-plan" key={item.id}><div><strong>{item.name}</strong><small>{modeName(item.mode)} · {timingName(item)} · {item.target === "default" ? "工具默认目标集" : item.target}</small><small>{item.enabled ? "启用" : "已暂停"} · {item.customized ? "单机独立覆盖" : item.sourcePolicy ? `继承：${data.policies.find((p) => p.id === item.sourcePolicy)?.name || "分组方案"}` : "独立计划"}</small><small>下次计划 {formatNetworkTime(item.nextRunAt)}{!agent ? " · 等待接入" : agent.capabilities && (!agent.capabilities.includes("timeout") || !agent.capabilities.includes(MODES.find((m) => m.id === item.mode)?.tool || "")) ? " · 等待安装依赖" : agentState(agent) !== "探测器在线" ? " · 等待探测器上线" : ""}</small></div><div className="network-actions"><button type="button" disabled={pending || !agent || !item.enabled || data.tasks.some((t) => t.scheduleId === item.id)} onClick={() => void action(() => runNetworkObservatorySchedule(item.id), "任务已入队，结果将自动更新")}>立即检测</button><button type="button" disabled={pending} onClick={() => { setPlan(item); open("plan"); }}>编辑</button><button type="button" disabled={pending} onClick={() => void action(() => saveNodeNetworkPlan(uuid, { ...item, enabled: !item.enabled }), "本机计划状态已更新")}>{item.enabled ? "暂停" : "恢复"}</button><button type="button" disabled={pending} onClick={() => { if (window.confirm("删除本机这条计划？历史结果会保留，继承计划会加入本机排除项。")) void action(() => deleteNodeNetworkPlan(uuid, item), "计划已删除"); }}>删除</button></div></article>)}</section>
    <section className="network-section"><div className="network-actions"><h3>检测历史</h3><label>类型 <select aria-label="筛选检测类型" value={mode} onChange={(e) => setMode(e.target.value)}><option value="">全部</option>{MODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><small>每台保留最多 500 条 / 2 MiB，先达到的上限生效</small></div>{history.error && <p role="alert">历史加载失败：{history.error.message}</p>}<div className="network-history-list">{rows.map((row, index) => <button type="button" key={`${row.completedAt}-${row.taskId || row.scheduleId}-${index}`} onClick={() => showReport(row)}><span data-failed={row.status !== "success"}>{row.status === "success" ? "执行完成" : row.status === "timeout" ? "超时" : "执行失败"}</span><strong>{modeName(row.mode)}</strong><small>{row.target === "default" ? "默认目标集" : row.target}</small><time>{formatNetworkTime(row.completedAt)}</time><span>查看报告 →</span></button>)}</div>{!rows.length && <p className="network-help">尚无检测结果。执行完成后报告会自动显示。</p>}{history.hasNextPage && <button type="button" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>加载更早记录</button>}</section>
    {drawer && <NetworkDrawer title={drawer === "agent" ? `${name} · 探测器管理` : drawer === "plan" ? plan ? "编辑本机计划" : "自定义检测" : drawer === "policies" ? "套用网络检测方案" : "网络检测报告"} onClose={() => { setDrawer(null); setToken(""); }}>
      {drawer === "agent" && <div className="network-form"><p>{agentState(agent)} · {agent?.runnerVersion ? `runner ${agent.runnerVersion}` : "尚未上报版本"}</p><label>Komari 地址<input type="url" value={base} onChange={(e) => setBase(e.target.value)} /><small>如果面板部署在子路径，需包含该路径。</small></label><p>当前节点 UUID：<code>{uuid}</code>（安装命令已自动填写）</p><button type="button" disabled={pending} onClick={() => { if (agent && !window.confirm("重置后旧密钥立即失效，需在本机重新配置。是否继续？")) return; void action(async () => { const issued = await issueNetworkObservatoryToken(uuid); setToken(issued.token); }); }}>{agent ? "重置探测器密钥" : "生成本机探测器密钥"}</button>{token && <div className="network-credential-reveal"><strong>探测器密钥（仅显示一次）</strong><code>{token}</code><button type="button" onClick={() => void copy(token)}>复制密钥</button><p>在安装向导的密钥提示处粘贴。终端不会回显；不要把它填写到 UUID 栏。</p></div>}<div className="network-credential-reveal"><strong>在这台 VPS 的 SSH 终端执行</strong><pre>{command}</pre><button type="button" onClick={() => void copy(command)}>复制本机安装 / 升级命令</button><p>已安装时可回车保留旧密钥。页面每 10 秒自动确认连接；首次安装请先生成密钥。</p></div><details><summary>依赖与排错</summary><p>一键安装器会自动补装 iperf3、NextTrace 与 TcpQuality 等依赖；如软件源或 GitHub 不可达，请恢复后重跑同一命令。</p><p>固定版本及校验方式见使用指南。工具状态每 30 秒上报。</p><pre>sudo systemctl status aster-network-observatory-agent --no-pager{"\n"}sudo journalctl -u aster-network-observatory-agent -n 100 --no-pager</pre></details>{agent && <button type="button" className="network-danger-button" disabled={pending} onClick={() => { if (window.confirm("解除此探测器绑定并暂停本机计划？")) void action(async () => { await revokeNetworkObservatoryToken(uuid); setToken(""); }, "已解除绑定"); }}>解除绑定并暂停本机计划</button>}</div>}
      {drawer === "plan" && <NetworkPlanEditor uuid={uuid} name={name} initial={plan} agent={agent} catalog={catalog.data} catalogLoading={catalog.isPending} catalogError={catalog.error?.message} pending={pending} onSave={(value, once, trafficAccepted) => void action(async () => { if (once) await runNodeNetworkTest(uuid, value, trafficAccepted); else await saveNodeNetworkPlan(uuid, value, trafficAccepted); setDrawer(null); }, "已提交，检测状态将自动更新")} />}
      {drawer === "policies" && <NetworkPolicyPanel initialNodes={[uuid]} primaryNode={uuid} onApplied={() => void refresh()} />}
      {drawer === "report" && result && <NetworkReport result={result} previous={previous} history={rows} />}
      {error && <p className="network-form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </NetworkDrawer>}
  </div>;
}
