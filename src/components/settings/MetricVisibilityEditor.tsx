import { SettingSwitch } from './SettingSwitch';

export function MetricVisibilityEditor({ traffic, billing, uptime, connections, onTrafficChange, onBillingChange, onUptimeChange, onConnectionsChange }: {
  traffic: boolean; billing: boolean; uptime: boolean; connections: boolean;
  onTrafficChange: (value: boolean) => void; onBillingChange: (value: boolean) => void;
  onUptimeChange: (value: boolean) => void; onConnectionsChange: (value: boolean) => void;
}) {
  return <div className="studio-metric-editor"><div className="studio-setting-group">
    <SettingSwitch title="累计流量" detail="在小卡片中显示出站、入站总量，便于检查流量消耗。" checked={traffic} onChange={onTrafficChange}/>
    <SettingSwitch title="续费与到期" detail="在小卡片中显示价格和剩余天数，便于安排续费。" checked={billing} onChange={onBillingChange}/>
    <SettingSwitch title="持续在线时间" detail="在小卡片中显示本次持续运行的时长。" checked={uptime} onChange={onUptimeChange}/>
    <SettingSwitch title="TCP / UDP 连接数" detail="同时影响大卡片和小卡片；数据由节点上报。" checked={connections} onChange={onConnectionsChange}/>
  </div><aside className="studio-metric-summary" aria-live="polite"><strong>卡片信息层级</strong><p>始终显示：节点状态、实时速率</p><p>按需显示：{[traffic && '累计流量', billing && '续费到期', uptime && '在线时间', connections && '连接数'].filter(Boolean).join('、') || '无附加指标'}</p><small>关闭显示项不会停止采集，也不会删除历史数据。</small></aside></div>;
}
