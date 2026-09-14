# Metric Display Precision TODO

目标：统一各功能入口的连续型指标展示精度，避免同一指标在 VPS 详情页、首页卡片、对比页、图表 tooltip 等位置显示出不同数值。

## 1. 方案固化

- [x] 记录指标显示规则、适用范围和验收标准。
- [x] 明确只在展示层四舍五入，统计和计算仍使用原始数值。

验收：

- 当前文件存在于主题仓库根目录。
- 后续任务可逐项实施、验证、提交。

## 2. 统一格式化工具

- [x] 新增统一指标格式化 API：普通数值、百分比、延迟、丢包、负载。
- [x] 默认连续型指标保留小数点后两位，并采用四舍五入。
- [x] 对 `null`、`undefined`、`NaN`、无效延迟等情况统一返回占位符。
- [x] 增加单元测试覆盖四舍五入、负数、0、无效值和单位拼接。

验收：

- `npm run test -- src/utils/__tests__/format.test.ts` 通过。
- `npm run typecheck` 通过。

## 3. 延迟与丢包统一

- [x] VPS 详情页 Ping 图表 tooltip、任务卡片、统计文本统一使用新 formatter。
- [x] 首页大卡片/小卡片的 Ping 聚合展示、hover tooltip、矩阵源详情统一使用新 formatter。
- [x] VPS 对比页的 Ping 指标继续显示两位，并改为共用同一 formatter。

验收：

- 延迟统一显示为 `xx.xx ms`。
- 丢包统一显示为 `xx.xx%`。
- 同一原始值在首页、详情页、对比页显示一致。

## 4. 其他连续指标统一

- [x] CPU / RAM / Disk 等百分比展示统一两位小数。
- [x] Load 展示统一两位小数。
- [x] 图表 tooltip 与表格单元格使用同一格式化规则。
- [x] 进程数、连接数、样本数、节点数、天数等整数或语义型数值不强制补小数。

验收：

- `npm run test` 通过。
- `npm run build` 通过。

## 5. 发布

- [x] 跑全量测试、类型检查、构建或 release 打包。
- [x] 每个已完成任务独立提交。
- [x] 主题版本号升级。
- [x] 创建新 tag。
- [x] 使用 `gh` 推送到 GitHub 并创建 GitHub Release。

验收：

- 新 tag 已推送。
- GitHub Release 创建成功。
