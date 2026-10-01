const { test } = require("node:test"),
  assert = require("node:assert/strict");
const B = require("../src/bgp.js");
const response = (data) => ({
  ok: true,
  text: async () => JSON.stringify(data),
});
test("IPv4/IPv6 longest-prefix matching excludes unrelated and mismatched families", () => {
  assert.equal(B.contains("8.8.8.8", "8.8.8.0/24"), true);
  assert.equal(B.contains("8.8.8.8", "8.8.9.0/24"), false);
  assert.equal(B.contains("2001:4860::8888", "2001:4860::/32"), true);
  assert.equal(B.contains("2001:4860::8888", "2001:4861::/32"), false);
  assert.equal(B.contains("8.8.8.8", "2001:4860::/32"), false);
  assert.equal(B.contains("8.8.8.8", "0.0.0.0/0"), true);
  assert.equal(B.contains("8.8.8.8", "8.8.8.0/33"), false);
});
test("paths preserve prepend and AS_SET and every graph edge is backed by an observed path", () => {
  assert.deepEqual(B.asPath("3356 3356 {15169,13335} 15169"), [
    "3356",
    "3356",
    "{13335,15169}",
    "15169",
  ]);
  const paths = [
    { id: "one", path: ["3356", "3356", "15169"] },
    { id: "two", path: ["1299", "13335"] },
  ];
  const graph = B.topology(paths);
  assert.deepEqual(
    graph.edges.map((e) => e.id),
    ["3356>15169", "1299>13335"],
  );
  assert.ok(!graph.edges.some((e) => e.id === "3356>13335"));
  assert.deepEqual(graph.edges[0].pathIds, ["one"]);
});
test("two sources resolve the longest announced prefix, preserve route clocks, and expose RPKI states", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes("network-info"))
      return response({
        status: "ok",
        data: { prefix: "8.8.0.0/16", asns: [15169] },
      });
    if (url.includes("api.routeviews"))
      return response([
        { prefix: "8.8.0.0/16", reporting_peers: [] },
        {
          prefix: "8.8.8.0/24",
          origin_asn: 15169,
          reporting_peers: [
            {
              peer_asn: 1299,
              peer_addr: "1.1.1.1",
              collector: "amsix.ams",
              as_path: "1299 15169",
              timestamp: "2026-09-29T12:00:00Z",
            },
          ],
        },
      ]);
    if (url.includes("bgp-state"))
      return response({
        data: {
          timestamp: "2026-09-30T08:00:00Z",
          bgp_state: [
            {
              target_prefix: "8.8.8.0/24",
              source_id: "00-9.9.9.9",
              path: [3356, 15169],
            },
            {
              target_prefix: "8.8.0.0/16",
              source_id: "00-9.9.9.9",
              path: [174, 15169],
            },
          ],
        },
      });
    return response({
      data: { status: "valid", validating_roas: [], validator: "routinator" },
    });
  };
  const collector = B.createBgpCollector({ fetcher });
  const data = await collector.collect("8.8.8.8");
  assert.equal(data.prefix, "8.8.8.0/24");
  assert.equal(data.state, "ok");
  assert.deepEqual(data.coveringPrefixes, ["8.8.0.0/16"]);
  assert.equal(data.paths.length, 2);
  assert.equal(data.sources.length, 2);
  assert.equal(data.paths[0].observedAt, "2026-09-30T08:00:00Z");
  assert.equal(data.paths[1].routeUpdatedAt, "2026-09-29T12:00:00Z");
  assert.equal(data.rpki[0].state, "valid");
  assert.ok(
    calls.find((u) => u.includes("bgp-state")).includes("8.8.8.0%2F24"),
  );
  const before = calls.length;
  assert.equal((await collector.collect("8.8.8.8")).cacheHit, true);
  assert.equal(calls.length, before);
  const privateResult = await collector.collect("192.168.1.1");
  assert.equal(privateResult.state, "missing");
  assert.equal(calls.length, before);
  for (const state of ["valid", "invalid_asn", "invalid_length"])
    assert.equal(B.rpkiStatus(state), state);
  assert.equal(B.rpkiStatus("unknown"), "not-found");
  assert.equal(B.rpkiStatus("bad"), "unavailable");
});
test("one source failure is partial coverage and API errors are never a fabricated empty topology", async () => {
  const collector = B.createBgpCollector({
    fetcher: async (url) => {
      if (url.includes("api.routeviews")) throw new Error("HTTP 429");
      if (url.includes("network-info"))
        return response({ data: { prefix: "8.8.8.0/24" } });
      if (url.includes("bgp-state"))
        return response({
          data: {
            bgp_state: [
              {
                target_prefix: "8.8.8.0/24",
                source_id: "00-9.9.9.9",
                path: [3356, 15169],
              },
            ],
          },
        });
      return response({ data: { status: "unknown" } });
    },
  });
  const data = await collector.collect("8.8.8.8");
  assert.equal(data.state, "partial");
  assert.equal(data.rpki[0].state, "not-found");
  assert.equal(data.sources[1].state, "failed");
  assert.match(data.sources[1].diagnostic, /429/);
  const failed = B.createBgpCollector({
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  assert.equal((await failed.collect("8.8.8.8")).state, "failed");
});
test("collector-balanced sampling retains source coverage and marks truncation", () => {
  const bgp_state = Array.from({ length: 1000 }, (_, i) => ({
    target_prefix: "8.8.8.0/24",
    source_id: `${i < 900 ? "00" : "01"}-1.1.1.${i % 256}`,
    path: [3356, 15169],
  }));
  const parsed = B.normalizeRis({ data: { bgp_state } }, "8.8.8.0/24");
  assert.equal(parsed.paths.length, 300);
  assert.equal(parsed.coverage.truncated, true);
  assert.equal(parsed.coverage.returnedPaths, 1000);
  assert.deepEqual(parsed.coverage.collectors.sort(), ["rrc00", "rrc01"]);
});
test("first snapshot is a baseline; later diffs retain observer identity and flag coverage change", () => {
  const old = {
    prefix: "8.8.8.0/24",
    originAsns: ["15169"],
    sources: [
      {
        source: "RIPE RIS",
        state: "ok",
        truncated: false,
        peers: ["00/1.1.1.1"],
      },
    ],
    paths: [
      {
        source: "RIPE RIS",
        collector: "rrc00",
        peer: "1.1.1.1",
        path: ["3356", "15169"],
      },
    ],
  };
  assert.equal(B.changes(null, old).baseline, true);
  const next = {
    ...old,
    paths: [{ ...old.paths[0], path: ["1299", "15169"] }],
  };
  const diff = B.changes(old, next);
  assert.equal(diff.baseline, false);
  assert.deepEqual(diff.addedAdjacentAsns, ["1299"]);
  assert.deepEqual(diff.removedAdjacentAsns, ["3356"]);
  assert.equal(diff.addedPaths.length, 1);
  assert.equal(diff.coverageChanged, false);
  assert.equal(
    B.changes(old, {
      ...next,
      sources: [{ ...old.sources[0], peers: ["00/2.2.2.2"] }],
    }).coverageChanged,
    true,
  );
});
