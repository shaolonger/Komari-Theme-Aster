import { useState } from "react";
import type { NetworkAgent, NetworkCatalog, NetworkMode, NetworkSchedule } from "@/services/networkObservatory";
import { MODES } from "./shared";
import { NetworkTimingFields } from "./NetworkTimingFields";
export function NetworkPlanEditor({ uuid, name, initial, agent, catalog, catalogLoading, catalogError, onSave, pending }: { uuid: string; name: string; initial?: NetworkSchedule; agent?: NetworkAgent | null; catalog?: NetworkCatalog; catalogLoading?: boolean; catalogError?: string; onSave: (plan: NetworkSchedule, once: boolean, trafficAccepted: boolean) => void; pending: boolean }) {
  const [form, setForm] = useState<NetworkSchedule>(initial || { id: crypto.randomUUID().replace(/-/g, ""), name: "", mode: "https", target: "", port: 443, intervalMinutes: 5, scheduleType: "interval", dailyTimes: [], utcOffsetMinutes: 0, enabled: true, carrier: "", region: "", clients: [uuid], nextRunAt: 0, revision: 0, sourcePolicy: "", customized: false, catalogVersion: "" });
  const [once, setOnce] = useState(false), [traffic, setTraffic] = useState(false);
  const mode = MODES.find((m) => m.id === form.mode)!;
  const suite = form.mode.startsWith("tcpquality-");
  const costly = ["throughput", "tcpquality-all", "tcpquality-report", "tcpquality-intl-report"].includes(form.mode);
  const missingTools = agent?.capabilities ? ["timeout", mode.tool].filter((tool) => !agent.capabilities?.includes(tool)) : [];
  const routeTargets = catalog?.presets.find((preset) => preset.id === "china-route")?.items || [];
  const throughputTargets = catalog?.presets.find((preset) => preset.id === "throughput")?.targets || [];
  const hasCatalogChoices = form.mode === "route" ? routeTargets.length > 0 : form.mode === "throughput" ? throughputTargets.length > 0 : true;
  return <form className="network-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...form, name: form.name.trim() || `${name} · ${mode.name}`.slice(0, 64), target: suite ? "default" : form.target.trim() }, once, traffic); }}>
    <p>执行节点：<strong>{name}</strong>（已自动关联）</p>
    {initial?.sourcePolicy && <p className="network-inline-note">保存后成为此实例的独立覆盖，不再跟随该方案更新。</p>}
    <label>检测类型<select value={form.mode} onChange={(e) => { const next = MODES.find((m) => m.id === e.target.value)!; setForm({ ...form, mode: e.target.value as NetworkMode, target: "", carrier: "", region: "", catalogVersion: "", intervalMinutes: next.intervals[0], port: next.id === "throughput" ? 5201 : 443 }); setTraffic(false); }}>{MODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {missingTools.length > 0 && <p className="network-inline-note">该 VPS 缺少 {missingTools.join("、")}。可保存计划，安装依赖并上报后才会自动执行。</p>}
    {form.mode === "route" && <label>NextTrace 公开目标<select value={routeTargets.some((item) => item.target === form.target) ? form.target : ""} onChange={(event) => {
      const selected = routeTargets.find((item) => item.target === event.target.value);
      setForm({ ...form, target: selected?.target || "", carrier: selected?.carrier || "", region: selected?.region || "", catalogVersion: selected ? catalog?.version || "" : "" });
    }}><option value="">手动填写目标主机</option>{[...new Set(routeTargets.map((item) => item.region || "其他"))].map((region) => <optgroup key={region} label={region}>{routeTargets.filter((item) => (item.region || "其他") === region).map((item) => <option key={item.id} value={item.target}>{item.name} · {item.target}</option>)}</optgroup>)}</select><small>可选择公开的地区、运营商和 IPv4/IPv6 目标；也可在下方输入其他主机。</small></label>}
    {form.mode === "throughput" && <label>公开 iperf3 候选节点<select value={throughputTargets.some((item) => item.target === form.target) ? form.target : ""} onChange={(event) => {
      const selected = throughputTargets.find((item) => item.target === event.target.value);
      setForm({ ...form, target: selected?.target || "", port: selected?.port || 5201, region: selected?.region || "", catalogVersion: selected ? catalog?.version || "" : "" });
    }}><option value="">手动填写目标主机</option>{throughputTargets.map((item) => <option key={item.target} value={item.target}>{item.provider} · {item.region} · {item.target}</option>)}</select><small>公开测速节点可能忙碌；使用前请确认目标允许测速并留意流量。</small></label>}
    {(form.mode === "route" || form.mode === "throughput") && catalogLoading && <p role="status" className="network-inline-note">正在读取插件的公开目标目录…</p>}
    {(form.mode === "route" || form.mode === "throughput") && !catalogLoading && (catalogError || !hasCatalogChoices) && <p className="network-inline-note">公开目标目录暂不可用。请确认网络观测插件 v1.3.0 或以上已安装并启用；仍可手动填写目标。{catalogError && ` ${catalogError}`}</p>}
    {!suite && <label>目标主机<input required maxLength={253} value={form.target} placeholder="域名或 IP，不带协议和路径" onChange={(event) => { const wasCatalogTarget = routeTargets.some((item) => item.target === form.target) || throughputTargets.some((item) => item.target === form.target); setForm({ ...form, target: event.target.value, carrier: wasCatalogTarget ? "" : form.carrier, region: wasCatalogTarget ? "" : form.region, catalogVersion: "" }); }} /></label>}
    {["https", "throughput"].includes(form.mode) && <label>端口<input type="number" required min={1} max={65535} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>}
    {!initial && <label className="network-check"><input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />只检测一次，不保存定时计划</label>}
    {!once && <NetworkTimingFields value={form} intervals={mode.intervals} onChange={(next) => setForm({ ...form, ...next })} label="频率" />}
    <details><summary>名称和标签（可选）</summary><label>名称<input maxLength={64} value={form.name} placeholder={`${name} · ${mode.name}`} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>运营商标签<input maxLength={48} value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} /></label><label>地区标签<input maxLength={64} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></label></details>
    {costly && <label className="network-check"><input required type="checkbox" checked={traffic} onChange={(e) => setTraffic(e.target.checked)} />我有权使用目标并接受测试流量；图片报告还会上传检测数据至 TcpQuality。iperf3 上传持续 10 秒且限速 100 Mbit/s。</label>}
    <button type="submit" className="network-primary-button" disabled={pending || (once && (!agent || missingTools.length > 0)) || (costly && !traffic)}>{pending ? "提交中…" : once ? "立即检测一次" : initial ? "保存修改" : "保存计划"}</button>
  </form>;
}
