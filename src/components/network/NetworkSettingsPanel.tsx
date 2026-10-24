import { useStudioSectionActive } from "@/components/settings/SettingsStudio";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportCatalog } from "@/services/reportObservatory";
import { HomeRoutesPublishPanel } from "./HomeRoutesPublishPanel";
import { HomeSpeedsPublishPanel } from "./HomeSpeedsPublishPanel";
import { MeasurementPointsPanel } from "./MeasurementPointsPanel";
import { ReportResourcesPanel } from "./ReportResourcesPanel";
import { ReportPlanPanel } from "./ReportPlanPanel";
import "@/styles/network-observatory.css";
import "@/styles/network-reports.css";
type Props = { panel: "routes" | "speeds" | "plans" | "agents" | "targets" };
export function NetworkSettingsPanel(props: Props) {
  const active = useStudioSectionActive("network");
  return active ? <ActivePanel {...props} /> : null;
}
function ActivePanel({ panel }: Props) {
  const initialNodes = (
    new URLSearchParams(window.location.search).get("nodes") || ""
  )
    .split(",")
    .filter(Boolean);
  const catalog = useQuery({
    queryKey: ["report-catalog"],
    queryFn: reportCatalog,
    retry: false,
    staleTime: 30000,
  });
  const loaded = Boolean(catalog.data);
  useEffect(() => {
    if (
      !loaded ||
      new URLSearchParams(window.location.search).get("panel") !== panel
    )
      return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById("network-" + panel)
        ?.closest(".aster-studio-panel")
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [panel, loaded]);
  if (panel === "plans") return <ReportPlanPanel initialNodes={initialNodes} />;
  if (panel === "agents")
    return <MeasurementPointsPanel initialNodes={initialNodes} />;
  if (panel === "targets") return <ReportResourcesPanel />;
  if (!catalog.data)
    return (
      <p role="status">
        {catalog.error?.message || "正在读取三网线路设置…"}
        <button onClick={() => void catalog.refetch()}>重试</button>
      </p>
    );
  return panel === "speeds" ? <HomeSpeedsPublishPanel catalog={catalog.data} /> : <HomeRoutesPublishPanel catalog={catalog.data} />;
}
