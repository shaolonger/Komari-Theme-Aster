import { lazy, Suspense } from "react";
import { useHomeSpeeds } from "@/hooks/useHomeRoutes";
const Speeds = lazy(() => import("./CarrierSpeeds").then(module => ({ default: module.CarrierSpeeds })));
export function CarrierSpeeds(props: { uuid: string; compact?: boolean }) {
  const { data } = useHomeSpeeds();
  if (!data?.nodes[props.uuid] || data.display === false) return null;
  return <Suspense fallback={null}><Speeds {...props} /></Suspense>;
}
