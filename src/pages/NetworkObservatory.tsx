import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getAdminClients } from "@/services/api";
import {
  getNetworkObservatoryStatus,
  runNetworkObservatorySchedule,
  saveNetworkObservatorySchedules,
  type NetworkMode,
  type NetworkResult,
  type NetworkSchedule,
  type NetworkStatus,
} from "@/services/networkObservatory";
import "@/styles/network-observatory.css";

const MODE_OPTIONS: { id: NetworkMode; label: string; detail: string }[] = [
  { id: "https", label: "HTTPS 可用性", detail: "轻量检查状态码、连接、TLS 和首字节时间" },
  { id: "route", label: "路径追踪", detail: "用 NextTrace 保存逐跳路由和目的地状态" },
  { id: "throughput", label: "iperf3 吞吐量", detail: "10 秒单连接上传；需要你管理的 iperf3 服务端" },
  { id: "tcpquality-route", label: "三网回程（TcpQuality）", detail: "TCP 与 UDP 三网路由识别；每日一次，不上传报告" },
  { id: "tcpquality-intl", label: "国际互联（TcpQuality）", detail: "国际站点与测试节点连通、RTT 和重传；每日一次" },
  { id: "tcpquality-all", label: "TcpQuality 综合巡检", detail: "包含回程、国际互联和脚本自带测速；每日一次，流量更高" },
];

const INTERVALS: Record<NetworkMode, { value: number; label: string }[]> = {
  https: [
    { value: 1, label: "每分钟" },
    { value: 5, label: "每 5 分钟" },
    { value: 15, label: "每 15 分钟" },
    { value: 60, label: "每小时" },
    { value: 360, label: "每 6 小时" },
    { value: 720, label: "每 12 小时" },
    { value: 1440, label: "每天" },
  ],
  route: [
    { value: 360, label: "每 6 小时" },
    { value: 720, label: "每 12 小时" },
    { value: 1440, label: "每天" },
  ],
  throughput: [{ value: 1440, label: "每天" }],
  "tcpquality-route": [{ value: 1440, label: "每天" }],
  "tcpquality-intl": [{ value: 1440, label: "每天" }],
  "tcpquality-all": [{ value: 1440, label: "每天" }],
};

const DEFAULT_FORM = {
  name: "",
  mode: "https" as NetworkMode,
  target: "",
  carrier: "",
  region: "",
  port: 443,
  intervalMinutes: 5,
  client: "",
};
const EMPTY_SCHEDULES: NetworkSchedule[] = [];
const GLYPHS = {
  activity: "◌",
  back: "←",
  check: "✓",
  clock: "◷",
  speed: "↕",
  globe: "◎",
  play: "▶",
  save: "↓",
  warning: "!",
  delete: "×",
} as const;

function Glyph({ name, size = 16, className = "" }: { name: keyof typeof GLYPHS; size?: number; className?: string }) {
  return <span aria-hidden="true" className={`network-glyph ${className}`} style={{ width: size, height: size, fontSize: size }}>{GLYPHS[name]}</span>;
}

