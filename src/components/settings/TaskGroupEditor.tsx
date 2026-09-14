import { useId, useState } from 'react';
import type { PingTask } from '@/types/komari';
import type { HomepagePingTaskGroups } from '@/utils/homepagePingSettings';
export function TaskGroupEditor({ tasks, groups, onChange }: { tasks: PingTask[]; groups: HomepagePingTaskGroups; onChange: (value: HomepagePingTaskGroups) => void }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(30);
  const filtered = tasks.filter(task => `${task.name} ${groups[task.id] ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const suggestions = [...new Set(Object.values(groups).filter(Boolean))];
  return <section className="studio-task-groups"><header><h3>探测任务的展示分组</h3><p>用分组名称标记用途，例如运营商或地区。此设置不会改变任务的执行或排列顺序。</p></header><label htmlFor={id}>查找任务或分组</label><input id={id} type="search" value={search} onChange={event => { setSearch(event.target.value); setLimit(30); }} placeholder="搜索探测任务"/><datalist id={`${id}-groups`}>{suggestions.map(value => <option key={value} value={value}/>)}</datalist><div className="studio-task-group-list">{filtered.slice(0, limit).map(task => <label key={task.id}><span>{task.name || `任务 ${task.id}`}</span><input aria-label={`设置 ${task.name} 的展示分组`} list={`${id}-groups`} placeholder="不分组" value={groups[task.id] ?? ''} onChange={event => { const next = { ...groups }; if (event.target.value) next[task.id] = event.target.value; else delete next[task.id]; onChange(next); }}/></label>)}</div>{!filtered.length && <p role="status">没有匹配的任务。</p>}{filtered.length > limit && <button type="button" className="studio-button" onClick={() => setLimit(value => value + 30)}>再显示 30 项任务</button>}</section>;
}
