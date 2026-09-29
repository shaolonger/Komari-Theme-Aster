import { useState } from "react";
import type { NetworkAgent, NetworkCatalog, NetworkMode, NetworkSchedule } from "@/services/networkObservatory";
import { MODES } from "./shared";
import { NetworkTimingFields } from "./NetworkTimingFields";

export function NetworkPlanEditor({ uuid, name, initial, agent, catalog, catalogLoading, catalogError, onSave, pending }: { uuid: string; name: string; initial?: NetworkSchedule; agent?: NetworkAgent | null; catalog?: NetworkCatalog; catalogLoading?: boolean; catalogError?: string; onSave: (plan: NetworkSchedule, once: boolean, trafficAccepted: boolean) => void; pending: boolean }) {
  const [form, setForm] = useState<NetworkSchedule>(initial || { id: crypto.randomUUID().replace(/-/g, ""), name: "", mode: "https", target: "", port: 443, intervalMinutes: 5, scheduleType: "interval", dailyTimes: [], utcOffsetMinutes: 0, enabled: true, carrier: "", region: "", clients: [uuid], nextRunAt: 0, revision: 0, sourcePolicy: "", customized: false, catalogVersion: "" });
  const [once, setOnce] = useState(false);
  const [traffic, setTraffic] = useState(false);
  const [manualTarget, setManualTarget] = useState(Boolean(initial));
  const mode = MODES.find((item) => item.id === form.mode)!;
  const suite = form.mode.startsWith("tcpquality-");
  const iperfMode = form.mode === "throughput" || form.mode === "speedtest";
  const hasPublicTargets = form.mode === "route" || iperfMode;
  const costly = ["throughput", "speedtest", "tcpquality-all", "tcpquality-report", "tcpquality-intl-report"].includes(form.mode);
  const missingTools = agent?.capabilities ? ["timeout", mode.tool].filter((tool) => !agent.capabilities?.includes(tool)) : [];
  const routeTargets = catalog?.presets.find((preset) => preset.id === "china-route")?.items || [];
  const throughputTargets = catalog?.presets.find((preset) => preset.id === "speedtest")?.targets || catalog?.presets.find((preset) => preset.id === "throughput")?.targets || [];
  const targetChoices = form.mode === "route" ? routeTargets : iperfMode ? throughputTargets : [];

  return <form className="network-form network-plan-editor" onSubmit={(event) => {
    event.preventDefault();
    onSave({ ...form, name: form.name.trim() || `${name} · ${mode.name}`.slice(0, 64), target: suite ? "default" : form.target.trim() }, once, traffic);
  }}>
    <div className="network-editor-intro"><strong>{name}</strong><span>当前 VPS 已自动关联</span></div>
    {initial?.sourcePolicy && <p className="network-inline-note">保存后成为此实例的独立覆盖，不再跟随该方案更新。</p>}
    <section className="network-form-section"><h3>检测项目</h3>
      <label>检测类型<select value={form.mode} onChange={(event) => {
        const next = MODES.find((item) => item.id === event.target.value)!;
        setForm({ ...form, mode: next.id as NetworkMode, target: "", carrier: "", region: "", catalogVersion: "", intervalMinutes: next.intervals[0], port: ["throughput", "speedtest"].includes(next.id) ? 5201 : 443 });
        setManualTarget(false);
        setTraffic(false);
      }}>{MODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {missingTools.length > 0 && <p className="network-inline-note">该 VPS 缺少 {missingTools.join("、")}。可保存计划；升级探测器并上报工具状态后才会自动执行。</p>}
      {form.mode === "speedtest" && <p className="network-help">上传与下载分别进行 10 秒 TCP 全速测试，4 条并行流。请优先选择自有测速端；耗费的流量随实际速度增加。</p>}
    </section>

    {!suite && <section className="network-form-section"><h3>测试目标</h3>
      {hasPublicTargets && <div className="network-target-source" role="group" aria-label="目标来源"><button type="button" aria-pressed={!manualTarget} onClick={() => { setManualTarget(false); if (!targetChoices.some((item) => item.target === form.target)) setForm({ ...form, target: "" }); }}>公开候选</button><button type="button" aria-pressed={manualTarget} onClick={() => setManualTarget(true)}>自定义主机</button></div>}
      {hasPublicTargets && !manualTarget && <label>{form.mode === "route" ? "NextTrace 公开路径目标" : "公开 iperf3 候选节点"}<select required value={targetChoices.some((item) => item.target === form.target) ? form.target : ""} onChange={(event) => {
        if (form.mode === "route") {
          const selected = routeTargets.find((item) => item.target === event.target.value);
          setForm({ ...form, target: selected?.target || "", carrier: selected?.carrier || "", region: selected?.region || "", catalogVersion: selected ? catalog?.version || "" : "" });
        } else {
          const selected = throughputTargets.find((item) => item.target === event.target.value);
          setForm({ ...form, target: selected?.target || "", port: selected?.port || 5201, region: selected?.region || "", catalogVersion: selected ? catalog?.version || "" : "" });
        }
      }}><option value="">请选择目标</option>{form.mode === "route" ? [...new Set(routeTargets.map((item) => item.region || "其他"))].map((region) => <optgroup key={region} label={region}>{routeTargets.filter((item) => (item.region || "其他") === region).map((item) => <option key={item.id} value={item.target}>{item.name} · {item.target}</option>)}</optgroup>) : throughputTargets.map((item) => <option key={item.target} value={item.target}>{item.provider} · {item.region} · {item.target}</option>)}</select></label>}
      {(!hasPublicTargets || manualTarget) && <label>目标主机<input required maxLength={253} value={form.target} placeholder="域名或 IP，不带协议和路径" onChange={(event) => setForm({ ...form, target: event.target.value, carrier: "", region: "", catalogVersion: "" })} /></label>}
      {hasPublicTargets && catalogLoading && <p role="status" className="network-inline-note">正在读取插件的公开目标目录…</p>}
      {hasPublicTargets && !catalogLoading && (catalogError || !targetChoices.length) && <p className="network-inline-note">公开目录暂不可用，请检查网络观测插件版本，或切换到自定义主机。{catalogError && ` ${catalogError}`}</p>}
      {["https", "throughput", "speedtest"].includes(form.mode) && <label>端口<input type="number" required min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} /></label>}
      {iperfMode && <small className="network-field-hint">公开测速端可能忙碌；全速定时测速建议使用自有或明确允许的端点。</small>}
    </section>}

    <section className="network-form-section"><h3>执行时间</h3>
      {!initial && <label className="network-check"><input type="checkbox" checked={once} onChange={(event) => setOnce(event.target.checked)} />只检测一次，不保存定时计划</label>}
      {!once && <NetworkTimingFields value={form} intervals={mode.intervals} onChange={(next) => setForm({ ...form, ...next })} label="频率" />}
    </section>

    <details className="network-form-section network-editor-optional"><summary>名称和标签（可选）</summary><label>名称<input maxLength={64} value={form.name} placeholder={`${name} · ${mode.name}`} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>运营商标签<input maxLength={48} value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} /></label><label>地区标签<input maxLength={64} value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} /></label></details>
    {costly && <label className="network-check network-traffic-consent"><input required type="checkbox" checked={traffic} onChange={(event) => setTraffic(event.target.checked)} />我有权使用此目标并接受测试流量。{form.mode === "throughput" ? "此模式仅测试 10 秒限速上传。" : form.mode === "speedtest" ? "全速双向测试不限制传输速率，流量随链路速度增加。" : "图片报告会向 TcpQuality 上传检测数据。"}</label>}
    <div className="network-form-footer"><button type="submit" className="network-primary-button" disabled={pending || (once && (!agent || missingTools.length > 0)) || (costly && !traffic)}>{pending ? "提交中…" : once ? "立即检测一次" : initial ? "保存修改" : "保存计划"}</button></div>
  </form>;
}