function modeLabel(mode: NetworkMode) {
  return MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function intervalLabel(schedule: NetworkSchedule) {
  return INTERVALS[schedule.mode].find((item) => item.value === schedule.intervalMinutes)?.label ?? "自定义间隔";
}

function isTcpQualityMode(mode: NetworkMode) {
  return mode.startsWith("tcpquality-");
}

function formatTime(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ResultRow({ result, schedule }: { result: NetworkResult; schedule?: NetworkSchedule }) {
  const failed = result.status !== "success";
  return (
    <article className="network-result-row">
      <span className={`network-result-indicator ${failed ? "is-failed" : "is-success"}`} aria-label={failed ? "检测失败" : "检测成功"}>
        {failed ? <Glyph name="warning" size={15} /> : <Glyph name="check" size={15} />}
      </span>
      <div className="network-result-main">
        <div className="network-result-title">
          <strong>{result.nodeName || result.nodeUuid}</strong>
          <span>{modeLabel(result.mode)}</span>
          {result.carrier && <span>{result.carrier}</span>}
          {result.region && <span>{result.region}</span>}
        </div>
        <div className="network-result-meta">
          <span>{result.target === "default" ? "TcpQuality 默认节点集" : result.target}</span>
          <span>{formatTime(result.completedAt)}</span>
          {schedule && <span>{schedule.name}</span>}
        </div>
        <details className="network-result-details">
          <summary>查看原始诊断输出 · 退出码 {result.exitCode}</summary>
          <pre>{result.rawOutput || "没有额外输出。"}</pre>
        </details>
      </div>
    </article>
  );
}

export function NetworkObservatory() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [nodes, setNodes] = useState<Awaited<ReturnType<typeof getAdminClients>>>([]);
  const [nodesError, setNodesError] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [runPending, setRunPending] = useState(false);
  const [runError, setRunError] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getNetworkObservatoryStatus());
      setStatusError("");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "插件接口不可用");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    let active = true;
    getAdminClients().then((value) => {
      if (active) setNodes(value);
    }).catch(() => {
      if (active) setNodesError(true);
    });
    return () => { active = false; };
  }, []);

  const selectedMode = useMemo(() => MODE_OPTIONS.find((mode) => mode.id === form.mode)!, [form.mode]);
  const schedules = status?.config.schedules ?? EMPTY_SCHEDULES;
  const scheduleById = useMemo(() => new Map(schedules.map((schedule) => [schedule.id, schedule])), [schedules]);
  const sortedNodes = useMemo(() => nodes.slice().sort((a, b) => a.name.localeCompare(b.name)), [nodes]);
  const nodeByUuid = useMemo(() => new Map(sortedNodes.map((node) => [node.uuid, node.name])), [sortedNodes]);
  const results = (status?.history ?? []).map((result) => ({
    ...result,
    nodeName: nodeByUuid.get(result.nodeUuid) || result.nodeName,
  }));

  async function saveSchedules(next: NetworkSchedule[]) {
    setSavePending(true);
    setSaveError("");
    try {
      const response = await saveNetworkObservatorySchedules(next);
      setStatus((current) => current ? { ...current, config: response.config } : current);
      setForm(DEFAULT_FORM);
      setFormError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSavePending(false);
    }
  }

  async function runSchedule(scheduleId: string) {
    setRunPending(true);
    setRunError("");
    try {
      await runNetworkObservatorySchedule(scheduleId);
      await refreshStatus();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "无法启动检测。");
    } finally {
      setRunPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const target = form.target.trim();
    if (!name) return setFormError("请为检测计划填写名称。");
    if (!isTcpQualityMode(form.mode) && !target) return setFormError("请填写目标主机名或 IP 地址。");
    if (!form.client) return setFormError("请选择一台 VPS。");
    const plan: NetworkSchedule = {
      id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      name,
      mode: form.mode,
      enabled: true,
      target: isTcpQualityMode(form.mode) ? "default" : target,
      carrier: form.carrier.trim(),
      region: form.region.trim(),
      port: form.mode === "https" || form.mode === "throughput" ? Number(form.port) : 0,
      intervalMinutes: form.intervalMinutes,
      clients: [form.client],
      nextRunAt: Date.now() + form.intervalMinutes * 60_000,
    };
    void saveSchedules([...schedules, plan]);
  }

  function deleteSchedule(scheduleId: string) {
    void saveSchedules(schedules.filter((schedule) => schedule.id !== scheduleId));
  }

  if (statusLoading && !status) {
    return <div className="network-page-loading"><Glyph name="activity" className="animate-spin" size={24} /><span>正在读取网络观测服务…</span></div>;
  }

  if (!status) {
    return (
      <main className="network-page">
        <Link to="/" className="network-back-link"><Glyph name="back" size={15} />返回节点总览</Link>
        <section className="network-install-state">
          <span className="network-install-icon"><Glyph name="activity" size={22} /></span>
          <div>
            <h1>网络观测服务尚未连接</h1>
            <p>安装并启用 Aster Network Observatory Komari 插件，然后刷新此页。</p>
            <code>{statusError || "插件接口不可用"}</code>
            <p className="network-install-hint">插件只接受 Komari 管理员请求。安装说明与插件包位于仓库的 network-observatory 目录。</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="network-page">
      <div className="network-page-heading">
        <div>
          <Link to="/" className="network-back-link"><Glyph name="back" size={15} />返回节点总览</Link>
          <h1>网络观测</h1>
          <p>从 VPS 节点发起检测，按时间保存可达性、路径和吞吐量结果。</p>
        </div>
        <button type="button" className="network-refresh-button" onClick={() => void refreshStatus()}>
          <Glyph name="activity" size={16} />刷新结果
        </button>
      </div>

      <section className="network-stat-grid" aria-label="网络观测状态">
        <div className="network-stat-card"><span><Glyph name="clock" size={15} />待处理</span><strong>{status.pending}</strong><small>节点命令仍在运行或等待回报</small></div>
        <div className="network-stat-card"><span><Glyph name="activity" size={15} />启用计划</span><strong>{schedules.filter((item) => item.enabled).length}</strong><small>间隔从 1 分钟至 1 天</small></div>
        <div className="network-stat-card"><span><Glyph name="check" size={15} />最近成功</span><strong>{results.filter((item) => item.status === "success").length}</strong><small>最多保留最近 500 条检测记录</small></div>
        <div className="network-stat-card"><span><Glyph name="warning" size={15} />最近异常</span><strong>{results.filter((item) => item.status !== "success").length}</strong><small>失败与超时单独标记</small></div>
      </section>

      <div className="network-layout">
        <section className="network-panel">
          <div className="network-panel-heading"><div><h2>添加检测计划</h2><p>每个计划绑定一台节点和一个明确目标。</p></div></div>
          <form className="network-form" onSubmit={handleSubmit}>
            <label>计划名称<input required maxLength={64} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：东京 · 电信回程" /></label>
            <label>检测类型<select value={form.mode} onChange={(event) => {
              const mode = event.target.value as NetworkMode;
              const intervalMinutes = INTERVALS[mode][0].value;
              setForm({ ...form, mode, intervalMinutes, port: mode === "throughput" ? 5201 : 443 });
            }}>{MODE_OPTIONS.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select><small>{selectedMode.detail}</small></label>
            {!isTcpQualityMode(form.mode) && <label>目标主机<input required maxLength={253} value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value })} placeholder={form.mode === "throughput" ? "你管理的 iperf3 服务端" : "example.com 或 IP 地址"} /></label>}
            {(form.mode === "https" || form.mode === "throughput") && <label>端口<input required type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} /></label>}
            <div className="network-form-pair">
              <label>运营商（可选）<input maxLength={48} value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} placeholder="电信 / 联通 / 移动" /></label>
              <label>目的地区域（可选）<input maxLength={64} value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} placeholder="北京 / 日本 / 欧洲" /></label>
            </div>
            <label>执行节点<select required value={form.client} onChange={(event) => setForm({ ...form, client: event.target.value })}>
              <option value="">选择一台在线或待机 VPS</option>
              {sortedNodes.map((node) => <option key={node.uuid} value={node.uuid}>{node.name} · {node.uuid.slice(0, 8)}</option>)}
            </select>{nodesError && <small className="network-form-error">无法读取节点，请检查管理员权限。</small>}</label>
            <label>检测间隔<select value={form.intervalMinutes} onChange={(event) => setForm({ ...form, intervalMinutes: Number(event.target.value) })}>{INTERVALS[form.mode].map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            {form.mode === "throughput" && <p className="network-inline-note"><Glyph name="speed" size={15} />将上传 10 秒测试数据到目标 iperf3 服务端。请使用你有权使用的端点，并为该 VPS 留出流量预算。</p>}
            {form.mode === "tcpquality-route" && <p className="network-inline-note"><Glyph name="warning" size={15} />需安装同一固定版本的 TcpQuality 入口与 core，并授予 Agent 原始套接字所需权限。关闭报告上传；仍会查询线路 ASN 数据并访问测试节点。</p>}
            {form.mode === "tcpquality-intl" && <p className="network-inline-note"><Glyph name="warning" size={15} />国际目标会看到探测节点公网出口 IP。脚本会向多个测试节点发起限速流量；报告与排名上传关闭。</p>}
            {form.mode === "tcpquality-all" && <p className="network-inline-note"><Glyph name="warning" size={15} />综合模式包含脚本自己的三网测速，会产生更多流量。只建议每天低峰期运行；报告与排名上传关闭。</p>}
            {formError && <p className="network-form-error" role="alert">{formError}</p>}
            {saveError && <p className="network-form-error" role="alert">{saveError}</p>}
            <button type="submit" disabled={savePending || nodes.length === 0} className="network-primary-button"><Glyph name="save" size={15} />{savePending ? "保存中…" : "保存计划"}</button>
          </form>
        </section>

        <section className="network-panel network-plans-panel">
          <div className="network-panel-heading"><div><h2>检测计划</h2><p>节点侧每次只运行一个观测任务。</p></div></div>
          {schedules.length === 0 ? <div className="network-empty-state"><Glyph name="globe" size={22} /><p>还没有检测计划。可先为自己管理的 HTTPS 站点创建轻量检查。</p></div> : (
            <div className="network-plan-list">{schedules.map((schedule) => (
              <article className="network-plan-card" key={schedule.id}>
                <div className="network-plan-icon">{schedule.mode === "https" ? <Glyph name="globe" size={17} /> : schedule.mode === "throughput" ? <Glyph name="speed" size={17} /> : <Glyph name="activity" size={17} />}</div>
                <div className="network-plan-content"><div className="network-plan-title"><strong>{schedule.name}</strong><span className={schedule.enabled ? "network-enabled" : "network-disabled"}>{schedule.enabled ? "运行中" : "已暂停"}</span></div><p>{modeLabel(schedule.mode)} · {intervalLabel(schedule)} · {nodeByUuid.get(schedule.clients[0]) || schedule.clients[0]}</p><small>{schedule.target === "default" ? "TcpQuality 默认测试节点集" : schedule.target}{schedule.port ? `:${schedule.port}` : ""}{schedule.carrier ? ` · ${schedule.carrier}` : ""}{schedule.region ? ` · ${schedule.region}` : ""}</small><small>下次计划：{formatTime(schedule.nextRunAt)}</small></div>
                <div className="network-plan-actions"><button type="button" title="立即运行" aria-label={`立即运行 ${schedule.name}`} disabled={!schedule.enabled || runPending || status.pending > 0} onClick={() => void runSchedule(schedule.id)}><Glyph name="play" size={15} /></button><button type="button" title="删除计划" aria-label={`删除 ${schedule.name}`} disabled={savePending} onClick={() => deleteSchedule(schedule.id)}><Glyph name="delete" size={15} /></button></div>
              </article>
            ))}</div>
          )}
          {runError && <p className="network-form-error" role="alert">{runError}</p>}
            <div className="network-requirements"><h3>节点工具要求</h3><p>HTTPS：curl · 路径：NextTrace · 吞吐：iperf3 服务端与客户端 · 三网/国际：同版本 TcpQuality 入口和 core。计划由 Komari 插件定时调度；浏览器关闭不影响执行。</p></div>
        </section>
      </div>

      <section className="network-panel network-history-panel">
        <div className="network-panel-heading"><div><h2>最近检测</h2><p>原始报告和每次检测的状态会保留在 Komari 插件数据目录中。</p></div><Glyph name="clock" size={18} /></div>
        {results.length === 0 ? <div className="network-empty-state"><Glyph name="activity" size={22} /><p>完成首次检测后，路径与性能报告会显示在这里。</p></div> : <div className="network-result-list">{results.map((result, index) => <ResultRow key={`${result.completedAt}-${result.scheduleId}-${index}`} result={result} schedule={scheduleById.get(result.scheduleId)} />)}</div>}
      </section>

      <p className="network-footer-note">RTT 表示往返时延。中间路由器不响应探测包并不代表终点丢包；线路分类应结合多次终点测量和路由上下文。</p>
    </main>
  );
}
