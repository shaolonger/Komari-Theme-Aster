import { afterEach, expect, it, vi } from "vitest";
import { getHomeSpeeds, homeSpeedsSchema } from "../homeSpeeds";
afterEach(() => vi.unstubAllGlobals());
it("older or unavailable plugins leave the homepage usable without retrying raw report APIs", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  expect(await getHomeSpeeds({ signal: new AbortController().signal }, true)).toMatchObject({ available: false, nodes: {}, access: "admin" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/api/aster-network-observatory/v3/home-speeds");
});
it("validates speed evidence, retains zero, and rejects nonfinite values", () => {
  const value = { bitsPerSecond: 0, state: "partial", basis: "estimated" };
  const at = "2026-10-24T01:00:00.000Z";
  const data = { available: true, access: "public", published: ["vps"], display: true,
    nodes: { vps: { reportId: "round", at, plannedAt: at, family: "6", state: "partial",
      cities: [{ city: "上海", rows: [{ carrier: "电信", at, provider: "泰尔公共测速", download: value, upload: value }] }] } } };
  expect(homeSpeedsSchema.parse(data).nodes.vps.cities[0].rows[0].download.bitsPerSecond).toBe(0);
  value.bitsPerSecond = Infinity;
  expect(homeSpeedsSchema.safeParse(data).success).toBe(false);
});
it("public summaries do not fall back to privileged requests on denial or malformed payloads", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 403 }))
    .mockResolvedValueOnce(new Response("{}", { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  expect((await getHomeSpeeds({ signal: new AbortController().signal })).available).toBe(false);
  await expect(getHomeSpeeds({ signal: new AbortController().signal })).rejects.toThrow("格式不兼容");
  expect(fetch.mock.calls.every(call => call[0].endsWith("/public/speeds"))).toBe(true);
});
