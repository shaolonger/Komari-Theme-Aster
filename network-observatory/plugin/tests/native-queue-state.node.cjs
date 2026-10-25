const { test }=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {nativeQueueState,readNativeState,writeNativeState}=require('../src/native-queue-state.js');
const missing=e=>e.code==='ENOENT',node='00000000-0000-4000-8000-000000000001';
const job=(prefix='00',extra={})=>({id:prefix+crypto.randomUUID().slice(2),roundId:crypto.randomUUID(),nodeUuid:node,executor:'node:'+node,operation:'latency',phase:'queued',target:'latency.example.net',options:{reportVersion:3},expiresAt:Date.now()+3600000,...extra});
function fixture(jobs=[job('01'),job('02'),job('03')]){const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-queue-state-')),file=path.join(root,'native-state.json'),legacy={revision:0,jobs,workers:{},provider:{probes:[]}};fs.writeFileSync(file,JSON.stringify(legacy));return {root,file,jobs,store:()=>nativeQueueState(file,missing),pending:path.join(root,'native-queue/pending.json'),close:()=>fs.rmSync(root,{recursive:true,force:true})};}
function bucketWrite(file){return /^[0-9a-f]{2}\.json\.tmp$/.test(path.basename(String(file)));}

test('legacy queue migrates once through an atomic epoch switch and preserves FIFO and private permissions',()=>{
 const f=fixture([job('3f'),job('00'),job('02')]);try{const s=f.store(),state=s.read();assert.deepEqual(state.jobs.map(j=>j.id),f.jobs.map(j=>j.id));s.write(state,{metadata:false});const root=JSON.parse(fs.readFileSync(f.file));assert.deepEqual(root.jobs,[]);assert.equal(root.queueStore.version,1);assert.equal(root.queueStore.buckets,64);assert.deepEqual(readNativeState(f.file).jobs.map(j=>j.id),f.jobs.map(j=>j.id));assert.equal(fs.statSync(f.file).mode&0o777,0o600);assert.ok(!fs.existsSync(f.pending));}finally{f.close();}
});

test('job-only save serializes only the changed bucket and never unchanged large metadata or other jobs',()=>{
 const f=fixture();try{const s=f.store(),state=s.read();s.write(state);const raw=fs.readFileSync(f.file,'utf8');state.provider.probes={toJSON(){throw new Error('serialized unchanged provider');}};state.jobs[2].options={toJSON(){throw new Error('serialized another bucket');}};state.jobs[0].phase='running';s.touchJob(state.jobs[0]);s.write(state,{metadata:false});assert.equal(fs.readFileSync(f.file,'utf8'),raw);assert.equal(readNativeState(f.file).jobs[0].phase,'running');assert.equal(readNativeState(f.file).jobs[2].phase,'queued');}finally{f.close();}
});

for(const stage of ['intent','bucket','metadata'])test('interrupted '+stage+' commit rolls forward all buckets and metadata before a cached reader returns',()=>{
 const f=fixture();const rename=fs.renameSync;try{const reader=f.store(),initial=reader.read();reader.write(initial);const writer=f.store(),state=writer.read();for(const j of state.jobs.slice(0,2)){j.phase='running';writer.touchJob(j);}state.revision=1;let buckets=0,failed=false;fs.renameSync=function(from,to){if(!failed&&((stage==='intent'&&String(to)===f.pending)||(stage==='bucket'&&bucketWrite(from)&&++buckets===2)||(stage==='metadata'&&String(to)===f.file))){failed=true;if(stage==='intent')rename(from,to);throw new Error('injected '+stage+' failure');}return rename(from,to);};assert.throws(()=>writer.write(state),/injected/);fs.renameSync=rename;assert.ok(fs.existsSync(f.pending));const recovered=reader.read();assert.equal(recovered.revision,1);assert.deepEqual(recovered.jobs.map(j=>j.phase),['running','running','queued']);assert.ok(!fs.existsSync(f.pending));assert.deepEqual(readNativeState(f.file).jobs.map(j=>j.id),f.jobs.map(j=>j.id));}finally{fs.renameSync=rename;f.close();}
});

test('failed migration resumes from its complete intent while the old inline root is still authoritative',()=>{
 const f=fixture();const rename=fs.renameSync;try{const s=f.store(),state=s.read();let buckets=0;fs.renameSync=function(from,to){if(bucketWrite(from)&&++buckets===2)throw new Error('migration stop');return rename(from,to);};assert.throws(()=>s.write(state),/migration stop/);fs.renameSync=rename;assert.equal(JSON.parse(fs.readFileSync(f.file)).jobs.length,3);const after=f.store().read();assert.deepEqual(after.jobs.map(j=>j.id),f.jobs.map(j=>j.id));assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).jobs,[]);assert.ok(!fs.existsSync(f.pending));}finally{fs.renameSync=rename;f.close();}
});

test('an uncommitted intent temporary file does not publish changed leases',()=>{
 const f=fixture();const rename=fs.renameSync;try{const s=f.store(),state=s.read();s.write(state);state.jobs[0].phase='running';s.touchJob(state.jobs[0]);fs.renameSync=function(from,to){if(String(to)===f.pending)throw new Error('before intent commit');return rename(from,to);};assert.throws(()=>s.write(state,{metadata:false}),/before intent/);fs.renameSync=rename;assert.ok(fs.existsSync(f.pending+'.tmp'));assert.equal(s.read().jobs[0].phase,'queued');}finally{fs.renameSync=rename;f.close();}
});

