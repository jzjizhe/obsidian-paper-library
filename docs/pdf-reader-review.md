# PDF 阅读器与插件优化清单

> 对照当前原生 PDF 阅读器与插件整体代码的复查结果。按优先级分为 P0/P1/P2。
> 本轮先处理 P0 的 1–4；后续项先记录，不在本轮修改。

## P0：确定性 Bug / 数据安全

- [x] **1. `pdfOpenPosition=first` 不生效**
  - 位置：`src/main.js` 的 `pinNativePdfToFirstPage`。
  - 原因：纠偏条件只有 `pageTop > scrollerTop + 48`，只处理“第 1 页在视口下方”的情况。Obsidian 恢复到第 N 页时，第 1 页在视口上方，条件永远不成立，钉回逻辑实际没有执行。
  - 处理：按页顶与滚动容器顶部的实际差值向上/向下纠正；程序性滚动只操作 PDF 自己的滚动容器。

- [x] **2. 形状命中范围覆盖整个内部**
  - 位置：`pdfShapeHitTest`、`handleNativePdfContextMenu`、`collectNativePdfEraseTargets`。
  - 原因：矩形/椭圆只要点在内部就命中，且右键菜单里形状判断排在文字/高亮之前；大形状会挡住内部的高亮、文本框和文字菜单。
  - 处理：矩形/椭圆只命中描边（保留几像素容差），线与箭头继续按线段距离命中；橡皮和右键使用同一规则。

- [x] **3. “查看本文所有标注”只显示高亮**
  - 位置：`src/modals/annotations.js`。
  - 原因：只读取 `workspace.highlights`，没有列出 `paper.annotations`（文本框/注释）、`inkStrokes`（画笔）、`pdfShapes`（形状）。
  - 处理：按页聚合并分组展示高光、下划线、文本框、注释、画笔、形状；支持跳页与逐条删除。

- [x] **4. PDF 写回缺少备份与退出兜底**
  - 位置：`mutateLocalPdf`、`onunload`、`flushPdfAnnotationSyncs`。
  - 原因：`mutateLocalPdf` 直接 `modifyBinary` 覆盖原文件，没有备份；`onunload` 里的写回是 fire-and-forget，直接退出 Obsidian 时最后一笔可能丢失。
  - 处理：每个 PDF 在本次会话首次写回前生成一份备份到插件目录；窗口失焦/页面隐藏时主动 flush 待写回队列；写回失败保留队列项。

## P1：体验与一致性

- [x] **5. 画笔和形状不写回 PDF**
  - 已实现：画笔、直线、箭头、圆、椭圆、矩形写成 PDF Ink 注解；打开 PDF 时会自动补写历史画笔/形状。
  - 已处理重复显示：写回后的 Ink 由 PDF 注释层绘制，覆盖层不再重复绘制；删除/擦除/清空会同步移除 PDF 注解。

- [x] **6. 文本框写回中文/布局异常**
  - 原因：`context.obj` 会把 `PDFString`/`PDFHexString` 再包一层 `<< /value ... >>`，导致写回的 `/Contents`、`/DA`、`/T`、`/NM` 都不是合法字符串；同时矩形宽度/高度按半角字符估算，中文和显式换行会溢出。
  - 处理：改为 `annotation.set(...)` 直接写入字符串对象；矩形按中文全角/显式换行重新计算；兼容旧版包了一层的坏注解。已用 Preview 渲染验证中文能完整落在框内。

- [x] **7. 标注持久化开销**
  - 已实现：画笔/形状的内存数据即时更新，`settings` 写入合并为 350ms 防抖；失焦、页面隐藏和卸载时主动 flush。
  - 写回 PDF 也按路径批量处理，多条画笔/形状一次重写文件。

- [ ] **8. 工具栏拥挤**
  - 现状：原生工具栏已有 11 个按钮，窗口较矮时较挤。
  - 建议：增加单键快捷键（如 V/H/U/P/T/S/E），把清空/列表/图片收进“更多”菜单；移动端单独验证。

