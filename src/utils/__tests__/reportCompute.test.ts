import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeReport } from "../instanceReport/compute";
import { buildReport } from "../instanceReport/aggregate";
import { renderReportHtml } from "../instanceReport/render";
import type { ReportInput, ReportModel } from "../instanceReport/model";

const start=Date.parse("2026-11-01T00:00:00Z");
const input=():ReportInput=>({schemaVersion:1,reportId:"offline-report",generatedAt:start+3600000,range:{start,end:start+3600000,timeZone:"UTC"},theme:"light",showAddresses:false,backend:"official",node:{uuid:"offline",name:"离线节点",fields:[],memory:1000,disk:10000,swap:0,cores:1,ip:[],trafficLimit:10000,trafficRule:"sum",snapshot:{online:false,uptime:1200,updatedAt:start-60000,trafficUp:100,trafficDown:200}},sources:[],metrics:[{key:"cpu",label:"CPU",unit:"%",precision:"返回点",points:[{t:start,v:20},{t:start+60000,v:40}]}],pings:[],network:[]});
let workers: TestWorker[];
class TestWorker {
  onmessage: ((event: MessageEvent<{model?:ReportModel;error?:string}>)=>void)|null=null;
  onerror: ((event: ErrorEvent)=>void)|null=null;
  onmessageerror: (()=>void)|null=null;
  postMessage=vi.fn();
  terminate=vi.fn();
  constructor(){workers.push(this);}
}

describe("report computation independent of node connectivity",()=>{
  beforeEach(()=>{workers=[];vi.useFakeTimers();vi.stubGlobal("Worker",TestWorker);});
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
  it("computes historical offline data through the worker and preserves offline provenance",async()=>{
    const value=input(), promise=computeReport(value,new AbortController().signal);
    expect(workers[0]!.postMessage).toHaveBeenCalledWith(value);
    workers[0]!.onmessage!({data:{model:buildReport(value)}} as MessageEvent);
    const model=await promise;
    expect(model.stats.cpu?.mean).toBe(30);expect(model.node.snapshot.online).toBe(false);expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    const html=renderReportHtml(model);expect(html).toContain("节点当前离线 · 历史报告");expect(html).toContain("最后上报缓存");expect(html).toContain("最后上报 uptime");
  });
  it("uses identical statistics when a stale or blocked worker script fails to load",async()=>{
    const value=input(), progress=vi.fn(), promise=computeReport(value,new AbortController().signal,progress), preventDefault=vi.fn();
    workers[0]!.onerror!({preventDefault} as unknown as ErrorEvent);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("兼容模式"));expect(preventDefault).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();expect(await promise).toEqual(buildReport(value));expect(workers).toHaveLength(1);expect(workers[0]!.onmessage).toBeNull();
  });
  it.each(["unsupported","policy"])("works when worker construction is %s",async(reason)=>{
    vi.stubGlobal("Worker",reason==="unsupported"?undefined:class{constructor(){throw new DOMException("Blocked","SecurityError");}});
    const value=input(), promise=computeReport(value,new AbortController().signal);
    await vi.runAllTimersAsync();expect(await promise).toEqual(buildReport(value));
  });
  it("recovers from an unreadable worker response",async()=>{
    const value=input(), promise=computeReport(value,new AbortController().signal);
    workers[0]!.onmessageerror!();await vi.runAllTimersAsync();expect(await promise).toEqual(buildReport(value));
  });
  it("cancels a queued compatibility computation without returning a report",async()=>{
    const controller=new AbortController(), promise=computeReport(input(),controller.signal);
    const rejected=expect(promise).rejects.toThrow("cancelled");
    workers[0]!.onerror!({preventDefault(){}} as ErrorEvent);controller.abort(new Error("cancelled"));
    await vi.runAllTimersAsync();await rejected;expect(workers[0]!.terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps real calculation errors distinct from a worker loading problem",async()=>{
    const progress=vi.fn(), promise=computeReport(input(),new AbortController().signal,progress);
    workers[0]!.onmessage!({data:{error:"Invalid historical input"}} as MessageEvent);
    await expect(promise).rejects.toThrow("Invalid historical input");expect(progress).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it("generates an explicitly empty offline report when no history remains",async()=>{
    const value=input();value.metrics=[];value.node.snapshot={online:false,uptime:null,updatedAt:null};
    const promise=computeReport(value,new AbortController().signal);workers[0]!.onerror!({preventDefault(){}} as ErrorEvent);
    await vi.runAllTimersAsync();const html=renderReportHtml(await promise);
    expect(html).toContain("无历史数据 · 仅配置快照");expect(html).toContain("暂无资源历史可分析");expect(html).toContain("未提供当前累计用量");expect(html).toContain("节点当前离线 · 历史报告");
  });
});
