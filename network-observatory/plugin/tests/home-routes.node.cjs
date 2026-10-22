const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { project, homeRouteStore } = require('../src/home-routes.js');
const { registerReportController, BASE } = require('../src/report-controller.js');
const A = 'c388e74d-a922-4ae1-bd10-1fb30e2e53de', B = '59d6e276-1d4b-4657-9021-908460853ba3';
const sample = (override = {}) => ({ nodeUuid:A,operation:'route',direction:'VPS→大陆',options:{family:'4',protocol:'tcp'},source:{carrier:'电信',city:'上海',token:'SECRET'},target:'SECRET_TARGET',completedAt:new Date().toISOString(),data:{kind:'route',state:'ok',complete:true,hops:[{asn:'AS4809'},{asn:'4134'}]},...override });
test('cross-carrier CTGNet, registry CN2 and unknown networks are retained without product certification',()=>{
 const input=sample({source:{carrier:'联通'},data:{kind:'route',state:'partial',complete:false,hops:[{ttl:1,asn:'23764',address:'8.8.8.8'},{ttl:2,asn:'',address:'59.43.246.117'},{ttl:3,asn:'9929',address:'1.1.1.1'},{ttl:4,asn:'65001',address:'9.9.9.9'}]}});
 const row=project(input).evidence;
 assert.equal(row.label,'CTGNet / CN2 / 9929'); assert.ok(row.asns.includes('65001'));
 assert.equal(row.state,'partial'); assert.ok(!row.asns.includes('4809'));
 const facts=require('../src/route-evidence.js').routeFacts(input.data.hops);
 assert.equal(facts.productStatus,'unverified');
 assert.equal(facts.networks.find(n=>n.basis==='registry-prefix').ttls[0],2);
 assert.equal(facts.labels.some(label=>/GIA|GT$/.test(label)),false);
});
test('homepage keeps per-measurement sequences and never combines separate rounds',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-route-rounds-'));
 try {
  const store=homeRouteStore(root,e=>e.code==='ENOENT'),at=Date.now();
  store.observe(sample({roundId:A,completedAt:new Date(at).toISOString(),source:{carrier:'电信',city:'上海'}}));
  store.observe(sample({roundId:B,completedAt:new Date(at+1).toISOString(),source:{carrier:'电信',city:'北京'},data:{kind:'route',state:'partial',complete:false,hops:[{asn:'23764'},{asn:''},{asn:'23764'}]}}));
  const row=store.summary([A])[A]['4'][0].return;
  assert.equal(row.label,'CTGNet'); assert.equal(row.samples,1); assert.equal(row.confirmed,0);
  assert.deepEqual(row.observations[0].asPath,['23764','?','23764']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('ASN evidence never guesses carrier, IP family or opposite direction; recognizes observed networks only', () => {
  assert.equal(project(sample()).evidence.label, 'CN2 / 163');
  for (const [carrier, asn, label] of [['联通','9929','9929'],['移动','58807','CMIN2']]) assert.equal(project(sample({source:{carrier},data:{kind:'route',state:'ok',complete:true,hops:[{asn}]}})).evidence.label,label);
  assert.equal(project(sample({source:{carrier:''}})),null);
  assert.equal(project(sample({direction:'VPS→目标'})),null);
  assert.equal(project(sample({options:{family:''}})),null);
  assert.equal(project(sample({data:{kind:'route',state:'ok',hops:[{asn:'AS48090'}]}})).evidence.label,'AS48090');
});
test('projection preserves separate IPv4/6 and directions, ages evidence, survives restart and redacts private data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'aster-home-routes-')); let now = Date.parse('2026-10-22T00:00:00.000Z');
  try {
    let store=homeRouteStore(root,e=>e.code==='ENOENT',()=>now);
    const completedAt = new Date(now).toISOString();
    store.observe(sample({completedAt}));store.observe(sample({completedAt,options:{family:'6'},direction:'大陆→VPS'}));
    let summary=store.summary([A]);
    assert.equal(summary[A]['4'][0].forward,null);
    assert.equal(summary[A]['4'][0].return.label,'CN2 / 163');
    assert.equal(summary[A]['6'][0].return,null);
    assert.ok(!JSON.stringify(summary).includes('SECRET'));
    store=homeRouteStore(root,e=>e.code==='ENOENT',()=>now);
    now+=86400000; assert.equal(store.summary([A])[A]['4'][0].return.state,'ok');
    now+=1; assert.equal(store.summary([A])[A]['4'][0].return.state,'stale');
    now+=7*86400000; assert.equal(store.summary([A])[A]['4'][0].return,null);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('new failures replace earlier success and out-of-order backfill cannot override current evidence',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-home-routes-'));
 try{const store=homeRouteStore(root,e=>e.code==='ENOENT');const at=Date.now();store.observe(sample({completedAt:new Date(at).toISOString()}));store.observe(sample({completedAt:new Date(at+1).toISOString(),data:{kind:'route',state:'missing',hops:[]}}));store.observe(sample({completedAt:new Date(at-1).toISOString()}));assert.equal(store.summary([A])[A]['4'][0].return.state,'missing');}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('public endpoint is opt-in, hides nonpublic/deleted nodes, checks admin and revision, and never exposes raw reports', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-home-api-')),routes=new Map();
 const state={revision:0,inventory:[{uuid:A,publicVisible:true},{uuid:B,publicVisible:false}],reportSuites:[]};
 try{
   homeRouteStore(root,e=>e.code==='ENOENT').observe(sample());
   registerReportController({storageDir:root,isMissingFile:e=>e.code==='ENOENT',server:{route:(m,p,f)=>routes.set(m+' '+p,f)},authorized:(req,res)=>{if(req.admin)return true;res.status=403;return false;},readBody:req=>req.body,respond:(res,status,body)=>Object.assign(res,{status,body})},{read:()=>state,lock:fn=>Promise.resolve(fn()),save:()=>{},tick:()=>Promise.resolve()});
   const get=async()=>{const res={};await routes.get('GET '+BASE+'/public/routes')({},res);return res;};
   const put=async(body,admin=true)=>{const res={};await routes.get('PUT '+BASE+'/home-routes')({body,admin},res);return res;};
   assert.deepEqual((await get()).body.nodes,{});
   assert.equal((await put({nodeUuids:[A],revision:0},false)).status,403);
   assert.equal((await put({nodeUuids:[B],revision:0})).status,400);
   assert.equal((await put({nodeUuids:[A],revision:7})).status,409);
   assert.equal((await put({nodeUuids:[A],revision:0})).status,200);
   assert.equal((await get()).body.nodes[A]['4'][0].return.label,'CN2 / 163');
   assert.ok(!JSON.stringify((await get()).body).includes('SECRET'));
   assert.equal((await get()).body.nodes[A]['4'][0].return.diagnostic,'');
   state.inventory[0].publicVisible=false;assert.deepEqual((await get()).body.nodes,{});
   state.inventory=[];assert.deepEqual((await get()).body.nodes,{});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('v3 route completion and publishing existing rounds both populate the homepage without reading raw reports publicly', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-home-round-')),routes=new Map(),crypto=require('node:crypto');
 const state={revision:0,inventory:[{uuid:A,publicVisible:true}],reportSuites:[],homeRouteNodes:[]};
 try {
   const controller=registerReportController({storageDir:root,isMissingFile:e=>e.code==='ENOENT',server:{route:(m,p,f)=>routes.set(m+' '+p,f)},authorized:()=>true,readBody:req=>req.body,respond:(res,status,body)=>Object.assign(res,{status,body})},{read:()=>state,lock:fn=>Promise.resolve(fn()),save:()=>{},tick:()=>Promise.resolve()});
   const input=sample(), jobId=crypto.randomUUID();
   const round=controller.store.create({nodeUuid:A,module:'routes',suiteId:crypto.randomUUID(),slots:[{id:'route',jobId,target:input.target,source:input.source,direction:input.direction,options:input.options}]});
   const job={...input,id:jobId,roundId:round.id,slotId:'route',executor:'node:'+A};
   controller.complete(job,input.data,input.source);
   const res={};await routes.get('PUT '+BASE+'/home-routes')({body:{revision:0,nodeUuids:[A]}},res);
   assert.equal(res.status,200);
   const output={};await routes.get('GET '+BASE+'/public/routes')({},output);
   assert.equal(output.body.nodes[A]['4'][0].return.label,'CN2 / 163');
   assert.equal(output.body.nodes[A]['4'][0].forward,null);
   const projected=path.join(root,'home-routes',A+'.json');assert.ok(fs.existsSync(projected));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('actual china-routes preset: 9 catalog return + 3 normalized Globalping forward reports reach private preview, explicit publication and rebuild', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-real-preset-'));
 try {
   const f=await require('./carrier-route-fixture.cjs').carrierFixture(root);
   assert.equal(f.plan.jobs.length,12);
   assert.ok(f.plan.jobs.every(job=>["telecom","unicom","mobile"].includes(job.source.carrierId)));
   assert.equal(f.plan.jobs.filter(j=>j.operation==='globalping').length,3);
   assert.equal(f.round.measurements.length,12);
   const preview=await f.invoke('GET','/home-routes');
   assert.equal(preview.status,200);
   assert.equal(preview.body.access,'admin');
   assert.deepEqual(preview.body.published,[]);
   assert.equal((await f.invoke('GET','/home-routes',undefined,false)).status,403);
   for(const [index,label] of ['CN2','9929','CMIN2'].entries()) {
     const row=preview.body.nodes[A]['4'][index];
     assert.ok(row.forward.label.includes(label));
     assert.equal(row.return.label,label);
     assert.equal(row.return.samples,3);
     assert.equal(row.forward.reportId,f.round.id);
     assert.equal(preview.body.nodes[A]['6'][index].return,null);
   }
   assert.deepEqual((await f.invoke('GET','/public/routes',undefined,false)).body.nodes,{});
   assert.equal((await f.invoke('PUT','/home-routes',{revision:0,nodeUuids:[A],display:true})).status,200);
   const pub=(await f.invoke('GET','/public/routes',undefined,false)).body;
   assert.equal(pub.nodes[A]['4'][0].return.label,'CN2');
   assert.ok(!JSON.stringify(pub).includes('8.8.8.8'));
   assert.equal((await f.invoke('POST','/home-routes/rebuild',{})).status,200);
   f.state.inventory[0].publicVisible=false;
   assert.deepEqual((await f.invoke('GET','/public/routes',undefined,false)).body.nodes,{});
   assert.ok((await f.invoke('GET','/home-routes')).body.nodes[A]);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('multi-AS observations and all built-in carrier labels use shared evidence rules without guessing from target labels',()=>{
 for(const label of ['电信 163','电信 CN2','联通 169','联通 9929','移动 CMNET','移动 CMIN2']) {
  const result=project(sample({source:{carrier:label},data:{kind:'route',state:'ok',complete:true,hops:[{asn:'AS4809 AS4134 9929 58807'}]}}));
  assert.ok(result); assert.equal(result.evidence.asns.length,4);
 }
 assert.equal(project(sample({source:{carrier:'电信 CN2'},data:{kind:'route',state:'ok',complete:true,hops:[]}})).evidence.label,'未识别');
});

test('private failure diagnostics remain available to admins and are stripped from public summaries', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-route-diagnostics-')),routes=new Map();
 const state={revision:0,inventory:[{uuid:A,publicVisible:true}],homeRouteNodes:[A],reportSuites:[]};
 try {
  homeRouteStore(root,e=>e.code==='ENOENT').observe(sample({data:{kind:'route',state:'failed',diagnostic:'connect PRIVATE_TARGET with PRIVATE_CREDENTIAL',hops:[]}}));
  registerReportController({storageDir:root,isMissingFile:e=>e.code==='ENOENT',server:{route:(m,p,f)=>routes.set(m+' '+p,f)},authorized:()=>true,readBody:()=>({}),respond:(res,status,body)=>Object.assign(res,{status,body})},{read:()=>state,lock:fn=>Promise.resolve(fn()),save:()=>{}});
  const admin={};await routes.get('GET '+BASE+'/home-routes')({},admin);
  assert.ok(admin.body.nodes[A]['4'][0].return.diagnostic.includes('PRIVATE_TARGET'));
  const pub={};await routes.get('GET '+BASE+'/public/routes')({},pub);
  assert.equal(pub.body.nodes[A]['4'][0].return.label,'测量失败');
  assert.ok(!JSON.stringify(pub.body).includes('PRIVATE_'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
