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
| 6 | `appearance.js` | 外观预设 `LIBRARY_APPEARANCES` 与归一化函数 | ⬜ 未拆分 |
| 7 | `binary-utils.js` | zip 构造（crc32/createStoredZip）、base64/DataURL 转换 | ⬜ 未拆分 |
| 8 | `metadata-match.js` | 标题/作者相似度匹配、DOI/arXiv 归一化、发表类型推断 | ⬜ 未拆分 |

## 阶段二：UI 辅助与弹窗

| # | 模块 | 内容 | 状态 |
|---|------|------|------|
| 9 | `ui-utils.js` | `setPaperlibIcon`、`iconButton`、`itemViewContentRoot`、图标别名表 | ⬜ 未拆分 |
| 10 | `modals/` | 15 个弹窗按域分组：删除确认、本地管线、引文样式、图片浏览 | ⬜ 未拆分 |

## 阶段三：视图层

| # | 模块 | 内容 | 状态 |
|---|------|------|------|
| 11 | `views/research-workspace.js` | `PaperResearchWorkspaceView` 研究画布（约 2,600 行） | ⬜ 未拆分 |
| 12 | `views/library-view.js` | `PaperLibraryView` 主视图及 Navigation/Detail 子类 | ⬜ 未拆分 |
| 13 | `settings.js` | `PaperLibrarySettingTab` 设置页（约 730 行） | ⬜ 未拆分 |

## 阶段四：插件主类瘦身（约 13,500 行，风险最高，最后做）

| # | 模块 | 内容 | 状态 |
|---|------|------|------|
| 14 | `services/semantic-scholar.js` | Semantic Scholar 请求与缓存 | ⬜ 未拆分 |
| 15 | `services/pdf-figures.js` | PDF 图片识别渲染（含 `getPdfImageRegions` 等头部工具） | ⬜ 未拆分 |
| 16 | `services/research-workspace-store.js` | 研究画布的持久化与自动整理 | ⬜ 未拆分 |
| 17 | `services/self-update.js` | 插件自更新流程（使用 update-checker） | ⬜ 未拆分 |
| 18 | `main.js` 收尾 | 插件类只保留 onload 装配与方法委托 | ⬜ 未拆分 |

## 拆分记录

### ✅ 1. citation-engine.js（commit `83bf88b`）

759 行。引文模板引擎是纯逻辑，对外零依赖，逐字节搬运。`isLikelyChinesePersonalName`（中文人名启发式）随模块迁出并导出——它同时被元数据作者拆分使用。`PaperLibraryPlugin.citationInternals` 测试接口不受影响。模块可直接在 Node 中 import 渲染引文。

### ✅ 2. venue-rankings.js（commit `34e4082`）

317 行。排名规则表（CCF/CORE/TH-CPL）、ShowJCR/ccfddl/cs-conf-stats 数据源地址、venue 推断逻辑。`isRepositoryVenue` 从 600 行外归位到本模块。两个 `SEMANTIC_SCHOLAR_PAPER_CACHE_*` 常量刻意留在 main.js，等 Semantic Scholar 服务（#14）拆分时带走。

### ✅ 3. text-utils.js（commit `34e4082`）

18 行。`stripMarkup` 在 main.js 有 63 处调用，是第一个共享工具模块，确立了"上层可依赖工具层、工具层不反向依赖"的方向。

### ✅ 4. update-checker.js

63 行。版本号比较、Release 资源选择、zip 路径穿越检查，纯逻辑零依赖。`PAPER_LIBRARY_UPDATE_FILES` 仅内部使用故不导出。`update.test.js` 通过 `updateInternals` 静态属性间接覆盖，逐字节搬运验证通过。

### ✅ 5. demo-data.js

161 行。`SAMPLE_PAPERS` 示例论文及 `DEMO_PAPER_IDS/TAGS/COLLECTIONS` 派生集合，纯数据零依赖。示例数据占了原文件一大块，搬出后入口文件的可读性明显改善。逐字节搬运验证通过。
