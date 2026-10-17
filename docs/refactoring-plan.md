# main.js 模块化拆分计划

目标：把单文件 23,483 行的 `main.js` 拆分为按领域组织的 `src/` 模块，经 esbuild 打包为根目录 `main.js`（产物，不入库）。

工作分支：`refactor/esbuild-setup`。

## 拆分原则

- **逐字节搬运**：每个模块的内容与原文件逐字节一致（程序化验证），保持 git blame 可用。
- **依赖单向**：`text-utils`（纯文本工具）→ `citation-engine` / `venue-rankings` → 上层服务 → 视图 → 插件入口。禁止反向依赖。
- **Node 可直接 import**：模块使用带 `.js` 扩展名的 ESM，不依赖 Obsidian 的模块可以在 Node 里直接做单元测试。
- **每个模块一个 commit**：拆完立即重建产物、跑全量测试、通过后提交，并更新本文档状态。
- **测试语义**：执行代码的测试跑打包产物（根 `main.js`）；断言源码约定的测试读 `src/` 下的源文件。

## 阶段一：纯逻辑与数据模块（无 Obsidian 依赖）

| # | 模块 | 内容 | 状态 |
|---|------|------|------|
| 1 | `citation-engine.js` | 引文模板引擎：CSL 解析、模板渲染、作者格式化 | ✅ 已拆分 |
| 2 | `venue-rankings.js` | CCF/CORE/TH-CPL 排名规则表、数据源地址、venue 推断 | ✅ 已拆分 |
| 3 | `text-utils.js` | `decodeEntities`、`stripMarkup` 共享文本工具 | ✅ 已拆分 |
| 4 | `update-checker.js` | 版本比较、Release 资源选择、zip 条目安全检查 | ✅ 已拆分 |
| 5 | `demo-data.js` | `SAMPLE_PAPERS` 示例论文与 DEMO_* 派生集合 | ✅ 已拆分 |
| 6 | `appearance.js` | 外观预设 `LIBRARY_APPEARANCES` 与归一化函数 | ✅ 已拆分 |
| 7 | `binary-utils.js` | zip 构造（crc32/createStoredZip）、base64/DataURL 转换 | ✅ 已拆分 |
| 8 | `metadata-match.js` | 标题/作者相似度匹配、DOI/arXiv 归一化、发表类型推断 | ✅ 已拆分 |

## 阶段二：UI 辅助与弹窗

| # | 模块 | 内容 | 状态 |
|---|------|------|------|
| 9 | `ui-utils.js` | `setPaperlibIcon`、`iconButton`、`itemViewContentRoot`、图标别名表 | ✅ 已拆分 |
| 10 | `paper-utils.js` / `collection-utils.js` / `text-utils.js` 扩充 | 为 modals 拆分准备的共享工具层：id 生成、文件名、标签、DOI/arXiv、收藏夹路径、通用格式化 | ✅ 已拆分 |
| 11 | `modals/` | 17 个弹窗按域分组：删除确认、本地管线、引文样式、图片浏览 | ✅ 已拆分 |

## 阶段三：视图层

| # | 模块 | 内容 | 状态 |
|---|------|------|------|
| 12a | `constants.js`（前置） | 视图/表格/外观/Composer 共享常量；`isPaperLibraryMobile`、`highlighterCursor` 入 ui-utils；`bytesContainAscii` 入 binary-utils；`TITLE_MATCH_THRESHOLD` 入 metadata-match | ✅ 已拆分 |
| 12 | `research-workspace-view.js` | `PaperResearchWorkspaceView` 研究画布（约 2,600 行） | ✅ 已拆分 |
| 13 | `library-view.js` | `PaperLibraryView` 主视图及 Navigation/Detail 子类 | ✅ 已拆分 |
| 14 | `settings.js` | `PaperLibrarySettingTab` 设置页（约 730 行） | ✅ 已拆分 |

## 阶段四：插件主类瘦身（约 13,500 行，风险最高，最后做）

| # | 模块 | 内容 | 状态 |
|---|------|------|------|
| 15 | `services/semantic-scholar.js` | Semantic Scholar 请求与缓存 | ✅ 已拆分 |
| 16 | `services/pdf-figures.js` | PDF 图片识别渲染（头部死代码已删除） | ✅ 已拆分 |
| 17 | `services/research-workspace-store.js` | 研究画布的持久化与自动整理 | ⬜ 未拆分 |
| 18 | `services/self-update.js` | 插件自更新流程（使用 update-checker） | ✅ 已拆分 |
| 19 | `main.js` 收尾 | 插件类只保留 onload 装配与方法委托 | ⬜ 未拆分 |

