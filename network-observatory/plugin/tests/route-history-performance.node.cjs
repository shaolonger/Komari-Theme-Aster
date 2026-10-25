const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { registerReportController, BASE } = require("../src/report-controller.js");
const A="c388e74d-a922-4ae1-bd10-1fb30e2e53de";
test("large route backfill reads bounded individual measurements, persists completion and reuses it after restart", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"aster-route-backfill-performance-")), originalRead=fs.readFileSync, originalNow=Date.now, originalError=console.error;
  const s={revision:0,inventory:[{uuid:A,publicVisible:true}],homeRouteNodes:[A],jobs:[],reportSuites:[]};
  const handlers=new Map(), uuid=()=>crypto.randomUUID();
  function register() { return registerReportController({storageDir:root,isMissingFile:e=>e.code==="ENOENT",server:{route:(m,p,f)=>handlers.set(m+" "+p,f)},
    authorized:()=>true,readBody:()=>({}),respond:(res,status,body)=>Object.assign(res,{status,body})},{read:()=>s,lock:fn=>Promise.resolve().then(fn),save:()=>{}}); }
  try {
    const index=[], now=Date.now(); let latest;
    for(let r=0;r<75;r++) {
      const id=uuid(),at=new Date(now-r*60000).toISOString(),slots=[];
      const dir=path.join(root,"report-v3","nodes",A,"rounds",id), measurements=path.join(dir,"measurements");fs.mkdirSync(measurements,{recursive:true});
      for(let i=0;i<9;i++) {
        const slotId="route:"+i,jobId=uuid();slots.push({id:slotId,jobId,state:"ok",completedAt:at});
        const result={id:jobId,slotId,roundId:id,nodeUuid:A,operation:"route",direction:"VPS→大陆",target:"example"+i+".net",options:{family:"4",protocol:"tcp"},
          source:{carrier:["电信","联通","移动"][i%3],city:["北京","上海","广州"][Math.floor(i/3)],provider:"fixture"},completedAt:at,data:{kind:"route",state:"ok",complete:true,hops:[{asn:String([4809,9929,58807][i%3])}]}};
        fs.writeFileSync(path.join(measurements,crypto.createHash("sha256").update(slotId).digest("hex")+".json"),JSON.stringify(result));
      }
      fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify({id,nodeUuid:A,module:"routes",plannedAt:at,completedAt:at,slots,detailAvailable:true,state:"complete"}));
      index.push({id,nodeUuid:A,module:"routes",plannedAt:at,completedAt:at,detailAvailable:true,state:"complete"});
      if(!r)latest=id;
    }
    for(const date of new Set(index.map(row=>row.plannedAt.slice(0,10)))) {
      const dir=path.join(root,"report-v3","nodes",A,"indexes","routes");fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,date+".json"),JSON.stringify(index.filter(row=>row.plannedAt.startsWith(date))));
    }
    let reads=0;fs.readFileSync=function(file,...args){if(String(file).includes("/measurements/"))reads++;return originalRead(file,...args);};
    const c=register(),response={};
    await handlers.get("GET "+BASE+"/home-routes")({},response);
    assert.equal(response.status,200);assert.equal(response.body.backfillPending,true);
    assert.ok(reads<=32,"Initial request eagerly read an entire history or round");
    for(let i=0;i<100 && s.homeRouteProjectionVersion!==3;i++)c.recoverRoutesStep();
    assert.equal(s.homeRouteProjectionVersion,3);
    assert.equal(reads,675,"Backfill should visit each retained measurement once");
    const finished={};await handlers.get("GET "+BASE+"/home-routes")({},finished);
    assert.equal(finished.body.backfillPending,false);
    assert.equal(finished.body.nodes[A]["4"][0].return.reportId,latest);
    const persisted=JSON.parse(fs.readFileSync(path.join(root,"home-routes",A+".json"),"utf8"));assert.equal(persisted._projectionVersion,3);
    const restartedController=register();reads=0;const restarted={};await handlers.get("GET "+BASE+"/home-routes")({},restarted);
    assert.equal(reads,0);assert.equal(restarted.body.backfillPending,false);
    const measurement=restartedController.store.measurement;let failed=false;
    restartedController.store.measurement=function(...args){if(!failed){failed=true;throw new Error("temporary detail read failure");}return measurement(...args);};
    console.error=()=>{};
    const forced={};await handlers.get("POST "+BASE+"/home-routes/rebuild")({},forced);
    assert.equal(failed,true);assert.equal(forced.body.backfillPending,true,"A previously completed node must retain its failed explicit rebuild");
    restartedController.store.measurement=measurement;
    const retryTime=originalNow()+61000;Date.now=()=>retryTime;
    let done={};
    for(let i=0;i<100;i++){
      restartedController.recoverRoutesStep();done={};await handlers.get("GET "+BASE+"/home-routes")({},done);
      if(!done.body.backfillPending)break;
    }
    assert.equal(done.body.backfillPending,false);
    assert.equal(reads,675,"Retry skipped or reread the failed row/slot");
    assert.equal(done.body.nodes[A]["4"][0].return.reportId,latest);
  } finally {Date.now=originalNow;console.error=originalError;fs.readFileSync=originalRead;fs.rmSync(root,{recursive:true,force:true});}
});
