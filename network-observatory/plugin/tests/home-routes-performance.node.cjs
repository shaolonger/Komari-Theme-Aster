const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { homeRouteStore } = require("../src/home-routes.js");
const { registerReportController, BASE } = require("../src/report-controller.js");
const A = "c388e74d-a922-4ae1-bd10-1fb30e2e53de", DAY = 86400000;
function sample(at, data = {}) {
  return { nodeUuid:A,roundId:crypto.randomUUID(),operation:"route",direction:"VPS→大陆",target:"example.net",source:{carrier:"电信",city:"北京",provider:"fixture"},
    options:{family:"4",protocol:"tcp"},completedAt:new Date(at).toISOString(),data:{kind:"route",state:"ok",complete:true,hops:[{asn:"4809"}],...data} };
}
test("shared card summaries avoid repeated parsing and expire exactly at stale/retention boundaries", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"aster-route-summary-cache-")), parse=Date.parse;
  let now=parse("2026-10-24T12:00:00Z"), parses=0;
  const store=homeRouteStore(root,e=>e.code==="ENOENT",()=>now), start=now;
  try {
    store.observe(sample(now));
    now=start+DAY-1;
    assert.equal(store.summary([A])[A]["4"][0].return.state,"ok");
    Date.parse=function(value){parses++;return parse(value);};
    for(let i=0;i<100;i++) assert.equal(store.summary([A])[A]["4"][0].return.label,"CN2");
    assert.equal(parses,0,"A warm summary repeated network aggregation");
    now=start+DAY+1;
    assert.equal(store.summary([A])[A]["4"][0].return.state,"stale");
    now=start+7*DAY+1;
    assert.equal(store.summary([A])[A]["4"][0].return,null);
    store.observe(sample(now,{hops:[{asn:"4134"}]}));
    assert.equal(store.summary([A])[A]["4"][0].return.label,"163");
    now=start; // a corrected system clock must not reuse a future aggregation.
    assert.equal(store.summary([A])[A]["4"][0].return.state,"ok");
  } finally {Date.parse=parse;fs.rmSync(root,{recursive:true,force:true});}
});
test("public diagnostic redaction never mutates the cached administrator evidence", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"aster-route-cache-redaction-"));
  try {
    const store=homeRouteStore(root,e=>e.code==="ENOENT");
    store.observe(sample(Date.now(),{state:"failed",diagnostic:"private endpoint 10.0.0.1",hops:[]}));
    const routes=new Map(),s={revision:0,homeRouteProjectionVersion:3,inventory:[{uuid:A,publicVisible:true}],homeRouteNodes:[A],jobs:[],reportSuites:[]};
    registerReportController({storageDir:root,isMissingFile:e=>e.code==="ENOENT",server:{route:(m,p,f)=>routes.set(m+" "+p,f)},authorized:()=>true,readBody:()=>({}),respond:(res,status,body)=>Object.assign(res,{status,body})},
      {read:()=>s,lock:fn=>Promise.resolve().then(fn),save:()=>{}});
    const publicResponse={},adminResponse={};
    await routes.get("GET "+BASE+"/public/routes")({},publicResponse);
    assert.equal(publicResponse.body.nodes[A]["4"][0].return.diagnostic,"");
    await routes.get("GET "+BASE+"/home-routes")({},adminResponse);
    assert.equal(adminResponse.body.nodes[A]["4"][0].return.diagnostic,"private endpoint 10.0.0.1");
    assert.ok(!JSON.stringify(publicResponse.body).includes("10.0.0.1"));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("failed route recovery marker writes never leave a completed flag only in memory", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"aster-route-marker-failure-")),rename=fs.renameSync;
  try {
    const store=homeRouteStore(root,e=>e.code==="ENOENT");store.observe(sample(Date.now()));
    fs.renameSync=function(){throw new Error("injected marker write failure");};
    assert.throws(()=>store.markHistoryRecovered(A),/injected/);
    assert.equal(store.isHistoryRecovered(A),false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,"home-routes",A+".json"),"utf8"))._projectionVersion,undefined);
    fs.renameSync=rename;store.markHistoryRecovered(A);
    assert.equal(store.isHistoryRecovered(A),true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,"home-routes",A+".json"),"utf8"))._projectionVersion,3);
  } finally {fs.renameSync=rename;fs.rmSync(root,{recursive:true,force:true});}
});
