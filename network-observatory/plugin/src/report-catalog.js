const { WEBSITE_CATALOG } = require("./website-catalog.js");
const { CATALOG } = require("./catalog.js");
const VERSION = "2026-09-30.1";
const CHECKED_AT = "2026-09-30";
const AWS_SOURCE = "https://docs.aws.amazon.com/general/latest/gr/sts.html";
const TELEGRAM_SOURCE =
  "https://github.com/telegramdesktop/tdesktop/blob/8c0d1e5691a28637ee99084662f49c4ca0254e24/Telegram/SourceFiles/mtproto/mtproto_dc_options.cpp";
const common = {
  catalogVersion: VERSION,
  checkedAt: CHECKED_AT,
  health: "not-checked",
  uses: ["latency"],
  restrictions: "轻量 TCP 建连；不用于吞吐测速",
  port: 443,
  method: "tcp-connect",
  family: "auto",
};
const regions = [
  ["ap-east-1", "香港", "HK"],
  ["ap-east-2", "台北", "TW"],
  ["ap-northeast-1", "东京", "JP"],
  ["ap-northeast-3", "大阪", "JP"],
  ["ap-northeast-2", "首尔", "KR"],
  ["ap-southeast-1", "新加坡", "SG"],
  ["ap-southeast-2", "悉尼", "AU"],
  ["ap-southeast-4", "墨尔本", "AU"],
  ["ap-southeast-3", "雅加达", "ID"],
  ["ap-southeast-5", "马来西亚", "MY"],
  ["ap-southeast-6", "新西兰", "NZ"],
  ["ap-southeast-7", "泰国", "TH"],
  ["ap-south-1", "孟买", "IN"],
  ["ap-south-2", "海得拉巴", "IN"],
  ["us-west-1", "旧金山", "US"],
  ["us-west-2", "俄勒冈", "US"],
  ["us-east-1", "弗吉尼亚", "US"],
  ["us-east-2", "俄亥俄", "US"],
  ["ca-central-1", "加拿大中部", "CA"],
  ["ca-west-1", "卡尔加里", "CA"],
  ["eu-west-1", "都柏林", "IE"],
  ["eu-west-2", "伦敦", "GB"],
  ["eu-west-3", "巴黎", "FR"],
  ["eu-central-1", "法兰克福", "DE"],
  ["eu-central-2", "苏黎世", "CH"],
  ["eu-north-1", "斯德哥尔摩", "SE"],
  ["eu-south-1", "米兰", "IT"],
  ["eu-south-2", "西班牙", "ES"],
  ["il-central-1", "特拉维夫", "IL"],
  ["me-south-1", "巴林", "BH"],
  ["me-central-1", "阿联酋", "AE"],
  ["af-south-1", "开普敦", "ZA"],
  ["sa-east-1", "圣保罗", "BR"],
  ["mx-central-1", "墨西哥中部", "MX"],
];
const aws = regions.map(([regionCode, city, country]) => ({
  ...common,
  id: "aws:" + regionCode,
  category: "aws",
  name: city,
  city,
  country,
  regionCode,
  provider: "AWS",
  address: "sts." + regionCode + ".amazonaws.com",
  sourceUrl: AWS_SOURCE,
  https: true,
  path: "/",
  conditions: "AWS 区域 STS 接入延迟；不是 EC2 带宽或整个城市的延迟",
}));
const sites = WEBSITE_CATALOG.map((row) => ({
  ...common,
  id: "site:" + row.host,
  category: row.group.includes("CDN") ? "cdn" : "websites",
  name: row.name,
  provider: row.provider,
  address: row.host,
  sourceUrl: "https://" + row.host + row.path,
  path: row.path,
  https: true,
  conditions: "本轮实际解析的服务/CDN 接入点；不判断业务解锁",
}));
const dcs = [
  [1, "149.154.175.50", "2001:b28:f23d:f001::a"],
  [2, "149.154.167.51", "2001:67c:4e8:f002::a"],
  [3, "149.154.175.100", "2001:b28:f23d:f003::a"],
  [4, "149.154.167.91", "2001:67c:4e8:f004::a"],
  [5, "149.154.171.5", "2001:b28:f23f:f005::a"],
].flatMap(([dc, ipv4, ipv6]) =>
  [ipv4, ipv6].map((address, i) => ({
    ...common,
    id: `telegram:dc${dc}:ipv${i ? 6 : 4}`,
    name: `DC${dc}`,
    category: "telegram",
    provider: "Telegram",
    address,
    family: i ? "6" : "4",
    dc,
    sourceUrl: TELEGRAM_SOURCE,
    conditions:
      "官方桌面客户端启动地址快照；TCP 可达不代表 MTProto 登录或地区解锁",
    configType: "bootstrap-snapshot",
  })),
);
const routes = CATALOG.find((c) => c.id === "china-route").items.map((row) => ({
  ...common,
  id: "route:" + row.id,
  category: "china-route",
  name: row.name,
  city: row.region,
  carrier: row.carrier,
  address: row.target,
  family: row.id.includes("ipv6") ? "6" : "4",
  uses: ["route"],
  sourceUrl: CATALOG.find((c) => c.id === "china-route").source,
  restrictions: "公开路由目标；不作为吞吐端点",
  provider: "NextTrace",
}));
const leasewebLocations = [
  ["ams1.nl", "阿姆斯特丹", "NL"],
  ["ams2.nl", "阿姆斯特丹", "NL"],
  ["fra1.de", "法兰克福", "DE"],
  ["lon1.uk", "伦敦", "GB"],
  ["lon12.uk", "伦敦", "GB"],
  ["lax11.us", "洛杉矶", "US"],
  ["wdc2.us", "华盛顿", "US"],
  ["sfo12.us", "旧金山", "US"],
  ["sea11.us", "西雅图", "US"],
  ["mia11.us", "迈阿密", "US"],
  ["phx1.us", "凤凰城", "US"],
  ["dal13.us", "达拉斯", "US"],
  ["nyc1.us", "纽约", "US"],
  ["chi11.us", "芝加哥", "US"],
  ["sin1.sg", "新加坡", "SG"],
  ["syd12.au", "悉尼", "AU"],
  ["hkg12.hk", "香港", "HK"],
  ["tyo11.jp", "东京", "JP"],
  ["mtl2.ca", "蒙特利尔", "CA"],
];
const leaseweb = leasewebLocations.flatMap(([location, city, country]) => {
  const address = "speedtest." + location + ".leaseweb.net",
    sourceUrl = "https://kb.leaseweb.com/kb/network/network-link-speeds/";
  return [
    {
      ...common,
      id: "idc:leaseweb:" + location,
      category: "idc",
      name: city + " · " + location.toUpperCase(),
      city,
      country,
      provider: "Leaseweb",
      address,
      port: 80,
      sourceUrl,
      https: false,
      conditions:
        "官方测试服务器的 HTTP 端口接入延迟；共享节点负载可能影响结果",
    },
    {
      ...common,
      id: "speed:leaseweb:" + location,
      category: "speed",
      name: city + " · Leaseweb",
      city,
      country,
      provider: "Leaseweb",
      address,
      port: 5201,
      method: "iperf3",
      uses: ["speed"],
      authorized: true,
      sourceUrl,
      restrictions:
        "官方公开测速端口 5201–5210；每端口单会话，繁忙时等待。默认仅选一个地区并低频运行",
      conditions: "VPS 单连接双向，不设置带宽上限；共享公共端点不保证独享容量",
    },
  ];
});
const xtomLocations = [
  ["tok", "东京", "JP"],
  ["tok-sb", "东京", "JP"],
  ["tok-iij", "东京", "JP"],
  ["tok-premium", "东京", "JP"],
  ["kix", "大阪", "JP"],
  ["kix-sb", "大阪", "JP"],
  ["kix-iij", "大阪", "JP"],
  ["sin", "新加坡", "SG"],
  ["sin-edge", "新加坡", "SG"],
  ["sin-premium", "新加坡", "SG"],
  ["hkg", "香港", "HK"],
  ["syd", "悉尼", "AU"],
  ["ams", "阿姆斯特丹", "NL"],
  ["ams-premium", "阿姆斯特丹", "NL"],
  ["fra", "法兰克福", "DE"],
  ["fra-premium", "法兰克福", "DE"],
  ["lon", "伦敦", "GB"],
  ["lon-premium", "伦敦", "GB"],
  ["dus", "杜塞尔多夫", "DE"],
  ["tll", "塔林", "EE"],
  ["sjc", "圣何塞", "US"],
  ["sjc-premium", "圣何塞", "US"],
  ["nyc", "纽约", "US"],
];
const xtom = xtomLocations.map(([location, city, country]) => ({
  ...common,
  id: "idc:xtom:" + location,
  category: "idc",
  name: city + " · " + location.toUpperCase(),
  city,
  country,
  provider: "xTom",
  address: location + ".lg.xtom.com",
  sourceUrl: "https://xtom.com/looking-glass/",
  conditions:
    "官方地区 Looking Glass 的接入延迟；保存实际解析 IP，网站可能由代理/CDN 接入，不能据此证明机房内部延迟",
}));
const ENDPOINTS = [...aws, ...sites, ...dcs, ...routes, ...leaseweb, ...xtom];
const PRESETS = [
  {
    id: "international-basic",
    name: "国际基础",
    module: "international",
    endpoints: [
      "aws:ap-east-1",
      "aws:ap-northeast-1",
      "aws:ap-southeast-1",
      "aws:us-west-1",
      "aws:eu-central-1",
      "site:www.google.com",
      "site:api.github.com",
      "site:www.wikipedia.org",
      "site:api.openai.com",
      "site:cdnjs.cloudflare.com",
      "telegram:dc2:ipv4",
      "telegram:dc5:ipv4",
    ].filter((id) => ENDPOINTS.some((e) => e.id === id)),
    timing: { type: "interval", minutes: 30 },
  },
  {
    id: "international-complete",
    name: "国际完整",
    module: "international",
    endpoints: [...aws, ...sites, ...dcs.filter((e) => e.family === "4")].map(
      (e) => e.id,
    ),
    timing: { type: "interval", minutes: 30 },
  },
  {
    id: "china-routes",
    name: "大陆线路",
    module: "routes",
    endpoints: routes
      .filter(
        (e) =>
          e.family === "4" &&
          /(?:pek|sha|can)_ipv4_(?:4134|4837|9808)$/.test(e.id),
      )
      .map((e) => e.id),
    publicSources: true,
    timing: { type: "interval", minutes: 360 },
  },
  {
    id: "china-single",
    name: "大陆单连接测速",
    module: "china-speed",
    endpoints: [],
    timing: { type: "daily", times: ["21:00"], timezone: "Asia/Shanghai" },
    traffic: true,
  },
  {
    id: "idc-latency",
    name: "IDC 接入延迟",
    module: "idc",
    endpoints: [
      ...xtom.filter((e) =>
        ["tok", "sin", "hkg", "syd", "ams", "fra", "nyc"].includes(
          e.id.split(":").at(-1),
        ),
      ),
      ...leaseweb.filter(
        (e) =>
          e.category === "idc" &&
          [
            "hkg12.hk",
            "tyo11.jp",
            "sin1.sg",
            "syd12.au",
            "lax11.us",
            "fra1.de",
            "ams1.nl",
          ].includes(e.id.split(":").at(-1)),
      ),
    ].map((e) => e.id),
    timing: { type: "interval", minutes: 30 },
  },
  {
    id: "idc-complete",
    name: "IDC 全目录",
    module: "idc",
    endpoints: [...xtom, ...leaseweb.filter((e) => e.category === "idc")].map(
      (e) => e.id,
    ),
    timing: { type: "interval", minutes: 60 },
  },
  {
    id: "international-speed",
    name: "国际单连接测速",
    module: "international-speed",
    endpoints: ["speed:leaseweb:hkg12.hk"],
    timing: { type: "daily", times: ["04:00"], timezone: "Asia/Shanghai" },
    traffic: true,
  },
  {
    id: "bgp-snapshot",
    name: "BGP 与 RPKI",
    module: "bgp",
    endpoints: [],
    timing: { type: "interval", minutes: 360 },
  },
];
module.exports = { VERSION, CHECKED_AT, ENDPOINTS, PRESETS };
