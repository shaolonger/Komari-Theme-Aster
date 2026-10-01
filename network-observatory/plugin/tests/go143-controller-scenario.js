async function runControllerScenario() {
  var A = "c388e74d-a922-4ae1-bd10-1fb30e2e53de",
    token = "a".repeat(64),
    routes = new Map();
  var ctx = {
    server: {
      route: (method, url, handler) => routes.set(method + " " + url, handler),
      call: async () => [{ uuid: A, name: "runtime test", ipv4: "8.8.8.8" }],
    },
    storageDir: __storageDir__,
    isMissingFile,
    respond: (res, status, body) => Object.assign(res, { status, body }),
    authorized: () => true,
    readBody: (req) => JSON.parse(req.body),
    readState: () => ({
      tasks: [],
      nodes: {
        [A]: {
          tokenHash: require("crypto")
            .createHash("sha256")
            .update(token)
            .digest("hex"),
        },
      },
    }),
  };
  async function invoke(method, url, body = {}) {
    var route = [...routes.keys()].find((key) => {
      var [m, p] = key.split(" ");
      return (
        m === method &&
        new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+") + "$").test(url)
      );
    });
    if (!route) throw new Error("Runtime route missing: " + url);
    var res = {};
    await routes.get(route)(
      {
        url,
        headers: { authorization: "Bearer " + token },
        body: JSON.stringify(body),
      },
      res,
    );
    if (res.status >= 400) throw new Error(JSON.stringify(res));
    return res.body;
  }
  var native = require("./src/native-controller.js").registerNativeController(
    ctx,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  var v2 = "/api/aster-network-observatory/v2",
    v3 = "/api/aster-network-observatory/v3";
  await invoke("POST", v2 + "/workers/node/" + A + "/heartbeat", {
    version: "runtime test",
    tools: ["curl"],
    features: ["report-v3", "latency-samples"],
  });
  var first = await invoke("POST", v3 + "/suites", {
    clients: [A],
    revision: 0,
    modules: [{ module: "international", endpoints: ["aws:ap-east-1"] }],
  });
  var second = await invoke("POST", v3 + "/suites", {
    clients: [A],
    revision: 1,
    modules: [{ module: "international", endpoints: ["aws:ap-east-1"] }],
  });
  await invoke("POST", v3 + "/suites/" + first.suite.id + "/run");
  await invoke("POST", v3 + "/suites/" + second.suite.id + "/run");
  if (native.read().jobs.filter((j) => j.phase === "shared").length !== 1)
    throw new Error("Runtime shared queue mismatch");
  var state = native.read();
  state.jobs = [];
  fs.writeFileSync(
    require("path").join(__storageDir__, "native-state.json"),
    JSON.stringify(state),
  );
  var restarted =
    require("./src/native-controller.js").registerNativeController(ctx);
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (
    restarted.read().jobs.length !== 2 ||
    restarted.read().jobs.filter((j) => j.phase === "shared").length !== 1
  )
    throw new Error("Runtime restart recovery mismatch");
  var bgp = await invoke("POST", v3 + "/suites", {
    clients: [A],
    revision: 2,
    modules: [{ module: "bgp" }],
  });
  await invoke("POST", v3 + "/suites/" + bgp.suite.id + "/run");
  await restarted.tick();
  var rounds = restarted.roundController.store.list(A, "bgp").rounds;
  if (rounds.length !== 1 || rounds[0].state !== "complete")
    throw new Error(
      "Runtime BGP scheduler did not complete: " + JSON.stringify(rounds),
    );
  console.log(
    "Official Komari runtime: report routes, shared recovery and async BGP scheduler passed",
  );
  return true;
}
