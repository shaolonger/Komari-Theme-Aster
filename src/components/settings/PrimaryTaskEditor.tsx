import { useId, useState } from 'react';
import type { HomepagePingClientBindingRow } from '@/utils/homepagePingBindingRows';
export function PrimaryTaskEditor({ rows, onChange }: { rows: HomepagePingClientBindingRow[]; onChange: (uuid: string, taskId: number | null) => void }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(30);
  const filtered = rows.filter(row => `${row.name} ${row.group} ${row.region}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="studio-primary-tasks"><h3>每个节点的主线路</h3><p>仅在“关注主线路”策略下优先使用。未指定或无样本时自动使用风险优先结果。</p><label htmlFor={id}>查找节点</label><input id={id} type="search" value={search} onChange={event => { setSearch(event.target.value); setLimit(30); }} placeholder="节点名称、地区或分组"/><div className="studio-primary-list">{filtered.slice(0, limit).map(row => <label key={row.uuid}><span><strong>{row.name}</strong><small>{row.group || row.region || '未分组'} · {row.tasks.length} 项探测</small></span><select aria-label={`设置 ${row.name} 的首页 Ping 主任务`} value={row.primaryTaskId ?? ''} onChange={event => onChange(row.uuid, event.target.value ? Number(event.target.value) : null)}><option value="">自动选择</option>{row.tasks.map(task => <option key={task.taskId} value={task.taskId}>{task.name}</option>)}</select></label>)}</div>{!filtered.length && <p role="status">{rows.length ? '没有匹配节点。' : '先为节点绑定探测任务，再选择主线路。'}</p>}{filtered.length > limit && <button type="button" className="studio-button" onClick={() => setLimit(value => value + 30)}>再显示 30 个节点</button>}</section>;
}
