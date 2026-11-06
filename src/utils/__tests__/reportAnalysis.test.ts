import { describe, expect, it } from "vitest";
import { buildReport } from "../instanceReport/aggregate";
import { analyzeFullResult } from "../instanceReport/fullResultAnalysis";
import { renderReportHtml } from "../instanceReport/render";
import { resultToolkit } from "../instanceReport/resultToolkit";
import type { ReportInput, ReportFullResult } from "../instanceReport/model";

const start=Date.parse("2026-11-01T00:00:00Z");
const source=():ReportInput=>({schemaVersion:1,reportId:"editorial-test",generatedAt:start+1000,range:{start,end:start+1000,timeZone:"UTC"},theme:"light",showAddresses:false,backend:"official",node:{uuid:"node",name:"香港 / 审阅",fields:[],memory:1000,disk:10000,swap:0,cores:2,ip:[],trafficLimit:10000,trafficRule:"sum",snapshot:{online:true,uptime:500,updatedAt:start+1000,trafficUp:100,trafficDown:200}},sources:[],metrics:[...["cpu","ram","disk"].map(key=>({key,label:key,unit:key==="cpu"?"%":"B",precision:"返回点" as const,points:Array.from({length:5},(_,i)=>({t:start+i*200,v:key==="cpu"?20:key==="ram"?400:5000}))}))],pings:[],network:[]});
const full=():ReportFullResult=>({id:"full:round:job",roundId:"round",module:"tcpquality-full",time:start+900,state:"ok",url:"https://tcpquality.ibsgss.uk/r/test",profile:"AUTO",truncated:false,sections:[]});

