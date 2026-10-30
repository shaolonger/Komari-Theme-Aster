# 光域未来素材与生成记录

2026-10-30 的还原修正使用 Codex 内置 `image_gen` 生成工具，未使用 CLI。参考用户上传的首页、实例详情、网络诊断三张截图；插画负责材质与环境，实时地球、轨道、流光、视差和装置浮动由代码实现。

## 图片文件与提示词摘要

所有提示均要求蓝白玻璃材质、等距三维视角、透明背景、无文字、无商标；仅生成装饰插画，界面与实际数据使用 React 组件。

| 文件 | 生成提示词归档摘要 | 用途 |
| --- | --- | --- |
| `src/assets/luminous-server-v2.png` | Match the reference's miniature silver and dark navy double server appliance, softly rounded corners, luminous cyan rails and blue glass edges, isometric three-quarter view, premium blue-white cloud dashboard illustration, transparent background, no text or labels. | 节点卡片与当前节点 |
| `src/assets/luminous-environment-v2.png` | Wide panoramic cloud city, translucent elliptical glass plaza with cyan light rails, white vertical server cabinets, tiny friendly maintenance robots and futuristic buildings at the flanks; keep upper center transparent for a live globe. Pale blue and white, clean soft volumetric lighting, transparent background, no globe or UI text. | 三页云端场景环境 |
| `src/assets/luminous-hero-device-v2.png` | Large white and silver rounded double-stack server on overlapping oval glass platforms, navy front slots, bright cyan edge lights, pale blue cloud mist; match the reference detail page camera and premium 3D material, transparent background, no text, flags or labels. | 实例详情主装置 |
| `src/assets/luminous-sidebar-v2.png` | Tall upright white server tower with dark blue front and luminous cyan indicators on a glass plinth and tall transparent pedestal, a smaller cabinet and tiny robots below, premium isometric blue-white diorama for the lower-left sidebar, transparent 1:2 composition, no text. | 首页侧栏装置 |

原始 PNG 保留在本机 `/Users/shaolong/.codex/generated_images/01a18844-f148-7aa0-a54e-4260eec94ed0/`；仓库图片经等比缩小分辨率以减少传输。

侧栏行星 `src/assets/luminous-promo-planet.svg` 为代码绘制的蓝紫色切面球体，环带由 CSS 透视绘制。

## 地球贴图

日间、夜间灯光与云层来自 [Solar System Scope](https://www.solarsystemscope.com/textures/)，依 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 分发。提供方注明其纹理基于 NASA 图像与高程资料。

对应 `src/assets/luminous-earth-{day,night,clouds}-v2.jpg`，在球面着色器内混合光照、夜间灯光、云层、蓝色调与大气边缘。全部资源随主题本地分发，运行时不访问外部地图服务。安装包包含 `dist/luminous-assets-license.txt`。

地球轨道与装置是装饰场景；地区数量、监控曲线、故障观测与资产数值仍取自真实后端。
