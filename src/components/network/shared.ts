import type { NetworkAgent, NetworkMode, NetworkTiming } from "@/services/networkObservatory";
export const MODES: { id: NetworkMode; name: string; tool: string; intervals: number[] }[] = [
  { id: "https", name: "HTTPS 可用性", tool: "curl", intervals: [1, 5, 15, 60, 360, 720, 1440] },
  { id: "route", name: "路径追踪", tool: "nexttrace", intervals: [360, 720, 1440] },
  { id: "throughput", name: "iperf3 限速上传", tool: "iperf3", intervals: [1440] },
  { id: "tcpquality-route", name: "三网回程", tool: "tcpquality", intervals: [1440] },
  { id: "tcpquality-intl", name: "国际互联", tool: "tcpquality", intervals: [1440] },
  { id: "tcpquality-all", name: "TcpQuality 综合巡检", tool: "tcpquality", intervals: [1440] },
  { id: "tcpquality-report", name: "三网质量图片报告", tool: "tcpquality", intervals: [1440] },
  { id: "tcpquality-intl-report", name: "国际互联图片报告", tool: "tcpquality", intervals: [1440] },
];
export const modeName = (mode: string) => MODES.find((item) => item.id === mode)?.name || mode;
export const intervalName = (minutes: number) => minutes >= 1440 ? "每天" : minutes >= 60 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
export const timingName = (timing: Partial<NetworkTiming>) => timing.scheduleType === "daily"
  ? `每天 ${(timing.dailyTimes || []).join("、")} · UTC${(timing.utcOffsetMinutes || 0) >= 0 ? "+" : ""}${((timing.utcOffsetMinutes || 0) / 60).toString()}`
  : intervalName(timing.intervalMinutes || 1440);
export const agentState = (node?: NetworkAgent | null) => !node ? "未接入" : !node.lastSeenAt ? "等待首次连接" : Date.now() - Date.parse(node.lastSeenAt) < 90_000 ? "探测器在线" : "探测器离线";
export const formatNetworkTime = (value: string | number) => value ? new Date(value).toLocaleString() : "尚无记录";
export const networkGuide = "https://github.com/shaolonger/Komari-Theme-Aster/blob/main/network-observatory/README.md";
export const quoteShell = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export const installCommand = (uuid: string, base: string) => `curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --server-url ${quoteShell(base)} --node-uuid ${quoteShell(uuid)}`;
