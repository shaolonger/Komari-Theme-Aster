import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { SettingSwitch } from "./SettingSwitch";
import { useDragReorder } from "./dragReorder";

export function OverviewEditor({ overview, groupsVisible, offlineLast, onOverviewChange, onGroupsChange, onOfflineChange, groups, loading, onMove, onReorder }: {
  overview: boolean; groupsVisible: boolean; offlineLast: boolean;
  onOverviewChange: (value: boolean) => void; onGroupsChange: (value: boolean) => void; onOfflineChange: (value: boolean) => void;
  groups: string[]; loading: boolean; onMove: (index: number, direction: -1 | 1) => void; onReorder: (groups: string[]) => void;
}) {
  const drag = useDragReorder(groups, onReorder, (group) => group);
  return <div className="studio-overview-editor"><div className="studio-setting-group">
    <SettingSwitch title="顶部总览" detail="集中展示在线节点、今日流量、实时带宽与 7 天到期情况。" checked={overview} onChange={onOverviewChange} />
    <SettingSwitch title="分组导航" detail="显示按分组切换节点的入口，顺序可在下方调整。" checked={groupsVisible} onChange={onGroupsChange} />
    <SettingSwitch title="优先显示在线节点" detail="将当前分组中的离线节点排在后面。" checked={offlineLast} onChange={onOfflineChange} />
  </div><section className="studio-group-order"><h3>分组导航顺序</h3><p>{groupsVisible ? "拖住手柄可调整首页分组的显示顺序，也可使用箭头微调。" : "分组导航已隐藏；你仍可拖拽调整启用后的顺序。"}</p>
    {groups.length === 0 ? <p role="status">{loading ? "正在加载分组…" : "暂无分组，为节点设置分组后即可调整。"}</p> : <ol>{groups.map((group, index) => <li key={group} {...drag.getItemProps(group)}>
      <button type="button" className="studio-drag-handle" {...drag.getHandleProps(group)}><GripVertical size={16} /></button>
      <span className="studio-group-number">{index + 1}</span><strong>{group}</strong>
      <button type="button" disabled={index === 0} aria-label={`上移 ${group}`} onClick={() => onMove(index, -1)}><ArrowUp size={16} /></button>
      <button type="button" disabled={index === groups.length - 1} aria-label={`下移 ${group}`} onClick={() => onMove(index, 1)}><ArrowDown size={16} /></button>
    </li>)}</ol>}
    <span className="sr-only" role="status">{drag.announcement}</span>
  </section></div>;
}
