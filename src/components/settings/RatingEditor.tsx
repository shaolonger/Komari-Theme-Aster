import { SettingSwitch } from './SettingSwitch';
import { getDefaultOverviewRatingLabelText, OVERVIEW_RATING_STYLES, type OverviewRatingKind, type OverviewRatingStyle } from '@/utils/overviewRating';
const kinds = [{ key: 'traffic', title: '今日流量' }, { key: 'bandwidth', title: '实时带宽' }, { key: 'asset', title: '资产概览' }] as const;
export function RatingEditor({ enabled, onEnabledChange, style, onStyleChange, visible, onVisibleChange, labels, onLabelsChange }: {
  enabled: boolean; onEnabledChange: (value: boolean) => void; style: OverviewRatingStyle; onStyleChange: (value: OverviewRatingStyle) => void;
  visible: Record<OverviewRatingKind, boolean>; onVisibleChange: (kind: OverviewRatingKind, value: boolean) => void;
  labels: Record<OverviewRatingKind, string>; onLabelsChange: (kind: OverviewRatingKind, value: string) => void;
}) {
  return <section className="studio-rating-editor"><SettingSwitch title="总览文字评级" detail="为指标附加四级文字描述。关闭后保留名称设置，随时可以重新启用。" checked={enabled} onChange={onEnabledChange}/>
    <fieldset disabled={!enabled}><legend className="sr-only">评级显示与名称</legend><label className="studio-rating-style">默认名称方案<select value={style} onChange={event => onStyleChange(event.target.value as OverviewRatingStyle)}>{OVERVIEW_RATING_STYLES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    {kinds.map(kind => { const defaults = getDefaultOverviewRatingLabelText(kind.key, style).split(','); const parts = labels[kind.key].split(','); return <article key={kind.key}>
      <SettingSwitch title={kind.title} detail="从一级到四级，依次对应指标数值由低到高。" checked={visible[kind.key]} onChange={value => onVisibleChange(kind.key, value)}/>
      <div className="studio-rating-levels">{defaults.map((fallback, index) => <label key={index}><span>0{index + 1}</span><input aria-label={`${kind.title} 第 ${index + 1} 级名称`} value={parts[index] ?? ''} placeholder={fallback} maxLength={40} onBlur={() => { if (parts.some(value => !value.trim()) && labels[kind.key]) onLabelsChange(kind.key, defaults.map((fallback, index) => parts[index]?.trim() || fallback).join(',')); }} onChange={event => { const next = defaults.map((label, position) => parts[position]?.trim() || label); next[index] = event.target.value.replaceAll(',', '，'); onLabelsChange(kind.key, next.join(',')); }}/></label>)}</div>
      <button type="button" className="studio-button" onClick={() => onLabelsChange(kind.key, '')}>恢复{kind.title}默认名称</button>
    </article>; })}</fieldset>
  </section>;
}
