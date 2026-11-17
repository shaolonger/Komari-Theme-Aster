const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { normalizeSuite } = require('../src/report-model.js');
const { carrierFixture } = require('./carrier-route-fixture.cjs');
const { speedFixture, A } = require('./carrier-speed-fixture.cjs');
const B = '59d6e276-1d4b-4657-9021-908460853ba3';
for (const [module, endpoint, publishedKey, fixture] of [
  ['routes', 'routes', 'homeRouteNodes', carrierFixture],
  ['china-speed', 'speeds', 'homeSpeedNodes', speedFixture],
]) {
  test(`${endpoint}: configured families track enabled tasks independently of retained history and expose only published nodes`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-configured-families-'));
    try {
      const f = await fixture(root);
      f.state.inventory.push({ uuid: B, publicVisible: true });
      f.state[publishedKey] = [A];
      const suite = normalizeSuite({ clients: [A, B], trafficAccepted: true,
        modules: [{ module, family: '6', preset: module === 'routes' ? 'china-routes' : 'china-public' }] });
      f.state.reportSuites = [suite];
      const read = async () => (await f.invoke('GET', '/public/' + endpoint, undefined, false)).body;
      // Only v4 measurements exist, while the enabled v6 task has no result yet.
      assert.deepEqual((await read()).configuredFamilies, { [A]: ['6'] });
      assert.ok((await read()).nodes[A]);
      assert.equal(JSON.stringify((await read()).configuredFamilies).includes(B), false);
      suite.enabled = false;
      assert.deepEqual((await read()).configuredFamilies, { [A]: [] });
      suite.enabled = true;
      if (module === 'china-speed') {
        suite.trafficAccepted = false;
        assert.deepEqual((await read()).configuredFamilies, { [A]: [] });
      }
      f.state.inventory[0].publicVisible = false;
      assert.deepEqual((await read()).configuredFamilies, {});
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
