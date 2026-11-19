import { useCallback, useSyncExternalStore } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { subscribeMediaQuery } from "@/utils/mediaQuery";
import { usesCupertinoLayout, isDenseCardAppearance, isDenseNodeViewMode, isNodeViewMode, type DenseNodeViewMode, type NodeViewMode } from "@/utils/themeSettings";

// Legacy keys retained so session view-mode overrides survive the rename.
const DESKTOP_OVERRIDE_KEY = "komaritheme:node-view-mode-session:desktop";
const MOBILE_OVERRIDE_KEY = "komaritheme:node-view-mode-session:mobile";
const MOBILE_QUERY = "(max-width: 720px)";

interface ViewModeState {
  device: "desktop" | "mobile";
  override: NodeViewMode | null;
  denseOverride: DenseNodeViewMode | null;
}

const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;
let subscribedMediaQuery: MediaQueryList | null = null;
let snapshot: ViewModeState = {
  device: "desktop",
  override: null,
  denseOverride: null,
};

function readOverride(key: string): NodeViewMode | null {
  try {
    const value = sessionStorage.getItem(key);
    return isNodeViewMode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeOverride(key: string, value: NodeViewMode) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // session storage 不可用时，保留内存里的行为。
  }
}

function clearOverride(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // session storage 不可用时没什么可清的。
  }
}

function getMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  mediaQuery ??= window.matchMedia(MOBILE_QUERY);
  return mediaQuery;
}

function getDevice(): ViewModeState["device"] {
  return getMediaQuery()?.matches ? "mobile" : "desktop";
}

function getOverrideKey(device: ViewModeState["device"], dense = false) {
  const key = device === "mobile" ? MOBILE_OVERRIDE_KEY : DESKTOP_OVERRIDE_KEY;
  return dense ? key + ":cupertino-dense" : key;
}

function readSnapshot(): ViewModeState {
  const device = getDevice();
  const denseOverride = readOverride(getOverrideKey(device, true));
  return {
    device,
    override: readOverride(getOverrideKey(device)),
    denseOverride: isDenseNodeViewMode(denseOverride) ? denseOverride : null,
  };
}

function refreshSnapshot() {
  const next = readSnapshot();
  if (snapshot.device !== next.device || snapshot.override !== next.override || snapshot.denseOverride !== next.denseOverride) {
    snapshot = next;
  }
  return snapshot;
}

let snapshotInitialized = false;

function getSnapshot(): ViewModeState {
  // useSyncExternalStore 每次 render 都会调 getSnapshot，所以它必须便宜且稳定。
  // 只读一次 storage/matchMedia 来初始化缓存；之后由 media/storage/setMode
  // 处理器保持 snapshot 新鲜。
  if (!snapshotInitialized) {
    snapshotInitialized = true;
    refreshSnapshot();
  }
  return snapshot;
}

function emit() {
  for (const listener of listeners) listener();
}

const handleMediaChange = () => {
  refreshSnapshot();
  emit();
};

let mediaUnsubscribe: (() => void) | null = null;

function ensureMediaSubscription() {
  const mq = getMediaQuery();
  if (!mq || subscribedMediaQuery === mq) return;
  clearMediaSubscription();
  subscribedMediaQuery = mq;
  mediaUnsubscribe = subscribeMediaQuery(mq, handleMediaChange);
}

function clearMediaSubscription() {
  mediaUnsubscribe?.();
  mediaUnsubscribe = null;
  subscribedMediaQuery = null;
}

// 跨标签页同步 override。整个模块只注册一次（在第一个订阅者时），而不是每个 hook
// 实例都注册——所有消费者共享同一份全局状态，否则 N 个组件会装 N 个一样的 listener。
const handleStorage = (event: StorageEvent) => {
  if (event.key === null || event.key === getOverrideKey(snapshot.device) || event.key === getOverrideKey(snapshot.device, true)) {
    refreshSnapshot();
    emit();
  }
};
let storageListenerAttached = false;

function ensureStorageSubscription() {
  if (storageListenerAttached || typeof window === "undefined") return;
  window.addEventListener("storage", handleStorage);
  storageListenerAttached = true;
}

function clearStorageSubscription() {
  if (!storageListenerAttached || typeof window === "undefined") return;
  window.removeEventListener("storage", handleStorage);
  storageListenerAttached = false;
}

function subscribe(listener: () => void) {
  const wasEmpty = listeners.size === 0;
  listeners.add(listener);
  if (wasEmpty) {
    ensureMediaSubscription();
    ensureStorageSubscription();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearMediaSubscription();
      clearStorageSubscription();
    }
  };
}

export function useViewMode() {
  const themeSettings = useThemeSettings();
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { appearance } = usePreferences();
  const dense = isDenseCardAppearance(appearance);
  const defaultMode: NodeViewMode = dense
    ? "compact"
    : (appearance === "luminous" || usesCupertinoLayout(appearance)) && themeSettings.defaultAppearance !== appearance
      ? state.device === "mobile" ? "compact" : "standard"
      : state.device === "mobile"
        ? themeSettings.mobileNodeViewMode
        : themeSettings.desktopNodeViewMode;
  const override = dense ? state.denseOverride : state.override;
  const mode = override ?? defaultMode;

  const setMode = useCallback(
    (next: NodeViewMode) => {
      if (dense && !isDenseNodeViewMode(next)) return;
      const key = getOverrideKey(state.device, dense);
      // 选中当前主题默认值时，清掉 session override 重新跟随默认值，而不是钉一个
      // 永远去不掉的 override（那样还会让未来的默认值变化无法生效）。
      if (next === defaultMode) {
        clearOverride(key);
      } else {
        writeOverride(key, next);
      }
      refreshSnapshot();
      emit();
    },
    [state.device, defaultMode, dense],
  );

  return {
    device: state.device,
    mode,
    defaultMode,
    isOverridden: override != null,
    setMode,
  };
}

// 给用不了 hook 的场景做非响应式读取（如 class ErrorBoundary 的诊断）。返回
// device + 任意 session override；不含主题默认值，因为解析它需要 themeSettings（一个
// hook），但 device + override 在常见情况下已能区分 compact 和 large。
export function readViewModeHint(): string {
  try {
    const state = readSnapshot();
    const { device } = state;
    const override = isDenseCardAppearance(document.documentElement.dataset.themeStyle) ? state.denseOverride : state.override;
    return override ? `${device}/${override}(override)` : `${device}/default`;
  } catch {
    return "unknown";
  }
}
