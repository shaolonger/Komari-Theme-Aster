# Aster 网络观测插件

此插件为 Aster 增加由 Komari 服务端定时调度的网络检查页。计划和最近 500 条结果保存在 Komari 的插件持久化目录中；浏览器关闭后仍会继续运行。

## 兼容范围与授权

- Komari 服务端需要支持插件系统（插件清单最低版本为 1.5.1）。无需修改 Komari 或 komari-agent 源码，也不需要重新编译它们。
- 在 Komari 管理后台安装本仓库 Release 中的 `Aster-Network-Observatory-v*.zip`，启用插件时按需审批 `server` RPC 和插件 API 路由权限。这些权限使插件能够派发远程任务并提供管理员页面。
- 只对你有管理权限的 VPS 启用 Agent 远程命令执行。插件只生成固定的检测命令；目标值经主机名/IP 校验并安全引用，每个任务只发送到一台所选节点。
- 执行节点应为 Linux，预装 `timeout`、`curl` 和 POSIX shell。按检测类型另外安装 `nexttrace`、`iperf3` 或 TcpQuality。首次安装后，在所有要检测的节点上安装随插件包提供的 `runner/probe.sh`。TcpQuality 原始包探测通常要求 root 或 `CAP_NET_RAW`；Agent 服务账户必须具备相应能力。

## 安装节点探测器

下载 Aster Release 中的网络观测插件包，将其中的探测器复制到每一台要执行计划的 Linux 节点：

```sh
curl -fL -o /tmp/aster-network-observatory.zip \
  https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-v1.0.0.zip
sudo install -d -m 0755 /usr/local/libexec/aster-network-observatory
unzip -p /tmp/aster-network-observatory.zip runner/probe.sh \
  | sudo tee /usr/local/libexec/aster-network-observatory/probe.sh >/dev/null
sudo chmod 0755 /usr/local/libexec/aster-network-observatory/probe.sh
```

例如 Debian/Ubuntu 可使用系统包管理器安装通用依赖：

```sh
sudo apt-get update
sudo apt-get install -y coreutils curl
```

`timeout` 通常由 GNU coreutils 提供。精简系统若使用 BusyBox，请先确认其 `timeout` 支持 `10s` 这类时长格式。探测器不会自动在节点安装软件，也不会修改系统网络配置。

TcpQuality 需要管理员从同一个固定 commit 下载入口和 core，避免入口脚本在每次运行时从 `main` 自动拉取新的可执行代码：

```sh
TCPQUALITY_REV="<40 位 commit SHA>"
sudo install -d -m 0755 /usr/local/libexec/tcpquality
sudo curl -fL "https://raw.githubusercontent.com/ibsgss/TcpQuality/${TCPQUALITY_REV}/runTcpQuality.sh" \
  -o /usr/local/libexec/tcpquality/runTcpQuality.sh
sudo curl -fL "https://raw.githubusercontent.com/ibsgss/TcpQuality/${TCPQUALITY_REV}/runTcpQuality-core.sh" \
  -o /usr/local/libexec/tcpquality/runTcpQuality-core.sh
sudo chmod 0755 /usr/local/libexec/tcpquality/runTcpQuality.sh /usr/local/libexec/tcpquality/runTcpQuality-core.sh
```

如脚本安装在默认路径以外，请为 Komari Agent 设置 `ASTER_TCPQUALITY_BIN` 环境变量并重启 Agent。

## 检测类型

- **HTTPS 可用性**：以 HTTPS GET 检查目标响应，保存状态码、TCP 连接、TLS 握手和首字节耗时；不下载响应正文。默认可每 1/5/15/60 分钟执行。
- **路径追踪**：使用 NextTrace 的 JSON 输出记录到指定主机的逐跳路径。默认每 6/12/24 小时。NextTrace 可从 [NTrace-core](https://github.com/nxtrace/NTrace-core) 获取；探测节点需要能发出相应 ICMP/UDP 报文，部分环境会要求 root 或额外能力。
- **iperf3 吞吐量**：向你自己管理的 iperf3 服务端上传 10 秒单连接测试数据，每天最多一次。先在目标端启动 `iperf3 -s` 并配置防火墙；不要把未受保护的测试服务开放给不可信网络。速度测试会消耗节点和服务端流量。
- **三网回程（TcpQuality）**：调用 `--route --route-protocol both --no-rank-upload`，只做三网 TCP/UDP 路由识别，不发起丢包探测，也不上传报告；每日最多一次。
- **国际互联（TcpQuality）**：调用 `--intl --no-rank-upload`，测量国际网站和测试节点；每日最多一次，流量受脚本限速。
- **综合巡检（TcpQuality）**：调用 `--all --no-rank-upload`，包含三网/教育网回程、国际互联和脚本自己的单线程测速；每日最多一次，消耗流量最多。它的测速服务与自建 iperf3 计划不同。

所有计划按分钟调度，全局一次只派发一个远程检测任务，以避免多个重型测试同时运行。HTTPS 计划频率较灵活；路径和流量型测试受到更长的最小间隔限制。单次输出最多保存约 36 KiB，每种远程任务都有时限。

## TcpQuality 的第三方连接

插件包不包含 TcpQuality 源码或二进制，也不会在计划执行时下载新脚本。管理员需要自行从其项目选择固定 commit，并在每个节点安装入口与 core，再显式选择相关检测。`--no-rank-upload` 会关闭检测报告上传和排名参与；脚本仍会查询其测试节点/线路数据，并连接测试目标。执行网络检测会向目标暴露探测节点的公网出口 IP。TcpQuality 的 GitHub 仓库当前没有声明许可证；如需在商用环境使用或随产品分发，请先向上游确认许可。只需要可确认开源的软件栈时，可组合 HTTPS、NextTrace 和自建 iperf3 服务；这不依赖收费平台，但自建 VPS 和网络流量仍可能产生费用。

## 运行结果

在 Aster 的「网络观测」页面添加计划、查看下次运行时间、手动触发以及检查原始输出。失败结果会保留命令退出码和诊断文本；TcpQuality、NextTrace 等工具输出可能包含公网 IP、运营商和路径信息，请按你的数据保留要求管理 Komari 插件数据目录。