## 拆分记录

### ✅ 1. citation-engine.js（commit `83bf88b`）

759 行。引文模板引擎是纯逻辑，对外零依赖，逐字节搬运。`isLikelyChinesePersonalName`（中文人名启发式）随模块迁出并导出——它同时被元数据作者拆分使用。`PaperLibraryPlugin.citationInternals` 测试接口不受影响。模块可直接在 Node 中 import 渲染引文。

### ✅ 2. venue-rankings.js（commit `34e4082`）

317 行。排名规则表（CCF/CORE/TH-CPL）、ShowJCR/ccfddl/cs-conf-stats 数据源地址、venue 推断逻辑。`isRepositoryVenue` 从 600 行外归位到本模块。两个 `SEMANTIC_SCHOLAR_PAPER_CACHE_*` 常量刻意留在 main.js，等 Semantic Scholar 服务（#15）拆分时带走。

### ✅ 3. text-utils.js（commit `34e4082`）

18 行。`stripMarkup` 在 main.js 有 63 处调用，是第一个共享工具模块，确立了"上层可依赖工具层、工具层不反向依赖"的方向。

### ✅ 4. update-checker.js

63 行。版本号比较、Release 资源选择、zip 路径穿越检查，纯逻辑零依赖。`PAPER_LIBRARY_UPDATE_FILES` 仅内部使用故不导出。`update.test.js` 通过 `updateInternals` 静态属性间接覆盖，逐字节搬运验证通过。

### ✅ 5. demo-data.js

161 行。`SAMPLE_PAPERS` 示例论文及 `DEMO_PAPER_IDS/TAGS/COLLECTIONS` 派生集合，纯数据零依赖。示例数据占了原文件一大块，搬出后入口文件的可读性明显改善。逐字节搬运验证通过。

### ✅ 6. appearance.js

95 行。5 套内置外观预设（`LIBRARY_APPEARANCES`）和设置的归一化/对比度计算函数，纯数据与纯函数。把外观应用到 DOM 的逻辑留在插件主类，属于阶段四的范畴。逐字节搬运验证通过，Node 直接 import 验证预设数与对比色计算正确。

### ✅ 7. binary-utils.js

96 行。无压缩 zip 构造（`createStoredZip`，带 CRC32，自更新安装包用）和 base64/DataURL 转换。`concatBytes`/`littleEndian`/`crc32` 是内部构件不导出。逐字节搬运验证通过；Node 直接 import 验证 zip 魔数（PK）与 base64 往返正确。

### ✅ 8. metadata-match.js

199 行。标题/作者相似度（Dice 系数 + CJK 处理）、Crossref venue 提取、发表类型推断、文件名转标题等。这是第一个**跨模块依赖**的示范：import 了 text-utils（`stripMarkup`）、citation-engine（`isLikelyChinesePersonalName`）、venue-rankings（`findVenueRankingRule`、`isRepositoryVenue`），验证了单向依赖分层可行。逐字节搬运验证通过。

## 阶段一完成

至此阶段一（纯逻辑与数据模块）全部完成，main.js 头部约 1,150 行的工具区收缩约 780 行。剩余区域为 UI 辅助、视图类与插件主类，进入阶段二。

### ✅ 9. ui-utils.js

86 行。`setPaperlibIcon`（89 处调用）、`iconButton`（54 处）、`itemViewContentRoot`（8 处）及图标别名/符号兜底表。模块改为直接 `import { setIcon } from "obsidian"`，删掉了原来的 `obsidianSetIcon` 别名中转。阶段二开始模块依赖 Obsidian，验证方式改为打包产物 + 测试套件。

附带发现并处理：`claudian-integration`/`mobile` 两个测试的源码断言因代码搬走而失败，已改为同时读 `src/ui-utils.js`。另外确认 `highlight`/`mobile`/`semantic-scholar` 三个测试（不在 npm test 链中）在重构前的基线 commit 上就以相同方式失败，属历史遗留，与本次拆分无关。

### ✅ 10. paper-utils.js / collection-utils.js / text-utils.js 扩充

121 + 45 + 37 行。拆 modals 的前置：弹窗依赖的 `uniqueId`、`normalizePaperTags`、`expandCollectionPaths` 等 helper 原本都在 main.js 顶层，直接拆弹窗会形成 modals → main.js 的反向依赖。先把它们沉淀为共享工具层：`paper-utils`（id/文件名/标签/DOI/arXiv）、`collection-utils`（收藏夹路径，依赖 paper-utils 的 `safeFileName`）、text-utils 扩充（`truncate`/`markdownText`/`formatAIFileSize`/`formatAIRemainingTime`）。每段逐字节验证通过。

