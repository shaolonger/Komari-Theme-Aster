import { useId } from 'react';
import type { HomepagePingAggregationStrategy } from '@/utils/homepagePingSettings';
const options = [
  { value: 'worst', title: '发现异常', description: '取最高延迟和最高丢包，优先暴露不稳定的线路。', example: '两项延迟为 20 / 80 ms → 显示 80 ms' },
  { value: 'primary', title: '关注主线路', description: '使用节点指定的主任务；主任务无样本时回退风险优先。', example: '主任务为 20 ms → 显示 20 ms' },
  { value: 'average', title: '观察整体水平', description: '使用可用任务的平均延迟和丢包，适合观察总体趋势。', example: '两项延迟为 20 / 80 ms → 显示 50 ms' },
] as const;
export function NetworkStrategyEditor({ value, onChange }: { value: HomepagePingAggregationStrategy; onChange: (value: HomepagePingAggregationStrategy) => void }) {
  const id = useId();
  return <fieldset className="studio-network-strategy"><legend>首页汇总如何呈现</legend><p>决定汇总数字的含义；每条任务曲线和排列顺序保持独立。</p>{options.map(option => <label key={option.value}><input type="radio" name={id} checked={value === option.value} onChange={() => onChange(option.value)}/><span><strong>{option.title}</strong><small>{option.description}</small><em>{option.example}</em></span></label>)}</fieldset>;
}
