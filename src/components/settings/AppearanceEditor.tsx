import { useId } from 'react';
import { Activity, Check, Monitor, Smartphone } from 'lucide-react';
import type { Appearance, NodeViewMode } from '@/utils/themeSettings';

const appearances: { value: Appearance; label: string; detail: string }[] = [
  { value: 'light', label: '浅色', detail: '明亮、清晰，适合日间工作' },
  { value: 'system', label: '跟随系统', detail: '随设备的深浅色模式自动切换' },
  { value: 'dark', label: '深色', detail: '柔和暗面，适合夜间持续观测' },
  { value: 'diagnostic', label: '诊断', detail: '突出异常、收敛色彩，适合快速巡检' },
];
const layouts: { value: NodeViewMode; label: string; detail: string }[] = [
  { value: 'compact', label: '紧凑', detail: '压缩信息，快速浏览' },
  { value: 'standard', label: '标准', detail: '突出核心指标，按需展开' },
  { value: 'large', label: '扩展', detail: '展开指标，逐台巡检' },
  { value: 'list', label: '列表', detail: '对齐数据，集中比较' },
];

function LayoutDrawing({ mode }: { mode: NodeViewMode }) {
  return <div aria-hidden="true" className="studio-layout-drawing" data-mode={mode}>{Array.from({ length: mode === 'list' ? 4 : 6 }, (_, index) => <div key={index}><i/><span/><span/></div>)}</div>;
}

export function AppearanceEditor({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  const name = useId();
  return <fieldset className="studio-visual-options"><legend className="sr-only">默认外观</legend>{appearances.map(option => <label key={option.value} className="studio-visual-choice" data-selected={value === option.value}>
    <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)}/>
    <div className="studio-appearance-drawing" data-appearance={option.value} aria-hidden="true"><div className="studio-mini-sidebar"><i/><i/><i/></div><div className="studio-mini-main"><strong>ASTER</strong><div className="studio-mini-metrics"><i/><i/><i/></div><LayoutDrawing mode="standard"/>{option.value === 'diagnostic' && <Activity size={12}/>}</div></div>
    <span className="studio-choice-title">{option.label}{value === option.value && <Check size={16}/>}</span><span className="studio-choice-detail">{option.detail}</span>
  </label>)}</fieldset>;
}

export function DeviceLayoutEditor({ desktop, mobile, onDesktopChange, onMobileChange }: { desktop: NodeViewMode; mobile: NodeViewMode; onDesktopChange: (value: NodeViewMode) => void; onMobileChange: (value: NodeViewMode) => void }) {
  const id = useId();
  return <div className="studio-device-layouts">{([{ id: 'desktop', title: '桌面工作区', icon: Monitor, value: desktop, change: onDesktopChange }, { id: 'mobile', title: '移动工作区', icon: Smartphone, value: mobile, change: onMobileChange }] as const).map(device => <fieldset key={device.id}><legend><device.icon size={17}/>{device.title}</legend><div className="studio-visual-options">{layouts.map(option => <label key={option.value} className="studio-visual-choice" data-selected={device.value === option.value}>
    <input type="radio" name={`${id}-${device.id}`} value={option.value} checked={device.value === option.value} onChange={() => device.change(option.value)}/><LayoutDrawing mode={option.value}/><span className="studio-choice-title">{option.label}{device.value === option.value && <Check size={15}/>}</span><span className="studio-choice-detail">{option.detail}</span>
  </label>)}</div></fieldset>)}</div>;
}
