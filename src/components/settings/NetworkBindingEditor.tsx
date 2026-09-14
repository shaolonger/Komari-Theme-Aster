import { assignNetworkTasks } from "@/utils/networkBindingDraft";
import { TaskPicker } from "./TaskPicker";
import { useState } from "react";
import type { AdminClient, PingTask } from "@/types/komari";
import { normalizeHomepagePingTaskOrder, type HomepagePingTaskBindings, type HomepagePingTaskOrder } from "@/utils/pingTasks";

export function NetworkBindingEditor({ clients, tasks, bindings, order, onChange }: {
  clients: AdminClient[];
  tasks: PingTask[];
  bindings: HomepagePingTaskBindings;
  order: HomepagePingTaskOrder;
  onChange: (bindings: HomepagePingTaskBindings, order: HomepagePingTaskOrder) => void;
}) {
  const [limit, setLimit] = useState(30);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [batchTasks, setBatchTasks] = useState<number[]>([]);
  const resolved = normalizeHomepagePingTaskOrder(order, bindings);
  const visible = clients.filter((client) => `${client.name} ${client.uuid} ${client.group} ${client.region}`.toLowerCase().includes(search.toLowerCase()));
  const taskNames = new Map(tasks.map((task) => [task.id, task.name || `任务 #${task.id}`]));
  function assign(uuids: string[], ids: number[], append = false) {
    const { bindings: next, order: nextOrder } = assignNetworkTasks(bindings, order, uuids, ids, append);
    onChange(next, nextOrder);
    setNotice(`已更新 ${uuids.length} 台节点的草稿，保存设置后生效。`);
  }
  function picker(ids: number[], update: (ids: number[]) => void) {
    return <TaskPicker tasks={tasks} ids={ids} onChange={update}/>;
  }

  return <div className="studio-bindings">
    <input className="surface-inset p-3 text-sm" aria-label="搜索要配置的 VPS" placeholder="搜索 VPS 名称 / UUID / 分组 / 地区" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(30); }} />
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button type="button" className="studio-button is-compact" onClick={() => setSelected([...new Set([...selected, ...visible.map((client) => client.uuid)])])}>选择当前结果</button>
      <button type="button" className="studio-button is-compact" onClick={() => setSelected([])}>取消选择</button>
      <span>已选 {selected.length} 台 · 共 {clients.length} 台 VPS</span>
    </div>
    {notice && <p className="studio-binding-notice" role="status">{notice}</p>}
    {selected.length > 0 && <div className="studio-binding-batch">
      <strong className="text-sm">批量配置 {selected.length} 台 VPS</strong>
      <p className="text-xs text-[var(--text-tertiary)]">勾选任务后可调整顺序；替换会覆盖所选 VPS 的现有展示配置，追加会保留原有顺序。</p>
      {picker(batchTasks, setBatchTasks)}
      <div className="flex gap-2">
        <button type="button" className="studio-button is-compact" onClick={() => assign(selected, batchTasks)}>替换所选 VPS 的任务</button>
        <button type="button" className="studio-button is-compact" disabled={!batchTasks.length} onClick={() => assign(selected, batchTasks, true)}>追加任务</button>
      </div>
    </div>}
    {visible.slice(0, limit).map((client) => <section key={client.uuid} className="studio-binding-node">
      <div className="flex items-center gap-3">
        <input type="checkbox" aria-label={`选择 ${client.name}`} checked={selected.includes(client.uuid)} onChange={(event) => setSelected(event.target.checked ? [...selected, client.uuid] : selected.filter((uuid) => uuid !== client.uuid))} />
        <div className="min-w-0 flex-1"><strong className="block truncate text-sm">{client.name || client.uuid}</strong><span className="text-xs text-[var(--text-tertiary)]">{client.group || client.region} · {(resolved[client.uuid] ?? []).length} 个任务</span></div>
        <button type="button" className="studio-button is-compact" aria-expanded={editing === client.uuid} onClick={() => setEditing(editing === client.uuid ? null : client.uuid)}>{editing === client.uuid ? "收起" : "配置任务"}</button>
      </div>
      {editing === client.uuid ? <div className="mt-3">{picker(resolved[client.uuid] ?? [], (ids) => assign([client.uuid], ids))}</div> : <p className="mt-2 text-xs text-[var(--text-secondary)]">{(resolved[client.uuid] ?? []).map((id) => taskNames.get(id) ?? `任务 #${id}`).join(" → ") || "未配置：卡片不显示延迟任务"}</p>}
    </section>)}
    {visible.length > limit && <button type="button" className="studio-button" onClick={() => setLimit(value => value + 30)}>再显示 30 台节点</button>}
    {!visible.length && <p className="p-3 text-sm">没有匹配的 VPS。</p>}
  </div>;
}
