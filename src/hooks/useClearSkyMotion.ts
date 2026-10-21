import { useEffect, type RefObject } from "react";
import { subscribeMediaQuery } from "@/utils/mediaQuery";

// One delegated listener and one pending frame for the whole fleet. Never add
// timers, React state, or compositing layers to every realtime node card.
export function useClearSkyMotion(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const shell = ref.current;
    if (!enabled || !shell) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const halo = shell.querySelector<HTMLElement>(".clear-sky-halo");
    let frame = 0;
    let active: HTMLElement | null = null;
    let target: HTMLElement | null = null;
    let x = 0;
    let y = 0;
    const resetCard = () => {
      active?.style.removeProperty("--sky-rotate-x");
      active?.style.removeProperty("--sky-rotate-y");
      active?.classList.remove("sky-is-tilted");
      active = null;
    };
    const reset = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      target = null;
      resetCard();
      halo?.style.removeProperty("transform");
    };
    const draw = () => {
      frame = 0;
      if (!fine.matches || reduced.matches) { reset(); return; }
      if (active !== target) resetCard();
      active = target;
      if (active) {
        const bounds = active.getBoundingClientRect();
        active.style.setProperty("--sky-rotate-x", `${Math.max(-2, Math.min(2, -((y - bounds.top) / bounds.height - .5) * 4))}deg`);
        active.style.setProperty("--sky-rotate-y", `${Math.max(-2, Math.min(2, ((x - bounds.left) / bounds.width - .5) * 4))}deg`);
        active.classList.add("sky-is-tilted");
      }
      if (halo) halo.style.transform = `translate(${(x / innerWidth - .5) * 15}px, ${(y / innerHeight - .5) * 12}px)`;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !fine.matches || reduced.matches) return;
      x = event.clientX; y = event.clientY;
      target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(".server-card:not([aria-busy]), .compact-node-card:not([aria-busy])") : null;
      if (!frame) frame = window.requestAnimationFrame(draw);
    };
    const unbindFine = subscribeMediaQuery(fine, reset);
    const unbindReduced = subscribeMediaQuery(reduced, reset);
    shell.addEventListener("pointermove", move, { passive: true });
    shell.addEventListener("pointerleave", reset);
    // Scrolling can remove/virtualize the hovered card without a pointer event.
    window.addEventListener("scroll", reset, { passive: true });
    return () => {
      reset(); unbindFine(); unbindReduced();
      shell.removeEventListener("pointermove", move);
      shell.removeEventListener("pointerleave", reset);
      window.removeEventListener("scroll", reset);
    };
  }, [enabled, ref]);
}
