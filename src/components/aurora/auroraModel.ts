import type { HomepagePingSourceRow } from "@/utils/homepagePingSources";

export const CARRIERS = ["电信", "联通", "移动"] as const;
export const FAMILIES = ["4", "6"] as const;
export type Carrier = (typeof CARRIERS)[number];
export type Family = (typeof FAMILIES)[number];

// Only explicitly identifiable sources belong in the carrier matrix. Never
// infer a carrier or address family from a task's position in the response.
export function identifyPingSource(
  row: Pick<HomepagePingSourceRow, "name" | "group" | "target">,
) {
  const label = `${row.group} ${row.name}`;
  const carrier: Carrier | undefined = /电信|telecom|chinanet|ctgnet/i.test(
    label,
  )
    ? "电信"
    : /联通|unicom|cu169/i.test(label)
      ? "联通"
      : /移动|mobile|cmnet|cminet/i.test(label)
        ? "移动"
        : undefined;
  const family: Family =
    /(?:ipv?\s*6|v6|IPv6)/i.test(label) ||
    (row.target.match(/:/g)?.length || 0) >= 2
      ? "6"
      : "4";
  return carrier ? { carrier, family } : null;
}

export function selectCarrierPing(
  rows: HomepagePingSourceRow[],
  carrier: Carrier,
  family: Family,
) {
  return rows
    .filter((row) => {
      const identity = identifyPingSource(row);
      return identity?.carrier === carrier && identity.family === family;
    })
    .sort(
      (a, b) =>
        Number(a.status === "empty") - Number(b.status === "empty") ||
        b.attentionScore - a.attentionScore,
    )[0];
}

export function sampleColor(value: number, loss = 0, lossOnly = false) {
  if (value < 0 || loss >= 10) return "#f51f4d";
  if (lossOnly)
    return loss >= 3 ? "#f79c00" : loss >= 1 ? "#a4b900" : "#0baf38";
  return value >= 220 ? "#ff9c00" : value >= 150 ? "#c8ae00" : "#13ad36";
}
