import { SettingSwitch } from './SettingSwitch';
import { useId } from 'react';
import type { AdminClient } from '@/types/komari';
import { NodeScopeEditor } from './ViewScopeEditor';
import { DEFAULT_THEME_SETTINGS } from '@/utils/themeSettings';

export function AssetEditor({ nodes, excluded, onExcludedChange, showSummary, onSummaryChange, showShortcut, onShortcutChange, rateUrl, onRateUrlChange, invalid }: {
  nodes: AdminClient[]; excluded: string[]; onExcludedChange: (value: string[]) => void;
  showSummary: boolean; onSummaryChange: (value: boolean) => void; showShortcut: boolean; onShortcutChange: (value: boolean) => void;
  rateUrl: string; onRateUrlChange: (value: string) => void; invalid: boolean;
}) {
  const id = useId();
  const knownIds = new Set(nodes.map(node => node.uuid));
  const nodeIds = excluded.filter(value => knownIds.has(value));
  const legacy = excluded.filter(value => !knownIds.has(value));
  return <div className="studio-asset-editor">
    <div className="studio-setting-group"><SettingSwitch title="首页成本摘要" detail="在首页汇总月均费用、年化支出与剩余价值。" checked={showSummary} onChange={onSummaryChange}/><SettingSwitch title="资产快捷入口" detail="显示资产悬浮按钮，即使收起总览也能打开资产明细。" checked={showShortcut} onChange={onShortcutChange}/></div>
    <NodeScopeEditor label="排除的节点" excluded nodes={nodes} selected={nodeIds} onChange={value => onExcludedChange([...legacy, ...value])}/>
    {legacy.length > 0 && <section className="studio-legacy-rules"><h3>既有排除规则</h3><p>这些名称或旧节点引用仍然生效。确认不再需要后可逐项移除。</p>{legacy.map(value => <div key={value}><code>{value}</code><button type="button" className="studio-button" aria-label={`移除排除规则 ${value}`} onClick={() => onExcludedChange(excluded.filter(item => item !== value))}>移除</button></div>)}</section>}
    <details className="studio-asset-advanced" open={invalid || undefined}><summary>汇率数据源</summary><p>默认接口将不同币种换算为人民币。仅在使用自建或兼容接口时修改。</p><label htmlFor={id}>汇率接口地址</label><div className="studio-rate-input"><input id={id} type="url" value={rateUrl} onChange={event => onRateUrlChange(event.target.value)} aria-invalid={invalid} aria-describedby={`${id}-hint`}/><button type="button" className="studio-button" onClick={() => onRateUrlChange(DEFAULT_THEME_SETTINGS.costRateApiUrl)}>使用默认接口</button></div><p id={`${id}-hint`} role={invalid ? 'alert' : undefined}>{invalid ? '请输入完整的 HTTP 或 HTTPS 地址，修正后才能保存。' : '保存后会在下一次资产数据请求中使用此地址。'}</p></details>
  </div>;
}
