import type { RefObject } from "react";
import { useClearSkyMotion } from "@/hooks/useClearSkyMotion";
import { ClearSkyHeader } from "./ClearSkyHeader";
import "@/styles/clear-sky.css";

export default function ClearSkyLayer({ shellRef }: { shellRef: RefObject<HTMLDivElement | null> }) {
  useClearSkyMotion(shellRef, true);
  return <><div className="clear-sky-backdrop" aria-hidden="true"><div className="clear-sky-ribbon" /><div className="clear-sky-halo" /></div><ClearSkyHeader /></>;
}
