import type { NetworkResult } from "@/services/networkObservatory";
import { parseNetworkReport } from "@/utils/networkReport";

export function NetworkSpeedTrend({ result, history }: { result: NetworkResult; history: NetworkResult[] }) {
  if (result.mode !== "speedtest") return null;
  const points = history.filter((item) => item.mode === "speedtest" && item.target === result.target && item.status === "success")
    .slice(0, 12).reverse().map((item) => {
      const values = parseNetworkReport(item).measurements;
      return {
        time: item.completedAt,
        upload: values.find((value) => value.label === "上传速度")?.value,
        download: values.find((value) => value.label === "下载速度")?.value,
      };
    }).filter((item): item is { time: string; upload: number; download: number } => item.upload !== undefined && item.download !== undefined);
  if (points.length < 2) return null;
  const peak = Math.max(...points.flatMap((point) => [point.upload, point.download]), 1);
  const position = (index: number, value: number) => `${20 + index * 360 / (points.length - 1)},${104 - value / peak * 88}`;
  return <figure className="network-speed-trend">
    <figcaption>最近 {points.length} 次到同一目标的测速趋势 <span>↑ 上传　↓ 下载 · Mbps</span></figcaption>
    <svg viewBox="0 0 400 120" role="img" aria-label="最近双向测速的上传与下载趋势" preserveAspectRatio="none">
      <line x1="20" x2="380" y1="104" y2="104" />
      <polyline className="network-speed-upload" points={points.map((point, index) => position(index, point.upload)).join(" ")} />
      <polyline className="network-speed-download" points={points.map((point, index) => position(index, point.download)).join(" ")} />
      {points.map((point, index) => <circle key={point.time} className="network-speed-upload" cx={20 + index * 360 / (points.length - 1)} cy={104 - point.upload / peak * 88} r="2.5"><title>{new Date(point.time).toLocaleString()} 上传 {point.upload.toFixed(1)} Mbps，下载 {point.download.toFixed(1)} Mbps</title></circle>)}
    </svg>
    <small>{new Date(points[0].time).toLocaleDateString()} — {new Date(points[points.length - 1].time).toLocaleDateString()} · 纵轴按当前可见结果自动缩放</small>
  </figure>;
}
