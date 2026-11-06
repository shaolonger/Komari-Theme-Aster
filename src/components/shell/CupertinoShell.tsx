import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  ChevronDown,
  Cpu,
  HardDrive,
  LayoutGrid,
  Menu,
  MemoryStick,
  Search,
  Server,
  Settings,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { NodeSwitcher } from "@/components/instance/NodeSwitcher";
import { Flag } from "@/components/ui/Flag";
import { getDisplayRegionCode } from "@/utils/geo";
import { regionLabel } from "@/components/glacier/regionLabel";
import { formatBytes } from "@/utils/format";
import { notifyPaletteChanged } from "@/utils/palette";
import "@/styles/cupertino.css";

export default function CupertinoShell() {
  const location = useLocation(),
    navigate = useNavigate();
  const { data: me } = useAuth();
  const allNodes = useAllNodeMeta(),
    summaries = useHomeNodeSummaries();
  const nodes = useMemo(
    () => allNodes.filter((n) => me?.logged_in || !n.hidden),
    [allNodes, me?.logged_in],
  );
  const visible = summaries.filter((n) => me?.logged_in || !n.hidden);
  const current = location.pathname.match(/^\/instance\/([^/]+)/)?.[1];
  const uuid = current || nodes[0]?.uuid;
  const instance = current != null,
    home =
      location.pathname === "/" &&
      !location.search.includes("view=theme-manage");
  const params = new URLSearchParams(location.search),
    ping = params.get("focus") === "ping" || params.get("focus") === "network";
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLDivElement>(null);
  const regions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const code = getDisplayRegionCode(node.region);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [nodes]);
  useLayoutEffect(() => {
    document.documentElement.dataset.cupertinoPage = home
      ? "home"
      : instance
        ? "instance"
        : "utility";
    notifyPaletteChanged();
    return () => {
      delete document.documentElement.dataset.cupertinoPage;
    };
  }, [home, instance]);
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (
        !home &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        search.current?.querySelector("input")?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [home]);
  const instanceUrl = uuid ? `/instance/${encodeURIComponent(uuid)}` : "/";
  const links = [
    {
      label: "节点总览",
      icon: LayoutGrid,
      to: "/",
      active: home && !params.get("status") && !params.get("region"),
    },
    {
      label: "服务器",
      icon: Server,
      to: instanceUrl,
      active: instance && !ping && !location.pathname.endsWith("/report"),
    },
    {
      label: "网络监控",
      icon: Activity,
      to: uuid ? instanceUrl + "?focus=ping" : "/compare",
      active: instance && ping,
    },
    {
      label: "计划任务",
      icon: CalendarClock,
      to: me?.logged_in
        ? "/?view=theme-manage&section=network&panel=plans"
        : instanceUrl + "/report",
      active: params.get("panel") === "plans",
    },
    {
      label: "告警通知",
      icon: Bell,
      to: "/?status=attention",
      active: params.get("status") === "attention",
    },
    {
      label: "数据统计",
      icon: BarChart3,
      to: "/compare",
      active: location.pathname === "/compare",
    },
    {
      label: "设置中心",
      icon: Settings,
      to: me?.logged_in ? "/?view=theme-manage" : "/admin",
      active: params.get("view") === "theme-manage" && !params.get("panel"),
    },
  ];
  const account = (
    <>
      <span className="cupertino-avatar">
        {(me?.username || "K").slice(0, 1).toUpperCase()}
      </span>
      <span>
        <strong>{me?.username || "访客"}</strong>
        <small>{me?.logged_in ? "管理员" : "公开监控"}</small>
      </span>
      <ChevronDown size={13} />
    </>
  );
  return (
    <>
      {open && (
        <button
          className="cupertino-drawer-backdrop"
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className="cupertino-sidebar" data-open={open}>
        <Link to="/" className="cupertino-brand">
          <span aria-hidden="true">K</span>
          <span>
            <strong>KOMARI</strong>
            <small>Server Monitor</small>
          </span>
        </Link>
        <nav aria-label="原生主题导航">
          {links.map(({ label, icon: Icon, to, active }) => (
            <Link
              key={label}
              to={to}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        {home && (
          <section className="cupertino-region-list" aria-label="地区导航">
            <Link
              to="/"
              aria-current={!params.get("region") ? "true" : undefined}
            >
              <Server size={18} />
              <span>全部节点</span>
              <b>{nodes.length}</b>
            </Link>
            {regions.slice(0, 7).map(([code, count]) => (
              <Link
                key={code}
                to={"/?region=" + encodeURIComponent(code)}
                aria-current={
                  params.get("region") === code ? "true" : undefined
                }
              >
                <Flag region={code} size={20} />
                <span>{regionLabel(code)}</span>
                <b>{count}</b>
              </Link>
            ))}
          </section>
        )}
        {instance && current && <CurrentNode uuid={current} />}
        <details className="cupertino-account cupertino-sidebar-account">
          <summary>{account}</summary>
          <AccountMenu loggedIn={me?.logged_in === true} />
        </details>
      </aside>
      <header className="cupertino-masthead">
        <button
          className="cupertino-mobile-menu"
          aria-label={open ? "关闭导航" : "打开导航"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        {home ? (
          <div className="cupertino-home-breadcrumb">
            工作空间 <span>/</span>
            <strong>节点总览</strong>
          </div>
        ) : (
          <div className="cupertino-global-search" ref={search}>
            <Search size={18} />
            <NodeSwitcher
              nodes={nodes}
              currentUuid={current || ""}
              showCurrentValue={false}
              placeholder="搜索名称、IP、标签…"
              onSelect={(next) =>
                navigate(
                  "/instance/" +
                    encodeURIComponent(next) +
                    (instance && !location.pathname.endsWith("/report")
                      ? location.search
                      : ""),
                )
              }
            />
            <kbd>⌘K</kbd>
          </div>
        )}
        <div className="cupertino-header-actions">
          <Link
            to="/?status=attention"
            aria-label="查看关注节点"
            className="cupertino-notifications"
          >
            <Bell size={21} />
            {visible.some((n) => n.online === false) && <i />}
          </Link>
          <details className="cupertino-account cupertino-header-account">
            <summary>{account}</summary>
            <AccountMenu loggedIn={me?.logged_in === true} />
          </details>
        </div>
      </header>
    </>
  );
}
function AccountMenu({ loggedIn }: { loggedIn: boolean }) {
  return (
    <div className="cupertino-account-menu">
      {loggedIn ? (
        <Link to="/?view=theme-manage">Aster 工作室</Link>
      ) : (
        <a href="/admin">后台登录</a>
      )}
      <button
        onClick={() =>
          document
            .querySelector<HTMLButtonElement>(".floating-controls-trigger")
            ?.click()
        }
      >
        主题与视图设置
      </button>
    </div>
  );
}
function CurrentNode({ uuid }: { uuid: string }) {
  const { node } = useNodeCardModel(uuid);
  if (!node) return null;
  return (
    <section className="cupertino-current-node">
      <h2>
        <Server size={17} />
        当前节点
      </h2>
      <strong title={node.name}>{node.name}</strong>
      <div className="cupertino-current-region">
        <Flag region={node.region} size={18} />
        <span>{regionLabel(node.region)}</span>
        <b data-online={node.online}>
          {node.online === true
            ? "在线"
            : node.online === false
              ? "离线"
              : "待上报"}
        </b>
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
      </ul>
    </section>
  );
}
