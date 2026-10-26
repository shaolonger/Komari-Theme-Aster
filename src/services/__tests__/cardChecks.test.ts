import { afterEach, expect, it, vi } from "vitest";
import { cardCheckPercent, getCardChecks, startCardCheck } from "../cardChecks";
const progress = {nodeUuid:"vps",id:"round",module:"routes",family:"6",phase:"queued",state:"running",waitReason:"",suiteName:"方案",
  counts:{expected:9,completed:0,ok:0,partial:0,failed:0,missing:0,cancelled:0}} as const;
afterEach(()=>vi.unstubAllGlobals());
it("starts only the selected VPS/module/address family and propagates plan errors",async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(progress),{status:202})).mockResolvedValueOnce(new Response(JSON.stringify({error:"请先配置 IPv6 方案"}),{status:400}));
 vi.stubGlobal('fetch',fetch);
 expect(await startCardCheck('vps','routes','6')).toMatchObject(progress);
 expect(fetch.mock.calls[0][0]).toBe('/api/aster-network-observatory/v3/nodes/vps/card-check');
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({module:'routes',family:'6'});
 await expect(startCardCheck('vps','routes','6')).rejects.toThrow('请先配置 IPv6 方案');
});
it("batches progress reads and never polls an idle page",async()=>{
 const fetch=vi.fn().mockImplementation((_url,options)=>Promise.resolve(new Response(JSON.stringify({checks:JSON.parse(options.body).checks.map((ref:object)=>({...progress,...ref}))}))));
 vi.stubGlobal('fetch',fetch);
 const signal=new AbortController().signal;
 expect(await getCardChecks([],signal)).toEqual([]);expect(fetch).not.toHaveBeenCalled();
 const refs=Array.from({length:129},(_,i)=>({nodeUuid:'vps-'+i,id:'round-'+i}));
 expect(await getCardChecks(refs,signal)).toHaveLength(129);
 expect(fetch).toHaveBeenCalledTimes(3);
 expect(fetch.mock.calls.map(([,options])=>JSON.parse(options.body).checks.length)).toEqual([64,64,1]);
});
it("uses real completion counts rather than simulated timer progress",()=>{
 expect(cardCheckPercent({...progress})).toBe(0);
 expect(cardCheckPercent({...progress,counts:{...progress.counts,completed:3}})).toBe(33);
 expect(cardCheckPercent({...progress,counts:{...progress.counts,completed:9}})).toBe(99);
 expect(cardCheckPercent({...progress,phase:'finished',state:'failed'})).toBe(100);
});