### ✅ 11. modals/（6 个文件，17 个弹窗类）

按域分组：`paper-form.js`（论文表单/标签）、`delete.js`（6 个删除确认）、`pipeline.js`（图片识别与本地管线）、`figures.js`（图片画廊/轮播）、`citation.js`（CSL 导入/样式编辑）、`misc.js`（会议关注/原生批注）。每个文件显式声明自己需要的 obsidian API 与工具模块——`citation.js` 依赖 citation-engine，直观体现了模块分层。所有类逐字节搬运验证通过。

### ✅ 12a. constants.js（阶段三前置）

209 行。视图层与插件主类共享的常量全部归位：视图类型标识、`CANVAS_HIGHLIGHT_COLORS`、`PAPER_TABLE_*`、`FAVORITE_COLORS`、`PAPER_COMPOSER_*`、`DEFAULT_SETTINGS`。`DEFAULT_SETTINGS` 引用了 appearance 模块的 `APPEARANCE_PROTOCOL_VERSION`（第一轮遗漏，测试捕获后补上 import）。同时把几个散落的工具归位到语义正确的模块：`isPaperLibraryMobile`/`highlighterCursor` → ui-utils，`bytesContainAscii` → binary-utils，`TITLE_MATCH_THRESHOLD` → metadata-match。

测试基建同步改造：`claudian-integration`/`pdf-ai-modes`/`mobile` 三个"源码约定"测试从读单个文件改为拼接整个 `src/**/*.js`，后续拆分不再需要逐个文件改测试。

### ✅ 14. settings.js

747 行。设置页是视图层里依赖最简单的类，按方案第一个拆。依赖全部显式声明：obsidian（PluginSettingTab/Setting/Notice/setIcon）、constants（色板与默认设置）、appearance、text-utils，以及它要打开的 6 个弹窗（citation/delete/pipeline 三个模块）。逐字节搬运验证通过。原计划编号 12-14 的执行顺序调整为 14 → 12 → 13（按风险从低到高）。

### ✅ 12. research-workspace-view.js

2,657 行。研究画布整体搬走：PDF 懒渲染、文字层选择、荧光笔/画笔/AI 圈选、画布节点与连线。对插件的交互全部通过构造注入的 `plugin`，无需任何改动。`pdf-loading.test.js` 通过 eval 打包产物引用 `PaperResearchWorkspaceView` 顶层类名，验证了 esbuild 会把模块类提升到产物顶层作用域。逐字节搬运验证通过。

### ✅ 16. services/pdf-figures.js

717 行。24 个方法：识别结果目录的加载/缓存/迁移、画布拖拽区、位图渲染（DocLayout 裁剪 / PDF 图像对象）与高分辨率导出。DocLayout 运行时的安装/卸载属管线域，留在主类等后续管线服务。计划中的 `getPdfImageRegions`/`getPdfFigureCaptions`/`pdfMatrixPoint` 经全仓库检索确认是 DocLayout 管线取代的旧实现死代码，已单独提交删除（`fcd0e4c`）。逆变换验证（`plugin`→`this` 还原后与原文逐字节一致）通过。

### ✅ 15. services/semantic-scholar.js

456 行。18 个方法（请求、重试退避、别名索引缓存、字段映射、兜底合并）+ 两个 `SEMANTIC_SCHOLAR_PAPER_CACHE_*` 常量一并归位。教训：第一轮依赖池是手工列的，漏了 `normalizePaperTags` 导致运行时 ReferenceError——此后每个服务模块都做"导出符号全表扫描"验证缺失导入。`semantic-scholar.test.js` 的失败点与基线逐字节一致（URL 断言差异是历史遗留）。

### ✅ 18. services/self-update.js（阶段四开始，委托模式首个示范）

189 行。自更新五方法（检查/列 zip/解压/收集文件/安装）搬到 services，方法体仅做 `this` → `plugin` 机械替换（19 处，替换数与原文一致），主类留五个单行委托壳。`update.test.js` 覆盖的 `updateInternals` 不受影响。阶段四策略落地：调用点零改动。

### ✅ 13. library-view.js

3,144 行。主视图 + Navigation/Detail 两个子类一起搬（继承链同模块）。至此阶段三完成：main.js 只剩 PDF 头部工具函数（等 #16 带走）和插件主类。
