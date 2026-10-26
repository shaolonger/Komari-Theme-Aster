import { createContext, Fragment, lazy, Suspense, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { usePreferences } from "./usePreferences";
import { useThemeSettings } from "./useThemeSettings";
import { getHomeRoutes, type HomeRoutes } from "@/services/homeRoutes";
import type { HomeSpeeds } from "@/services/homeSpeeds";
import { CardChecksBoundary } from "./cardCheckContext";
const CardChecksController = lazy(() => import("./CardChecksController"));
interface HomeRoutesState { data?: HomeRoutes; speeds?: HomeSpeeds; isPending: boolean; isError: boolean; isSlate: boolean; displayTimeZone: string }
const Context = createContext<HomeRoutesState>({ isPending: false, isError: false, isSlate: false, displayTimeZone: "system" });
export function HomeRoutesProvider({ children }: { children: ReactNode }) {
  const { data: me } = useAuth();
  const admin = me?.logged_in === true;
  const routes = useQuery({ queryKey: ["home-carrier-routes", admin], queryFn: ({ signal }) => getHomeRoutes({ signal }, admin), staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchInterval: query => query.state.data?.available ? 60_000 : false });
  const { data: speeds } = useQuery({ queryKey: ["home-carrier-speeds", admin], queryFn: async ({ signal }) => (await import("@/services/homeSpeeds")).getHomeSpeeds({ signal }, admin), staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchInterval: query => query.state.data?.backfillPending ? 5000 : query.state.data?.available ? 60_000 : false });
  const { appearance } = usePreferences();
  const { displayTimeZone } = useThemeSettings();
  const isSlate = appearance.startsWith("slate");
  const { data, isPending, isError } = routes;
  const value = useMemo(() => ({ data, speeds, isPending, isError, isSlate, displayTimeZone }), [data, speeds, isPending, isError, isSlate, displayTimeZone]);
  return <Context.Provider value={value}><CardChecksBoundary>
    {admin && (data?.quickCheck || speeds?.quickCheck) && <Suspense fallback={null}><CardChecksController /></Suspense>}
    <Fragment key="cards">{children}</Fragment>
  </CardChecksBoundary></Context.Provider>;
}
export function useHomeRoutes() { return useContext(Context); }
export function useHomeSpeeds() {
  const { speeds: data, displayTimeZone } = useHomeRoutes();
  return { data, displayTimeZone };
}
