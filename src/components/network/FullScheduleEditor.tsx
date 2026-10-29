import { useState } from "react";
import type { ReportTiming, ReportTimingRule } from "@/services/reportObservatory";

const intervals = [60, 120, 180, 240, 360, 480, 720, 1440];
function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function defaultRule(type: ReportTimingRule["type"]): ReportTimingRule {
  if (type === "interval") return { type, minutes: 1440 };
  if (type === "daily") return { type, times: ["21:00"], timezone: "Asia/Shanghai" };
  if (type === "weekly") return { type, weekdays: [1], time: "21:00", timezone: "Asia/Shanghai" };
  return { type, days: 2, time: "21:00", timezone: "Asia/Shanghai", startDate: todayInShanghai() };
}
function RuleEditor({ rule, index, count, timezones, onChange, onRemove }: { rule: ReportTimingRule; index: number; count: number; timezones: string[]; onChange: (rule: ReportTimingRule) => void; onRemove: () => void }) {
  const [rawTimes, setRawTimes] = useState<string | null>(null);
  return <fieldset className="report-schedule-rule">
    <legend>规则 {index + 1}</legend>
    <div className="report-plan-module-heading"><label>执行方式<select value={rule.type} onChange={e => { setRawTimes(null); onChange(defaultRule(e.target.value as ReportTimingRule["type"])); }}>
      <option value="interval">固定间隔</option><option value="daily">每天指定时刻</option><option value="every-days">每隔 N 天的指定时刻</option><option value="weekly">每周指定星期</option>
    </select></label><button type="button" onClick={onRemove} disabled={count === 1} aria-label={`删除规则 ${index + 1}`}>删除规则</button></div>
    {rule.type === "interval" ? <label>检测间隔<select value={rule.minutes} onChange={e => onChange({ ...rule, minutes: Number(e.target.value), anchor: undefined })}>
      {intervals.map(m => <option key={m} value={m}>{m === 1440 ? "每 24 小时" : `每 ${m / 60} 小时`}</option>)}
    </select></label> : <>
      <label>时区<select value={rule.timezone} onChange={e => onChange({ ...rule, timezone: e.target.value })}>{timezones.map(t => <option key={t}>{t}</option>)}</select></label>
      {rule.type === "weekly" ? <><div className="report-schedule-weekdays" role="group" aria-label="执行星期">{["一", "二", "三", "四", "五", "六", "日"].map((label, i) => <label key={label}><input type="checkbox" checked={rule.weekdays.includes(i + 1)} onChange={e => onChange({ ...rule, weekdays: e.target.checked ? [...rule.weekdays, i + 1] : rule.weekdays.filter(day => day !== i + 1) })} />周{label}</label>)}</div><label>执行时刻<input type="time" value={rule.time} onChange={e => onChange({ ...rule, time: e.target.value })} /></label></> : rule.type === "daily" ? <label>每天时刻 · 最多八个<input value={rawTimes ?? rule.times.join(", ")} placeholder="04:00, 21:00" onChange={e => { setRawTimes(e.target.value); onChange({ ...rule, times: e.target.value.split(/[,，\s]+/).filter(Boolean) }); }} /></label> : <div className="report-schedule-date-fields">
        <label>每隔几天<input type="number" min={1} max={365} step={1} value={rule.days} onChange={e => onChange({ ...rule, days: Number(e.target.value) })} /></label>
        <label>起始日期<input type="date" value={rule.startDate} onChange={e => onChange({ ...rule, startDate: e.target.value })} /></label>
        <label>执行时刻<input type="time" value={rule.time} onChange={e => onChange({ ...rule, time: e.target.value })} /></label>
      </div>}
    </>}
  </fieldset>;
}
export function FullScheduleEditor({ timing, timezones, onChange }: { timing: ReportTiming; timezones: string[]; onChange: (timing: ReportTiming) => void }) {
  const [revision, setRevision] = useState(0);
  const rules = timing.type === "rules" ? timing.rules : [timing];
  function update(next: ReportTimingRule[]) { onChange({ type: "rules", rules: next }); }
  return <div className="report-schedule-rules">
    {rules.map((rule, index) => <RuleEditor key={`${revision}-${index}`} rule={rule} index={index} count={rules.length} timezones={timezones}
      onChange={value => update(rules.map((old, i) => i === index ? value : old))} onRemove={() => { setRevision(value => value + 1); update(rules.filter((_, i) => i !== index)); }} />)}
    <button type="button" disabled={rules.length >= 8} onClick={() => update([...rules, defaultRule("every-days")])}>添加定时规则</button>
    <p className="report-caption">最多 8 条规则。每 N 天从起始日期开始按所选时区的日历日期计算；同一时刻重合的规则合并为一次检测。夏令时不存在的时刻跳过，重复时刻可能执行两次。</p>
    <p className="report-caption">如果上一轮仍在运行，重叠的定时轮次会记录为跳过；建议规则间隔大于单次检测的超时时间。</p>
  </div>;
}
