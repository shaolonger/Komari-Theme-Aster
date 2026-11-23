import { z } from "zod";

export const diagnosticModules = ["ip-quality", "media-unlock"] as const;
export const diagnosticSections = ["traffic-reset", ...diagnosticModules] as const;
export type DiagnosticSection = typeof diagnosticSections[number];
export const IP_PROVIDERS = ["IPinfo", "ipregistry", "ipapi", "IP2Location", "AbuseIPDB"] as const;
export const RISK_PROVIDERS = ["IP2Location", "Scamalytics", "ipapi", "AbuseIPDB"] as const;
export const MEDIA_SERVICES = {
  TikTok: "TikTok",
  DisneyPlus: "Disney+",
  Netflix: "Netflix",
  Youtube: "YouTube",
  AmazonPrimeVideo: "Prime Video",
  Reddit: "Reddit",
  ChatGPT: "ChatGPT",
} as const;

const ipType = z.enum(["isp", "line-isp", "hosting", "business", "education", "government", "banking",
  "organization", "military", "library", "cdn", "mobile-isp", "web-spider", "reserved", "other"]);
const score = z.string().regex(/^\d{1,3}(?:\.\d{1,4})?%?$/);
const ipRow = z.object({
  usage: ipType.optional(),
  company: ipType.optional(),
  score: score.optional(),
});
const mediaRow = z.object({
  status: z.enum(["unlocked", "blocked", "partial", "unsupported"]),
  region: z.string().regex(/^[A-Z]{2}$/).optional(),
  mode: z.enum(["native", "dns"]).optional(),
});
const snapshot = {
  at: z.string().datetime(),
  state: z.enum(["ok", "partial", "failed"]),
};
export const ipProvidersSchema = z.record(z.enum(IP_PROVIDERS), ipRow);
export const riskScoresSchema = z.record(z.enum(RISK_PROVIDERS), score);
export const mediaServicesSchema = z.record(z.enum(["TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Reddit", "ChatGPT"]), mediaRow);
const ipSnapshot = z.object({ ...snapshot, providers: ipProvidersSchema, riskScores: riskScoresSchema.optional() });
const mediaSnapshot = z.object({ ...snapshot, services: mediaServicesSchema });

export const diagnosticNodesSchema = z.record(z.object({
  "traffic-reset": z.object({
    day: z.number().int().min(1).max(31),
    elapsed: z.number().int().nonnegative(),
    total: z.number().int().min(28).max(31),
    nextAt: z.number().int().positive(),
  }).nullable().optional(),
  "ip-quality": z.object({ "4": ipSnapshot.optional(), "6": ipSnapshot.optional() }).optional(),
  "media-unlock": z.object({ "4": mediaSnapshot.optional(), "6": mediaSnapshot.optional() }).optional(),
}));

export type HomeDiagnosticNode = z.infer<typeof diagnosticNodesSchema>[string];
export type IpKind = z.infer<typeof ipType>;
export type IpProviders = z.infer<typeof ipProvidersSchema>;
export type RiskScores = z.infer<typeof riskScoresSchema>;
type RiskProvider = typeof RISK_PROVIDERS[number];

export const ipKinds: Record<IpKind, string> = {
  isp: "家宽", "line-isp": "原宽", hosting: "机房", business: "企业", education: "教育", government: "政府",
  banking: "银行", organization: "机构", military: "军事", library: "图书馆", cdn: "CDN",
  "mobile-isp": "移动网络", "web-spider": "网络爬虫", reserved: "保留", other: "其他",
};
export const mediaStatuses = { unlocked: "解锁", blocked: "屏蔽", partial: "部分解锁", unsupported: "不支持" } as const;

export function riskValue(provider: RiskProvider, scores?: RiskScores, providers?: IpProviders) {
  return scores?.[provider] ?? (provider === "Scamalytics" ? undefined : providers?.[provider]?.score);
}

export function riskPresentation(provider: RiskProvider, value?: string) {
  if (value === undefined) return { label: "暂无评分", tone: "neutral" };
  const number = Number.parseFloat(value);
  // The sources use different scales. These thresholds follow the script's
  // score bands, including ipapi's percentage display.
  const level = provider === "Scamalytics" ? number < 20 ? "low" : number < 60 ? "medium" : number < 90 ? "high" : "very-high"
    : provider === "IP2Location" ? number < 33 ? "low" : number < 66 ? "medium" : "high"
      : provider === "AbuseIPDB" ? number < 25 ? "low" : number < 75 ? "high" : "very-high"
        : number < .85 ? "very-low" : number < 3 ? "low" : "elevated";
  const labels = { "very-low": "极低风险", low: "低风险", medium: "中风险", elevated: "风险升高", high: "高风险", "very-high": "极高风险" };
  return { label: labels[level], tone: level === "high" || level === "very-high" ? "bad" : level === "medium" || level === "elevated" ? "warn" : "good" };
}
