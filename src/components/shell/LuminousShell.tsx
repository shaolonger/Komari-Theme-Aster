import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  CalendarClock,
  ChevronDown,
  Cpu,
  FileText,
  FolderCog,
  Globe2,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  Pause,
  Play,
  Search,
  Settings2,
  Sun,
  Workflow,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { usePreferences } from "@/hooks/usePreferences";
import { Flag } from "@/components/ui/Flag";
import { formatBytes } from "@/utils/format";
import { matchesNodeSearch } from "@/utils/nodeSearch";
import { notifyPaletteChanged } from "@/utils/palette";
import ServerSculpture from "@/components/luminous/ServerSculpture";
import { MOTION_EVENT } from "@/components/luminous/motion";
import "@/styles/luminous.css";
import "@/styles/luminous-reference.css";

export default function LuminousShell() {
  useLayoutEffect(notifyPaletteChanged, []);
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem("luminous-motion") === "paused";
    } catch {
      return false;
    }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.luminousPage = pathname.startsWith(
      "/instance/",
    )
      ? params.get("focus") === "ping"
        ? "ping"
        : "instance"
      : pathname !== "/"
        ? "utility"
        : params.get("view") === "theme-manage"
          ? "studio"
          : "home";
    return () => {
      delete document.documentElement.dataset.luminousPage;
    };
  }, [pathname, params]);
  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.luminousMotion =
        paused || document.hidden ? "paused" : "playing";
      window.dispatchEvent(new Event(MOTION_EVENT));
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    try {
      localStorage.setItem("luminous-motion", paused ? "paused" : "playing");
    } catch {
      /* Session preference still works. */
    }
    return () => {
      document.removeEventListener("visibilitychange", sync);
      delete document.documentElement.dataset.luminousMotion;
    };
  }, [paused]);
  const instance = pathname.startsWith("/instance/");
  return (
    <>
      <div className="luminous-backdrop" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <aside className="luminous-sidebar">
        <Link to="/" className="luminous-brand">
          <BrandMark instance={instance} />
          <span>
            <strong>KOMARI</strong>
            <small>{instance ? "Server Monitor" : "Cloud Monitor"}</small>
          </span>
        </Link>
        <Navigation />
        <div
          className="luminous-sidebar-art"
          data-kind={instance ? "planet" : "server"}
        >
          {instance ? (
            <div className="luminous-promo-planet" aria-hidden="true">
              <i />
              <b />
            </div>
          ) : (
            <img
              className="luminous-sidebar-device-art"
              src={
                new URL("../../assets/luminous-sidebar-v2.png", import.meta.url)
                  .href
              }
              alt=""
              aria-hidden="true"
            />
          )}
          <strong>{instance ? "KOMARI PRO" : "KOMARI"}</strong>
          <small>
            {instance ? (
              <>
                让服务器监控
                <br />
                更智能，更简单
              </>
            ) : (
              <>
                Always Online
                <br />
                Globally Connected
                <br />
                For a Better Internet
              </>
            )}
          </small>
        </div>
      </aside>
      <Masthead paused={paused} onMotion={() => setPaused((v) => !v)} />
    </>
  );
}
function Masthead({
  paused,
  onMotion,
}: {
  paused: boolean;
  onMotion: () => void;
}) {
  const { pathname } = useLocation();
  const { data: me } = useAuth();
  const { setAppearance } = usePreferences();
  const rawSummaries = useHomeNodeSummaries();
  const summaries = rawSummaries.filter((n) => me?.logged_in || !n.hidden);
  const offline = summaries.filter((n) => n.online === false).length;
  return (
    <div className="luminous-masthead">
      {pathname !== "/" && <QuickSearch />}
      <div className="luminous-masthead-actions">
        <Link
          className="luminous-masthead-icon"
          to="/?status=attention"
          aria-label="查看关注节点"
        >
          <Bell size={19} />
          {offline > 0 && <b>{offline}</b>}
        </Link>
        <button
          className="luminous-masthead-icon"
          aria-label="切换深色外观"
          onClick={() => setAppearance("dark")}
        >
          <Sun size={19} />
        </button>
        <button
          className="luminous-motion-toggle luminous-masthead-icon"
          aria-label={paused ? "播放场景动画" : "暂停场景动画"}
          aria-pressed={paused}
          onClick={onMotion}
        >
          {paused ? <Play size={17} /> : <Pause size={17} />}
        </button>
        <details className="luminous-account">
          <summary>
            <span className="luminous-avatar">
              {(me?.username || "K").slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{me?.username || "访客"}</strong>
              <small>{me?.logged_in ? "管理员" : "公开监控"}</small>
            </span>
            <ChevronDown size={13} />
          </summary>
          <div>
            {me?.logged_in ? (
              <Link to="/?view=theme-manage">Aster 工作室</Link>
            ) : (
              <a href="/admin">后台登录</a>
            )}
            <button
              onClick={() =>
                document
                  .querySelector<HTMLButtonElement>(
                    ".floating-controls-trigger",
                  )
                  ?.click()
              }
            >
              主题与视图设置
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
function QuickSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nodes = useAllNodeMeta();
  const { data: me } = useAuth();
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const visible = nodes
    .filter(
      (n) =>
        (me?.logged_in || !n.hidden) &&
        matchesNodeSearch(query, n.name, n.uuid, n.group, n.ipv4, n.ipv6),
    )
    .slice(0, 6);
  return (
    <div className="luminous-global-search">
      <Search size={18} />
      <input
        ref={input}
        aria-label="搜索并跳转 VPS"
        placeholder="搜索 VPS、IP、地区、标签…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <kbd>⌘K</kbd>
      {open && (
        <div className="luminous-quick-results">
          {visible.map((node) => (
            <Link
              key={node.uuid}
              to={"/instance/" + node.uuid}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
            >
              <Flag region={node.region} size={14} />
              {node.name}
            </Link>
          ))}
          {!visible.length && <span>没有匹配的节点</span>}
        </div>
      )}
    </div>
  );
}
function Navigation() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { data: me } = useAuth();
  const nodes = useAllNodeMeta();
  const rawSummaries = useHomeNodeSummaries();
  const summaries = rawSummaries.filter((n) => me?.logged_in || !n.hidden);
  const current =
    pathname.match(/^\/instance\/([^/]+)/)?.[1] ??
    nodes.find((n) => !n.hidden)?.uuid;
  const url = current ? "/instance/" + encodeURIComponent(current) : "/";
  const ping =
    params.get("focus") === "ping" || params.get("focus") === "network";
  const links = [
    {
      label: pathname === "/" ? "节点总览" : "总览",
      icon: LayoutDashboard,
      href: "/",
      active:
        pathname === "/" &&
        !params.get("status") &&
        params.get("view") !== "theme-manage",
    },
    {
      label: "服务器",
      icon: Boxes,
      href: url,
      active:
        pathname.startsWith("/instance/") &&
        !pathname.endsWith("/report") &&
        !ping,
    },
    {
      label: "分组管理",
      icon: FolderCog,
      href: me?.logged_in
        ? "/?view=theme-manage&section=views"
        : "/?filters=groups",
      active: params.get("section") === "views",
    },
    {
      label: "网络监控",
      icon: Globe2,
      href: current ? url + "?focus=ping" : "/compare",
      active: ping,
    },
    {
      label: "计划任务",
      icon: CalendarClock,
      href: me?.logged_in
        ? "/?view=theme-manage&section=network&panel=plans"
        : url + "/report",
      active: params.get("panel") === "plans",
    },
    {
      label: "告警通知",
      icon: Bell,
      href: "/?status=attention",
      active: params.get("status") === "attention",
    },
    {
      label: "数据统计",
      icon: BarChart3,
      href: "/compare",
      active: pathname === "/compare",
    },
    {
      label: pathname === "/" ? "线路分析" : "日志记录",
      icon: FileText,
      href: current ? url + "/report" : "/compare",
      active: pathname.endsWith("/report"),
    },
    {
      label: "设置中心",
      icon: Settings2,
      href: me?.logged_in ? "/?view=theme-manage" : "/admin",
      active: params.get("view") === "theme-manage" && !params.get("section"),
    },
  ];
  const online = summaries.filter((n) => n.online === true).length;
  const offline = summaries.filter((n) => n.online === false).length;
  const unknown = summaries.length - online - offline;
  return (
    <>
      <nav aria-label="光域未来导航">
        {links
          .filter(
            (link) =>
              !pathname.startsWith("/instance/") || link.label !== "分组管理",
          )
          .map(({ label, icon: Icon, href, active }) => (
            <Link
              key={label}
              to={href}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              {label}
              {label === "服务器" && pathname === "/" && (
                <b>{summaries.length}</b>
              )}
            </Link>
          ))}
      </nav>
      {pathname.startsWith("/instance/") &&
        current &&
        (ping ? (
          <section className="luminous-sidebar-status luminous-glass">
            <h2>
              运行状态 <Activity size={13} />
            </h2>
            <div
              className="luminous-sidebar-online"
              style={
                {
                  "--online-fill":
                    (summaries.length ? (online / summaries.length) * 100 : 0) +
                    "%",
                } as React.CSSProperties
              }
            >
              <span>
                <strong>
                  {online}
                  <small>/ {summaries.length}</small>
                </strong>
                <small>在线节点</small>
              </span>
            </div>
            <dl>
              {[
                ["在线", online, "#00c18a"],
                ["离线", offline, "#ff4c6a"],
                ["待上报", unknown, "#98a9c8"],
              ].map(([label, value, color]) => (
                <div key={label}>
                  <dt>
                    <i style={{ background: String(color) }} />
                    {label}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <a href="/admin">管理服务器</a>
          </section>
        ) : (
          <CurrentNode uuid={current} />
        ))}
    </>
  );
}
function CurrentNode({ uuid }: { uuid: string }) {
  const model = useNodeCardModel(uuid);
  if (!model.node) return null;
  const { node, tags } = model;
  return (
    <section className="luminous-current-node luminous-glass">
      <h2>
        当前节点 <Activity size={13} />
      </h2>
      <div className="luminous-current-identity">
        <ServerSculpture small />
        <div>
          <strong title={node.name}>{node.name}</strong>
          <span>
            <Flag region={node.region} size={11} />
            {node.region}
            <b>{node.online ? "在线" : "离线"}</b>
          </span>
        </div>
      </div>
      <ul>
        <li>
          <Cpu />
          {node.cpu_cores} vCPU
        </li>
        <li>
          <MemoryStick />
          {formatBytes(node.ramTotal)} 内存
        </li>
        <li>
          <HardDrive />
          {formatBytes(node.diskTotal)} 磁盘
        </li>
        {tags?.[0] && (
          <li>
            <Workflow />
            {tags[0].label}
          </li>
        )}
      </ul>
      <button
        onClick={() =>
          document
            .querySelector<HTMLInputElement>(".instance-node-select")
            ?.focus()
        }
      >
        ⇆ 切换节点
      </button>
    </section>
  );
}

function BrandMark({ instance }: { instance: boolean }) {
  return (
    <svg
      className="luminous-brand-crystal"
      viewBox="0 0 42 46"
      aria-hidden="true"
    >
      {instance ? (
        <>
          <defs>
            <linearGradient id="luminous-brand-blue" x2="1" y2="1">
              <stop stopColor="#080080" />
              <stop offset="1" stopColor="#007dff" />
            </linearGradient>
          </defs>
          <path
            d="M6 3C3 3 2 5 2 8v32c0 3 3 4 5 2L18 28V6c0-4-4-3-6-3Z"
            fill="url(#luminous-brand-blue)"
          />
          <path d="M23 7c3-4 5-4 9-4h7c3 0 3 3 1 5L19 29V16Z" fill="#00aeec" />
          <path d="m22 25 16 14c2 2 1 4-2 4H23l-8-9Z" fill="#1245e9" />
        </>
      ) : (
        <>
          <path d="M21 1 38 10v22L21 43 4 33V12Z" fill="#7cbcff" />
          <path d="m4 12 17 9v22L4 33Z" fill="#264dff" />
          <path d="m21 21 17-11v22L21 43Z" fill="#4b8eff" />
          <path d="m4 12 17-11v20Z" fill="#b5dcff" />
          <path d="m21 12 9 5v11l-9 6-9-5V18Z" fill="#effaff" />
          <path d="m12 18 9 5v11l-9-5Z" fill="#4d7fff" />
        </>
      )}
    </svg>
  );
}
