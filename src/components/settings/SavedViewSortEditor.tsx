import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_VPS_LIST_SORTS, VPS_LIST_SORT_KEYS, VPS_LIST_SORT_LABELS, recommendedVpsListSortDirection, type VpsListSortCondition, type VpsListSortKey } from '@/utils/vpsListSort';

export function SavedViewSortEditor({ viewName, sorts, onChange }: { viewName: string; sorts: VpsListSortCondition[]; onChange: (sorts: VpsListSortCondition[]) => void }) {
  const [announcement, setAnnouncement] = useState('');
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= sorts.length) return;
    const next = [...sorts];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    setAnnouncement(`${VPS_LIST_SORT_LABELS[sorts[index].key]} 已移至第 ${target + 1} 优先级`);
  }
  function update(index: number, patch: Partial<VpsListSortCondition>) {
    const next = sorts.map((item, position) => position === index ? { ...item, ...patch } : item);
    if (new Set(next.map(item => item.key)).size === next.length) onChange(next);
  }
  return <section className="studio-sort-editor" aria-label={`${viewName} 的列表排序`}>
    <header><div><h3>比较顺序</h3><p>先按第一项排序；值相同时，再比较下一项。</p></div><button type="button" disabled={sorts.length >= VPS_LIST_SORT_KEYS.length} onClick={() => {
      const key = VPS_LIST_SORT_KEYS.find(candidate => !sorts.some(item => item.key === candidate));
      if (key) onChange([...sorts, { key, direction: recommendedVpsListSortDirection(key) }]);
    }}><Plus size={16}/>添加条件</button></header>
    <ol>{sorts.map((condition, index) => <li key={condition.key}>
      <span className="studio-sort-number" aria-hidden="true">{index + 1}</span>
      <label>比较字段<select value={condition.key} aria-label={`${viewName} 的第 ${index + 1} 个排序字段`} onChange={event => {
        const key = event.target.value as VpsListSortKey;
        update(index, { key, direction: recommendedVpsListSortDirection(key) });
      }}>{VPS_LIST_SORT_KEYS.map(key => <option key={key} value={key} disabled={sorts.some((item, position) => position !== index && item.key === key)}>{VPS_LIST_SORT_LABELS[key]}</option>)}</select></label>
      <label>方向<select value={condition.direction} aria-label={`${viewName} 的第 ${index + 1} 个排序方向`} onChange={event => update(index, { direction: event.target.value as 'asc' | 'desc' })}><option value="asc">从小到大 / A–Z</option><option value="desc">从大到小 / Z–A</option></select></label>
      <div className="studio-sort-actions"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`提高 ${VPS_LIST_SORT_LABELS[condition.key]} 优先级`}><ArrowUp size={16}/></button><button type="button" disabled={index === sorts.length - 1} onClick={() => move(index, 1)} aria-label={`降低 ${VPS_LIST_SORT_LABELS[condition.key]} 优先级`}><ArrowDown size={16}/></button><button type="button" disabled={sorts.length === 1} onClick={() => onChange(sorts.filter((_, position) => position !== index))} aria-label={`移除 ${VPS_LIST_SORT_LABELS[condition.key]}`}><X size={16}/></button></div>
    </li>)}</ol>
    <footer><span>至少保留一个比较字段。</span><button type="button" onClick={() => { onChange(DEFAULT_VPS_LIST_SORTS.map(item => ({ ...item }))); setAnnouncement('已恢复默认比较顺序'); }}>恢复默认顺序</button></footer>
    <span className="sr-only" role="status">{announcement}</span>
  </section>;
}
