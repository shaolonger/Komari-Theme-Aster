/** Match whitespace-separated terms in any order across node fields. */
export function matchesNodeSearch(query: string, ...fields: unknown[]): boolean {
  const words = query.normalize("NFKC").toLowerCase().trim().split(/\s+/u);
  if (!words[0]) return true;
  const text = fields.flat().join(" ").normalize("NFKC").toLowerCase();
  return words.every(word => text.includes(word));
}
