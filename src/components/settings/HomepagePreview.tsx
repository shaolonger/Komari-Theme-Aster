import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThemeSettings } from '@/types/komari';

export function HomepagePreview({ settings }: { settings: ThemeSettings }) {
  const [opened, setOpened] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'waiting'>('loading');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [width, setWidth] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'aster:preview-applied') setStatus('ready');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(() => setStatus(current => current === 'ready' ? current : 'waiting'), 8000);
    return () => window.clearTimeout(timer);
  }, [opened, attempt]);
  const viewport = device === 'desktop' ? 1280 : 390;
  const scale = Math.min(1, width / viewport);
  useEffect(() => {
    if (!opened || !container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [opened]);
  const send = useCallback(() => frame.current?.contentWindow?.postMessage({ type: 'aster:preview-settings', settings }, window.location.origin), [settings]);
  useEffect(() => { send(); }, [send]);
  return <section className="studio-home-preview">
    <header><div><h3>首页实时预览</h3><p>使用当前节点数据呈现草稿效果。预览不会保存设置。</p></div><button type="button" className="studio-button" aria-expanded={opened} onClick={() => { setStatus('loading'); setOpened(value => !value); }}>{opened ? '关闭预览' : '打开首页预览'}</button></header>
    {opened && <><div className="studio-background-segments" role="group" aria-label="首页预览设备">{(['desktop', 'mobile'] as const).map(value => <button type="button" key={value} aria-pressed={device === value} onClick={() => setDevice(value)}>{value === 'desktop' ? '桌面' : '移动端'}</button>)}</div>
      <div className="studio-preview-status"><p role="status">{status === 'ready' ? '草稿已同步到预览。' : status === 'waiting' ? '预览尚未响应。请检查网络或重新加载。' : '正在准备首页预览…'}</p><button type="button" className="studio-button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>重新加载预览</button></div>
      <div ref={container} className="studio-home-preview-viewport" style={{ height: 800 * scale }}>
        <iframe key={attempt} ref={frame} src="/?aster-preview=1" title="当前草稿的首页预览" tabIndex={-1} inert onLoad={send} style={{ width: viewport, height: 800, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}/>
      </div><p>预览为只读，设备宽度分别为 1280px 和 390px；内容按可用空间缩放。</p></>}
  </section>;
}
