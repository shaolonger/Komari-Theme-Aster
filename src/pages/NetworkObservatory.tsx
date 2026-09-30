import { Link } from "react-router-dom";
import { ArrowRight, HardDrive, Activity } from "lucide-react";
import { useAllNodeMeta } from "@/hooks/useNode";
import { NetworkSectionHeading } from "@/components/network/NetworkUi";
import "@/styles/network-observatory.css";
export function NetworkObservatory() {
  const nodes = useAllNodeMeta();
  return (
    <main className="network-page network-landing">
      <NetworkSectionHeading
        icon={Activity}
        title="在实例详情中查看网络观测"
        description="选择一台 VPS，进入「网络检测」即可配置定时计划、接入测量点和查看报告。"
      />
      <div className="network-node-picker">
        {nodes.map((node) => (
          <Link key={node.uuid} to={`/instance/${node.uuid}?focus=network`}>
            <HardDrive size={16} aria-hidden="true" />
            <span title={node.name}>{node.name}</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ))}
      </div>
      {!nodes.length && (
        <p className="network-help">
          尚无 VPS。接入 Komari 节点后即可在这里选择实例。
        </p>
      )}
      <Link className="network-back-link" to="/">
        返回 VPS 列表，选择多台进行批量配置{" "}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </main>
  );
}
