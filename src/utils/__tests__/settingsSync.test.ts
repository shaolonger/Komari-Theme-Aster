import { describe, expect, it } from 'vitest';
import { settingsSyncAction } from '../settingsSync';

describe('settings editor refresh', () => {
  it('initializes from the server', () => expect(settingsSyncAction(null, 'remote', true, false)).toBe('replace'));
  it('preserves local edits on an unchanged refresh', () => expect(settingsSyncAction('a', 'a', true, false)).toBe('keep'));
  it('requires conflict resolution rather than dropping local edits', () => expect(settingsSyncAction('a', 'b', true, false)).toBe('conflict'));
  it('refreshes an untouched editor', () => expect(settingsSyncAction('a', 'b', false, false)).toBe('replace'));
  it('waits for the save and its refresh to settle', () => expect(settingsSyncAction('a', 'b', true, true)).toBe('wait'));
});
