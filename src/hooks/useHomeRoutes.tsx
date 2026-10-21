import { createContext, useContext, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getHomeRoutes, type HomeRoutes } from "@/services/homeRoutes";
const Context = createContext<Pick<UseQueryResult<HomeRoutes>, "data" | "isPending" | "isError">>({ data: undefined, isPending: false, isError: false });
export function HomeRoutesProvider({ children }: { children: ReactNode }) {
  const routes = useQuery({ queryKey: ["home-carrier-routes"], queryFn: getHomeRoutes, staleTime: 60_000, retry: false, refetchOnWindowFocus: false, refetchInterval: query => query.state.data?.available ? 60_000 : false });
  return <Context.Provider value={routes}>{children}</Context.Provider>;
}
export function useHomeRoutes() { return useContext(Context); }
