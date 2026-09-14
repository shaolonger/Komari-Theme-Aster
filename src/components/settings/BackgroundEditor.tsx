import { useState } from 'react';
import { computeBackgroundGlass, normalizeBackgroundUrl, parseBackgroundAlignment, resolveBackgroundUrl, type BackgroundPosition, type BackgroundSize } from '@/utils/background';

export function BackgroundEditor({ desktop, mobile, alignment, opacity, onDesktopChange, onMobileChange, onAlignmentChange, onOpacityChange }: {
  desktop: string; mobile: string; alignment: string; opacity: number;
  onDesktopChange: (value: string) => void; onMobileChange: (value: string) => void;
  onAlignmentChange: (value: string) => void; onOpacityChange: (value: number) => void;
}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light');
  const [request, setRequest] = useState({ url: '', attempt: 0, status: 'idle' as 'idle' | 'loading' | 'loaded' | 'failed' });
  const raw = device === 'desktop' ? desktop : mobile;
  const change = device === 'desktop' ? onDesktopChange : onMobileChange;
  const parts = raw.split('|');
  const { size, position } = parseBackgroundAlignment(alignment);
  const url = resolveBackgroundUrl(normalizeBackgroundUrl(raw || (device === 'mobile' ? desktop : '')), appearance);
  const glass = computeBackgroundGlass(opacity);
  const previewUrl = request.url === url ? request.url : '';
  const failed = !!previewUrl && request.status === 'failed';
  const loading = !!previewUrl && request.status === 'loading';
  const finish = (status: 'loaded' | 'failed') => setRequest(current => current.attempt === request.attempt && current.url === request.url ? { ...current, status } : current);
  return <div className="studio-background-editor">
    <div className="studio-background-controls">
      <div className="studio-background-segments" role="group" aria-label="背景设备">{(['desktop', 'mobile'] as const).map(value => <button type="button" key={value} aria-pressed={device === value} onClick={() => { setDevice(value); }}>{value === 'desktop' ? '桌面背景' : '移动背景'}</button>)}</div>
      <label>浅色背景地址<input value={parts[0] ?? ''} onChange={event => change(parts.length > 1 ? `${event.target.value}|${parts[1]}` : event.target.value)} placeholder={device === 'mobile' ? '留空沿用桌面背景' : 'https:// 或站内图片路径'} /></label>
      <label>深色背景地址<input value={parts[1] ?? ''} onChange={event => change(event.target.value ? `${parts[0] ?? ''}|${event.target.value}` : (parts[0] ?? ''))} placeholder="留空沿用浅色背景" /></label>
      <p>分别填写地址即可。移动端未配置时沿用桌面背景。</p>
      <div className="studio-background-selects"><label>图片缩放<select value={size} onChange={event => onAlignmentChange(`${event.target.value as BackgroundSize},${position}`)}><option value="cover">填满画布</option><option value="contain">完整显示</option><option value="auto">原始尺寸</option></select></label><label>图片位置<select value={position} onChange={event => onAlignmentChange(`${size},${event.target.value as BackgroundPosition}`)}><option value="top">靠上</option><option value="center">居中</option><option value="bottom">靠下</option></select></label></div>
      <label>卡片不透明度 <output>{opacity}%</output><input type="range" min="0" max="100" step="1" value={opacity} onChange={event => onOpacityChange(Number(event.target.value))} /></label>
      <p>{url ? '降低不透明度可透出背景，预览中会同步显示磨砂效果。' : '添加背景图后，不透明度设置才会作用于站点。'}</p>
      <button type="button" className="studio-button" disabled={!raw} onClick={() => change('')}>清除当前设备背景</button>
    </div>
    <div className="studio-background-preview"><div className="studio-background-segments" role="group" aria-label="背景预览外观">{(['light', 'dark'] as const).map(value => <button type="button" key={value} aria-pressed={appearance === value} onClick={() => { setAppearance(value); }}>{value === 'light' ? '浅色预览' : '深色预览'}</button>)}</div>
      <div className="studio-background-canvas" data-device={device} data-appearance={appearance} style={{ backgroundImage: previewUrl && request.status === 'loaded' ? `url(${JSON.stringify(previewUrl)})` : undefined, backgroundSize: size, backgroundPosition: position }}>
        {previewUrl && <img key={`${request.attempt}:${previewUrl}`} src={previewUrl} alt="" hidden onLoad={() => finish('loaded')} onError={() => finish('failed')}/>}
        <div className="studio-background-sample" style={{ background: `color-mix(in srgb, var(--sample-surface) ${url ? opacity : 100}%, transparent)`, backdropFilter: url && glass.active ? `blur(${glass.blurPx}px)` : undefined }}><span>ASTER · 样式预览</span><strong>节点运行正常</strong><div><span>CPU</span><b>24%</b></div><progress max="100" value="24"/><small>文字与背景的对比效果</small></div>
      </div>
      <button type="button" className="studio-button" disabled={!url} onClick={() => setRequest(current => ({ url, attempt: current.attempt + 1, status: 'loading' }))}>加载当前背景预览</button>
      <p role="status">{loading ? '正在加载背景图片…' : failed ? '图片未能加载，请检查地址或访问权限后重新加载。' : url && previewUrl !== url ? '地址已修改，点击加载可检查图片。' : '此处仅预览背景样式；保存后应用到站点。'}</p>
    </div>
  </div>;
}
