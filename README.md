# 自定义皮肤（Custom Skin）

把本地图片、GIF 或视频设为 DeepSeek Harness 桌面端的应用背景，并在设置页里实时预览、微调、应用或取消。素材与参数只保存在本机，重启后自动恢复。

这是一个 **Client-only 的 DSH 插件包（bundle）**：宿主负责「设置 → 自定义皮肤」这个入口，插件自己管理背景层、配色覆盖和本地存储。

---

## 功能

- **背景素材**：PNG / JPG / WebP / GIF / MP4；WebM 在客户端能解码时同样可用（按实际解码结果判断，不看扩展名）。
- **先预览再应用**：导入后立即显示在背景层上，左侧 16:9 预览，右侧常用调整：填充 / 完整显示、缩放、画面亮度、水平/垂直位置、面板透明度、磨砂强度、强调色，外加「动态效果」「自动适配图片明暗」两个开关。
- **融入应用而不是贴一张图**：背景层在应用内容之下，上面固定压一层带暗角的遮罩；宿主表面通过 `backdrop-filter` 磨砂 + `theme.overrideTokens` 覆盖 `--dsw-alias-*` 令牌变半透明，浅色/深色各一组，并按图片平均亮度自动加减遮罩。遮罩与暗角强度已内置为固定配方，不占用滑块。
- **设置面板整体暂停皮肤**：只要设置面板打开（不限于本页），背景层与配色覆盖一起撤下，设置界面回到宿主自己的配色；关掉设置立即恢复。这样不会出现「只有这一页是黑的、别的页还是透的」，也顺手省掉 `backdrop-filter` 这个最贵的合成。
- **动态效果**：GIF 与视频默认循环，视频默认静音；提供「动态效果」开关，并尊重系统的「减少动态效果」设置（系统开启时一律静态：GIF 显示首帧，视频显示封面帧）。
- **恢复默认**：一键撤下背景图与配色覆盖，回到宿主默认外观。
- **本地持久化**：素材（Blob）、调整参数和当前选择存放在 IndexedDB（库名 `dsh-custom-skin`），刷新或重启后自动恢复；界面语言偏好（默认中文，可切英文）同样持久化。
- **导入校验**：文件大小、扩展名、文件头（魔法字节）以及实际解码（`Image.decode` / `video` 元数据），任一失败都会回中文提示并保留当前皮肤。

---

## 环境要求

| 项目 | 要求 |
| --- | --- |
| DeepSeek Harness | 桌面端 `0.2.2-rc.3` 起步、现行为 `0.2.2-rc.5`（本插件按其客户端服务契约开发与实测） |
| 宿主客户端服务 | `theme`、`slots`（`settings.section`）、`locale` |
| 浏览器内核 | Electron 自带 Chromium（需支持 IndexedDB、`Image.decode`、`HTMLVideoElement`） |

宿主不支持 `theme` / `slots` 时插件不会崩溃：`apply()` 抛错会被捕获并打印一条日志，宿主界面保持可用。

---

## 安装

### 方式一：用插件管理安装本地目录（推荐）

