# Network observatory implementation audit

The implementation provides mainland ↔ VPS path and throughput measurements,
and VPS → website measurements, with schedules and reports inside the instance
page. Coverage depends on the measurement endpoints actually available. The
checklist below records implemented capabilities; it does not establish complete
three-carrier coverage or certify every production deployment.

## 对照最初需求：现状与改进顺序

审查范围：主题 v1.7.0，插件 v1.6.0，runner v1.6.0。

| 原始需求 | 当前能获得什么 | 完整满足的条件与限制 |
| --- | --- | --- |
| VPS 与大陆三网真实去程、回程 | 自有大陆探针与 VPS 的两个方向分别进行路径探测；公共 Globalping 去程和北京三网目标回程作为独立样本 | 固定三网探针才能对照相同端点；回程逐跳探测要求大陆端有可达地址。NAT 后仍可测速，但不能据此补出回程线路。定时样本不能声称是所有业务包的持续实时线路 |
| 大陆与 VPS 真实带宽和速度 | 授权大陆探针主动连接 VPS 的临时认证 iperf3 服务；分别记录两个流量方向、单连接和多连接的接收端吞吐 | 实际结果受探针接入带宽、两端 CPU 和当时链路条件共同影响；取消限速不会自动消除这些瓶颈。公共免费 iperf3 主机不能保证代表大陆三网 |
| VPS 到国际主流网站的互联 | 48 个网站/API/CDN 目标、正常 DNS 下的 HTTPS 阶段、连接 IP 与应用状态、10 次 TCP 建连统计 | 附近 CDN 命中体现网站访问体验；不能代表美国、欧洲等地区的骨干互联。需要另设固定地区、固定端点的网络测量才能回答后者 |

推荐继续保留「主题展示 + 插件调度与存储 + VPS/大陆独立探测器」结构。
无需开启 Web SSH，也无需为这套功能改造 Komari/Agent 核心。工具本身没有
必需收费依赖；可靠的大陆三网测量资源需要实际设备或授权，可能产生带宽、
服务器和流量费用。

下一步应先改进结果可靠性，再扩充目标数量：

1. **按检测轮次配对路径。** 当前 `pairId` 由方案、VPS 和探针生成，未包含
   本轮运行 ID；界面按接近时间寻找反向报告，可能把相邻轮次配在一起。
   应让一次执行生成唯一轮次 ID，并只对照同轮次、同端点和同地址族的报告。
2. **继续完善历史分页。** v1.7.0 已将混合最新 200 条改为路线、测速、网站
   各自 200 条，避免高频网站报告挤出每日测速和路线。完整分页仍未实现；
   不能把界面窗口等同于保留期内全部原始记录。
3. **让全速任务排队时间与容量匹配。** 原生全速任务全局串行，待执行任务
   20 分钟过期。17 台 VPS × 3 个探针 × 2 个方向 × 2 种连接配置 × 10 秒，
   仅传输时间就至少 34 分钟。应按预计时长安排队列、错峰执行，并在预览中
   呈现排队和完成时间；不能把过期任务当成已经完成的测速。
4. **补足测量解释。** 当前测速包含预热区间，网站 HEAD 不自动跟随重定向。
   可以提供预热选项、有限重定向和小文件下载测试，分别报告网络失败、应用
   拒绝和 CDN 位置；不要把 HTTP 403 或某个中间跳点不响应归为网络故障。

v1.6.1 更新了全部网络页面的配置与报告样式；v1.7.0 解决类别互相挤出的问题，增加 ASN 补查及 TcpQuality 参考目标。跨轮次路径配对、完整分页及大规模全速排队仍未修复。本地两端 iperf3 实验验证的是执行机制，不能当作大陆三网真实链路的
生产验证。v1.5.1 已修复 Komari 1.4.3 首次保存时缺少报告父目录导致的结果上传和超时收尾失败；用官方 1.4.3 JavaScript 运行时验证了修复前报错、修复后成功保存。最终验收还应在实际电信、联通、移动测量点分别完成一轮双向路径
和吞吐测量，并检查跨天、失败、缺少覆盖及多 VPS 排队时的报告。

## Measurement requirements

- [x] Native website measurements: DNS, connect, TLS, TTFB, HTTP status,
      resolved IP, IPv4/IPv6, error stage; 401/403 are application responses.
      v1.7.0 adds 48 catalogue targets and ten full TCP handshakes to the observed IP;
      connection failures are not labeled packet loss. Non-public proxy/DNS addresses are flagged.
- [x] Native route measurements: 32-hop traces, protocol and source provenance,
      observed hop IPs with NextTrace metadata or bounded Team Cymru BGP origin
      enrichment, explicit absence reasons, incomplete paths, optional MTR endpoint statistics.
- [x] Mainland → VPS traces using filtered Globalping CN/ASN probes, with quotas,
      persisted asynchronous jobs, unavailable coverage and source metadata.
