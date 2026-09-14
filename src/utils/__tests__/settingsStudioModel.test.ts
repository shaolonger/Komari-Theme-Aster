import { describe, expect, it } from 'vitest';
import { buildStudioPayload, managedSettingsSignature, summarizeStudioChanges } from '../settingsStudioModel';

describe('studio settings boundary', () => {
  it('preserves settings outside the editor when publishing a draft', () => {
    const server = { enableAdminButton: false, vendorOption: { token: 'retained' } };
    const next = buildStudioPayload(server, { defaultAppearance: 'dark', vendorOption: 'must not overwrite' });
    expect(next.defaultAppearance).toBe('dark');
    expect(next.enableAdminButton).toBe(false);
    expect(next.vendorOption).toEqual({ token: 'retained' });
    expect(server).toEqual({ enableAdminButton: false, vendorOption: { token: 'retained' } });
  });
  it('ignores unmanaged changes when deciding whether the editor is dirty', () => {
    expect(managedSettingsSignature({ enableAdminButton: true })).toBe(managedSettingsSignature({ enableAdminButton: false }));
  });
  it('does not report conflicts when nested object keys arrive in a different order', () => {
    expect(managedSettingsSignature({ homeNodeFacets: { 'node-b': { provider: ['A'], region: ['US'] }, 'node-a': { provider: ['B'] } } })).toBe(managedSettingsSignature({ homeNodeFacets: { 'node-a': { provider: ['B'] }, 'node-b': { region: ['US'], provider: ['A'] } } }));
  });
  it('detects actual edited values', () => {
    expect(managedSettingsSignature({ defaultAppearance: 'dark' })).not.toBe(managedSettingsSignature({ defaultAppearance: 'light' }));
  });
  it('removes the obsolete single-task binding when saving', () => {
    expect(buildStudioPayload({ homepagePingTask: 1 }, {}).homepagePingTask).toBeUndefined();
  });
});

describe('studio change summary', () => {
  it('names edited settings without exposing their values', () => {
    expect(summarizeStudioChanges({}, { backgroundImage: 'https://private.example/photo.png', defaultAppearance: 'dark' })).toEqual(['默认外观', '桌面背景']);
  });
  it('ignores equivalent nested key order and unmanaged options', () => {
    expect(summarizeStudioChanges({ enableAdminButton: false, homeNodeFacets: { a: { provider: ['A'], region: ['US'] } } }, { enableAdminButton: true, homeNodeFacets: { a: { region: ['US'], provider: ['A'] } } })).toEqual([]);
  });
});
