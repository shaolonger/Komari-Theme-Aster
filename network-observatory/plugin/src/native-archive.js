const fs = require("fs"),
  path = require("path");
const { UUID } = require("./model.js");
function archive(root, missing) {
  function read(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      if (missing(e, file)) return fallback;
      throw e;
    }
  }
  function write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  }
  function directory(uuid) {
    if (!UUID.test(uuid)) throw new Error("节点标识无效");
    return path.join(root, "native-reports", uuid);
  }
  function append(record) {
    const dir = directory(record.nodeUuid),
      day = record.completedAt.slice(0, 10),
      file = path.join(dir, day + ".json");
    // Komari 1.4.3 resolves symlinks before reading. With a missing parent it
    // reports that ancestor's PathError, not the requested file's ENOENT.
    // Create the report directory before the first read so the existing
    // missing-file check handles new daily files without masking other errors.
    fs.mkdirSync(dir, { recursive: true });
    const rows = read(file, []);
    const duplicate = rows.some((x) => x.id === record.id);
    if (rows.length >= 10000 && !duplicate)
      throw new Error("当日原生报告达到容量上限");
    if (!duplicate) {
      rows.push(record);
      write(file, rows);
    }
    const summaryFile = path.join(dir, day + ".summary.json"),
      summaries = {};
    // Rebuild from the durable daily log so retries repair a crash between files.
    for (const record of rows) {
      const key = record.fingerprint;
      const bucket = summaries[key] || {
        day,
        fingerprint: key,
        operation: record.operation,
        target: record.target,
        source: record.source,
        direction: record.direction,
        samples: 0,
        ok: 0,
        application: 0,
        missing: 0,
        failed: 0,
        ttfbTotal: 0,
        ttfbSamples: 0,
        speed: {},
      };
      bucket.samples++;
      bucket[record.data.state === "partial" ? "failed" : record.data.state] =
        (bucket[
          record.data.state === "partial" ? "failed" : record.data.state
        ] || 0) + 1;
      if (record.data.kind === "website" && record.data.timingsMs?.ttfb > 0) {
        bucket.ttfbTotal += record.data.timingsMs.ttfb;
        bucket.ttfbSamples++;
      }
      for (const run of record.data.runs || [])
        if (run.state === "ok") {
          const k = run.direction + ":" + run.streams;
          const v = bucket.speed[k] || { sum: 0, count: 0, bytes: 0 };
          v.sum += run.bitsPerSecond;
          v.count++;
          v.bytes += run.bytes || 0;
          bucket.speed[k] = v;
        }
      summaries[key] = bucket;
    }
    write(summaryFile, summaries);
  }
  function cleanup(uuid, now = Date.now()) {
    const dir = directory(uuid);
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir))
      if (/^\d{4}-\d{2}-\d{2}(\.summary)?\.json$/.test(name)) {
        const keep = name.includes(".summary.") ? 90 : 7;
        if (Date.parse(name.slice(0, 10)) < now - keep * 86400000)
          fs.unlinkSync(path.join(dir, name));
      }
  }
  function history(uuid) {
    const dir = directory(uuid);
    if (!fs.existsSync(dir)) return { records: [], summaries: [] };
    const files = fs
      .readdirSync(dir)
      .filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))
      .sort()
      .reverse();
    // Website catalogues can produce many more rows than daily speed/route
    // jobs. Give each category its own window so website traffic cannot evict
    // the latest route or throughput report from the response.
    const buckets = { website: [], route: [], speed: [] };
    for (const file of files) {
      for (const row of read(path.join(dir, file), []).slice().reverse()) {
        const bucket = buckets[row.data?.kind];
        if (bucket && bucket.length < 200) bucket.push(row);
      }
      if (Object.values(buckets).every((b) => b.length >= 200)) break;
    }
    const summaries = fs
      .readdirSync(dir)
      .filter((x) => /^\d{4}-\d{2}-\d{2}\.summary\.json$/.test(x))
      .sort()
      .reverse()
      .flatMap((file) => Object.values(read(path.join(dir, file), {})));
    return {
      records: Object.values(buckets)
        .flat()
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
      summaries: summaries.slice(0, 10000),
    };
  }
  return { append, cleanup, history };
}
module.exports = { archive };
