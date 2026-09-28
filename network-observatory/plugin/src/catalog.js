// Data only: no remotely supplied shell commands or floating script downloads.
const CATALOG_VERSION = "2026-09-28.1";
const routeSource = "https://github.com/nxtrace/NTrace-core/blob/7ff73b2c51f9f37a9bc1d6139b7053948f0250db/fast_trace/basic.go";
const CATALOG = [
  { id: "basic", name: "基础 HTTPS 可用性", description: "两个公共网站参考目标，每 15 分钟检查。CDN 可达性不代表固定地区线路。", source: "https://www.cloudflare.com/", requirement: "curl", items: [
    { id: "cloudflare", name: "Cloudflare 网站", mode: "https", target: "www.cloudflare.com", port: 443, intervalMinutes: 15 },
    { id: "wikipedia", name: "Wikipedia 网站", mode: "https", target: "www.wikipedia.org", port: 443, intervalMinutes: 15 },
  ] },
  { id: "china-route", name: "三网路径 · NextTrace", description: "北京电信、联通、移动公开探测目标，每天一次。运营商标签来自目标清单，并非线路质量结论。", source: routeSource, requirement: "nexttrace", items: [
    { id: "telecom", name: "北京电信", mode: "route", target: "ipv4.pek-4134.endpoint.nxtrace.org", carrier: "电信", region: "北京", intervalMinutes: 1440 },
    { id: "unicom", name: "北京联通", mode: "route", target: "ipv4.pek-4837.endpoint.nxtrace.org", carrier: "联通", region: "北京", intervalMinutes: 1440 },
    { id: "mobile", name: "北京移动", mode: "route", target: "ipv4.pek-9808.endpoint.nxtrace.org", carrier: "移动", region: "北京", intervalMinutes: 1440 },
  ] },
  { id: "tcpquality-route", name: "三网回程 · TcpQuality", description: "使用节点已安装版本的默认测试集，每天一次；关闭报告上传。", source: "https://github.com/ibsgss/TcpQuality", requirement: "tcpquality", items: [
    { id: "route", name: "三网回程", mode: "tcpquality-route", target: "default", intervalMinutes: 1440 },
  ] },
  { id: "international", name: "国际互联 · TcpQuality", description: "使用节点已安装版本的国际测试集，每天一次；会产生测试流量。", source: "https://github.com/ibsgss/TcpQuality", requirement: "tcpquality", items: [
    { id: "intl", name: "国际互联", mode: "tcpquality-intl", target: "default", intervalMinutes: 1440 },
  ] },
  { id: "custom-https", name: "自有网站监控", description: "域名只填写一次，批量应用到所有选中的 VPS。", source: "", requirement: "curl", customTarget: true, items: [
    { id: "website", name: "自有网站", mode: "https", target: "", port: 443, intervalMinutes: 5 },
  ] },
  { id: "throughput", name: "授权 iperf3 吞吐测速", description: "填写自建或明确授权的端点。每天运行 10 秒单连接上传；公共清单仅作为候选参考。", source: "https://github.com/R0GGER/public-iperf3-servers", requirement: "iperf3", customTarget: true, traffic: true, items: [
    { id: "upload", name: "iperf3 上传", mode: "throughput", target: "", port: 5201, intervalMinutes: 1440 },
  ] },
];
module.exports = { CATALOG, CATALOG_VERSION };
