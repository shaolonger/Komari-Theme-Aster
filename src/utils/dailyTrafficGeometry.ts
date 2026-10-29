import type { DailyTrafficPoint } from "./dailyTrafficTrend";

type Point = { x: number; y: number };
export function dailyTrafficGeometry(days: DailyTrafficPoint[]) {
  const max = Math.max(0, ...days.map((day) => day.bytes ?? 0));
  const segments: Point[][] = [];
  let current: Point[] = [];
  days.forEach((day, index) => {
    if (day.bytes == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: days.length <= 1 ? 50 : index * 100 / (days.length - 1), y: 22 - (max ? day.bytes / max * 19 : 0) });
  });
  if (current.length) segments.push(current);
  return segments.map((points) => {
    const start = points[0];
    if (points.length === 1) return { line: "", area: "", point: start };
    let line = `M ${start.x} ${start.y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1], next = points[i], midpoint = (prev.x + next.x) / 2;
      line += ` C ${midpoint} ${prev.y} ${midpoint} ${next.y} ${next.x} ${next.y}`;
    }
    return { line, area: `${line} L ${points.at(-1)!.x} 24 L ${start.x} 24 Z`, point: null };
  });
}
