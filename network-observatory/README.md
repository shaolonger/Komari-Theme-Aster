# Aster 网络检测：从安装到批量巡检

Aster v1.3.0 将网络检测放在每台 VPS 的**实例详情 → 节点诊断 → 网络检测**中。配置、任务状态和报告都在此处；旧 `/network-observatory` 地址只提供跳转到实例页的节点列表。Komari 1.4.3 及以上可用，不需要修改 Komari 或 komari-agent 源码，也不需要开启 Agent Web SSH。检测由每台 VPS 上独立的 systemd 探测器经出站 HTTPS 领取任务，浏览器关闭后仍会运行。

## 1. 更新主题和插件

1. 从 [最新 GitHub Release](https://github.com/shaolonger/Komari-Theme-Aster/releases/latest) 下载 `Komari-Theme-Aster-v1.3.0.zip` 与 `Aster-Network-Observatory-v1.2.0.zip`。
2. 在 Komari 后台分别更新主题和插件，启用插件。插件要求 Komari **≥1.4.3**，不是 ≥1.5.1。
3. 批准插件的 **API 路由**和**系统 RPC**权限。v1.2.0 新增系统 RPC 权限是为了在浏览器关闭时读取 Komari 节点清单和分组，完成自动继承；插件代码只调用 `admin:listClients`，不会调用远程命令执行。此权限在 Komari 层面较宽，管理员应安装自己信任的插件版本。
4. 用管理员账号刷新 Aster 页面，进入任意 VPS 实例详情，点「网络检测」。若显示插件未就绪，检查插件是否启用、权限是否批准、反向代理是否转发 `/api/aster-network-observatory/`。旧版主题与新版插件应同时升级，才能使用批量方案和实例页。

升级会保留插件原有凭证、手动计划和旧历史；无需为了升级重发探测器密钥。若已有 VPS 探测器，建议重新运行第 2 步的一键安装命令，升级到 v1.2.0 runner 后才会在页面显示工具状态和持续心跳。

## 2. 为第一台 VPS 接入探测器

1. 打开这台 VPS 的「网络检测」标签，点击「为此 VPS 启用检测」。页面已显示**当前节点 UUID**。它是 36 位带连字符的 Komari 节点标识；**不是** Komari Agent token，也不是下面的探测器密钥。
2. 点击「生成本机探测器密钥」，立即复制页面仅显示一次的 64 位密钥。若节点已登记，按钮是「重置」；重置会让旧密钥立即失效，须马上在该 VPS 重新配置。
3. 复制同一面板中的「本机安装 / 升级命令」，在这台 Linux systemd VPS 的 SSH 终端执行。命令已经填好面板地址和 UUID，例如：

   ```sh
   curl -fsSL https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download/Aster-Network-Observatory-install.sh | sudo sh -s -- --server-url 'https://monitor.example.com' --node-uuid 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
   ```

   如果面板部署在子路径，在页面先把地址改成完整路径，例如 `https://example.com/komari`。命令通过 SHA-256 校验下载的 runner ZIP；安装器需要 curl、systemd 和 root/sudo，缺少 Python 3 时会尝试使用系统包管理器安装。命令中不放密钥，避免它进入 shell 历史和进程参数。
4. 向导提示「探测器密钥」时粘贴第 2 步的值。输入不会回显。询问 TcpQuality 脚本路径时，尚未安装就直接回车。向导验证凭证后保存配置并启动服务。
5. 等待约 10–30 秒，实例页应显示「探测器在线」。如果只显示「等待首次连接」，在 VPS 执行：

   ```sh
   sudo systemctl status aster-network-observatory-agent --no-pager
   sudo journalctl -u aster-network-observatory-agent -n 100 --no-pager
   ```

探测器只向 Komari 发起出站请求，不需开放 VPS 入站端口。反向代理必须保留 `Authorization` 请求头。Komari Agent 的 `--disable-web-ssh` 可保持开启。每台 VPS 仍需各自的密钥和一次 SSH 安装，这是在不开启远程执行权限下确认节点身份所需的操作；后续检测目标、频率和分组继承可批量配置。

已有探测器升级时，在同一 VPS 重新运行页面给出的命令即可。地址和 UUID 已填好；若没有重置密钥，密钥提示处回车可保留原值。升级会重启 systemd 服务以加载新代码。

## 3. 一次设置多台 VPS 的检测方案

在一台 VPS 的「网络检测」标签点「套用方案 / 批量配置」。在首页 VPS 列表选中多台后，也可点「网络检测 · N 台」；管理工作室的「网络观测 → 网络检测方案」同样可用。

1. 勾选一个或多个内置方案。第一次建议只选「基础 HTTPS 可用性」，无需填写目标。
2. 在节点列表勾选 VPS，或勾选 Komari **分组**。两者取并集；可使用搜索和「选择搜索结果」。选择分组并保留「继承方案」时，新加入该分组的 VPS 会在下一次同步（约 1 分钟）后自动取得计划，浏览器无需保持打开。
3. 按需调整频率。自有网站或 iperf3 方案需要只填写一次目标域名/IP 和端口，便可分发给所有选中节点。iperf3 需明确勾选端点授权与流量确认。
4. 点「预览应用范围」。预览逐台列出新增/已有计划、未接入、离线和缺少工具的状态。确认无误后点「确认应用」。重复按相同范围应用不会产生重复计划；尚未安装探测器的节点也能先保存计划，接入且工具就绪后才执行。
5. 返回实例详情查看本机计划、排队/运行状态和报告。新计划会错峰开始，通常先等待约 1–6 分钟；可在已接入节点点击「立即检测」加速验证。

取消「继承方案」会把当次新增计划复制为独立计划，今后不受集中更新影响。需要集中修改时，在同一面板的「管理已有方案」编辑名称、范围、频率或目标，也可整体暂停/恢复/删除。重叠范围下同一预设与目标在同一节点只创建一份计划；启用方案优先于暂停方案。某台 VPS 上直接修改继承计划后，该计划成为该机独立覆盖，后续方案更新不会覆盖它。删除继承计划会加入该机排除项；删除整个方案会删除其余继承计划，但保留单机覆盖和历史。

## 4. 内置公开目标与工具

预设目标清单随插件版本固定，页面显示目录版本和来源；插件不会下载不受控的远程配置并将其作为 shell 命令执行。

| 方案 | 默认目标、工具及建议 |
| --- | --- |
| 基础 HTTPS 可用性 | `www.cloudflare.com`、`www.wikipedia.org`；需要 curl，每 15 分钟。适合快速检查公网访问；CDN 可达不能证明特定地区线路质量。 |
| 三网路径 · NextTrace | 北京电信/联通/移动目标来自 [NextTrace 官方目标清单](https://github.com/nxtrace/NTrace-core/blob/7ff73b2c51f9f37a9bc1d6139b7053948f0250db/fast_trace/basic.go)；需要 nexttrace，每天一次。目标运营商分类不等于回程质量评级。 |
| 三网回程、国际互联 · TcpQuality | 调用 VPS 本地安装的 [TcpQuality](https://github.com/ibsgss/TcpQuality) 默认测试集，每天一次，关闭报告/排名上传。该仓库目前未明确声明许可证；请自行确认使用许可和脚本版本。 |
| 自有网站监控 | 一次填写你管理的域名/IP，可批量检查 HTTPS；默认每 5 分钟。 |
| 授权 iperf3 吞吐测速 | 一次填写自建或明确授权的 iperf3 端点；每天单连接上传 10 秒。可参考[公开端点清单](https://github.com/R0GGER/public-iperf3-servers)找候选，但清单不代表允许运行定时测速；应先取得端点授权并核对流量预算。 |

Debian/Ubuntu 基础工具可安装 `sudo apt-get install -y curl coreutils`；iperf3 客户端用 `sudo apt-get install -y iperf3`。其他发行版使用相应包管理器。NextTrace 请从[官方 Releases](https://github.com/nxtrace/NTrace-core/releases)下载与 VPS 架构相符的固定版本，按上游发布的校验值验证，再放到探测服务可见的 PATH（例如 `/usr/local/bin/nexttrace`）。TcpQuality 如需使用，请从上游选择并固定同一版本的 `runTcpQuality.sh` 和 `runTcpQuality-core.sh`，让入口脚本可执行，在安装向导中填写绝对路径。页面每 30 秒更新工具可用状态；「缺少工具」时计划会等待，不会静默报成线路故障。

HTTPS 检测使用 HEAD 请求，不下载正文；读取 HTTP 状态、DNS、建连、TLS 和首字节的耗时。路由中间跳不响应不代表终点丢包。iperf3 当前只测上传，不声称下载速度。TcpQuality 报告因版本差异保留原文，不自动给线路打未经验证的分数。所有目标都可看到探测节点的公网出口 IP；VPS、流量与自建测速端点会有实际成本。本插件与所用的明确开源工具本身不要求付费服务。

## 5. 查看结果、单机调整和临时检测

实例页上方显示探测器在线状态和 curl、timeout、nexttrace、iperf3、tcpquality 的可用性。计划卡片显示继承来源、频率、下一次运行、等待原因，并提供立即检测、编辑、暂停/恢复、删除。点「自定义 / 临时检测」可创建本机计划，也可勾选「只检测一次」而不保存定时计划。

最近结果摘要与本机历史记录都在实例页，按类型筛选并分页加载，单节点最多保留 500 条或 2 MiB。点一条记录查看时间、目标、退出状态、已知指标、路由逐跳表和完整原始输出。执行完成只说明程序退出码为 0；网络质量还需结合指标与原始报告。旧版插件保存的历史也会在升级后按节点继续显示。记录可能包含目标 IP、出口 IP 和路由信息，请按自己的数据留存要求管理 Komari 插件数据目录。

## 6. 常见问题

- **「Komari 节点 UUID 无效」**：36 位带连字符的值才是 UUID。实例页已自动填入安装命令。64 位十六进制值是探测器密钥，不能填进 UUID 栏。
- **「节点凭证无效」**：检查它属于当前实例 UUID；若刚重置过，请用新值重新运行向导。重置后旧值立即失效。
- **「无法同步 Komari 分组」**：确认插件 v1.2.0 已启用且批准系统 RPC 权限，重试方案面板。同步失败时保留已有计划和凭证，待恢复后继续继承。
- **「等待首次连接」或「探测器离线」**：检查上面的 systemctl/journalctl、VPS 到面板的出站 HTTPS、反向代理的 `Authorization` 转发。单独调用凭证验证接口不代表 systemd 服务已在线。
- **已保存计划但没有结果**：看实例页的「等待接入 / 安装依赖 / 探测器上线」提示；计划默认错峰启动。可在就绪后立即运行，任务状态每 10 秒更新。
- **工具显示缺失**：确认依赖安装在 systemd 服务 PATH，TcpQuality 入口与 core 脚本相邻且入口可执行。升级 runner 以显示工具状态；旧 runner 可能显示「待检测」。
