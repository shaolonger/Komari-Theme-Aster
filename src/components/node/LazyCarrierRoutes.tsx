import { lazy, Suspense } from "react";
import { useHomeRoutes } from "@/hooks/useHomeRoutes";

const Routes = lazy(() => import("./CarrierRoutes").then(module => ({ default: module.CarrierRoutes })));
export function CarrierRoutes(props: { uuid: string; compact?: boolean }) {
  const routes = useHomeRoutes();
  if (routes.data?.display === false || (!routes.data?.nodes[props.uuid] && !routes.data?.quickFamilies[props.uuid]?.length)) return null;
  return <Suspense fallback={null}>
    <Routes {...props} />
  </Suspense>;
}
