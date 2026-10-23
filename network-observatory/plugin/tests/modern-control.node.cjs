const { test } = require('node:test'), assert = require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {registerNativeController,BASE}=require('../src/native-controller.js');
const A='c388e74d-a922-4ae1-bd10-1fb30e2e53de';
test('modern credential lifecycle, dual-stack endpoints, sanitized resources and removal of old schedulers/APIs',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aster-control-')),routes=new Map();let identities={nodes:{}};
 try {
  const c=registerNativeController({storageDir:root,isMissingFile:e=>e.code==='ENOENT',server:{route:(m,p,f)=>routes.set(m+' '+p,f),call:async()=>[{uuid:A,name:'VPS',hidden:false,ipv4:'8.8.8.8',ipv6:'2606:4700:4700::1111'}]},authorized:(req,res)=>{if(req.admin)return true;res.status=403;return false;},respond:(res,status,body)=>Object.assign(res,{status,body}),readBody:r=>r.body,readState:()=>identities,writeState:s=>{identities=s;}});
  await new Promise(resolve=>setImmediate(resolve));
  async function invoke(method,suffix,body={},admin=true,token='') {const url=BASE+suffix,key=[...routes.keys()].find(k=>{const [m,p]=k.split(' ');return m===method&&new RegExp('^'+p.replace(/:[^/]+/g,'[^/]+')+'$').test(url)});assert.ok(key,url);const res={};await routes.get(key)({url,body,admin,headers:{authorization:'Bearer '+token}},res);return res;}
  for(const route of routes.keys())assert.ok(!/\/(policies|migration|status$|reports$|config$|run\/)/.test(route),route);
  assert.equal((await invoke('POST',`/nodes/${A}/token`,{},false)).status,403);
  const issued=await invoke('POST',`/nodes/${A}/token`);assert.equal(issued.status,201);const token=issued.body.token;
  assert.equal(identities.nodes[A].tokenHash,crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal((await invoke('POST',`/workers/node/${A}/verify`,{},false,token)).status,200);
  for (const action of ['verify','heartbeat']) {
   const key='POST /api/aster-network-observatory/v1/nodes/:uuid/'+action;
   assert.ok(routes.has(key));
   const response={};await routes.get(key)({url:'/api/aster-network-observatory/v1/nodes/'+A+'/'+action,headers:{authorization:'Bearer '+token}},response);
   assert.equal(response.status,200);
   const rejected={};await routes.get(key)({url:'/api/aster-network-observatory/v1/nodes/'+A+'/'+action,headers:{authorization:'Bearer '+'b'.repeat(64)}},rejected);
   assert.equal(rejected.status,401);
  }
  const catalog=await invoke('GET','/catalog');assert.ok(catalog.body.registeredNodes.includes(A));assert.ok(!JSON.stringify(catalog.body).includes(token));assert.equal(catalog.body.policies,undefined);
  const endpoint=`/workers/node/${A}`,release=catalog.body.runnerRelease;
  assert.equal((await invoke('GET',endpoint+'/update-policy',{},false,token)).body.enabled,false);
  assert.equal((await invoke('PUT',endpoint+'/update-policy',{enabled:true},false)).status,403);
  assert.equal((await invoke('POST',endpoint+'/maintenance',{action:'claim',version:release.version,automatic:true},false,token)).status,409);
  assert.equal((await invoke('PUT',endpoint+'/update-policy',{enabled:true})).status,200);
  assert.equal((await invoke('GET',endpoint+'/update-policy',{},false,token)).body.enabled,true);
  const claim=await invoke('POST',endpoint+'/maintenance',{action:'claim',version:release.version,automatic:true},false,token);assert.equal(claim.status,200);
  assert.equal((await invoke('GET',endpoint+'/poll',{},false,token)).body.task,null);
  assert.equal((await invoke('POST',endpoint+'/maintenance',{action:'claim',version:release.version,automatic:true},false,token)).status,409);
  assert.equal((await invoke('POST',endpoint+'/maintenance',{action:'release',lease:'wrong',state:'ok'},false,token)).status,400);
  assert.equal((await invoke('POST',endpoint+'/maintenance',{action:'release',lease:claim.body.lease,state:'ok',message:'升级成功'},false,token)).status,200);
  assert.equal((await invoke('POST',endpoint+'/verify',{},false,token)).status,200);
  assert.equal((await invoke('GET','/catalog')).body.updates['node:'+A].state,'ok');
  assert.equal((await invoke('POST','/endpoints',{nodeUuid:A,ipv4:'8.8.8.8',ipv6:'2606:4700:4700::1111',port:25201})).status,200);
  assert.equal((await invoke('POST','/endpoints',{nodeUuid:A,address:'8.8.8.8',ipv6:'8.8.8.8',port:25201})).status,400);
  await c.tick();assert.equal(c.read().endpoints[A].ipv6,'2606:4700:4700::1111');
  assert.equal((await invoke('DELETE',`/nodes/${A}/token`)).status,200);
  assert.equal((await invoke('POST',`/workers/node/${A}/verify`,{},false,token)).status,401);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
