import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import type { HomeFacetDimension } from '@/utils/homeVpsViews';
export function DimensionEditor({ dimensions, defaultId, builtIn, onDefaultChange, onAdd, onUpdate, onMove, onRemove }: {
  dimensions: HomeFacetDimension[]; defaultId: string; builtIn: Set<string>;
  onDefaultChange: (value: string) => void; onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Pick<HomeFacetDimension, 'label' | 'visible' | 'order'>>) => void;
  onMove: (id: string, direction: -1 | 1) => void; onRemove: (id: string) => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  return <section className="studio-dimensions"><header><div><h3>筛选维度</h3><p>设置首页筛选入口的名称、显示顺序和默认选项。</p></div><button type="button" className="studio-button" onClick={onAdd}><Plus size={14}/>新增维度</button></header>
    <label className="studio-dimension-default">首页默认维度<select value={defaultId} onChange={event => onDefaultChange(event.target.value)}>{dimensions.filter(item => item.visible).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <ol>{dimensions.map((item, index) => <li key={item.id}><div className="studio-dimension-row"><span className="studio-group-number">{index + 1}</span><label className="studio-dimension-name"><span>{builtIn.has(item.id) ? '内置维度' : '自定义维度'}</span><input aria-label={`第 ${index + 1} 个维度名称`} value={item.label} onChange={event => onUpdate(item.id, { label: event.target.value })}/></label><label className="studio-dimension-visible"><input type="checkbox" checked={item.visible} onChange={event => onUpdate(item.id, { visible: event.target.checked })}/>首页显示</label><div className="studio-dimension-actions"><button type="button" aria-label={`上移 ${item.label}`} disabled={index === 0} onClick={() => onMove(item.id, -1)}><ArrowUp size={16}/></button><button type="button" aria-label={`下移 ${item.label}`} disabled={index === dimensions.length - 1} onClick={() => onMove(item.id, 1)}><ArrowDown size={16}/></button>{!builtIn.has(item.id) && <button type="button" onClick={() => setRemoving(item.id)}>删除</button>}</div></div>
      {removing === item.id && <div className="studio-dimension-removal" role="alert"><p>删除“{item.label}”也会清除该维度的节点标签和保存视图筛选条件；相关分组会回到默认分组。保存前可通过页面上的“撤销修改”恢复。</p><button type="button" className="studio-button" onClick={() => setRemoving(null)}>保留维度</button><button type="button" className="studio-button is-danger" onClick={() => { onRemove(item.id); setRemoving(null); }}>删除维度及关联配置</button></div>}
    </li>)}</ol>
  </section>;
}
