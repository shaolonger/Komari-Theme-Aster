import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TrafficQuotaDetailsContent from "../TrafficQuotaDetailsContent";
import type { TrafficDisplay } from "@/utils/traffic";

const traffic: TrafficDisplay = { fraction: .25, usagePercent: 25, color: "green", remainingLabel: "750 GB", detail: "250 GB / 1000 GB", compactDetail: "250/1000 GB", typeLabel: "上行+下行" };

describe("Clear Sky quota semantics", () => {
  it("shows the billed total, remaining allowance and percentage", () => {
    const html = renderToStaticMarkup(<TrafficQuotaDetailsContent traffic={traffic} uuid="test" />);
    expect(html).toContain("250 GB / 1000 GB");
    expect(html).toContain("剩余 750 GB");
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain("流量计费口径：上行+下行");
  });
  it("preserves over-quota percentages while keeping the progress track bounded", () => {
    const html = renderToStaticMarkup(<TrafficQuotaDetailsContent traffic={{ ...traffic, fraction: 1, usagePercent: 125, remainingLabel: "0 B" }} uuid="test" />);
    expect(html).toContain("已用 125%");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("--sky-quota-fill:100%");
  });
  it("does not represent unlimited plans as zero percent used", () => {
    const html = renderToStaticMarkup(<TrafficQuotaDetailsContent traffic={{ ...traffic, fraction: 0, usagePercent: null, remainingLabel: "∞", detail: "250 GB / ∞" }} uuid="test" />);
    expect(html).toContain("流量未设限");
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("已用 0%");
  });
});
