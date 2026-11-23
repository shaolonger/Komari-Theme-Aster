import { z } from "zod";

export const diagnosticModules = ["ip-quality", "media-unlock"] as const;
export const diagnosticSections = ["traffic-reset", ...diagnosticModules] as const;
export type DiagnosticSection = typeof diagnosticSections[number];
export const IP_PROVIDERS = ["IPinfo", "ipregistry", "ipapi", "IP2Location", "AbuseIPDB"] as const;
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
const ipRow = z.object({
  usage: ipType.optional(),
  company: ipType.optional(),
  score: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?%?$/).optional(),
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
const ipSnapshot = z.object({ ...snapshot, providers: z.record(z.enum(IP_PROVIDERS), ipRow) });
const mediaSnapshot = z.object({ ...snapshot, services: z.record(z.enum(["TikTok", "DisneyPlus", "Netflix", "Youtube", "AmazonPrimeVideo", "Reddit", "ChatGPT"]), mediaRow) });

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
