const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { jsonState } = require("../src/json-state.js");
test("cached credentials revoke immediately, external changes reload, and corruption never authenticates stale state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-state-"));
  const file = path.join(root, "credentials.json");
  const store = jsonState(file, e => e.code === "ENOENT", () => ({ nodes: {} }), value => {
    if (!value.nodes) throw new Error("Invalid credentials");
    return value;
  });
  try {
    assert.deepEqual(store.read(), { nodes: {} });
    store.write({ nodes: { a: { tokenHash: "old" } } });
    assert.equal(store.read().nodes.a.tokenHash, "old");
    const identities = store.read();
    delete identities.nodes.a;
    store.write(identities);
    assert.equal(store.read().nodes.a, undefined);
    const restarted = jsonState(file, e => e.code === "ENOENT", () => ({}));
    assert.deepEqual(restarted.read(), { nodes: {} });
    fs.writeFileSync(file, JSON.stringify({ nodes: { b: { tokenHash: "external" } } }));
    assert.equal(store.read().nodes.b.tokenHash, "external");
    fs.writeFileSync(file, "broken");
    assert.throws(() => store.read(), SyntaxError);
    assert.throws(() => store.read(), SyntaxError);
    fs.unlinkSync(file);
    assert.deepEqual(store.read(), { nodes: {} });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("a failed commit invalidates uncommitted in-memory mutations", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-failed-state-"));
  const file = path.join(root, "state.json");
  const store = jsonState(file, e => e.code === "ENOENT", () => ({}));
  try {
    store.write({ jobs: ["durable"] });
    const value = store.read(); value.jobs.push("uncommitted");
    fs.mkdirSync(file + ".tmp");
    assert.throws(() => store.write(value));
    assert.deepEqual(store.read().jobs, ["durable"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