- [x] Registered controlled mainland workers, separate revocable credentials,
      one-command deployment, city/carrier/access-type/public-address metadata.
- [x] Paired traces for reachable controlled endpoints; show asymmetric or
      partial evidence, never infer a reverse trace from RTT or SYN responses.
- [x] Controlled iperf3 server sessions on the VPS and a mainland client;
      mainland → VPS and VPS → mainland, single/multiple streams, uncapped TCP,
      serialized jobs, expiring listener, measured bytes and receiver rates.
- [x] Public iperf and TcpQuality retained as explicitly identified references.

## Configuration and reports

- [x] Three native instance categories: mainland routes, mainland speed, websites.
- [x] Presets, single-node and bulk/group inheritance, low manual input,
      source/coverage preview, and immediate execution.
- [x] Interval or multiple daily times in an IANA timezone, next-run preview,
      migration of old fixed-offset plans without silently changing timing.
- [x] Native metrics, trends, paired paths, website stages and coverage matrix;
      full diagnostics available and native report export.
- [x] Structured per-day storage and 90-day summaries; bounded raw diagnostics,
      migration/read access for old reports, retention visible to administrators.
- [x] Setup and upgrade documentation describes actual resources, directions,
      traffic, NAT limitations, and the distinction between observed vs inferred.

## Verification and release

- [x] Meaningful unit/integration tests for API auth, schedules, provider polling,
      quotas, controlled two-worker sessions, failure recovery and retention.
- [x] Linux executions of native website and route checks plus a real local
      two-ended iperf3 test; provider contract verified against official schemas.
- [x] Browser verification of instance categories, bulk plans, source setup,
      reports, narrow screens and keyboard operation.
- [x] Full repository release gates and official Komari/agent compatibility gate.
Publication requires matching theme/plugin/runner versions, ZIP/checksum auditing,
commit/push, a new tag and Release via gh, successful CI, and a download audit.
These publication checks are recorded in the Release and its Actions run.

Runtime architecture: retain the legacy v1 API and schedules, add a v2 native
monitoring controller and structured archive in the plugin. Updated workers poll
native work before legacy work; old workers continue legacy schedules. Native
jobs identify the monitored VPS separately from the executing worker. Mainland
workers connect outbound to the panel and VPS; reverse traceroute requires a
reachable declared public endpoint and is marked partial when unavailable.


Evidence: theme 1.6.0 / plugin and runner 1.5.0. Node controller/provider/archive
integration tests and Python measurements/installer/coexisting-role tests pass.
Repository release gates include 370 frontend tests, types, lint, performance,
bundle/static-route contracts and browser scale gates; the native UI tests cover
403 status, timing stages, daily IANA preview/save, credentials, bulk range,
390px viewport and Escape. Linux Ubuntu 24.04 used actual curl, NextTrace 1.7.3,
20-cycle MTR and two container endpoints with authenticated iperf3: unauthenticated
access rejected, both directions for 1/4 streams measured, timer-only cleanup
verified. This lab tests execution, not mainland link capacity. Globalping's live
CN/AS4134 test returned Guangzhou/Chinanet Backbone/datacenter metadata and 20
incomplete hops, which remain incomplete. The provider adapter was corrected
against real API behavior: no ipVersion for IP targets, 422 no coverage, 429
backoff, a bounded 8MiB directory read with only CN entries persisted.

Practical limits: owned/authorized mainland nodes and VPS firewall configuration
are required for stable uncapped speed tests. Public sources are dynamic,
independent samples and cannot supply iperf3 or be treated as paired reverse
paths. Nine named IANA zones use bundled 2020–2040 transitions. Detailed storage
keeps seven days; the UI reads the latest 200 detailed rows with 90-day summaries.
Old fixed-offset/tool records remain readable without changing their timing or
pretending they are native measurements.

## v1.7.0 ASN 与国际目标验证

目录核对 TcpQuality `c2295ae096437859ce4bbc36f170428fcac47be9` 的 31 个网站/API
和 8 个 CDN；保留原有 9 个首页后共 48 个目标。单方案最多 64 个、默认仍是
6 个；过高频率导致单方案超过 9000 份/天时拒绝保存，多个方案的累计容量仍
需管理员控制。网站排队期限增至 90 分钟，单任务租期仍为 180 秒。

新增验证覆盖 IPv4/IPv6 ASN 查询、非公网跳点、多 Origin、NextTrace 字段与
查询超时、缓存、结果回传认证、补查期间心跳继续处理、类别历史窗口，以及
TCP 成功握手/拒绝连接和 HTTP 403 独立语义。使用官方 Komari 1.4.3 运行时
验证新目录与异步 DoH；真实公共查询返回 AS15169 与 AS13335。桌面 HTTPS
联网测试经过本机 DNS/代理映射，只用来验证执行及非公网提示，不作为 VPS
国际线路延迟验证。完整 TcpQuality 裸 SYN/地区 iperf3 仍在工具诊断中，本次
原生网站统计没有冒称同一种测量或全套上游国际报告。
