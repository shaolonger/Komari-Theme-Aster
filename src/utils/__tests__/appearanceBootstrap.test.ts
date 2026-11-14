import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
const bootstrap = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
const removed = ["diagnostic", "clearsky", "slate", "slate-light", "glacier", "orbital"];

function firstPaint(appearance: string | null, fallback: string | null, dark = false) {
  const values = new Map<string, string>();
  if (appearance !== null) values.set("appearance", appearance);
  if (fallback !== null) values.set("appearance_default", fallback);
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
  const meta = { content: "" };
  runInNewContext(bootstrap, {
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) },
    window: { matchMedia: () => ({ matches: dark }) },
    document: { documentElement: root, querySelector: () => meta },
  });
  return { root, meta };
}

describe("appearance before first paint", () => {
  for (const encode of [(value: string) => value, JSON.stringify]) {
    it.each(removed)("ignores removed %s preferences and uses a valid cached default", (appearance) => {
      const { root, meta } = firstPaint(encode(appearance), JSON.stringify("cupertino-dark"));
      expect(root.dataset).toEqual({ appearance: "dark", themeStyle: "cupertino" });
      expect(root.style.colorScheme).toBe("dark");
      expect(meta.content).toBe("#141416");
    });
    it.each(removed)("resolves the system appearance when cached %s defaults were removed", (appearance) => {
      expect(firstPaint(encode(appearance), encode(appearance), true).root.dataset).toEqual({ appearance: "dark", themeStyle: "default" });
    });
  }
  it.each(["light", "dark", "system", "luminous", "cupertino", "cupertino-dark"])("accepts the retained %s appearance", (appearance) => {
    const { root } = firstPaint(JSON.stringify(appearance), null);
    expect(root.dataset.themeStyle).toBe(appearance.startsWith("cupertino") ? "cupertino" : appearance === "luminous" ? "luminous" : "default");
  });
});
