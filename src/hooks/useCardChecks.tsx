import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { CardChecksRegistry } from "./cardCheckContext";
import { cardCheckKey, isCheckFinished, type CardCheckModule } from "@/services/cardChecks";

const emptySubscribe = () => () => {};
export function useCardCheck(uuid: string, module: CardCheckModule, family: "4" | "6") {
  const context = useContext(CardChecksRegistry).controller, key = cardCheckKey(uuid,module,family);
  const subscribe = useCallback((fn: () => void) => context?.store.subscribeKey(key,fn) || emptySubscribe(), [context,key]);
  const snapshot = useCallback(() => context?.store.values[key], [context,key]);
  const entry = useSyncExternalStore(subscribe,snapshot,snapshot);
  const [celebrate,setCelebrate] = useState(false);
  useEffect(() => {
    const remaining = (entry?.finishedAt || 0) + 2500 - Date.now();
    if (remaining <= 0) { setCelebrate(false); return; }
    setCelebrate(true); const timer = setTimeout(() => setCelebrate(false),remaining);
    return () => clearTimeout(timer);
  }, [entry?.finishedAt]);
  return { entry: context?.allowed ? entry : undefined, allowed:context?.allowed === true, celebrate: celebrate && Boolean(entry?.finishedAt && Date.now() - entry.finishedAt < 2500),
    start: () => { void context?.start(uuid,module,family); }, busy: context?.allowed === true && Boolean(entry?.pending || entry?.syncing || (entry?.id && !isCheckFinished(entry.progress))) };
}
