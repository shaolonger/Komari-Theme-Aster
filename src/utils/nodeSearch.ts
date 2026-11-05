/** Match whitespace-separated terms in any order across node fields. */
export function matchesNodeSearch(query: string, ...fields: unknown[]): boolean {
  const words = query.normalize("NFKC").toLowerCase().trim().split(/\s+/u);
  if (!words[0]) return true;
  const text = fields.flat().join(" ").normalize("NFKC").toLowerCase();
  return words.every(word => text.includes(word));
}

/** Commas/newlines join alternatives; spaces inside an alternative remain AND. */
export function splitNodeSearchGroups(query: string): string[] {
  const seen = new Set<string>();
  return query.normalize("NFKC").split(/[,\r\n]+/u).map(group => group.trim().replace(/\s+/gu, " ")).filter(group => {
    const key = group.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readNodeSearchInput(value: string) {
  const parts = value.normalize("NFKC").split(/[,\r\n]+/u);
  const draft = parts.pop() ?? "";
  return { tokens: splitNodeSearchGroups(parts.join(",")), draft: draft.trimStart() };
}

export function writeNodeSearchInput(tokens: string[], draft = "") {
  const unique = splitNodeSearchGroups(tokens.join(","));
  return unique.length ? `${unique.join(", ")}, ${draft}` : draft;
}
