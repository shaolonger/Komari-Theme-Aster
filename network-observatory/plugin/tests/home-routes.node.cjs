const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { project, homeRouteStore } = require('../src/home-routes.js');
const { registerReportController, BASE } = require('../src/report-controller.js');
const A = 'c388e74d-a922-4ae1-bd10-1fb30e2e53de', B = '59d6e276-1d4b-4657-9021-908460853ba3';
const sample = (override = {}) => ({ nodeUuid:A,operation:'route',direction:'VPS→大陆',options:{family:'4',protocol:'tcp'},source:{carrier:'电信',city:'上海',token:'SECRET'},target:'SECRET_TARGET',completedAt:new Date().toISOString(),data:{kind:'route',state:'ok',complete:true,hops:[{asn:'AS4809'},{asn:'4134'}]},...override });
test('ASN evidence never guesses carrier, IP family or opposite direction; recognizes observed networks only', () => {
  assert.equal(project(sample()).evidence.label, 'CN2 / 163');
  for (const [carrier, asn, label] of [['联通','9929','9929'],['移动','58807','CMIN2']]) assert.equal(project(sample({source:{carrier},data:{kind:'route',state:'ok',complete:true,hops:[{asn}]}})).evidence.label,label);
  assert.equal(project(sample({source:{carrier:''}})),null);
  assert.equal(project(sample({direction:'VPS→目标'})),null);
  assert.equal(project(sample({options:{family:''}})),null);
  assert.equal(project(sample({data:{kind:'route',state:'ok',hops:[{asn:'AS48090'}]}})).evidence.label,'未识别');
});
test('projection preserves separate IPv4/6 and directions, ages evidence, survives restart and redacts private data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'aster-home-routes-')); let now = Date.now();
  try {
    let store=homeRouteStore(root,e=>e.code==='ENOENT',()=>now);
    store.observe(sample());store.observe(sample({options:{family:'6'},direction:'大陆→VPS'}));
    let summary=store.summary([A]);
    assert.equal(summary[A]['4'][0].forward,null);
    assert.equal(summary[A]['4'][0].return.label,'CN2 / 163');
    assert.equal(summary[A]['6'][0].return,null);
    assert.ok(!JSON.stringify(summary).includes('SECRET'));
    store=homeRouteStore(root,e=>e.code==='ENOENT',()=>now);
    now+=86400001; assert.equal(store.summary([A])[A]['4'][0].return.state,'stale');
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
