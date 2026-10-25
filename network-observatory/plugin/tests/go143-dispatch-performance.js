async function runDispatchPerformance() {
  const fs = require("fs"), path = require("path");
  const { registerReportController } = require("./src/report-controller.js");
  const { normalizeSuite } = require("./src/report-model.js");
  const { ENDPOINTS } = require("./src/report-catalog.js");
  const { nativeQueueState } = require("./src/native-queue-state.js");
  const nodes = Array.from({ length: 52 }, (_, i) => ({ uuid: "00000000-0000-4000-8000-" + String(i).padStart(12, "0"), name: "VPS " + i, publicVisible: true }));
  const suite = (size, module, family, daily) => normalizeSuite({ clients: nodes.slice(0, size).map(n => n.uuid), trafficAccepted: true,
    modules: [{ module, family, publicSources: false, preset: module === "china-speed" ? "china-public" : undefined,
      ...(module === "routes" ? {endpoints:ENDPOINTS.filter(e=>e.category==="china-route" && e.family===family && /电信 163|联通 169|移动 CMNET/.test(e.name)).map(e=>e.id).slice(0,9)} : {}),
      timing: daily ? {type:"daily",times:[family==="4"?"21:00":"22:00"],timezone:"Asia/Shanghai"} : {type:"interval",minutes:60} }] });
  for (const online of [false, true]) {
    const root = path.join(__storageDir__, online ? "online" : "offline"); fs.mkdirSync(root, {recursive:true});
    const s = {revision:0,homeRouteProjectionVersion:3,inventory:nodes,reportDispatch:[],jobs:[],probes:{},workers:{},
      endpoints:Object.fromEntries(nodes.map(n=>[n.uuid,{address:"8.8.8.8",ipv4:"8.8.8.8",ipv6:"2606:4700:4700::1111",port:25201}])),
      provider:{used:0,probes:[]},reportSuites:[suite(40,"international","4"),suite(15,"routes","4"),suite(15,"routes","6"),suite(30,"china-speed","4",true),suite(20,"china-speed","6",true)]};
    if (online) for (const node of nodes) s.workers["node:"+node.uuid]={seenAt:Date.now(),tools:["curl","mtr"],features:["report-v3","latency-samples","full-mtr"]};
    const snapshots=nativeQueueState(path.join(root,"native-state.json"),isMissingFile,()=>s);
    snapshots.read(); snapshots.write(s);
    const native = {read:()=>s,lock:fn=>Promise.resolve().then(fn),save:()=>snapshots.write(s),coverage:()=>"",catalogTick:()=>{}};
    const c=registerReportController({storageDir:root,isMissingFile,server:{route:()=>{}},authorized:()=>true,readBody:()=>({}),respond:()=>{}},native);
    c.tick(s);
    for (const p of s.reportSuites) for (const mod of p.modules) mod.nextAt=Date.now()+(mod.timing.type==="daily"?3600000:-1000);
    let reads=0,writes=0,bytes=0;
    const oldRead=fs.readFileSync,oldWrite=fs.writeFileSync;
    fs.readFileSync=function(file,...args){reads++;return oldRead(file,...args);};
    fs.writeFileSync=function(file,value,...args){writes++;bytes+=String(value).length;return oldWrite(file,value,...args);};
    let cronMs=0,totalMs=0,maxSlice=0,slices=0;
    try {
      let started=Date.now(); if(!c.tick(s))throw new Error("Hourly work was not durably scheduled");native.save(s);cronMs=Date.now()-started;
      if(s.reportDispatch.length!==3||s.reportDispatch.reduce((sum,w)=>sum+w.nodes.length,0)!==70||s.jobs.length)throw new Error("Hourly tick synchronously dispatched all nodes");
      if(writes>2)throw new Error("Hourly tick rewrote per-target history before yielding");
      while(s.reportDispatch.length){
        started=Date.now();const changed=c.dispatchStep(s,{maxSteps:2,maxMs:8});if(changed)native.save(s);
        const elapsed=Date.now()-started;maxSlice=Math.max(maxSlice,elapsed);totalMs+=elapsed;slices++;
        if(slices>100)throw new Error("Scheduled fanout failed to finish");
      }
      if(cronMs>250||maxSlice>500)throw new Error("Scheduled work monopolized the official runtime");
      if(online && !s.jobs.length)throw new Error("Capable workers lost their scheduled measurements");
      console.log("Official Komari scheduled fanout: 52 VPS / 5 plans / 70 hourly members /", online?"online":"missing resources",
        "; cron:",cronMs,"ms; complete fanout:",totalMs,"ms /",slices,"slices; max slice:",maxSlice,
        "ms; reads:",reads,"writes:",writes,"write bytes:",bytes,"pending jobs:",s.jobs.length,"minimum spread:",Math.max(0,slices-1)*500,"ms");
    } finally {fs.readFileSync=oldRead;fs.writeFileSync=oldWrite;}
  }
  return true;
}
