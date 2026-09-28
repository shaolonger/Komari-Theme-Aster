import { NetworkDrawer } from './NetworkDrawer';
import { NetworkPolicyPanel } from './NetworkPolicyPanel';

export default function HomeNetworkBatch({ nodes, onClose }: { nodes: string[]; onClose: () => void }) {
  return <NetworkDrawer title="批量配置网络检测" onClose={onClose}><NetworkPolicyPanel initialNodes={nodes} /></NetworkDrawer>;
}
