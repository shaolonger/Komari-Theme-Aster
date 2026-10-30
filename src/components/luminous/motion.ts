export const MOTION_EVENT = "aster-luminous-motion";
export function motionAllowed() {
  return (
    document.documentElement.dataset.luminousMotion !== "paused" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
