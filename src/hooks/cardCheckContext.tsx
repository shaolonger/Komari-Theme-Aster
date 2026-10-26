import { createContext, useMemo, useState, type ReactNode } from "react";
import type { CardCheckModule, CardProgress } from "@/services/cardChecks";

export type Entry = { nodeUuid: string; module: CardCheckModule; family: "4" | "6"; id?: string; pending?: boolean;
  progress?: CardProgress; error?: string; pollError?: boolean; syncing?: boolean; finishedAt?: number; createdAt: number };

export interface CardStore {
  values: Record<string, Entry>;
  getAll: () => Record<string, Entry>;
  subscribe: (listener: () => void) => () => void;
  subscribeKey: (key: string, listener: () => void) => () => void;
  update: (patches: Record<string, Entry>) => void;
  clear: () => void;
}
export type CardController = { store: CardStore; allowed: boolean; start: (uuid: string, module: CardCheckModule, family: "4" | "6") => void };
export const CardChecksRegistry = createContext<{controller: CardController | null; register: (value: CardController | null) => void}>({controller:null,register:()=>{}});
export function CardChecksBoundary({children}:{children:ReactNode}) {
  const [controller,register] = useState<CardController | null>(null);
  const value = useMemo(()=>({controller,register}),[controller]);
  return <CardChecksRegistry.Provider value={value}>{children}</CardChecksRegistry.Provider>;
}
