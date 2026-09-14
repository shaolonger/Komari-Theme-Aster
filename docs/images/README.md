# Aster 界面截图

`current/` 中的图片由当前仓库构建产物配合 `scripts/browser-scale-gates.mjs` 的官方 Komari 兼容模拟环境直接截图。截图使用模拟节点与模拟监控数据，不包含真实服务器或用户信息。

执行以下命令可重新生成截图：

```bash
npm run build
BROWSER_GATE_SCREENSHOT="$PWD/docs/images/current/aster.png" node scripts/browser-scale-gates.mjs
```

脚本生成的 `aster-*.png` 分别对应首页浅色与深色模式、移动端首页、实例 Ping、VPS 对比、资产统计和主题设置。确认图片后，将其按 README 使用的文件名保存到 `current/`，并用 `overview-light.png` 同步更新 `theme-preview.png` 与仓库根目录的 `preview.png`。

最近更新：2026-09-12。包含新配置工作室的桌面和移动端截图；所有展示图均由实际浏览器渲染，未使用概念图。首页截图同时作为主题包预览。

截图模式还会生成 `aster-studio-{appearance,overview,views,assets,network}-{desktop,mobile}.png`，用于逐分区首屏检查，并验证两个尺寸下均无页面横向溢出。此检查不等于所有折叠内容、长列表及深色模式的完整视觉验收。

深色模式同样生成五分区、两种设备尺寸的首屏截图，文件名增加 `-dark` 后缀；通过保存外观偏好并重载页面切换。
