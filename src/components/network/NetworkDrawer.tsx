import { useEffect, useId, useRef, type ReactNode } from "react";
import "@/styles/network-observatory.css";
export function NetworkDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="network-drawer" aria-labelledby={id} onCancel={onClose}>
    <header><h2 id={id}>{title}</h2><button type="button" aria-label="关闭面板" onClick={onClose}>×</button></header>
    <div className="network-drawer-body">{children}</div>
  </dialog>;
}
