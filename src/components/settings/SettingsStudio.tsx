import { createContext, useContext, useId, useState, useRef, useEffect, type ReactNode } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import './settings-studio.css';

const sections = [
  { id: 'appearance', title: '外观与布局', description: '为你的监控空间建立清晰的视觉秩序', keywords: '主题 颜色 light dark system 设备 桌面 移动 timezone 图片 壁纸 透明度', panels: ['默认外观', '显示时区', '默认卡片视图', '背景与透明度'] },
  { id: 'overview', title: '巡检与指标', description: '决定首页首先呈现哪些信号', keywords: '指标 评级 流量 带宽 在线 连接 TCP UDP 排序', panels: ['首页巡检', '小卡片显示项'] },
  { id: 'views', title: '节点与视图', description: '把节点组织成适合日常工作的视图', keywords: '节点 VPS 标签 分组 厂商 地区 用途 筛选', panels: ['VPS 标签与视图'] },
  { id: 'assets', title: '资产与成本', description: '设定成本统计的范围与计算方式', keywords: '汇率 费用 计费 价格 排除 资产 成本', panels: ['服务器花费'] },
  { id: 'network', title: '网络观测', description: '统一管理首页信号、检测方案、探测器和目标端点', keywords: 'Ping 网络 延迟 丢包 任务 绑定 探测', panels: ['主页延迟检测', '主页三网线路', '检测方案', '探测器与测量点', '目标端点'] },
];
const networkPanels = [['ping','主页延迟检测'],['routes','主页三网线路'],['plans','检测方案'],['agents','探测器与测量点'],['targets','目标端点']] as const;

function matchesSection(section: (typeof sections)[number], query: string) {
  return `${section.title} ${section.keywords} ${section.panels.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

const StudioContext = createContext({ active: 'appearance', query: '', navigate: (_section: string) => {} });

export function SettingsStudio({ children, dirty }: { children: ReactNode; dirty: boolean }) {
  const [active, setActive] = useState(() => new URLSearchParams(window.location.search).get('section') === 'network' ? 'network' : 'appearance');
  const [query, setQuery] = useState('');
  const [navigation, setNavigation] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!navigation) return;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [navigation]);
  useEffect(() => {
    if (active !== 'network') return;
    const panel = new URLSearchParams(window.location.search).get('panel');
    if (!panel) return;
    const frame = requestAnimationFrame(() => document.getElementById('network-' + panel)?.closest('.aster-studio-panel')?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const section = sections.find(item => item.id === active)!;
  const searchId = useId();
  const matches = sections.filter(item => matchesSection(item, query)).flatMap(item => item.panels);
  const navigate = (sectionId: string) => {
    if (!sections.some(item => item.id === sectionId)) return;
    setActive(sectionId);
    setQuery('');
    setNavigation(value => value + 1);
  };
  return <StudioContext.Provider value={{ active, query: query.trim(), navigate }}>
    <div className="aster-studio">
      <aside className="aster-studio-nav">
        <div className="aster-studio-brand"><SlidersHorizontal size={22} /><div><strong>Aster 工作室</strong><span>让监控适应你的工作方式</span></div></div>
        <label className="aster-studio-search" htmlFor={searchId}><Search size={16} /><input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="查找设置分区" /></label>
        <nav aria-label="设置分区">{sections.map((item, index) => <button key={item.id} type="button" aria-current={active === item.id && !query ? 'page' : undefined} onClick={() => navigate(item.id)}><span className="aster-studio-index">0{index + 1}</span><span>{item.title}</span></button>)}</nav>
        <p className="aster-studio-state" role="status"><span data-dirty={dirty} />{dirty ? '草稿有未保存的修改' : '设置已与站点同步'}</p>
        <p className="aster-studio-note">切换分区会保留草稿。主题草稿需保存；网络插件各面板独立保存并立即生效。</p>
      </aside>
      <div className="aster-studio-content">
        <header className="aster-studio-heading"><span>ASTER / WORKSPACE</span><h1 ref={headingRef} tabIndex={-1}>{query ? '查找设置' : section.title}</h1><p>{query ? `与“${query}”匹配的设置分区` : section.description}</p></header>
        {active === 'network' && !query && <nav className="studio-network-nav" aria-label="网络观测配置"><span>跳转到</span>{networkPanels.map(([panel,title]) => <a key={panel} href={'#network-' + panel} onClick={event => { event.preventDefault(); document.getElementById('network-' + panel)?.closest('.aster-studio-panel')?.scrollIntoView({block:'start',behavior:'smooth'}); }}>{title}</a>)}</nav>}
        {query && matches.length === 0 && <p className="aster-studio-empty" role="status">没有找到匹配分区。试试“外观”“视图”或“延迟”。</p>}
        {children}
      </div>
    </div>
  </StudioContext.Provider>;
}

export function useStudioNavigation() {
  return useContext(StudioContext).navigate;
}

export function StudioPanel({ title, description, aside, children }: { title: string; description?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  const { active, query } = useContext(StudioContext);
  const id = useId();
  const category = sections.find(section => section.panels.includes(title));
  const visible = !category || (query ? matchesSection(category, query) : category.id === active);
  return <section hidden={!visible} className="aster-studio-panel" aria-labelledby={id}>
    <header><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{aside && <div className="aster-studio-panel-aside">{aside}</div>}</header>
    <div className="aster-studio-fields">{children}</div>
  </section>;
}

export function useStudioSectionActive(section: string) { const { active, query } = useContext(StudioContext); return active === section || !!query; }
