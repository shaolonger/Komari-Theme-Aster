import { useSyncExternalStore } from "react";

const key = "aster-luminous-favorites";
const event = "aster-luminous-favorites-change";
const empty: readonly string[] = [];
let raw: string | null | undefined;
let current: readonly string[] = empty;
let memoryOnly = false;
function snapshot() {
  if (memoryOnly) return current;
  let next: string | null = null;
  try {
    next = localStorage.getItem(key);
  } catch {
    return current;
  }
  if (next !== raw) {
    raw = next;
    try {
      const values: unknown = JSON.parse(next ?? "[]");
      current = Array.isArray(values)
        ? [
            ...new Set(
              values.filter(
                (value): value is string =>
                  typeof value === "string" && value.length > 0,
              ),
            ),
          ]
        : empty;
    } catch {
      current = empty;
    }
  }
  return current;
}
function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener("storage", listener);
  };
}
const inactive = () => () => {};
const getEmpty = () => empty;
export function useLuminousFavorites(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribe : inactive,
    enabled ? snapshot : getEmpty,
    getEmpty,
  );
}
export function toggleLuminousFavorite(uuid: string) {
  const values = new Set(snapshot());
  values.has(uuid) ? values.delete(uuid) : values.add(uuid);
  current = [...values];
  raw = JSON.stringify(current);
  try {
    localStorage.setItem(key, raw);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(event));
}
