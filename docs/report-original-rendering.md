# 原始报告长图 · Aster 1.33.0

NodeQuality 原始版使用本轮完整的 `header_info.log`、硬件、IP、网络与回程 ANSI 日志。JSON 可能因保留上限而不完整，但完整日志仍可用；两者分别判断，不把 JSON 解析失败变成终端格式。缺少所需日志或日志达到 60,000 字符截断上限时，插件按本轮保存的官方链接读取上游报告 ZIP。

终端由 xterm.js 5.5 解析，按上游固定顺序写入，保留宽字符、换行、光标处理、前景色、背景色、粗体、反色和下划线。终端结果以网页标题、分类栏、深色渐变及报告面板的样式合成为一张 SVG，再输出 PNG。这里是按真实内容生成的报告图片，不依赖浏览器截图服务。沿用报告的地址脱敏设置。

TcpQuality 直接保留官方分区 SVG 的完整 viewBox。原始 `100%` 背景覆盖整个分区，不再因改变 viewBox、缩短百分比背景后被白色画布露出而产生第二张白底图片。每个分区的 PNG / ZIP / 放大预览都是一张图。

超长图受浏览器单边尺寸和 64M 像素上限约束，输出比例按上限调整，保留全部内容。超过终端 30,000 行时明确拒绝，避免滚动缓冲丢弃开头后导出不完整结果。打印另从完整 PNG 生成页面，不改变下载图；打印页的底色来自原始像素。

上游补取仅接受已保存轮次的官方 URL。NodeQuality 使用其公开报告阅读器的请求签名流程，不接受用户指定 API 地址或跳转；上游限制访问时明确返回失败，不伪造原报告。ZIP 仅读取固定日志名，校验 CRC、压缩方法、目录、重复文件、单项及总解压大小。归档解压在浏览器完成，VPS 无需安装浏览器、截图服务或新探测器。

验证包括真实保留日志的完整长图、官方 TcpQuality SVG、截断 JSON 与完整 ANSI 并存、终端背景色和宽字符、上游归档读取与签名、ZIP 完整性与大小限制、在线 / 离线图片、ZIP 只保留整图及独立打印分页。真实 NodeQuality ANSI 与公开 TcpQuality SVG 的本机验证素材未加入仓库；自动门禁使用固定模拟归档。

来源：[NodeQuality](https://nodequality.com/)、[xterm.js 缓冲单元接口](https://xtermjs.org/docs/api/terminal/interfaces/ibuffercell/)、[Compression Streams 标准](https://compression.spec.whatwg.org/)。xterm.js 依 MIT 许可使用，完整许可随离线 HTML 内嵌。
