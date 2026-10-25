// 52 VPS: 40×12 international, 15×9 IPv4 routes, 15×9 IPv6 routes.
// All measurements and report I/O are synthetic; no outbound probe is run.
async function runQueueStatePerformance(){
 const fs=require('fs'),path=require('path'),crypto=require('crypto'),R=require('./src/report-model.js'),C=require('./src/report-catalog.js'),Q=require('./src/native-queue-state.js');
 const routes=new Map(),token='e'.repeat(64),nodes=Array.from({length:52},(_,i)=>({uuid:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),name:'Real-scale '+i,ipv4:'8.8.8.8',hidden:false}));
 const identities={nodes:Object.fromEntries(nodes.map(n=>[n.uuid,{tokenHash:crypto.createHash('sha256').update(token).digest('hex')}]))};
 const c=require('./src/native-controller.js').registerNativeController({storageDir:__storageDir__,isMissingFile,
 server:{route:(m,p,f)=>routes.set(m+' '+p,f),call:async()=>nodes},readState:()=>identities,authorized:()=>true,readBody:r=>JSON.parse(r.body||'{}'),respond:(res,status,body)=>Object.assign(res,{status,body}),enrichmentOptions:{fetch:()=>{throw new Error('No outbound measurement allowed in this synthetic benchmark');}}});
 c.roundController.tick=()=>false;c.roundController.publicTick=async()=>{};c.roundController.complete=()=>({});c.roundController.progress=()=>{};c.roundController.batch=f=>f();await new Promise(resolve=>setTimeout(resolve,30));await c.lock(()=>{});
 var jobs=await c.lock(()=>{
 const s=c.read();for(const n of nodes){s.endpoints[n.uuid]={ipv4:'8.8.8.8',ipv6:'2606:4700:4700::1111',address:'8.8.8.8',port:25201};s.workers['node:'+n.uuid]={seenAt:Date.now(),version:'test',tools:['curl','mtr','traceroute'],features:['report-v3','latency-samples','full-mtr'],authScheme:'unavailable'};}
 const list=[];
 for(const config of [{count:40,start:0,module:'international',preset:'international-basic',family:'4'}, {count:15,start:0,module:'routes',preset:'china-routes',family:'4'}, {count:15,start:15,module:'routes',preset:'china-routes',family:'6',endpoints:C.ENDPOINTS.filter(e=>e.uses.includes('route')&&e.family==='6').slice(0,9).map(e=>e.id)}]){
 const clients=nodes.slice(config.start,config.start+config.count).map(n=>n.uuid),suite=R.normalizeSuite({clients,modules:[{module:config.module,preset:config.preset,family:config.family,endpoints:config.endpoints,publicSources:false}]});
 for(const id of clients)list.push(...R.planSlots(s,suite,suite.modules[0],id,crypto.randomUUID()).jobs);
 }
 s.jobs=list;Q.writeNativeState(path.join(__storageDir__,'native-state.json'),s,isMissingFile);return list.length;
 });
 const initial=Q.readNativeState(path.join(__storageDir__,'native-state.json'),isMissingFile),initialSize=Buffer.from(JSON.stringify(initial),'utf8').length,wr=fs.writeFileSync;let writes=0,bytes=0,metadataWrites=0;
 c.read().provider.probes={toJSON(){throw new Error('Job-only commit serialized unchanged provider metadata');}};
 fs.writeFileSync=function(file,value,...args){if(String(file).startsWith(__storageDir__)){writes++;bytes+=Buffer.from(String(value),'utf8').length;if(String(file).endsWith('native-state.json.tmp'))metadataWrites++;}return wr(file,value,...args);};
 const started=Date.now();var done=0;
 try {
 while(c.read().jobs.length){
 const j=c.read().jobs[0],node=j.executor.slice(5),res={};
 await routes.get('GET /api/aster-network-observatory/v2/workers/node/:id/poll')({url:'/api/aster-network-observatory/v2/workers/node/'+node+'/poll',headers:{authorization:'Bearer '+token}},res);
 if(res.status!==200||!res.body.task)throw new Error('Missing claim '+JSON.stringify(res));
 const task=res.body.task,reply={},data={kind:task.operation==='route'?'route':'latency',state:'failed',diagnostic:'Synthetic native persistence benchmark; no probe was executed'};
 if(data.kind==='latency')data.tcpQuality={method:'TCP connect',address:'8.8.8.8',state:'ok',sent:10,received:10,failurePercent:0,avgMs:2,medianMs:2,minMs:2,maxMs:2,stdevMs:0,samples:Array.from({length:10},(_,i)=>({index:i+1,state:'ok',rttMs:2,address:'8.8.8.8',error:''}))};
 await routes.get('POST /api/aster-network-observatory/v2/workers/node/:id/result')({url:'/api/aster-network-observatory/v2/workers/node/'+node+'/result',headers:{authorization:'Bearer '+token},body:JSON.stringify({id:task.id,data})},reply);
 if(reply.status!==200)throw new Error('Result rejected '+JSON.stringify(reply));done++;
 }
 const elapsed=Date.now()-started;
 console.log('Official Komari queue-state active load:',JSON.stringify({workers:52,jobs,done,elapsedMs:elapsed,queueWrites:writes,queueWriteBytes:bytes,metadataWrites,initialQueueBytes:initialSize}));
 if(jobs!==750||done!==750||metadataWrites!==0||bytes>20*1024*1024||elapsed>5000)throw new Error('750-target active queue exceeded its transaction byte/time/metadata budget');
 if(Q.readNativeState(path.join(__storageDir__,'native-state.json'),isMissingFile).jobs.length!==0)throw new Error('Completed queue was not durable');
 } finally {fs.writeFileSync=wr;}
 return true;
}
