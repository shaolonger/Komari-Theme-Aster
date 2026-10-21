import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePreferences } from "./usePreferences";
import { useThemeSettings } from "./useThemeSettings";
import { getHomeRoutes, type HomeRoutes } from "@/services/homeRoutes";
interface HomeRoutesState { data?: HomeRoutes; isPending: boolean; isError: boolean; isSlate: boolean; displayTimeZone: string }
const Context = createContext<HomeRoutesState>({ isPending: false, isError: false, isSlate: false, displayTimeZone: "system" });
export function HomeRoutesProvider({ children }: { children: ReactNode }) {
  const routes = useQuery({ queryKey: ["home-carrier-routes"], queryFn: getHomeRoutes, staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchInterval: query => query.state.data?.available ? 60_000 : false });
  const { appearance } = usePreferences();
  const { displayTimeZone } = useThemeSettings();
  const isSlate = appearance.startsWith("slate");
  const { data, isPending, isError } = routes;
  const value = useMemo(() => ({ data, isPending, isError, isSlate, displayTimeZone }), [data, isPending, isError, isSlate, displayTimeZone]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useHomeRoutes() { return useContext(Context); }