1. 取得插件目录：`git clone https://github.com/Yito233/dsh_custom_skin.git`，或从 [Releases](https://github.com/Yito233/dsh_custom_skin/releases) 下载 `custom-skin-<版本>.zip` 解压。目录里已包含构建好的 `client.js`，**无需自己构建**。
2. 在 DeepSeek Harness 里让代理调用插件管理安装该目录（本插件就是这样安装并热生效的）：

   ```text
   plugin_manager action=install_bundle target=<插件目录的绝对路径>
   ```

3. 安装成功后，桌面端「设置 → 插件」中会出现 `@local/custom-skin`（默认已启用），「设置」导航中「通用设置」下方出现「自定义皮肤」。
   若设置页暂时没出现入口，刷新一次页面（`Ctrl+R`）——客户端模块表在页面加载时装配。

### 方式二：手动写入 profile（无插件管理时）

安装动作等价于在 profile 里登记依赖与 bundle：

1. 把 `custom-skin-<版本>` 目录放到任意位置，例如 `E:\plugins\custom-skin-0.1.0`。
2. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：
   - `dependencies` 增加 `"@local/custom-skin": "link:E:/plugins/custom-skin-0.1.0"`；
   - `dsh.profile.bundles` 数组末尾追加 `"@local/custom-skin"`。
3. 重启桌面端。

> 说明：本插件是纯客户端 bundle，宿主侧的 `apply()` 是空实现，因此不需要在 `cordis.patch.yml` 之外再做任何注册。

---

## 使用

1. 打开 **设置 → 自定义皮肤**（入口紧跟在「通用设置」下方）。
2. **导入本地素材**：选择 PNG / JPG / WebP / GIF / MP4（可多选）。导入后素材立即作为「预览」出现在背景层上，尚未持久化为当前皮肤。
3. 在「预览与调整」里调（左列是看得见的部分：预览、两个开关、强调色；右列是竖排滑块的数值区，一列一个）：
   - **显示方式**：填充（裁切铺满）/ 完整显示（留边）；
   - **缩放**、**画面亮度**（40%–160%，直接调图片本身，浅色模式压暗一点通常就够）；
   - **水平位置**、**垂直位置**（「完整显示」下禁用，因为此时居中留白、移动没有意义）；
   - **磨砂强度**：聊天区、输入框、菜单等宿主表面在图片上做半透明磨砂（`backdrop-filter`），文字保持清晰、图片仍透出颜色——这是「图片融入整个应用」的主要手段；
   - **面板透明度**、**强调色**（仅当宿主提供主题令牌覆盖能力时出现）；这两项只作用于主界面，所以预览图上叠了一张半透明小卡片，实时展示它们和磨砂叠加后的效果；
   - **动态效果**开关：GIF / 视频是否播放；**自动适配图片明暗**：按图片平均亮度微调遮罩，深色图和浅色图都不必手动反复拖滑块。
   - 每个滑块占一行、各自一张圆角卡片：左侧名称、右侧数字框（透明度/亮度按 0–100 的百分比显示，不会出现 `0.86` 这种小数；禁用时只把名称变淡，数值仍然清楚），下面是带进度填充的滑轨（悬停时滑块略微放大、聚焦时卡片描边变色），拖和键入两种方式都能用，输入即生效。
- 设置面板窄到 600 px 以下时（容器查询，跟面板宽度而不是窗口宽度），左预览 + 右滑块自动改成上下排列，数字框不会被挤出卡片。
   - 遮罩深浅与四周暗角已内置为固定配方（`CS_SCRIM_BASE` / `CS_VIGNETTE`），不占用滑块，也不用反复调；界面上不再放说明文字，所有控件只保留名称。
4. **应用**：写入本机存储，成为当前皮肤（重启后恢复）；结果提示出现在卡片底部「应用 / 取消」左侧。
   **取消**：丢弃本次预览，恢复到「应用之前」的外观（若之前没有皮肤，则恢复默认背景）。
5. **直接切换**：已经有皮肤在用时，在素材库里点另一个素材会立即切换（底部提示「已切换为 …」），不需要再点一次「应用」；想微调仍可继续拖滑块。
6. **关闭动态效果**：GIF / 视频变成静态首帧；系统开启「减少动态效果」时该开关不生效（以系统为准）。
7. **恢复默认**：清除背景层与配色覆盖，并清空本机保存的当前皮肤（已导入的素材仍保留在素材库，可再次选用）。
8. **界面语言**：设置页标题栏右侧可切换「中文 / English」，默认中文；该偏好与皮肤设置一起保存在本机，不跟随宿主语言变化。
9. **与其他主题共存**：本插件不改动宿主主题注册表；若某第三方主题被卸载而宿主仍指向它（外观卡在某套配色上），插件加载时会把宿主主题一次性修回「跟随系统」，避免留下无法退出的死配色。

### 素材库

- 素材以缩略图卡片展示，显示名称、类型（图片 / GIF / 视频）、大小；当前皮肤用「使用中」标记，预览中的素材用「预览中」标记。视频缩略图只显示首帧（不在网格里播放，避免同时解码几十个视频）。
- 「删除」会从本机存储移除该素材；删除前会弹出确认，若它正是当前皮肤，确认框会说明「删除后会恢复默认外观」，然后才撤下并删除。
- 离开设置页时若还有未「应用」的预览，会自动丢弃，应用不会停在无人标记的预览状态上。

---

## 支持格式与限制

| 限制项 | 值 |
| --- | --- |
| 单文件大小上限 | 64 MiB（`CS_MAX_BYTES`） |
| 素材数量上限 | 40 个（`CS_MAX_MATERIALS`） |
| 支持扩展名 | `.png .jpg .jpeg .webp .gif .mp4 .m4v .webm` |
| 缩放 | 1–3 倍 |
| 画面亮度 | 0.4–1.6（默认 1） |
| 磨砂强度（宿主表面） | 0–40 px（默认 14） |
| 面板透明度 | 0.4–1（默认 0.86） |
| 强调色 | `#RRGGBB` |
| 遮罩 / 暗角 | 固定配方，不可调（`CS_SCRIM_BASE` 0.34、`CS_VIGNETTE` 0.22） |

校验顺序：扩展名 → 文件大小 → 文件头 → 实际解码。任何一步失败都会显示中文提示（例如「文件格式不受支持」「文件超过 64 MiB」「无法解码该文件」），并且**不会**改动当前皮肤。

素材存放在浏览器 IndexedDB 中，不写入 profile 目录，也不上传到任何服务；卸载插件或清理浏览器数据会一并丢失（请保留原始素材文件）。

---

## 卸载

1. 打开 **设置 → 插件**，禁用或卸载 `@local/custom-skin`（或让代理调用 `plugin_manager` 移除该 bundle）。
2. 插件被卸载/禁用时会执行 `ctx.effect` 的清理函数：移除背景层 `<div id="dsh-cs-layer">`、`html.dsh-cs-active` 类、注入的样式表、主题令牌覆盖，并释放 `blob:` URL。外观立即恢复默认。
3. 如需彻底清除数据，可在桌面端开发者工具中删除 IndexedDB 数据库 `dsh-custom-skin`；不删除也不影响外观。

若走「方式二」手动安装，卸载即从 `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中移除对应条目后重启。

---

## 开发与构建

仓库根目录即插件包根目录。依赖：Node.js ≥ 20（实测使用 DSH 内置 Node v24.21.0），可选 Python 3 + Pillow 生成示例素材。

```bash
# 生成构建产物 client.js（把 src/ 三个片段拼进宿主模块表工厂）
node scripts/build.mjs

# 单元测试（纯函数 + 国际化）
node scripts/selftest.mjs

# 运行时冒烟测试（桩 DOM + 内存 IndexedDB 驱动完整换肤流程）
node scripts/harness.mjs

# 全部检查 + 校验 client.js 是否为最新构建
node scripts/selftest.mjs && node scripts/harness.mjs && node scripts/build.mjs --check

# 生成示例素材（Pillow；assets/ 里的 4 个示例文件由脚本自绘生成，仓库不附带二进制）
python scripts/make-samples.py

# 打包：dist/custom-skin-<版本>/ 与 dist/custom-skin-<版本>.zip（脚本会回读并校验 CRC）
# 缺少 assets/ 等可选目录时会跳过并提示，不影响打包出可安装的插件
node scripts/package.mjs
```

验证第三方主题共存时可以用一个测试夹具（`samples/sample-theme/`，与插件功能无关，验证完即可删除）：

```bash
# 装：plugin_manager install_bundle，目标为 E:\path\to\custom-skin\samples\sample-theme
# 它只做一件事：向宿主主题服务注册 id 为 solar-dusk 的深色主题。
# 卸载：plugin_manager remove_bundle target=@local/skin-sample-theme
```

### 源码结构

| 路径 | 作用 |
| --- | --- |
| `package.json` | bundle 清单：`exports`、`files`、`dsh.bundle.patch`、`dsh.client` |
| `cordis.patch.yml` | 把 `@local/custom-skin` 插入宿主插件树 |
| `index.js` | 宿主侧入口（空实现，本插件是纯客户端 bundle） |
| `src/core.js` | 纯函数：格式识别、文件头嗅探、参数归一化、样式与主题令牌计算 |
| `src/i18n.js` | 中英文案与 `t()` 实现 |
| `src/main.js` | 引擎（背景层、IndexedDB、主题接入）与设置页 UI |
| `client.js` | **构建产物**，由 `scripts/build.mjs` 生成，不要手改 |
| `locale/zh.json`、`locale/en.json` | 插件元信息（`meta.title` / `meta.description`） |
| `icon.svg` | 插件图标（原创，渐变 + 山形与太阳） |
| `assets/` | 示例素材（自绘，MIT 可再分发） |
| `samples/sample-theme/` | **测试夹具**：一个极简第三方主题插件（主题 id `solar-dusk`），仅用于验证与其它主题共存，不属于功能的一部分，可随时卸载删除 |
| `scripts/build.mjs` | 校验清单并拼接 `client.js` |
| `scripts/selftest.mjs` | 纯函数单元测试（22 项） |
| `scripts/harness.mjs` | 端到端冒烟测试（24 项） |
| `scripts/package.mjs` | 生成未打包目录 + zip，并回读校验 |

### 实现要点

- **背景层**：宿主没有「位于内容之下」的插槽（`shell.overlay` 在所有列之上），因此插件在 `document.body` 上挂一个 `position: fixed; z-index: -1` 的层，并把 `html/body` 背景设为透明。这是宿主自身「固定浮层要 portal 到 body」的约定下唯一可行的做法。
- **配色覆盖**：通过 `ctx.theme.overrideTokens('@local/custom-skin', {...})` 把 `--dsw-alias-bg-base` 等表面令牌改成半透明，使聊天正文、输入框和菜单仍由宿主令牌驱动，浅色/深色各自取值；面板透明度与强调色也走同一接口。深色模式的面板比浅色更实一些（浅色文字压在照片上更吃力）。
- **性能**：令牌覆盖只在「面板透明度 / 强调色」变化时重新下发（用 `opacity|accent` 作为记忆键），磨砂通过一个 CSS 变量下发而不是逐元素写样式；设置面板打开期间整层皮肤暂停（见下）——`backdrop-filter` 是全窗口最贵的一次合成，滚动时最容易被感知。
- **设置面板期间暂停皮肤**：宿主没有「设置面板是否打开」的服务，因此插件用 `MutationObserver` + 捕获阶段的 `pointerdown`/`keydown` 观察文档里是否存在 `[aria-modal="true"|role=dialog|role=alertdialog|dialog[open]`，再加上「本页已挂载」这个确定信号，两者取或；面板打开时撤下背景层并 `dispose` 令牌层，配色交还宿主，关闭后原样恢复。
- **融入而非贴图**：三层组合——背景图（可调亮度/缩放/位置）+ 带暗角的固定遮罩（`radial-gradient` 中心通透、边缘更暗）+ 宿主表面 `backdrop-filter` 磨砂。参考了系统级图片背景类工具的做法（把「界面相对背景的透明度」与「图片自身处理」分开，界面过于透明会伤可读性），以及玻璃拟态对「半透明底色 + 背景模糊 + 1px 边缘」的配方。
- **自动明暗适配**：导入时把素材缩到 24×24 取样，按相对亮度估算平均色调并存进记录；渲染时按「深色模式配浅色文字，浅色图需要更实的遮罩」的方向微调遮罩透明度，用户仍可手动覆盖（关掉开关即完全按滑块取值）。
- **动态效果**：`matchMedia('(prefers-reduced-motion: reduce)')` 变化时实时生效，无需重载。
- **错误隔离**：`apply()` 与设置页组件都包在 try/catch 中，失败只影响本插件，不会让宿主设置页崩溃；若挂载在注册设置项之前失败，设置页会显示失败阶段而不是空白。

---

## 实测记录

验证环境（本人实测）：

| 项目 | 值 |
| --- | --- |
| 操作系统 | Windows 11（NT 10.0.26300），AMD64 |
| DeepSeek Harness | 桌面端 `0.2.2-rc.5`（`@deepseek-ai/dsh`，profile `desktop`；开发起始版本为 `0.2.2-rc.3`） |
| 运行时 | DSH 内置 Node.js v24.21.0 |

> 下表「实测」指在官方桌面端里真实操作并观察结果；「已覆盖（离线）」指由 `scripts/harness.mjs` 的桩 DOM 测试覆盖，尚未在真实窗口里点过。

| 验证项 | 结果 |
| --- | --- |
| 安装 | ✅ 实测：`plugin_manager install_bundle` 返回 `application: applied`，profile 依赖出现 `"@local/custom-skin": "link:…"`，重启后在 **设置 → 自定义皮肤** 看到入口 |
| 静态图片背景 | ⏳ 待补（离线已覆盖：导入 → 预览 → 应用 → 令牌覆盖） |
| GIF | ⏳ 待补（离线已覆盖：动画播放 / 关动效后取首帧 / 系统减弱动态优先） |
| 视频（MP4 / WebM） | ⏳ 待补（离线已覆盖：静音 + 循环 + `playsinline`；本机无 MP4/WebM 样本，WebM 是否可解码尚未实测） |
| 取消预览 | ⏳ 待补（离线已覆盖：取消后恢复应用前外观） |
| 设置面板暂停皮肤 | ⏳ 待补（离线已覆盖：面板打开时背景层隐藏、令牌层撤回；关闭后恢复） |
| 滑块美化成卡片、窄面板自动单列 | ⏳ 待补（离线已覆盖：渲染不报错、数值框与滑轨同步；真实窗口外观未亲眼确认） |
| 应用成功的绿色反馈 | ⏳ 待补（离线已覆盖：`flash.applied` 在按钮旁出现，按钮短暂变绿，4 秒后消失） |
| 重启恢复 | ⏳ 待补（离线已覆盖：新引擎实例从 IndexedDB 恢复素材、参数与语言） |
| 坏文件提示 | ⏳ 待补（离线已覆盖：格式不符 / 超大 / 解码失败均给中文提示且保留当前皮肤） |
| 与第三方主题共存 | ✅ 部分实测：临时装入夹具主题 `solar-dusk` 后（旧版本带切换下拉框时）宿主配色确实变成橙色；卸载夹具后宿主仍指向该 id，新版会在加载时把主题修回「跟随系统」——**修复动作本身只经离线覆盖，未在真实窗口确认** |
| 卸载恢复 | ⏳ 待补（离线已覆盖：清理背景层、样式表、根类、令牌层、`blob:` URL；`remove_bundle` 返回 `application: applied`） |

> 说明：本机桌面端为自签/受限环境，代理无法向窗口发送快捷键或读取页面控制台，因此上表「实测」行由人工点击确认后逐行补齐；离线行由 `node scripts/harness.mjs` 在桩 DOM 上跑通，可作为发布前的回归证据。

---

## 发布与后续发版

本仓库已开源在 <https://github.com/Yito233/dsh_custom_skin>，采用 MIT 许可证。

当前版本 `v0.1.0`。预构建包 `dist/custom-skin-0.1.0.zip` 需要在发布页作为附件上传（浏览器的发布页面支持直接把 zip 拖进附件区；或用 GitHub CLI）：

```bash
node scripts/package.mjs
gh release create v0.1.0 dist/custom-skin-0.1.0.zip \
  --title "v0.1.0" \
  --notes "首个版本：本地图片 / GIF / 视频换肤、预览与微调、设置面板暂停皮肤、重启恢复。"
```

后续版本：

```bash
# 1) 改版本号：package.json 的 version、README 顶部说明、locale 文案按需更新
# 2) 全绿后再打包
node scripts/selftest.mjs && node scripts/harness.mjs && node scripts/build.mjs --check
node scripts/package.mjs
# 3) 提交并打标签
git add -A && git commit -m "feat: v0.2.0"
git tag -a v0.2.0 -m "v0.2.0"
git push origin main --tags
# 4) 建 Release 并附上 zip
gh release create v0.2.0 dist/custom-skin-0.2.0.zip --title "v0.2.0" --notes "更新说明…"
```

发版前检查清单：

1. `node scripts/selftest.mjs && node scripts/harness.mjs && node scripts/build.mjs --check` 全绿。
2. `package.json` 的 `version`、`locale/*.json` 的文案、README 的「实测记录」都已更新。
3. `.gitignore` 已排除 `dist/`、`node_modules/`；预构建包作为 release 附件分发。
4. 在干净的 profile 里按「安装」一节点一遍，确认安装 → 换肤 → 卸载三件事。

---

## 许可证

本项目采用 [MIT](LICENSE)，版权行为 `Copyright (c) 2026 Yito233`。如需更换版权主体，请同时修改 `LICENSE` 与本行。

`assets/` 中的示例素材由本仓库脚本自绘生成（`scripts/make-samples.py`），可随仓库以 MIT 再分发。
