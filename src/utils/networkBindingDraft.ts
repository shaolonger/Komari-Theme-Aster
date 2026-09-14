import { normalizeHomepagePingTaskOrder, type HomepagePingTaskBindings, type HomepagePingTaskOrder } from './pingTasks';
export function assignNetworkTasks(bindings: HomepagePingTaskBindings, order: HomepagePingTaskOrder, uuids: string[], ids: number[], append = false) {
  const resolved = normalizeHomepagePingTaskOrder(order, bindings);
    const next = Object.fromEntries(Object.entries(bindings).map(([id, nodes]) => [id, [...nodes]]));
    const nextOrder = { ...resolved };
    for (const uuid of uuids) {
      const sequence = [...new Set(append ? [...(resolved[uuid] ?? []), ...ids] : ids)];
      for (const key of Object.keys(next)) next[key] = next[key].filter((node) => node !== uuid);
      for (const id of sequence) next[id] = [...(next[id] ?? []), uuid];
      nextOrder[uuid] = sequence;
    }
  return { bindings: next, order: nextOrder };
}
