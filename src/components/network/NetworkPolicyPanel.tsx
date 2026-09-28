import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { applyNetworkPolicies, deleteNetworkPolicy, getNetworkCatalog, previewNetworkPolicies, updateNetworkPolicy, type ApplyNetworkPolicies, type NetworkPolicy, type NetworkPreview } from "@/services/networkObservatory";
import { intervalName, MODES, networkGuide } from "./shared";
import "@/styles/network-observatory.css";

export function NetworkPolicyPanel({ initialNodes = [], onApplied }: { initialNodes?: string[]; onApplied?: () => void }) {
  const { data: me } = useAuth();
  const cache = useQueryClient();
  const catalog = useQuery({ queryKey: ["network-catalog"], queryFn: getNetworkCatalog, enabled: me?.logged_in === true, staleTime: 30_000, retry: false });
  const [presets, setPresets] = useState<string[]>(["basic"]);
  const [clients, setClients] = useState(initialNodes), [groups, setGroups] = useState<string[]>([]);
  const [inherit, setInherit] = useState(true), [search, setSearch] = useState("");
  const [settings, setSettings] = useState<NonNullable<ApplyNetworkPolicies["settingsByPreset"]>>({});
  const [trafficAccepted, setTrafficAccepted] = useState(false);
  const [preview, setPreview] = useState<NetworkPreview | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [editing, setEditing] = useState<NetworkPolicy | null>(null);
  const resetPreview = () => { setPreview(null); setMessage(""); };
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  async function action(operation: () => Promise<unknown>, success: string, refresh = false) {
    setPending(true); setError("");
    try { await operation(); if (success) setMessage(success); if (refresh) { await cache.invalidateQueries({ queryKey: ["network-catalog"] }); await cache.invalidateQueries({ queryKey: ["node-network"] }); onApplied?.(); } }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setPending(false); }
  }
  if (!me?.logged_in) return <p>请以管理员身份登录后配置网络检测。</p>;
  if (catalog.isPending) return <p role="status">正在读取检测方案…</p>;
  if (!catalog.data) return <div className="network-empty-state"><p>请安装并启用网络观测插件 v1.2.0 或以上版本，再打开方案管理。</p><p role="alert">{catalog.error?.message}</p><a href={networkGuide} target="_blank" rel="noreferrer">查看安装指南</a><button type="button" onClick={() => void catalog.refetch()}>重试</button></div>;
  const data = catalog.data;
  const selected = data.presets.filter((preset) => presets.includes(preset.id));
  const input: ApplyNetworkPolicies = { presetIds: presets, clients, groups: inherit ? groups : [], inherit, settingsByPreset: settings, trafficAccepted };
  const matched = data.inventory.filter((node) => clients.includes(node.uuid) || (inherit && groups.includes(node.group)));
  const groupNames = [...new Set(data.inventory.map((node) => node.group).filter(Boolean))].sort();
  const options = data.inventory.filter((node) => `${node.name} ${node.group}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="network-policy-panel">
    <p className="network-help">选择方案和 VPS，预览后应用。配置直接保存到网络插件，无需点击工作室顶部保存。</p>
    {data.inventoryError && <p className="network-form-error" role="alert">{data.inventoryError}。请在插件管理批准系统 RPC 权限后重试同步。</p>}
    <div className="network-preset-grid">{data.presets.map((preset) => <label className="network-preset" key={preset.id} data-selected={presets.includes(preset.id)}>
      <input type="checkbox" checked={presets.includes(preset.id)} onChange={() => { setPresets(toggle(presets, preset.id)); resetPreview(); }} />
      <span><strong>{preset.name}</strong><small>{preset.description}</small><small>需要 {preset.requirement} · {preset.items.length} 项检测</small></span>
    </label>)}</div>
    <div className="network-form">{selected.map((preset) => <fieldset key={preset.id}><legend>{preset.name}</legend>
      <label>检测频率<select value={settings[preset.id]?.intervalMinutes || preset.items[0].intervalMinutes} onChange={(e) => { setSettings({ ...settings, [preset.id]: { ...settings[preset.id], intervalMinutes: Number(e.target.value) } }); resetPreview(); }}>{MODES.find((m) => m.id === preset.items[0].mode)!.intervals.map((n) => <option key={n} value={n}>{intervalName(n)}</option>)}</select></label>
      {preset.customTarget && <div className="network-form-pair"><label>目标主机<input placeholder="域名或 IP，不含协议和路径" value={settings[preset.id]?.target || ""} onChange={(e) => { setSettings({ ...settings, [preset.id]: { ...settings[preset.id], target: e.target.value } }); resetPreview(); }} /></label><label>端口<input type="number" min={1} max={65535} value={settings[preset.id]?.port || preset.items[0].port} onChange={(e) => { setSettings({ ...settings, [preset.id]: { ...settings[preset.id], port: Number(e.target.value) } }); resetPreview(); }} /></label></div>}
      <details><summary>目标与来源 · {data.version}</summary><ul>{preset.items.map((item) => <li key={item.id}>{item.name}：{item.target === "default" ? "本地工具默认目标集" : item.target || "自定义目标"}</li>)}</ul>{preset.source && <a href={preset.source} target="_blank" rel="noreferrer">查看公开来源</a>}<p>目标库随插件发布。已有方案保留版本，编辑并保存时更新到当前目录版本。</p></details>
    </fieldset>)}</div>
    {selected.some((p) => p.traffic) && <label className="network-check"><input type="checkbox" checked={trafficAccepted} onChange={(e) => { setTrafficAccepted(e.target.checked); resetPreview(); }} />我有权使用该测速端点，并接受每天 10 秒上传产生的流量。</label>}
    <label className="network-check"><input type="checkbox" checked={inherit} onChange={(e) => { setInherit(e.target.checked); resetPreview(); }} />继承方案，后续集中更新（取消后复制为独立计划）</label>
    {inherit && <div className="network-scope-groups"><strong>自动继承 Komari 分组</strong>{groupNames.map((group) => <label className="network-check" key={group}><input type="checkbox" checked={groups.includes(group)} onChange={() => { setGroups(toggle(groups, group)); resetPreview(); }} />{group}</label>)}<p className="network-help">插件每分钟同步分组；新节点接入后自动执行。单机覆盖保留，不随方案更新。</p></div>}
    <div className="network-form"><label>选择 VPS<input type="search" placeholder="搜索名称或分组" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
    <div className="network-actions"><button type="button" onClick={() => { setClients([...new Set([...clients, ...options.map((n) => n.uuid)])]); resetPreview(); }}>选择搜索结果</button><button type="button" onClick={() => { setClients([]); setGroups([]); resetPreview(); }}>清空选择</button><span>匹配 {matched.length} 台</span></div>
    <div className="network-node-picker">{options.map((node) => <label className="network-check" key={node.uuid}><input type="checkbox" checked={clients.includes(node.uuid)} onChange={() => { setClients(toggle(clients, node.uuid)); resetPreview(); }} /><span>{node.name}<small>{node.group || "未分组"} · {data.nodes.some((n) => n.uuid === node.uuid) ? "已登记" : "未接入"}</small></span></label>)}</div>
    <div className="network-actions"><button type="button" disabled={pending || !presets.length || (!matched.length && !groups.length) || Boolean(data.inventoryError)} onClick={() => void action(async () => { setPreview(await previewNetworkPolicies(input)); }, "")}>预览应用范围</button>{preview && <button type="button" className="network-primary-button" disabled={pending} onClick={() => void action(async () => { const result = await applyNetworkPolicies(input); setPreview(null); setMessage(`应用成功，新增 ${result.added} 条计划。新计划将在接入且工具就绪后错峰执行。`); }, "", true)}>确认应用</button>}</div>
    {preview && <div className="network-preview" role="status"><strong>{preview.planCount} 条计划 · 新增 {preview.added} · 已存在 {preview.unchanged}</strong><ul>{preview.nodes.map((node) => <li key={node.uuid}>{node.name} · {node.planCount} 项 · {node.state}</li>)}</ul><p>未接入或缺少依赖的节点保留配置，具备条件后再执行。</p></div>}
    {error && <p className="network-form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <details className="network-policy-library"><summary>管理已有方案（{data.policies.length}）</summary>{data.policies.map((policy) => <article key={policy.id} className="network-policy-row"><div><strong>{policy.name}</strong><small>{policy.enabled ? "启用" : "暂停"} · {intervalName(policy.settings.intervalMinutes)} · {policy.groups.join("、") || `${policy.clients.length} 台指定 VPS`} · {policy.catalogVersion}</small></div><div className="network-actions"><button type="button" disabled={pending} onClick={() => setEditing(policy)}>编辑</button><button type="button" disabled={pending} onClick={() => void action(() => updateNetworkPolicy({ ...policy, enabled: !policy.enabled }), "方案状态已更新", true)}>{policy.enabled ? "暂停" : "恢复"}</button><button type="button" disabled={pending} onClick={() => { if (window.confirm("删除此方案及其继承计划？单机自定义计划和历史结果会保留。")) void action(() => deleteNetworkPolicy(policy), "方案已删除", true); }}>删除</button></div></article>)}</details>
    {editing && <form className="network-form network-policy-edit" onSubmit={(e) => { e.preventDefault(); void action(async () => { await updateNetworkPolicy(editing); setEditing(null); }, "继承计划已更新，单机覆盖保持不变", true); }}><strong>编辑 {editing.name}</strong><fieldset><legend>应用范围（VPS 与分组取并集）</legend><div className="network-scope-groups">{groupNames.map((group) => <label className="network-check" key={group}><input type="checkbox" checked={editing.groups.includes(group)} onChange={() => setEditing({ ...editing, groups: toggle(editing.groups, group) })} />{group}</label>)}</div><div className="network-node-picker">{data.inventory.map((node) => <label className="network-check" key={node.uuid}><input type="checkbox" checked={editing.clients.includes(node.uuid)} onChange={() => setEditing({ ...editing, clients: toggle(editing.clients, node.uuid) })} />{node.name}<small> · {node.group || "未分组"}</small></label>)}</div></fieldset><label>方案名称<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label><label>频率<select value={editing.settings.intervalMinutes} onChange={(e) => setEditing({ ...editing, settings: { ...editing.settings, intervalMinutes: Number(e.target.value) } })}>{MODES.find((m) => m.id === data.presets.find((p) => p.id === editing.presetId)!.items[0].mode)!.intervals.map((n) => <option key={n} value={n}>{intervalName(n)}</option>)}</select></label>{data.presets.find((p) => p.id === editing.presetId)?.customTarget && <><label>目标<input required value={editing.settings.target} onChange={(e) => setEditing({ ...editing, settings: { ...editing.settings, target: e.target.value } })} /></label><label>端口<input type="number" min={1} max={65535} required value={editing.settings.port} onChange={(e) => setEditing({ ...editing, settings: { ...editing.settings, port: Number(e.target.value) } })} /></label></>}<div className="network-actions"><button type="submit" disabled={pending}>更新所有继承节点</button><button type="button" onClick={() => setEditing(null)}>取消编辑</button></div></form>}
  </div>;
}
