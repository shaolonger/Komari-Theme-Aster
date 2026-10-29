import { useLayoutEffect } from "react";
import {
  Activity,
  Boxes,
  ClipboardList,
  Globe2,
  LayoutDashboard,
  Settings2,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useNodeStoreStatus } from "@/hooks/useNode";
import { getDisplayRegionCode } from "@/utils/geo";
import { regionLabel } from "@/components/glacier/regionLabel";
import { notifyPaletteChanged } from "@/utils/palette";
import "@/styles/orbital.css";

export default function OrbitalShell() {
  useLayoutEffect(notifyPaletteChanged, []);
  const [params] = useSearchParams();
  return (
    <>
      <div className="orbital-backdrop" aria-hidden="true" />
      <aside className="orbital-sidebar">
        <Link to="/" className="orbital-brand">
          <span className="orbital-logo" aria-hidden="true" />
          <span>
            <strong>KOMARI</strong>
            <small>O R B I T A L</small>
          </span>
        </Link>
        {params.get("view") === "theme-manage" ? (
          <nav aria-label="星轨导航">
            <Link to="/">
              <LayoutDashboard />
              总览
            </Link>
            <Link to="/?view=theme-manage" aria-current="page">
              <Settings2 />
              设置
            </Link>
          </nav>
        ) : (
          <FleetNavigation />
        )}
        <div className="orbital-sidebar-foot">
          <div className="orbital-planet" aria-hidden="true" />
          <strong>
            KOMARI <span>ORBITAL</span>
          </strong>
          <small>
            连接每一处云端
            <br />
            星轨 · ASTER
          </small>
        </div>
      </aside>
    </>
  );
}

function FleetNavigation() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { data: me } = useAuth();
  const nodes = useAllNodeMeta();
  const { failureStreak } = useNodeStoreStatus();
  const current =
    pathname.match(/^\/instance\/([^/]+)/)?.[1] ??
    nodes.find((n) => !n.hidden)?.uuid;
  const url = current ? `/instance/${encodeURIComponent(current)}` : "/";
  const ping =
    params.get("focus") === "ping" || params.get("focus") === "network";
  const groups = new Map<string, number>();
  for (const node of nodes)
    if (me?.logged_in || !node.hidden) {
      const code = getDisplayRegionCode(node.region);
      groups.set(code, (groups.get(code) ?? 0) + 1);
    }
  const links = [
    {
      label: "总览",
      icon: LayoutDashboard,
      href: "/",
      active: pathname === "/",
    },
    {
      label: "节点",
      icon: Boxes,
      href: url,
      active:
        pathname.startsWith("/instance/") &&
        !pathname.endsWith("/report") &&
        !ping,
    },
    {
      label: "网络诊断",
      icon: Globe2,
      href: current ? `${url}?focus=ping` : "/",
      active: ping,
    },
    {
      label: "任务与报告",
      icon: ClipboardList,
      href: current ? `${url}/report` : "/compare",
      active: pathname.endsWith("/report") || pathname === "/compare",
    },
    {
      label: me?.logged_in ? "设置" : "后台登录",
      icon: Settings2,
      href: me?.logged_in ? "/?view=theme-manage" : "/admin",
      active: false,
    },
  ];
  return (
    <>
      <nav aria-label="星轨导航">
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
      {pathname === "/" && groups.size > 0 && (
        <div className="orbital-sidebar-groups">
          <span>节点地区</span>
          <Link
            to="/"
            aria-current={!params.get("region") ? "true" : undefined}
          >
            <Boxes size={16} />
            全部节点
            <strong>{[...groups.values()].reduce((a, b) => a + b, 0)}</strong>
          </Link>
          {[...groups]
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => (
              <Link
                key={code}
                to={`/?region=${code}`}
                aria-current={
                  params.get("region") === code ? "true" : undefined
                }
              >
                <Globe2 size={15} />
                {code === "UN" ? "未设置地区" : regionLabel(code)}
                <strong>{count}</strong>
              </Link>
            ))}
        </div>
      )}
      <div className="orbital-sync" data-warning={failureStreak >= 2}>
        <Activity size={14} />
        {failureStreak >= 2 ? "同步异常 · 正在重试" : "实时监控 · 自动同步"}
      </div>
    </>
  );
}
