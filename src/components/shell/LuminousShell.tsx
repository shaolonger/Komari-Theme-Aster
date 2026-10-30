import { useEffect, useLayoutEffect, useState } from "react";
import {
  Activity,
  Boxes,
  ClipboardList,
  Globe2,
  LayoutDashboard,
  Pause,
  Play,
  Settings2,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useNodeStoreStatus } from "@/hooks/useNode";
import { notifyPaletteChanged } from "@/utils/palette";
import ServerSculpture from "@/components/luminous/ServerSculpture";
import { MOTION_EVENT } from "@/components/luminous/motion";
import "@/styles/luminous.css";

export default function LuminousShell() {
  useLayoutEffect(notifyPaletteChanged, []);
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem("luminous-motion") === "paused";
    } catch {
      return false;
    }
  });
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
      /* The current session still works without storage. */
    }
    return () => {
      document.removeEventListener("visibilitychange", sync);
      delete document.documentElement.dataset.luminousMotion;
    };
  }, [paused]);
  const [params] = useSearchParams();
  return (
    <>
      <div className="luminous-backdrop" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <aside className="luminous-sidebar">
        <Link to="/" className="luminous-brand">
          <span className="luminous-brand-mark" aria-hidden="true">
            ✦
          </span>
          <span>
            <strong>KOMARI</strong>
            <small>Cloud Monitor</small>
          </span>
        </Link>
        {params.get("view") === "theme-manage" ? (
          <nav aria-label="光域未来导航">
            <Link to="/">
              <LayoutDashboard />
              节点总览
            </Link>
            <Link to="/?view=theme-manage" aria-current="page">
              <Settings2 />
              设置中心
            </Link>
          </nav>
        ) : (
          <Navigation />
        )}
        <div className="luminous-sidebar-art">
          <ServerSculpture />
          <strong>KOMARI</strong>
          <small>
            Always Online
            <br />
            Globally Connected
            <br />
            光域未来 · ASTER
          </small>
        </div>
      </aside>
      <button
        className="luminous-motion-toggle"
        aria-label={paused ? "播放场景动画" : "暂停场景动画"}
        aria-pressed={paused}
        onClick={() => setPaused((v) => !v)}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
        <span>{paused ? "播放动效" : "动态场景"}</span>
      </button>
    </>
  );
}
function Navigation() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { data: me } = useAuth();
  const nodes = useAllNodeMeta();
  const { failureStreak } = useNodeStoreStatus();
  const current =
    pathname.match(/^\/instance\/([^/]+)/)?.[1] ??
    nodes.find((n) => !n.hidden)?.uuid;
  const url = current ? "/instance/" + encodeURIComponent(current) : "/";
  const ping =
    params.get("focus") === "ping" || params.get("focus") === "network";
  const links = [
    {
      label: "节点总览",
      icon: LayoutDashboard,
      href: "/",
      active: pathname === "/",
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
      label: "网络监控",
      icon: Globe2,
      href: current ? url + "?focus=ping" : "/",
      active: ping,
    },
    {
      label: "任务与报告",
      icon: ClipboardList,
      href: current ? url + "/report" : "/compare",
      active: pathname.endsWith("/report") || pathname === "/compare",
    },
    {
      label: me?.logged_in ? "设置中心" : "后台登录",
      icon: Settings2,
      href: me?.logged_in ? "/?view=theme-manage" : "/admin",
      active: false,
    },
  ];
  return (
    <>
      <nav aria-label="光域未来导航">
        {links.map(({ label, icon: Icon, href, active }) =>
          href === "/admin" ? (
            <a key={label} href={href}>
              <Icon />
              {label}
            </a>
          ) : (
            <Link
              key={label}
              to={href}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              {label}
            </Link>
          ),
        )}
      </nav>
      <div className="luminous-sync" data-warning={failureStreak >= 2}>
        <Activity size={15} />
        {failureStreak >= 2 ? "同步异常 · 正在重试" : "实时监控 · 自动同步"}
      </div>
    </>
  );
}
