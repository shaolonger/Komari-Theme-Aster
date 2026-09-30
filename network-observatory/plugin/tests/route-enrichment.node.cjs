const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  createEnricher,
  originQuery,
  txt,
} = require("../src/route-enrichment.js");
const data = (hops) => ({
  kind: "route",
  state: "ok",
  hops: hops.map((address) => ({ ttl: 1, address, asn: "", rttMs: 1 })),
});
function answer(name, text) {
  return {
    ok: true,
    text: async () =>
      JSON.stringify({
        Status: 0,
        Answer: [
          { type: 16, name: name + ".", TTL: 60, data: JSON.stringify(text) },
        ],
      }),
  };
}
test("IPv4/IPv6 origin queries exclude private, CGNAT, link local, documentation and invalid addresses", () => {
  assert.equal(originQuery("8.8.8.8"), "8.8.8.8.origin.asn.cymru.com");
  const name = originQuery("2001:4860:4860::8888");
  assert.ok(name.endsWith(".origin6.asn.cymru.com"));
  assert.equal(
    name.split(".").slice(0, 32).reverse().join(""),
    "20014860486000000000000000008888",
  );
  for (const ip of [
    "10.0.0.1",
    "100.64.1.1",
    "127.0.0.1",
    "172.31.1.1",
    "192.168.1.1",
    "169.254.1.1",
    "192.0.2.1",
    "203.0.113.1",
    "198.51.100.1",
    "198.18.1.1",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "host.example",
    "999.1.1.1",
    "1:2:3:4:5:6:7:8:9",
  ])
    assert.equal(originQuery(ip), "", ip);
  assert.equal(txt('"a""b"'), "ab");
});
test("lookup preserves observed hops, maps BGP origin/name, caches duplicates, preserves NextTrace evidence and separates registry country", async () => {
  const calls = [];
  const e = createEnricher({
    fetcher: async (url) => {
      const name = new URL(url).searchParams.get("name");
      calls.push(name);
      return answer(
        name,
        name.startsWith("AS")
          ? "15169 | US | arin | 2000-03-30 | GOOGLE - Google LLC, US"
          : "15169 | 8.8.8.0/24 | US | arin | 1992-12-01",
      );
    },
  });
  const raw = data(["8.8.8.8", "8.8.8.8", "", "10.0.0.1", "1.1.1.1"]);
  raw.hops[4].asn = "13335";
  raw.hops[4].asnSource = "NextTrace / test";
  const r = await e.enrich(raw);
  assert.equal(r.hops[0].asn, "15169");
  assert.equal(r.hops[0].network, "GOOGLE - Google LLC, US");
  assert.equal(r.hops[0].registryCountry, "US");
  assert.equal(r.hops[0].location, undefined);
  assert.equal(r.hops[0].address, "8.8.8.8");
  assert.equal(r.hops[0].rttMs, 1);
  assert.equal(raw.hops[0].asn, "");
  assert.equal(r.hops[2].asnStatus, "no-response");
  assert.equal(r.hops[3].asnStatus, "non-public");
  assert.equal(r.hops[4].asnSource, "NextTrace / test");
  assert.equal(calls.length, 2);
  await e.enrich(data(["8.8.8.8"]));
  assert.equal(calls.length, 2);
});
test("multi-origin ASN, NXDOMAIN and network errors remain distinct and never fabricate geolocation", async () => {
  const multi = createEnricher({
    fetcher: async (url) =>
      answer(
        new URL(url).searchParams.get("name"),
        "13335 15169 | 8.8.8.0/24 | US | arin | 1992-12-01",
      ),
  });
  assert.equal(
    (await multi.enrich(data(["8.8.8.8"]))).hops[0].asn,
    "13335 / 15169",
  );
  const empty = createEnricher({
    fetcher: async () => ({ ok: true, text: async () => '{"Status":3}' }),
  });
  assert.equal(
    (await empty.enrich(data(["8.8.8.8"]))).hops[0].asnStatus,
    "not-found",
  );
  const fail = createEnricher({
    fetcher: async () => {
      throw Error("offline");
    },
  });
  assert.equal(
    (await fail.enrich(data(["8.8.8.8"]))).hops[0].asnStatus,
    "lookup-failed",
  );
});
test("one bounded deadline aborts unavailable DNS and returns the successful route without throwing", async () => {
  const e = createEnricher({
    budgetMs: 20,
    fetcher: async (_, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        );
      }),
  });
  const started = Date.now(),
    r = await e.enrich(data(["8.8.8.8", "1.1.1.1"]));
  assert.ok(Date.now() - started < 500);
  assert.equal(r.state, "ok");
  assert.ok(r.hops.every((h) => h.asnStatus === "lookup-failed"));
});
