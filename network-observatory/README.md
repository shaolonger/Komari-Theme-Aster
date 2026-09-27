# Aster 网络观测插件

此插件为 Aster 增加由 Komari 服务端定时调度的网络检查页。任务由每台 VPS 上的本地探测服务通过 HTTPS 主动领取并回传；Komari Agent 的 `--disable-web-ssh` 可以继续开启。计划和最近 500 条结果保存在 Komari 插件持久化目录中，浏览器关闭后仍会继续运行。

## 兼容范围与权限

- Komari 服务端需为 1.4.3 或更高版本。已对照 Komari 官方 1.4.3 标签源码确认：插件路由、定时任务、Node.js `crypto`/`fs`/`path` 模块和请求身份上下文均可用。此方案不使用 `admin:exec`，也不需要修改或重新编译 Komari/komari-agent。
- 在 Komari 管理后台安装本仓库 Release 中的 `Aster-Network-Observatory-v*.zip`。启用插件时只需审批插件 API 路由权限；不需要系统 RPC、子进程执行或本地监听权限。
- 在 Aster 的「网络观测」页为每台检测节点生成一次性凭证。服务端只保存凭证的 SHA-256 摘要；节点凭证只能领取分配给对应 UUID 的任务并提交结果。重置凭证会立即使旧凭证失效，撤销凭证会暂停该节点的计划。
- 节点服务只接受固定检测类型和经过校验的主机名/IP/端口，不会把计划字段作为 shell 命令执行。节点只向 Komari 发起出站 HTTPS 请求，不需要开放 VPS 入站端口。

## 安装节点探测服务

从 Aster Release 下载网络观测插件 ZIP，把包内 `runner/` 目录复制到 Linux 节点。Debian/Ubuntu 示例：

```sh
sudo apt-get update
sudo apt-get install -y python3 curl coreutils grep
sudo sh runner/install.sh
sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure
```

安装向导会要求 Komari 地址、节点 UUID 和刚才生成的一次性凭证。凭证输入时不会回显；向导会先向插件验证凭证，再以 `root:aster-netobs`、`0640` 权限写入 `/etc/aster-network-observatory/agent.json`，并启用 systemd 服务。节点服务以专用 `aster-netobs` 用户运行，通过 systemd 获得 `CAP_NET_RAW`，用于需要原始套接字的路径检测。

在主题页面保持网络观测页打开时，节点服务每 15 秒主动检查一次计划；浏览器关闭后服务仍会运行。排查服务状态可运行：

```sh
sudo systemctl status aster-network-observatory-agent
sudo journalctl -u aster-network-observatory-agent -f
```

节点上的 Komari Agent 可以继续使用 `--disable-web-ssh`。节点需要能解析并通过 HTTPS 访问 Komari 服务端；反向代理需允许插件 API 路由及请求头 `Authorization`。

## 可选工具

- **HTTPS 可用性**：系统 `curl` 发起轻量 GET，仅记录状态码、TCP 连接、TLS 握手和首字节耗时，不下载正文。计划间隔 1/5/15/60 分钟或 6/12/24 小时。
- **路径追踪**：使用 NextTrace JSON 输出记录逐跳路径，每 6/12/24 小时。可从 [NTrace-core](https://github.com/nxtrace/NTrace-core) 获取；节点服务的 systemd 单元提供 `CAP_NET_RAW`。
- **iperf3 吞吐量**：向你自己管理的 iperf3 服务端上传 10 秒单连接测试数据，每天最多一次。先在目标端启动 `iperf3 -s` 并设置防火墙；速度测试会消耗节点和服务端流量。
- **三网回程（TcpQuality）**：使用 `--route --route-protocol both --no-rank-upload`，仅做三网 TCP/UDP 路由识别，不上传报告；每日最多一次。
- **国际互联（TcpQuality）**：使用 `--intl --no-rank-upload` 测量国际目标；每日最多一次。
- **综合巡检（TcpQuality）**：使用 `--all --no-rank-upload`，包含回程、国际互联和脚本自带测速；每日最多一次，流量更多。

`curl` 是 HTTPS 检测的基础依赖；其他工具仅在对应检测类型启用时需要。探测器不会自动下载或安装第三方工具。iperf3 服务端需要自行部署。TcpQuality 如不在默认路径 `/usr/local/libexec/tcpquality/runTcpQuality.sh`，可在节点配置向导中填写脚本路径；入口与 core 应来自同一个固定 commit。

## TcpQuality 的第三方连接

插件包不包含 TcpQuality 源码或二进制，节点服务也不会在每次执行时下载新脚本。管理员需要自行从其项目选定固定 commit，并在每个节点安装入口与 core。`--no-rank-upload` 会关闭报告上传和排名参与；脚本仍会查询其线路数据并连接测试目标。检测目标会看到节点的公网出口 IP。TcpQuality 仓库当前没有声明许可证；商用使用或再分发前请向上游确认许可。若只需要许可证明确的开源方案，可组合 HTTPS、NextTrace 和自建 iperf3 服务；无需收费平台，但 VPS 与流量仍可能产生费用。

## 结果与隐私

在 Aster 的「网络观测」页生成或撤销节点凭证、配置计划、手动触发检测、查看节点最后在线时间和原始输出。单次只派发一个任务；任务有领取时限、运行租约和超时重试上限。NextTrace、TcpQuality 等输出可能包含公网 IP、运营商和路由信息，请按你的数据保留要求管理 Komari 插件数据目录。
