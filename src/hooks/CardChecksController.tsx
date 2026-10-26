import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "./useAuth";
import { CardChecksRegistry, type Entry } from "./cardCheckContext";
import { cardCheckKey, getCardChecks, isCheckFinished, startCardCheck, type CardCheckModule, type CardProgress } from "@/services/cardChecks";
class CheckStore {
  values: Record<string, Entry> = {};
  listeners = new Set<() => void>();
  keys = new Map<string, Set<() => void>>();
  getAll = () => this.values;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeKey = (key: string, listener: () => void) => {
    if (!this.keys.has(key)) this.keys.set(key, new Set());
    this.keys.get(key)!.add(listener);
    return () => { this.keys.get(key)?.delete(listener); if (!this.keys.get(key)?.size) this.keys.delete(key); };
  };
  update(patches: Record<string, Entry>) {
    this.values = { ...this.values, ...patches };
    Object.keys(patches).forEach(key => this.keys.get(key)?.forEach(fn => fn()));
    this.listeners.forEach(fn => fn());
  }
  clear() { const keys = Object.keys(this.values); this.values = {}; keys.forEach(k => this.keys.get(k)?.forEach(fn => fn())); this.listeners.forEach(fn => fn()); }
}


const sessionKey = "aster-card-checks-v1";
const savedSchema = z.array(z.object({ nodeUuid: z.string().max(80), id: z.string().max(80), module: z.enum(["routes", "china-speed"]),
  family: z.enum(["4", "6"]), createdAt: z.number() })).max(256);
function initialStore() {
  const store = new CheckStore();
  try {
    const parsed = savedSchema.safeParse(JSON.parse(sessionStorage.getItem(sessionKey) || "[]"));
    if (parsed.success) for (const entry of parsed.data.filter(e => Date.now() - e.createdAt < 6 * 3600_000)) store.values[cardCheckKey(entry.nodeUuid, entry.module, entry.family)] = entry;
  } catch { /* Storage may be unavailable; starting never depends on it. */ }
  return store;
}
export default function CardChecksController() {
  const { register } = useContext(CardChecksRegistry);
  const { data: me } = useAuth(), allowed = me?.logged_in === true;
  const [store] = useState(initialStore), queryClient = useQueryClient();
  const refreshFlight = useRef<Promise<void> | null>(null);
  const refreshKinds = useRef(new Set<CardCheckModule>());
  const refreshResults = useCallback((modules: CardCheckModule[]) => {
    modules.forEach(module => refreshKinds.current.add(module));
    if (!refreshFlight.current) refreshFlight.current = (async () => {
      try {
        while (refreshKinds.current.size) {
          await new Promise(resolve => setTimeout(resolve,200));
          const kinds = [...refreshKinds.current]; refreshKinds.current.clear();
          await Promise.allSettled(kinds.map(kind => queryClient.invalidateQueries({queryKey:[kind === "routes" ? "home-carrier-routes" : "home-carrier-speeds",true]})));
        }
      } finally { refreshFlight.current = null; }
    })();
    return refreshFlight.current;
  }, [queryClient]);
  const all = useSyncExternalStore(store.subscribe, store.getAll, store.getAll);
  const refs = Object.values(all).filter(e => e.id && !isCheckFinished(e.progress));
  const status = useQuery({ queryKey: ["card-check-progress", refs.map(e => e.id).sort().join(",")],
    queryFn: ({ signal }) => getCardChecks(refs.map(e => ({ nodeUuid: e.nodeUuid, id: e.id! })), signal),
    enabled: allowed && refs.length > 0, retry: false, refetchInterval: 5000, refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  const apply = useCallback(async (rows: CardProgress[]) => {
    const patches: Record<string, Entry> = {}, finished: string[] = [];
    for (const progress of rows) {
      const found = Object.entries(store.values).find(([, e]) => e.nodeUuid === progress.nodeUuid && e.id === progress.id);
      if (!found) continue;
      const [key, entry] = found;
      if (entry.finishedAt || (isCheckFinished(entry.progress) && entry.syncing)) continue;
      patches[key] = { ...entry, progress, pending: false, pollError: false, syncing: isCheckFinished(progress) };
      if (isCheckFinished(progress)) finished.push(key);
    }
    if (Object.keys(patches).length) store.update(patches);
    if (finished.length) {
      await refreshResults(finished.map(key => patches[key].module));
      const done: Record<string, Entry> = {};
      for (const key of finished) {
        const entry = store.values[key];
        if (entry?.id === patches[key].id) done[key] = { ...entry, syncing: false, finishedAt: Date.now() };
      }
      if (Object.keys(done).length) store.update(done);
    }
  }, [store, refreshResults]);
  useEffect(() => { if (status.data) void apply(status.data); }, [status.data, status.dataUpdatedAt, apply]);
  useEffect(() => {
    if (!status.isError || !allowed) return;
    const patches = Object.fromEntries(Object.entries(store.values).filter(([, e]) => e.id && !isCheckFinished(e.progress)).map(([key,e]) => [key,{...e,pollError:true}]));
    if (Object.keys(patches).length) store.update(patches);
  }, [status.isError, allowed, store]);
  useEffect(() => { if (me && !allowed) { store.clear(); try { sessionStorage.removeItem(sessionKey); } catch { /* optional */ } } }, [me, allowed, store]);
  const persistence = useRef("");
  useEffect(() => {
    if (!allowed) return;
    const saved = Object.values(all).filter(e => e.id && !isCheckFinished(e.progress)).slice(-256).map(e => ({ nodeUuid:e.nodeUuid,id:e.id,module:e.module,family:e.family,createdAt:e.createdAt }));
    const text = JSON.stringify(saved);
    if (text !== persistence.current) { persistence.current = text; try { sessionStorage.setItem(sessionKey,text); } catch { /* optional */ } }
  }, [all, allowed]);
  const start = useCallback(async (uuid: string, module: CardCheckModule, family: "4" | "6") => {
    if (!allowed) return;
    const key = cardCheckKey(uuid,module,family), previous = store.values[key];
    if (previous?.pending || (previous?.id && !isCheckFinished(previous.progress)) || previous?.syncing) return;
    store.update({ [key]: { nodeUuid:uuid,module,family,pending:true,createdAt:Date.now() } });
    try {
      const progress = await startCardCheck(uuid,module,family), entry = store.values[key];
      if (!entry) return;
      store.update({ [key]: { ...entry,id:progress.id,pending:false } });
      await apply([progress]);
    } catch (error) {
      const entry=store.values[key];
      if (entry) store.update({ [key]: { ...entry,pending:false,error:error instanceof Error ? error.message : "检测启动失败" } });
    }
  }, [allowed,store,apply]);
  const value = useMemo(() => ({ store,allowed,start }), [store,allowed,start]);
  useEffect(() => { register(value); return () => register(null); }, [register, value]);
  return null;
}
