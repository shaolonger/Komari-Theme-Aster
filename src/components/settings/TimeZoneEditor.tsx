import { useId, useMemo, useState } from 'react';
import { DISPLAY_TIME_ZONE_PRESETS, describeDisplayTimeZone } from '@/utils/timeDisplay';
const labels: Record<string, string> = { system: '跟随浏览器', UTC: '协调世界时', 'Asia/Shanghai': '上海', 'Asia/Tokyo': '东京', 'America/Los_Angeles': '洛杉矶', 'America/New_York': '纽约', 'Europe/London': '伦敦' };
export function TimeZoneEditor({ value, invalid, preview, onChange }: { value: string; invalid: boolean; preview: string; onChange: (value: string) => void }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const zones = useMemo(() => {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
    return [...new Set([...DISPLAY_TIME_ZONE_PRESETS, ...(intl.supportedValuesOf?.('timeZone') ?? [])])];
  }, []);
  const filtered = zones.filter(zone => `${zone} ${labels[zone] ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="studio-time-editor"><div><label htmlFor={`${id}-search`}>查找城市或时区</label><input id={`${id}-search`} type="search" value={search} placeholder="上海、Tokyo、Europe…" onChange={event => setSearch(event.target.value)}/><fieldset className="studio-time-options"><legend className="sr-only">显示时区</legend>{filtered.map(zone => <label key={zone}><input type="radio" name={id} checked={!invalid && (value.trim() || 'system') === zone} onChange={() => onChange(zone)}/><span><strong>{labels[zone] ?? zone.split('/').at(-1)?.replaceAll('_', ' ')}</strong><small>{zone === 'system' ? '使用访问者设备的时区' : zone}</small></span></label>)}{!filtered.length && <p role="status">没有匹配项，可在右侧填写自定义时区。</p>}</fieldset></div><div className="studio-time-detail"><span>显示时间预览</span><strong>{invalid ? '等待有效时区' : preview}</strong><p>{invalid ? '当前输入无法识别，请修正后保存。' : describeDisplayTimeZone(value.trim() || 'system')}</p><label htmlFor={`${id}-custom`}>自定义时区</label><input id={`${id}-custom`} value={value} onChange={event => onChange(event.target.value)} placeholder="Asia/Shanghai" aria-invalid={invalid} aria-describedby={`${id}-hint`}/><p id={`${id}-hint`}>使用 IANA 名称。留空则跟随浏览器；仅改变显示方式，不改变采集数据的时间。</p><button type="button" className="studio-button" onClick={() => onChange('system')}>跟随浏览器</button></div></div>;
}
