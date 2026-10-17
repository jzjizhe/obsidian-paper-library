# 研究画布 PDF 阅读器功能补齐计划

目标：把研究画布（`src/research-workspace-view.js`）里的 PDF 阅读区补齐到常规 PDF 阅读器的水准。

工作分支：每项功能从 main 切独立分支或直接在 main 上小步提交，由当时决定。

## 实施原则

- **每完成一项更新本文档状态**，并附简要实现说明。
- **UI 改动必须在 Obsidian 里实际验证**（点击、输入、滚动、缩放走一遍真实流程），仅靠测试套件不算完成。
- 优先复用现成数据：`pdfCache.pageViews` 已持有每页元素与 `data-page`，`updateWorkspacePdfVisibility` 已在跟踪可见页。
- 每页渲染管线（`pdfRenderToken` + 超采样）已支持重渲染，改缩放档位时不要绕过它。

## P0：便宜且影响大

| # | 功能 | 现状 | 状态 |
|---|------|------|------|
| 1 | 当前页/总页数 | meta 条的"当前 M 页"实为已缓存页数（`pdfCache.pages.size`），随缓存驱逐变小，是误导性显示 | ✅ 已实现 |
| 2 | 跳页输入框 | 完全没有 | ✅ 已实现 |
| 3 | 回首页 | 没有 | ✅ 已实现 |
| 4 | 上一页/下一页 | 没有 | ✅ 已实现 |

计划形态：meta 条改造成迷你导航条 `⏮ ◀ [当前页/总页数] ▶ ⏭`，一次做完四项。落点：`renderPdfDocument` 的 meta 条（约 1209 行）+ `updateWorkspacePdfVisibility` 的可见页跟踪。

## P1：阅读体验核心

| # | 功能 | 现状 | 状态 |
|---|------|------|------|
| 5 | 可编辑缩放百分比 | 工具栏百分比是只读 `<span>`，且缩放作用于整个画布 | ⬜ 未做 |
| 6 | PDF 独立缩放档位 | PDF 页宽写死约 660px，只能随画布缩放 | ⬜ 未做 |
| 7 | PDF 内文字搜索 | 工具栏搜索只过滤画布摘录/笔记 | ⬜ 未做 |
| 8 | 滚动位置实时反馈 | 原生滚动条，拖动无页码提示 | ⬜ 未做 |

说明：5 与 6 一起做（百分比可输入 + PDF 框独立档位，持久化到 `workspace.pdfFrame`）；7 基于已渲染的文字层做匹配高亮与上/下一个跳转；8 的轻量版是滚动时 meta 条实时更新当前页（做 P0 后顺手完成），完整版（页码标尺）视需要再议。

## P2：锦上添花

| # | 功能 | 状态 |
|---|------|------|
| 9 | 目录/大纲面板（`document.getOutline()`） | ⬜ 未做 |
| 10 | 键盘导航（PageUp/PageDown/Home/End） | ⬜ 未做 |
| 11 | 适合宽度/适合页面（配合 6） | ⬜ 未做 |
| 12 | 页面旋转、单页/连续切换（论文场景用得少，最后考虑） | ⬜ 未做 |

## 实施记录

### ✅ P0：页码导航条

meta 条改为迷你导航条 `⏮ ◀ [页码输入] / 总页数 ▶ ⏭`：

- **当前页跟踪**：`updateWorkspacePdfVisibility` 本就在逐页算可见矩形，加了一条探针线（视口顶部 +24px），最后一个顶边在探针上方的页即当前页；输入框聚焦时滚动不覆盖正在键入的值。
- **跳页/翻页/首末页**：`scrollWorkspacePdfToPage` 复用 `scrollWorkspacePdfDestination` 的坐标换算（getBoundingClientRect 含画布缩放、scrollTop 不含，需除以 hostScaleY），目标页渲染期间用 `pinned` 计数防止被可见性回收。
- **修正误导显示**：删除 `updateWorkspacePdfProgress`（显示的是缓存页数），当前页只在滚动时由可见性计算更新。
- 输入框支持 Enter 提交、Escape 还原、失焦提交、越界/非数字回退当前页。
- 落点：`src/research-workspace-view.js`（renderPdfDocument / updateWorkspacePdfVisibility / 新增三个方法），样式在 styles.css（meta 内按钮缩小至 22px、输入框样式）。
- **待验证**：需在 Obsidian 里人工验证（本计划实施原则第 2 条）。
