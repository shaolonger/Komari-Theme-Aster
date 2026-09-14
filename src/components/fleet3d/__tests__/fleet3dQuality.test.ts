import { describe, expect, it } from "vitest";
import { resolveFleet3DEffectiveQuality } from "@/components/fleet3d/Fleet3DScene";

describe("Fleet 3D adaptive quality", () => {
  it("preserves the requested quality for a small capable fleet", () => {
    expect(resolveFleet3DEffectiveQuality({
      requested: "high", nodeCount: 30, reducedMotion: false, deviceMemory: 8,
    })).toBe("high");
  });

  it("scales large or constrained fleets without overriding eco mode", () => {
    expect(resolveFleet3DEffectiveQuality({
      requested: "high", nodeCount: 100, reducedMotion: false, deviceMemory: 8,
    })).toBe("balanced");
    expect(resolveFleet3DEffectiveQuality({
      requested: "high", nodeCount: 300, reducedMotion: false, deviceMemory: 8,
    })).toBe("eco");
    expect(resolveFleet3DEffectiveQuality({
      requested: "balanced", nodeCount: 30, reducedMotion: true, deviceMemory: 8,
    })).toBe("eco");
  });
});
