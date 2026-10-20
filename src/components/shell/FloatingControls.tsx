import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { clsx } from "clsx";

// Closed by default: load preferences and their icons only on first expansion.
const FloatingControlsMenu = lazy(() => import("./FloatingControlsMenu"));

export function FloatingControls() {
  const [searchParams] = useSearchParams();
  // 在任何 node-store hook 跑之前先读路由:theme-manage 视图这里什么都不渲染,否则下面的 useNodeStoreStatus 会白启动实时节点轮询又立刻丢弃
  if (searchParams.get("view") === "theme-manage") {
    return null;
  }
  return <FloatingControlsInner />;
}

function FloatingControlsInner() {
  const { failureStreak } = useNodeStoreStatus();
  const [collapsed, setCollapsed] = useState(true);
  const [menuOpened, setMenuOpened] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (collapsed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCollapsed(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !controlsRef.current?.contains(event.target)
      )
        setCollapsed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [collapsed]);
  const showSyncWarning = failureStreak >= 2;
  const ToggleIcon = collapsed ? ChevronLeft : ChevronRight;

  return (
    <div
      ref={controlsRef}
      className={clsx(
        "floating-controls",
        collapsed && "is-collapsed",
        showSyncWarning && "has-warning",
      )}
    >
      <div className="floating-controls-inner">
        <div className="floating-controls-row">
          <div className="floating-controls-actions" aria-hidden={collapsed}>
            {menuOpened && (
              <Suspense fallback={null}>
                <FloatingControlsMenu hidden={collapsed} />
              </Suspense>
            )}
          </div>
          <button
            type="button"
            className="control-button floating-controls-trigger grid h-9 w-9 place-items-center"
            aria-label={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
            aria-expanded={!collapsed}
            onClick={() => {
              setMenuOpened(true);
              setCollapsed((value) => !value);
            }}
            title={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
          >
            <ToggleIcon size={16} />
            {showSyncWarning && collapsed && (
              <span className="floating-controls-warning-dot" aria-hidden />
            )}
          </button>
        </div>
        {showSyncWarning && !collapsed && (
          <div className="pointer-events-none flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--status-offline)_32%,transparent)] bg-[color-mix(in_srgb,var(--surface-a)_90%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--status-offline)] shadow-[0_10px_25px_-18px_rgba(0,0,0,0.8)] backdrop-blur">
            <AlertTriangle size={12} />
            <span>实时状态同步异常，当前展示的是最近缓存</span>
          </div>
        )}
      </div>
    </div>
  );
}