- [x] **9. 缺少撤销/重做**
  - 已实现：`Cmd+Z` / `Cmd+Shift+Z`（Windows 也支持 `Ctrl+Y`）撤销/重做高亮、下划线、文本框、注释、画笔和形状的新建/删除。
  - 清空/橡皮擦按一个批量操作撤销；输入框和文本框编辑中不拦截快捷键，保留 Obsidian 原生文本撤销。

- [ ] **10. 注释工具移除后的入口**
  - 现状：已有注释徽标仍可显示和打开，但无法新建 sticky note。
  - 建议：如果文本框已经替代注释则保持；否则在选区弹条增加“注释”入口。

- [ ] **11. 旋转页面坐标**
  - 现状：高亮、文本框、形状均按页面左上角比例换算。
  - 影响：`/Rotate 90` 等旋转页面可能偏移。
  - 建议：用一份旋转过的 PDF 验证，必要时按 page rotation 修正坐标。

## P2：架构与维护

- [x] **12. `src/main.js` 体积**
  - 已完成阶段五：PDF 阅读器拆到 `src/pdf-reader/`，按 writeback、overlays、textbox、marks、ink-shapes、undo、reading-position、toolbar 八个模块组织；主类保留 mixin 安装，调用点零改动。`src/main.js` 从 15,721 行降到约 11,474 行。

- [x] **13. 调试命令留在正式版**
  - 已完成：新增“开发者 → 显示调试命令”开关（默认关闭）。`merge-overlapping-highlights`、`rewrite-pdf-annotations`、所有 `debug-*` 命令仅在开启并重新加载插件后注册。

- [ ] **14. 测试覆盖缺口**
  - 现状：`highlight.test.js`、`mobile.test.js`、`semantic-scholar.test.js`、`extension-server.test.js` 未纳入 `npm test`；文本框写回仍缺少专门测试。
  - 已补：形状几何/命中检测（`test/pdf-shapes.test.js`）、阅读位置纠偏（`test/pdf-reading-position.test.js`）、PDF 写回备份断言。
  - 建议：修复或明确跳过历史失败用例；补充文本框写回测试。

## 本轮完成记录

- **1**：新增 `alignNativePdfFirstPage`，按页顶与滚动容器顶部的差值向上/向下纠正；补充 `test/pdf-reading-position.test.js`。
- **2**：`pdfShapeHitTest` 的矩形/椭圆改为只命中描边；右键菜单中形状判断移到文字与已有标注之后；橡皮共用描边命中规则。
- **3**：`PdfAnnotationsModal` 聚合高光、下划线、文本框、注释、画笔、形状，按页排序并支持逐条删除。
- **4**：每个 PDF 在本次会话首次写回前备份到插件目录 `pdf-backups/`；窗口失焦或页面隐藏时主动 flush；写回失败保留队列项并去重提示。
- **写回回归修复**：修复 `context.obj` 把 PDF 字符串包成 `<< /value ... >>` 的问题；文本框矩形按 CJK/换行计算；晚一点隐藏内嵌注释层，并让覆盖卡片更不透明，避免与写回后的文本叠成两份。
- **文本框随缩放**：覆盖卡片的字号按页面实际渲染宽度 / PDF 点宽换算，页面放大时卡片文字与内嵌文本保持同尺寸，避免内嵌文字从卡片边缘露出来。
- **空文本框清理**：新建文本框后等待卡片渲染完成并直接进入编辑；空内容不写回 PDF；打开 PDF 时自动清理历史空框及其写坏的兜底注解。
- **撤销/重做**：新增按 PDF 路径隔离的操作栈，覆盖新建/删除；批量操作作为一条记录。
- **持久化与 Ink 写回**：覆盖层持久化改为防抖；画笔/形状写成 Ink 注解，按路径批量写回，并自动补写历史覆盖层。
- **阶段五拆分**：PDF 阅读器方法迁移到 `src/pdf-reader/` 八个模块，通过 `installPdfReaderMethods` 安装到主类原型；`main.js` 约 1.15 万行。
- **开发者开关**：调试/重写注解命令默认隐藏，可在设置中开启后重载插件使用。
