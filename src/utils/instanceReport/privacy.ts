import type { EvidenceValue, ReportInput, ReportModel } from "./model";

// Deliberate allowlist: API passthrough fields, diagnostics, raw command output,
// endpoint credentials and arbitrary options must never enter the archive.
const evidenceKeys = new Set(
  "kind state https asnSource asnQueriedAt intervalSource trafficBytesObserved warmupBytesObserved sources collectors peers retainedPaths returnedPaths truncated coverageChanged changes baseline comparableSources addedPaths removedPaths addedAdjacentAsns removedAdjacentAsns coveringPrefixes graph nodes edges from to pathIds origin method protocol family streams vpsDirection direction complete httpStatus tlsVerified timingsMs dns connect tls ttfb total tcpQuality sent received failurePercent avgMs medianMs minMs maxMs stdevMs samples index rttMs hops ttl address asn network location prefix sent received lossPercent lastMs bestMs worstMs avgMs stdevMs quality jitterMs terminalConfirmed runs bitsPerSecond bytes seconds retransmits tcpRttMs maxBitsPerSecond intervals start end bitsPerSecond bytes congestionControl tcpRttMethod tcpSampleSide prefix originAsns paths path collector peer peerAsn observedAt routeUpdatedAt rpki validator queriedAt source dataTime communities name provider city carrier country counts expected completed ok partial failed missing cancelled detailAvailable module id day fingerprint samples ok application missing failed ttfbTotal ttfbSamples speed count sum".split(
    " ",
  ),
);
for (const key of ["whois", "domain", "hostname", "geoSource", "geoQueriedAt", "geoStatus", "asnStatus", "registryCountry"])
  evidenceKeys.add(key);
export function projectEvidence(value: unknown, depth = 0): EvidenceValue {
  if (depth > 12) return "明细嵌套过深，未纳入";
  if (value == null || typeof value === "boolean" || typeof value === "number")
    return typeof value === "number" && !Number.isFinite(value)
      ? null
      : (value as EvidenceValue);
  if (typeof value === "string") return value.slice(0, 4000);
  if (Array.isArray(value))
    return value.map((v) => projectEvidence(v, depth + 1));
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            evidenceKeys.has(k) ||
            /^(?:source-to-target|target-to-source|upload|download):[1-9]\d*$/.test(
              k,
            ),
        )
        .map(([k, v]) => [k, projectEvidence(v, depth + 1)]),
    );
  return null;
}

export function redactReport<T extends ReportInput | ReportModel>(input: T): T {
  const targets = new Set<string>(input.node.ip.filter(Boolean));
  for (const p of input.pings) if (p.target) targets.add(p.target);
  for (const p of input.previous?.pings ?? [])
    if (p.target) targets.add(p.target);
  for (const e of input.network) if (e.target) targets.add(e.target);
  const exact = [...targets].sort((a, b) => b.length - a.length);
  const scrub = (text: string) => {
    if (input.showAddresses) return text;
    let result = text;
    for (const target of exact)
      result = result.split(target).join("[地址已隐藏]");
    result = result.replace(
      /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g,
      "[IPv4 已隐藏]",
    );
    return result.replace(/[a-f\d:]{3,}(?:\/\d{1,3})?/gi, (token) =>
      token.includes("::") || token.split(":").length >= 4
        ? "[IPv6 已隐藏]"
        : token,
    );
  };
  const walk = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") {
      if (
        !input.showAddresses &&
        [
          "target",
          "address",
          "resolvedIp",
          "remoteIp",
          "peer",
          "prefix",
        ].includes(key)
      )
        return value ? "[地址已隐藏]" : "";
      return scrub(value);
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v, k)]),
      );
    return value;
  };
  // Timestamp/UUID/zone/protocol are stable identifiers, not presentation text.
  const clean = walk(input) as T;
  clean.range = { ...input.range };
  if (clean.previous && input.previous)
    clean.previous.range = { ...input.previous.range };
  clean.reportId = input.reportId;
  clean.node.uuid = input.node.uuid;
  return clean;
}
