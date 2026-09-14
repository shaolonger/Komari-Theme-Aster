import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import {
  VPS_LIST_SORT_GROUPS,
  VPS_LIST_SORT_LABELS,
  type VpsListSortCondition,
  type VpsListSortKey,
} from "@/utils/vpsListSort";

export function VpsListSortPanel({
  sorts,
  onToggle,
  onChangeDirection,
  onMove,
  onRemove,
  onReset,
  onClose,
}: {
  sorts: VpsListSortCondition[];
  onToggle: (key: VpsListSortKey) => void;
  onChangeDirection: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <section className="node-list-sort-panel" aria-label="列表排序设置">
      <header>
        <div>
          <strong>自定义列表排序</strong>
          <p>点击表头设置主排序，Shift 点击或下方字段可追加多级条件。</p>
        </div>
        <div className="node-list-sort-panel-actions">
          <button type="button" onClick={onReset} title="恢复默认排序">
            <RotateCcw size={13} aria-hidden />
            默认
          </button>
          <button type="button" onClick={onClose} aria-label="关闭排序设置" title="关闭">
            <X size={14} aria-hidden />
          </button>
        </div>
      </header>

      <div className="node-list-active-sorts" aria-label="当前排序优先级">
        {sorts.map((condition, index) => (
          <div key={condition.key} className="node-list-active-sort">
            <span className="node-list-sort-priority">{index + 1}</span>
            <strong>{VPS_LIST_SORT_LABELS[condition.key]}</strong>
            <button
              type="button"
              className="node-list-sort-direction"
              onClick={() => onChangeDirection(index)}
              aria-label={`${VPS_LIST_SORT_LABELS[condition.key]}当前${condition.direction === "asc" ? "升序" : "降序"}，点击切换`}
            >
              {condition.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {condition.direction === "asc" ? "升序" : "降序"}
            </button>
            <span className="node-list-sort-move">
              <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label={`提高${VPS_LIST_SORT_LABELS[condition.key]}优先级`}>
                <ChevronUp size={13} />
              </button>
              <button type="button" disabled={index === sorts.length - 1} onClick={() => onMove(index, 1)} aria-label={`降低${VPS_LIST_SORT_LABELS[condition.key]}优先级`}>
                <ChevronDown size={13} />
              </button>
            </span>
            <button type="button" className="node-list-sort-remove" onClick={() => onRemove(index)} aria-label={`移除${VPS_LIST_SORT_LABELS[condition.key]}排序`}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="node-list-sort-fields">
        {VPS_LIST_SORT_GROUPS.map((group) => (
          <div key={group.label}>
            <span>{group.label}</span>
            <div>
              {group.keys.map((key) => {
                const index = sorts.findIndex((condition) => condition.key === key);
                return (
                  <button
                    key={key}
                    type="button"
                    data-active={index >= 0 ? "true" : "false"}
                    onClick={() => onToggle(key)}
                  >
                    {VPS_LIST_SORT_LABELS[key]}
                    {index >= 0 && <sup>{index + 1}</sup>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
