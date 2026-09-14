import type { ThemeSettings } from '@/types/komari';
import { normalizeThemeSettings } from './themeSettings';
import { pickManagedThemeSettings } from './settingsStudioModel';

let draft: ThemeSettings | null = null;
const listeners = new Set<() => void>();
export const isStudioPreview = typeof window !== 'undefined' && window.parent !== window && new URLSearchParams(window.location.search).get('aster-preview') === '1';
if (isStudioPreview) {
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.type !== 'aster:preview-settings') return;
    if (!event.data.settings || typeof event.data.settings !== 'object' || Array.isArray(event.data.settings)) return;
    const next = pickManagedThemeSettings(normalizeThemeSettings(event.data.settings));
    if (JSON.stringify(next) !== JSON.stringify(draft)) {
      draft = next;
      for (const listener of listeners) listener();
    }
    window.parent.postMessage({ type: 'aster:preview-applied' }, window.location.origin);
  });
}
export function subscribeStudioPreview(listener: () => void) {
  if (!isStudioPreview) return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getStudioPreview() { return draft; }
