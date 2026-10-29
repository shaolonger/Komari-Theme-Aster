import { lazy, Suspense } from "react";
const Trend = lazy(() => import("./DailyTrafficTrend"));
export function DailyTrafficTrend({ uuid }: { uuid: string }) {
  return <Suspense fallback={null}><Trend uuid={uuid} /></Suspense>;
}
