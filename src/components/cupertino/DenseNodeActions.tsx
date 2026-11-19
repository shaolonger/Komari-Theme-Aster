import { useState } from "react";
import { Globe, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { toggleLuminousFavorite } from "@/hooks/useLuminousFavorites";
import type { NodeInfo } from "@/types/komari";

export function DenseNodeActions({
  node,
  detailUrl,
  favorite,
  icon: Icon = Globe,
}: {
  node: Pick<NodeInfo, "uuid" | "name" | "ipv4" | "ipv6">;
  detailUrl: string;
  favorite: boolean;
  icon?: LucideIcon;
}) {
  const { uuid } = node;
  const [copied, setCopied] = useState("");
  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("已复制");
    } catch {
      setCopied("复制失败");
    }
  };

  return (
    <details className="dense-node-actions" onToggle={(event) => {
      if (!event.currentTarget.open) setCopied("");
    }}>
      <summary aria-label={`${node.name} 节点操作`} title="节点操作">
        <Icon />
      </summary>
      <div className="dense-node-menu">
        <Link to={detailUrl}>节点详情</Link>
        <Link to={`${detailUrl}?focus=ping`}>网络监控</Link>
        <Link to={`${detailUrl}/report`}>生成报告</Link>
        <button type="button" aria-pressed={favorite} onClick={() => toggleLuminousFavorite(uuid)}>
          {favorite ? "取消收藏" : "收藏节点"}
        </button>
        {([["IPv4", node.ipv4], ["IPv6", node.ipv6]] as const).map(([family, address]) => address && (
          <button type="button" key={family} onClick={() => void copy(address)} title={address}>
            复制 {family} · {address}
          </button>
        ))}
        {copied && <small role="status">{copied}</small>}
      </div>
    </details>
  );
}
