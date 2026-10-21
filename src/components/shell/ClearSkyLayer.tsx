import { useLayoutEffect, type RefObject } from "react";
import { notifyPaletteChanged } from "@/utils/palette";
import { useClearSkyMotion } from "@/hooks/useClearSkyMotion";
import { ClearSkyHeader } from "./ClearSkyHeader";
import "@/styles/clear-sky.css";

export default function ClearSkyLayer({ shellRef }: { shellRef: RefObject<HTMLDivElement | null> }) {
  useClearSkyMotion(shellRef, true);
  useLayoutEffect(notifyPaletteChanged, []);
  return <><div className="clear-sky-backdrop" aria-hidden="true"><div className="clear-sky-ribbon" /><div className="clear-sky-halo" /></div><ClearSkyHeader /></>;
}
