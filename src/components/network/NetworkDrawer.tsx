import { useEffect, useId, useRef, type ReactNode } from "react";
import { Activity, X } from "lucide-react";
import "@/styles/network-observatory.css";

export function NetworkDrawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="network-drawer"
      aria-labelledby={id}
      onCancel={onClose}
    >
      <header>
        <span className="network-icon-tile">
          <Activity size={20} aria-hidden="true" />
        </span>
        <div>
          <small>ASTER / 网络观测</small>
          <h2 id={id}>{title}</h2>
        </div>
        <button type="button" aria-label="关闭面板" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="network-drawer-body">{children}</div>
    </dialog>
  );
}
