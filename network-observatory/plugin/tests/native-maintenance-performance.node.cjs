const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { registerNativeController, BASE } = require('../src/native-controller.js');
const {readNativeState,writeNativeState}=require('../src/native-queue-state.js');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002', token = 'c'.repeat(64);
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-native-maintenance-')), routes = new Map();
  const c = registerNativeController({storageDir:root, isMissingFile:e=>e.code==='ENOENT',
    server:{route:(m,p,f)=>routes.set(m+' '+p,f),call:async()=>[{uuid:A,name:'VPS',ipv4:'8.8.8.8',hidden:false}]},
    readState:()=>({nodes:{[A]:{tokenHash:crypto.createHash('sha256').update(token).digest('hex')}}}),writeState:()=>{},
    readBody:req=>req.body||{}, authorized:req=>req.admin===true, respond:(res,status,body)=>Object.assign(res,{status,body})});
  await new Promise(resolve=>setImmediate(resolve));
  await c.lock(()=>{});
  // Exercise native scheduling and persistence independently of report I/O;
  // real manifests / restart durability are covered by round-controller tests.
  c.roundController.tick=()=>false; c.roundController.publicTick=async()=>{};
  const completed=[],progress=[];
  c.roundController.complete=(job,data)=>completed.push({id:job.id,data});
  c.roundController.progress=job=>progress.push(job.id);
  c.roundController.batch=fn=>fn();
  async function invoke(method,suffix,body={},admin=false){
    const match=[...routes.keys()].find(key=>{const [m,p]=key.split(' ');return m===method&&new RegExp('^'+p.replace(/:[^/]+/g,'[^/]+')+'$').test(BASE+suffix);});
    assert.ok(match,suffix); const res={};
    await routes.get(match)({url:BASE+suffix,body,admin,headers:{authorization:'Bearer '+token}},res); return res;
  }
  async function seed(jobs){await c.lock(()=>{const s=c.read();s.jobs=jobs;writeNativeState(path.join(root,'native-state.json'),s);});}
  return {root,c,invoke,seed,completed,progress,disk:()=>readNativeState(path.join(root,'native-state.json')),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function job(extra={}){return {id:crypto.randomUUID(),roundId:crypto.randomUUID(),slotId:'audit',nodeUuid:A,policyId:crypto.randomUUID(),reportModule:'international',executor:'node:'+A,operation:'latency',phase:'queued',target:'latency.example.net',options:{reportVersion:3,samples:10,port:443},source:{provider:'runner'},expiresAt:Date.now()+3600000,...extra};}
function captureStateWrites(f){const original=fs.writeFileSync;let count=0;fs.writeFileSync=function(file,...args){if(String(file)===path.join(f.root,'native-state.json.tmp'))count++;return original(file,...args);};return {count:()=>count,reset:()=>{count=0;},restore:()=>{fs.writeFileSync=original;}};}

test('idle minute ticks skip whole-state serialization and flush only outstanding heartbeat renewals',async()=>{
  const f=await fixture(); const calls=captureStateWrites(f);
  try{
    await f.seed(Array.from({length:7500},()=>job({executor:'node:'+B,nodeUuid:B,phase:'shared'})));calls.reset();
    for(let i=0;i<5;i++)await f.c.tick();
    assert.equal(calls.count(),0,'idle ticks rewrote a 7500-job queue');
    const heartbeat={version:'test',tools:['curl'],features:['report-v3','latency-samples']};
    assert.equal((await f.invoke('POST','/workers/node/'+A+'/heartbeat',heartbeat)).status,200);
    assert.equal(calls.count(),0,'fresh heartbeat should coalesce');
    assert.equal(f.disk().workers['node:'+A],undefined);
    await f.c.tick();
    assert.equal(calls.count(),1,'an idle tick must persist pending liveness');
    assert.equal(f.disk().workers['node:'+A].version,'test');
    await f.c.tick(); assert.equal(calls.count(),1,'already persisted heartbeat was flushed repeatedly');
  }finally{calls.restore();f.close();}
});

test('unchanged hourly maintenance reports preserve the status timestamp and do not serialize pending jobs',async()=>{
  const f=await fixture(), calls=captureStateWrites(f);
  try{
    await f.seed(Array.from({length:7500},()=>job({executor:'node:'+B,nodeUuid:B,phase:'shared'})));calls.reset();
    const endpoint='/workers/node/'+A+'/maintenance',report={action:'report',state:'waiting',message:'已是建议版本'};
    assert.equal((await f.invoke('POST',endpoint,report)).status,200);
    const at=f.disk().updates['node:'+A].at;
    for(let i=0;i<52;i++)assert.equal((await f.invoke('POST',endpoint,report)).status,200);
    assert.equal(calls.count(),1);
    assert.equal(f.c.read().updates['node:'+A].at,at);
    assert.equal((await f.invoke('POST',endpoint,{...report,state:'failed',message:'下载失败'})).status,200);
    assert.equal(calls.count(),2); assert.equal(f.disk().updates['node:'+A].state,'failed');
  }finally{calls.restore();f.close();}
});

test('worker update checks use the worker index and still block maintenance for a cross-worker benchmark listener',async()=>{
  const f=await fixture();
  try{
    await f.seed(Array.from({length:7500},()=>job({executor:'node:'+B,nodeUuid:B,phase:'shared'})));
    const queue=f.c.read().jobs;
    queue.some=()=>{throw new Error('unrelated full queue scan');};
    const policy='/workers/node/'+A+'/update-policy', maintenance='/workers/node/'+A+'/maintenance';
    const response=await f.invoke('GET',policy);assert.equal(response.status,200);assert.equal(response.body.busy,false);
    const benchmark=job({operation:'benchmark',executor:'probe:'+B,phase:'listening'});
    queue.push(benchmark);
    const busy=await f.invoke('GET',policy);assert.equal(busy.status,200);assert.equal(busy.body.busy,true);
    assert.equal((await f.invoke('POST',maintenance,{action:'claim',version:require('../src/runner-release.json').version})).status,409);
    benchmark.phase='queued';
    assert.equal((await f.invoke('POST',maintenance,{action:'claim',version:require('../src/runner-release.json').version})).status,200);
  }finally{f.close();}
});

test('revoking a large queue completes shared followers once and compacts the job array once',async()=>{
  const f=await fixture(), originalFilter=Array.prototype.filter;
  let scanned=0;
  try{
    const jobs=[];
    for(let i=0;i<500;i++){
      const leader=job({auditQueue:true}),follower=job({auditQueue:true,sharedJobId:leader.id,sharedRoundId:leader.roundId,phase:'shared'});
      jobs.push(leader,follower);
    }
    await f.seed(jobs);
    Array.prototype.filter=function(...args){if(this[0]?.auditQueue)scanned+=this.length;return originalFilter.apply(this,args);};
    const output=await f.invoke('DELETE','/nodes/'+A+'/token',{},true);
    assert.equal(output.status,200); assert.equal(f.c.read().jobs.length,0);
    assert.equal(new Set(f.completed.map(item=>item.id)).size,jobs.length);
    assert.equal(f.completed.length,jobs.length);
    assert.ok(scanned<=jobs.length*8,'batch cancellation repeatedly traversed the whole queue: '+scanned);
    assert.equal(f.disk().jobs.length,0,'credential revocation must persist the cancellation before replying');
  }finally{Array.prototype.filter=originalFilter;f.close();}
});

test('expired work drains in bounded batches, never dispatches, and rechecks a renewed running lease',async()=>{
  const f=await fixture();
  try{
    const now=Date.now(), jobs=Array.from({length:20},()=>job({expiresAt:now-1000}));
    const renewed=jobs[jobs.length-1];renewed.phase='running';renewed.deadlineAt=now+300000;
    await f.seed(jobs);
    await f.c.tick();
    assert.ok(f.completed.length>0&&f.completed.length<=16);
    assert.ok(f.c.read().jobs.length>0,'the whole backlog was drained in one lock');
    const poll=await f.invoke('GET','/workers/node/'+A+'/poll');assert.equal(poll.status,200);assert.equal(poll.body.task,null);
    await f.invoke('POST','/workers/node/'+A+'/heartbeat',{version:'test',tools:['curl'],features:['report-v3','latency-samples'],activeJobIds:[renewed.id]});
    await new Promise(resolve=>setTimeout(resolve,650));await f.c.lock(()=>{});
    assert.equal(f.c.read().jobs.length,1);assert.equal(f.c.read().jobs[0].id,renewed.id);
    assert.ok(!f.completed.some(item=>item.id===renewed.id),'renewed job was expired from an obsolete queue snapshot');
    assert.equal(f.disk().jobs.length,1);
  }finally{f.close();}
});
