// One shared notification for canvas strips, including asynchronously loaded CSS.
let revision = 0;
const listeners = new Set<() => void>();
export function notifyPaletteChanged() { revision++; for (const listener of listeners) listener(); }
export function getPaletteRevision() { return revision; }
export function subscribePalette(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
