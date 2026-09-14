import { describe, expect, it } from "vitest";
import type { AdminClient, PingTask } from "@/types/komari";
import { buildPingDiagnostics, isRestrictedPingTarget } from "@/utils/pingDiagnostics";

function task(partial: Partial<PingTask> & Pick<PingTask, "id">): PingTask {
  return {
    interval: 60,
    name: "",
    loss: 0,
    clients: [],
    type: "tcp",
    target: "example.com:443",
    weight: 0,
    ...partial,
  };
}

function client(partial: Partial<AdminClient> & Pick<AdminClient, "uuid">): AdminClient {
  return {
    name: partial.uuid,
    group: "",
    region: "",
    weight: 0,
    version: "",
    ipv4: "",
    ipv6: "",
    capability_ping: null,
    capability_private_ping_targets: null,
    ...partial,
  };
}

describe("isRestrictedPingTarget", () => {
  it("detects private and local targets", () => {
    expect(isRestrictedPingTarget("127.0.0.1:80")).toBe(true);
    expect(isRestrictedPingTarget("http://192.168.1.10/status")).toBe(true);
    expect(isRestrictedPingTarget("10.0.0.1")).toBe(true);
    expect(isRestrictedPingTarget("[fd00::1]:443")).toBe(true);
    expect(isRestrictedPingTarget("localhost")).toBe(true);
  });

  it("does not flag public targets", () => {
    expect(isRestrictedPingTarget("example.com:443")).toBe(false);
    expect(isRestrictedPingTarget("https://1.1.1.1")).toBe(false);
  });
});

describe("buildPingDiagnostics", () => {
  it("flags bound nodes with explicitly disabled Ping capability", () => {
    const diagnostics = buildPingDiagnostics({
      tasks: [task({ id: 7, name: "Edge" })],
      clients: [client({ uuid: "a", capability_ping: false })],
      bindings: { 7: ["a"] },
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        kind: "capability",
        clientUuid: "a",
        taskId: 7,
      }),
    ]);
  });

  it("does not warn when Ping capability is unknown", () => {
    expect(
      buildPingDiagnostics({
        tasks: [task({ id: 7 })],
        clients: [client({ uuid: "a", capability_ping: null })],
        bindings: { 7: ["a"] },
      }),
    ).toEqual([]);
  });

  it("flags private targets only when the node explicitly restricts them", () => {
    const diagnostics = buildPingDiagnostics({
      tasks: [task({ id: 1, target: "http://192.168.1.10/health" })],
      clients: [
        client({ uuid: "restricted", capability_private_ping_targets: false }),
        client({ uuid: "unknown", capability_private_ping_targets: null }),
      ],
      bindings: { 1: ["restricted", "unknown"] },
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        kind: "private-target",
        clientUuid: "restricted",
      }),
    ]);
  });

  it("checks every bound Ping task for the same node", () => {
    const diagnostics = buildPingDiagnostics({
      tasks: [task({ id: 1, name: "Google" }), task({ id: 2, name: "Cloudflare" })],
      clients: [client({ uuid: "a", capability_ping: false })],
      bindings: { 1: ["a"], 2: ["a"] },
    });

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => diagnostic.taskId)).toEqual([1, 2]);
    expect(diagnostics.map((diagnostic) => diagnostic.taskName)).toEqual([
      "Google",
      "Cloudflare",
    ]);
  });
});
