import { useState } from 'react';
import { Info } from 'lucide-react';

export function StudioDiagnostics({ title, items }: { title: string; items: { title: string; detail: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;
  return <section className="studio-diagnostics" aria-label={title}>
    <header><Info size={18} aria-hidden="true"/><h3>{title}</h3><span>{items.length} 项</span></header>
    <ul>{(expanded ? items : items.slice(0, 6)).map((item, index) => <li key={`${index}:${item.title}`}><strong>{item.title}</strong><p>{item.detail}</p></li>)}</ul>
    {items.length > 6 && <button type="button" className="studio-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起诊断' : `查看其余 ${items.length - 6} 项`}</button>}
  </section>;
}
