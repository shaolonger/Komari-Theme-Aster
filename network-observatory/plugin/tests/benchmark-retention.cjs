// Local full-history benchmark (no network traffic). Baseline module can point
// to a preserved 1.13.0 src/round-store.js using ASTER_BASELINE_STORE.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { roundStore } = require("../src/round-store.js");
const baselineStore = process.env.ASTER_BASELINE_STORE ? require(process.env.ASTER_BASELINE_STORE).roundStore : roundStore;
const DAY = 86400000, base = Date.parse("2026-10-24T12:00:00Z"); let now = base, serial = 1000;
const days = Number(process.env.ASTER_BENCHMARK_DAYS || 90), receipts = Number(process.env.ASTER_BENCHMARK_RECEIPTS || 100000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aster-retention-full-"));
const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const nodes = Array.from({ length: 52 }, (_, n) => uuid(n + 1));
const read = fs.readFileSync, write = fs.writeFileSync;
let reads = { indexes: 0, receipts: 0, metadata: 0 }, writes = 0, bytes = 0;
function reset() { reads = { indexes: 0, receipts: 0, metadata: 0 }; writes = 0; bytes = 0; }
function measure(fn) {
  reset(); const started = process.hrtime.bigint(), before = process.cpuUsage(); const detail = fn();
  const cpu = process.cpuUsage(before);
  return { elapsedMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6), cpuMs: Math.round((cpu.user + cpu.system) / 1000), reads, readMiB: +(bytes / 1048576).toFixed(2), writes, ...detail };
}
try {
  const setup = Date.now(); let roundRows = 0, indexFiles = 0;
  for (let n = 0; n < 52; n++) {
    const modules = [...(n < 40 ? ["international"] : []), ...(n < 30 ? ["routes"] : []), ...(n < 30 ? ["china-speed"] : [])];
    for (const module of modules) for (let day = 0; day < days; day++) {
      const at = new Date(base - day * DAY).toISOString(), date = at.slice(0, 10), count = module === "china-speed" ? (n >= 10 ? 2 : 1) : 24;
      const rows = Array.from({ length: count }, (_, hour) => ({ id: uuid(serial++), nodeUuid: nodes[n], module, plannedAt: date + "T" + String(hour).padStart(2, "0") + ":00:00.000Z", completedAt: at, state: "complete", detailAvailable: day < 7, schema: 3, counts: { expected: 12, completed: 12, ok: 12 } })).reverse();
      const dir = path.join(root, "report-v3", "nodes", nodes[n], "indexes", module);
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, date + ".json"), JSON.stringify(rows)); indexFiles++; roundRows += rows.length;
    }
  }
  const receiptRoot = path.join(root, "report-v3", "receipts"); fs.mkdirSync(receiptRoot, { recursive: true });
  for (let n = 0; n < receipts; n++) fs.writeFileSync(path.join(receiptRoot, uuid(serial++) + ".json"), JSON.stringify({ executor: "node:" + nodes[n % 52], nodeUuid: nodes[n % 52], at: base - DAY }));
  console.log(JSON.stringify({ fixture: { nodes: 52, days, roundRows, indexFiles, receipts, setupMs: Date.now() - setup } }));
  fs.readFileSync = function(file, ...args) {
    const name = String(file), value = read(file, ...args); bytes += Buffer.byteLength(value);
    if (name.includes("/indexes/")) reads.indexes++;
    if (name.includes("/receipts/")) reads.receipts++;
    if (name.endsWith("retention.json") || name.endsWith("maintenance.json")) reads.metadata++;
    return value;
  };
  fs.writeFileSync = function(...args) { writes++; return write(...args); };
  const before = baselineStore(root, error => error.code === "ENOENT", () => now);
  console.log(JSON.stringify({ baseline: measure(() => { for (const node of nodes) before.cleanup(node); }) }));
  const candidate = roundStore(root, error => error.code === "ENOENT", () => now);
  function pass() {
    let result, slices = 0, maxSliceMs = 0;
    do { result = candidate.maintenanceStep(nodes, { maxSteps: 32, maxMs: 8 }); slices++; maxSliceMs = Math.max(maxSliceMs, result.elapsedMs); if (slices > 100000) throw new Error("Maintenance did not finish"); } while (result.pending);
    return { slices, maxSliceMs, minimumSpreadWith500msPauses: (slices - 1) * 500 };
  }
  console.log(JSON.stringify({ coldMigration: measure(pass) }));
  now += 3600001;
  const steady = measure(pass); console.log(JSON.stringify({ steadyHourlyPass: steady }));
  if (steady.reads.indexes || steady.reads.receipts) throw new Error("Steady history read regression");
} finally { fs.readFileSync = read; fs.writeFileSync = write; fs.rmSync(root, { recursive: true, force: true }); }
