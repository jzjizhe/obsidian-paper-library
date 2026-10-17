/* 研究画布视图：PDF 阅读框（懒渲染/文字层/高亮/圈选）、画布节点与连线、
   工具栏与缩放。插件交互全部通过构造注入的 plugin 进行。 */

import { ItemView, Menu, Notice, loadPdfJs, normalizePath, setIcon } from "obsidian";
import { CANVAS_HIGHLIGHT_COLORS, DEFAULT_RESEARCH_WORKSPACE_ZOOM, RESEARCH_VIEW_TYPE } from "./constants.js";
import { highlighterCursor, iconButton, itemViewContentRoot, setPaperlibIcon } from "./ui-utils.js";
import { truncate } from "./text-utils.js";
import { workspaceId } from "./paper-utils.js";

class PaperResearchWorkspaceView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.paperId = null;
    this.query = "";
    this.connectingFrom = null;
    this.pdfCache = null;
    this.pdfRenderToken = 0;
    this.pdfHost = null;
    this.pdfObserver = null;
    this.pdfResizeObserver = null;
    this.pdfPageQueue = [];
    this.pdfActiveRenders = 0;
    this.pdfVisibilityTimer = null;
    this.applyWorkspaceZoom = null;
    this.longPressTimer = null;
    this.excerptDrag = null;
    this.inkDrawingCleanup = null;
    this.toolMode = "select";
    this.highlightColor = "yellow";
    this.inkColor = "yellow";
    this.colorPaletteOpen = false;
    this.searchOpen = false;
    this.pdfScrollByPath = new Map();
    this.zoomSaveTimer = null;
    this.connectionDrag = null;
    this.sourceLinkPreview = null;
    this.aiRegionCleanup = null;
    this.mobileFitPaperId = null;
    this.pendingMobileFitScroll = null;
  }

  getViewType() { return RESEARCH_VIEW_TYPE; }
  getDisplayText() { return "Research Workspace"; }
  getIcon() { return "waypoints"; }
  getState() { return { paperId: this.paperId }; }

  async setState(state, result) {
    const nextPaperId = state?.paperId || this.paperId || this.plugin.uiState.selectedId;
    // Every explicit mobile open should start from a useful overview, even when
    // Obsidian reuses the same workspace leaf for the same paper.
    if (this.plugin.isMobileApp() && state?.paperId) this.mobileFitPaperId = null;
    else if (nextPaperId !== this.paperId) this.mobileFitPaperId = null;
    this.paperId = nextPaperId;
    if (super.setState) await super.setState(state, result);
    if (this.containerEl?.children?.length) this.render();
  }

  async onOpen() {
    this.containerEl.addClass("paperlib-research-view");
    this.contentEl?.addClass?.("paperlib-research-content");
    this.paperId = this.paperId || this.plugin.uiState.selectedId;
    this.render();
  }

  async onClose() {
    this.disposeWorkspacePdfView();
    this.applyWorkspaceZoom = null;
    if (this.longPressTimer) window.clearTimeout(this.longPressTimer);
    if (this.zoomSaveTimer) window.clearTimeout(this.zoomSaveTimer);
    this.finishExcerptDrag(null, true);
    this.inkDrawingCleanup?.(true);
    this.inkDrawingCleanup = null;
    this.finishConnectionDrag(null, true);
    this.hideSourceConnection();
    this.aiRegionCleanup?.();
    this.aiRegionCleanup = null;
    try { await this.pdfCache?.document?.destroy?.(); } catch (_) {}
    this.pdfCache = null;
  }

  getPaper() {
    return this.plugin.settings.papers.find((paper) => paper.id === this.paperId) || null;
  }

  getWorkspaceZoom(workspace) {
    const mobile = this.plugin.isMobileApp();
    const value = Number(mobile ? workspace.mobileZoom : workspace.zoom)
      || (mobile ? 1 : DEFAULT_RESEARCH_WORKSPACE_ZOOM);
    return Math.min(2, Math.max(mobile ? 0.1 : 0.4, value));
  }

  assignWorkspaceZoom(workspace, value) {
    const mobile = this.plugin.isMobileApp();
    const minimum = mobile ? 0.1 : 0.4;
    const fallback = mobile ? 1 : DEFAULT_RESEARCH_WORKSPACE_ZOOM;
    const zoom = Math.round(Math.min(2, Math.max(minimum, Number(value) || fallback)) * 100) / 100;
    if (mobile) workspace.mobileZoom = zoom;
    else workspace.zoom = zoom;
    return zoom;
  }

  prepareMobileWorkspaceFit(root, paper, workspace) {
    if (!this.plugin.isMobileApp() || this.mobileFitPaperId === paper.id) return;
    this.mobileFitPaperId = paper.id;
    const frame = workspace.pdfFrame || { x: 32, y: 32, width: 720, height: 1080 };
    const boxes = [{
      x: Number(frame.x) || 32,
      y: Number(frame.y) || 32,
      width: Math.max(520, Number(frame.width) || 720),
      height: Math.max(620, Number(frame.height) || 1080)
    }];
    (workspace.nodes || []).forEach((node) => boxes.push({
      x: Number(node.x) || 40,
      y: Number(node.y) || 40,
      width: node.type === "group" ? 330 : 290,
      // Excerpt cards can contain a 190px quote plus their comment field.
      // Use their maximum normal height so the bottom is not clipped on open.
      height: node.type === "excerpt" ? 320 : 180
    }));
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    const contentWidth = Math.max(1, maxX - minX + 48);
    const contentHeight = Math.max(1, maxY - minY + 48);
    const viewportWidth = Math.max(260, Number(root.clientWidth) || window.innerWidth || 390);
    const viewportHeight = Math.max(320, Number(root.clientHeight) || window.innerHeight || 700);
    const availableWidth = Math.max(240, viewportWidth - 18);
    const availableHeight = Math.max(260, viewportHeight - 150);
    const zoom = this.assignWorkspaceZoom(
      workspace,
      Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight)
    );
    this.pendingMobileFitScroll = {
      left: Math.max(0, (minX - 24) * zoom),
      top: Math.max(0, (minY - 24) * zoom)
    };
  }

  render() {
    const root = itemViewContentRoot(this);
    if (!root) return;
    this.hideSourceConnection();
    const previousViewport = root.querySelector(".paperlib-board-viewport");
    const previousPdfBody = root.querySelector(".paperlib-canvas-pdf-body");
    if (previousPdfBody?.dataset.pdfPath) {
      this.pdfScrollByPath.set(previousPdfBody.dataset.pdfPath, {
        top: previousPdfBody.scrollTop,
        left: previousPdfBody.scrollLeft
      });
    }
    const previousScroll = previousViewport
      ? { left: previousViewport.scrollLeft, top: previousViewport.scrollTop }
      : null;
    this.disposeWorkspacePdfView();
    root.empty();
    root.addClass("paperlib-research-root");
    root.toggleClass("paperlib-mobile-layout", this.plugin.isMobileApp());
    const paper = this.getPaper();
    if (!paper) {
      const empty = root.createDiv({ cls: "paperlib-research-empty" });
      setPaperlibIcon(empty.createDiv(), "mouse-pointer-click");
      empty.createEl("h2", { text: "选择一篇论文开始研究" });
      empty.createEl("p", { text: "双击论文，在画布 PDF 中长按并拖出摘录。" });
      return;
    }

    const workspace = this.plugin.ensureResearchWorkspace(paper);
    this.prepareMobileWorkspaceFit(root, paper, workspace);
    root.toggleClass("is-highlight-mode", this.toolMode === "highlight");
    root.toggleClass("is-ink-mode", this.toolMode === "ink");
    root.toggleClass("is-ai-region-mode", this.toolMode === "ai-region");
    const activeHighlight = CANVAS_HIGHLIGHT_COLORS.find((color) => color.id === this.highlightColor) || CANVAS_HIGHLIGHT_COLORS[0];
    root.style.setProperty("--paperlib-active-highlight", activeHighlight.value);
    root.style.setProperty("--paperlib-highlighter-cursor", highlighterCursor(activeHighlight.value));
    this.renderBoard(root.createDiv({ cls: "paperlib-research-board-wrap" }), paper, workspace);
    this.renderCanvasToolbar(root, paper, workspace);
    if (this.pendingMobileFitScroll) {
      const target = this.pendingMobileFitScroll;
      this.pendingMobileFitScroll = null;
      window.requestAnimationFrame(() => {
        const viewport = root.querySelector(".paperlib-board-viewport");
        if (!viewport) return;
        viewport.scrollLeft = target.left;
        viewport.scrollTop = target.top;
      });
    }
    if (previousScroll) {
      const viewport = root.querySelector(".paperlib-board-viewport");
      if (viewport) {
        viewport.scrollLeft = previousScroll.left;
        viewport.scrollTop = previousScroll.top;
      }
    }
  }

  renderCanvasToolbar(root, paper, workspace) {
    const toolbar = root.createDiv({ cls: "paperlib-canvas-toolbar", attr: { "aria-label": "研究画布工具栏" } });
    iconButton(toolbar, "search", "搜索画布", () => {
      this.searchOpen = !this.searchOpen;
      this.render();
      if (this.searchOpen) window.setTimeout(() => root.querySelector(".paperlib-canvas-tool-search input")?.focus(), 0);
    }, this.searchOpen || this.query ? "is-active" : "");
    if (this.searchOpen) {
      const search = toolbar.createDiv({ cls: "paperlib-canvas-tool-search" });
      setPaperlibIcon(search.createSpan(), "search");
      const input = search.createEl("input", {
        type: "search",
        value: this.query,
        placeholder: "搜索画布…",
        attr: { "aria-label": "搜索画布" }
      });
      input.addEventListener("input", (event) => {
        this.query = event.target.value;
        this.render();
        window.setTimeout(() => root.querySelector(".paperlib-canvas-tool-search input")?.focus(), 0);
      });
      if (this.query) iconButton(search, "x", "清除搜索", () => { this.query = ""; this.render(); });
    }

    const modeGroup = toolbar.createDiv({ cls: "paperlib-canvas-tool-group" });
    iconButton(modeGroup, "mouse-pointer-2", "选择与拖动", () => {
      this.toolMode = "select";
      this.colorPaletteOpen = false;
      this.refreshCanvasToolbar(root, paper, workspace);
    }, this.toolMode === "select" ? "is-active" : "");
    const highlightTool = iconButton(modeGroup, "highlighter", "荧光笔", () => {
      const wasActive = this.toolMode === "highlight";
      this.toolMode = "highlight";
      this.colorPaletteOpen = wasActive ? !this.colorPaletteOpen : true;
      this.refreshCanvasToolbar(root, paper, workspace);
    }, `${this.toolMode === "highlight" ? "is-active" : ""} paperlib-highlighter-tool`);
    const activeHighlightColor = CANVAS_HIGHLIGHT_COLORS.find((color) => color.id === this.highlightColor) || CANVAS_HIGHLIGHT_COLORS[0];
    highlightTool.style.setProperty("--tool-highlight-color", activeHighlightColor.value);
    const inkTool = iconButton(modeGroup, "pencil", "自由画笔", () => {
      const wasActive = this.toolMode === "ink";
      this.toolMode = "ink";
      this.colorPaletteOpen = wasActive ? !this.colorPaletteOpen : true;
      this.refreshCanvasToolbar(root, paper, workspace);
    }, `${this.toolMode === "ink" ? "is-active" : ""} paperlib-ink-tool`);
    const activeInkColor = CANVAS_HIGHLIGHT_COLORS.find((color) => color.id === this.inkColor) || CANVAS_HIGHLIGHT_COLORS[0];
    inkTool.style.setProperty("--tool-highlight-color", activeInkColor.value);
    iconButton(modeGroup, "scan", "圈选区域 Ask AI", () => {
      this.toolMode = "ai-region";
      this.colorPaletteOpen = false;
      this.refreshCanvasToolbar(root, paper, workspace);
    }, `${this.toolMode === "ai-region" ? "is-active" : ""} paperlib-ai-region-tool`);
    const paletteColorId = this.toolMode === "ink" ? this.inkColor : this.highlightColor;
    const palette = modeGroup.createDiv({ cls: `paperlib-highlight-palette ${this.colorPaletteOpen && ["highlight", "ink"].includes(this.toolMode) ? "is-visible" : ""}` });
    CANVAS_HIGHLIGHT_COLORS.forEach((color) => {
      const swatch = palette.createEl("button", {
        cls: `paperlib-highlight-swatch ${paletteColorId === color.id ? "is-active" : ""}`,
        attr: { "aria-label": `${color.label}${this.toolMode === "ink" ? "画笔" : "荧光笔"}颜色`, title: color.label }
      });
      swatch.style.setProperty("--swatch-color", color.value);
      if (paletteColorId === color.id) setPaperlibIcon(swatch, "check");
      swatch.addEventListener("click", () => {
        if (this.toolMode === "ink") this.inkColor = color.id;
        else this.highlightColor = color.id;
        this.colorPaletteOpen = false;
        this.refreshCanvasToolbar(root, paper, workspace);
      });
    });

    const insertGroup = toolbar.createDiv({ cls: "paperlib-canvas-tool-group" });
    iconButton(insertGroup, "sticky-note", "添加想法", () => this.addNode(paper, "note"));
    iconButton(insertGroup, "layout-template", "添加主题卡", () => this.addNode(paper, "group"));
    iconButton(insertGroup, "layout-grid", "自动整理", () => this.plugin.arrangeResearchWorkspace(paper));
    iconButton(insertGroup, "file-text", "定位 PDF", () => {
      root.querySelector(".paperlib-canvas-pdf")?.scrollIntoView({ behavior: "smooth", block: "start", inline: "start" });
    });
    iconButton(insertGroup, "images", "浏览 PDF 中的所有图片", () => {
      void this.plugin.openPdfFigureGallery(paper.pdfPath, paper);
    });

    const zoom = this.getWorkspaceZoom(workspace);
    const zoomGroup = toolbar.createDiv({ cls: "paperlib-canvas-tool-zoom" });
    iconButton(zoomGroup, "minus", "缩小", () => this.setZoom(paper, zoom - 0.1));
    zoomGroup.createSpan({ cls: "paperlib-canvas-zoom-value", text: `${Math.round(zoom * 100)}%` });
    iconButton(zoomGroup, "plus", "放大", () => this.setZoom(paper, zoom + 0.1));
  }

  renderHeader(root, paper, workspace) {
    const header = root.createEl("header", { cls: "paperlib-research-header" });
    const identity = header.createDiv({ cls: "paperlib-research-identity" });
    const mark = identity.createDiv({ cls: "paperlib-research-mark" });
    setPaperlibIcon(mark, "waypoints");
    const title = identity.createDiv();
    title.createSpan({ cls: "paperlib-research-eyebrow", text: "ACTIVE READING WORKSPACE" });
    title.createEl("h2", { text: paper.title });

    const actions = header.createDiv({ cls: "paperlib-research-actions" });
    const search = actions.createDiv({ cls: "paperlib-research-search" });
    setPaperlibIcon(search.createSpan(), "search");
    const input = search.createEl("input", {
      type: "search",
      value: this.query,
      placeholder: "搜索摘录与想法…",
      attr: { "aria-label": "搜索研究工作区" }
    });
    input.addEventListener("input", (event) => {
      this.query = event.target.value;
      this.render();
      window.setTimeout(() => root.querySelector(".paperlib-research-search input")?.focus(), 0);
    });
    iconButton(actions, "sticky-note", "添加想法", () => this.addNode(paper, "note"));
    iconButton(actions, "layout-template", "添加主题卡", () => this.addNode(paper, "group"));
    iconButton(actions, "layout-grid", "自动整理卡片", () => this.plugin.arrangeResearchWorkspace(paper));
    iconButton(actions, "file-text", "定位画布中的 PDF", () => {
      root.querySelector(".paperlib-canvas-pdf")?.scrollIntoView({ behavior: "smooth", block: "start", inline: "start" });
    });
    const count = workspace.nodes.filter((node) => node.type === "excerpt").length;
    actions.createSpan({ cls: "paperlib-research-count", text: `${count} 条摘录` });
  }

  renderSourceRail(rail, paper, workspace) {
    const header = rail.createDiv({ cls: "paperlib-source-header" });
    header.createSpan({ cls: "paperlib-source-label", text: "SOURCE MATERIAL" });
    header.createEl("strong", { text: paper.pdfPath?.split("/").pop() || "尚未关联 PDF" });
    const pdfAction = header.createEl("button", { cls: "paperlib-source-open" });
    setPaperlibIcon(pdfAction.createSpan(), "file-text");
    pdfAction.createSpan({ text: "打开原文" });
    pdfAction.addEventListener("click", () => this.plugin.openResearchSource(paper, null));

    const help = rail.createDiv({ cls: "paperlib-source-help" });
    setPaperlibIcon(help.createSpan(), "move-right");
    help.createSpan({ text: "在画布 PDF 中选中文字，长按选区后拖到空白处。" });

    const list = rail.createDiv({ cls: "paperlib-source-list" });
    const query = this.query.trim().toLocaleLowerCase();
    const excerpts = workspace.nodes
      .filter((node) => node.type === "excerpt")
      .filter((node) => !query || `${node.text} ${node.comment || ""}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => (a.page || 0) - (b.page || 0));
    if (!excerpts.length) {
      list.createEl("p", { cls: "paperlib-source-empty", text: query ? "没有匹配的摘录" : "还没有摘录。先从 PDF 里拉出关键内容。" });
      return;
    }
    excerpts.forEach((node) => {
      const item = list.createEl("button", { cls: "paperlib-source-excerpt", attr: { draggable: "true" } });
      const meta = item.createDiv({ cls: "paperlib-source-excerpt-meta" });
      meta.createSpan({ text: `P. ${node.page || "—"}` });
      if (node.color) meta.createSpan({ cls: "paperlib-source-color", text: node.color });
      item.createDiv({ cls: "paperlib-source-excerpt-text", text: truncate(node.text, 150) });
      item.addEventListener("click", () => this.plugin.openResearchSource(paper, node));
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("application/x-paperlib-node", node.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
    });
  }

  renderBoard(wrap, paper, workspace) {
    const zoom = this.getWorkspaceZoom(workspace);
    const viewport = wrap.createDiv({ cls: "paperlib-board-viewport" });
    const frame = workspace.pdfFrame || { x: 32, y: 32, width: 720, height: 1080 };
    workspace.pdfFrame = frame;
    const maxX = Math.max(2600, Number(frame.x) + Number(frame.width) + 500, ...workspace.nodes.map((node) => Number(node.x || 0) + 420));
    const maxY = Math.max(1800, Number(frame.y) + Number(frame.height) + 300, ...workspace.nodes.map((node) => Number(node.y || 0) + 360));
    const stage = viewport.createDiv({ cls: "paperlib-board-stage" });
    stage.style.width = `${maxX * zoom}px`;
    stage.style.height = `${maxY * zoom}px`;
    const board = stage.createDiv({ cls: "paperlib-board-canvas" });
    board.style.width = `${maxX}px`;
    board.style.height = `${maxY}px`;
    board.style.transform = `scale(${zoom})`;

    this.renderPdfFrame(board, paper, workspace, zoom);

    const query = this.query.trim().toLocaleLowerCase();
    const visibleNodes = workspace.nodes.filter((node) => (
      !query || `${node.text || ""} ${node.comment || ""}`.toLocaleLowerCase().includes(query)
    ));
    visibleNodes.forEach((node) => this.renderNode(board, paper, node, zoom));
    this.renderConnections(board, workspace, new Set(visibleNodes.map((node) => node.id)));
    this.installCanvasZoom(viewport, stage, board, paper, workspace, maxX, maxY);

    board.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("application/x-paperlib-node")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    board.addEventListener("drop", (event) => {
      const id = event.dataTransfer?.getData("application/x-paperlib-node");
      if (!id) return;
      event.preventDefault();
      const rect = board.getBoundingClientRect();
      const node = workspace.nodes.find((item) => item.id === id);
      if (!node) return;
      const zoom = this.getWorkspaceZoom(workspace);
      node.x = Math.max(24, (event.clientX - rect.left) / zoom - 140);
      node.y = Math.max(24, (event.clientY - rect.top) / zoom - 50);
      void this.plugin.persistResearchWorkspace(paper);
    });
  }

  installCanvasZoom(viewport, stage, board, paper, workspace, maxX, maxY) {
    const applyZoom = (nextZoom, clientX, clientY) => {
      const oldZoom = this.getWorkspaceZoom(workspace);
      const next = Math.min(2, Math.max(this.plugin.isMobileApp() ? 0.1 : 0.4, nextZoom));
      if (Math.abs(next - oldZoom) < 0.002) return;
      const rect = viewport.getBoundingClientRect();
      const pointerX = Number.isFinite(clientX) ? clientX : rect.left + rect.width / 2;
      const pointerY = Number.isFinite(clientY) ? clientY : rect.top + rect.height / 2;
      const focalX = viewport.scrollLeft + pointerX - rect.left;
      const focalY = viewport.scrollTop + pointerY - rect.top;
      const canvasX = focalX / oldZoom;
      const canvasY = focalY / oldZoom;
      const appliedZoom = this.assignWorkspaceZoom(workspace, next);
      board.style.transform = `scale(${appliedZoom})`;
      stage.style.width = `${maxX * appliedZoom}px`;
      stage.style.height = `${maxY * appliedZoom}px`;
      viewport.scrollLeft = canvasX * appliedZoom - (pointerX - rect.left);
      viewport.scrollTop = canvasY * appliedZoom - (pointerY - rect.top);
      this.sourceLinkPreview?.update?.();
      this.refreshCanvasToolbar(itemViewContentRoot(this), paper, workspace);
      const label = this.containerEl.querySelector(".paperlib-canvas-zoom-value");
      if (label) label.textContent = `${Math.round(appliedZoom * 100)}%`;
      if (this.zoomSaveTimer) window.clearTimeout(this.zoomSaveTimer);
      this.zoomSaveTimer = window.setTimeout(() => {
        this.zoomSaveTimer = null;
        void this.plugin.persistResearchWorkspace(paper, false);
        this.refreshWorkspacePdfResolution();
      }, 180);
    };
    this.applyWorkspaceZoom = applyZoom;
    viewport.addEventListener("wheel", (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.012);
      applyZoom(this.getWorkspaceZoom(workspace) * factor, event.clientX, event.clientY);
    }, { passive: false });
    let gestureStartZoom = this.getWorkspaceZoom(workspace);
    viewport.addEventListener("gesturestart", (event) => {
      gestureStartZoom = this.getWorkspaceZoom(workspace);
      event.preventDefault();
    });
    viewport.addEventListener("gesturechange", (event) => {
      event.preventDefault();
      applyZoom(gestureStartZoom * Number(event.scale || 1), event.clientX, event.clientY);
    });
    let touchStartDistance = 0;
    let touchStartZoom = this.getWorkspaceZoom(workspace);
    viewport.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 2) return;
      const first = event.touches[0];
      const second = event.touches[1];
      touchStartDistance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
      touchStartZoom = this.getWorkspaceZoom(workspace);
    }, { passive: true });
    viewport.addEventListener("touchmove", (event) => {
      if (event.touches.length !== 2 || touchStartDistance <= 0) return;
      event.preventDefault();
      const first = event.touches[0];
      const second = event.touches[1];
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      applyZoom(touchStartZoom * distance / touchStartDistance, centerX, centerY);
    }, { passive: false });
    const finishTouchZoom = (event) => {
      if (event.touches.length < 2) touchStartDistance = 0;
    };
    viewport.addEventListener("touchend", finishTouchZoom, { passive: true });
    viewport.addEventListener("touchcancel", finishTouchZoom, { passive: true });
  }

  renderPdfFrame(board, paper, workspace, zoom) {
    const frameState = workspace.pdfFrame;
    const frame = board.createEl("section", { cls: "paperlib-canvas-pdf" });
    frame.style.left = `${Number(frameState.x || 32)}px`;
    frame.style.top = `${Number(frameState.y || 32)}px`;
    frame.style.width = `${Math.max(520, Number(frameState.width || 720))}px`;
    frame.style.height = `${Math.max(620, Number(frameState.height || 1080))}px`;
    const head = frame.createEl("header", { cls: "paperlib-canvas-pdf-head" });
    const identity = head.createDiv({ cls: "paperlib-canvas-pdf-title" });
    setPaperlibIcon(identity.createSpan(), "file-text");
    const text = identity.createDiv();
    text.createEl("strong", { text: paper.pdfPath?.split("/").pop() || "PDF" });
    text.createSpan({ text: "长按选中文字，然后直接拖到画布空白处" });
    const actions = head.createDiv({ cls: "paperlib-canvas-pdf-actions" });
    iconButton(actions, "external-link", "在 Obsidian PDF 阅读器中打开", () => this.plugin.openResearchSource(paper, null));
    const body = frame.createDiv({ cls: "paperlib-canvas-pdf-body" });
    body.dataset.pdfPath = normalizePath(paper.pdfPath || "");
    body.addEventListener("scroll", () => {
      this.pdfScrollByPath.set(body.dataset.pdfPath, { top: body.scrollTop, left: body.scrollLeft });
    }, { passive: true });
    if (!paper.pdfPath) {
      const empty = body.createDiv({ cls: "paperlib-canvas-pdf-empty" });
      setPaperlibIcon(empty.createDiv(), "file-question");
      empty.createEl("strong", { text: "尚未关联 PDF" });
      empty.createSpan({ text: "请先在论文信息中添加 Vault 内 PDF。" });
    } else if (/^https?:\/\//i.test(paper.pdfPath)) {
      const empty = body.createDiv({ cls: "paperlib-canvas-pdf-empty" });
      setPaperlibIcon(empty.createDiv(), "cloud-off");
      empty.createEl("strong", { text: "远程 PDF 无法嵌入可选文字层" });
      empty.createSpan({ text: "请先把 PDF 保存到当前 Vault。" });
    } else {
      void this.renderPdfDocument(body, paper, workspace);
    }
    this.installPdfFrameDrag(frame, head, paper, frameState, zoom);
    frame.addEventListener("pointerup", () => {
      frameState.width = Math.round(frame.offsetWidth / 10) * 10;
      frameState.height = Math.round(frame.offsetHeight / 10) * 10;
      void this.plugin.persistResearchWorkspace(paper, false);
    });
  }

  installPdfFrameDrag(frame, handle, paper, frameState, zoom) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = this.getWorkspaceZoom(this.plugin.ensureResearchWorkspace(paper));
      const originX = Number(frameState.x || 0);
      const originY = Number(frameState.y || 0);
      frame.addClass("is-dragging");
      const move = (moveEvent) => {
        frameState.x = Math.max(0, originX + (moveEvent.clientX - startX) / zoom);
        frameState.y = Math.max(0, originY + (moveEvent.clientY - startY) / zoom);
        frame.style.left = `${frameState.x}px`;
        frame.style.top = `${frameState.y}px`;
        this.sourceLinkPreview?.update?.();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        frame.removeClass("is-dragging");
        void this.plugin.persistResearchWorkspace(paper, false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
  }

  refreshCanvasToolbar(root, paper, workspace) {
    this.dismissWorkspacePdfSelectionToolbar();
    this.pdfSelectionGestureCleanup?.();
    if (!root) return;
    root.toggleClass("is-highlight-mode", this.toolMode === "highlight");
    root.toggleClass("is-ink-mode", this.toolMode === "ink");
    root.toggleClass("is-ai-region-mode", this.toolMode === "ai-region");
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === this.highlightColor) || CANVAS_HIGHLIGHT_COLORS[0];
    root.style.setProperty("--paperlib-active-highlight", color.value);
    root.style.setProperty("--paperlib-highlighter-cursor", highlighterCursor(color.value));
    root.querySelector(".paperlib-canvas-toolbar")?.remove();
    this.renderCanvasToolbar(root, paper, workspace);
    this.pdfHost?.querySelectorAll?.("a.paperlib-pdf-link").forEach((anchor) => { anchor.tabIndex = this.toolMode === "select" ? 0 : -1; });
  }

  disposeWorkspacePdfView() {
    this.dismissWorkspacePdfSelectionToolbar();
    this.pdfSelectionGestureCleanup?.();
    this.pdfRenderToken += 1;
    this.pdfObserver?.disconnect();
    this.pdfResizeObserver?.disconnect();
    this.pdfObserver = this.pdfResizeObserver = null;
    this.pdfVisibilityCleanup?.();
    this.pdfVisibilityCleanup = null;
    this.pdfHighlightGestureCleanup?.();
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    if (this.pdfVisibilityTimer) clearTimeout(this.pdfVisibilityTimer);
    this.pdfVisibilityTimer = null;
    for (const job of this.pdfPageQueue || []) job.resolve(null);
    this.pdfPageQueue = [];
    this.pdfActiveRenders = 0;
    for (const data of this.pdfCache?.pages?.values?.() || []) {
      data.renderTask?.cancel?.();
      data.textLayerTask?.cancel?.();
      data.canvas.width = data.canvas.height = 0;
    }
    this.pdfCache?.pages?.clear?.();
    this.pdfCache?.pageViews?.clear?.();
    this.pdfHost = null;
    this.pdfPageInput = null;
    this.pdfCurrentPage = 1;
  }

  workspacePdfRenderRatio(viewport, pageElement) {
    const window = this.pdfHost?.ownerDocument?.defaultView || globalThis.window;
    const workspace = this.pdfWorkspace || {};
    const rect = pageElement?.getBoundingClientRect?.();
    const scaleX = rect?.width / pageElement?.offsetWidth;
    const scaleY = rect?.height / pageElement?.offsetHeight;
    const scale = [scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0)
      ? Math.max(scaleX, scaleY) : this.getWorkspaceZoom(workspace);
    // Supersampling reduces text softness from fractional canvas transforms.
    const desired = Math.max(1, 2 * (window?.devicePixelRatio || 1) * scale);
    const pixels = this.plugin.isMobileApp() ? 6 * 1024 * 1024 : 12 * 1024 * 1024;
    return Math.min(desired, Math.sqrt(pixels / (viewport.width * viewport.height)),
      8192 / viewport.width, 8192 / viewport.height);
  }

  createWorkspacePdfPlaceholder(parent, pageNumber, size) {
    const page = parent.createEl("article", { cls: "paperlib-selectable-pdf-page paperlib-pdf-page-placeholder" });
    page.dataset.page = String(pageNumber);
    page.style.width = `${size.width}px`;
    page.style.height = `${size.height}px`;
    page.createSpan({ cls: "paperlib-pdf-page-number", text: String(pageNumber) });
    return page;
  }

  workspacePdfGestureIsActive() {
    return Boolean(this.excerptDrag || this.inkDrawingCleanup || this.aiRegionCleanup
      || this.pdfHighlightGestureCleanup || this.pdfSelectionGestureCleanup);
  }

  workspacePdfPageIsSelected(element) {
    if (this.workspacePdfGestureIsActive()) return true;
    const selection = element.ownerDocument?.defaultView?.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    try { return selection.getRangeAt(0).intersectsNode(element); } catch (_) { return false; }
  }

  updateWorkspacePdfVisibility() {
    const cache = this.pdfCache;
    const host = this.pdfHost;
    if (!host?.isConnected || !cache?.pageViews) return;
    const bounds = host.getBoundingClientRect?.();
    const margin = bounds ? Math.max(120, bounds.height * 0.5) : 0;
    const probe = bounds ? bounds.top + 24 : 0;
    let topPage = null;
    for (const record of cache.pageViews.values()) {
      const rect = record.element.getBoundingClientRect?.();
      // pageViews 按页码有序：最后一个顶边在视口探针上方/穿过探针的页即当前页
      if (rect && bounds && rect.top <= probe) topPage = record.pageNumber;
      const near = rect && bounds ? rect.bottom >= bounds.top - margin && rect.top <= bounds.bottom + margin
        : record.pageNumber <= 2;
      record.near = Boolean(near);
      if (near) void this.ensureWorkspacePdfPage(record.pageNumber);
      else if (record.pageData && !record.promise && !record.pinned && !this.workspacePdfPageIsSelected(record.element)) {
        const old = record.element;
        const placeholder = this.createWorkspacePdfPlaceholder(old.parentElement || old.parentNode, record.pageNumber, record.pageData.viewport);
        old.replaceWith(placeholder);
        this.pdfObserver?.unobserve(old);
        this.pdfObserver?.observe(placeholder);
        record.pageData.renderTask?.cancel?.();
        record.pageData.textLayerTask?.cancel?.();
        record.pageData.canvas.width = record.pageData.canvas.height = 0;
        record.pageData.page.cleanup?.();
        cache.pages.delete(record.pageNumber);
        record.pageData = null;
        record.element = placeholder;
      }
    }
    const page = topPage || 1;
    if (page !== this.pdfCurrentPage) {
      this.pdfCurrentPage = page;
      this.updateWorkspacePdfPageIndicator();
    }
  }

  scheduleWorkspacePdfVisibility() {
    if (this.pdfVisibilityTimer) clearTimeout(this.pdfVisibilityTimer);
    this.pdfVisibilityTimer = setTimeout(() => {
      this.pdfVisibilityTimer = null;
      this.updateWorkspacePdfVisibility();
    }, 60);
  }

  updateWorkspacePdfPageIndicator() {
    const input = this.pdfPageInput;
    if (!input?.isConnected) return;
    // 输入框聚焦时不覆盖用户正在键入的页码
    if (input.ownerDocument?.activeElement === input) return;
    input.value = String(this.pdfCurrentPage || 1);
  }

  scrollWorkspacePdfToPage(pageNumber, smooth = false) {
    const cache = this.pdfCache;
    const host = this.pdfHost;
    if (!host?.isConnected || !cache?.document) return;
    const count = cache.document.numPages || 0;
    if (!count) return;
    const page = Math.max(1, Math.min(count, Math.round(Number(pageNumber) || 1)));
    const record = cache.pageViews?.get(page);
    if (!record?.element?.isConnected) return;
    // 固定目标页，防止渲染完成前被可见性回收
    record.pinned = (record.pinned || 0) + 1;
    void Promise.resolve(this.ensureWorkspacePdfPage(page)).finally(() => { record.pinned -= 1; });
    const hostRect = host.getBoundingClientRect?.();
    const pageRect = record.element.getBoundingClientRect?.();
    const hostScaleY = hostRect ? hostRect.height / host.offsetHeight : 0;
    if (!hostRect || !pageRect || !Number.isFinite(hostScaleY) || hostScaleY <= 0) return;
    const inset = host.querySelector(".paperlib-canvas-pdf-meta")?.offsetHeight || 0;
    host.scrollTo({
      top: host.scrollTop + (pageRect.top - hostRect.top) / hostScaleY - inset - 8,
      behavior: smooth ? "smooth" : "auto"
    });
  }

  commitWorkspacePdfPageInput() {
    const input = this.pdfPageInput;
    if (!input?.isConnected) return;
    const count = this.pdfCache?.document?.numPages || 0;
    const value = Number.parseInt(input.value, 10);
    if (!Number.isFinite(value) || value < 1 || value > count || value === this.pdfCurrentPage) {
      input.value = String(this.pdfCurrentPage || 1);
      return;
    }
    this.scrollWorkspacePdfToPage(value);
  }

  ensureWorkspacePdfPage(pageNumber) {
    const cache = this.pdfCache;
    const record = cache?.pageViews?.get(pageNumber);
    if (!record || record.failed || !this.pdfHost?.isConnected) return Promise.resolve(null);
    if (record.promise) return record.promise;
    const data = record.pageData;
    if (data && this.workspacePdfGestureIsActive()) return Promise.resolve(data);
    const ratio = data && this.workspacePdfRenderRatio(data.viewport, record.element);
    if (data && ratio <= data.ratio + 0.1 && ratio >= data.ratio * 0.65) return Promise.resolve(data);
    const token = this.pdfRenderToken;
    record.promise = new Promise((resolve) => {
      this.pdfPageQueue.push({ record, token, cache, resolve });
    });
    this.pumpWorkspacePdfPages();
    return record.promise;
  }

  pumpWorkspacePdfPages() {
    const maximum = this.plugin.isMobileApp() ? 1 : 2;
    while (this.pdfActiveRenders < maximum && this.pdfPageQueue.length) {
      const job = this.pdfPageQueue.shift();
      if (job.token !== this.pdfRenderToken || job.cache !== this.pdfCache) { job.resolve(null); continue; }
      if (!job.record.near && !job.record.pinned) {
        job.record.promise = null;
        job.resolve(null);
        continue;
      }
      this.pdfActiveRenders += 1;
      void this.renderSelectablePdfPage(this.pdfPagesHost, this.pdfPaper, this.pdfWorkspace, job.record.pageNumber, job.token)
        .then(() => job.resolve(job.record.pageData))
        .catch((error) => {
          if (job.token === this.pdfRenderToken && job.record.element.isConnected) {
            console.error("Paper Library: failed to render PDF page", error);
            const data = job.cache.pages.get(job.record.pageNumber);
            job.record.failed = true;
            if (!job.record.pageData) {
              data?.textLayerTask?.cancel?.();
              if (data?.canvas) data.canvas.width = data.canvas.height = 0;
              job.cache.pages.delete(job.record.pageNumber);
            }
            const message = job.record.element.createDiv({ cls: "paperlib-pdf-page-error" });
            message.createSpan({ text: `第 ${job.record.pageNumber} 页加载失败：${error.message || error}` });
            const retry = message.createEl("button", { text: "重试" });
            retry.addEventListener("click", () => {
              message.remove();
              job.record.failed = false;
              void this.ensureWorkspacePdfPage(job.record.pageNumber);
            });
          }
          job.resolve(null);
        }).finally(() => {
          job.record.promise = null;
          if (job.token === this.pdfRenderToken && job.cache === this.pdfCache) {
            this.pdfActiveRenders -= 1;
            this.pumpWorkspacePdfPages();
            this.scheduleWorkspacePdfVisibility();
            if (job.record.near && job.record.pageData) void this.ensureWorkspacePdfPage(job.record.pageNumber);
          }
        });
    }
  }

  refreshWorkspacePdfResolution() {
    this.updateWorkspacePdfVisibility();
    for (const record of this.pdfCache?.pageViews?.values?.() || []) {
      if (record.near) void this.ensureWorkspacePdfPage(record.pageNumber);
    }
  }

  async renderWorkspacePdfBitmap(data, token, pageElement) {
    if (token !== this.pdfRenderToken) return null;
    const owner = this.pdfHost?.ownerDocument || globalThis.document;
    const ratio = this.workspacePdfRenderRatio(data.viewport, pageElement);
    const canvas = owner.createElement("canvas");
    canvas.width = Math.ceil(data.viewport.width * ratio);
    canvas.height = Math.ceil(data.viewport.height * ratio);
    canvas.style.width = `${data.viewport.width}px`;
    canvas.style.height = `${data.viewport.height}px`;
    const task = data.page.render({ canvasContext: canvas.getContext("2d"), viewport: data.viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] });
    data.renderTask = task;
    try { await task.promise; } finally { if (data.renderTask === task) data.renderTask = null; }
    if (token !== this.pdfRenderToken) { canvas.width = canvas.height = 0; return null; }
    data.ratio = ratio;
    return canvas;
  }

  async renderWorkspacePdfText(textLayer, data, cache) {
    textLayer.__paperlibViewport = data.viewport;
    textLayer.style.setProperty?.("--scale-factor", String(data.viewport.scale));
    textLayer.style.setProperty?.("--user-unit", String(data.viewport.userUnit || 1));
    textLayer.style.setProperty?.("--total-scale-factor", String(data.viewport.scale * (data.viewport.userUnit || 1)));
    textLayer.style.setProperty?.("--scale-round-x", "1px");
    textLayer.style.setProperty?.("--scale-round-y", "1px");
    if (typeof cache.pdfjs.TextLayer === "function") {
      const task = new cache.pdfjs.TextLayer({ textContentSource: data.textContent, container: textLayer, viewport: data.viewport });
      data.textLayerTask = task;
      await task.render();
      let index = 0;
      data.textContent.items.forEach((item, originalIndex) => {
        if (item.str === undefined) return;
        const span = task.textDivs[index++];
        if (!span) return;
        span.classList.add("paperlib-pdf-text-item");
        span.dataset.textIndex = String(originalIndex);
      });
      return;
    }
    // Older PDF.js builds may not expose TextLayer.
    const measure = (textLayer.ownerDocument || globalThis.document).createElement("canvas").getContext("2d");
    data.textContent.items.forEach((item, index) => {
      if (!item?.str) return;
      const transform = cache.pdfjs.Util.transform(data.viewport.transform, item.transform);
      const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]));
      const fontFamily = data.textContent.styles?.[item.fontName]?.fontFamily || "sans-serif";
      const span = textLayer.createSpan({ cls: "paperlib-pdf-text-item", text: item.str });
      span.dataset.textIndex = String(index);
      span.style.left = `${transform[4]}px`;
      span.style.top = `${transform[5] - fontHeight}px`;
      span.style.fontSize = `${fontHeight}px`;
      span.style.fontFamily = fontFamily;
      measure.font = `${fontHeight}px ${fontFamily}`;
      span.style.transform = `rotate(${Math.atan2(transform[1], transform[0])}rad) scaleX(${Math.max(1, item.width * data.viewport.scale) / (measure.measureText(item.str).width || 1)})`;
    });
  }

  beginWorkspacePdfTextSelection(event, textLayer, paper, pageNumber) {
    if (event.button !== 0 || this.toolMode !== "select") return;
    this.dismissWorkspacePdfSelectionToolbar();
    this.pdfSelectionGestureCleanup?.();
    const owner = textLayer.ownerDocument.defaultView;
    const token = this.pdfRenderToken;
    const cleanup = () => {
      owner.removeEventListener("pointerup", up, true);
      owner.removeEventListener("pointercancel", cleanup, true);
      owner.removeEventListener("blur", cleanup);
      if (this.pdfSelectionGestureCleanup === cleanup) this.pdfSelectionGestureCleanup = null;
    };
    const up = (end) => {
      if (event.pointerId !== undefined && end.pointerId !== event.pointerId) return;
      const dragging = Boolean(this.excerptDrag);
      cleanup();
      if (dragging) return;
      const timer = owner.setTimeout(() => {
        if (this.pdfSelectionToolbarTimer?.id !== timer) return;
        this.pdfSelectionToolbarTimer = null;
        if (token !== this.pdfRenderToken || !textLayer.isConnected
          || this.toolMode !== "select" || this.excerptDrag) return;
        this.repairWorkspacePdfSelectionEnd(textLayer, end);
        this.showWorkspacePdfSelectionToolbar(textLayer, paper, pageNumber);
      }, 0);
      this.pdfSelectionToolbarTimer = { id: timer, owner };
    };
    this.pdfSelectionGestureCleanup = cleanup;
    owner.addEventListener("pointerup", up, true);
    owner.addEventListener("pointercancel", cleanup, true);
    owner.addEventListener("blur", cleanup);
  }

  dismissWorkspacePdfSelectionToolbar() {
    const timer = this.pdfSelectionToolbarTimer;
    if (timer) timer.owner.clearTimeout(timer.id);
    this.pdfSelectionToolbarTimer = null;
    this.pdfSelectionToolbarCleanup?.();
  }

  showWorkspacePdfSelectionToolbar(textLayer, paper, pageNumber) {
    this.dismissWorkspacePdfSelectionToolbar();
    if (this.toolMode !== "select" || !textLayer.isConnected || this.excerptDrag) return;
    const context = this.getCanvasSelection(textLayer, textLayer, paper, pageNumber, false);
    if (!context?.text || !context.pdfRects?.length || !context.dragSourceRect) return;
    const doc = textLayer.ownerDocument;
    const owner = doc.defaultView;
    const selection = owner.getSelection();
    const selectedRange = selection.getRangeAt(0).cloneRange();
    const token = this.pdfRenderToken;
    const toolbar = doc.body.createDiv({
      cls: "paperlib-pdf-selection-toolbar",
      attr: { role: "toolbar", "aria-label": "选中文字的高亮颜色" }
    });
    const current = () => token === this.pdfRenderToken && textLayer.isConnected && this.toolMode === "select";
    toolbar.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    CANVAS_HIGHLIGHT_COLORS.forEach((color) => {
      const button = toolbar.createEl("button", {
        cls: "paperlib-pdf-selection-color",
        attr: { type: "button", "aria-label": `用${color.label}高亮`, title: `${color.label}高亮` }
      });
      button.dataset.color = color.id;
      button.style.setProperty("--swatch-color", color.value);
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!current() || !toolbar.isConnected) return;
        this.dismissWorkspacePdfSelectionToolbar();
        this.highlightColor = color.id;
        this.paintPdfHighlight(textLayer, context, color.id);
        selection.removeAllRanges();
        this.refreshCanvasToolbar(itemViewContentRoot(this), paper, this.plugin.ensureResearchWorkspace(paper));
        try {
          await this.plugin.saveCanvasHighlight(context, color.id);
        } catch (error) {
          console.error("Paper Library: failed to highlight PDF selection", error);
          new Notice(`高亮失败：${error.message || error}`);
        } finally {
          if (current()) this.refreshPdfHighlights(paper);
        }
      });
    });
    const popup = toolbar.getBoundingClientRect();
    const rect = context.dragSourceRect;
    const viewport = owner.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || owner.innerWidth);
    const bottom = top + (viewport?.height || owner.innerHeight);
    const x = Math.min(right - popup.width - 8, Math.max(left + 8, (rect.left + rect.right - popup.width) / 2));
    const y = rect.top - popup.height - 8 >= top + 8 ? rect.top - popup.height - 8 : rect.bottom + 8;
    toolbar.style.left = `${Math.max(left + 8, x)}px`;
    toolbar.style.top = `${Math.max(top + 8, Math.min(bottom - popup.height - 8, y))}px`;
    const dismiss = () => this.dismissWorkspacePdfSelectionToolbar();
    const outside = (event) => { if (!toolbar.contains(event.target)) dismiss(); };
    const keydown = (event) => { if (event.key === "Escape" || event.metaKey || event.ctrlKey) dismiss(); };
    const selectionChanged = () => {
      if (!selection.rangeCount || selection.isCollapsed) { dismiss(); return; }
      const range = selection.getRangeAt(0);
      if (range.compareBoundaryPoints(0, selectedRange) || range.compareBoundaryPoints(2, selectedRange)) dismiss();
    };
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", keydown, true);
    doc.addEventListener("selectionchange", selectionChanged);
    owner.addEventListener("scroll", dismiss, true);
    owner.addEventListener("resize", dismiss);
    owner.addEventListener("blur", dismiss);
    viewport?.addEventListener("resize", dismiss);
    viewport?.addEventListener("scroll", dismiss);
    const leafChange = this.app.workspace?.on?.("active-leaf-change", dismiss);
    this.pdfSelectionToolbarCleanup = () => {
      toolbar.remove();
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("keydown", keydown, true);
      doc.removeEventListener("selectionchange", selectionChanged);
      owner.removeEventListener("scroll", dismiss, true);
      owner.removeEventListener("resize", dismiss);
      owner.removeEventListener("blur", dismiss);
      viewport?.removeEventListener("resize", dismiss);
      viewport?.removeEventListener("scroll", dismiss);
      if (leafChange) this.app.workspace.offref(leafChange);
      this.pdfSelectionToolbarCleanup = null;
    };
  }

  beginWorkspacePdfHighlight(event, textLayer, paper, pageNumber) {
    if (event.button !== 0) return;
    this.dismissWorkspacePdfSelectionToolbar();
    this.pdfHighlightGestureCleanup?.();
    const window = textLayer.ownerDocument.defaultView;
    const cleanup = () => {
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cleanup, true);
      window.removeEventListener("blur", cleanup);
      if (this.pdfHighlightGestureCleanup === cleanup) this.pdfHighlightGestureCleanup = null;
    };
    const up = (end) => {
      if (event.pointerId !== undefined && end.pointerId !== event.pointerId) return;
      cleanup();
      if (textLayer.isConnected) this.handlePdfHighlight(end, textLayer, paper, pageNumber);
    };
    this.pdfHighlightGestureCleanup = cleanup;
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cleanup, true);
    window.addEventListener("blur", cleanup);
  }

  repairWorkspacePdfSelectionEnd(textLayer, event) {
    const doc = textLayer.ownerDocument;
    const selection = doc.defaultView.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed
      || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const mappedSpan = (node) => {
      const span = (node?.nodeType === 3 ? node.parentElement : node)?.closest?.(".paperlib-pdf-text-item");
      return span && textLayer.contains(span) ? span : null;
    };
    if (!mappedSpan(selection.anchorNode) || mappedSpan(selection.focusNode)) return;
    // Chrome can move the selection endpoint to an unrelated element at page edges.
    const vertical = (textLayer.__paperlibViewport?.rotation || 0) % 180 !== 0;
    let closest;
    for (const span of this.getCanvasSelectionItemSpans(textLayer)) {
      const rect = span.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      const lineDistance = vertical ? dx : dy;
      const distance = vertical ? dy : dx;
      if (!closest || lineDistance < closest.lineDistance
        || (lineDistance === closest.lineDistance && distance < closest.distance)) {
        closest = { span, rect, lineDistance, distance };
      }
    }
    if (!closest) return;
    const { span, rect } = closest;
    const x = Math.max(rect.left + 0.1, Math.min(rect.right - 0.1, event.clientX));
    const y = Math.max(rect.top + 0.1, Math.min(rect.bottom - 0.1, event.clientY));
    const caret = doc.caretPositionFromPoint?.(x, y);
    const range = caret ? null : doc.caretRangeFromPoint?.(x, y);
    let node = caret?.offsetNode || range?.startContainer;
    let offset = caret?.offset ?? range?.startOffset;
    if (mappedSpan(node) !== span) {
      const slices = this.getCanvasSelectionTextSlices(span);
      if (!slices.length) return;
      const rtl = doc.defaultView.getComputedStyle(span).direction === "rtl";
      const end = vertical ? event.clientY >= (rect.top + rect.bottom) / 2
        : (event.clientX >= (rect.left + rect.right) / 2) !== rtl;
      node = (end ? slices[slices.length - 1] : slices[0]).node;
      offset = end ? node.data.length : 0;
    }
    selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, node, offset);
  }

  isWorkspacePdfLinkCurrent(context) {
    return this.pdfCache === context.cache && context.cache?.document === context.document
      && this.pdfHost === context.host && context.host?.isConnected
      && this.pdfRenderToken === context.token && this.paperId === context.paperId;
  }

  workspacePdfLinkUrl(value) {
    if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
    try {
      const url = new URL(value.trim());
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  installWorkspacePdfLinkEvents(host = this.pdfHost) {
    if (!host) return;
    this.workspacePdfLinkHosts ||= new WeakSet();
    if (this.workspacePdfLinkHosts.has(host)) return;
    this.workspacePdfLinkHosts.add(host);
    const handle = (event) => {
      const anchor = event.target?.closest?.("a.paperlib-pdf-link");
      const link = anchor?.__paperlibPdfLink;
      if (!link || !host.contains(anchor)) return;
      if (this.toolMode !== "select") { event.preventDefault(); return; }
      // Capture at the host before page-level figure, excerpt, and ink handlers.
      event.stopPropagation();
      if (event.type === "dragstart") event.preventDefault();
      if (event.type === "contextmenu" && !link.url) event.preventDefault();
      const activate = (event.type === "click" && event.button === 0)
        || (event.type === "auxclick" && event.button === 1);
      if (!activate) return;
      event.preventDefault();
      if (!this.isWorkspacePdfLinkCurrent(link.context)) return;
      if (link.url) {
        host.ownerDocument.defaultView?.open(link.url, "_blank", "noopener,noreferrer");
      } else {
        void this.followWorkspacePdfLink(link);
      }
    };
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click",
      "auxclick", "dblclick", "dragstart", "contextmenu", "keydown", "keyup"]) {
      host.addEventListener(type, handle, true);
    }
  }

  async renderWorkspacePdfLinks(page, pageData, pageWrap, cache = this.pdfCache) {
    const host = this.pdfHost;
    const layer = pageWrap.querySelector(".paperlib-pdf-link-layer");
    if (!layer || !cache?.document || !host) return;
    const context = { cache, document: cache.document, host,
      token: this.pdfRenderToken, paperId: this.paperId };
    const task = Symbol();
    const viewport = pageData.viewport;
    layer.__paperlibPdfLinkTask = task;
    const current = () => this.isWorkspacePdfLinkCurrent(context)
      && host.contains(pageWrap) && pageData.viewport === viewport
      && layer.__paperlibPdfLinkTask === task;
    if (!current()) return;
    this.installWorkspacePdfLinkEvents(host);
    try {
      const annotations = await page.getAnnotations({ intent: "display" });
      if (!current()) return;
      const fragment = pageWrap.ownerDocument.createDocumentFragment();
      for (const annotation of annotations) {
        if (annotation.subtype !== "Link" || annotation.noView) continue;
        const rect = annotation.rect;
        if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) continue;
        const rawUrl = annotation.url || annotation.unsafeUrl;
        const url = this.workspacePdfLinkUrl(rawUrl);
        const destination = annotation.dest;
        const action = ["NextPage", "PrevPage", "FirstPage", "LastPage"].includes(annotation.action)
          ? annotation.action : null;
        if (rawUrl && !url) continue;
        if (!url && !(typeof destination === "string" || Array.isArray(destination)) && !action) continue;
        const box = viewport.convertToViewportRectangle(rect);
        const left = Math.max(0, Math.min(box[0], box[2]));
        const top = Math.max(0, Math.min(box[1], box[3]));
        const right = Math.min(viewport.width, Math.max(box[0], box[2]));
        const bottom = Math.min(viewport.height, Math.max(box[1], box[3]));
        if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
        const anchor = pageWrap.ownerDocument.createElement("a");
        anchor.className = "paperlib-pdf-link";
        anchor.href = url || "#";
        anchor.draggable = false;
        anchor.tabIndex = this.toolMode === "select" ? 0 : -1;
        const label = annotation.titleObj?.str || annotation.contentsObj?.str
          || url || (typeof destination === "string" ? `Go to ${destination}` : action || "Go to PDF destination");
        anchor.setAttribute("aria-label", String(label));
        anchor.title = String(label);
        if (url) {
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
        Object.assign(anchor.style, { position: "absolute", left: `${left}px`, top: `${top}px`,
          width: `${right - left}px`, height: `${bottom - top}px` });
        anchor.__paperlibPdfLink = { url, destination, action,
          pageNumber: Number(pageWrap.dataset.page), context };
        fragment.appendChild(anchor);
      }
      if (current()) layer.replaceChildren(fragment);
    } catch (error) {
      if (current()) console.error("Paper Library: failed to load PDF links", error);
    }
  }

  async followWorkspacePdfLink(link) {
    const { context } = link;
    const { document: pdf, cache, host } = context;
    if (!this.isWorkspacePdfLinkCurrent(context)) return false;
    const task = Symbol();
    this.workspacePdfLinkNavigation = task;
    const current = () => this.isWorkspacePdfLinkCurrent(context)
      && this.workspacePdfLinkNavigation === task;
    let pinned;
    try {
      let destination = link.destination;
      let pageNumber;
      if (typeof destination === "string") {
        destination = await pdf.getDestination(destination);
        if (!current()) return false;
      }
      if (Array.isArray(destination)) {
        const ref = destination[0];
        if (Number.isInteger(ref)) pageNumber = ref + 1;
        else if (ref && Number.isInteger(ref.num) && Number.isInteger(ref.gen)) {
          pageNumber = (await pdf.getPageIndex(ref)) + 1;
          if (!current()) return false;
        } else return false;
      } else if (link.action) {
        const source = link.pageNumber;
        pageNumber = { NextPage: source + 1, PrevPage: source - 1,
          FirstPage: 1, LastPage: pdf.numPages }[link.action];
        pageNumber = Math.max(1, Math.min(pdf.numPages, pageNumber));
      } else return false;
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) return false;
      if (!current()) return false;
      pinned = cache.pageViews.get(pageNumber);
      if (!pinned) return false;
      pinned.pinned = (pinned.pinned || 0) + 1;
      await this.ensureWorkspacePdfPage(pageNumber);
      if (!current()) return false;
      if (!pinned.element || !pinned.pageData?.viewport || !host.contains(pinned.element)) return false;
      return this.scrollWorkspacePdfDestination(host, pinned, destination);
    } catch (error) {
      if (current()) console.error("Paper Library: failed to follow PDF link", error);
      return false;
    } finally {
      if (pinned) pinned.pinned -= 1;
      if (current()) this.scheduleWorkspacePdfVisibility();
    }
  }

  scrollWorkspacePdfDestination(host, view, destination) {
    const viewport = view.pageData.viewport;
    const pageRect = view.element.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    // Bounding rectangles include the board's CSS zoom; scroll offsets do not.
    const hostScaleX = hostRect.width / host.offsetWidth;
    const hostScaleY = hostRect.height / host.offsetHeight;
    const scaleX = pageRect.width / viewport.width / hostScaleX;
    const scaleY = pageRect.height / viewport.height / hostScaleY;
    if (![hostScaleX, hostScaleY, scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0)) return false;
    const left = host.scrollLeft + (pageRect.left - hostRect.left) / hostScaleX - host.clientLeft;
    const top = host.scrollTop + (pageRect.top - hostRect.top) / hostScaleY - host.clientTop;
    const inset = host.querySelector(".paperlib-canvas-pdf-meta")?.offsetHeight || 0;
    const visible = [Math.max(0, Math.min(viewport.width, (host.scrollLeft - left) / scaleX)),
      Math.max(0, Math.min(viewport.height, (host.scrollTop + inset - top) / scaleY))];
    const retained = viewport.convertToPdfPoint(...visible);
    const [xMin, yMin, xMax, yMax] = viewport.viewBox;
    const kind = destination?.[1]?.name;
    const number = (index, fallback) => Number.isFinite(destination?.[index]) ? destination[index] : fallback;
    let point = [0, 0];
    if (kind === "XYZ") {
      point = viewport.convertToViewportPoint(number(2, retained[0]), number(3, retained[1]));
    } else if (["FitH", "FitBH", "FitV", "FitBV", "FitR"].includes(kind)) {
      let rect;
      if (kind === "FitH" || kind === "FitBH") {
        const y = number(2, retained[1]);
        rect = [xMin, y, xMax, y];
      } else if (kind === "FitV" || kind === "FitBV") {
        const x = number(2, retained[0]);
        rect = [x, yMin, x, yMax];
      } else {
        rect = [number(2, xMin), number(3, yMin), number(4, xMax), number(5, yMax)];
      }
      const box = viewport.convertToViewportRectangle(rect);
      point = [Math.min(box[0], box[2]), Math.min(box[1], box[3])];
    }
    // Fit/FitB align the page; destination zoom never changes persisted board zoom.
    if (!point.every(Number.isFinite)) return false;
    host.scrollLeft = Math.max(0, left + Math.max(0, point[0]) * scaleX);
    host.scrollTop = Math.max(0, top + Math.max(0, point[1]) * scaleY - inset);
    return true;
  }

  async renderPdfDocument(host, paper, workspace) {
    this.disposeWorkspacePdfView();
    const token = ++this.pdfRenderToken;
    const pdfPath = normalizePath(paper.pdfPath || "");
    const loading = host.createDiv({ cls: "paperlib-pdf-loading" });
    setPaperlibIcon(loading.createSpan(), "loader-circle");
    loading.createSpan({ text: "正在载入 PDF…" });
    try {
      const file = this.app.vault.getAbstractFileByPath(pdfPath);
      if (!file) throw new Error("找不到 PDF 文件");
      if (!this.pdfCache || this.pdfCache.path !== pdfPath) {
        try { await this.pdfCache?.document?.destroy?.(); } catch (_) {}
        const [pdfjs, buffer] = await Promise.all([loadPdfJs(), this.plugin.readPdfBinary(file)]);
        const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
        if (token !== this.pdfRenderToken) { await document.destroy?.(); return; }
        this.pdfCache = { path: pdfPath, pdfjs, document, pages: new Map(), pageViews: new Map(), pageSizes: new Map() };
      }
      if (token !== this.pdfRenderToken || !host.isConnected) return;
      const cache = this.pdfCache;
      cache.pageViews ||= new Map();
      cache.pageSizes ||= new Map();
      const firstPage = await cache.document.getPage(1);
      const base = firstPage.getViewport({ scale: 1 });
      const mobile = this.plugin.isMobileApp();
      const scale = Math.min(mobile ? 1.15 : 1.35, (mobile ? 520 : 660) / Math.max(1, base.width));
      const estimate = firstPage.getViewport({ scale });
      if (token !== this.pdfRenderToken || !host.isConnected) return;
      loading.remove();
      this.pdfHost = host;
      this.pdfPaper = paper;
      this.pdfWorkspace = workspace;
      const count = cache.document.numPages || 0;
      this.pdfCurrentPage = 1;
      const meta = host.createDiv({ cls: "paperlib-canvas-pdf-meta" });
      const progress = meta.createDiv({ cls: "paperlib-canvas-pdf-progress" });
      iconButton(progress, "chevrons-up", "回到第一页", () => this.scrollWorkspacePdfToPage(1));
      iconButton(progress, "chevron-up", "上一页", () => this.scrollWorkspacePdfToPage((this.pdfCurrentPage || 1) - 1));
      const pageInput = progress.createEl("input", {
        cls: "paperlib-canvas-pdf-page-input",
        attr: { type: "text", inputmode: "numeric", "aria-label": "跳转到页码" }
      });
      pageInput.value = "1";
      this.pdfPageInput = pageInput;
      pageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); this.commitWorkspacePdfPageInput(); }
        else if (event.key === "Escape") {
          pageInput.value = String(this.pdfCurrentPage || 1);
          pageInput.blur();
        }
      });
      pageInput.addEventListener("change", () => this.commitWorkspacePdfPageInput());
      pageInput.addEventListener("blur", () => this.commitWorkspacePdfPageInput());
      this.pdfPageTotal = progress.createSpan({ cls: "paperlib-canvas-pdf-page-total", text: `/ ${count} 页` });
      iconButton(progress, "chevron-down", "下一页", () => this.scrollWorkspacePdfToPage((this.pdfCurrentPage || 1) + 1));
      iconButton(progress, "chevrons-down", "跳到最后一页", () => this.scrollWorkspacePdfToPage(count));
      const figureRecognitionAvailable = this.plugin.settings.enableFigureRecognition && !mobile;
      const recognizedFigureCacheAvailable = Boolean(this.plugin.getPortablePdfFigurePayload(pdfPath));
      const figureStatus = progress.createSpan({ cls: "paperlib-pdf-figure-status",
        text: mobile ? "图片识别：移动端仅查看已识别结果"
          : figureRecognitionAvailable ? "图片识别：准备中"
            : recognizedFigureCacheAvailable ? "图片识别：使用已有结果" : "图片识别：未开启" });
      const pages = host.createDiv({ cls: "paperlib-canvas-pdf-pages" });
      this.pdfPagesHost = pages;
      for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
        const size = cache.pageSizes.get(pageNumber) || estimate;
        const element = this.createWorkspacePdfPlaceholder(pages, pageNumber, size);
        cache.pageViews.set(pageNumber, { pageNumber, element, pageData: null, promise: null, near: false });
      }
      const saved = this.pdfScrollByPath.get(pdfPath);
      if (saved) { host.scrollTop = saved.top; host.scrollLeft = saved.left; }
      const window = host.ownerDocument?.defaultView || globalThis.window;
      if (typeof window?.IntersectionObserver === "function") {
        this.pdfObserver = new window.IntersectionObserver(() => this.scheduleWorkspacePdfVisibility(),
          { root: host, rootMargin: "250px 0px" });
        for (const record of cache.pageViews.values()) this.pdfObserver.observe(record.element);
      }
      if (typeof window?.ResizeObserver === "function") {
        this.pdfResizeObserver = new window.ResizeObserver(() => this.scheduleWorkspacePdfVisibility());
        this.pdfResizeObserver.observe(host);
      }
      const schedule = () => this.scheduleWorkspacePdfVisibility();
      host.addEventListener("scroll", schedule, { passive: true });
      host.ownerDocument?.addEventListener?.("selectionchange", schedule);
      window?.addEventListener?.("resize", schedule, { passive: true });
      this.pdfVisibilityCleanup = () => {
        host.removeEventListener?.("scroll", schedule);
        host.ownerDocument?.removeEventListener?.("selectionchange", schedule);
        window?.removeEventListener?.("resize", schedule);
      };
      this.updateWorkspacePdfVisibility();
      const initial = [...cache.pageViews.values()].filter((record) => record.near).map((record) => this.ensureWorkspacePdfPage(record.pageNumber));
      await Promise.all(initial);
      if (token !== this.pdfRenderToken || !host.isConnected) return;
      if (figureRecognitionAvailable || recognizedFigureCacheAvailable) {
        void this.plugin.getPdfFigureCatalog(pdfPath, (state) => {
          if (token !== this.pdfRenderToken || !figureStatus.isConnected) return;
          if (state.stage === "model") figureStatus.setText("图片识别：正在准备模型");
          else if (state.stage === "page") figureStatus.setText(`图片识别：${state.current}/${state.total} 页 · ${state.figures} 张`);
          else if (state.stage === "complete") figureStatus.setText(`图片识别：已完成 · ${state.figures} 张`);
        }).then((catalog) => {
          if (token === this.pdfRenderToken && pages.isConnected) this.plugin.installPdfFigureDragZones(pages, pdfPath, paper, catalog);
        }).catch((error) => {
          if (token === this.pdfRenderToken && figureStatus.isConnected) {
            figureStatus.setText("图片识别：失败"); figureStatus.setAttribute("title", error.message || String(error));
          }
        });
      }
    } catch (error) {
      if (token !== this.pdfRenderToken) return;
      console.error("Paper Library: failed to render PDF in research canvas", error);
      loading.empty();
      if (!loading.isConnected) host.appendChild(loading);
      setPaperlibIcon(loading.createSpan(), "file-warning");
      loading.createSpan({ text: `PDF 加载失败：${error.message || error}` });
    }
  }

  async renderSelectablePdfPage(parent, paper, workspace, pageNumber, token) {
    const cache = this.pdfCache;
    const record = cache.pageViews.get(pageNumber);
    const current = () => token === this.pdfRenderToken && cache === this.pdfCache
      && cache.pageViews.get(pageNumber) === record && parent.isConnected;
    if (!record || !current()) return;
    let pageData = cache.pages.get(pageNumber);
    if (pageData && record.pageData) {
      const canvas = await this.renderWorkspacePdfBitmap(pageData, token, record.element);
      if (!canvas || token !== this.pdfRenderToken || !record.element.isConnected) return;
      const previous = pageData.canvas;
      previous.replaceWith(canvas);
      pageData.canvas = canvas;
      previous.width = previous.height = 0;
      pageData.textLayerTask?.update?.({ viewport: pageData.viewport });
      return;
    }
    if (!pageData) {
      const page = await cache.document.getPage(pageNumber);
      if (!current()) return;
      const base = page.getViewport({ scale: 1 });
      const mobile = this.plugin.isMobileApp();
      const scale = Math.min(mobile ? 1.15 : 1.35, (mobile ? 520 : 660) / Math.max(1, base.width));
      const viewport = page.getViewport({ scale });
      const textContent = await page.getTextContent();
      if (!current()) return;
      pageData = { page, viewport, textContent, canvas: (parent.ownerDocument || document).createElement("canvas"), ratio: 0 };
      cache.pages.set(pageNumber, pageData);
      cache.pageSizes.set(pageNumber, viewport);
    }
    const bitmap = await this.renderWorkspacePdfBitmap(pageData, token, record.element);
    if (!bitmap) return;
    pageData.canvas = bitmap;
    if (!current()) return;
    const pageWrap = (parent.ownerDocument || document).createElement("article");
    pageWrap.className = "paperlib-selectable-pdf-page";
    pageWrap.style.width = `${pageData.viewport.width}px`;
    pageWrap.style.height = `${pageData.viewport.height}px`;
    pageWrap.dataset.page = String(pageNumber);
    pageWrap.appendChild(pageData.canvas);
    const highlightLayer = pageWrap.createDiv({ cls: "paperlib-pdf-highlight-layer" });
    highlightLayer.style.width = `${pageData.viewport.width}px`;
    highlightLayer.style.height = `${pageData.viewport.height}px`;
    const inkLayer = this.createPdfInkLayer(
      pageWrap,
      this.plugin.getPdfInkStrokes(paper, paper.pdfPath, pageNumber)
    );
    pageWrap.createSpan({ cls: "paperlib-pdf-page-number", text: String(pageNumber) });
    const textLayer = pageWrap.createDiv({ cls: "paperlib-pdf-text-layer textLayer" });
    await this.renderWorkspacePdfText(textLayer, pageData, cache);
    if (token !== this.pdfRenderToken || !parent.isConnected) { pageWrap.remove(); return; }
    pageWrap.createDiv({ cls: "paperlib-pdf-link-layer" });
    const previous = record.element;
    previous.replaceWith(pageWrap);
    this.pdfObserver?.unobserve(previous);
    record.element = pageWrap;
    record.pageData = pageData;
    this.pdfObserver?.observe(pageWrap);
    this.applyPdfMarkings(
      textLayer,
      highlightLayer,
      pageData.viewport,
      paper,
      workspace,
      pageNumber,
      pageData.textContent.items
    );
    pageWrap.addEventListener("pointerdown", (event) => {
      if (event.target?.closest?.("a.paperlib-pdf-link")) return;
      if (event.button === 2) {
        const stroke = this.plugin.findPdfInkStrokeAtEvent(
          event, pageWrap, paper, paper.pdfPath, pageNumber
        );
        if (stroke) this.plugin.schedulePdfInkRegionDrag(event, {
          canvas: pageData.canvas,
          pageEl: pageWrap,
          paper,
          path: paper.pdfPath,
          page: pageNumber,
          stroke,
          title: paper.title
        });
        return;
      }
      if (this.toolMode === "ink") {
        this.beginPdfInkStroke(event, pageWrap, inkLayer, paper, pageNumber);
        return;
      }
      if (this.toolMode !== "ai-region") return;
      this.beginAIRegionSelection(event, pageWrap, pageData, paper, pageNumber);
    }, true);
    pageWrap.addEventListener("contextmenu", (event) => {
      if (this.plugin.consumePdfInkDragContextMenu(event)) return;
      const stroke = this.plugin.findPdfInkStrokeAtEvent(
        event,
        pageWrap,
        paper,
        paper.pdfPath,
        pageNumber
      );
      if (!stroke) return;
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      menu.addItem((item) => item
        .setTitle("作为图片添加到 Paper Composer")
        .setIcon("image")
        .onClick(() => this.plugin.addPdfInkRegionToComposer({
          canvas: pageData.canvas,
          pageEl: pageWrap,
          paper,
          path: paper.pdfPath,
          page: pageNumber,
          stroke,
          title: paper.title
        })));
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("删除此画笔标注")
        .setIcon("eraser")
        .onClick(() => this.plugin.removePdfInkStroke(paper, stroke.id)));
      menu.showAtMouseEvent(event);
    }, true);
    textLayer.addEventListener("pointerdown", (event) => {
      if (this.toolMode === "highlight") this.beginWorkspacePdfHighlight(event, textLayer, paper, pageNumber);
      else {
        this.beginWorkspacePdfTextSelection(event, textLayer, paper, pageNumber);
        this.scheduleExcerptDrag(event, textLayer, paper, pageNumber);
      }
    });
    textLayer.addEventListener("contextmenu", (event) => (
      this.showPdfHighlightMenu(event, paper, pageNumber, pageData.textContent.items)
    ));
    textLayer.addEventListener("dragstart", (event) => event.preventDefault());
    const figureCatalog = this.plugin.pdfFigureCatalogCache?.get?.(normalizePath(paper.pdfPath || ""));
    if (figureCatalog) this.plugin.installPdfFigureDragZones(pageWrap, paper.pdfPath, paper, figureCatalog);
    pageWrap.addEventListener("click", (event) => {
      if (event.target?.closest?.("a.paperlib-pdf-link")) return;
      if (this.toolMode !== "select" || event.button !== 0 || event.defaultPrevented) return;
      const selection = pageWrap.ownerDocument.defaultView?.getSelection?.();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      const rect = pageWrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      void this.plugin.openPdfFigureAtPoint(
        paper.pdfPath,
        paper,
        pageNumber,
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      );
    }, true);
    void this.renderWorkspacePdfLinks(pageData.page, pageData, pageWrap, cache);
  }

  createPdfInkLayer(pageWrap, strokes = []) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "paperlib-pdf-ink-layer");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    pageWrap.appendChild(svg);
    strokes.forEach((stroke) => this.renderPdfInkPath(svg, stroke));
    return svg;
  }

  renderPdfInkPath(svg, stroke, pending = false) {
    if (!svg || !Array.isArray(stroke?.points)) return null;
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === stroke.color) || CANVAS_HIGHLIGHT_COLORS[0];
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `paperlib-pdf-ink-path${pending ? " is-pending" : ""}`);
    path.dataset.strokeId = stroke.id || "";
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color.value);
    path.setAttribute("stroke-width", String(Math.max(1.5, Number(stroke.width) || 3)));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    const points = stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points;
    path.setAttribute("d", points.map((point, index) => (
      `${index ? "L" : "M"} ${(Number(point.x) * 1000).toFixed(2)} ${(Number(point.y) * 1000).toFixed(2)}`
    )).join(" "));
    svg.appendChild(path);
    return path;
  }

  beginPdfInkStroke(event, pageWrap, inkLayer, paper, pageNumber) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.inkDrawingCleanup?.(true);
    const bounds = pageWrap.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const points = [];
    const stroke = {
      id: workspaceId("ink"),
      type: "ink",
      page: pageNumber,
      pdfPath: paper.pdfPath,
      color: this.inkColor,
      width: 3,
      points
    };
    const path = this.renderPdfInkPath(inkLayer, stroke, true);
    let pathData = "";
    const addPoint = (pointer) => {
      const point = {
        x: Math.max(0, Math.min(1, (pointer.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (pointer.clientY - bounds.top) / bounds.height))
      };
      const previous = points[points.length - 1];
      if (previous && Math.hypot((point.x - previous.x) * bounds.width, (point.y - previous.y) * bounds.height) < 1.1) return false;
      points.push(point);
      const x = (point.x * 1000).toFixed(2);
      const y = (point.y * 1000).toFixed(2);
      pathData = points.length === 1 ? `M ${x} ${y} L ${x} ${y}` : `${pathData} L ${x} ${y}`;
      return true;
    };
    addPoint(event);
    path?.setAttribute("d", pathData);
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const samples = moveEvent.getCoalescedEvents?.() || [moveEvent];
      let changed = false;
      samples.forEach((sample) => { changed = addPoint(sample) || changed; });
      if (changed) path?.setAttribute("d", pathData);
    };
    const cleanup = (cancel = false) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelStroke, true);
      if (this.inkDrawingCleanup === cleanup) this.inkDrawingCleanup = null;
      if (cancel || !points.length) {
        path?.remove();
        return;
      }
      path?.classList.remove("is-pending");
      void this.plugin.savePdfInkStroke(paper, stroke);
    };
    const up = (upEvent) => {
      upEvent.preventDefault();
      if (addPoint(upEvent)) path?.setAttribute("d", pathData);
      cleanup(false);
    };
    const cancelStroke = () => cleanup(true);
    this.inkDrawingCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelStroke, true);
  }

  beginAIRegionSelection(event, pageWrap, pageData, paper, pageNumber) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.aiRegionCleanup?.();
    const bounds = pageWrap.getBoundingClientRect();
    const localWidth = pageWrap.offsetWidth || pageData.viewport.width || bounds.width;
    const localHeight = pageWrap.offsetHeight || pageData.viewport.height || bounds.height;
    const point = (pointer) => ({
      x: Math.max(0, Math.min(localWidth, (pointer.clientX - bounds.left) * localWidth / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(localHeight, (pointer.clientY - bounds.top) * localHeight / Math.max(1, bounds.height)))
    });
    const start = point(event);
    const overlay = pageWrap.createDiv({ cls: "paperlib-ai-region-selection" });
    const update = (pointer) => {
      const current = point(pointer);
      const left = Math.min(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      return { left, top, width, height };
    };
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      update(moveEvent);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      overlay.remove();
      if (this.aiRegionCleanup === cleanup) this.aiRegionCleanup = null;
    };
    const cancel = () => cleanup();
    const up = (upEvent) => {
      upEvent.preventDefault();
      const region = update(upEvent);
      cleanup();
      if (region.width < 10 || region.height < 10) return;
      try {
        const source = pageData.canvas;
        const scaleX = source.width / Math.max(1, localWidth);
        const scaleY = source.height / Math.max(1, localHeight);
        const sourceX = Math.max(0, Math.floor(region.left * scaleX));
        const sourceY = Math.max(0, Math.floor(region.top * scaleY));
        const sourceWidth = Math.max(1, Math.min(source.width - sourceX, Math.ceil(region.width * scaleX)));
        const sourceHeight = Math.max(1, Math.min(source.height - sourceY, Math.ceil(region.height * scaleY)));
        const limitScale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
        const crop = document.createElement("canvas");
        crop.width = Math.max(1, Math.round(sourceWidth * limitScale));
        crop.height = Math.max(1, Math.round(sourceHeight * limitScale));
        const context = crop.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, crop.width, crop.height);
        context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);
        const dataUrl = crop.toDataURL("image/png");
        void this.plugin.addAIContext({
          type: "image",
          label: `${paper.title} · 第 ${pageNumber} 页圈选区域`,
          detail: `${crop.width} × ${crop.height}`,
          dataUrl,
          mime: "image/png",
          path: paper.pdfPath || "",
          page: pageNumber,
          key: `pdf-region:${paper.pdfPath || paper.id}:${pageNumber}:${Math.round(region.left)}:${Math.round(region.top)}:${Math.round(region.width)}:${Math.round(region.height)}`
        }, { draft: "请分析我圈选的 PDF 区域：说明图表或公式表达了什么，并结合论文语境解释。" });
      } catch (error) {
        console.error("Paper Library: failed to capture PDF region", error);
        new Notice(`圈选区域失败：${error.message || error}`);
      }
    };
    this.aiRegionCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    update(event);
  }

  renderPdfHighlightRects(highlightLayer, viewport, marking) {
    if (!highlightLayer || !viewport?.convertToViewportRectangle || !Array.isArray(marking?.pdfRects)) return false;
    const rectangles = marking.pdfRects
      .map((item) => item?.rect)
      .filter((rect) => rect?.length === 4)
      .map((rect) => viewport.convertToViewportRectangle(rect))
      .map((rect) => [
        Math.min(rect[0], rect[2]),
        Math.min(rect[1], rect[3]),
        Math.max(rect[0], rect[2]),
        Math.max(rect[1], rect[3])
      ]);
    const merged = this.plugin.mergePdfHighlightViewportRects(rectangles);
    if (!merged.length) return false;
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => (
      item.id === String(marking.color || "").toLocaleLowerCase()
    )) || CANVAS_HIGHLIGHT_COLORS[0];
    merged.forEach((rect) => {
      const highlight = highlightLayer.createDiv({ cls: "paperlib-pdf-highlight-rect" });
      highlight.style.left = `${rect[0]}px`;
      highlight.style.top = `${rect[1]}px`;
      highlight.style.width = `${Math.max(0.5, rect[2] - rect[0])}px`;
      highlight.style.height = `${Math.max(0.5, rect[3] - rect[1])}px`;
      highlight.style.setProperty("--paperlib-pdf-highlight", `${color.value}70`);
      if (marking.id) highlight.dataset.markId = marking.id;
    });
    return true;
  }

  applyPdfMarkings(textLayer, highlightLayer, viewport, paper, workspace, pageNumber, textItems) {
    const pdfPath = normalizePath(paper.pdfPath || "");
    const excerpts = workspace.nodes.filter((node) => (
      node.type === "excerpt" && Number(node.page) === Number(pageNumber)
      && normalizePath(node.pdfPath || paper.pdfPath) === pdfPath
    ));
    const highlights = (workspace.highlights || []).filter((highlight) => (
      Number(highlight.page) === Number(pageNumber)
      && normalizePath(highlight.pdfPath || paper.pdfPath) === pdfPath
    ));
    const markings = [...highlights, ...excerpts].map((node) => {
      const displayRects = this.plugin.getPdfMarkDisplayRects(node, textItems);
      return {
        node,
        displayNode: { ...node, pdfRects: displayRects },
        pdfTextIndexes: new Set(this.plugin.getPdfTextItemIndexesForRects(textItems, displayRects))
      };
    });
    highlightLayer?.replaceChildren();
    const geometricMarkings = new Set();
    markings.forEach(({ node, displayNode }) => {
      if (this.renderPdfHighlightRects(highlightLayer, viewport, displayNode)) geometricMarkings.add(node);
    });
    textLayer.querySelectorAll(".paperlib-pdf-text-item").forEach((span) => {
      const index = Number(span.dataset.textIndex);
      const markingEntry = markings.find(({ node, pdfTextIndexes }) => {
        if (geometricMarkings.has(node)) return false;
        if (pdfTextIndexes.size) return pdfTextIndexes.has(index);
        const range = node.selection || {};
        return index >= Number(range.beginIndex) && index <= Number(range.endIndex);
      });
      const marking = markingEntry?.node;
      span.classList.toggle("is-highlighted", Boolean(marking));
      if (!marking) {
        span.style.removeProperty("--paperlib-pdf-highlight");
        return;
      }
      const color = CANVAS_HIGHLIGHT_COLORS.find((item) => (
        item.id === String(marking.color || "").toLocaleLowerCase()
      ));
      if (color) span.style.setProperty("--paperlib-pdf-highlight", `${color.value}70`);
    });
  }

  refreshPdfHighlights(paper = this.getPaper()) {
    if (!paper || paper.id !== this.paperId || normalizePath(this.pdfCache?.path || "") !== normalizePath(paper.pdfPath || "")) {
      return false;
    }
    const workspace = this.plugin.ensureResearchWorkspace(paper);
    let refreshed = false;
    this.containerEl.querySelectorAll(".paperlib-selectable-pdf-page").forEach((pageWrap) => {
      const pageNumber = Number(pageWrap.dataset.page);
      const pageData = this.pdfCache.pages.get(pageNumber);
      const textLayer = pageWrap.querySelector(".paperlib-pdf-text-layer");
      const highlightLayer = pageWrap.querySelector(".paperlib-pdf-highlight-layer");
      if (!pageData?.textContent?.items || !textLayer || !highlightLayer) return;
      this.applyPdfMarkings(
        textLayer,
        highlightLayer,
        pageData.viewport,
        paper,
        workspace,
        pageNumber,
        pageData.textContent.items
      );
      const inkLayer = pageWrap.querySelector(".paperlib-pdf-ink-layer");
      if (inkLayer) {
        inkLayer.replaceChildren();
        this.plugin.getPdfInkStrokes(paper, paper.pdfPath, pageNumber)
          .forEach((stroke) => this.renderPdfInkPath(inkLayer, stroke));
      }
      refreshed = true;
    });
    return refreshed;
  }

  showPdfHighlightMenu(event, paper, pageNumber, textItems = null) {
    const targetSpan = event.target.closest?.(".paperlib-pdf-text-item");
    const targetLayer = event.target.closest?.(".paperlib-pdf-text-layer");
    const selection = targetLayer?.ownerDocument?.defaultView?.getSelection?.() || window.getSelection?.();
    const selectionElement = selection?.anchorNode?.nodeType === 3
      ? selection.anchorNode.parentElement
      : selection?.anchorNode;
    const selectedSpan = selectionElement?.closest?.(".paperlib-pdf-text-item");
    const selectedLayer = selectedSpan?.closest?.(".paperlib-pdf-text-layer");
    const textLayer = targetLayer || selectedLayer;
    const span = targetSpan || (selectedSpan && textLayer?.contains(selectedSpan) ? selectedSpan : null);
    if (!span || !textLayer) return;
    const selectionContext = textLayer
      ? this.getCanvasSelection(textLayer, span, paper, pageNumber, false)
      : null;
    const index = Number(span.dataset.textIndex);
    const marks = this.plugin.getPdfMarkEntriesAtTextIndex(
      paper,
      paper.pdfPath,
      pageNumber,
      index,
      textItems
    );
    if (!marks.length && !selectionContext) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    if (selectionContext) {
      menu.addItem((item) => item
        .setTitle("Ask AI")
        .setIcon("sparkles")
        .onClick(() => this.plugin.addAIContext({
          type: "selection",
          label: `${paper.title} · 第 ${pageNumber} 页选区`,
          detail: `${selectionContext.text.length} 字符`,
          text: selectionContext.text,
          path: paper.pdfPath || "",
          page: pageNumber,
          key: `pdf-selection:${paper.pdfPath || ""}:${pageNumber}:${selectionContext.text.slice(0, 120)}`
        }, { draft: "请解释这段 PDF 文字，并结合论文上下文回答。" })));
      if (marks.length) menu.addSeparator();
    }
    marks.forEach((entry) => {
      const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === String(entry.record.color || "").toLocaleLowerCase());
      menu.addItem((item) => item
        .setTitle(marks.length > 1
          ? `删除${color?.label || "此处"}${entry.record.pdfSubtype === "Text" ? "注释" : "高光"}`
          : `删除${entry.record.pdfSubtype === "Text" ? "注释" : "高光"}`)
        .setIcon("eraser")
        .onClick(() => this.plugin.deletePdfMark(paper, entry)));
    });
    if (marks.length > 1) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("删除此处全部标注")
        .setIcon("trash-2")
        .onClick(async () => {
          for (const entry of marks) await this.plugin.deletePdfMark(paper, entry);
        }));
    }
    menu.showAtMouseEvent(event);
  }

  scheduleExcerptDrag(event, textLayer, paper, pageNumber) {
    if (this.toolMode === "highlight") return;
    if (event.button !== 0 || !event.target.closest(".paperlib-pdf-text-item")) return;
    if (this.longPressTimer) window.clearTimeout(this.longPressTimer);
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.target;
    const preparedContext = this.getCanvasSelection(textLayer, target, paper, pageNumber, false);
    const cancelPending = () => {
      if (this.longPressTimer) window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      window.removeEventListener("pointermove", pendingMove);
      window.removeEventListener("pointerup", pendingUp);
      window.removeEventListener("pointercancel", pendingUp);
    };
    const pendingMove = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <= 9) return;
      cancelPending();
      if (preparedContext) this.beginExcerptDrag(moveEvent, textLayer, paper, pageNumber, preparedContext);
    };
    const pendingUp = () => cancelPending();
    window.addEventListener("pointermove", pendingMove);
    window.addEventListener("pointerup", pendingUp, { once: true });
    window.addEventListener("pointercancel", pendingUp, { once: true });
    this.longPressTimer = window.setTimeout(() => {
      cancelPending();
      this.beginExcerptDrag({ clientX: startX, clientY: startY, target }, textLayer, paper, pageNumber, preparedContext);
    }, 420);
  }

  handlePdfHighlight(event, textLayer, paper, pageNumber) {
    if (this.toolMode !== "highlight" || event.button !== 0) return;
    const owner = textLayer.ownerDocument.defaultView;
    owner.setTimeout(() => {
      if (!textLayer.isConnected) return;
      this.repairWorkspacePdfSelectionEnd(textLayer, event);
      const context = this.getCanvasSelection(textLayer, event.target, paper, pageNumber, false);
      if (!context) return;
      this.paintPdfHighlight(textLayer, context, this.highlightColor);
      void this.plugin.saveCanvasHighlight(context, this.highlightColor);
      owner.getSelection?.()?.removeAllRanges?.();
    }, 0);
  }

  paintPdfHighlight(textLayer, context, colorId) {
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === colorId) || CANVAS_HIGHLIGHT_COLORS[0];
    const highlightLayer = textLayer.closest(".paperlib-selectable-pdf-page")?.querySelector(".paperlib-pdf-highlight-layer");
    if (this.renderPdfHighlightRects(highlightLayer, textLayer.__paperlibViewport, {
      id: `pending-${Date.now()}`,
      color: color.id,
      pdfRects: context.pdfRects
    })) return;
    const range = context.range;
    textLayer.querySelectorAll(".paperlib-pdf-text-item").forEach((span) => {
      const index = Number(span.dataset.textIndex);
      if (index < Number(range.beginIndex) || index > Number(range.endIndex)) return;
      span.addClass("is-highlighted");
      span.style.setProperty("--paperlib-pdf-highlight", `${color.value}70`);
    });
  }

  getCanvasSelection(textLayer, target, paper, pageNumber, allowFallback = true) {
    if (!textLayer?.ownerDocument) return null;
    const doc = textLayer.ownerDocument;
    const selection = doc.defaultView?.getSelection?.() || doc.getSelection?.();
    const spans = this.getCanvasSelectionItemSpans(textLayer);
    const bounds = doc.createRange();
    bounds.selectNodeContents(textLayer);
    let domRange = selection?.rangeCount && !selection.isCollapsed
      ? this.intersectCanvasSelectionRanges(selection.getRangeAt(0), bounds) : null;
    let parts = domRange ? this.getCanvasSelectionParts(domRange, spans) : [];
    if (!parts.length && allowFallback) {
      const element = target?.nodeType === 3 ? target.parentElement : target;
      const span = element?.closest?.(".paperlib-pdf-text-item");
      if (!span || !spans.includes(span) || !span.textContent.trim()) return null;
      domRange = doc.createRange();
      domRange.selectNodeContents(span);
      parts = this.getCanvasSelectionParts(domRange, [span]);
      if (!parts.length) return null;
      selection?.removeAllRanges();
      selection?.addRange(domRange);
    }
    if (!parts.length) return null;
    const fragment = domRange.cloneContents();
    fragment.querySelectorAll("br").forEach((br) => br.replaceWith(doc.createTextNode(" ")));
    const text = String(fragment.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const first = parts[0];
    const last = parts[parts.length - 1];
    const selectedRange = {
      beginIndex: first.index, beginOffset: first.beginOffset,
      endIndex: last.index, endOffset: last.endOffset
    };
    const clientRects = this.getCanvasSelectionItemRects(parts.map((part) => part.span), selectedRange);
    let dragSourceRect = null;
    for (const rect of clientRects) {
      if (!dragSourceRect) {
        dragSourceRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      } else {
        dragSourceRect.left = Math.min(dragSourceRect.left, rect.left);
        dragSourceRect.top = Math.min(dragSourceRect.top, rect.top);
        dragSourceRect.right = Math.max(dragSourceRect.right, rect.right);
        dragSourceRect.bottom = Math.max(dragSourceRect.bottom, rect.bottom);
      }
    }
    if (dragSourceRect) {
      dragSourceRect.width = dragSourceRect.right - dragSourceRect.left;
      dragSourceRect.height = dragSourceRect.bottom - dragSourceRect.top;
    }
    return {
      paper, text: text.slice(0, 8000), page: pageNumber, range: selectedRange,
      pdfRects: this.getCanvasPdfRects(textLayer, selectedRange, clientRects),
      pdfPath: paper.pdfPath, sourceLeaf: this.leaf,
      selectionSource: "workspace", rectCoordinateSpace: "pdf", dragSourceRect
    };
  }

  getCanvasSelectionClientRects(textLayer, selectionRange) {
    if (!textLayer?.ownerDocument || !selectionRange) return [];
    return this.getCanvasSelectionItemRects(this.getCanvasSelectionItemSpans(textLayer), selectionRange);
  }

  getCanvasSelectionItemSpans(textLayer) {
    return Array.from(textLayer.querySelectorAll(".paperlib-pdf-text-item[data-text-index]"))
      .filter((span) => /^\d+$/.test(span.dataset.textIndex)
        && Number.isSafeInteger(Number(span.dataset.textIndex)));
  }

  intersectCanvasSelectionRanges(range, bounds) {
    if (range.startContainer.getRootNode() !== bounds.startContainer.getRootNode()) return null;
    const clipped = range.cloneRange();
    if (range.compareBoundaryPoints(range.START_TO_START, bounds) < 0) {
      clipped.setStart(bounds.startContainer, bounds.startOffset);
    }
    if (range.compareBoundaryPoints(range.END_TO_END, bounds) > 0) {
      clipped.setEnd(bounds.endContainer, bounds.endOffset);
    }
    return clipped.collapsed ? null : clipped;
  }

  getCanvasSelectionParts(range, spans) {
    const parts = [];
    let low = 0;
    let high = spans.length;
    // Mapped spans are in DOM order; skip items preceding the selection.
    while (low < high) {
      const middle = (low + high) >>> 1;
      const span = spans[middle];
      if (range.comparePoint(span, span.childNodes.length) < 0) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < spans.length; index += 1) {
      const span = spans[index];
      if (range.comparePoint(span, 0) > 0) break;
      const contents = span.ownerDocument.createRange();
      contents.selectNodeContents(span);
      const overlap = this.intersectCanvasSelectionRanges(range, contents);
      if (!overlap) continue;
      const length = overlap.toString().length;
      if (!length) continue;
      contents.setEnd(overlap.startContainer, overlap.startOffset);
      const beginOffset = contents.toString().length;
      parts.push({ span, index: Number(span.dataset.textIndex), beginOffset, endOffset: beginOffset + length });
    }
    return parts;
  }

  getCanvasSelectionTextSlices(span, start = 0, end = Infinity) {
    start = Math.max(0, Math.trunc(Number(start) || 0));
    end = Math.max(0, Math.trunc(Number(end) || 0));
    if (end <= start) return [];
    const doc = span.ownerDocument;
    const walker = doc.createTreeWalker(span, doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4);
    const slices = [];
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
      const length = node.data.length;
      const from = Math.max(0, start - offset);
      const to = Math.min(length, end - offset);
      if (to > from) slices.push({ node, start: from, end: to });
      offset += length;
      if (offset >= end) break;
    }
    return slices;
  }

  getCanvasSelectionItemRects(spans, selectionRange) {
    const beginIndex = Number(selectionRange.beginIndex);
    const endIndex = Number(selectionRange.endIndex);
    if (!Number.isSafeInteger(beginIndex) || !Number.isSafeInteger(endIndex)
      || beginIndex < 0 || endIndex < beginIndex) return [];
    const rects = [];
    for (const span of spans) {
      const index = Number(span.dataset.textIndex);
      if (index < beginIndex || index > endIndex) continue;
      const start = index === beginIndex ? Number(selectionRange.beginOffset) || 0 : 0;
      const end = index === endIndex ? Number(selectionRange.endOffset) || 0 : Infinity;
      const slices = this.getCanvasSelectionTextSlices(span, start, end);
      if (!slices.length) continue;
      const range = span.ownerDocument.createRange();
      for (const slice of slices) {
        range.setStart(slice.node, slice.start);
        range.setEnd(slice.node, slice.end);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect);
        }
      }
    }
    return rects;
  }

  getCanvasPdfRects(textLayer, selectionRange, clientRects = null) {
    const viewport = textLayer?.__paperlibViewport;
    if (!selectionRange || !viewport?.convertToPdfPoint) return [];
    const layerRect = textLayer.getBoundingClientRect();
    const scaleX = layerRect.width / Math.max(1, Number(viewport.width) || layerRect.width);
    const scaleY = layerRect.height / Math.max(1, Number(viewport.height) || layerRect.height);
    return (clientRects || this.getCanvasSelectionClientRects(textLayer, selectionRange))
      .map((rect) => {
        const left = Math.max(0, (rect.left - layerRect.left) / Math.max(0.001, scaleX));
        const right = Math.min(viewport.width, (rect.right - layerRect.left) / Math.max(0.001, scaleX));
        const top = Math.max(0, (rect.top - layerRect.top) / Math.max(0.001, scaleY));
        const bottom = Math.min(viewport.height, (rect.bottom - layerRect.top) / Math.max(0.001, scaleY));
        const topLeft = viewport.convertToPdfPoint(left, top);
        const topRight = viewport.convertToPdfPoint(right, top);
        const bottomLeft = viewport.convertToPdfPoint(left, bottom);
        const bottomRight = viewport.convertToPdfPoint(right, bottom);
        return {
          quad: [...topLeft, ...topRight, ...bottomLeft, ...bottomRight],
          rect: [
            Math.min(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
            Math.min(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
            Math.max(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
            Math.max(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1])
          ]
        };
      });
  }

  beginExcerptDrag(event, textLayer, paper, pageNumber, preparedContext = null) {
    this.dismissWorkspacePdfSelectionToolbar();
    const context = preparedContext || this.getCanvasSelection(textLayer, event.target, paper, pageNumber);
    if (!context) return;
    const ghost = document.body.createDiv({ cls: "paperlib-excerpt-drag-ghost" });
    const echo = ghost.createDiv({ cls: "paperlib-excerpt-drag-echo" });
    echo.createSpan({ text: truncate(context.text, 150) });
    const card = ghost.createDiv({ cls: "paperlib-excerpt-drag-card" });
    const icon = card.createSpan({ cls: "paperlib-excerpt-drag-icon" });
    setPaperlibIcon(icon, "text-quote");
    const content = card.createDiv({ cls: "paperlib-excerpt-drag-content" });
    content.createEl("strong", { text: `摘录 · 第 ${pageNumber} 页` });
    content.createSpan({ text: truncate(context.text, 120) });
    const sourceRect = context.dragSourceRect || {
      left: event.clientX,
      top: event.clientY,
      width: 120,
      height: 20
    };
    const startWidth = Math.min(380, Math.max(84, Number(sourceRect.width) || 120));
    const startHeight = Math.min(58, Math.max(20, Number(sourceRect.height) || 20));
    ghost.style.left = `${sourceRect.left}px`;
    ghost.style.top = `${sourceRect.top}px`;
    ghost.style.width = `${startWidth}px`;
    ghost.style.height = `${startHeight}px`;
    ghost.style.setProperty("--paperlib-drag-progress", "0");
    ghost.style.setProperty("--paperlib-drag-card-scale", "0.92");
    this.excerptDrag = {
      context,
      ghost,
      startX: event.clientX,
      startY: event.clientY,
      sourceRect,
      startWidth,
      startHeight
    };
    this.containerEl.addClass("is-dragging-excerpt");
    const move = (moveEvent) => this.moveExcerptGhost(moveEvent);
    const up = (upEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      this.finishExcerptDrag(upEvent, false);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      this.finishExcerptDrag(null, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    window.requestAnimationFrame(() => ghost.addClass("is-visible"));
    this.moveExcerptGhost(event);
  }

  moveExcerptGhost(event) {
    if (!this.excerptDrag) return;
    const drag = this.excerptDrag;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const linear = Math.min(1, Math.max(0, (distance - 4) / 150));
    const progress = linear * linear * (3 - 2 * linear);
    const targetLeft = event.clientX + 18;
    const targetTop = event.clientY + 16;
    const left = drag.sourceRect.left + (targetLeft - drag.sourceRect.left) * progress;
    const top = drag.sourceRect.top + (targetTop - drag.sourceRect.top) * progress;
    const width = drag.startWidth + (286 - drag.startWidth) * progress;
    const height = drag.startHeight + (88 - drag.startHeight) * progress;
    drag.ghost.style.left = `${left}px`;
    drag.ghost.style.top = `${top}px`;
    drag.ghost.style.width = `${width}px`;
    drag.ghost.style.height = `${height}px`;
    drag.ghost.style.setProperty("--paperlib-drag-progress", progress.toFixed(3));
    drag.ghost.style.setProperty("--paperlib-drag-card-scale", (0.92 + progress * 0.08).toFixed(3));
    drag.ghost.toggleClass("is-card", progress > 0.58);
    const viewport = this.containerEl.querySelector(".paperlib-board-viewport");
    const rect = viewport?.getBoundingClientRect();
    const inside = rect && event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.removeClass("paperlib-paper-composer-drag-over"));
    aiTarget?.addClass?.("paperlib-paper-composer-drag-over");
    viewport?.toggleClass("is-excerpt-drop-target", Boolean(inside));
    drag.ghost.toggleClass("is-over-drop-target", Boolean((inside || aiTarget) && progress > 0.58));
  }

  finishExcerptDrag(event, cancel = false) {
    if (this.longPressTimer) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    const drag = this.excerptDrag;
    this.excerptDrag = null;
    this.containerEl?.removeClass("is-dragging-excerpt");
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.removeClass("paperlib-paper-composer-drag-over"));
    const viewport = this.containerEl?.querySelector(".paperlib-board-viewport");
    viewport?.removeClass("is-excerpt-drop-target");
    const dismissGhost = (className) => {
      if (!drag?.ghost) return;
      drag.ghost.addClass(className);
      window.setTimeout(() => drag.ghost?.remove(), 180);
    };
    if (!drag || cancel || !event) {
      dismissGhost("is-cancelled");
      return;
    }
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    if (aiTarget) {
      dismissGhost("is-dropping");
      void this.plugin.addAIContext({
        type: "selection",
        label: `${drag.context.paper?.title || "PDF"} · 第 ${drag.context.page || "—"} 页选区`,
        detail: `${drag.context.text.length} 字符`,
        text: drag.context.text,
        path: drag.context.pdfPath || "",
        page: drag.context.page || null,
        key: `pdf-selection:${drag.context.pdfPath || ""}:${drag.context.page || ""}:${drag.context.text.slice(0, 120)}`
      });
      window.setTimeout(() => window.getSelection?.()?.removeAllRanges?.(), 0);
      return;
    }
    if (!viewport) {
      dismissGhost("is-cancelled");
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    if (event.clientX < viewportRect.left || event.clientX > viewportRect.right
      || event.clientY < viewportRect.top || event.clientY > viewportRect.bottom) {
      dismissGhost("is-cancelled");
      return;
    }
    dismissGhost("is-dropping");
    const board = viewport.querySelector(".paperlib-board-canvas");
    const boardRect = board.getBoundingClientRect();
    const paper = drag.context.paper;
    const workspace = this.plugin.ensureResearchWorkspace(paper);
    const zoom = this.getWorkspaceZoom(workspace);
    const position = {
      x: Math.max(24, (event.clientX - boardRect.left) / zoom - 145),
      y: Math.max(24, (event.clientY - boardRect.top) / zoom - 44)
    };
    const color = this.plugin.settings.defaultHighlightColor || "Yellow";
    void this.plugin.savePdfHighlight(drag.context, color, "", { position, openWorkspace: false });
    const selection = window.getSelection?.();
    window.setTimeout(() => selection?.removeAllRanges?.(), 0);
  }

  renderConnections(board, workspace, visibleIds) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "paperlib-board-links");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    board.appendChild(svg);
    workspace.links.forEach((link) => {
      if (!visibleIds.has(link.from) || !visibleIds.has(link.to)) return;
      const from = workspace.nodes.find((node) => node.id === link.from);
      const to = workspace.nodes.find((node) => node.id === link.to);
      if (!from || !to) return;
      const inferred = this.inferConnectionSides(from, to);
      const start = this.getNodeAnchor(board, from, link.fromSide || inferred.fromSide);
      const end = this.getNodeAnchor(board, to, link.toSide || inferred.toSide);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", this.connectionPath(start, end));
      path.setAttribute("class", "paperlib-board-link");
      path.dataset.linkId = link.id;
      svg.appendChild(path);
    });
  }

  getExcerptSourceElements(board, node) {
    const highlights = Array.from(board.querySelectorAll(".paperlib-pdf-highlight-rect"))
      .filter((element) => element.dataset.markId === node.id);
    if (highlights.length) return highlights;
    const page = Array.from(board.querySelectorAll(".paperlib-selectable-pdf-page"))
      .find((element) => Number(element.dataset.page) === Number(node.page));
    if (!page) return [];
    const range = node.selection || {};
    const beginIndex = Number(range.beginIndex);
    const endIndex = Number(range.endIndex);
    if (Number.isFinite(beginIndex) && Number.isFinite(endIndex)) {
      const spans = Array.from(page.querySelectorAll(".paperlib-pdf-text-item")).filter((element) => {
        const index = Number(element.dataset.textIndex);
        return index >= Math.min(beginIndex, endIndex) && index <= Math.max(beginIndex, endIndex);
      });
      if (spans.length) return spans;
    }
    const needle = String(node.text || "").replace(/\s+/g, " ").trim().slice(0, 36);
    if (!needle) return [];
    return Array.from(page.querySelectorAll(".paperlib-pdf-text-item"))
      .filter((element) => needle.includes(String(element.textContent || "").trim()))
      .slice(0, 4);
  }

  clientRectToBoardRect(board, rect) {
    const boardRect = board.getBoundingClientRect();
    const scaleX = board.offsetWidth ? boardRect.width / board.offsetWidth : 1;
    const scaleY = board.offsetHeight ? boardRect.height / board.offsetHeight : scaleX;
    return {
      left: (rect.left - boardRect.left) / Math.max(0.001, scaleX),
      top: (rect.top - boardRect.top) / Math.max(0.001, scaleY),
      right: (rect.right - boardRect.left) / Math.max(0.001, scaleX),
      bottom: (rect.bottom - boardRect.top) / Math.max(0.001, scaleY)
    };
  }

  sourceConnectionAnchor(rect, side) {
    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;
    if (side === "top") return { x: centerX, y: rect.top, side };
    if (side === "bottom") return { x: centerX, y: rect.bottom, side };
    if (side === "left") return { x: rect.left, y: centerY, side };
    return { x: rect.right, y: centerY, side: "right" };
  }

  showSourceConnection(board, node, card) {
    if (node.type !== "excerpt") return;
    this.hideSourceConnection();
    const sourceColor = CANVAS_HIGHLIGHT_COLORS.find((color) => (
      color.id === String(node.color || "").toLocaleLowerCase()
    )) || CANVAS_HIGHLIGHT_COLORS[0];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "paperlib-board-source-links");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.setProperty("--paperlib-source-color", sourceColor.value);
    board.appendChild(svg);
    card.addClass("is-source-linked");
    card.style.setProperty("--paperlib-source-color", sourceColor.value);
    let sourceElements = [];
    let sourceOutline = null;
    let frameBody = null;
    let scheduledFrame = 0;
    const update = () => {
      if (!board.isConnected || !card.isConnected) return;
      sourceElements.forEach((element) => element.removeClass("is-source-linked"));
      sourceElements = this.getExcerptSourceElements(board, node);
      sourceElements.forEach((element) => element.addClass("is-source-linked"));
      frameBody = board.querySelector(".paperlib-canvas-pdf-body");
      svg.replaceChildren();
      if (!sourceElements.length || !frameBody) {
        sourceOutline?.remove();
        sourceOutline = null;
        return;
      }
      const bodyRect = frameBody.getBoundingClientRect();
      const cardClientRect = card.getBoundingClientRect();
      const cardCenter = {
        x: (cardClientRect.left + cardClientRect.right) / 2,
        y: (cardClientRect.top + cardClientRect.bottom) / 2
      };
      const nearest = sourceElements.reduce((best, element) => {
        const rect = element.getBoundingClientRect();
        const x = (rect.left + rect.right) / 2;
        const y = (rect.top + rect.bottom) / 2;
        const distance = Math.hypot(x - cardCenter.x, y - cardCenter.y);
        return !best || distance < best.distance ? { element, rect, distance } : best;
      }, null);
      if (!nearest?.rect?.width || !nearest.rect.height) return;
      const sourcePage = nearest.element.closest(".paperlib-selectable-pdf-page");
      const pageElements = sourceElements.filter((element) => (
        element.closest(".paperlib-selectable-pdf-page") === sourcePage
      ));
      const sourceBounds = pageElements.reduce((bounds, element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return bounds;
        if (!bounds) return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        bounds.left = Math.min(bounds.left, rect.left);
        bounds.top = Math.min(bounds.top, rect.top);
        bounds.right = Math.max(bounds.right, rect.right);
        bounds.bottom = Math.max(bounds.bottom, rect.bottom);
        return bounds;
      }, null);
      if (!sourcePage || !sourceBounds) return;
      const pageRect = sourcePage.getBoundingClientRect();
      const pageScaleX = sourcePage.offsetWidth / Math.max(1, pageRect.width);
      const pageScaleY = sourcePage.offsetHeight / Math.max(1, pageRect.height);
      const outlinePadding = 6;
      if (!sourceOutline) {
        sourceOutline = sourcePage.createDiv({ cls: "paperlib-pdf-source-outline" });
        sourceOutline.style.setProperty("--paperlib-source-color", sourceColor.value);
      } else if (sourceOutline.parentElement !== sourcePage) {
        sourcePage.appendChild(sourceOutline);
      }
      sourceOutline.style.left = `${Math.max(2, (sourceBounds.left - pageRect.left) * pageScaleX - outlinePadding)}px`;
      sourceOutline.style.top = `${Math.max(2, (sourceBounds.top - pageRect.top) * pageScaleY - outlinePadding)}px`;
      sourceOutline.style.width = `${Math.max(8, (sourceBounds.right - sourceBounds.left) * pageScaleX + outlinePadding * 2)}px`;
      sourceOutline.style.height = `${Math.max(8, (sourceBounds.bottom - sourceBounds.top) * pageScaleY + outlinePadding * 2)}px`;
      const sourceCenter = {
        x: Math.max(bodyRect.left, Math.min(bodyRect.right, (sourceBounds.left + sourceBounds.right) / 2)),
        y: Math.max(bodyRect.top, Math.min(bodyRect.bottom, (sourceBounds.top + sourceBounds.bottom) / 2))
      };
      const sourceVisible = sourceBounds.right >= bodyRect.left && sourceBounds.left <= bodyRect.right
        && sourceBounds.bottom >= bodyRect.top && sourceBounds.top <= bodyRect.bottom;
      const sourceClientRect = sourceVisible ? sourceBounds : {
        left: sourceCenter.x - 1, right: sourceCenter.x + 1,
        top: sourceCenter.y - 1, bottom: sourceCenter.y + 1
      };
      const cardRect = this.clientRectToBoardRect(board, cardClientRect);
      const sourceRect = this.clientRectToBoardRect(board, sourceClientRect);
      // Source provenance always owns the left card port. Manual card links
      // may share this same anchor; they must not push provenance elsewhere.
      const cardSide = "left";
      const sourceDx = (cardRect.left + cardRect.right - sourceRect.left - sourceRect.right) / 2;
      const sourceDy = (cardRect.top + cardRect.bottom - sourceRect.top - sourceRect.bottom) / 2;
      const sourceHorizontal = Math.abs(sourceDx) >= Math.abs(sourceDy);
      const sourceSide = sourceHorizontal
        ? (sourceDx >= 0 ? "right" : "left")
        : (sourceDy >= 0 ? "bottom" : "top");
      const start = this.sourceConnectionAnchor(cardRect, cardSide);
      const end = this.sourceConnectionAnchor(sourceRect, sourceSide);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", `paperlib-board-source-link${sourceVisible ? "" : " is-source-offscreen"}`);
      path.setAttribute("d", this.connectionPath(start, end));
      svg.appendChild(path);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("class", "paperlib-board-source-dot");
      dot.setAttribute("cx", String(end.x));
      dot.setAttribute("cy", String(end.y));
      dot.setAttribute("r", sourceVisible ? "5" : "6");
      svg.appendChild(dot);
    };
    const scheduleUpdate = () => {
      if (scheduledFrame) return;
      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = 0;
        update();
      });
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !svg.contains(mutation.target))) scheduleUpdate();
    });
    observer.observe(board, { childList: true, subtree: true });
    board.querySelector(".paperlib-canvas-pdf-body")?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    this.sourceLinkPreview = {
      nodeId: node.id,
      update: scheduleUpdate,
      cleanup: () => {
        if (scheduledFrame) window.cancelAnimationFrame(scheduledFrame);
        observer.disconnect();
        frameBody?.removeEventListener("scroll", scheduleUpdate);
        board.querySelector(".paperlib-canvas-pdf-body")?.removeEventListener("scroll", scheduleUpdate);
        window.removeEventListener("resize", scheduleUpdate);
        sourceElements.forEach((element) => element.removeClass("is-source-linked"));
        card.removeClass("is-source-linked");
        card.style.removeProperty("--paperlib-source-color");
        sourceOutline?.remove();
        svg.remove();
      }
    };
    update();
  }

  hideSourceConnection(nodeId = null) {
    if (!this.sourceLinkPreview || (nodeId && this.sourceLinkPreview.nodeId !== nodeId)) return;
    const preview = this.sourceLinkPreview;
    this.sourceLinkPreview = null;
    preview.cleanup?.();
  }

  updateConnectionPaths(board, workspace) {
    workspace.links.forEach((link) => {
      const path = board.querySelector(`.paperlib-board-link[data-link-id="${link.id}"]`);
      const from = workspace.nodes.find((node) => node.id === link.from);
      const to = workspace.nodes.find((node) => node.id === link.to);
      if (!path || !from || !to) return;
      const inferred = this.inferConnectionSides(from, to);
      const start = this.getNodeAnchor(board, from, link.fromSide || inferred.fromSide);
      const end = this.getNodeAnchor(board, to, link.toSide || inferred.toSide);
      path.setAttribute("d", this.connectionPath(start, end));
    });
  }

  inferConnectionSides(from, to) {
    const dx = Number(to.x || 0) - Number(from.x || 0);
    const dy = Number(to.y || 0) - Number(from.y || 0);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
    }
    return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
  }

  getNodeAnchor(board, node, side) {
    const card = Array.from(board.querySelectorAll(".paperlib-research-node"))
      .find((element) => element.dataset.nodeId === node.id);
    const x = Number(node.x || 0);
    const y = Number(node.y || 0);
    const width = card?.offsetWidth || (node.type === "group" ? 330 : 290);
    const height = card?.offsetHeight || 152;
    if (side === "top") return { x: x + width / 2, y, side };
    if (side === "bottom") return { x: x + width / 2, y: y + height, side };
    if (side === "left") return { x, y: y + height / 2, side };
    return { x: x + width, y: y + height / 2, side: "right" };
  }

  connectionPath(start, end) {
    const vectors = {
      top: { x: 0, y: -1 }, right: { x: 1, y: 0 },
      bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }
    };
    const startVector = vectors[start.side] || vectors.right;
    const endVector = vectors[end.side] || vectors.left;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const bend = Math.min(240, Math.max(62, distance * 0.34));
    const c1 = { x: start.x + startVector.x * bend, y: start.y + startVector.y * bend };
    const c2 = { x: end.x + endVector.x * bend, y: end.y + endVector.y * bend };
    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
  }

  renderNode(board, paper, node, zoom) {
    const card = board.createEl("article", {
      cls: `paperlib-research-node is-${node.type || "note"} ${this.connectingFrom === node.id ? "is-connecting" : ""}`
    });
    card.dataset.nodeId = node.id;
    card.style.left = `${Number(node.x || 40)}px`;
    card.style.top = `${Number(node.y || 40)}px`;
    if (node.type === "excerpt") {
      card.addEventListener("pointerenter", () => this.showSourceConnection(board, node, card));
      card.addEventListener("pointerleave", () => this.hideSourceConnection(node.id));
      card.addEventListener("focusin", () => this.showSourceConnection(board, node, card));
      card.addEventListener("focusout", (event) => {
        if (!card.contains(event.relatedTarget)) this.hideSourceConnection(node.id);
      });
    }
    const head = card.createEl("header", { cls: "paperlib-node-head" });
    const badge = head.createSpan({ cls: "paperlib-node-badge" });
    setPaperlibIcon(badge, node.type === "excerpt" ? "text-quote" : node.type === "group" ? "layout-template" : "sticky-note");
    badge.createSpan({ text: node.type === "excerpt" ? `P. ${node.page || "—"}` : node.type === "group" ? "主题" : "想法" });
    const actions = head.createDiv({ cls: "paperlib-node-actions" });
    if (node.type === "excerpt") iconButton(actions, "external-link", "跳到原文", () => this.plugin.openResearchSource(paper, node));
    const aiDrag = iconButton(actions, "sparkles", "拖到 Paper Composer", () => this.plugin.addAIContext(
      this.plugin.researchNodeToAIAttachment(paper, node),
      { draft: "请结合这个研究节点回答我的问题。" }
    ), "paperlib-node-ai-drag");
    aiDrag.draggable = true;
    aiDrag.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer?.setData("application/x-paperlib-node", node.id);
      event.dataTransfer?.setData("text/plain", node.text || node.comment || this.plugin.researchNodeLabel(node));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    iconButton(actions, "trash-2", "删除卡片", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.plugin.removeResearchNode(paper, node.id);
    });

    if (node.type === "excerpt") {
      card.createDiv({ cls: "paperlib-node-quote", text: node.text });
      const comment = card.createEl("textarea", {
        cls: "paperlib-node-comment",
        placeholder: "在摘录旁写下你的想法…",
        attr: { "aria-label": "摘录批注" }
      });
      comment.value = node.comment || "";
      this.installNodeEditor(comment, paper, node, "comment");
      if (node.color) card.dataset.color = node.color.toLocaleLowerCase();
    } else {
      const editor = card.createEl("textarea", {
        cls: "paperlib-node-note",
        placeholder: node.type === "group" ? "为这一组内容命名…" : "写下一个想法、问题或结论…",
        attr: { "aria-label": node.type === "group" ? "主题标题" : "研究想法" }
      });
      editor.value = node.text || "";
      this.installNodeEditor(editor, paper, node, "text");
      if (node.isNew) {
        delete node.isNew;
        window.setTimeout(() => {
          editor.focus();
          void this.plugin.saveSettings();
        }, 0);
      }
    }
    const workspace = this.plugin.ensureResearchWorkspace(paper);
    const attachedLinks = workspace.links.filter((link) => link.from === node.id || link.to === node.id);
    if (attachedLinks.length) {
      const links = card.createDiv({ cls: "paperlib-node-connections" });
      attachedLinks.forEach((link) => {
        const otherId = link.from === node.id ? link.to : link.from;
        const other = workspace.nodes.find((item) => item.id === otherId);
        if (!other) return;
        const chip = links.createEl("button", { attr: { title: "点击移除此连接" } });
        setPaperlibIcon(chip.createSpan(), "link-2");
        chip.createSpan({ text: truncate(this.plugin.researchNodeLabel(other), 24) });
        setPaperlibIcon(chip.createSpan(), "x");
        chip.addEventListener("click", () => this.plugin.removeResearchLink(paper, link.id));
      });
    }
    ["top", "right", "bottom", "left"].forEach((side) => {
      const port = card.createEl("button", {
        cls: `paperlib-node-port is-${side}`,
        attr: { "aria-label": `从卡片${side}侧建立连接`, title: "拖动以连接卡片" }
      });
      port.dataset.side = side;
      port.addEventListener("pointerdown", (event) => this.startConnectionDrag(event, board, paper, node, side, zoom));
    });
    this.installNodeDrag(card, head, paper, node, zoom);
  }

  startConnectionDrag(event, board, paper, node, side, zoom) {
    zoom = this.getWorkspaceZoom(this.plugin.ensureResearchWorkspace(paper));
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.finishConnectionDrag(null, true);
    const svg = board.querySelector(".paperlib-board-links");
    if (!svg) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "paperlib-board-link is-preview");
    svg.appendChild(path);
    const start = this.getNodeAnchor(board, node, side);
    const move = (moveEvent) => {
      const rect = board.getBoundingClientRect();
      const end = {
        x: (moveEvent.clientX - rect.left) / zoom,
        y: (moveEvent.clientY - rect.top) / zoom,
        side: "left"
      };
      path.setAttribute("d", this.connectionPath(start, end));
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest?.(".paperlib-research-node");
      board.querySelectorAll(".paperlib-research-node.is-connection-target").forEach((element) => element.removeClass("is-connection-target"));
      if (target?.dataset.nodeId && target.dataset.nodeId !== node.id) target.addClass("is-connection-target");
    };
    const up = (upEvent) => this.finishConnectionDrag(upEvent, false);
    const cancel = () => this.finishConnectionDrag(null, true);
    this.connectionDrag = { board, paper, node, side, zoom, path, move, up, cancel };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    move(event);
  }

  finishConnectionDrag(event, cancel = false) {
    const drag = this.connectionDrag;
    this.connectionDrag = null;
    if (!drag) return;
    window.removeEventListener("pointermove", drag.move);
    window.removeEventListener("pointerup", drag.up);
    window.removeEventListener("pointercancel", drag.cancel);
    drag.path?.remove();
    drag.board?.querySelectorAll(".paperlib-research-node.is-connection-target")
      .forEach((element) => element.removeClass("is-connection-target"));
    if (cancel || !event) return;
    const targetCard = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paperlib-research-node");
    const targetId = targetCard?.dataset.nodeId;
    if (!targetId || targetId === drag.node.id) return;
    const targetNode = this.plugin.ensureResearchWorkspace(drag.paper).nodes.find((node) => node.id === targetId);
    if (!targetNode) return;
    const targetPort = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paperlib-node-port");
    const toSide = targetPort?.dataset.side || this.nearestNodeSide(targetCard, event.clientX, event.clientY);
    void this.plugin.connectResearchNodes(drag.paper, drag.node.id, targetId, drag.side, toSide);
  }

  nearestNodeSide(card, clientX, clientY) {
    const rect = card.getBoundingClientRect();
    const distances = {
      top: Math.abs(clientY - rect.top),
      right: Math.abs(clientX - rect.right),
      bottom: Math.abs(clientY - rect.bottom),
      left: Math.abs(clientX - rect.left)
    };
    return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
  }

  installNodeEditor(editor, paper, node, key) {
    editor.addEventListener("pointerdown", (event) => event.stopPropagation());
    editor.addEventListener("keydown", (event) => event.stopPropagation());
    editor.addEventListener("input", () => {
      editor.style.height = "auto";
      editor.style.height = `${Math.min(240, Math.max(56, editor.scrollHeight))}px`;
    });
    editor.addEventListener("change", () => {
      node[key] = editor.value.trim();
      void this.plugin.persistResearchWorkspace(paper, false);
    });
  }

  installNodeDrag(card, handle, paper, node, zoom) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = this.getWorkspaceZoom(this.plugin.ensureResearchWorkspace(paper));
      const originX = Number(node.x || 0);
      const originY = Number(node.y || 0);
      card.addClass("is-dragging");
      const move = (moveEvent) => {
        node.x = Math.max(0, originX + (moveEvent.clientX - startX) / zoom);
        node.y = Math.max(0, originY + (moveEvent.clientY - startY) / zoom);
        card.style.left = `${node.x}px`;
        card.style.top = `${node.y}px`;
        this.updateConnectionPaths(card.parentElement, this.plugin.ensureResearchWorkspace(paper));
        this.sourceLinkPreview?.update?.();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        card.removeClass("is-dragging");
        void this.plugin.persistResearchWorkspace(paper);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
  }

  addNode(paper, type) {
    this.plugin.addResearchNode(paper, { type, text: "", isNew: true });
  }

  toggleConnection(paper, nodeId) {
    if (!this.connectingFrom) {
      this.connectingFrom = nodeId;
      this.render();
      return;
    }
    if (this.connectingFrom === nodeId) {
      this.connectingFrom = null;
      this.render();
      return;
    }
    const from = this.connectingFrom;
    this.connectingFrom = null;
    void this.plugin.connectResearchNodes(paper, from, nodeId);
  }

  setZoom(paper, value) {
    if (this.applyWorkspaceZoom) this.applyWorkspaceZoom(value);
    else {
      const workspace = this.plugin.ensureResearchWorkspace(paper);
      this.assignWorkspaceZoom(workspace, value);
      void this.plugin.persistResearchWorkspace(paper, false);
      this.render();
    }
  }
}

export { PaperResearchWorkspaceView };
