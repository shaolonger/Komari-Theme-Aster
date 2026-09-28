import { useState } from "react";
import type { NetworkAgent, NetworkMode, NetworkSchedule } from "@/services/networkObservatory";
import { MODES, intervalName } from "./shared";
export function NetworkPlanEditor({ uuid, name, initial, agent, onSave, pending }: { uuid: string; name: string; initial?: NetworkSchedule; agent?: NetworkAgent | null; onSave: (plan: NetworkSchedule, once: boolean, trafficAccepted: boolean) => void; pending: boolean }) {
  const [form, setForm] = useState<NetworkSchedule>(initial || { id: crypto.randomUUID().replace(/-/g, ""), name: "", mode: "https", target: "", port: 443, intervalMinutes: 5, enabled: true, carrier: "", region: "", clients: [uuid], nextRunAt: 0, revision: 0, sourcePolicy: "", customized: false, catalogVersion: "" });
  const [once, setOnce] = useState(false), [traffic, setTraffic] = useState(false);
  const mode = MODES.find((m) => m.id === form.mode)!;
  const suite = form.mode.startsWith("tcpquality-");
  const costly = form.mode === "throughput" || form.mode === "tcpquality-all";
  const missingTools = agent?.capabilities ? ["timeout", mode.tool].filter((tool) => !agent.capabilities?.includes(tool)) : [];
  return <form className="network-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...form, name: form.name.trim() || `${name} · ${mode.name}`.slice(0, 64), target: suite ? "default" : form.target.trim() }, once, traffic); }}>
    <p>执行节点：<strong>{name}</strong>（已自动关联）</p>
    {initial?.sourcePolicy && <p className="network-inline-note">保存后成为此实例的独立覆盖，不再跟随该方案更新。</p>}
    <label>检测类型<select value={form.mode} onChange={(e) => { const next = MODES.find((m) => m.id === e.target.value)!; setForm({ ...form, mode: e.target.value as NetworkMode, intervalMinutes: next.intervals[0], port: next.id === "throughput" ? 5201 : 443 }); setTraffic(false); }}>{MODES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {missingTools.length > 0 && <p className="network-inline-note">该 VPS 缺少 {missingTools.join("、")}。可保存计划，安装依赖并上报后才会自动执行。</p>}
    {!suite && <label>目标主机<input required maxLength={253} value={form.target} placeholder="域名或 IP，不带协议和路径" onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>}
    {["https", "throughput"].includes(form.mode) && <label>端口<input type="number" required min={1} max={65535} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>}
    {!initial && <label className="network-check"><input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />只检测一次，不保存定时计划</label>}
    {!once && <label>频率<select value={form.intervalMinutes} onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}>{mode.intervals.map((n) => <option key={n} value={n}>{intervalName(n)}</option>)}</select></label>}
    <details><summary>名称和标签（可选）</summary><label>名称<input maxLength={64} value={form.name} placeholder={`${name} · ${mode.name}`} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>运营商标签<input maxLength={48} value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} /></label><label>地区标签<input maxLength={64} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></label></details>
    {costly && <label className="network-check"><input required type="checkbox" checked={traffic} onChange={(e) => setTraffic(e.target.checked)} />我有权使用目标并接受测试流量。iperf3 上传持续 10 秒，综合巡检流量更高。</label>}
    <button type="submit" className="network-primary-button" disabled={pending || (once && (!agent || missingTools.length > 0)) || (costly && !traffic)}>{pending ? "提交中…" : once ? "立即检测一次" : initial ? "保存修改" : "保存计划"}</button>
  </form>;
}
