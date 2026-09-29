const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { makePolicy, reconcilePolicies, normalizeInventory } = require('../src/policies.js');
const { CATALOG } = require('../src/catalog.js');
const { cacheReportImages, imagePath, pruneReportImages } = require('../src/report-images.js');

const A = 'c388e74d-a922-4ae1-bd10-1fb30e2e53de';
const B = '59d6e276-1d4b-4657-9021-908460853ba3';
const C = '2e6b553e-8c6b-4c9f-a223-b61227dd10ba';
const BASE = '/api/aster-network-observatory/v1';
const inventory = () => [{ uuid: A, name: 'Tokyo', group: 'East', token: 'MUST_NOT_PERSIST' }, { uuid: B, name: 'Seoul', group: 'East' }];
const later = () => [...inventory(), { uuid: C, name: 'Osaka', group: 'East' }];
const sleep = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(initial, { gojaErrno = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-policy-'));
  if (initial) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(initial));
  const routes = new Map(), cron = [], calls = [], errors = [];
  let clientList = inventory();
  const server = {
    route(method, route, handler) { routes.set(`${method} ${route}`, handler); },
    cron(expression, handler) { cron.push(handler); },
    async call(method) { calls.push(method); assert.equal(method, 'admin:listClients'); return clientList; },
  };
  const pluginFs = Object.create(fs);
  pluginFs.readFileSync = (file, encoding) => {
    try { return fs.readFileSync(file, encoding); }
    catch (error) {
      if (!gojaErrno || error.code !== 'ENOENT') throw error;
      // Goja exposes syscall.Errno as an object, even when console logs serialize it as 2.
      throw { value: { Op: 'lstat', Path: file, Err: { toString: () => gojaErrno === 2 ? 'no such file or directory' : 'permission denied' } } };
    }
  };
  pluginFs.accessSync = (file) => {
    try { return fs.accessSync(file); }
    catch (error) {
      if (!gojaErrno || error.code !== 'ENOENT') throw error;
      const probeError = new Error('Komari accessSync filesystem error');
      probeError.code = gojaErrno === 2 ? 'ENOENT' : 'EACCES';
      throw probeError;
    }
  };
  const pluginRequire = (name) => name === 'server' ? server : name === 'fs' ? pluginFs : ['path', 'crypto'].includes(name) ? require(name) : require(path.resolve(__dirname, '..', name));
  // Komari 1.4.3 implements Buffer.from but not the Node Buffer.byteLength static.
  const runtime = { require: pluginRequire, __storageDir__: dir, Buffer: { from: Buffer.from.bind(Buffer) }, console: { error(...args) { errors.push(args); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../script.js'), 'utf8'), runtime);
  runtime.load();
  async function invoke(method, route, { body, role = 'admin', token } = {}) {
    const endpoint = route.split('?')[0];
    const handler = [...routes.entries()].find(([key]) => {
      const [verb, pattern] = key.split(' ');
      return verb === method && new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`).test(endpoint);
    })?.[1];
    assert.ok(handler, `missing ${method} ${route}`);
    const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, write(bytes) { this.bytes = Buffer.from(bytes); }, end(content) { if (content !== undefined) this.json = JSON.parse(content); } };
    await handler({ url: route, body: body === undefined ? '' : JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {}, context: { principal: { type: 'user', roles: [role] } } }, res);
    return res;
  }
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  return { invoke, state, cron, calls, errors, writeState(value) { fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(value)); }, setInventory(value) { clientList = value; }, cleanup() { fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('NextTrace targets are selectable and public iperf3 candidates require consent', () => {
  const routes = CATALOG.find((item) => item.id === 'china-route');
  assert.ok(routes.items.length >= 40);
  assert.equal(new Set(routes.items.map((item) => item.target)).size, routes.items.length);
  const chosen = routes.items.find((item) => item.target === 'ipv6.sha-4837.endpoint.nxtrace.org');
  const policy = makePolicy({ presetId: 'china-route', clients: [A], settings: { targetIds: [chosen.id], scheduleType: 'daily', dailyTimes: ['06:00', '18:00'], utcOffsetMinutes: 480 } });
  assert.equal(policy.items.length, 1);
  const state = { config: { schedules: [] }, policies: [policy], tasks: [] };
  reconcilePolicies(state, normalizeInventory(inventory()), Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(state.config.schedules.length, 1);
  assert.deepEqual(state.config.schedules[0].dailyTimes, ['06:00', '18:00']);
  assert.equal(state.config.schedules[0].target, chosen.target);
  const throughput = CATALOG.find((item) => item.id === 'throughput');
  assert.ok(throughput.targets.length >= 6);
  assert.throws(() => makePolicy({ presetId: 'throughput', clients: [A], settings: { target: throughput.targets[0].target } }), /授权/);
});

test('uploaded TcpQuality PNG is cached locally, bounded, and pruned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-report-cache-'));
  const originalFetch = global.fetch;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK4RAAAAAASUVORK5CYII=', 'base64');
  const calls = [];
  global.fetch = async (url) => { calls.push(url); return { ok: true, headers: { get(name) { return name === 'content-type' ? 'image/png' : String(png.length); } }, async arrayBuffer() { return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength); } }; };
  try {
    const row = { nodeUuid: A, taskId: 'd7d488ff-a122-4ae1-bd10-1fb30e2e53de', mode: 'tcpquality-report', status: 'success', rawOutput: '报告链接 https://tcpquality.ibsgss.uk/r/hUETeLqqyF' };
    await cacheReportImages(dir, row);
    assert.deepEqual(row.reportImages, ['ipv4', 'ipv6']);
    assert.equal(calls.length, 2);
    assert.deepEqual(fs.readFileSync(imagePath(dir, A, row.taskId, 'ipv4')), png);
    pruneReportImages(dir, A, []);
    assert.equal(fs.existsSync(imagePath(dir, A, row.taskId, 'ipv4')), false);
  } finally { global.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('group inheritance is idempotent, follows new VPSes, and keeps single-node overrides', () => {
  const policy = makePolicy({ presetId: 'basic', groups: ['East'] });
  const state = { config: { schedules: [] }, policies: [policy], tasks: [] };
  reconcilePolicies(state, normalizeInventory(inventory()), 1000);
  assert.equal(state.config.schedules.length, 4);
  assert.equal(JSON.stringify(state).includes('MUST_NOT_PERSIST'), false);
  const ids = state.config.schedules.map((p) => p.id);
  reconcilePolicies(state, normalizeInventory(inventory()), 2000);
  assert.deepEqual(state.config.schedules.map((p) => p.id), ids);
  const overlap = makePolicy({ presetId: 'basic', clients: [A] });
  state.policies.push(overlap);
  reconcilePolicies(state, normalizeInventory(inventory()), 3000);
  assert.equal(state.config.schedules.length, 4, 'overlapping scope should not duplicate checks');
  const own = state.config.schedules.find((p) => p.clients[0] === A);
  own.customized = true;
  own.target = 'my.example.net';
  reconcilePolicies(state, normalizeInventory(later()), 4000);
  assert.equal(state.config.schedules.length, 6);
  assert.equal(state.config.schedules.find((p) => p.id === own.id).target, 'my.example.net');
  state.policies[0].enabled = false;
  reconcilePolicies(state, normalizeInventory(later()), 5000);
  assert.equal(state.config.schedules.find((p) => p.id === own.id).enabled, true);
  assert.equal(state.config.schedules.find((p) => p.clients[0] === C).enabled, false);
});

test('two online VPSes receive scheduled work independently and save isolated reports', async () => {
  const f = fixture(undefined, { gojaErrno: 2 });
  try {
    await sleep();
    assert.equal(f.errors.length, 0, 'initial scheduler must accept Komari 1.4.3 missing-file errors');
    assert.deepEqual(f.state().config.schedules, []);
    const tokenA = (await f.invoke('POST', `${BASE}/nodes/${A}/token`, { body: {} })).json.token;
    const tokenB = (await f.invoke('POST', `${BASE}/nodes/${B}/token`, { body: {} })).json.token;
    const input = { presetIds: ['basic'], clients: [A, B], groups: [], inherit: true, trafficAccepted: false };
    assert.equal((await f.invoke('POST', `${BASE}/policies/apply`, { body: input })).statusCode, 200);
    for (const [uuid, token] of [[A, tokenA], [B, tokenB]]) {
      assert.equal((await f.invoke('POST', `${BASE}/nodes/${uuid}/heartbeat`, { token, body: { capabilities: ['curl', 'timeout'], runnerVersion: '1.2.0' } })).statusCode, 200);
    }
    const saved = f.state();
    for (const uuid of [A, B]) saved.config.schedules.find((p) => p.clients[0] === uuid).nextRunAt = 0;
    f.writeState(saved);
    f.cron[0](); await sleep();
    assert.equal(f.state().tasks.length, 2);
    const claimed = [];
    for (const [uuid, token] of [[A, tokenA], [B, tokenB]]) {
      const first = await f.invoke('GET', `${BASE}/nodes/${uuid}/poll`, { token });
      assert.equal(first.statusCode, 200);
      assert.ok(first.json.task && first.json.task.mode === 'https');
      assert.equal((await f.invoke('GET', `${BASE}/nodes/${uuid}/poll`, { token })).json.task, null, 'each VPS can run only one task at a time');
      claimed.push([uuid, token, first.json.task]);
    }
    for (const [uuid, token, task] of claimed) {
      const encoded = Buffer.from('status=200 dns_seconds=0.01').toString('base64');
      const output = `ASTER_NETWORK_RESULT_V1\thttps\t${task.target}\t0\t${encoded}`;
      assert.equal((await f.invoke('POST', `${BASE}/nodes/${uuid}/result`, { token, body: { taskId: task.taskId, output } })).statusCode, 200);
    }
    assert.equal(f.state().tasks.length, 0);
    for (const uuid of [A, B]) {
      const history = (await f.invoke('GET', `${BASE}/nodes/${uuid}/history`)).json.items;
      assert.equal(history.length, 1);
      assert.equal(history[0].nodeUuid, uuid);
      assert.equal(history[0].runnerVersion, '1.2.0');
    }
    assert.equal(f.errors.length, 0);
  } finally { f.cleanup(); }
});

test('full-speed tasks require an upgraded runner and run one at a time', async () => {
  const f = fixture();
  try {
    await sleep();
    const tokenA = (await f.invoke('POST', `${BASE}/nodes/${A}/token`, { body: {} })).json.token;
    const tokenB = (await f.invoke('POST', `${BASE}/nodes/${B}/token`, { body: {} })).json.token;
    const plan = { id: 'speedtest_daily', name: '双向测速', mode: 'speedtest', enabled: true, target: 'speed.example.net', port: 5201, intervalMinutes: 1440, clients: [A], nextRunAt: 0 };
    await f.invoke('POST', `${BASE}/nodes/${A}/heartbeat`, { token: tokenA, body: { capabilities: ['iperf3', 'timeout'], runnerVersion: '1.3.0' } });
    assert.equal((await f.invoke('POST', `${BASE}/nodes/${A}/test`, { body: { ...plan, trafficAccepted: true } })).statusCode, 400);
    for (const [uuid, token] of [[A, tokenA], [B, tokenB]]) {
      await f.invoke('POST', `${BASE}/nodes/${uuid}/heartbeat`, { token, body: { capabilities: ['iperf3', 'speedtest', 'timeout'], runnerVersion: '1.4.0' } });
    }
    assert.ok((await f.invoke('GET', `${BASE}/nodes/${A}/status`)).json.node.capabilities.includes('speedtest'));
    assert.equal((await f.invoke('POST', `${BASE}/nodes/${A}/test`, { body: { ...plan, trafficAccepted: true } })).statusCode, 202);
    assert.equal((await f.invoke('POST', `${BASE}/nodes/${B}/test`, { body: { ...plan, clients: [B], trafficAccepted: true } })).statusCode, 202);
    const first = (await f.invoke('GET', `${BASE}/nodes/${A}/poll`, { token: tokenA })).json.task;
    assert.equal(first.mode, 'speedtest');
    assert.equal((await f.invoke('GET', `${BASE}/nodes/${B}/poll`, { token: tokenB })).json.task, null);
    const output = Buffer.from(JSON.stringify({ schema: 'aster-speedtest-v1', upload: { bitsPerSecond: 900_000_000 }, download: { bitsPerSecond: 800_000_000 } })).toString('base64');
    assert.equal((await f.invoke('POST', `${BASE}/nodes/${A}/result`, { token: tokenA, body: { taskId: first.taskId, output: `ASTER_NETWORK_RESULT_V1\tspeedtest\tspeed.example.net\t0\t${output}` } })).statusCode, 200);
    assert.equal((await f.invoke('GET', `${BASE}/nodes/${B}/poll`, { token: tokenB })).json.task.mode, 'speedtest');
  } finally { f.cleanup(); }
});

test('does not overwrite state when Komari reports a filesystem error other than missing file', async () => {
  const f = fixture(undefined, { gojaErrno: 13 });
  try {
    await sleep();
    assert.equal(f.errors.length, 1);
    await assert.rejects(f.invoke('GET', `${BASE}/status`), (error) => error?.value?.Err?.toString() === 'permission denied');
    assert.throws(f.state, /ENOENT/);
  } finally { f.cleanup(); }
});

test('catalog, bulk preview/apply, revisions, and per-node results are scoped and retain old data', async () => {
  const legacy = { id: 'old_plan_1', name: 'Legacy', mode: 'https', enabled: false, target: 'example.net', carrier: '', region: '', port: 443, intervalMinutes: 5, clients: [A], nextRunAt: 0 };
  const oldRecord = { completedAt: '2026-01-01T00:00:00Z', mode: 'https', target: 'example.net', status: 'success', exitCode: 0, rawOutput: 'old', scheduleId: legacy.id, nodeUuid: A, nodeName: 'Tokyo', carrier: '', region: '' };
  const token = 'a'.repeat(64);
  const f = fixture({ config: { schedules: [legacy] }, nodes: { [A]: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), tokenIssuedAt: '2026-01-01', lastSeenAt: '' } }, tasks: [], history: [oldRecord], updatedAt: '' });
  try {
    await sleep();
    assert.equal((await f.invoke('GET', `${BASE}/catalog`, { role: 'viewer' })).statusCode, 403);
    const catalog = await f.invoke('GET', `${BASE}/catalog`);
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json.inventory.length, 2);
    assert.equal(JSON.stringify(catalog.json).includes(token), false);
    assert.equal(JSON.stringify(f.state()).includes('MUST_NOT_PERSIST'), false);
    assert.equal(f.state().config.schedules.find((p) => p.id === legacy.id).name, 'Legacy');
    const input = { presetIds: ['basic'], clients: [], groups: ['East'], inherit: true, trafficAccepted: false };
    assert.equal((await f.invoke('POST', `${BASE}/policies/preview`, { body: { ...input, presetIds: ['throughput'], settingsByPreset: { throughput: { target: 'speed.example.net' } } } })).statusCode, 400);
    assert.equal((await f.invoke('POST', `${BASE}/policies/preview`, { body: { ...input, clients: [A], groups: [], presetIds: ['throughput'], trafficAccepted: true, settingsByPreset: { throughput: { target: 'speed.example.net' } } } })).json.added, 1);
    const preview = await f.invoke('POST', `${BASE}/policies/preview`, { body: input });
    assert.equal(preview.json.added, 4);
    assert.equal(preview.json.nodes.length, 2);
    const applied = await f.invoke('POST', `${BASE}/policies/apply`, { body: input });
    assert.equal(applied.statusCode, 200);
    assert.equal(applied.json.added, 4);
    assert.equal((await f.invoke('POST', `${BASE}/policies/apply`, { body: input })).json.added, 0);
    assert.equal((await f.invoke('PUT', `${BASE}/config`, { body: { schedules: [] } })).statusCode, 409, 'old full-config API must not erase inherited plans');
    const issueB = await f.invoke('POST', `${BASE}/nodes/${B}/token`, { body: {} });
    assert.equal(issueB.statusCode, 201);
    const plansA = (await f.invoke('GET', `${BASE}/nodes/${A}/status`)).json.schedules;
    const plan = plansA.find((p) => p.sourcePolicy);
    const changed = await f.invoke('PUT', `${BASE}/nodes/${A}/plans/${plan.id}`, { body: { ...plan, target: 'own.example.net' } });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json.plan.customized, true);
    assert.equal((await f.invoke('PUT', `${BASE}/nodes/${A}/plans/${plan.id}`, { body: plan })).statusCode, 409);
    const historyA = await f.invoke('GET', `${BASE}/nodes/${A}/history`);
    assert.equal(historyA.json.items[0].rawOutput, 'old');
    assert.equal((await f.invoke('GET', `${BASE}/nodes/${B}/history`)).json.items.length, 0);
    f.setInventory(later());
    f.cron[0](); await sleep();
    assert.equal((await f.invoke('GET', `${BASE}/nodes/${C}/status`)).json.schedules.length, 2);
    assert.equal((await f.invoke('GET', `${BASE}/nodes/${A}/status`)).json.schedules.find((p) => p.id === plan.id).target, 'own.example.net');
    assert.equal((await f.invoke('POST', `${BASE}/nodes/${B}/test`, { body: { ...plan, mode: 'throughput', target: 'speed.example.net', port: 5201 } })).statusCode, 400);
    const oneOff = await f.invoke('POST', `${BASE}/nodes/${B}/test`, { body: { ...plan, target: 'oneoff.example.net', clients: [B] } });
    assert.equal(oneOff.statusCode, 202);
    const policy = (await f.invoke('GET', `${BASE}/catalog`)).json.policies[0];
    assert.equal((await f.invoke('DELETE', `${BASE}/policies/${policy.id}?revision=${policy.revision}`)).statusCode, 200);
    assert.equal((await f.invoke('GET', `${BASE}/nodes/${A}/status`)).json.schedules.some((p) => p.id === plan.id), true);
    assert.equal((await f.invoke('GET', `${BASE}/nodes/${B}/status`)).json.schedules.length, 0);
    assert.equal(f.state().tasks.some((task) => task.taskId === oneOff.json.task.taskId), true, 'deleting an inherited policy must not cancel unrelated one-off work');
    assert.ok(f.calls.length >= 2 && f.calls.every((method) => method === 'admin:listClients'));
  } finally { f.cleanup(); }
});
