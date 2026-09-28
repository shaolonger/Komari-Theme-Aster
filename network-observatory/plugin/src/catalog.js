// Curated, versioned metadata. Never execute commands or download target lists from these sources.
const CATALOG_VERSION = "2026-09-28.2";
const routeSource = "https://github.com/nxtrace/NTrace-core/blob/7ff73b2c51f9f37a9bc1d6139b7053948f0250db/fast_trace/basic.go";
const regions = { pek: "北京", sha: "上海", can: "广州", hgh: "杭州", hfe: "合肥" };
const carriers = { 4134: "电信 163", 4809: "电信 CN2", 4837: "联通 169", 9929: "联通 9929", 9808: "移动 CMNET", 58807: "移动 CMIN2", 4538: "教育网", 7497: "科技网" };
const routeAvailability = {
  pek: { ipv4: [4134, 4809, 4837, 9929, 9808, 58807, 4538, 7497], ipv6: [4134, 4837, 9808, 4538, 7497] },
  sha: { ipv4: [4134, 4809, 4837, 9929, 9808, 58807, 4538], ipv6: [4134, 4837, 9929, 9808, 4538] },
  can: { ipv4: [4134, 4809, 4837, 9929, 9808, 58807, 4538], ipv6: [4134, 4837, 9808, 4538] },
  hgh: { ipv4: [4134, 4837, 9808, 4538], ipv6: [4134, 4837, 9808, 4538] },
  hfe: { ipv4: [4538, 7497], ipv6: [4538] },
};
const routeItems = Object.entries(routeAvailability).flatMap(([regionCode, families]) =>
  Object.entries(families).flatMap(([family, asns]) => asns.map((asn) => ({
    id: `${regionCode}_${family}_${asn}`,
    name: `${regions[regionCode]} ${carriers[asn]} · ${family.toUpperCase()}`,
    mode: "route",
    target: `${family}.${regionCode}-${asn}.endpoint.nxtrace.org`,
    carrier: carriers[asn], region: regions[regionCode], intervalMinutes: 1440,
  }))));
const throughputTargets = [
  ["香港", "speedtest.hkg12.hk.leaseweb.net"],
  ["新加坡", "speedtest.sin1.sg.leaseweb.net"],
  ["东京", "speedtest.tyo11.jp.leaseweb.net"],
  ["悉尼", "speedtest.syd12.au.leaseweb.net"],
  ["阿姆斯特丹", "speedtest.ams1.nl.leaseweb.net"],
  ["阿姆斯特丹 2", "speedtest.ams2.nl.leaseweb.net"],
  ["法兰克福", "speedtest.fra1.de.leaseweb.net"],
  ["伦敦 1", "speedtest.lon1.uk.leaseweb.net"],
  ["伦敦 12", "speedtest.lon12.uk.leaseweb.net"],
  ["芝加哥", "speedtest.chi11.us.leaseweb.net"],
  ["达拉斯", "speedtest.dal13.us.leaseweb.net"],
  ["洛杉矶 11", "speedtest.lax11.us.leaseweb.net"],
  ["洛杉矶 12", "speedtest.lax12.us.leaseweb.net"],
  ["迈阿密", "speedtest.mia11.us.leaseweb.net"],
  ["蒙特利尔", "speedtest.mtl2.ca.leaseweb.net"],
  ["纽约", "speedtest.nyc1.us.leaseweb.net"],
  ["凤凰城", "speedtest.phx1.us.leaseweb.net"],
  ["西雅图", "speedtest.sea11.us.leaseweb.net"],
  ["旧金山", "speedtest.sfo12.us.leaseweb.net"],
  ["华盛顿", "speedtest.wdc2.us.leaseweb.net"],
].map(([region, target]) => ({ region, target, port: 5201, provider: "Leaseweb" }));
const CATALOG = [
  { id: "basic", name: "基础 HTTPS 可用性", description: "两个公共网站参考目标，每 15 分钟检查。CDN 可达性不代表固定地区线路。", source: "https://www.cloudflare.com/", requirement: "curl", items: [
    { id: "cloudflare", name: "Cloudflare 网站", mode: "https", target: "www.cloudflare.com", port: 443, intervalMinutes: 15 },
    { id: "wikipedia", name: "Wikipedia 网站", mode: "https", target: "www.wikipedia.org", port: 443, intervalMinutes: 15 },
  ] },
  { id: "china-route", name: "三网路径 · NextTrace", description: "从 NextTrace 官方目标清单选择地区、运营商和 IPv4/IPv6；默认北京三网。", source: routeSource, requirement: "nexttrace", selectableTargets: true, defaultTargetIds: ["pek_ipv4_4134", "pek_ipv4_4837", "pek_ipv4_9808"], items: routeItems },
  { id: "tcpquality-route", name: "三网回程 · TcpQuality", description: "纯路径识别；不上传报告，因此无图片。", source: "https://github.com/ibsgss/TcpQuality", requirement: "tcpquality", items: [
    { id: "route", name: "三网回程", mode: "tcpquality-route", target: "default", intervalMinutes: 1440 },
  ] },
  { id: "international", name: "国际互联 · TcpQuality", description: "本地文本诊断；不上传报告。", source: "https://github.com/ibsgss/TcpQuality", requirement: "tcpquality", items: [
    { id: "intl", name: "国际互联", mode: "tcpquality-intl", target: "default", intervalMinutes: 1440 },
  ] },
  { id: "quality-report", name: "三网质量 · 图片报告", description: "执行 TcpQuality 标准检测并上传至其报告服务；图片缓存到 Komari 插件数据目录。", source: "https://github.com/ibsgss/TcpQuality", requirement: "tcpquality", traffic: true, reportUpload: true, items: [
    { id: "quality", name: "三网质量图片报告", mode: "tcpquality-report", target: "default", intervalMinutes: 1440 },
  ] },
  { id: "intl-report", name: "国际互联 · 图片报告", description: "执行 TcpQuality 国际互联检测并上传至其报告服务；图片缓存到 Komari 插件数据目录。", source: "https://github.com/ibsgss/TcpQuality", requirement: "tcpquality", traffic: true, reportUpload: true, items: [
    { id: "intl", name: "国际互联图片报告", mode: "tcpquality-intl-report", target: "default", intervalMinutes: 1440 },
  ] },
  { id: "custom-https", name: "自有网站监控", description: "域名只填写一次，批量应用到所有选中的 VPS。", source: "", requirement: "curl", customTarget: true, items: [
    { id: "website", name: "自有网站", mode: "https", target: "", port: 443, intervalMinutes: 5 },
  ] },
  { id: "throughput", name: "授权 iperf3 吞吐测速", description: "自建端点或服务商公开端点；10 秒单连接上传，限速 100 Mbit/s。", source: "https://kb.leaseweb.com/kb/network/network-link-speeds/", requirement: "iperf3", customTarget: true, traffic: true, targets: throughputTargets, items: [
    { id: "upload", name: "iperf3 限速上传", mode: "throughput", target: "", port: 5201, intervalMinutes: 1440 },
  ] },
];
module.exports = { CATALOG, CATALOG_VERSION };
