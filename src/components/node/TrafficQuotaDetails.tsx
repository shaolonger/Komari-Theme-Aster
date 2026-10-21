import { lazy, Suspense } from "react";
import type { TrafficDisplay } from "@/utils/traffic";

const Content = lazy(() => import("./TrafficQuotaDetailsContent"));

export function TrafficQuotaDetails({ traffic }: { traffic: TrafficDisplay }) {
  return <Suspense fallback={<div className="sky-traffic-quota" aria-busy="true">流量 {traffic.detail}</div>}><Content traffic={traffic} /></Suspense>;
}
