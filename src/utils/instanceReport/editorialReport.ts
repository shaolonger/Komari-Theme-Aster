import type { EvidenceValue, ReportModel } from "./model";
import { CHAPTERS, METRIC_FIELDS } from "./model";
import { analyzeReport } from "./insights";
import { analyzeFullResult } from "./fullResultAnalysis";
import { computeTrafficUsed, trafficTypeLabel } from "../traffic";
import { escapeHtml as e, formatReportValue as f, safeJson } from "./reportFormat";
import { fullResultGallery, reportModuleLabels, trendExplorer } from "./visuals";
import { reportCss } from "./reportCss";
import { readerRuntime } from "./readerRuntime";
import { resultReaderRuntime } from "./resultReaderRuntime";
import { resultToolkit } from "./resultToolkit";
import xtermRuntime from "@xterm/xterm/lib/xterm.js?raw";
import xtermLicense from "@xterm/xterm/LICENSE?raw";

const note=(text:string)=>`<p class="report-note">${e(text)}</p>`;
const table=(heads:string[],rows:(string|number)[][])=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th scope="col">${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${e(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const object=(v:EvidenceValue|undefined):Record<string,EvidenceValue>=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const metric=(label:string,value:string,detail:string,tone="")=>`<div class="report-metric ${tone}"><span>${e(label)}</span><strong>${e(value)}</strong><small>${e(detail)}</small></div>`;
const section=(id:string,title:string,context="")=>`<div class="section-heading"><h3><span>${e(id)}</span>${e(title)}</h3>${context?`<small>${e(context)}</small>`:""}</div>`;
const details=(title:string,body:string)=>`<details class="technical-details"><summary>${e(title)}</summary>${body}</details>`;
const definition=(rows:[string,string][])=>`<dl class="report-definitions">${rows.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value||"未提供")}</dd></div>`).join("")}</dl>`;
const track=(pct:number,tone="")=>`<div class="report-track ${tone}" role="img" aria-label="${e(pct.toFixed(1))}%"><span style="width:${Math.max(0,Math.min(100,pct))}%"></span></div>`;

export function renderReportHtml(input: ReportModel) {
  const model={...input,analysis:input.analysis||analyzeReport(input)};
  const a=model.analysis;
  const date=(t:number|null|undefined,short=false)=>t!=null&&Number.isFinite(t)?new Intl.DateTimeFormat("zh-CN",{timeZone:model.range.timeZone,year:short?undefined:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(t):"未提供";
  const field=(key:string)=>model.node.fields.find(([k])=>k===key)?.[1]||"未提供";
  const span=model.range.end-model.range.start;
  const coverage=(key:string)=>model.stats[key]?model.stats[key]!.coveredMs/span*100:null;
  const chart=(key:string,title:string,caption="",attributes="")=>`<figure ${attributes}><figcaption>${e(title)}</figcaption><div class="chart" data-chart="${e(key)}"><p class="report-note">图表正在准备</p></div>${caption?`<p class="chart-caption">${e(caption)}</p>`:""}</figure>`;
  const has=(key:string)=>model.metrics.some(m=>m.key===key&&m.points.some(p=>p.v!=null));
  const value=(key:string,which:"mean"|"max"|"last"="mean")=>f(model.stats[key]?.[which],model.metrics.find(m=>m.key===key)?.unit||"");
  const history=model.metrics.some(m=>m.points.some(p=>p.v!=null))||model.pings.some(p=>p.points.length)||model.network.length>0||Boolean(model.fullResults?.length);
  const percent=(key:string,capacity:number)=>model.stats[key]?.mean!=null&&capacity>0?f(model.stats[key]!.mean!/capacity*100,"%"):"—";
  const focus=model.pings.find(p=>p.id===a.focusPingId);
  const priorityLabel={review:"优先复测",watch:"持续观察",info:"资料核对"};
  const button=(chapter:string,label:string,target="",pingId="")=>`<button type="button" class="report-link" data-jump="${e(chapter)}"${target?` data-evidence="${e(target)}"`:""}${pingId?` data-ping-evidence="${e(pingId)}"`:""}>${e(label)} →</button>`;
  const snapshot=model.node.snapshot;
  const quotaKnown=typeof snapshot.trafficUp==="number"&&typeof snapshot.trafficDown==="number";
  const quotaUsed=quotaKnown?computeTrafficUsed(model.node.trafficRule,snapshot.trafficUp!,snapshot.trafficDown!):null;
  const quotaPct=quotaUsed!=null&&model.node.trafficLimit>0?quotaUsed/model.node.trafficLimit*100:null;
  const peakNetwork=a.lines.find(l=>l.sent>0);
  const latestFull=[...new Map([...(model.fullResults||[])].sort((x,y)=>x.time-y.time).map(r=>[r.module,r])).values()];
  const context=[field("地区"),field("虚拟化"),`${model.node.cores||"—"} vCPU`,f(model.node.memory||null,"B"),f(model.node.disk||null,"B")].filter(s=>s!=="未提供"&&s!=="未知").join(" / ");
  const primary=a.actions.find(action=>action.priority!=="info");

  const overview=`<div class="executive-intro"><p class="eyebrow">EXECUTIVE SUMMARY</p><h2>${e(history?a.title:"无历史数据 · 仅配置快照")}</h2><p>${e(a.detail)}</p></div>
    <div class="report-metrics">${metric("资源压力 / CPU 期间均值",value("cpu"),`返回点最高 ${value("cpu","max")}`)}${metric(peakNetwork?`${peakNetwork.label} / 失败探测`:"网络探测 / 可见任务",peakNetwork?f(peakNetwork.loss==null?null:peakNetwork.loss*100,"%"):String(model.pings.length),peakNetwork?`${peakNetwork.protocol} · ${peakNetwork.sent.toLocaleString()} 次样本`:"连续探测与单次检测独立解释",peakNetwork?.priority==="review"?"is-alert":"")}${metric("套餐用量 / 生成时快照",quotaPct==null?"未提供":f(quotaPct,"%"),quotaUsed==null?"当前累计计数器未提供":`${f(quotaUsed,"B")} / ${model.node.trafficLimit>0?f(model.node.trafficLimit,"B"):"未配置上限"}`)}</div>
    ${primary?`<aside class="priority-callout ${primary.priority}"><span>${e(priorityLabel[primary.priority])} / 首要事项</span><h3>${e(primary.title)}</h3><p>${e(primary.observation)}</p>${button("events","查看建议与验证步骤")}</aside>`:note("已有观测未触发当前关注规则；覆盖不足或未采集的部分仍为未知。")}
    ${section("01","关键证据",focus?`${focus.name} / ${focus.protocol}`:"所选期间的资源返回点")}
    ${focus?chart(`ping:${focus.id}`,`${focus.name} · 成功探测时延`,"成功样本加权；失败探测另计，缺测处断开。",'class="report-focus-chart"'):has("cpu")?chart("cpu","CPU 期间变化","只描述实际返回点，不推断瞬时峰值。",'class="report-focus-chart"'):note("当前没有足够的连续数据绘制关键趋势。")}
    <p class="report-provenance">资源采集估计覆盖 ${f(coverage("cpu"),"%")} / ${model.pings.length} 个独立 Ping 任务 / ${model.fullResults?.length||0} 份完整检测结果</p>
    <div class="appendix-entry"><strong>TcpQuality / NodeQuality 测评截图</strong><span>按轮次选择，保留原报告与高清整图。</span>${button("sources","打开截图附录")}</div>`;

  const resourceRows=model.metrics.filter(m=>!m.key.startsWith("net_")&&!m.key.startsWith("traffic_delta"));
  const resourceCore=["cpu","ram"].filter(has);
  const secondaryResources=resourceRows.filter(m=>!resourceCore.includes(m.key));
  const resources=`
    <div class="report-metrics">${metric("CPU / 期间平均",value("cpu"),`返回点最高 ${value("cpu","max")}`)}${metric("内存 / 期间平均",percent("ram",model.node.memory),`${value("ram")} / 当前 ${f(model.node.memory||null,"B")}`)}${metric("磁盘 / 历史最后返回值",value("disk","last"),`当前容量 ${f(model.node.disk||null,"B")}`)}</div>
    <div class="resource-core">${resourceCore.map((key,i)=>section(String(i+1).padStart(2,"0"),key==="cpu"?"CPU 使用变化":"内存容量与使用变化",model.metrics.find(m=>m.key===key)?.precision||"")+chart(key,key==="cpu"?"CPU 使用率":"内存使用量",key==="ram"?"容量分母为生成时配置，不能还原历史扩容。":"返回点或聚合桶均值，不能当作原始瞬时峰值。",`id="resource-${key}"`)).join("")||note("所选期间没有 CPU 或内存有效观测。")}</div>
    ${section("03","稳定性与容量补充")}
    <div class="resource-capacity"><div><span>CPU 估计采集覆盖</span><strong>${f(coverage("cpu"),"%")}</strong></div>${coverage("cpu")==null?note("没有足够观测估计覆盖。"):track(coverage("cpu")!,"is-teal")}<p>缺口 ${f((model.stats.cpu?.gaps.reduce((s,g)=>s+g.end-g.start,0)||0)/60000,"分钟")}；采集覆盖不等于在线率。</p></div>
    ${definition([["生成时状态",snapshot.online==null?"未知":snapshot.online?"在线":"离线"],["生成时 uptime",snapshot.uptime==null?"未提供":f(snapshot.uptime/86400,"天")],["历史在线率","不可计算：缺少可靠历史事件"],["当前磁盘容量",f(model.node.disk||null,"B")]])}
    ${secondaryResources.length?details("GPU、负载、磁盘、Swap 与连接数等补充趋势",`<div class="charts">${secondaryResources.map(m=>chart(m.key,m.label,m.precision,`id="resource-${e(m.key)}"`)).join("")}</div>`):""}
    ${details("完整资源统计与采集缺口",table(["指标","有效点","加权均值","最高返回点","返回点 P95","估计覆盖"],resourceRows.map(m=>[m.label,model.stats[m.key]?.count||0,f(model.stats[m.key]?.mean,m.unit),f(model.stats[m.key]?.max,m.unit),f(model.stats[m.key]?.p95,m.unit),f(coverage(m.key),"%")]))+table(["未知时段开始","结束","分钟"],(model.stats.cpu?.gaps||[]).map(g=>[date(g.start),date(g.end),f((g.end-g.start)/60000)])))}
    ${note("资源高值、缺测与当前 uptime 不能单独证明故障根因；历史在线率与 SLA 未计算。")}`;

  const sampledLines=a.lines.filter(row=>row.sent>0||row.mean!=null);
  const lineMatrix=sampledLines.length?`<div class="table-wrap line-matrix"><table><thead><tr><th>线路 / 协议</th><th>成功时延均值</th><th>失败探测</th><th>样本量</th><th>观察</th></tr></thead><tbody>${sampledLines.slice(0,12).map(row=>`<tr class="${row.priority}" id="ping-evidence-${row.id}"><th scope="row">${e(row.label)}<small>${e(row.protocol)}</small></th><td>${e(f(row.mean,"ms"))}</td><td>${e(f(row.loss==null?null:row.loss*100,"%"))}</td><td>${row.sent.toLocaleString()}</td><td>${e({review:"优先复测",watch:"持续观察",clear:"未触发规则",unknown:"证据不足"}[row.priority])}</td></tr>`).join("")}</tbody></table></div>`:note("当前没有可读的连续 Ping 任务，下面的单次检测仍可独立参考。");
  const fullSummaries=latestFull.map(result=>{
    const summary=analyzeFullResult(result), lossRows=summary.rows.filter(row=>row.loss!=null), flagged=lossRows.filter(row=>row.loss!>=3);
    const domainRows=[...new Set(summary.facts.map(f=>f.group))];
    return `<section class="snapshot-summary"><header><h4>${result.module==="tcpquality-full"?"TcpQuality":"NodeQuality"} / 最新一轮</h4><time>${e(date(result.time))}</time></header>${summary.rows.length?`<strong>${summary.rows.length} 个可解析测点，${flagged.length} 个达到关注规则</strong>${table(["测点 / 地址族","成功时延","失败 / 丢包"],(flagged.length?flagged:summary.rows).slice(0,4).map(row=>[`${row.label} ${row.context}`,f(row.latency,"ms"),f(row.loss,"%")]))}`:`<strong>${domainRows.length?domainRows.join("、"):"本轮保留原始测评内容"}</strong>${definition(summary.facts.slice(0,4).map(fact=>[fact.label,fact.value]))}`}<p>单次测评快照，与持续 Ping 不合并平均。${result.truncated?"保存内容不完整，未解析部分不补造。":""}</p>${button("sources","查看本轮测评图与原报告")}</section>`;
  }).join("");
  const latestTrends=model.networkTrends.map((trend,index)=>({trend,index})).filter(({trend})=>trend.kind==="number"&&trend.points.some(p=>p.v!=null)).sort((x,y)=>(y.trend.points.at(-1)?.t||0)-(x.trend.points.at(-1)?.t||0));
  const recentNetwork=latestTrends.slice(0,6).map(({trend})=>{const point=trend.points.findLast(p=>p.v!=null);return [trend.title,point?f(point.v,trend.unit):"未提供",point?date(point.t):"未提供"]});
  const network=`
    ${section("01","持续线路体验对照","所选期间 / 各任务独立统计")}${lineMatrix}${sampledLines.length<a.lines.length?note(`${a.lines.length-sampledLines.length} 个任务在本期没有可用样本，未参与结论；完整索引保留在附录。`):""}${a.lines.length>12?note(`正文显示优先级靠前的 12 个任务；全部 ${a.lines.length} 个任务的统计在附录保留。`):""}
    ${focus?section("02","时延与失败探测按同一时间轴查看",`${focus.name} / ${focus.protocol}`)+`<label class="ping-picker no-print">探测任务<select data-ping-picker>${a.lines.map(row=>`<option value="${row.id}"${row.id===focus.id?" selected":""}>${e(row.label)} / ${e(row.protocol)}</option>`).join("")}</select></label><div class="ping-charts aligned-charts">${chart(`ping:${focus.id}`,`${focus.name} · 成功时延`,"仅统计成功探测样本。",'id="report-ping-latency" data-report-ping="latency"')}${chart(`ping-loss:${focus.id}`,`${focus.name} · 失败比例`,"失败 / 总样本；无样本时保留缺测。",'data-report-ping="loss"')}</div>`:latestTrends[0]?chart(`network:${latestTrends[0].index}`,latestTrends[0].trend.title,"单次检测的历史返回值；每个测点、方向、协议分别解释。"):""}
    ${section("03","单次检测补充","原报告、完整截图与历史轮次均在附录")}${fullSummaries?`<div class="snapshot-grid">${fullSummaries}</div>`:note("所选期间没有可读的 TcpQuality / NodeQuality 完整结果。")}
    ${recentNetwork.length?details("近期独立测点观测与速率补充",table(["测点 / 方法 / 方向","最近观测值","时间"],recentNetwork)):""}
    ${details("深入查看网络观测历史趋势",trendExplorer(model))}
    ${note("关注规则：失败率达到 3% 优先复测，1% 至 3% 持续观察；这不是通用服务等级承诺。中间跳丢包需终点证据确认。")}`;

  const totalTraffic=model.traffic.up!=null&&model.traffic.down!=null?f(model.traffic.up+model.traffic.down,"B"):"—";
  const traffic=`
    <div class="report-metrics">${metric("本期已观测流量",totalTraffic,"累计计数器差分 / 上传与下载合计")}${metric("VPS 上传",f(model.traffic.up,"B"),"发往外部")}${metric("VPS 下载",f(model.traffic.down,"B"),"从外部接收")}</div>
    ${section("01","每日上传与下载的用量构成","蓝色 ↓ 下载 / 青色 ↑ 上传")}${model.traffic.daily.length?chart("traffic-daily","每日已观测流量","跨午夜增量归入后一观测日；不是自然日账单。"):note("样本不足，无法恢复每日用量。")}
    ${section("02","当前套餐额度","生成时快照 / 与所选报告期间独立")}
    <div class="quota-summary"><div><strong>${quotaUsed==null?"未提供当前累计用量":e(f(quotaUsed,"B"))}</strong><span>/ ${model.node.trafficLimit>0?e(f(model.node.trafficLimit,"B")):"未配置上限"}</span><b>${quotaPct==null?"—":e(f(quotaPct,"%"))}</b></div>${quotaPct!=null?track(quotaPct):""}<p>${e(trafficTypeLabel(model.node.trafficRule))}；剩余额度 ${quotaUsed!=null&&model.node.trafficLimit>0?e(f(Math.max(0,model.node.trafficLimit-quotaUsed),"B")):"无法计算"}。计费周期及账单以供应商为准。</p></div>
    ${section("03","资产与续费","生成时配置，不推断实际支出")}${definition([["当前配置",`${model.node.cores||"—"} vCPU / ${f(model.node.memory||null,"B")} / ${f(model.node.disk||null,"B")}`],["厂商 / 地区",`${field("厂商")} / ${field("地区")}`],["续费配置",field("续费配置")],["到期",field("到期")]])}
    ${details("流量质量与完整配置资料",note(`计数器回退 ${model.traffic.resets} 次；${model.traffic.partial?"边界或采集不完整，已观测量可能低估。":"边界完整。"}`)+table(["归属日期","上传","下载"],model.traffic.daily.map(row=>[row.date,f(row.up,"B"),f(row.down,"B")]))+definition(model.node.fields))}
    ${details("速率与后端上报增量",`<div class="charts">${model.metrics.filter(m=>["net_in","net_out"].includes(m.key)||m.key.startsWith("traffic_delta")).map(m=>chart(m.key,m.label,m.precision)).join("")}</div>`+note("后端上报增量或其聚合均值不直接相加为期间总量，避免重复统计。"))}`;

  const actionMarkup=a.actions.slice(0,3).map((action,i)=>`<section class="action-block ${action.priority}" id="action-${i+1}"><div class="action-priority">A${i+1} / ${e(priorityLabel[action.priority])}${action.time!=null?`<time>${e(date(action.time))}</time>`:""}</div><h3>${e(action.title)}</h3>${definition([["观察",action.observation],["证据",action.evidence],["建议",action.recommendation],["验证方式",action.verification]])}${button(action.id.startsWith("full-")||action.id.startsWith("observation-")?"sources":action.chapter,"查看对应证据",action.id.startsWith("full-")?"report-original-results":action.id.startsWith("observation-")?`network-evidence-${action.id.slice(12)}`:action.id.startsWith("resource-")?action.id:action.id.startsWith("ping-")?"report-ping-latency":"",action.id.startsWith("ping-")?action.id.slice(5):"")}</section>`).join("");
  const events=`<p class="chapter-conclusion">按观测影响排序，逐项验证后再调整。</p><p class="report-note">每项建议都有证据与验证方式；没有足够数据时保留为未知。</p>${actionMarkup||note("已有输入未触发当前关注规则。建议继续保留同口径观测，并关注数据覆盖。")} ${a.actions.length>3?details(`其余 ${a.actions.length-3} 条观察`,table(["观察","证据","建议"],a.actions.slice(3).map(x=>[x.title,x.evidence,x.recommendation]))):""}${note("本报告没有业务日志或服务级探测时，不会直接断定故障根因。")}`;

  const priorityEvidence=new Set(a.actions.slice(0,3).filter(action=>action.id.startsWith("observation-")).map(action=>action.id.slice(12)));
  const evidenceDetails=model.network.filter(row=>!["tcpquality-full","nodequality-full"].includes(row.module)).filter((row,index)=>index<100||priorityEvidence.has(row.id));
  const technicalNetwork=details("完整网络测量证据",`${model.network.length>100?note("此处保留最近 100 条及首要事项关联证据，全部已采集输入保留在报告 JSON 中。"):""}${evidenceDetails.map(row=>`<details id="network-evidence-${e(row.id)}"><summary>${e(reportModuleLabels[row.module]||row.module)} / ${e(date(row.time))} / ${e(row.id)}</summary>${definition([["状态",row.state],["测点",[row.city,row.carrier,row.protocol,row.direction].filter(Boolean).join(" / ")],["来源",row.source],["目标",row.target||"未提供"]])}<pre>${e(JSON.stringify(object(row.detail),null,2))}</pre></details>`).join("")}`);
  const comparison=model.previous&&model.previousStats?details("前一等长区间比较",note("仅当两期精度一致、覆盖充分且读取未受限时计算变化；不能还原的历史配置不强行比较。")+table(["指标","本期均值","前期均值","可比变化"],model.metrics.map(m=>{const current=model.stats[m.key],prior=model.previousStats?.[m.key],previousMetric=model.previous?.metrics.find(x=>x.key===m.key);const comparable=current?.mean!=null&&prior?.mean!=null&&current.count>1&&prior.count>1&&current.coveredMs/span>=.8&&prior.coveredMs/(model.previous!.range.end-model.previous!.range.start)>=.8&&m.precision===previousMetric?.precision&&model.sources.find(s=>s.id==="metrics")?.state==="available"&&model.previous?.sources.find(s=>s.id==="metrics")?.state==="available";return [m.label,f(current?.mean,m.unit),f(prior?.mean,m.unit),comparable?prior!.mean===0?f(current!.mean!-prior!.mean!,m.unit):f((current!.mean!-prior!.mean!)/Math.abs(prior!.mean!)*100,"%"):"不可比"]}))):"";
  const priorPing=model.previous?table(["Ping 任务（相同 ID）","本期成功时延均值","上期成功时延均值","可比性"],model.pings.map(p=>[p.name,f(model.pingStats[p.id]?.mean,"ms"),f(model.previousPingStats?.[p.id]?.mean,"ms"),"历史目标与协议配置无法完整校验，不计算增减百分比"]))+table(["上期来源","状态","说明"],model.previous.sources.map(source=>[source.name,source.state,source.detail])):"";
  const sourceStates:Record<string,string>={available:"可读取",partial:"部分覆盖",empty:"范围内无数据",unavailable:"未提供",forbidden:"无权限",failed:"读取失败"};
  const sources=`<p class="chapter-conclusion">完整测评截图、轮次和来源集中归档。</p><p class="report-note">正文结论与原始证据分别阅读；选择控制附带的图片，历史索引与原链接始终保留。</p>
    ${model.fullResults?.length?'<p class="appendix-jump"><a href="#report-original-results">查看本章的 TcpQuality / NodeQuality 完整测评截图 ↓</a></p>':note("本范围没有可读取的 TcpQuality / NodeQuality 完整结果；其他来源继续归档。")}
    ${section("01","来源与精度","生成时已冻结的数据快照")}${table(["证据来源","状态","范围与说明"],model.sources.map(s=>[s.name,sourceStates[s.state]||s.state,s.detail]))}
    ${section("02","统计方法与阅读边界")}${note("资源均值按推断采样间距加权且不跨缺口。峰值与 P95 只描述返回点或桶均值，不代表原始瞬时峰值或原始样本 P95。Ping 时延按成功探测样本数加权；丢包按失败 / 总样本计算。不同目标、协议、方向和来源分别解释。")}${note("缺测不补零；CPU 估计覆盖不等于在线率或 SLA。当前配置与计数器快照不能还原历史扩容、价格或供应商账单。未采集的 IO/IOPS、硬盘健康、应用日志、漏洞扫描等不参与结论。")}
    ${details("全部 Ping 统计与逐点证据",table(["任务","协议","成功时延均值","失败率","样本数"],a.lines.map(row=>[row.label,row.protocol,f(row.mean,"ms"),f(row.loss==null?null:row.loss*100,"%"),row.sent]))+model.pings.map(p=>details(`${p.name} / ${p.points.length} 个返回点`,table(["时间","成功时延","失败 / 总数"],p.points.slice(0,200).map(v=>[date(v.t),f(v.v,"ms"),`${v.lost} / ${v.sent}`])))).join(""))}
    ${technicalNetwork}${comparison?details("前一等长区间的 Ping 与来源",priorPing):""}${comparison}${details("指标覆盖、冻结输入和档案标识",definition([["报告 ID",model.reportId],["后端",model.backend],["生成时刻",date(model.generatedAt)],["原始 UTC 范围",`${new Date(model.range.start).toISOString()} - ${new Date(model.range.end).toISOString()}`],["完整地址",model.showAddresses?"用户选择包含":"已脱敏"]])+table(["指标","有效点","估计覆盖","精度"],METRIC_FIELDS.flatMap(([key,label,unit])=>{const found=model.metrics.filter(m=>m.key===key||m.key.startsWith(key+"["));return(found.length?found:[{key,label,unit,precision:"未提供"}]).map(m=>[m.label,model.stats[m.key]?.count||0,f(coverage(m.key),"%"),m.precision])})))}`;
  const contents=[overview,resources,network,traffic,events,sources+fullResultGallery(model)];
  const chapterTitles=["结论摘要",a.resource,a.network,a.traffic,"优先验证观测差异，再评估后续调整。","检测记录与完整测评附录"];
  const subtitles=["先读结论，再查看证据与处理建议。",a.resourceDetail,a.networkDetail,a.trafficDetail,"按优先级保留观察、证据、建议和验证步骤。","完整结果图与原始资料，可离线核查。"];
  const payload=safeJson(model);
  const html=`<!doctype html><html lang="zh-CN" data-theme="${model.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${e(model.node.name)} · VPS 运行与网络体验报告 · Aster</title><style>${reportCss}</style></head><body>
    <header class="masthead"><div class="masthead-brand"><span>ASTER / VPS INSIGHT REPORT</span><b>${history?model.sources.some(s=>["failed","forbidden","partial"].includes(s.state))?"已生成 · 部分覆盖":"已生成 · 详见数据覆盖":"无历史数据 · 仅配置快照"}</b></div><h1>VPS 运行与网络体验报告</h1><div class="report-node"><strong>${e(model.node.name)}</strong><span>${e(context)}</span></div><p class="period">报告周期 ${e(date(model.range.start))} - ${e(date(model.range.end))}<br>${e(model.range.timeZone)} / 生成于 ${e(date(model.generatedAt))} / ${model.showAddresses?"包含完整地址":"地址已脱敏"}</p></header>
    <div class="report-toolbar"><span>独立快照 · 断网可读</span><div><button type="button" data-save-html>下载 HTML</button><button type="button" data-print>打印 / 存为 PDF</button><button type="button" data-json>数据 JSON</button></div><span data-export-status class="export-status" role="status"></span></div>
    <div class="workspace"><nav aria-label="报告章节">${CHAPTERS.map(([key,name],i)=>`<button type="button" data-chapter="${key}"${i===0?' aria-current="page"':""}><small>${String(i+1).padStart(2,"0")}</small>${name}</button>`).join("")}<div class="nav-foot">${e(model.node.name)}<br>${e(date(model.generatedAt,true))}</div></nav><article class="paper">${CHAPTERS.map(([key],i)=>`<section id="${key}" class="chapter"${i?" hidden":""}><header class="chapter-head"><div><p class="eyebrow">${["EXECUTIVE SUMMARY","RESOURCES & STABILITY","NETWORK EXPERIENCE","TRAFFIC & ASSET","FINDINGS & ACTIONS","EVIDENCE & APPENDIX"][i]}</p><h2>${e(chapterTitles[i])}</h2><p>${e(subtitles[i])}</p></div><span class="page-number">${String(i+1).padStart(2,"0")} / 06</span></header><div class="chapter-body">${contents[i]}</div></section>`).join("")}<footer class="footer"><span>ASTER / VPS INSIGHT REPORT</span><span>${e(model.node.name)} / ${e(date(model.generatedAt))}</span></footer></article></div>
    <script id="report-data" type="application/json">${payload}</script><script>/* ${xtermLicense} */${xtermRuntime.replace(/<\/script/gi,"<\\/script")}</script><script>(${readerRuntime.toString()})(${resultReaderRuntime.toString()},(${resultToolkit.toString()})(globalThis.Terminal,${analyzeFullResult.toString()}));</script></body></html>`;
  if(new TextEncoder().encode(html).byteLength>128*1024*1024)throw new Error("完整报告文件超过 128 MiB，请缩小日期范围后重新生成。");
  return html;
}