test('cross-bucket removals and FIFO additions remain idempotent through a metadata failure',()=>{
 const f=fixture();const rename=fs.renameSync;try{const s=f.store(),state=s.read();s.write(state);s.forgetJob(state.jobs[0]);s.forgetJob(state.jobs[2]);state.jobs=[state.jobs[1],job('04')];state.revision=2;fs.renameSync=function(from,to){if(String(to)===f.file)throw new Error('metadata interrupted');return rename(from,to);};assert.throws(()=>s.write(state),/metadata interrupted/);fs.renameSync=rename;const after=s.read();assert.equal(after.jobs.length,2);assert.equal(after.jobs[0].id,f.jobs[1].id);assert.equal(after.revision,2);const next=job('05');after.jobs.push(next);s.write(after);assert.deepEqual(readNativeState(f.file).jobs.map(j=>j.id),[f.jobs[1].id,after.jobs[1].id,next.id]);}finally{fs.renameSync=rename;f.close();}
});

for(const kind of ['root-version','wal-version','wal-tail','wal-epoch','wal-order'])test('invalid '+kind+' fails closed without deleting the committed evidence',()=>{
 const f=fixture();try{const s=f.store(),state=s.read();s.write(state);const root=JSON.parse(fs.readFileSync(f.file)),raw=fs.readFileSync(f.file,'utf8');if(kind==='root-version'){root.queueStore.version=99;fs.writeFileSync(f.file,JSON.stringify(root));assert.throws(()=>s.read(),/未知队列版本/);assert.equal(JSON.parse(fs.readFileSync(f.file)).queueStore.version,99);return;}
 const tx={version:1,baseEpoch:root.queueStore.epoch,epoch:root.queueStore.epoch,migration:false,changes:[]};if(kind==='wal-version')tx.version=99;if(kind==='wal-epoch')tx.baseEpoch=crypto.randomUUID();if(kind==='wal-order')tx.changes=[{id:state.jobs[0].id,order:1,job:{...state.jobs[0],phase:'running'}}];fs.mkdirSync(path.dirname(f.pending),{recursive:true});const bad=JSON.stringify(tx)+(kind==='wal-tail'?'\n{"partial":':'');fs.writeFileSync(f.pending,bad);assert.throws(()=>s.read());assert.equal(fs.readFileSync(f.file,'utf8'),raw);assert.equal(fs.readFileSync(f.pending,'utf8'),bad);}finally{f.close();}
});

test('explicit fixture replacement clears and rewrites a sharded queue instead of mixing inline snapshots',()=>{
 const f=fixture();try{const s=f.store(),state=s.read();s.write(state);const snapshot=readNativeState(f.file);snapshot.jobs=[];writeNativeState(f.file,snapshot);assert.deepEqual(s.read().jobs,[]);snapshot.jobs=[job('07')];writeNativeState(f.file,snapshot);assert.equal(s.read().jobs[0].id,snapshot.jobs[0].id);}finally{f.close();}
});

test('job-only structural additions, same-length replacements and removals never get falsely marked as synchronized',()=>{
 const f=fixture();try{const s=f.store(),state=s.read();s.write(state);const added=job('08');state.jobs.push(added);s.write(state,{metadata:false});assert.equal(readNativeState(f.file).jobs.length,4);const old=state.jobs[0].id,replacement=job('09');state.jobs[0]=replacement;s.write(state,{metadata:false});let read=readNativeState(f.file);assert.equal(read.jobs.length,4);assert.ok(read.jobs.some(j=>j.id===replacement.id));assert.ok(!read.jobs.some(j=>j.id===old));state.jobs=state.jobs.slice(1);s.write(state,{metadata:false});state.revision++;s.write(state);read=readNativeState(f.file);assert.equal(read.jobs.length,3);assert.ok(!read.jobs.some(j=>j.id===replacement.id));}finally{f.close();}
});

test('a missing committed bucket fails closed instead of silently removing jobs',()=>{
 const f=fixture();try{const s=f.store(),state=s.read();s.write(state);const metadata=JSON.parse(fs.readFileSync(f.file));fs.unlinkSync(path.join(f.root,'native-queue',metadata.queueStore.epoch,'01.json'));assert.throws(()=>f.store().read(),/分片缺失/);assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).jobs,[]);}finally{f.close();}
});

test('queue storage refuses another metadata basename in the same namespace',()=>{
 const f=fixture();try{assert.throws(()=>nativeQueueState(path.join(f.root,'other.json'),missing),/仅支持 native-state/);assert.ok(!fs.existsSync(path.join(f.root,'native-queue')));}finally{f.close();}
});

test('missing root metadata with committed buckets fails closed instead of becoming an empty queue',()=>{
 const f=fixture();try{const s=f.store(),state=s.read();s.write(state);fs.unlinkSync(f.file);assert.throws(()=>f.store().read(),/元数据缺失/);assert.ok(fs.existsSync(path.join(f.root,'native-queue',state.queueStore.epoch)));}finally{f.close();}
});

test('a cached writer cannot downgrade an externally replaced unknown metadata version',()=>{
 const f=fixture();try{const s=f.store(),state=s.read();s.write(state);const root=JSON.parse(fs.readFileSync(f.file));root.queueStore.version=99;const raw=JSON.stringify(root);fs.writeFileSync(f.file,raw);state.revision++;assert.throws(()=>s.write(state),/未知队列版本/);assert.equal(fs.readFileSync(f.file,'utf8'),raw);}finally{f.close();}
});
