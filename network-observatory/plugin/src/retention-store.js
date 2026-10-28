// Incremental retention. Expiry is indexed by completedAt; neither an hourly
// sweep nor a public read parses all historical reports / receipt JSON files.
const fs = require("fs"), path = require("path");
const { UUID } = require("./model.js");
const DAY = 86400000, HOUR = 3600000;
const DATE = /^\d{4}-\d\d-\d\d$/, INDEX = /^\d{4}-\d\d-\d\d\.json$/;
function retentionStore({ base, modules, nodeDir, roundDir, read, write, missing, clock, invalidateRound, recoverOneFullDeletion }) {
  const stateFile = path.join(base, "maintenance.json"), metas = new Map();
  let saved = null, cycleCache = null, treeCache = new Map(), indexCache = null;
  const receiptDirectories = new Set();
  function state() {
    if (!saved) {
      saved = read(stateFile, { version: 1, nextAt: 0, legacyComplete: false, cycle: null });
      if (saved.version !== 1) throw new Error("保留期维护状态版本无效");
    }
    return saved;
  }
  function listing(dir) {
    try { fs.accessSync(dir); return fs.readdirSync(dir); }
    catch (error) { if (missing(error, dir)) return []; throw error; }
  }
  function remove(file) {
    try { fs.accessSync(file); fs.unlinkSync(file); }
    catch (error) { if (!missing(error, file)) throw error; }
  }
  function removeDirectory(directory) {
    try { fs.accessSync(directory); fs.rmSync(directory, { recursive: true, force: true }); }
    catch (error) { if (!missing(error, directory)) throw error; }
  }
  function fingerprint(file) {
    try { fs.accessSync(file); const stat = fs.statSync(file); return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(":"); }
    catch (error) { if (missing(error, file)) return ""; throw error; }
  }
  function meta(node) {
    if (!metas.has(node)) {
      const value = read(path.join(nodeDir(node), "retention.json"), { version: 1, indexes: {} });
      if (value.version !== 1 || !value.indexes || typeof value.indexes !== "object") throw new Error("节点保留期索引无效");
      metas.set(node, value);
    }
    return metas.get(node);
  }
  function due(rows) {
    let next = Infinity;
    for (const row of rows) {
      if (!row.completedAt || row.module === "tcpquality-full") continue;
      const at = Date.parse(row.completedAt);
      if (Number.isFinite(at)) next = Math.min(next, at + (row.detailAvailable ? 7 : 90) * DAY + 1);
    }
    return Number.isFinite(next) ? next : null;
  }
  function note(node, module, name, rows) {
    const value = meta(node), key = module + "/" + name, next = rows.length ? due(rows) : undefined;
    if (value.indexes[key] === next && Object.prototype.hasOwnProperty.call(value.indexes, key) === !!rows.length) return;
    if (rows.length) value.indexes[key] = next; else delete value.indexes[key];
    try { write(path.join(nodeDir(node), "retention.json"), value); }
    catch (error) { metas.delete(node); throw error; }
  }
  function indexParts(file) {
    const parts = path.relative(path.join(base, "nodes"), file).split(path.sep);
    if (parts.length !== 4 || !UUID.test(parts[0]) || parts[1] !== "indexes" || !modules.includes(parts[2]) || !INDEX.test(parts[3])) throw new Error("保留期日索引路径无效");
    return parts;
  }
  function beforeIndex(file, rows) {
    const parts = indexParts(file), value = meta(parts[0]), key = parts[2] + "/" + parts[3], next = due(rows);
    // Unknown days are discovered on the next incremental pass. For a known
    // day, invalidate an earlier expiry *before* writing the index so a crash
    // between two atomic files cannot leave a completed round scheduled never.
    if (next !== null && Object.prototype.hasOwnProperty.call(value.indexes, key) && (value.indexes[key] === null || next < value.indexes[key])) {
      value.indexes[key] = 0;
      try { write(path.join(nodeDir(parts[0]), "retention.json"), value); }
      catch (error) { metas.delete(parts[0]); throw error; }
    }
  }
  function noteIndex(file, rows) {
    const parts = indexParts(file);
    if (indexCache?.file === file) indexCache = null;
    note(parts[0], parts[2], parts[3], rows);
  }
  function indexFile(work) { return path.join(nodeDir(work.node), "indexes", work.module, work.name); }
  function currentRows(work) {
    const file = indexFile(work);
    if (!indexCache || indexCache.file !== file) {
      const rows = read(file, []);
      indexCache = { file, stamp: fingerprint(file), rows, minimumDue: due(rows) };
    }
    return indexCache.rows;
  }
  function commit(work) {
    if (!work.updates?.length) return;
    const changes = new Map(work.updates.map(value => [value.id, value]));
    const file = indexFile(work);
    if (indexCache?.file === file && indexCache.stamp !== fingerprint(file)) indexCache = null;
    const rows = currentRows(work).flatMap(row => {
      const change = changes.get(row.id);
      return change?.remove ? [] : [change ? { ...row, detailAvailable: false } : row];
    });
    if (rows.length) write(file, rows); else remove(file);
    indexCache = { file, stamp: fingerprint(file), rows, minimumDue: due(rows) };
    note(work.node, work.module, work.name, rows);
    work.updates = [];
  }
  function safeName(name) { return typeof name === "string" && name !== "." && name !== ".." && !/[\\/\0]/.test(name); }
  // One file or directory operation per step. Persist only lexical cursors,
  // not the potentially large directory listing, and never follow symlinks.
  function prune(job) {
    if (!UUID.test(job.node || "") || !UUID.test(job.id || "") || !["details", "round"].includes(job.mode)) throw new Error("保留期删除游标无效");
    const root = roundDir(job.node, job.id), frame = job.stack[job.stack.length - 1];
    if (!frame) return true;
    if (frame.parts.some(part => !safeName(part))) throw new Error("保留期目录游标无效");
    const directory = path.join(root, ...frame.parts);
    let names = treeCache.get(directory);
    if (!names || names.after !== frame.last) {
      names = { after: frame.last, values: listing(directory).filter(safeName).sort().filter(name => name > frame.last), position: 0 };
      treeCache.set(directory, names);
    }
    const name = names.values[names.position++];
    if (name === undefined) {
      removeDirectory(directory);
      treeCache.delete(directory); job.stack.pop();
      return !job.stack.length;
    }
    const file = path.join(directory, name);
    let stat;
    try { stat = (fs.lstatSync || fs.statSync)(file); }
    catch (error) { if (!missing(error, file)) throw error; }
    frame.last = name; names.after = name;
    if (stat?.isDirectory() && !stat.isSymbolicLink?.()) job.stack.push({ parts: [...frame.parts, name], last: "" });
    else if (stat) remove(file);
    return false;
  }
  function stepIndex(work, isRoundActive) {
    if (!UUID.test(work.node || "") || !modules.includes(work.module) || !INDEX.test(work.name)) throw new Error("保留期扫描游标无效");
    if (work.module === "tcpquality-full") { note(work.node, work.module, work.name, currentRows(work)); indexCache = null; return true; }
    if (work.deleting) {
      // A queued lease can outlive an already-committed manifest after a
      // process/save failure. Check the queue on every resumed deletion step,
      // including after the detail marker / some file removals are durable.
      if (isRoundActive && isRoundActive(work.node, work.deleting.id)) {
        work.after = work.deleting.key; work.deleting = null; treeCache.clear();
        return false;
      }
      if (!work.deleting.marked) {
        const job = work.deleting, file = path.join(roundDir(job.node, job.id), "manifest.json"), manifest = read(file, null);
        const threshold = (job.mode === "round" ? 90 : 7) * DAY;
        if (manifest && (!manifest.completedAt || clock() - Date.parse(manifest.completedAt) <= threshold || manifest.slots?.some(slot => !["ok", "partial", "application", "failed", "missing", "cancelled"].includes(slot.state)))) {
          work.after = job.key; work.deleting = null; return false;
        }
        if (manifest && job.mode === "details" && manifest.detailAvailable !== false) {
          manifest.detailAvailable = false; write(file, manifest); invalidateRound(job.node, job.id);
        }
        job.marked = true;
        return false;
      }
      if (!prune(work.deleting)) return false;
      work.updates ||= [];
      work.updates.push({ id: work.deleting.id, remove: work.deleting.mode === "round" });
      work.after = work.deleting.key;
      invalidateRound(work.node, work.deleting.id);
      work.deleting = null;
      return false;
    }
    const rows = currentRows(work);
    // The migration path discovers an old day once. Fresh retained days need
    // no per-row cursor steps, and all future cycles skip the JSON entirely.
    if (!work.updates?.length && (indexCache.minimumDue === null || indexCache.minimumDue > clock())) {
      note(work.node, work.module, work.name, rows); indexCache = null; return true;
    }
    let lower = 0, upper = rows.length;
    if (work.after) while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2), value = rows[middle];
      if (value.plannedAt + "|" + value.id >= work.after) lower = middle + 1; else upper = middle;
    }
    const row = rows[lower];
    if (!row) {
      commit(work); note(work.node, work.module, work.name, currentRows(work)); indexCache = null;
      return true;
    }
    const key = row.plannedAt + "|" + row.id;
    if (!row.completedAt || (!row.detailAvailable && clock() - Date.parse(row.completedAt) <= 90 * DAY) || clock() - Date.parse(row.completedAt) <= 7 * DAY) { work.after = key; return false; }
    if (isRoundActive && isRoundActive(work.node, row.id)) { work.after = key; return false; }
    const whole = clock() - Date.parse(row.completedAt) > 90 * DAY;
    const file = path.join(roundDir(work.node, row.id), "manifest.json"), manifest = read(file, null);
    // A stale index must never expire a still-running round or an updated
    // completion. Preserve its row for recovery / explicit index rebuild.
    if (manifest && (!manifest.completedAt || manifest.slots?.some(slot => !["ok", "partial", "application", "failed", "missing", "cancelled"].includes(slot.state)) || clock() - Date.parse(manifest.completedAt) <= (whole ? 90 : 7) * DAY)) { work.after = key; return false; }
    work.deleting = { node: work.node, id: row.id, key, mode: whole ? "round" : "details", marked: false, stack: [{ parts: whole ? [] : ["measurements"], last: "" }] };
    // Write-ahead deletion cursor before changing the manifest marker.
    write(stateFile, state());
    return false;
  }
  function bucket(at) { return new Date(at).toISOString().slice(0, 10); }
  function receiptPath(id, at) {
    if (!UUID.test(id || "") || !Number.isFinite(at)) throw new Error("结果回执无效");
    return path.join(base, "receipts", bucket(at), id + ".json");
  }
  function writeReceipt(id, value) { write(receiptPath(id, value.at), value); }
  function deleteReceipt(id, at) {
    const file = receiptPath(id, at);
    try { fs.unlinkSync(file); } catch (error) { if (!missing(error, file)) throw error; }
  }
  function receipt(id) {
    const now = clock();
    for (let day = 0; day < 8; day++) {
      const value = read(receiptPath(id, now - day * DAY), null);
      if (value && now - value.at < 7 * DAY) return value;
    }
    return read(path.join(base, "receipts", id + ".json"), null);
  }
  function stepReceipts(cycle) {
    const receipts = path.join(base, "receipts");
    if (!cycleCache) {
      const names = listing(receipts);
      cycleCache = { legacy: state().legacyComplete ? [] : names, position: 0, buckets: [], bucketPosition: 0 };
      if (state().legacyComplete) cycleCache.buckets = names.filter(name => DATE.test(name) && name > (cycle.receiptAfter || "") && Date.parse(name + "T00:00:00Z") + 8 * DAY <= clock()).sort();
    }
    if (!state().legacyComplete) {
      let name = cycleCache.legacy[cycleCache.position++];
      // Directory names survive a restart. Skip the few day buckets within
      // this step so a one-step/restart sequence still reaches a legacy file.
      while (name !== undefined && (!name.endsWith(".json") || !UUID.test(name.slice(0, -5)))) {
        if (DATE.test(name) && name > (cycle.receiptAfter || "") && Date.parse(name + "T00:00:00Z") + 8 * DAY <= clock()) cycleCache.buckets.push(name);
        name = cycleCache.legacy[cycleCache.position++];
      }
      if (name !== undefined) {
        // Process the native directory order. Every migrated/deleted file
        // disappears from the old flat directory, so restart safely relists
        // only the remaining files without a 100k-name JS sort/filter spike.
        const file = path.join(receipts, name), value = read(file, null);
        if (value && Number.isFinite(value.at) && clock() - value.at < 7 * DAY) {
          const output = receiptPath(name.slice(0, -5), value.at), existing = read(output, null);
          if (!existing || existing.at < value.at) {
            const directory = path.dirname(output);
            if (!receiptDirectories.has(directory)) { fs.mkdirSync(directory, { recursive: true }); receiptDirectories.add(directory); }
            // Preserve the already durable JSON bytes; migration is an atomic
            // rename, not a second serialization/write of every receipt.
            fs.renameSync(file, output);
          } else remove(file);
        } else remove(file);
        cycle.legacyAfter = name;
        return false;
      }
      state().legacyComplete = true; cycleCache.buckets.sort();
      return false;
    }
    if (!cycle.receiptTree) {
      const name = cycleCache.buckets[cycleCache.bucketPosition];
      if (!name) return true;
      cycle.receiptTree = { name, last: "" };
    }
    const tree = cycle.receiptTree;
    if (!DATE.test(tree.name)) throw new Error("回执保留期游标无效");
    const directory = path.join(receipts, tree.name);
    let names = treeCache.get(directory);
    if (!names || names.after !== tree.last) {
      names = { after: tree.last, values: listing(directory).filter(safeName).sort().filter(name => name > tree.last), position: 0 };
      treeCache.set(directory, names);
    }
    const name = names.values[names.position++];
    if (name === undefined) {
      removeDirectory(directory); treeCache.delete(directory); cycle.receiptTree = null; cycle.receiptAfter = tree.name; cycleCache.bucketPosition++;
    } else { remove(path.join(directory, name)); tree.last = name; names.after = name; }
    return false;
  }
  function maintenanceStep(nodeUuids, options = {}) {
    const started = Date.now(), maxSteps = Math.max(1, Math.min(512, Number(options.maxSteps) || 32)), maxMs = Math.max(1, Math.min(100, Number(options.maxMs) || 10));
    const current = state();
    if (!current.cycle && current.nextAt > clock()) return { pending: false, steps: 0, nextAt: current.nextAt };
    if (!current.cycle) current.cycle = { nodes: [...new Set(nodeUuids)].filter(id => UUID.test(id)), nodeIndex: 0, moduleIndex: 0, files: null, fileIndex: 0, work: null, phase: "deletes", legacyAfter: "", receiptAfter: "" };
    const isRoundActive = typeof options.isRoundActive === "function" ? options.isRoundActive : null;
    let steps = 0;
    try {
      while (current.cycle && steps < maxSteps && Date.now() - started < maxMs) {
        steps++;
        const cycle = current.cycle;
        if (cycle.phase === "deletes") {
          if (!recoverOneFullDeletion || !recoverOneFullDeletion()) cycle.phase = "nodes";
        } else if (cycle.phase === "nodes") {
          const node = cycle.nodes[cycle.nodeIndex];
          if (!node) { cycle.phase = "receipts"; continue; }
          const module = modules[cycle.moduleIndex];
          if (!module) { cycle.nodeIndex++; cycle.moduleIndex = 0; cycle.files = null; continue; }
          if (cycle.work) {
            if (stepIndex(cycle.work, isRoundActive)) { cycle.work = null; cycle.fileIndex++; }
            continue;
          }
          if (!cycle.files) {
            const value = meta(node), names = listing(path.join(nodeDir(node), "indexes", module)).filter(name => INDEX.test(name));
            const present = new Set(names), stale = Object.keys(value.indexes).filter(key => key.startsWith(module + "/") && !present.has(key.slice(module.length + 1)));
            if (stale.length) {
              for (const key of stale) delete value.indexes[key];
              write(path.join(nodeDir(node), "retention.json"), value);
            }
            cycle.files = names.filter(name => !Object.prototype.hasOwnProperty.call(value.indexes, module + "/" + name) || (value.indexes[module + "/" + name] !== null && value.indexes[module + "/" + name] <= clock())).sort();
            cycle.fileIndex = 0;
          }
          const name = cycle.files[cycle.fileIndex];
          if (!name) { cycle.moduleIndex++; cycle.files = null; continue; }
          cycle.work = { node, module, name, after: "", updates: [], deleting: null };
        } else if (stepReceipts(cycle)) {
          current.cycle = null; current.nextAt = clock() + HOUR; cycleCache = null; treeCache.clear(); indexCache = null;
        }
      }
      if (current.cycle?.work) commit(current.cycle.work);
      if (steps) write(stateFile, current);
    } catch (error) {
      // The last durable cursor remains replayable; never cache a partially
      // modified journal after a failed atomic write.
      saved = null; cycleCache = null; indexCache = null; treeCache.clear(); metas.clear(); throw error;
    }
    return { pending: !!current.cycle, steps, nextAt: current.nextAt, elapsedMs: Date.now() - started };
  }
  return { beforeIndex, noteIndex, maintenanceStep, receipt, writeReceipt, deleteReceipt };
}
module.exports = { retentionStore };
