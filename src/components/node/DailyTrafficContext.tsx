import { createContext, useMemo, type ReactNode } from "react";
import type { LoadRecord } from "@/types/komari";
import type { DisplayTimeZone } from "@/utils/timeDisplay";

type History = Record<string, LoadRecord[]>;
export const DailyTrafficContext = createContext<{ records: History | undefined; now: number; timeZone: DisplayTimeZone }>({ records: undefined, now: 0, timeZone: "system" });

export function DailyTrafficProvider({ records, now, timeZone, children }: { records: History | undefined; now: number; timeZone: DisplayTimeZone; children: ReactNode }) {
  const value = useMemo(() => ({ records, now, timeZone }), [records, now, timeZone]);
  return <DailyTrafficContext.Provider value={value}>{children}</DailyTrafficContext.Provider>;
}
