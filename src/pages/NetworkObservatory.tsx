import { Link } from "react-router-dom";
import { useAllNodeMeta } from "@/hooks/useNode";
import "@/styles/network-observatory.css";
export function NetworkObservatory() {
  const nodes = useAllNodeMeta();
  return <main className="network-page"><h1>网络检测已迁入实例详情</h1><p>选择一台 VPS，在「网络检测」标签中接入探测器、配置计划和查看报告。</p><div className="network-node-picker">{nodes.map((node) => <Link key={node.uuid} to={`/instance/${node.uuid}?focus=network`}>{node.name} →</Link>)}</div><Link to="/">返回 VPS 列表，选择多台进行批量配置</Link></main>;
}
