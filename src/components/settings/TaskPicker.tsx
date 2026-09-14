import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { PingTask } from '@/types/komari';
export function TaskPicker({ tasks, ids, onChange }: { tasks: PingTask[]; ids: number[]; onChange: (ids: number[]) => void }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const names = new Map(tasks.map(task => [task.id, task.name || `任务 #${task.id}`]));
  const filtered = tasks.filter(task => `${task.name} ${task.id}`.toLowerCase().includes(search.toLowerCase()));
  const move = (index: number, delta: number) => { const next = [...ids]; const to = index + delta; if (to < 0 || to >= next.length) return; [next[index], next[to]] = [next[to], next[index]]; onChange(next); };
  return <div className="studio-task-picker"><section><label htmlFor={id}>选择探测任务</label><input id={id} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="按名称搜索任务"/><div className="studio-task-catalog">{filtered.map(task => <label key={task.id}><input type="checkbox" checked={ids.includes(task.id)} onChange={event => onChange(event.target.checked ? [...ids, task.id] : ids.filter(value => value !== task.id))}/><span>{names.get(task.id)}</span></label>)}{!filtered.length && <p>没有匹配任务。</p>}</div></section><section><h4>首页展示顺序 · {ids.length} 项</h4><p>按下方顺序展示，可用箭头调整。</p><ol>{ids.map((taskId, index) => <li key={taskId}><span>{index + 1}</span><strong>{names.get(taskId) ?? `任务 #${taskId}`}</strong><button type="button" aria-label={`上移 ${names.get(taskId)}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14}/></button><button type="button" aria-label={`下移 ${names.get(taskId)}`} disabled={index === ids.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14}/></button><button type="button" aria-label={`移除 ${names.get(taskId)}`} onClick={() => onChange(ids.filter(value => value !== taskId))}><X size={14}/></button></li>)}</ol>{!ids.length && <p>尚未选择任务；应用空列表会清除绑定。</p>}</section></div>;
}
