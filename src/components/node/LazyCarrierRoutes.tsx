import { lazy, Suspense } from "react";
import { useHomeRoutes } from "@/hooks/useHomeRoutes";

const Routes = lazy(() => import("./CarrierRoutes").then(module => ({ default: module.CarrierRoutes })));
export function CarrierRoutes(props: { uuid: string; compact?: boolean }) {
  const routes = useHomeRoutes();
  if (routes.data?.display === false || (!routes.isSlate && !routes.data?.nodes[props.uuid])) return null;
  return <Suspense fallback={routes.isSlate ? <section className="carrier-routes" style={{ minHeight: 180 }} aria-label="正在读取线路" /> : null}>
    <Routes {...props} />
  </Suspense>;
}