describe("evidence-led editorial reports",()=>{
  it("prioritizes the worst observed task without pooling targets or protocols",()=>{
    const input=source();
    input.pings=[{id:1,name:"移动",protocol:"icmp",target:"",interval:60,points:[{t:start,v:40,sent:100,lost:0,valid:100}]},{id:2,name:"电信",protocol:"tcp",target:"",interval:60,points:[{t:start,v:160,sent:100,lost:5,valid:95}]}];
    const a=buildReport(input).analysis!;
    expect(a.focusPingId).toBe(2);expect(a.lines[0]?.loss).toBe(.05);expect(a.lines[1]?.mean).toBe(40);
    expect(a.actions[0]?.title).toContain("电信");expect(a.actions[0]?.verification).toContain("复测");
    expect(a.resource).toBe("已有资源指标未触发规则");
  });
  it("keeps unavailable evidence unknown and never fabricates a favorable conclusion",()=>{
    const input=source();input.metrics=[];input.pings=[{id:1,name:"空任务",protocol:"icmp",target:"",interval:60,points:[]}];
    const model=buildReport(input);
    expect(model.analysis!.resource).toContain("暂无");expect(model.analysis!.lines[0]?.priority).toBe("unknown");expect(model.analysis!.focusPingId).toBeNull();
    const html=renderReportHtml(model);expect(html).toContain("无历史数据 · 仅配置快照");expect(html).toContain("不可计算");
  });
  it("uses latest evidence only within the same method and retains the other method",()=>{
    const input=source();
    const row={module:"tcp-quality",state:"ok",target:"隐藏",targetRef:"测点 1",direction:"VPS→目标",source:"runner",protocol:"tcp"};
    input.network=[{...row,id:"old",time:start,detail:{tcpQuality:{method:"a",failurePercent:20}}},{...row,id:"new",time:start+1,detail:{tcpQuality:{method:"a",failurePercent:0}}},{...row,id:"independent",time:start+2,detail:{tcpQuality:{method:"b",failurePercent:5}}}];
    const actions=buildReport(input).analysis!.actions.filter(a=>a.id.startsWith("observation-"));
    expect(actions).toHaveLength(1);expect(actions[0]?.id).toBe("observation-independent");
  });
  it("ranks repeated Ping evidence ahead of a more recent single-round observation at the same attention level",()=>{
    const input=source();
    input.pings=[{id:1,name:"电信",protocol:"tcp",target:"",interval:60,points:[{t:start,v:160,sent:100,lost:5,valid:95}]}];
    input.network=[{id:"snapshot",module:"tcp-quality",state:"ok",target:"",targetRef:"测点 7",family:"4",direction:"upload",source:"runner",provider:"runner",time:start+900,detail:{failurePercent:10}}];
    const a=buildReport(input).analysis!;
    expect(a.actions[0]?.id).toBe("ping-1");expect(a.title).toContain("电信");expect(a.actions[1]?.title).toContain("TCP 质量 / IPv4 / 测点 7");expect(a.actions[1]?.title).not.toContain("runner");
    const html=renderReportHtml(buildReport(input));expect(html).toContain('data-evidence="network-evidence-snapshot"');expect(html).toContain('id="network-evidence-snapshot"');
  });
  it("does not turn execution failures into a network quality judgment",()=>{
    const input=source();input.network=[{id:"failed",module:"international-speed",time:start,state:"failed",target:"",direction:"download",source:"runner",detail:{state:"failed"}}];
    expect(buildReport(input).analysis!.actions.some(a=>a.chapter==="network")).toBe(false);
  });
  it("reads official CSV dimensions and preserves missing success latency",()=>{
    const result=full();result.sections=[{name:"data",title:"检测",format:"csv",text:'\uFEFF网络,IP版本,省份,运营商,状态,发送,收到,丢包率(%),平均延迟ms,线路\n三网,IPv4,"上海,中国",电信,FAIL,10,0,100,0,CN2\n三网,IPv6,东京,联通,OK,10,10,0,41.5,普通'}];
    const a=analyzeFullResult(result);
    expect(a.rows[0]).toMatchObject({label:"上海,中国 · 电信",latency:null,loss:100,context:"IPv4 · CN2"});expect(a.rows[1]?.latency).toBe(41.5);
    const input=source();input.fullResults=[result];expect(buildReport(input).analysis!.actions[0]?.evidence).toContain("round");
  });
  it("summarizes known NodeQuality fields without flattening secrets or unknown JSON",()=>{
    const result=full();result.module="nodequality-full";
    result.sections=[{name:"hardware_quality.json",title:"硬件",format:"json",text:JSON.stringify({CPU:{model:"EPYC",topology:{threads:2}},Memory:{summary:{total:"4 GB",used_percent:25}},Head:{Command:"SECRET"}})},{name:"ip_quality.json",title:"IP",format:"json",text:'{"truncated":'}];
    const a=analyzeFullResult(result);expect(a.facts.some(f=>f.value==="EPYC")).toBe(true);expect(JSON.stringify(a)).not.toContain("SECRET");expect(a.notes.join()).toContain("不完整");
    const svg=resultToolkit().unified(result,"node","UTC").join("");expect(svg).not.toContain('truncated');expect(svg).toContain("EPYC");
  });
  it("retains full-result-only reports and the optional prior Ping comparison",()=>{
    const input=source();input.metrics=[];input.fullResults=[full()];
    expect(renderReportHtml(buildReport(input))).not.toContain('<h2>无历史数据 · 仅配置快照</h2>');
    input.pings=[{id:1,name:"本期线路",protocol:"tcp",target:"",interval:60,points:[{t:start,v:40,sent:10,lost:0,valid:10}]}];
    input.previous={...source(),range:{start:start-1000,end:start,timeZone:"UTC"},pings:[{...input.pings[0]!,points:[{t:start-1000,v:20,sent:10,lost:0,valid:10}]}]};
    const html=renderReportHtml(buildReport(input));expect(html).toContain("Ping 任务（相同 ID）");expect(html).toContain("20 ms");expect(html).toContain("历史目标与协议配置无法完整校验");
  });
  it("keeps quota snapshot, observed period totals and image appendix distinct",()=>{
    const input=source();input.fullResults=[full()];const model=buildReport(input),html=renderReportHtml(model);
    expect(html).toContain("3 %");expect(html).toContain("期间流量不可计算");
    expect(html.match(/class="chapter"/g)).toHaveLength(6);
    expect(html.indexOf('id="report-original-results"')).toBeGreaterThan(html.indexOf('id="sources" class="chapter"'));
    expect(html).toContain("打开截图附录");expect(html).toContain("原始版 · 测评截图");
  });
});
