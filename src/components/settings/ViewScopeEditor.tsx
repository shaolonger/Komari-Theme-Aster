import { useId, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { FacetValuesInput } from './FacetValuesInput';
import type { AdminClient } from '@/types/komari';
import type { HomeFacetDimension, HomeFacetFilters } from '@/utils/homeVpsViews';

export function NodeScopeEditor({ nodes, selected, onChange, label, excluded = false }: {
  nodes: AdminClient[]; selected: string[]; onChange: (value: string[]) => void; label: string; excluded?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(30);
  const id = useId();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const known = useMemo(() => new Set(nodes.map(node => node.uuid)), [nodes]);
  const filtered = useMemo(() => nodes.filter(node => [node.name, node.group, node.region, node.uuid].some(value => value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()))), [nodes, search]);
  const update = (uuid: string, checked: boolean) => onChange(checked ? [...new Set([...selected, uuid])] : selected.filter(value => value !== uuid));
  return <fieldset className="studio-scope"><legend>{label}</legend>
    <p>{excluded ? '选中的节点不计入资产统计；未选择时全部纳入。' : '未选择节点时不限制范围；选择后仅包含这些节点。'}</p>
    <label className="aster-studio-search" htmlFor={id}><Search size={15}/><input id={id} type="search" value={search} onChange={event => { setSearch(event.target.value); setLimit(30); }} placeholder="搜索名称、地区或分组" /></label>
    <div className="studio-scope-actions"><span aria-live="polite">已选 {selected.length} · 匹配 {filtered.length}</span><button type="button" disabled={!filtered.length} onClick={() => onChange([...new Set([...selected, ...filtered.map(node => node.uuid)])])}>选择搜索结果</button><button type="button" disabled={!selected.length} onClick={() => onChange([])}>{excluded ? '清空节点选择' : '不限节点'}</button></div>
    <div className="studio-scope-list">{filtered.slice(0, limit).map(node => <label key={node.uuid}><input type="checkbox" checked={selectedSet.has(node.uuid)} onChange={event => update(node.uuid, event.target.checked)}/><span><strong>{node.name || node.uuid}</strong><small>{[node.region, node.group].filter(Boolean).join(' / ') || '未分组'}</small></span></label>)}
      {!filtered.length && <p role="status">没有匹配节点。</p>}
    </div>
    {filtered.length > limit && <button type="button" className="studio-button" onClick={() => setLimit(value => value + 30)}>再显示 30 个节点（共 {filtered.length} 个）</button>}
    {selected.filter(uuid => !known.has(uuid)).map(uuid => <div className="studio-scope-orphan" key={uuid}><span>暂不可用的节点：{uuid}</span><button type="button" aria-label={`移除不可用节点 ${uuid}`} onClick={() => update(uuid, false)}><X size={14}/></button></div>)}
  </fieldset>;
}

export function FacetScopeEditor({ dimensions, filters, onChange }: {
  dimensions: HomeFacetDimension[]; filters: HomeFacetFilters; onChange: (value: HomeFacetFilters) => void;
}) {
  const [newDimension, setNewDimension] = useState('');
  const [newValues, setNewValues] = useState('');
  const remaining = dimensions.filter(item => !(item.id in filters));
  const remove = (id: string) => { const next = { ...filters }; delete next[id]; onChange(next); };
  return <fieldset className="studio-scope"><legend>筛选条件</legend><p>不同维度同时满足；同一维度匹配任意一个值。</p>
    {Object.entries(filters).map(([id, values]) => <div key={id} className="studio-filter-row"><label><span>{dimensions.find(item => item.id === id)?.label ?? `不可用维度：${id}`}</span><FacetValuesInput label={`${dimensions.find(item => item.id === id)?.label ?? id} 的匹配值`} values={values} onChange={next => onChange({ ...filters, [id]: next })}/></label><button type="button" aria-label={`删除 ${dimensions.find(item => item.id === id)?.label ?? id} 筛选`} onClick={() => remove(id)}><X size={16}/></button></div>)}
    {!Object.keys(filters).length && <p>当前不限制维度。</p>}
    <select aria-label="添加筛选维度" value={newDimension} disabled={!remaining.length} onChange={event => setNewDimension(event.target.value)}><option value="">选择筛选维度…</option>{remaining.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    <label className="studio-filter-row"><input aria-label="新条件的匹配值" placeholder="输入匹配值，多个值用分号分隔" value={newValues} onChange={event => setNewValues(event.target.value)} /></label>
    <button className="studio-button" type="button" disabled={!remaining.some(item => item.id === newDimension) || !newValues.split(';').some(value => value.trim())} onClick={() => { onChange({ ...filters, [newDimension]: newValues.split(';').map(value => value.trim()).filter(Boolean) }); setNewDimension(''); setNewValues(''); }}>添加条件</button>
  </fieldset>;
}
