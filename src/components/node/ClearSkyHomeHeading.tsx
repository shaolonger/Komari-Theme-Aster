import { useViewMode } from "@/hooks/useViewMode";

const views = [{ value: "compact", label: "小卡片" }, { value: "standard", label: "标准" }, { value: "large", label: "大卡片" }, { value: "list", label: "列表" }] as const;

export default function ClearSkyHomeHeading({ count }: { count: number }) {
  const { mode, setMode } = useViewMode();
  return <div className="clear-sky-home-heading">
    <div><p className="clear-sky-eyebrow">KOMARI · CLEAR SKY</p><h1>节点概览</h1><p className="clear-sky-subtitle">{count} 台节点，连接每一处云端。</p></div>
    <div className="clear-sky-home-heading-end"><span className="clear-sky-live">实时监控</span><div className="clear-sky-view-switch" role="group" aria-label="澄空节点视图">
      {views.map(({ value, label }) => <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value}>{label}</button>)}
    </div></div>
  </div>;
}
