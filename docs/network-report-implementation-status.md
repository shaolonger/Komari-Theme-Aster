# 网络报告实施与验收记录

2026-10-01：六阶段的软件实现与本地验收完成，版本为 **主题 1.8.0 / 插件 1.7.0 / runner 1.7.0**。设计基线见[重构方案](network-observatory-report-redesign-plan.md)，操作见[逐步指南](network-report-v3-guide.md)，发布资产与最终 CI 结果见 [v1.8.0 Release](https://github.com/shaolonger/Komari-Theme-Aster/releases/tag/v1.8.0) 和[标签构建](https://github.com/shaolonger/Komari-Theme-Aster/actions/workflows/build-package.yml)。

## 交付核对

| 阶段 | 软件交付与验证 | 实网边界 |
| --- | --- | --- |
| 一 · 基础 | 每节点/模块轮次、分页、幂等回传、重启恢复、租期/取消、重叠任务共享、四路轻量并发、旧版本能力协商 | 旧 worker 需升级才能领取新操作 |
| 二 · 国际 | 34 AWS、48 网站/API/CDN、五组双地址族 Telegram、42 IDC 入口、19 国际测速候选；每轮十次样本、历史矩阵与 HTTPS 详情 | 目录来源经核对；并非所有端点已由生产 VPS 验证在线或可用容量 |
| 三 · 路由 | 单次完整 MTR 保留全部跳统计，TCP/ICMP、地区/运营商筛选、公共/固定去程、同轮严格配对、连续已知 AS 折叠、ASN/变化证据 | 公共去程按实际覆盖；固定来源需登记；不认证 CN2 GIA 或商业直连 |
| 四 · 测速 | HTTP/iperf3 P1 双向、另列 P4/P8、接收端字节/时间与区间、完整一秒最大值、数据 socket RTT、发送端重传、负载/条件/流量；九格及国际地区 | 九格是实际资源的覆盖位置，未配置的行缺测；公共资源共享容量，不代表套餐端口上限 |
| 五 · BGP | RIS/RouteViews、实际前缀、路径与拓扑证据、MOAS/prepend/AS_SET、RPKI、来源时刻、缓存与相邻快照变化 | 公开采集器覆盖有限；来源时刻不同；控制平面不代替 MTR |
| 六 · 迁移 | 三步计划、IANA 多每日时刻、批量/分组继承、集中资源、累计容量/覆盖/排队估算、批量迁移预览并关闭旧触发；分享撤销、JSON/PNG、安装/排障指南 | 不补造旧样本；明细七天、统计九十天；家庭设备没有公网也不能代表另两家运营商 |

网络报告目录共 200 个端点，其中 Telegram IPv4/IPv6 分别计入。内置目录的 `health=not-checked` 表示没有生产健康验收；覆盖预览明确区分工具/当前目录确认与运行时发现，不宣称预览可确认第三方端点永远在线。

## 已执行的验证

- `npm run test:release-gates`：**373 个前端测试、66 个插件 Node 测试、29 个 Python 测试**；类型、lint、RPC 合同、24 项性能检查、构建预算、Komari 静态资源路径与浏览器规模检查通过。
- 完成最后的资源接入页面调整后，再执行类型/lint及 `npm run test:browser-scale`。覆盖三标签、十次原始样本、HTTP 403 详情、MTR/AS、BGP 路径证据、九格、深浅主题、390px、多个每日时刻、集中资源、键盘 Escape 和报告操作菜单。
- `npm run test:plugin-runtime`：真正导入官方 Komari **1.4.3（bf6b45ec3abf）与 1.5.1（f0cc0fba38ce）** 的 JavaScript runtime，验证异步 BGP/RPKI、文件系统、缺目录、轮次/索引/回传、共享恢复、路由、七天/九十天保留与清理。修复了新 BGP 调度在旧 Goja 中的跨 `await` 词法绑定异常。
- `npm run test:upstream-contract`：通过仓库已审计的官方 server `b11ffd3aa7cca03502a75eb64ecbe827d6831d3a` 与 agent `f7c16a94ba7dd3ce57fbe86c6131d995f645d8d8` RPC/主题资源合同；它是固定源码合同检查，不冒称已部署最新开发版整套服务器。
- Linux 双端实验室：实际 iperf3 认证临时监听、P1/P4 上下行、接收端 JSON 区间及发送端 TCP 指标；实际 HTTPS 接收器上传/下载、接收字节确认、单位、预热、数据 socket TCP_INFO 与错误 Host/SNI 拒绝。实际 MTR 20 次采样和完整逐跳统计与原始 JSON 一致。
- 规模夹具：**50 台 VPS × 每台 150 目标 = 7500 槽位/任务**、每 worker 四路领取、节点索引隔离和恢复、累计容量；修复共享任务查找的二次复杂度。此项是队列/存储压力检查，不是同时运行 7500 个公网测试。
- 故障与权限：凭证/节点隔离、重复回传、断线 outbox、已执行任务恢复不重测、取消与进程组清理、繁忙退避、缺少工具/资源、跨 UTC 日期、夏令时、共享结果崩溃恢复、分享撤销/HTML 转义，以及明细过期后只保留真实统计。

实验室复现命令及范围见 [Linux 实验室说明](../network-observatory/runner/tests/lab/README.md)。本次构建的首屏 Home Brotli JS 为约 164.5 KB，在原有预算内；新报告代码按入口延迟加载。

## 不作出的覆盖声称

没有提供生产 Komari 面板、VPS 或大陆三运营商测量资源的访问权限，所以**尚未完成这些生产网络的实测验收**。本地 Linux 传输、模拟浏览器、公共 API 响应夹具都不能代替电信/联通/移动真实端点，也不能证明北京/上海/广州九格已覆盖。软件会保存来源与缺失原因；取得授权资源后可以逐格接入、定时测量和回看。

不修改 Komari/komari-agent，也不通过 Web SSH 执行这些新测量；`--disable-web-ssh` 可以保持启用。可选固定 worker 仍面向 Linux systemd，未发布 Windows/Mac 原生安装器。TcpQuality/TOS 候选没有被当作可随意定时批量上传的授权接口；旧工具诊断保留，新版上传使用明确的接收器合同。
