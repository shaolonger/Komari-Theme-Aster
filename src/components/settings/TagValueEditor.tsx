import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { normalizeHomeFacetValues } from '@/utils/homeVpsViews';

export function TagValueEditor({ label, values, inherited, onChange }: { label: string; values: string[]; inherited: string[]; onChange: (values: string[]) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const commit = () => {
    const additions = normalizeHomeFacetValues(text);
    if (additions.length) onChange([...new Set([...values, ...additions])]);
    setText('');
  };
  return <div className="studio-tag-field"><label htmlFor={id}>{label}</label>
    <div className="studio-tag-values">{values.map(value => <span key={value}>{value}<button type="button" aria-label={`移除 ${label} 标签 ${value}`} onClick={() => onChange(values.filter(item => item !== value))}><X size={12}/></button></span>)}</div>
    <input id={id} value={text} placeholder="输入标签后按 Enter" aria-describedby={`${id}-hint`} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); } if (event.key === 'Escape') { event.preventDefault(); setText(''); } }}/>
    <small id={`${id}-hint`}>{values.length ? '点击 × 移除；移除全部后沿用节点资料。' : inherited.length ? `沿用节点资料：${inherited.join('、')}` : '暂无标签，添加后可用于首页筛选。'}</small>
  </div>;
}
