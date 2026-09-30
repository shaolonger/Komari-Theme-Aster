import {NativePlanPanel} from './NativePlanPanel';
import { NetworkDrawer } from './NetworkDrawer';
import { NetworkPolicyPanel } from './NetworkPolicyPanel';

export default function HomeNetworkBatch({ nodes, onClose }: { nodes: string[]; onClose: () => void }) {
  return <NetworkDrawer title="批量配置网络检测" onClose={onClose}><NativePlanPanel initialNodes={nodes} /><details><summary>高级工具方案与旧计划</summary><NetworkPolicyPanel initialNodes={nodes} /></details></NetworkDrawer>;
}
