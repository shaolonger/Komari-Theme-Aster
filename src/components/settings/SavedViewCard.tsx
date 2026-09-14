import { useEffect, useRef, type ReactNode } from 'react';
import type { HomeSavedView } from '@/utils/homeVpsViews';
export function SavedViewCard({ view, isDefault, children, autoFocus = false }: { view: HomeSavedView; isDefault: boolean; children: ReactNode; autoFocus?: boolean }) {
  const card = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!autoFocus || !card.current) return;
    card.current.open = true;
    const input = card.current.querySelector<HTMLInputElement>('input[aria-label^="重命名视图"]');
    input?.focus({ preventScroll: true });
    input?.select();
    card.current.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [autoFocus]);
  return <details ref={card} className="studio-saved-view"><summary><span><strong>{view.name}</strong><small>{view.selectedNodeUuids.length ? `${view.selectedNodeUuids.length} 台指定节点` : '全部节点'} · {Object.keys(view.filters).length} 个筛选条件 · {view.sorts.length} 级排序</small></span>{isDefault && <em>默认视图</em>}<span className="studio-saved-view-hint">编辑</span></summary><div className="studio-saved-view-body">{children}</div></details>;
}
