import { Layers2, Sparkles } from "lucide-react";
import { Link, NavLink, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function ClearSkyHeader() {
  const { data: me } = useAuth();
  const [params] = useSearchParams();
  if (params.get("view") === "theme-manage") return null;
  return (
    <header className="clear-sky-header">
      <NavLink to="/" className="clear-sky-brand" aria-label="Aster 首页">
        <span className="clear-sky-logo"><Layers2 size={21} aria-hidden="true" /></span>
        <strong>Aster<span>·</span></strong><span className="clear-sky-brand-caption">KOMARI</span>
      </NavLink>
      <nav aria-label="澄空导航">
        <NavLink to="/" end>节点概览</NavLink>
        <NavLink to="/network-observatory">网络观测</NavLink>
        {me?.logged_in && <Link to="/?view=theme-manage">主题设置</Link>}
      </nav>
      <span className="clear-sky-theme"><Sparkles size={15} aria-hidden="true" />澄空</span>
    </header>
  );
}
