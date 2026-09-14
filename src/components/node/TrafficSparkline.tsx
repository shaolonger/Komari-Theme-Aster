import { useCallback } from "react";
import type { TrafficTrendSample } from "@/types/komari";
import { CanvasStrip, mixSrgbTowardWhite, safeCanvasColor } from "./CanvasStrip";

interface TrafficSparklineProps {
  samples: TrafficTrendSample[];
  color: string;
  height?: number;
  className?: string;
  redrawKey?: string | number;
}

/**
 * Draws the recent realtime samples behind the current traffic rate.
 * The store keeps the latest 18 samples, so this remains useful without a
 * second history request for every card.
 */
export function TrafficSparkline({
  samples,
  color,
  height = 28,
  className = "traffic-sparkline",
  redrawKey,
}: TrafficSparklineProps) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, canvasHeight: number) => {
      const baseColor = safeCanvasColor(color);
      const inactiveColor = safeCanvasColor("var(--progress-bg)");
      const top = 2;
      const bottom = canvasHeight - 2;
      const usableHeight = Math.max(1, bottom - top);
      const points = samples.length > 0
        ? samples.map((sample, index) => ({
            x: samples.length > 1 ? (index * width) / (samples.length - 1) : width / 2,
            y: bottom - Math.max(0.08, Math.min(1, sample.level || 0.08)) * usableHeight,
            active: sample.value > 0,
          }))
        : [{ x: width / 2, y: bottom, active: false }];

      ctx.strokeStyle = inactiveColor;
      ctx.globalAlpha = 0.56;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bottom);
      ctx.lineTo(width, bottom);
      ctx.stroke();

      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.lineTo(points.at(-1)?.x ?? width, bottom);
      ctx.lineTo(points[0]?.x ?? 0, bottom);
      ctx.closePath();
      ctx.fillStyle = mixSrgbTowardWhite(baseColor, 0.78);
      ctx.globalAlpha = 0.2;
      ctx.fill();

      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.92;
      ctx.stroke();

      points.forEach((point) => {
        if (!point.active) return;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.35, 0, Math.PI * 2);
        ctx.fillStyle = baseColor;
        ctx.globalAlpha = 0.86;
        ctx.fill();
      });

      ctx.globalAlpha = 1;
    },
    [color, samples],
  );

  return (
    <CanvasStrip
      className={className}
      height={height}
      ariaHidden
      redrawKey={redrawKey}
      draw={draw}
    />
  );
}
