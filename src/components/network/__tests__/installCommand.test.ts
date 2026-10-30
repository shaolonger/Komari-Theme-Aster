import { describe, expect, it } from "vitest";
import { installCommand, resetNodeCommand } from "../shared";

describe("network observatory setup commands", () => {
  it("enables the shared full-detection executor for new and upgraded VPS workers", () => {
    const fresh = installCommand("node-a", "https://example.com", { profile: "lite" });
    expect(fresh).toContain("--enable-tcpquality-full");
    expect(fresh).toContain("--profile 'lite'");
    expect(fresh).not.toContain("--upgrade");
    const upgrade = installCommand("node-a", "https://example.com", { upgrade: true, profile: "preserve" });
    expect(upgrade).toContain("--upgrade --enable-tcpquality-full --profile 'preserve'");
  });
  it("keeps mainland measurement point commands unchanged", () => {
    const probe = installCommand("probe-a", "https://example.com", { role: "probe", upgrade: true, profile: "preserve" });
    expect(probe).toContain("--probe-id 'probe-a'");
    expect(probe).not.toContain("--enable-tcpquality-full");
  });
  it("updates a reset credential before the full-enabled upgrade and quotes input safely", () => {
    const command = resetNodeCommand("node'uuid", "https://example.com/'x");
    expect(command).toContain("agent.py configure");
    expect(command).toContain("--node-uuid 'node'\"'\"'uuid'");
    expect(command).toContain("--server-url 'https://example.com/'\"'\"'x'");
    expect(command).toMatch(/configure .* && curl .* --upgrade --enable-tcpquality-full/);
  });
});
