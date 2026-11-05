import { afterEach, describe, expect, it, vi } from "vitest";
import { loadReportOriginalImages } from "../reportOriginalImages";

afterEach(() => vi.unstubAllGlobals());
const read = () => loadReportOriginalImages("node", "round", new AbortController().signal);
describe("original report image responses", () => {
  it("identifies old plugin HTML fallthrough instead of treating it as an image response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><html>Komari</html>", { headers: { "content-type": "text/html" } })));
    await expect(read()).rejects.toThrow("更新插件至 1.22.0");
  });
  it("preserves upstream and permission errors", async () => {
    for (const status of [401, 403, 502]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "真实接口错误" }, { status })));
      await expect(read()).rejects.toThrow("真实接口错误");
    }
  });
  it("accepts real SVG sections and requests JSON from the node's stored round", async () => {
    const pages = [{ title: "IPv4", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"></svg>' }];
    const fetcher = vi.fn().mockResolvedValue(Response.json({ pages })); vi.stubGlobal("fetch", fetcher);
    await expect(read()).resolves.toEqual({ pages });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/aster-network-observatory/v3/nodes/node/rounds/round/original-images");
    expect(fetcher.mock.calls[0]?.[1].headers).toEqual({ Accept: "application/json" });
  });
  it("rejects empty sections and non-SVG payloads", async () => {
    for (const pages of [[], [{ svg: "<html>not an image</html>" }], [null]]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ pages })));
      await expect(read()).rejects.toThrow();
    }
  });
});
