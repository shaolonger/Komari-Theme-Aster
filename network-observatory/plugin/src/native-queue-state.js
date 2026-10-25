// Single-writer native state: small metadata + 64 queue buckets. A committed
// intent is rolled forward before any reader observes a partially applied save.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { UUID } = require('./model.js');
const BUCKETS = 64, VERSION = 1, MAX_JOBS = 10000;
function nativeQueueState(file, isMissingFile, blank = () => ({ jobs: [] }), validate = value => value) {
  if (path.basename(file) !== 'native-state.json') throw new Error('分片队列仅支持 native-state.json');
  const base = path.join(path.dirname(file), 'native-queue'), pendingFile = path.join(base, 'pending.json');
  let cached, stamp, initialized = false, epoch = null, parts = new Map(), records = new Map();
  let nextOrder = 0, orderOwners = new Map(), dirty = new Map(), syncedJobs, syncedLength = -1, metadataText = '', migration = false;
  const bucketFor = id => parseInt(id.slice(0, 2), 16) % BUCKETS;
  const bucketName = bucket => bucket.toString(16).padStart(2, '0') + '.json';
  const epochDir = value => path.join(base, value);
  function fail(message) { throw new Error('原生队列状态损坏；停止写入：' + message); }
  function fingerprint() {
    const stat = fs.statSync(file);
    return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':');
  }
  function text(fileName, fallback = null) {
    try {
      fs.accessSync(fileName);
      if (fs.statSync(fileName).size > 64 * 1024 * 1024) fail('文件超过安全上限');
      return fs.readFileSync(fileName, 'utf8');
    } catch (error) { if (isMissingFile(error, fileName)) return fallback; throw error; }
  }
  function atomic(fileName, raw) {
    fs.mkdirSync(path.dirname(fileName), { recursive: true });
    fs.writeFileSync(fileName + '.tmp', raw, { mode: 0o600 });
    fs.renameSync(fileName + '.tmp', fileName);
  }
  function descriptor(value) {
    if (value === undefined) return null;
    if (!value || value.version !== VERSION || value.buckets !== BUCKETS || !UUID.test(value.epoch || '')) fail('未知队列版本或分片描述');
    return value;
  }
  function checkJob(job) {
    if (!job || !UUID.test(job.id || '') || !UUID.test(job.roundId || '') || !UUID.test(job.nodeUuid || '') || typeof job.executor !== 'string') fail('任务标识无效');
  }
  function checkRecord(record) {
    if (!record || !Number.isSafeInteger(record.order) || record.order < 0) fail('FIFO 序号无效');
    checkJob(record.job);
  }
  function loadEpoch(value, allowMissing = false) {
    const loaded = new Map(), byId = new Map(), orders = new Map(), folder = epochDir(value);
    let names;
    try { fs.accessSync(folder); names = fs.readdirSync(folder); }
    catch (error) { if (allowMissing && isMissingFile(error, folder)) return { parts: loaded, records: byId, orders, next: 0 }; throw error; }
    let next = 0;
    for (const name of names) {
      if (/^[0-9a-f]{2}\.json\.tmp$/.test(name)) continue;
      if (!/^[0-9a-f]{2}\.json$/.test(name) || parseInt(name, 16) >= BUCKETS) fail('未知分片文件');
      const bucket = parseInt(name, 16), raw = text(path.join(folder, name));
      if (raw === null) fail('分片消失');
      const content = JSON.parse(raw);
      if (!content || content.version !== VERSION || content.bucket !== bucket || !Array.isArray(content.records)) fail('分片格式无效');
      const rows = new Map();
      for (const record of content.records) {
        checkRecord(record);
        if (bucketFor(record.job.id) !== bucket || byId.has(record.job.id) || orders.has(record.order)) fail('重复任务、序号或分片不匹配');
        rows.set(record.job.id, record); byId.set(record.job.id, { bucket, record }); orders.set(record.order, record.job.id);
        next = Math.max(next, record.order + 1);
        if (byId.size > MAX_JOBS) fail('任务超过容量');
      }
      loaded.set(bucket, rows);
    }
    if (!allowMissing && loaded.size !== BUCKETS) fail('队列分片缺失');
    return { parts: loaded, records: byId, orders, next };
  }
  function checkTransaction(tx, root) {
    if (!tx || tx.version !== VERSION || !UUID.test(tx.epoch || '') || (tx.baseEpoch !== null && !UUID.test(tx.baseEpoch || '')) || !Array.isArray(tx.changes) || tx.changes.length > MAX_JOBS * 2 || typeof tx.migration !== 'boolean') fail('事务格式或版本无效');
    const rootDescriptor = root ? descriptor(root.queueStore) : null;
    if (root && (!Array.isArray(root.jobs) || (rootDescriptor && root.jobs.length))) fail('事务根元数据无效');
    const rootEpoch = rootDescriptor?.epoch || null;
    if (rootEpoch !== tx.baseEpoch && rootEpoch !== tx.epoch) fail('事务与当前队列不匹配');
    if ((!tx.migration && tx.baseEpoch !== tx.epoch) || (tx.migration && tx.baseEpoch === tx.epoch)) fail('事务代际无效');
    if (tx.metadata !== undefined) {
      const target = descriptor(tx.metadata?.queueStore);
      if (!target || target.epoch !== tx.epoch || !Array.isArray(tx.metadata.jobs) || tx.metadata.jobs.length) fail('事务元数据无效');
    } else if (tx.migration || !rootDescriptor || rootDescriptor.epoch !== tx.epoch) fail('事务缺少元数据');
    const ids = new Set();
    for (const change of tx.changes) {
      if (!change || !UUID.test(change.id || '') || ids.has(change.id)) fail('事务任务无效或重复');
      ids.add(change.id);
      if (change.job !== null) { checkRecord(change); if (change.job.id !== change.id) fail('事务任务不匹配'); }
    }
  }
  function apply(tx, current, rawMetadata) {
    const touched = new Set();
    for (const change of tx.changes) {
      const bucket = bucketFor(change.id), rows = current.parts.get(bucket) || new Map();
      if (change.job === null) {
        const previous = current.records.get(change.id);
        if (previous) current.orders.delete(previous.record.order);
        rows.delete(change.id); current.records.delete(change.id);
      } else {
        const previous = current.records.get(change.id), owner = current.orders.get(change.order);
        if ((previous && previous.record.order !== change.order) || (owner !== undefined && owner !== change.id)) fail('事务产生重复或变动 FIFO 序号');
        current.orders.set(change.order, change.id);
        const record = { order: change.order, job: change.job };
        rows.set(change.id, record); current.records.set(change.id, { bucket, record });
        current.next = Math.max(current.next, change.order + 1);
      }
      current.parts.set(bucket, rows); touched.add(bucket);
    }
    if (current.records.size > MAX_JOBS) fail('事务超过队列容量');
    fs.mkdirSync(epochDir(tx.epoch), { recursive: true });
    if (tx.migration) for (let bucket = 0; bucket < BUCKETS; bucket++) {
      touched.add(bucket); if (!current.parts.has(bucket)) current.parts.set(bucket, new Map());
    }
    for (const bucket of touched) {
      const rows = current.parts.get(bucket);
      // Keep empty buckets as valid atomic snapshots; deletion is unnecessary.
      atomic(path.join(epochDir(tx.epoch), bucketName(bucket)), JSON.stringify({version:VERSION,bucket,records:[...rows.values()]}));
    }
    if (tx.metadata !== undefined) atomic(file, rawMetadata === undefined ? JSON.stringify(tx.metadata) : rawMetadata);
    fs.unlinkSync(pendingFile);
    return current;
  }
  function hasPending() {
    try { fs.accessSync(pendingFile); return true; }
    catch (error) { if (isMissingFile(error, pendingFile)) return false; throw error; }
  }
  function recover() {
    const raw = text(pendingFile);
    if (raw === null) return;
    const rootText = text(file), root = rootText === null ? null : JSON.parse(rootText), tx = JSON.parse(raw);
    checkTransaction(tx, root);
    const current = loadEpoch(tx.epoch, tx.migration);
    apply(tx, current);
  }
  function invalidate() {
    cached = undefined; stamp = undefined; initialized = false; epoch = null;
    parts = new Map(); records = new Map(); nextOrder = 0; orderOwners = new Map(); dirty = new Map();
    syncedJobs = undefined; syncedLength = -1; metadataText = ''; migration = false;
  }
  function read() {
    try {
      if (initialized && !hasPending()) {
        try { if (fingerprint() === stamp) return cached; }
        catch (error) { if (!isMissingFile(error, file)) throw error; }
      }
      // A failed commit never exposes mixed metadata/buckets to another route.
      recover();
      const raw = text(file);
      if (raw === null) {
        let evidence = [];
        try { fs.accessSync(base); evidence = fs.readdirSync(base); }
        catch (error) { if (!isMissingFile(error, base)) throw error; }
        if (evidence.some(name => name !== 'pending.json.tmp')) fail('队列元数据缺失');
      }
      const root = raw === null ? blank() : JSON.parse(raw), info = descriptor(root.queueStore);
      if (!Array.isArray(root.jobs)) fail('缺少队列');
      if (info && root.jobs.length) fail('分片元数据包含内联任务');
      let value;
      if (info) {
        const loaded = loadEpoch(info.epoch);
        epoch = info.epoch; parts = loaded.parts; records = loaded.records; orderOwners = loaded.orders; nextOrder = loaded.next;
        value = validate({ ...root, jobs: [...records.values()].map(row=>row.record).sort((a,b)=>a.order-b.order).map(row=>row.job) });
        migration = false;
      } else {
        value = validate(root); epoch = null; parts = new Map(); records = new Map(); orderOwners = new Map(); nextOrder = 0;
        for (const job of value.jobs) {
          checkJob(job);
          if (records.has(job.id)) fail('内联任务重复');
          const bucket = bucketFor(job.id), record = { order: nextOrder++, job }, rows = parts.get(bucket) || new Map();
          rows.set(job.id, record); parts.set(bucket, rows); records.set(job.id, {bucket,record}); orderOwners.set(record.order, job.id);
        }
        if (records.size > MAX_JOBS) fail('任务超过容量');
        migration = true;
      }
      dirty.clear(); cached = value; initialized = true;
      syncedJobs = value.jobs; syncedLength = value.jobs.length; metadataText = raw || '';
      try { stamp = fingerprint(); } catch (error) { if (!isMissingFile(error, file)) throw error; stamp = undefined; }
      return value;
    } catch (error) { invalidate(); throw error; }
  }
  function touchJob(job) { checkJob(job); dirty.set(job.id, job); }
  function forgetJob(job) { checkJob(job); dirty.set(job.id, null); }
  function syncStructure(value) {
    // Only a marked update of existing objects can take the O(1) path.
    // Unmarked writes / new IDs still verify structure, including replacement
    // inside the same array, instead of silently blessing an unpersisted queue.
    if (syncedJobs === value.jobs && syncedLength === value.jobs.length && dirty.size &&
      [...dirty].every(([id, job]) => job !== null && records.has(id))) return;
    const ids = new Set();
    for (const job of value.jobs) {
      checkJob(job); if (ids.has(job.id)) fail('任务重复'); ids.add(job.id);
      const previous = records.get(job.id);
      if (!previous || previous.record.job !== job) dirty.set(job.id, job);
    }
    for (const id of records.keys()) if (!ids.has(id)) dirty.set(id, null);
    // A new task can be created and closed within the same synchronous action.
    for (const [id, job] of dirty) if (job && !ids.has(id)) {
      if (records.has(id)) dirty.set(id, null); else dirty.delete(id);
    }
  }
  function write(value, options = {}) {
    try {
      let currentStamp;
      if (initialized) {
        try { currentStamp = fingerprint(); }
        catch (error) { if (!isMissingFile(error, file)) throw error; }
      }
      if (!initialized || currentStamp !== stamp || hasPending()) {
        const current = read();
        if (value !== current && options.replace !== true) fail('事务恢复后需要重新读取状态');
      }
      if (!Array.isArray(value.jobs) || value.jobs.length > MAX_JOBS) fail('队列容量无效');
      const replacing = options.replace === true;
      const migrating = migration || replacing;
      const targetEpoch = migrating ? crypto.randomUUID() : epoch;
      const marker = {version:VERSION,epoch:targetEpoch,buckets:BUCKETS};
      let changes;
      if (migrating) {
        const ids = new Set(); changes = value.jobs.map((job,order)=>{checkJob(job);if(ids.has(job.id))fail('任务重复');ids.add(job.id);return {id:job.id,order,job};});
      } else {
        syncStructure(value);
        changes = [...dirty].map(([id,job]) => {
          if (job === null) return {id,job:null};
          const order = records.get(id)?.record.order ?? nextOrder++;
          if (!Number.isSafeInteger(order)) fail('FIFO 序号超过容量');
          return {id,order,job};
        });
      }
      let small, rawMetadata;
      if (options.metadata !== false || migrating) {
        small = { ...value, jobs: [], queueStore: marker };
        rawMetadata = JSON.stringify(small);
        if (!migrating && rawMetadata === metadataText) { small = undefined; rawMetadata = undefined; }
      }
      if (!changes.length && small === undefined) {
        cached = value; syncedJobs = value.jobs; syncedLength = value.jobs.length;
        dirty.clear(); return { metadataWritten: false, changed: false };
      }
      const tx = {version:VERSION,baseEpoch:epoch,epoch:targetEpoch,migration:migrating,changes};
      if (small !== undefined) tx.metadata = small;
      // Build metadata once. Job-only commits never walk provider.probes,
      // inventory, suites, or other unchanged metadata.
      const raw = '{"version":1,"baseEpoch":'+JSON.stringify(epoch)+',"epoch":'+JSON.stringify(targetEpoch)+',"migration":'+JSON.stringify(migrating)+',"changes":'+JSON.stringify(changes)+(small === undefined ? '' : ',"metadata":'+rawMetadata)+'}';
      atomic(pendingFile, raw);
      const current = migrating ? {parts:new Map(),records:new Map(),orders:new Map(),next:0} : {parts,records,orders:orderOwners,next:nextOrder};
      apply(tx, current, rawMetadata);
      epoch = targetEpoch; parts = current.parts; records = current.records; orderOwners = current.orders; nextOrder = current.next;
      value.queueStore = marker; cached = value; initialized = true; migration = false;
      syncedJobs = value.jobs; syncedLength = value.jobs.length; dirty.clear();
      if (small !== undefined) { metadataText = rawMetadata; stamp = fingerprint(); }
      return { metadataWritten: small !== undefined, changed: true };
    } catch (error) { invalidate(); throw error; }
  }
  return { read, write, invalidate, touchJob, forgetJob };
}
function readNativeState(file, isMissingFile = error => error.code === 'ENOENT') {
  return nativeQueueState(file, isMissingFile).read();
}
function writeNativeState(file, value, isMissingFile = error => error.code === 'ENOENT') {
  const store = nativeQueueState(file, isMissingFile);
  store.read(); return store.write(value, {replace:true});
}
module.exports = { nativeQueueState, readNativeState, writeNativeState, BUCKETS };
