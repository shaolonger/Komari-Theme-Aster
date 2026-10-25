// Native queue bookkeeping pressure, isolated from report-file I/O. Store WAL,
// retention and plan fanout have their own real-runtime pressure scenarios.
async function runNativeMaintenancePerformance() {
  const fs = require('fs'), path = require('path'), crypto = require('crypto'), queueState = require('./src/native-queue-state.js');
  const routes = new Map(), token = 'e'.repeat(64), BASE = '/api/aster-network-observatory/v2';
  const nodes = Array.from({length:52}, (_,i) => ({uuid:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),name:'Maintenance load '+i,ipv4:'8.8.8.8',hidden:false}));
  const A = nodes[0].uuid, B = nodes[1].uuid;
  const identities = {nodes:Object.fromEntries(nodes.map(n=>[n.uuid,{tokenHash:crypto.createHash('sha256').update(token).digest('hex')}]))};
  const c = require('./src/native-controller.js').registerNativeController({storageDir:__storageDir__,isMissingFile,
    server:{route:(m,p,f)=>routes.set(m+' '+p,f),call:async()=>nodes},readState:()=>identities,writeState:()=>{},
    authorized:()=>true,readBody:req=>JSON.parse(req.body||'{}'),respond:(res,status,body)=>Object.assign(res,{status,body})});
  await new Promise(resolve=>setTimeout(resolve,30)); await c.lock(()=>{});
  c.roundController.tick=()=>false; c.roundController.publicTick=async()=>{};
  const completed=[];c.roundController.complete=(job,data)=>completed.push({id:job.id,state:data.state});
  c.roundController.progress=()=>{};c.roundController.batch=fn=>fn();
  const check=(value,message)=>{if(!value)throw new Error(message);};
  async function invoke(method,suffix,body={}) {
    const actual=BASE+suffix,key=[...routes.keys()].find(k=>{const parts=k.split(' ');return parts[0]===method&&new RegExp('^'+parts[1].replace(/:[^/]+/g,'[^/]+')+'$').test(actual);});
    check(key,'Route missing: '+actual);const res={};await routes.get(key)({url:actual,headers:{authorization:'Bearer '+token},body:JSON.stringify(body)},res);return res;
  }
  function makeJob(extra={}) {return {id:crypto.randomUUID(),roundId:crypto.randomUUID(),slotId:'native-audit',nodeUuid:A,policyId:'native-audit',reportModule:'international',executor:'node:'+A,operation:'latency',phase:'queued',target:'latency.example.net',source:{provider:'runner'},options:{reportVersion:3,samples:10,port:443},expiresAt:Date.now()+3600000,...extra};}
  async function seed(jobs) {await c.lock(()=>{const s=c.read();s.jobs=jobs;queueState.writeNativeState(path.join(__storageDir__,'native-state.json'),s,isMissingFile);});}
  await seed(Array.from({length:7500},(_,i)=>makeJob({executor:'node:'+nodes[i%nodes.length].uuid,nodeUuid:nodes[i%nodes.length].uuid,phase:'shared'})));
  const originalWrite=fs.writeFileSync;let writes=0,bytes=0;
  fs.writeFileSync=function(file,value,...args){if(String(file).endsWith('native-state.json.tmp')){writes++;bytes+=value.length;}return originalWrite(file,value,...args);};
  const started=Date.now();
  try {
    for(let i=0;i<5;i++)await c.tick();
    check(writes===0,'Unchanged minute tick serialized the entire queue');
    const report={action:'report',state:'waiting',message:'Already at suggested version'};
    for(let i=0;i<52;i++)check((await invoke('POST','/workers/node/'+A+'/maintenance',report)).status===200,'Maintenance report failed');
    check(writes===1,'Unchanged hourly status rewrote the entire queue');
    const statusAt=c.read().updates['node:'+A].at;
    check((await invoke('POST','/workers/node/'+A+'/maintenance',report)).status===200&&c.read().updates['node:'+A].at===statusAt,'Status change timestamp was renewed without a change');
    for(let i=0;i<52;i++)check((await invoke('GET','/workers/node/'+nodes[i].uuid+'/update-policy')).body.busy===false,'Shared pending work blocked maintenance');
    const queue=c.read().jobs;
    queue.some=()=>{throw new Error('Full unrelated queue traversal during update check');};
    check((await invoke('GET','/workers/node/'+A+'/update-policy')).status===200,'Update checks did not use the worker index');
    const listener=makeJob({executor:'probe:'+B,operation:'benchmark',phase:'listening'});queue.push(listener);
    check((await invoke('GET','/workers/node/'+A+'/update-policy')).body.busy===true,'Cross-worker VPS listener was not marked busy');
    const jobs=[];for(let i=0;i<500;i++){const leader=makeJob();jobs.push(leader,makeJob({sharedJobId:leader.id,sharedRoundId:leader.roundId,phase:'shared'}));}
    await seed(jobs);
    check((await invoke('DELETE','/nodes/'+A+'/token')).status===200,'Batch credential cancellation failed');
    check(completed.length===1000&&new Set(completed.map(j=>j.id)).size===1000&&c.read().jobs.length===0,'Batch completion replayed followers or retained cancelled jobs');
    check(queueState.readNativeState(path.join(__storageDir__,'native-state.json'),isMissingFile).jobs.length===0,'Cancellation replied before the queue was durable');
    const elapsed=Date.now()-started;
    console.log('Official Komari native maintenance: 52 workers / 7500 pending targets; idle ticks 0 writes; 53 identical hourly reports 1 write; indexed checks and 1000 shared cancellations:',elapsed,'ms; state writes:',writes,'bytes:',bytes);
    check(elapsed<5000,'Native maintenance exceeded its 5s computation/I/O budget');
    completed.length=0;
    // Restore the synthetic identity after exercising real revocation so the
    // independent lease-renewal scenario still uses an authorized worker.
    identities.nodes[A]={tokenHash:crypto.createHash('sha256').update(token).digest('hex')};
    const now=Date.now(), expired=Array.from({length:20},()=>makeJob({expiresAt:now-1000})),renewed=expired[19];renewed.phase='running';renewed.deadlineAt=now+300000;
    await seed(expired);await c.tick();
    check(completed.length>0&&completed.length<=16&&c.read().jobs.length>0,'Expiry drained the whole backlog in one state lock');
    const expiredPoll=await invoke('GET','/workers/node/'+A+'/poll');
    check(expiredPoll.status===200&&expiredPoll.body.task===null,'An expired queued job was dispatched');
    await invoke('POST','/workers/node/'+A+'/heartbeat',{version:'maintenance-test',tools:['curl'],features:['report-v3','latency-samples'],activeJobIds:[renewed.id]});
    await new Promise(resolve=>setTimeout(resolve,650));await c.lock(()=>{});
    check(c.read().jobs.length===1&&c.read().jobs[0].id===renewed.id&&!completed.some(j=>j.id===renewed.id),'Expiry failed to recheck a heartbeat renewal');
    console.log('Official Komari native maintenance: bounded expiry continuation, no expired dispatch, renewed active lease and durable cancellation passed');
  } finally {fs.writeFileSync=originalWrite;}
  return true;
}
