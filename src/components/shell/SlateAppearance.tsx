import { useLayoutEffect } from "react";
import { notifyPaletteChanged } from "@/utils/palette";
import "@/styles/slate.css";

export default function SlateAppearance() {
  useLayoutEffect(notifyPaletteChanged, []);
  return null;
}
