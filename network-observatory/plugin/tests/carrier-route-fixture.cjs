const crypto = require('node:crypto');
const { normalizeSuite, planSlots } = require('../src/report-model.js');
const { normalize } = require('../src/globalping.js');
const { registerReportController, BASE } = require('../src/report-controller.js');
const A = 'c388e74d-a922-4ae1-bd10-1fb30e2e53de';
async function carrierFixture(root) {
  const state = { revision: 0, inventory: [{ uuid: A, name: 'VPS', publicVisible: true }], reportSuites: [], homeRouteNodes: [] }, routes = new Map();
  const controller = registerReportController({ storageDir: root, isMissingFile: e => e.code === 'ENOENT', server: { route: (m,p,f) => routes.set(m+' '+p,f) }, authorized: (req,res) => { if (req.admin) return true; res.status=403; return false; }, readBody: req => req.body, respond: (res,status,body) => Object.assign(res,{status,body}) }, { read: () => state, lock: fn => Promise.resolve(fn()), save: () => {}, tick: () => Promise.resolve() });
  const suite = normalizeSuite({ clients: [A], modules: [{ module: 'routes', preset: 'china-routes', publicSources: true }] });
  const roundId = crypto.randomUUID(), plan = planSlots({ endpoints: { [A]: { ipv4: '8.8.8.8' } }, probes: {} }, suite, suite.modules[0], A, roundId);
  const round = controller.store.create({ id: roundId, nodeUuid: A, module: 'routes', suiteId: suite.id, parameters: suite.modules[0], catalogVersion: suite.catalogVersion, slots: plan.slots, _jobs: plan.jobs });
  for (const job of plan.jobs) {
    const carrier = job.source.carrier;
    const asn = carrier.startsWith('电信') ? 4809 : carrier.startsWith('联通') ? 9929 : 58807;
    const measured = job.operation === 'globalping' ? normalize(job, { results: [{ probe: { country: 'CN', asn: job.source.asn, city: 'Shanghai' }, result: { status: 'finished', resolvedAddress: job.target, hops: [{ resolvedAddress: '1.1.1.1', asn: [asn, 4134], timings: [{ rtt: 20 }] }, { resolvedAddress: job.target, asn: [asn], timings: [{ rtt: 25 }] }] } }] })[0] : { source: job.source, data: { kind: 'route', state: 'ok', complete: true, protocol: 'tcp', hops: [{ ttl: 1, address: '1.1.1.1', asn: String(asn), rttMs: 20 }, { ttl: 2, address: job.target, asn: String(asn), rttMs: 25 }] } };
    controller.complete(job, measured.data, measured.source);
  }
  async function invoke(method, suffix, body, admin = true) {
    const res = {}; await routes.get(method+' '+BASE+suffix)({ url: BASE+suffix, body, admin },res); return res;
  }
  return { A, state, controller, plan, round: controller.store.get(A, round.id), invoke, routes };
}
module.exports = { carrierFixture };
