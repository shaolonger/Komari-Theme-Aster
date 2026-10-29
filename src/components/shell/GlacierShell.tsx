import { useLayoutEffect } from "react";
import {
  Boxes,
  ChartNoAxesCombined,
  ClipboardList,
  Globe2,
  Layers2,
  Settings2,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useNodeStoreStatus, useVisibleNodeUuids } from "@/hooks/useNode";
import { notifyPaletteChanged } from "@/utils/palette";
import "@/styles/glacier.css";

export default function GlacierShell() {
  useLayoutEffect(notifyPaletteChanged, []);
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { data: me } = useAuth();
  // Keep the Studio free of realtime subscriptions, as in the shared shell.
  return (
    <>
      <div className="glacier-backdrop" aria-hidden="true" />
      <aside className="glacier-sidebar">
        <Link to="/" className="glacier-brand">
          <span>
            K<span>·</span>
          </span>
          <strong>KOMARI</strong>
        </Link>
        {params.get("view") === "theme-manage" ? (
          <StudioNavigation />
        ) : (
          <FleetNavigation
            pathname={pathname}
            focus={params.get("focus")}
            loggedIn={me?.logged_in === true}
          />
        )}
        <div className="glacier-sidebar-caption">
          ASTER <span>冰川 · GLACIER</span>
        </div>
      </aside>
    </>
  );
}

function StudioNavigation() {
  return (
    <nav aria-label="冰川导航">
      <Link to="/">
        <Layers2 />
        总览
      </Link>
      <Link to="/?view=theme-manage" aria-current="page">
        <Settings2 />
        设置
      </Link>
    </nav>
  );
}

function FleetNavigation({
  pathname,
  focus,
  loggedIn,
}: {
  pathname: string;
  focus: string | null;
  loggedIn: boolean;
}) {
  const uuids = useVisibleNodeUuids();
  const { failureStreak } = useNodeStoreStatus();
  const current = pathname.match(/^\/instance\/([^/]+)/)?.[1] ?? uuids[0];
  const nodeUrl = current ? `/instance/${encodeURIComponent(current)}` : "/";
  const items = [
    { label: "总览", icon: Layers2, to: "/", active: pathname === "/" },
    {
      label: "节点",
      icon: Boxes,
      to: nodeUrl,
      active:
        pathname.startsWith("/instance/") &&
        !focus &&
        !pathname.endsWith("/report"),
    },
    {
      label: "网络",
      icon: Globe2,
      to: `${nodeUrl}${current ? "?focus=ping" : ""}`,
      active: focus === "ping" || focus === "network",
    },
    {
      label: "任务与报告",
      icon: ClipboardList,
      to: current ? `${nodeUrl}/report` : "/compare",
      active: pathname.endsWith("/report") || pathname === "/compare",
    },
    {
      label: loggedIn ? "设置" : "后台登录",
      icon: Settings2,
      to: loggedIn ? "/?view=theme-manage" : "/admin",
      active: false,
    },
  ];
  return (
    <>
      <nav aria-label="冰川导航">
        {items.map(({ label, icon: Icon, to, active }) =>
          to === "/admin" ? (
            <a key={label} href={to}>
              <Icon />
              {label}
            </a>
          ) : (
            <Link
              key={label}
              to={to}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              {label}
            </Link>
          ),
        )}
      </nav>
      <div className="glacier-system-status" data-warning={failureStreak >= 2}>
        <span className="glacier-status-dot" />
        <div>
          <strong>
            {failureStreak >= 2
              ? "状态同步异常"
              : uuids.length
                ? "实时监控已连接"
                : "等待节点上报"}
          </strong>
          <small>
            {failureStreak >= 2
              ? "正在重试，显示最近缓存"
              : "自动同步节点运行状态"}
          </small>
        </div>
        <ChartNoAxesCombined size={16} />
      </div>
    </>
  );
}
