/** Decide whether a server refresh may replace the editor's current draft. */
export function settingsSyncAction(baseline: string | null, server: string, dirty: boolean, saving: boolean) {
  if (saving) return 'wait';
  if (baseline === null) return 'replace';
  if (baseline === server) return 'keep';
  return dirty ? 'conflict' : 'replace';
}
