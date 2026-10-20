import { CANVAS_HIGHLIGHT_COLORS, PDF_TEXT_COLORS } from "../constants.js";
import { ClearAnnotationsModal, PdfAnnotationsModal } from "../modals/annotations.js";
import { Menu, Notice, loadPdfJs, normalizePath, setIcon } from "obsidian";
import { NativePdfAnnotationModal } from "../modals/misc.js";
import { getPdfFigureCatalog, getPortablePdfFigurePayload, installPdfFigureDragZones, openPdfFigureAtPoint, openPdfFigureGallery } from "../services/pdf-figures.js";
import { highlighterCursor, setPaperlibIcon } from "../ui-utils.js";
import { truncate } from "../text-utils.js";
import { workspaceId } from "../paper-utils.js";

const toolbarMethods = {
  setupNativePdfToolbar() {
    const mount = () => {
      if (this.nativePdfMountTimer) window.clearTimeout(this.nativePdfMountTimer);
      this.nativePdfMountTimer = window.setTimeout(() => {
        this.nativePdfMountTimer = null;
        this.mountNativePdfToolbars();
      }, 60);
    };
    if (this.app.workspace?.on && this.registerEvent) {
      this.registerEvent(this.app.workspace.on("layout-change", mount));
      this.registerEvent(this.app.workspace.on("active-leaf-change", mount));
      this.registerEvent(this.app.workspace.on("file-open", mount));
      // 离开某个 PDF 视图时，把它积累的待写回批注批量写入（重载发生在看不见的时候）
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
        const activePath = normalizePath(this.app.workspace.getActiveFile?.()?.path || "");
        void this.flushPdfAnnotationSyncs((mark) => normalizePath(mark.pdfPath || "") !== activePath);
      }));
    }
    // 切走应用/最小化时也把待写回批注落盘；onunload 里的异步写回无法等待，
    // 这是退出 Obsidian 前最后一道兜底。
    const flushPending = () => {
      if (this.pendingPdfAnnotationSyncs?.size) void this.flushPdfAnnotationSyncs();
      void this.flushPdfOverlayPersists().catch((error) => (
        console.warn("Paper Library: failed to flush PDF overlay data", error)
      ));
    };
    if (this.registerDomEvent && typeof window !== "undefined") {
      this.registerDomEvent(window, "blur", flushPending);
    }
    if (this.registerDomEvent && typeof document !== "undefined") {
      this.registerDomEvent(document, "visibilitychange", () => {
        if (document.visibilityState === "hidden") flushPending();
      });
    }
      // 主窗口和弹出窗口都要监听：PDF 工具栏可能在任意一个 document 里异步创建
    this.nativePdfToolbarObservers = this.nativePdfToolbarObservers || [];
    const observeDocument = (doc) => {
      if (!doc?.body || this.nativePdfToolbarObservers.some((entry) => entry.doc === doc)) return;
      const Observer = doc.defaultView?.MutationObserver || MutationObserver;
      const observer = new Observer(mount);
      observer.observe(doc.body, { childList: true, subtree: true });
      this.nativePdfToolbarObservers.push({ doc, observer });
    };
    observeDocument(document);
    // 插件加载前已经存在的弹出窗口没有 window-open 事件，补一次观察
    const existingWindows = this.app.workspace?.windowManager?.windows;
    if (Array.isArray(existingWindows)) {
      existingWindows.forEach((entry) => observeDocument(entry?.doc || entry?.win?.document));
    }
    if (this.app.workspace?.on && this.registerEvent) {
      this.registerEvent(this.app.workspace.on("window-open", (workspaceWindow, win) => {
        const doc = win?.document
          || workspaceWindow?.doc
          || workspaceWindow?.win?.document
          || workspaceWindow?.window?.document;
        if (doc) observeDocument(doc);
        mount();
      }));
    }
    if (this.register) this.register(() => {
      (this.nativePdfToolbarObservers || []).forEach(({ observer }) => observer?.disconnect?.());
      this.nativePdfToolbarObservers = [];
      if (this.nativePdfMountRetryTimer) globalThis.clearTimeout(this.nativePdfMountRetryTimer);
      this.nativePdfMountRetryTimer = null;
    });
    mount();
  },

  scheduleNativePdfMountRetry() {
    if (this.nativePdfMountRetryTimer) return;
    this.nativePdfMountRetryCount = (this.nativePdfMountRetryCount || 0) + 1;
    // 约 10 秒内持续重试，覆盖 PDF 文件加载和弹出窗口初始化的延迟
    if (this.nativePdfMountRetryCount > 40) return;
    this.nativePdfMountRetryTimer = globalThis.setTimeout(() => {
      this.nativePdfMountRetryTimer = null;
      this.mountNativePdfToolbars();
    }, 250);
  },

  mountNativePdfToolbars() {
    const leaves = this.app.workspace?.getLeavesOfType?.("pdf") || [];
    if (!leaves.length) {
      this.nativePdfMountRetryCount = 0;
      if (this.nativePdfMountRetryTimer) globalThis.clearTimeout(this.nativePdfMountRetryTimer);
      this.nativePdfMountRetryTimer = null;
      return;
    }
    let missingToolbar = false;
    leaves.forEach((leaf) => {
      const container = leaf.view?.containerEl;
      if (!container) {
        missingToolbar = true;
        return;
      }
      if (container.isConnected === false) return;
      const toolbar = container.querySelector?.(".pdf-toolbar");
      if (!toolbar) {
        missingToolbar = true;
        return;
      }
      const file = leaf.view?.file;
      const paper = file ? this.getPaperForPdfFile(file) : null;
      this.nativePdfEmptyTextBoxCleanup = this.nativePdfEmptyTextBoxCleanup || new Set();
      if (paper && file?.path && !this.nativePdfEmptyTextBoxCleanup.has(container)) {
        this.nativePdfEmptyTextBoxCleanup.add(container);
        void (async () => {
          try {
            await this.cleanupEmptyPdfTextBoxes(paper, file.path);
          } catch (error) {
            console.warn("Paper Library: failed to clean empty text boxes", error);
          }
          try {
            await this.backfillPdfInkAnnotations(paper, file);
          } catch (error) {
            console.warn("Paper Library: failed to queue ink annotations for writeback", error);
          }
          // 删除被清理/早已删除的文本框可能留下孤儿注解，打开时一并去除
          // 仅在论文的 pdfPath 与当前文件完全一致时执行，避免路径匹配失败误删全部插件注解
          if (normalizePath(paper.pdfPath || "") !== normalizePath(file.path)) return;
          try {
            await this.pruneLocalPdfAnnotations(file.path);
          } catch (error) {
            console.warn("Paper Library: failed to prune stale PDF annotations", error);
          }
        })();
      }
      const existingGroup = container.querySelector(".paperlib-native-pdf-tools");
      if (existingGroup) {
        const existingState = this.nativePdfStates.get(container) || {
          mode: "", highlightColor: String(this.settings.defaultHighlightColor || "yellow").toLocaleLowerCase(), inkColor: "yellow", inkWidth: 4, textboxFontSize: Number(this.settings.pdfTextBoxFontSize) || 18, textboxColor: String(this.settings.pdfTextBoxTextColor || "orange"), shapeType: "line", shapeColor: "yellow", shapeWidth: 2.5, paletteOpen: false, busy: false
        };
        existingState.highlightColor ||= existingState.color || "yellow";
        existingState.inkColor ||= existingState.color || "yellow";
        existingState.paletteOpen = Boolean(existingState.paletteOpen);
        this.nativePdfStates.set(container, existingState);
        const existingInk = existingGroup.querySelector(".paperlib-native-pdf-tool.is-ink");
        if (existingInk && !existingInk.querySelector("svg.lucide-pencil")) setPaperlibIcon(existingInk, "pencil");
        ["is-highlighter", "is-ink"].forEach((toolClass) => {
          const tool = existingGroup.querySelector(`.paperlib-native-pdf-tool.${toolClass}`);
          if (tool && !tool.querySelector(".paperlib-native-pdf-color-bar")) {
            const colorBar = document.createElement("span");
            colorBar.className = "paperlib-native-pdf-color-bar";
            colorBar.setAttribute("aria-hidden", "true");
            tool.appendChild(colorBar);
          }
        });
        this.updateNativePdfToolbarState(container, existingGroup, existingState);
        void this.renderNativePdfInkOverlays(leaf, container).catch((error) => console.error("Paper Library: failed to render ink overlays", error));
        void this.renderNativePdfShapeOverlays(leaf, container).catch((error) => console.error("Paper Library: failed to render shape overlays", error));
        void this.renderNativePdfHighlightOverlays(leaf, container);
        void this.renderNativePdfNoteOverlays(leaf, container);
        void this.renderNativePdfTextBoxes(leaf, container).catch((error) => console.error("Paper Library: failed to render text boxes", error));
        this.ensureNativePdfFigureDragZones(leaf, container, existingState);
        return;
      }
      container.classList.add("paperlib-native-pdf-host");
      const state = this.nativePdfStates.get(container) || {
        mode: "", highlightColor: String(this.settings.defaultHighlightColor || "yellow").toLocaleLowerCase(), inkColor: "yellow", inkWidth: 4, textboxFontSize: Number(this.settings.pdfTextBoxFontSize) || 18, textboxColor: String(this.settings.pdfTextBoxTextColor || "orange"), shapeType: "line", shapeColor: "yellow", shapeWidth: 2.5, paletteOpen: false, busy: false
      };
      state.highlightColor ||= state.color || "yellow";
      state.inkColor ||= state.color || "yellow";
      state.inkWidth ||= 4;
      state.textboxFontSize ||= Number(this.settings.pdfTextBoxFontSize) || 18;
      state.textboxColor ||= String(this.settings.pdfTextBoxTextColor || "orange");
      state.shapeType ||= "line";
      state.shapeColor ||= "yellow";
      state.shapeWidth ||= 2.5;
      state.paletteOpen = Boolean(state.paletteOpen);
      this.nativePdfStates.set(container, state);
      const group = document.createElement("div");
      group.className = "paperlib-native-pdf-tools";
      group.setAttribute("aria-label", "Paper Library PDF 标注工具");
      const select = document.createElement("button");
      select.className = "clickable-icon paperlib-native-pdf-tool is-select";
      select.title = "鼠标 / 选择";
      select.setAttribute("aria-label", "鼠标 / 选择");
      setPaperlibIcon(select, "mouse-pointer-2");
      group.appendChild(select);
      const highlight = document.createElement("button");
      highlight.className = "clickable-icon paperlib-native-pdf-tool is-highlighter";
      highlight.title = "Paper Library 荧光笔";
      highlight.setAttribute("aria-label", "荧光笔");
      setPaperlibIcon(highlight, "highlighter");
      const highlightColorBar = document.createElement("span");
      highlightColorBar.className = "paperlib-native-pdf-color-bar";
      highlightColorBar.setAttribute("aria-hidden", "true");
      highlight.appendChild(highlightColorBar);
      group.appendChild(highlight);
      const underline = document.createElement("button");
      underline.className = "clickable-icon paperlib-native-pdf-tool is-underline";
      underline.title = "Paper Library 下划线";
      underline.setAttribute("aria-label", "下划线");
      setPaperlibIcon(underline, "underline");
      group.appendChild(underline);
      const palette = document.createElement("div");
      palette.className = "paperlib-native-pdf-palette";
      const shapesColumn = document.createElement("div");
      shapesColumn.className = "paperlib-native-pdf-shapes";
      [
        { id: "line", label: "直线", icon: "minus" },
        { id: "arrow", label: "箭头", icon: "move-up-right" },
        { id: "circle", label: "圆", icon: "circle" },
        { id: "ellipse", label: "椭圆", icon: "ellipse" },
        { id: "rect", label: "矩形", icon: "square" }
      ].forEach((tool) => {
        const button = document.createElement("button");
        button.className = "clickable-icon paperlib-native-pdf-shape-tool";
        button.dataset.shape = tool.id;
        button.title = tool.label;
        button.setAttribute("aria-label", tool.label);
        setPaperlibIcon(button, tool.icon);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.shapeType = tool.id;
          this.updateNativePdfToolbarState(container, group, state);
        });
        shapesColumn.appendChild(button);
      });
      palette.appendChild(shapesColumn);
      const colorsColumn = document.createElement("div");
      colorsColumn.className = "paperlib-native-pdf-colors";
      palette.appendChild(colorsColumn);
      CANVAS_HIGHLIGHT_COLORS.forEach((color) => {
        const swatch = document.createElement("button");
        swatch.className = "paperlib-native-pdf-swatch";
        swatch.title = color.label;
        swatch.setAttribute("aria-label", `${color.label}荧光笔`);
        swatch.dataset.color = color.id;
        swatch.style.setProperty("--swatch-color", color.value);
        swatch.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (state.mode === "ink") state.inkColor = color.id;
          else if (state.mode === "shape") state.shapeColor = color.id;
          else state.highlightColor = color.id;
          if (!["highlight", "ink", "shape"].includes(state.mode)) state.mode = "highlight";
          if (state.mode !== "shape") state.paletteOpen = false;
          this.updateNativePdfToolbarState(container, group, state);
        });
        colorsColumn.appendChild(swatch);
      });
      const widths = document.createElement("div");
      widths.className = "paperlib-native-pdf-widths";
      const widthSlider = document.createElement("input");
      widthSlider.type = "range";
      widthSlider.className = "paperlib-native-pdf-width-slider";
      widthSlider.min = "1.5";
      widthSlider.max = "8";
      widthSlider.step = "0.5";
      widthSlider.title = "粗细";
      widthSlider.setAttribute("aria-label", "线条粗细");
      widthSlider.value = String(Number(state.mode === "shape" ? state.shapeWidth : state.inkWidth) || 4);
      const widthValue = document.createElement("span");
      widthValue.className = "paperlib-native-pdf-width-value";
      const formatWidth = (value) => String(Math.round((Number(value) || 4) * 10) / 10);
      widthValue.textContent = formatWidth(widthSlider.value);
      const applyWidth = () => {
        const value = Math.max(1.5, Math.min(8, Number(widthSlider.value) || 4));
        if (state.mode === "shape") state.shapeWidth = value;
        else state.inkWidth = value;
        widthValue.textContent = formatWidth(value);
        this.updateNativePdfToolbarState(container, group, state);
      };
      widthSlider.addEventListener("input", applyWidth);
      widthSlider.addEventListener("change", applyWidth);
      widths.appendChild(widthSlider);
      widths.appendChild(widthValue);
      palette.appendChild(widths);
      const textboxPanel = document.createElement("div");
      textboxPanel.className = "paperlib-native-pdf-textbox-panel";
      const sizeRow = document.createElement("div");
      sizeRow.className = "paperlib-native-pdf-size-row";
      const sizeLabel = document.createElement("span");
      sizeLabel.textContent = "字号";
      const sizeInput = document.createElement("input");
      sizeInput.type = "number";
      sizeInput.min = "8";
      sizeInput.max = "48";
      sizeInput.step = "1";
      sizeInput.className = "paperlib-native-pdf-size-input";
      sizeInput.value = String(Number(state.textboxFontSize) || 18);
      sizeInput.addEventListener("pointerdown", (event) => event.stopPropagation());
      const commitSize = () => {
        const value = Math.max(8, Math.min(48, Math.round(Number(sizeInput.value) || 18)));
        sizeInput.value = String(value);
        state.textboxFontSize = value;
        this.settings.pdfTextBoxFontSize = value;
        void this.saveSettings();
      };
      sizeInput.addEventListener("change", commitSize);
      sizeInput.addEventListener("blur", commitSize);
      sizeInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); commitSize(); sizeInput.blur(); }
      });
      sizeRow.appendChild(sizeInput);
      sizeRow.appendChild(sizeLabel);
      textboxPanel.appendChild(sizeRow);
      const textColorRow = document.createElement("div");
      textColorRow.className = "paperlib-native-pdf-text-colors";
      PDF_TEXT_COLORS.forEach((color) => {
        const button = document.createElement("button");
        button.className = "paperlib-native-pdf-text-color";
        button.dataset.textColor = color.id;
        button.title = `文字颜色：${color.label}`;
        button.setAttribute("aria-label", `文字颜色 ${color.label}`);
        button.style.setProperty("--swatch-color", color.value);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.textboxColor = color.id;
          this.settings.pdfTextBoxTextColor = color.id;
          void this.saveSettings();
          this.updateNativePdfToolbarState(container, group, state);
        });
        textColorRow.appendChild(button);
      });
      textboxPanel.appendChild(textColorRow);
      palette.appendChild(textboxPanel);
      group.appendChild(palette);
      const ink = document.createElement("button");
      ink.className = "clickable-icon paperlib-native-pdf-tool is-ink";
      ink.title = "Paper Library 自由画笔";
      ink.setAttribute("aria-label", "自由画笔");
      setPaperlibIcon(ink, "pencil");
      const inkColorBar = document.createElement("span");
      inkColorBar.className = "paperlib-native-pdf-color-bar";
      inkColorBar.setAttribute("aria-hidden", "true");
      ink.appendChild(inkColorBar);
      group.appendChild(ink);
      const textbox = document.createElement("button");
      textbox.className = "clickable-icon paperlib-native-pdf-tool is-textbox";
      textbox.title = "文本";
      textbox.setAttribute("aria-label", "文本");
      setPaperlibIcon(textbox, "square-pen");
      group.appendChild(textbox);
      textbox.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "textbox";
        state.mode = "textbox";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      const shapes = document.createElement("button");
      shapes.className = "clickable-icon paperlib-native-pdf-tool is-shapes";
      shapes.title = "形状";
      shapes.setAttribute("aria-label", "形状");
      setPaperlibIcon(shapes, "shapes");
      group.appendChild(shapes);
      shapes.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "shape";
        state.mode = "shape";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      const askRegion = document.createElement("button");
      askRegion.className = "clickable-icon paperlib-native-pdf-tool is-ai-region";
      askRegion.title = "圈选区域 Ask AI";
      askRegion.setAttribute("aria-label", "圈选区域 Ask AI");
      setPaperlibIcon(askRegion, "scan");
      group.appendChild(askRegion);
      const eraser = document.createElement("button");
      eraser.className = "clickable-icon paperlib-native-pdf-tool is-eraser";
      eraser.title = "橡皮：拖过标注以删除";
      eraser.setAttribute("aria-label", "橡皮");
      setPaperlibIcon(eraser, "eraser");
      group.appendChild(eraser);
      const clearAll = document.createElement("button");
      clearAll.className = "clickable-icon paperlib-native-pdf-tool is-clear-annotations";
      clearAll.title = "清空本文所有标注";
      clearAll.setAttribute("aria-label", "清空所有标注");
      setPaperlibIcon(clearAll, "trash-2");
      group.appendChild(clearAll);
      const annotations = document.createElement("button");
      annotations.className = "clickable-icon paperlib-native-pdf-tool is-annotations";
      annotations.title = "查看本文所有标注";
      annotations.setAttribute("aria-label", "查看标注列表");
      setPaperlibIcon(annotations, "notebook-pen");
      group.appendChild(annotations);
      annotations.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        if (!file) return new Notice("当前没有打开 PDF");
        const paper = this.getPaperForPdfFile(file);
        if (!paper) return new Notice("请先把这个文档加入论文库");
        new PdfAnnotationsModal(this.app, this, paper, file.path).open();
      });
      const figures = document.createElement("button");
      figures.className = "clickable-icon paperlib-native-pdf-tool is-figures";
      figures.title = "浏览 PDF 中的所有图片";
      figures.setAttribute("aria-label", "浏览所有图片");
      setPaperlibIcon(figures, "images");
      group.appendChild(figures);
      eraser.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = state.mode === "eraser" ? "" : "eraser";
        state.paletteOpen = false;
        state.erasing = null;
        container.ownerDocument?.defaultView?.getSelection?.()?.removeAllRanges?.();
        this.updateNativePdfToolbarState(container, group, state);
      });
      clearAll.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        if (!file) return new Notice("当前没有打开 PDF");
        const paper = this.getPaperForPdfFile(file);
        if (!paper) return new Notice("请先把这个文档加入论文库");
        const path = normalizePath(file.path);
        const workspace = this.ensureResearchWorkspace(paper);
        const highlightCount = (workspace.highlights || []).filter((mark) => (
          normalizePath(mark.pdfPath || paper.pdfPath || "") === path
        )).length;
        const annotationCount = (paper.annotations || []).filter((mark) => (
          normalizePath(mark.pdfPath || paper.pdfPath || "") === path
          && (mark.pdfSubtype === "FreeText" ? Boolean(mark.box) : Array.isArray(mark.pdfRects) && mark.pdfRects.length)
        )).length;
        const shapeCount = (workspace.pdfShapes || []).filter((shape) => (
          normalizePath(shape.pdfPath || paper.pdfPath || "") === path
        )).length;
        const inkCount = (workspace.inkStrokes || []).filter((stroke) => (
          normalizePath(stroke.pdfPath || paper.pdfPath || "") === path
        )).length;
        const total = highlightCount + annotationCount + shapeCount + inkCount;
        if (!total) return new Notice("本文没有标注");
        new ClearAnnotationsModal(this.app, this, paper, path, total).open();
      });
      select.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = "";
        state.paletteOpen = false;
        this.updateNativePdfToolbarState(container, group, state);
      });
      highlight.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "highlight";
        state.mode = "highlight";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      underline.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "underline";
        state.mode = "underline";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      ink.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "ink";
        state.mode = "ink";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      askRegion.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = state.mode === "ai-region" ? "" : "ai-region";
        state.paletteOpen = false;
        this.updateNativePdfToolbarState(container, group, state);
      });
      figures.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        if (!file) return new Notice("当前没有打开 PDF");
        void this.openPdfFigureGallery(file.path, this.getPaperForPdfFile(file));
      });
      container.appendChild(group);
      this.updateNativePdfToolbarState(container, group, state);
      void this.renderNativePdfInkOverlays(leaf, container, true).catch((error) => console.error("Paper Library: failed to render ink overlays", error));
      void this.renderNativePdfShapeOverlays(leaf, container, true).catch((error) => console.error("Paper Library: failed to render shape overlays", error));
      void this.renderNativePdfHighlightOverlays(leaf, container, true);
      void this.renderNativePdfNoteOverlays(leaf, container, true);
      void this.renderNativePdfTextBoxes(leaf, container, true).catch((error) => console.error("Paper Library: failed to render text boxes", error));
      this.ensureNativePdfFigureDragZones(leaf, container, state);
      if (!this.nativePdfBindings.has(container)) {
        const pointerDown = (event) => {
          const active = this.nativePdfStates.get(container);
          if (active?.busy) return;
          // 工具栏与调色板属于插件自身 UI，点击它们不应在页面上落笔
          if (event.target?.closest?.(".paperlib-native-pdf-tools")) return;
          const pageEl = event.target?.closest?.(".page[data-page-number], .page");
          if (event.button === 2 && pageEl && container.contains(pageEl)) {
            const file = leaf.view?.file || this.app.workspace.getActiveFile();
            const paper = this.getPaperForPdfFile(file);
            const page = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
            const stroke = file && paper
              ? this.findPdfInkStrokeAtEvent(event, pageEl, paper, file.path, page)
              : null;
            const canvas = pageEl.querySelector(".canvasWrapper canvas, canvas");
            if (stroke && canvas) this.schedulePdfInkRegionDrag(event, {
              canvas,
              pageEl,
              paper,
              path: file.path,
              page,
              stroke,
              title: paper.title || file.basename || file.name
            });
            return;
          }
          if (event.target?.closest?.(".paperlib-pdf-textbox-card")) return;
          if (active?.mode === "textbox") {
            const file = leaf.view?.file || this.app.workspace.getActiveFile();
            const paper = file ? this.getPaperForPdfFile(file) : null;
            if (!paper) {
              new Notice("请先把这个文档加入论文库");
              return;
            }
            let targetPageEl = pageEl && container.contains(pageEl) ? pageEl : null;
            let bounds = targetPageEl?.getBoundingClientRect?.();
            if (!targetPageEl || !bounds?.width || !bounds?.height) {
              // 点在两页之间的空白处：吸附到最近的页面，允许卡片落在页间
              const nearest = this.findNearestNativePdfPage(container, event.clientX, event.clientY);
              if (!nearest) {
                new Notice("请点击 PDF 页面附近插入文本框");
                return;
              }
              targetPageEl = nearest.pageEl;
              bounds = nearest.rect;
            }
            event.preventDefault();
            event.stopPropagation();
            const box = {
              x: Math.max(0, Math.min(0.94, (event.clientX - bounds.left) / bounds.width)),
              y: Math.max(-0.3, Math.min(1.3, (event.clientY - bounds.top) / bounds.height)),
              width: 0.32
            };
            const pageNumber = Number(targetPageEl.dataset?.pageNumber || targetPageEl.getAttribute?.("data-page-number"));
            this.createPdfTextBox(paper, file, pageNumber, box, state.textboxFontSize, state.textboxColor)
              .catch((error) => {
                console.error("Paper Library: failed to insert text box", error);
                new Notice(`插入文本框失败：${error?.message || error}`);
              });
            state.paletteOpen = false;
            this.updateNativePdfToolbarState(container, group, state);
            return;
          }
          if (active?.mode === "shape") {
            if (pageEl && container.contains(pageEl)) this.beginNativePdfShape(event, leaf, container, pageEl, active);
            return;
          }
          if (active?.mode === "eraser") {
            // 阻止浏览器把橡皮擦拖动当成文本选择
            event.preventDefault();
            event.stopPropagation();
            container.ownerDocument?.defaultView?.getSelection?.()?.removeAllRanges?.();
            if (pageEl && container.contains(pageEl)) {
              active.erasing = { highlights: new Map(), strokes: new Map(), shapes: new Map() };
              void this.collectNativePdfEraseTargets(event, leaf, container, active);
            }
            return;
          }
          if (active?.mode === "ink") {
            if (pageEl && container.contains(pageEl)) this.beginNativePdfInkStroke(event, leaf, container, pageEl, active);
            return;
          }
          if (active?.mode === "ai-region") {
            if (pageEl && container.contains(pageEl)) this.beginNativePdfAIRegion(event, leaf, container, pageEl);
            return;
          }
          if (!active?.mode) this.scheduleNativePdfSelectionDrag(event, leaf, container);
        };
        const pointerUp = (event) => {
          const active = this.nativePdfStates.get(container);
          // 空模式（纯选择）也要放行：选中文字后弹出颜色标注条
          if (!["highlight", "note", "underline", "eraser", ""].includes(active?.mode ?? "") || active.busy) return;
          void this.handleNativePdfPointerUp(event, leaf, container, active);
        };
        const contextMenu = (event) => {
          void this.handleNativePdfContextMenu(event, leaf, container);
        };
        const dragStart = (event) => this.handleNativePdfSelectionDrag(event, leaf, container);
        const click = (event) => this.handleNativePdfFigureClick(event, leaf, container);
        // 滚动时记录阅读页码（防抖落盘），供下次打开恢复
        const scroll = (event) => {
          const file = leaf.view?.file;
          const paper = this.getPaperForPdfFile(file);
          if (!paper) return;
          const scroller = event.target;
          const bounds = scroller?.getBoundingClientRect?.();
          if (!bounds) return;
          const probe = bounds.top + 40;
          let current = 0;
          container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
            const rect = pageEl.getBoundingClientRect?.();
            if (rect && rect.top <= probe) {
              current = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number")) || current;
            }
          });
          if (current) this.recordPdfReadingPosition(paper, current);
        };
        container.addEventListener("pointerdown", pointerDown, true);
        container.addEventListener("pointerup", pointerUp, true);
        container.addEventListener("contextmenu", contextMenu, true);
        container.addEventListener("dragstart", dragStart, true);
        container.addEventListener("click", click, true);
        container.addEventListener("scroll", scroll, true);
        const pointerMove = (event) => {
          const active = this.nativePdfStates.get(container);
          if (active?.mode === "eraser" && active.erasing) {
            void this.collectNativePdfEraseTargets(event, leaf, container, active);
          }
        };
        container.addEventListener("pointermove", pointerMove, true);
        // Esc 始终回到鼠标工具；文档级捕获保证页面、工具栏、文本框编辑里都能触发
        const keyDownDoc = container.ownerDocument || document;
        const keyDown = (event) => {
          if (event.isComposing) return;
          const activeLeaf = this.app.workspace.activeLeaf;
          if (activeLeaf && activeLeaf !== leaf) return;
          if (!activeLeaf && !container.contains(event.target)) return;
          const key = String(event.key || "").toLowerCase();
          const modifier = event.metaKey || event.ctrlKey;
          if (modifier && !event.altKey && (key === "z" || key === "y")) {
            if (this.isNativePdfUndoBlocked(event.target)) return;
            const pdfPath = normalizePath(leaf.view?.file?.path || "");
            if (!pdfPath) return;
            const redo = key === "y" || event.shiftKey;
            const stack = this.getNativePdfUndoStack(pdfPath);
            if (redo ? !stack.redo.length : !stack.undo.length) return;
            event.preventDefault();
            event.stopPropagation();
            void (redo ? this.redoNativePdfAction(pdfPath) : this.undoNativePdfAction(pdfPath))
              .catch((error) => console.error("Paper Library: undo/redo failed", error));
            return;
          }
          if (event.key !== "Escape") return;
          const active = this.nativePdfStates.get(container);
          if (!active || (!active.mode && !active.paletteOpen)) return;
          this.nativeShapeDrawingCleanup?.();
          active.mode = "";
          active.paletteOpen = false;
          active.erasing = null;
          this.updateNativePdfToolbarState(container, group, active);
        };
        keyDownDoc.addEventListener("keydown", keyDown, true);
        const binding = { container, pointerDown, pointerUp, contextMenu, dragStart, click, scroll, pointerMove, keyDown, keyDownDoc };
        this.nativePdfBindings.set(container, binding);
        this.nativePdfBindingList.push(binding);
      }
    });
    if (missingToolbar) this.scheduleNativePdfMountRetry();
    else this.nativePdfMountRetryCount = 0;
  },

  handleNativePdfSelectionDrag(event, leaf, container) {
    const textLayer = event.target?.closest?.(".textLayer");
    const transfer = event.dataTransfer;
    if (!textLayer || !container.contains(textLayer) || !transfer) return;
    const selection = textLayer.ownerDocument.defaultView?.getSelection?.();
    const selectionElement = (node) => node?.nodeType === 3 ? node.parentElement : node;
    if (!textLayer.contains(selectionElement(selection?.anchorNode))
      || !textLayer.contains(selectionElement(selection?.focusNode))) return;
    const text = String(selection?.toString?.() || "").replace(/\s+/g, " ").trim().slice(0, 8000);
    if (!text) return;
    const pageEl = textLayer.closest(".page[data-page-number], .page");
    const page = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number")) || null;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    if (!file?.path) return;
    const paper = this.getPaperForPdfFile(file);
    const payload = {
      text,
      path: file.path,
      page,
      label: `${paper?.title || file.basename || file.name} · 第 ${page || "—"} 页选区`
    };
    transfer.setData("application/x-paperlib-pdf-selection", JSON.stringify(payload));
    transfer.setData("text/plain", text);
    transfer.effectAllowed = "copy";
  },

  getNativePdfSelectionDragContext(event, leaf, container) {
    const textLayer = event.target?.closest?.(".textLayer");
    if (!textLayer || !container.contains(textLayer)) return null;
    const selection = textLayer.ownerDocument.defaultView?.getSelection?.();
    const selectionElement = (node) => node?.nodeType === 3 ? node.parentElement : node;
    if (!selection?.rangeCount || selection.isCollapsed
      || !textLayer.contains(selectionElement(selection.anchorNode))
      || !textLayer.contains(selectionElement(selection.focusNode))) return null;
    const text = String(selection.toString?.() || "").replace(/\s+/g, " ").trim().slice(0, 8000);
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const targetSpan = event.target?.closest?.("span");
    if (!targetSpan || !textLayer.contains(targetSpan)) return null;
    try { if (!range.intersectsNode(targetSpan)) return null; } catch (_) { return null; }
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
    if (rects.length && !rects.some((rect) => (
      event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3
      && event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3
    ))) return null;
    const pageEl = textLayer.closest(".page[data-page-number], .page");
    const page = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number")) || null;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    if (!file?.path) return null;
    const paper = this.getPaperForPdfFile(file);
    const sourceRect = rects.length ? {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom))
    } : { left: event.clientX, top: event.clientY, right: event.clientX + 120, bottom: event.clientY + 20 };
    sourceRect.width = sourceRect.right - sourceRect.left;
    sourceRect.height = sourceRect.bottom - sourceRect.top;
    return {
      text,
      path: file.path,
      page,
      title: paper?.title || file.basename || file.name || "文档",
      label: `${paper?.title || file.basename || file.name} · 第 ${page || "—"} 页选区`,
      sourceRect,
      selection
    };
  },

  scheduleNativePdfSelectionDrag(event, leaf, container) {
    if (event.button !== 0) return;
    const context = this.getNativePdfSelectionDragContext(event, leaf, container);
    if (!context) return;
    this.nativeSelectionDragCleanup?.(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 8) return;
      moveEvent.preventDefault();
      cleanup(false);
      this.beginNativePdfSelectionPointerDrag(moveEvent, context);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (this.nativeSelectionDragCleanup === cleanup) this.nativeSelectionDragCleanup = null;
    };
    const up = () => cleanup(true);
    this.nativeSelectionDragCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  },

  beginNativePdfSelectionPointerDrag(event, context) {
    const ghost = document.createElement("div");
    ghost.className = "paperlib-excerpt-drag-ghost";
    const echo = document.createElement("div");
    echo.className = "paperlib-excerpt-drag-echo";
    const echoText = document.createElement("span");
    echoText.textContent = truncate(context.text, 150);
    echo.appendChild(echoText);
    ghost.appendChild(echo);
    const card = document.createElement("div");
    card.className = "paperlib-excerpt-drag-card";
    const icon = document.createElement("span");
    icon.className = "paperlib-excerpt-drag-icon";
    setPaperlibIcon(icon, "text-quote");
    card.appendChild(icon);
    const content = document.createElement("div");
    content.className = "paperlib-excerpt-drag-content";
    const strong = document.createElement("strong");
    strong.textContent = `摘录 · 第 ${context.page || "—"} 页`;
    const summary = document.createElement("span");
    summary.textContent = truncate(context.text, 120);
    content.append(strong, summary);
    card.appendChild(content);
    ghost.appendChild(card);
    document.body.appendChild(ghost);
    const sourceRect = context.sourceRect;
    const startWidth = Math.min(380, Math.max(84, Number(sourceRect.width) || 120));
    const startHeight = Math.min(58, Math.max(20, Number(sourceRect.height) || 20));
    Object.assign(ghost.style, {
      left: `${sourceRect.left}px`, top: `${sourceRect.top}px`,
      width: `${startWidth}px`, height: `${startHeight}px`
    });
    ghost.style.setProperty("--paperlib-drag-progress", "0");
    ghost.style.setProperty("--paperlib-drag-card-scale", "0.92");
    this.nativeSelectionDrag = {
      context, ghost, startX: event.clientX, startY: event.clientY,
      sourceRect, startWidth, startHeight
    };
    const move = (moveEvent) => this.moveNativePdfSelectionGhost(moveEvent);
    const cleanup = (cancel = false, upEvent = null) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
      if (this.nativeSelectionDragCleanup === cleanup) this.nativeSelectionDragCleanup = null;
      this.finishNativePdfSelectionPointerDrag(upEvent, cancel);
    };
    const up = (upEvent) => cleanup(false, upEvent);
    const cancelDrag = () => cleanup(true, null);
    this.nativeSelectionDragCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    window.requestAnimationFrame(() => ghost.classList.add("is-visible"));
    this.moveNativePdfSelectionGhost(event);
  },

  moveNativePdfSelectionGhost(event) {
    const drag = this.nativeSelectionDrag;
    if (!drag) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const linear = Math.min(1, Math.max(0, (distance - 4) / 150));
    const progress = linear * linear * (3 - 2 * linear);
    const left = drag.sourceRect.left + (event.clientX + 18 - drag.sourceRect.left) * progress;
    const top = drag.sourceRect.top + (event.clientY + 16 - drag.sourceRect.top) * progress;
    drag.ghost.style.left = `${left}px`;
    drag.ghost.style.top = `${top}px`;
    drag.ghost.style.width = `${drag.startWidth + (286 - drag.startWidth) * progress}px`;
    drag.ghost.style.height = `${drag.startHeight + (88 - drag.startHeight) * progress}px`;
    drag.ghost.style.setProperty("--paperlib-drag-progress", progress.toFixed(3));
    drag.ghost.style.setProperty("--paperlib-drag-card-scale", (0.92 + progress * 0.08).toFixed(3));
    drag.ghost.classList.toggle("is-card", progress > 0.58);
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.classList.remove("paperlib-paper-composer-drag-over"));
    aiTarget?.classList.add("paperlib-paper-composer-drag-over");
    drag.ghost.classList.toggle("is-over-drop-target", Boolean(aiTarget && progress > 0.58));
  },

  finishNativePdfSelectionPointerDrag(event, cancel = false) {
    const drag = this.nativeSelectionDrag;
    this.nativeSelectionDrag = null;
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.classList.remove("paperlib-paper-composer-drag-over"));
    if (!drag) return;
    const dismiss = (className) => {
      drag.ghost.classList.add(className);
      window.setTimeout(() => drag.ghost.remove(), 180);
    };
    if (cancel || !event) return dismiss("is-cancelled");
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    if (!aiTarget) return dismiss("is-cancelled");
    dismiss("is-dropping");
    void this.addAIContext({
      type: "selection",
      label: drag.context.label,
      detail: `${drag.context.text.length} 字符`,
      text: drag.context.text,
      path: drag.context.path,
      page: drag.context.page,
      key: `pdf-selection:${drag.context.path}:${drag.context.page || ""}:${drag.context.text.slice(0, 120)}`
    });
    window.setTimeout(() => drag.context.selection?.removeAllRanges?.(), 0);
  },

  beginNativePdfInkStroke(event, leaf, container, pageEl, state) {
    if (event.button !== 0) return;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) return new Notice("请先把这个文档加入论文库");
    const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    const bounds = pageEl.getBoundingClientRect();
    if (!pageNumber || !bounds.width || !bounds.height) return;
    event.preventDefault();
    event.stopPropagation();
    this.nativeInkDrawingCleanup?.(true);
    state.busy = true;
    const points = [];
    const stroke = {
      id: workspaceId("ink"), type: "ink", page: pageNumber,
      pdfPath: file.path, color: state.inkColor || state.color || "yellow", width: Number(state.inkWidth) || 4, points
    };
    const svg = this.ensureNativePdfInkLayer(pageEl);
    const path = this.appendNativePdfInkPath(svg, stroke, true);
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
      if (this.nativeInkDrawingCleanup === cleanup) this.nativeInkDrawingCleanup = null;
      state.busy = false;
      if (cancel || !points.length) {
        path?.remove();
        return;
      }
      path?.classList.remove("is-pending");
      void this.savePdfInkStroke(paper, stroke);
    };
    const up = (upEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      if (addPoint(upEvent)) path?.setAttribute("d", pathData);
      cleanup(false);
    };
    const cancelStroke = () => cleanup(true);
    this.nativeInkDrawingCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelStroke, true);
  },

  constrainPdfShapeEnd(start, end, bounds, type, constrain) {
    if (!bounds?.width || !bounds?.height) return end;
    // 圆始终按等宽高绘制；直线/箭头/椭圆/矩形只在按住 Shift 时约束
    if (!constrain && type !== "circle") return end;
    const pageWidth = Math.max(1, bounds.width);
    const pageHeight = Math.max(1, bounds.height);
    let dx = (end.x - start.x) * pageWidth;
    let dy = (end.y - start.y) * pageHeight;
    if (type === "line" || type === "arrow") {
      const length = Math.hypot(dx, dy);
      if (!length) return end;
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      dx = Math.cos(angle) * length;
      dy = Math.sin(angle) * length;
    } else {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * size;
      dy = (dy < 0 ? -1 : 1) * size;
    }
    return {
      x: Math.max(0, Math.min(1, start.x + dx / pageWidth)),
      y: Math.max(0, Math.min(1, start.y + dy / pageHeight))
    };
  },

  beginNativePdfShape(event, leaf, container, pageEl, state) {
    if (event.button !== 0) return;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) return new Notice("请先把这个文档加入论文库");
    const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    const bounds = pageEl.getBoundingClientRect();
    if (!pageNumber || !bounds.width || !bounds.height) return;
    event.preventDefault();
    event.stopPropagation();
    this.nativeShapeDrawingCleanup?.(true);
    state.busy = true;
    const type = ["line", "arrow", "circle", "ellipse", "rect"].includes(state.shapeType) ? state.shapeType : "line";
    const point = (pointer) => ({
      x: Math.max(0, Math.min(1, (pointer.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (pointer.clientY - bounds.top) / bounds.height))
    });
    const start = point(event);
    let end = { ...start };
    const shape = {
      type,
      page: pageNumber,
      pdfPath: file.path,
      color: state.shapeColor || "yellow",
      width: Number(state.shapeWidth) || 2.5
    };
    const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    preview.setAttribute("class", "paperlib-native-pdf-shape-preview");
    preview.setAttribute("viewBox", "0 0 1000 1000");
    preview.setAttribute("preserveAspectRatio", "none");
    pageEl.appendChild(preview);
    const render = (constrain) => {
      const constrained = this.constrainPdfShapeEnd(start, end, bounds, type, constrain);
      preview.replaceChildren();
      this.appendNativePdfShape(preview, { ...shape, start, end: constrained }, pageEl, true);
    };
    render(false);
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      end = point(moveEvent);
      render(moveEvent.shiftKey);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelShape, true);
      preview.remove();
      if (this.nativeShapeDrawingCleanup === cleanup) this.nativeShapeDrawingCleanup = null;
      state.busy = false;
    };
    const cancelShape = () => cleanup();
    const up = (upEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      end = point(upEvent);
      const resolved = this.constrainPdfShapeEnd(start, end, bounds, type, upEvent.shiftKey);
      const horizontal = (resolved.x - start.x) * bounds.width;
      const vertical = (resolved.y - start.y) * bounds.height;
      const tiny = type === "line" || type === "arrow"
        ? Math.hypot(horizontal, vertical) < 4
        : Math.max(Math.abs(horizontal), Math.abs(vertical)) < 4;
      cleanup();
      if (tiny) return;
      void this.savePdfShape(paper, { ...shape, start, end: resolved });
    };
    this.nativeShapeDrawingCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelShape, true);
  },

  beginNativePdfAIRegion(event, leaf, container, pageEl) {
    if (event.button !== 0) return;
    const canvas = pageEl.querySelector(".canvasWrapper canvas, canvas");
    if (!canvas?.width || !canvas?.height) return new Notice("当前 PDF 页面尚未渲染完成");
    event.preventDefault();
    event.stopPropagation();
    this.nativeAiRegionCleanup?.();
    const state = this.nativePdfStates.get(container);
    if (state) state.busy = true;
    const bounds = pageEl.getBoundingClientRect();
    const localWidth = pageEl.offsetWidth || bounds.width;
    const localHeight = pageEl.offsetHeight || bounds.height;
    const point = (pointer) => ({
      x: Math.max(0, Math.min(localWidth, (pointer.clientX - bounds.left) * localWidth / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(localHeight, (pointer.clientY - bounds.top) * localHeight / Math.max(1, bounds.height)))
    });
    const start = point(event);
    const overlay = document.createElement("div");
    overlay.className = "paperlib-ai-region-selection";
    pageEl.appendChild(overlay);
    const update = (pointer) => {
      const current = point(pointer);
      const region = {
        left: Math.min(start.x, current.x),
        top: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y)
      };
      Object.assign(overlay.style, {
        left: `${region.left}px`, top: `${region.top}px`,
        width: `${region.width}px`, height: `${region.height}px`
      });
      return region;
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
      if (state) state.busy = false;
      if (this.nativeAiRegionCleanup === cleanup) this.nativeAiRegionCleanup = null;
    };
    const cancel = () => cleanup();
    const up = (upEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      const region = update(upEvent);
      cleanup();
      if (region.width < 10 || region.height < 10) return;
      try {
        const canvasBounds = canvas.getBoundingClientRect();
        const canvasLeft = (canvasBounds.left - bounds.left) * localWidth / Math.max(1, bounds.width);
        const canvasTop = (canvasBounds.top - bounds.top) * localHeight / Math.max(1, bounds.height);
        const canvasLocalWidth = canvasBounds.width * localWidth / Math.max(1, bounds.width);
        const canvasLocalHeight = canvasBounds.height * localHeight / Math.max(1, bounds.height);
        const clipped = {
          left: Math.max(canvasLeft, region.left),
          top: Math.max(canvasTop, region.top),
          right: Math.min(canvasLeft + canvasLocalWidth, region.left + region.width),
          bottom: Math.min(canvasTop + canvasLocalHeight, region.top + region.height)
        };
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) throw new Error("圈选区域不在 PDF 页面内");
        const scaleX = canvas.width / Math.max(1, canvasLocalWidth);
        const scaleY = canvas.height / Math.max(1, canvasLocalHeight);
        const sourceX = Math.floor((clipped.left - canvasLeft) * scaleX);
        const sourceY = Math.floor((clipped.top - canvasTop) * scaleY);
        const sourceWidth = Math.max(1, Math.ceil((clipped.right - clipped.left) * scaleX));
        const sourceHeight = Math.max(1, Math.ceil((clipped.bottom - clipped.top) * scaleY));
        const outputScale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
        const crop = document.createElement("canvas");
        crop.width = Math.max(1, Math.round(sourceWidth * outputScale));
        crop.height = Math.max(1, Math.round(sourceHeight * outputScale));
        const context = crop.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, crop.width, crop.height);
        context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        const paper = this.getPaperForPdfFile(file);
        const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number")) || 1;
        void this.addAIContext({
          type: "image",
          label: `${paper?.title || file?.basename || "PDF"} · 第 ${pageNumber} 页圈选区域`,
          detail: `${crop.width} × ${crop.height}`,
          dataUrl: crop.toDataURL("image/png"),
          mime: "image/png",
          path: file?.path || "",
          page: pageNumber,
          key: `native-pdf-region:${file?.path || ""}:${pageNumber}:${Math.round(region.left)}:${Math.round(region.top)}:${Math.round(region.width)}:${Math.round(region.height)}`
        }, { draft: "请分析我圈选的 PDF 区域：说明图表或公式表达了什么，并结合论文语境解释。" });
      } catch (error) {
        console.error("Paper Library: native PDF region capture failed", error);
        new Notice(`圈选区域失败：${error.message || error}`);
      }
    };
    this.nativeAiRegionCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    update(event);
  },

  updateNativePdfToolbarState(container, group, state) {
    state.highlightColor ||= state.color || "yellow";
    state.inkColor ||= state.color || "yellow";
    state.shapeType ||= "line";
    state.shapeColor ||= "yellow";
    state.shapeWidth ||= 2.5;
    const highlightColor = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === state.highlightColor) || CANVAS_HIGHLIGHT_COLORS[0];
    const inkColor = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === state.inkColor) || CANVAS_HIGHLIGHT_COLORS[0];
    const shapeColor = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === state.shapeColor) || CANVAS_HIGHLIGHT_COLORS[0];
    const paletteColor = state.mode === "ink" ? inkColor : state.mode === "shape" ? shapeColor : highlightColor;
    group.style.setProperty("--paperlib-native-highlight", highlightColor.value);
    container.style.setProperty("--paperlib-native-highlight", highlightColor.value);
    container.style.setProperty("--paperlib-native-highlighter-cursor", highlighterCursor(highlightColor.value));
    group.querySelector(".is-highlighter")?.style.setProperty("--tool-highlight-color", highlightColor.value);
    group.querySelector(".is-ink")?.style.setProperty("--tool-highlight-color", inkColor.value);
    group.querySelector(".is-select")?.classList.toggle("is-active", !state.mode);
    group.querySelector(".is-highlighter")?.classList.toggle("is-active", state.mode === "highlight");
    group.querySelector(".is-underline")?.classList.toggle("is-active", state.mode === "underline");
    group.querySelector(".is-ink")?.classList.toggle("is-active", state.mode === "ink");
    group.querySelector(".is-note")?.classList.toggle("is-active", state.mode === "note");
    group.querySelector(".is-textbox")?.classList.toggle("is-active", state.mode === "textbox");
    group.querySelector(".is-shapes")?.classList.toggle("is-active", state.mode === "shape");
    group.querySelector(".is-ai-region")?.classList.toggle("is-active", state.mode === "ai-region");
    group.querySelector(".is-eraser")?.classList.toggle("is-active", state.mode === "eraser");
    const activeWidth = Math.max(1.5, Math.min(8, Number(state.mode === "shape" ? state.shapeWidth : state.inkWidth) || 4));
    const widthSlider = group.querySelector(".paperlib-native-pdf-width-slider");
    if (widthSlider) {
      widthSlider.value = String(activeWidth);
      const fill = ((activeWidth - 1.5) / 6.5) * 100;
      widthSlider.style.setProperty("--paperlib-width-fill", `${Math.max(0, Math.min(100, fill))}%`);
    }
    const widthValue = group.querySelector(".paperlib-native-pdf-width-value");
    if (widthValue) widthValue.textContent = String(Math.round(activeWidth * 10) / 10);
    group.querySelectorAll(".paperlib-native-pdf-shape-tool").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.shape === (state.shapeType || "line"));
    });
    const sizeInput = group.querySelector(".paperlib-native-pdf-size-input");
    if (sizeInput && container.ownerDocument?.activeElement !== sizeInput) {
      sizeInput.value = String(Number(state.textboxFontSize) || 18);
    }
    group.querySelectorAll(".paperlib-native-pdf-text-color").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.textColor === (state.textboxColor || "orange"));
    });
    group.querySelector(".paperlib-native-pdf-palette")?.classList.toggle(
      "is-visible", Boolean(state.paletteOpen && ["highlight", "ink", "underline", "textbox", "shape"].includes(state.mode))
    );
    group.querySelectorAll(".paperlib-native-pdf-swatch").forEach((swatch) => {
      swatch.classList.toggle("is-active", swatch.dataset.color === paletteColor.id);
    });
    container.classList.toggle("paperlib-native-highlight-mode", state.mode === "highlight");
    container.classList.toggle("paperlib-native-underline-mode", state.mode === "underline");
    container.classList.toggle("paperlib-native-textbox-mode", state.mode === "textbox");
    container.classList.toggle("paperlib-native-shape-mode", state.mode === "shape");
    container.classList.toggle("paperlib-native-ink-mode", state.mode === "ink");
    container.classList.toggle("paperlib-native-note-mode", state.mode === "note");
    container.classList.toggle("paperlib-native-ai-region-mode", state.mode === "ai-region");
    container.classList.toggle("paperlib-native-eraser-mode", state.mode === "eraser");
  },

  showNativePdfSelectionToolbar(leaf, textLayer) {
    this.dismissNativePdfSelectionToolbar();
    const doc = textLayer.ownerDocument;
    const owner = doc.defaultView;
    const selection = owner?.getSelection?.();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return;
    if (!String(selection.toString()).trim()) return;
    const selectedRange = selection.getRangeAt(0).cloneRange();
    const toolbar = doc.body.createDiv({
      cls: "paperlib-pdf-selection-toolbar",
      attr: { role: "toolbar", "aria-label": "选中文字的高亮颜色" }
    });
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
        if (!toolbar.isConnected) return;
        try {
          // 先算选区上下文（依赖当前 selection），再清除选区和弹条
          const context = await this.getNativePdfSelectionContext(leaf, textLayer);
          this.dismissNativePdfSelectionToolbar();
          selection.removeAllRanges();
          if (context?.text) await this.saveCanvasHighlight(context, color.id);
        } catch (error) {
          this.dismissNativePdfSelectionToolbar();
          console.error("Paper Library: failed to highlight PDF selection", error);
          new Notice(`高亮失败：${error.message || error}`);
        }
      });
    });
    toolbar.createDiv({ cls: "paperlib-pdf-selection-divider" });
    const addAction = (icon, label, draft) => {
      const button = toolbar.createEl("button", {
        cls: "paperlib-pdf-selection-action",
        attr: { type: "button", "aria-label": label, title: label }
      });
      setPaperlibIcon(button, icon);
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!toolbar.isConnected) return;
        try {
          const context = await this.getNativePdfSelectionContext(leaf, textLayer);
          this.dismissNativePdfSelectionToolbar();
          selection.removeAllRanges();
          if (!context?.text) return;
          const file = leaf.view?.file || this.app.workspace.getActiveFile();
          const paper = this.getPaperForPdfFile(file);
          await this.addAIContext({
            type: "selection",
            label: `${paper?.title || file?.basename || "PDF"} · 第 ${context.page} 页选区`,
            detail: `${context.text.length} 字符`,
            text: context.text,
            path: context.pdfPath || file?.path || "",
            page: context.page,
            key: `pdf-selection:${context.pdfPath || file?.path || ""}:${context.page}:${context.text.slice(0, 120)}`
          }, { draft });
        } catch (error) {
          this.dismissNativePdfSelectionToolbar();
          console.error("Paper Library: failed to send PDF selection to composer", error);
          new Notice(`发送失败：${error.message || error}`);
        }
      });
    };
    addAction("sparkles", "解释", "Explain this passage from the paper in clear terms.");
    addAction("languages", "翻译", "Translate this passage into Chinese.");
    const popup = toolbar.getBoundingClientRect();
    const rect = selectedRange.getBoundingClientRect();
    const viewport = owner.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || owner.innerWidth);
    const bottom = top + (viewport?.height || owner.innerHeight);
    const x = Math.min(right - popup.width - 8, Math.max(left + 8, (rect.left + rect.right - popup.width) / 2));
    const y = rect.top - popup.height - 8 >= top + 8 ? rect.top - popup.height - 8 : rect.bottom + 8;
    toolbar.style.left = `${Math.max(left + 8, x)}px`;
    toolbar.style.top = `${Math.max(top + 8, Math.min(bottom - popup.height - 8, y))}px`;
    const dismiss = () => this.dismissNativePdfSelectionToolbar();
    const outside = (event) => { if (!toolbar.contains(event.target)) dismiss(); };
    const keydown = (event) => {
      if (event.key === "Escape" || event.metaKey || event.ctrlKey) { dismiss(); return; }
      // 数字键 1-5 快速选择对应颜色
      const index = Number.parseInt(event.key, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < CANVAS_HIGHLIGHT_COLORS.length) {
        event.preventDefault();
        event.stopPropagation();
        toolbar.querySelectorAll(".paperlib-pdf-selection-color")[index]?.click();
      }
    };
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
    this.nativeSelectionToolbarCleanup = () => {
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
      this.nativeSelectionToolbarCleanup = null;
    };
  },

  dismissNativePdfSelectionToolbar() {
    this.nativeSelectionToolbarCleanup?.();
  },

  async handleNativePdfPointerUp(event, leaf, container, state) {
    if (state.mode === "eraser") {
      await this.finishNativePdfErase(leaf, container, state);
      return;
    }
    const textLayer = event.target?.closest?.(".textLayer");
    if (!textLayer || !container.contains(textLayer)) return;
    // 纯选择（无工具激活）：弹出颜色标注条，等用户点颜色后再保存
    if (!state.mode) {
      const tryShow = () => {
        const selection = textLayer.ownerDocument?.defaultView?.getSelection?.();
        if (selection && !selection.isCollapsed && String(selection.toString()).trim()) {
          this.showNativePdfSelectionToolbar(leaf, textLayer);
          return true;
        }
        return false;
      };
      if (!tryShow()) {
        // 双击选词由浏览器在 pointerup 之后应用，延迟一拍再检查
        setTimeout(() => {
          if (!tryShow()) this.dismissNativePdfSelectionToolbar();
        }, 60);
      }
      return;
    }
    state.busy = true;
    try {
      const context = await this.getNativePdfSelectionContext(leaf, textLayer);
      if (!context) return;
      if (state.mode === "highlight") {
        await this.saveCanvasHighlight(context, state.highlightColor || state.color || "yellow");
      } else if (state.mode === "underline") {
        await this.saveCanvasHighlight(context, state.highlightColor || state.color || "yellow", { pdfSubtype: "Underline" });
      } else if (state.mode === "note") {
        new NativePdfAnnotationModal(this.app, this, context, state.highlightColor || state.color || "yellow").open();
      }
      textLayer.ownerDocument.defaultView?.getSelection?.()?.removeAllRanges?.();
    } catch (error) {
      console.error("Paper Library: native PDF annotation failed", error);
      new Notice(`PDF 标注失败：${error.message || error}`);
    } finally {
      state.busy = false;
    }
  },

  async handleNativePdfContextMenu(event, leaf, container) {
    if (this.consumePdfInkDragContextMenu(event)) return;
    const activeSelection = event.target?.ownerDocument?.defaultView?.getSelection?.();
    const directPage = event.target?.closest?.(".page[data-page-number], .page");
    const directPageNumber = Number(directPage?.dataset?.pageNumber || directPage?.getAttribute?.("data-page-number"));
    const directFile = leaf.view?.file || this.app.workspace.getActiveFile();
    const directPaper = this.getPaperForPdfFile(directFile);
    const selectedValue = String(activeSelection?.toString?.() || "").trim();
    const inkStroke = !selectedValue && directPage && container.contains(directPage) && directFile && directPaper
      ? this.findPdfInkStrokeAtEvent(event, directPage, directPaper, directFile.path, directPageNumber)
      : null;
    if (inkStroke) {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      const canvas = directPage.querySelector(".canvasWrapper canvas, canvas");
      if (canvas) menu.addItem((item) => item
        .setTitle("作为图片添加到 Paper Composer")
        .setIcon("image")
        .onClick(() => this.addPdfInkRegionToComposer({
          canvas,
          pageEl: directPage,
          paper: directPaper,
          path: directFile.path,
          page: directPageNumber,
          stroke: inkStroke,
          title: directPaper.title || directFile.basename || directFile.name
        })));
      if (canvas) menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("删除此画笔标注")
        .setIcon("eraser")
        .onClick(() => this.removePdfInkStroke(directPaper, inkStroke.id)));
      menu.showAtMouseEvent(event);
      return;
    }
    const selectionElement = activeSelection?.anchorNode?.nodeType === 3
      ? activeSelection.anchorNode.parentElement
      : activeSelection?.anchorNode;
    const textLayer = event.target?.closest?.(".textLayer") || selectionElement?.closest?.(".textLayer");
    if (textLayer && container.contains(textLayer)) {
      const pageEl = textLayer.closest(".page[data-page-number], .page");
      const pageNumber = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
      const file = leaf.view?.file || this.app.workspace.getActiveFile();
      const paper = this.getPaperForPdfFile(file);
      const targetSpan = event.target?.closest?.("span");
      const spans = this.getNativePdfTextSpans(textLayer);
      const textIndex = spans.indexOf(targetSpan);
      const marks = file && paper && pageNumber && textIndex >= 0
        ? this.getPdfMarkEntriesAtTextIndex(paper, file.path, pageNumber, textIndex)
        : [];
      const selectedText = String(textLayer.ownerDocument.defaultView?.getSelection?.()?.toString?.() || "").trim();
      if (selectedText) {
        event.preventDefault();
        event.stopPropagation();
        try {
          const context = await this.getNativePdfSelectionContext(leaf, textLayer, { requirePaper: false });
          if (!context) return;
          const menu = new Menu();
          menu.addItem((item) => item
            .setTitle("Ask AI")
            .setIcon("sparkles")
            .onClick(() => this.addAIContext({
              type: "selection",
              label: `${context.paper.title} · 第 ${context.page} 页选区`,
              detail: `${context.text.length} 字符`,
              text: context.text,
              path: context.pdfPath || "",
              page: context.page,
              key: `pdf-selection:${context.pdfPath || ""}:${context.page}:${context.text.slice(0, 120)}`
            }, { draft: "请解释这段 PDF 文字，并结合论文上下文回答。" })));
          menu.showAtMouseEvent(event);
        } catch (error) {
          new Notice(`无法读取 PDF 选区：${error.message || error}`);
        }
        return;
      }
      if (marks.length) {
        event.preventDefault();
        event.stopPropagation();
        this.showNativePdfMarkDeleteMenu(event, paper, marks);
        return;
      }
    }
    // 注释层元素被我们隐藏后无法作为右键目标：按库内标注的几何位置命中，
    // 保证右键高亮区域始终能弹出删除菜单
    if (directPage && directFile && directPaper && container.contains(directPage)) {
      const hits = await this.findNativePdfMarksAtEvent(event, directPage, directPaper, directFile);
      if (hits.length) {
        event.preventDefault();
        event.stopPropagation();
        this.showNativePdfMarkDeleteMenu(event, directPaper, hits);
        return;
      }
    }
    // 文字/高亮优先；形状只在描边被点中时接管，避免大形状挡住内部内容
    const shape = !selectedValue && directPage && container.contains(directPage) && directFile && directPaper
      ? this.findPdfShapeAtEvent(event, directPage, directPaper, directFile.path, directPageNumber)
      : null;
    if (shape) {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      menu.addItem((item) => item
        .setTitle("删除此形状")
        .setIcon("trash-2")
        .onClick(() => this.removePdfShape(directPaper, shape.id)));
      menu.showAtMouseEvent(event);
      return;
    }
    const annotationEl = event.target?.closest?.(
      ".annotationLayer [data-annotation-id], .annotationLayer section, .annotationLayer .highlightAnnotation, .annotationLayer .textAnnotation"
    );
    if (!annotationEl || !container.contains(annotationEl)) return;
    const pageEl = annotationEl.closest(".page[data-page-number], .page");
    const pageNumber = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file || !paper || !pageNumber) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const annotation = await this.getNativePdfAnnotationData(file, pageNumber, annotationEl);
      if (!annotation || String(annotation.titleObj?.str || annotation.title || "") !== "Paper Library") return;
      const entries = this.getPdfMarkEntries(paper, file.path)
        .filter(({ record }) => Number(record.page) === pageNumber && Array.isArray(record.pdfRects) && record.pdfRects.length)
        .map((entry) => ({ entry, distance: this.pdfMarkRectDistance(entry.record, annotation.rect) }))
        .sort((a, b) => a.distance - b.distance);
      const match = entries[0];
      if (!match || match.distance > 10) return;
      this.showNativePdfMarkDeleteMenu(event, paper, [match.entry]);
    } catch (error) {
      console.error("Paper Library: failed to identify native PDF annotation", error);
      new Notice(`无法删除此 PDF 标注：${error.message || error}`);
    }
  },

  async findNativePdfMarksAtEvent(event, pageEl, paper, file) {
    const pageNumber = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
    const bounds = pageEl?.getBoundingClientRect?.();
    if (!pageNumber || !paper || !file?.path || !bounds?.width || !bounds?.height) return [];
    const sizes = await this.getNativePdfPageSizes(file).catch(() => null);
    const dims = sizes?.get(pageNumber);
    if (!dims?.width || !dims?.height) return [];
    const path = normalizePath(file.path);
    return this.getPdfMarkEntries(paper, path).filter(({ record }) => {
      if (Number(record.page) !== pageNumber) return false;
      return (record.pdfRects || []).some((item) => {
        const rect = item?.rect;
        if (!Array.isArray(rect) || rect.length !== 4) return false;
        const left = bounds.left + Math.min(rect[0], rect[2]) / dims.width * bounds.width;
        const right = bounds.left + Math.max(rect[0], rect[2]) / dims.width * bounds.width;
        const top = bounds.top + (1 - Math.max(rect[1], rect[3]) / dims.height) * bounds.height;
        const bottom = bounds.top + (1 - Math.min(rect[1], rect[3]) / dims.height) * bounds.height;
        return event.clientX >= left - 2 && event.clientX <= right + 2
          && event.clientY >= top - 2 && event.clientY <= bottom + 2;
      });
    });
  },

  async collectNativePdfEraseTargets(event, leaf, container, state) {
    if (!state.erasing) return;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = file ? this.getPaperForPdfFile(file) : null;
    if (!file || !paper) return;
    const pageEl = event.target?.closest?.(".page[data-page-number], .page")
      || container.ownerDocument?.elementFromPoint?.(event.clientX, event.clientY)?.closest?.(".page");
    if (!pageEl || !container.contains(pageEl)) return;
    const hits = await this.findNativePdfMarksAtEvent(event, pageEl, paper, file);
    hits.forEach((entry) => state.erasing.highlights.set(entry.record.id, entry));
    const card = event.target?.closest?.(".paperlib-pdf-textbox-card");
    if (card) {
      const textboxMark = (paper.annotations || []).find((item) => (
        item.id === card.dataset.markId && item.pdfSubtype === "FreeText"
      ));
      if (textboxMark) state.erasing.highlights.set(textboxMark.id, { record: textboxMark, source: "paper-annotation" });
    }
    const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    const stroke = this.findPdfInkStrokeAtEvent(event, pageEl, paper, file.path, pageNumber);
    if (stroke) state.erasing.strokes.set(stroke.id, stroke);
    const shape = this.findPdfShapeAtEvent(event, pageEl, paper, file.path, pageNumber);
    if (shape) state.erasing.shapes?.set(shape.id, shape);
  },

  async finishNativePdfErase(leaf, container, state) {
    const session = state.erasing;
    state.erasing = null;
    if (!session) return;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = file ? this.getPaperForPdfFile(file) : null;
    if (!paper) return;
    const entries = [...session.highlights.values()];
    const canvasEntries = entries.filter((entry) => entry.source === "canvas-highlight");
    const otherEntries = entries.filter((entry) => entry.source !== "canvas-highlight");
    const eraseRecords = [
      ...canvasEntries.map((entry) => ({ source: "canvas-highlight", record: entry.record })),
      ...otherEntries.map((entry) => ({ source: "paper-annotation", record: entry.record })),
      ...[...session.strokes.values()].map((record) => ({ source: "ink", record })),
      ...[...(session.shapes?.values?.() || [])].map((record) => ({ source: "shape", record }))
    ];
    if (!this.nativePdfUndoSuppressed && eraseRecords.length) {
      this.recordNativePdfUndoAction(paper, file.path, "delete", eraseRecords);
    }
    const previousUndoSuppressed = this.nativePdfUndoSuppressed;
    this.nativePdfUndoSuppressed = true;
    try {
      if (canvasEntries.length) {
        await this.removeCanvasHighlights(paper, canvasEntries.map((entry) => entry.record.id));
      }
      for (const entry of otherEntries) {
        if (entry.record.pdfSubtype === "FreeText") await this.deletePdfTextBox(paper, entry.record);
        else await this.deletePdfMark(paper, entry);
      }
      for (const id of session.strokes.keys()) {
        await this.removePdfInkStroke(paper, id);
      }
      for (const id of (session.shapes?.keys?.() || [])) {
        await this.removePdfShape(paper, id);
      }
    } finally {
      this.nativePdfUndoSuppressed = previousUndoSuppressed;
    }
    const removed = entries.length + session.strokes.size + (session.shapes?.size || 0);
    if (removed) new Notice(`已擦除 ${removed} 处标注`);
  },

  async clearPaperAnnotations(paper, pdfPath) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return 0;
    const path = normalizePath(pdfPath || paper.pdfPath || "");
    const workspace = this.ensureResearchWorkspace(paper);
    const highlights = (workspace.highlights || []).filter((mark) => (
      normalizePath(mark.pdfPath || paper.pdfPath || "") === path
    ));
    const annotations = (paper.annotations || []).filter((mark) => (
      normalizePath(mark.pdfPath || paper.pdfPath || "") === path
      && (mark.pdfSubtype === "FreeText" ? Boolean(mark.box) : Array.isArray(mark.pdfRects) && mark.pdfRects.length)
    ));
    const shapes = (workspace.pdfShapes || []).filter((shape) => (
      normalizePath(shape.pdfPath || paper.pdfPath || "") === path
    ));
    const strokes = (workspace.inkStrokes || []).filter((stroke) => (
      normalizePath(stroke.pdfPath || paper.pdfPath || "") === path
    ));
    const records = [...highlights, ...annotations];
    if (!records.length && !shapes.length && !strokes.length) return 0;
    if (!this.nativePdfUndoSuppressed) {
      this.recordNativePdfUndoAction(paper, path, "delete", [
        ...highlights.map((record) => ({ source: "canvas-highlight", record })),
        ...annotations.map((record) => ({ source: "paper-annotation", record })),
        ...strokes.map((record) => ({ source: "ink", record })),
        ...shapes.map((record) => ({ source: "shape", record }))
      ]);
    }
    if (highlights.length) {
      const ids = new Set(highlights.map((mark) => mark.id));
      workspace.highlights = (workspace.highlights || []).filter((mark) => !ids.has(mark.id));
      await this.persistResearchWorkspace(paper, false);
    }
    if (annotations.length) {
      const ids = new Set(annotations.map((mark) => mark.pdfAnnotationId || mark.id));
      paper.annotations = (paper.annotations || []).filter((mark) => !ids.has(mark.pdfAnnotationId || mark.id));
      await this.saveSettings();
      const noteFile = await this.ensurePaperNote(paper);
      if (noteFile) {
        let content = await this.app.vault.read(noteFile);
        content = this.removeAnnotationBlocks(content, new Set(annotations.map((mark) => mark.id)));
        content = this.mergeResearchWorkspaceSection(content, paper);
        await this.app.vault.modify(noteFile, content);
      }
    }
    if (shapes.length) {
      const ids = new Set(shapes.map((shape) => shape.id));
      workspace.pdfShapes = (workspace.pdfShapes || []).filter((shape) => !ids.has(shape.id));
      await this.persistResearchWorkspace(paper, false);
    }
    if (strokes.length) {
      const ids = new Set(strokes.map((stroke) => stroke.id));
      workspace.inkStrokes = (workspace.inkStrokes || []).filter((stroke) => !ids.has(stroke.id));
      await this.persistResearchWorkspace(paper, false);
    }
    try {
      await this.removeLocalPdfAnnotations([...records, ...strokes, ...shapes]);
    } catch (error) {
      console.error("Paper Library: failed to clear PDF annotations", error);
    }
    this.refreshResearchPdfHighlights(paper);
    this.refreshNativePdfNoteOverlays(paper);
    await this.refreshNativePdfTextBoxes(paper);
    this.refreshNativePdfShapeOverlays(paper);
    this.refreshNativePdfInkOverlays(paper);
    this.refreshViews();
    return records.length + shapes.length + strokes.length;
  },

  showNativePdfMarkDeleteMenu(event, paper, marks) {
    const menu = new Menu();
    marks.forEach((entry) => {
      const kind = entry.record.pdfSubtype === "Text" ? "注释" : entry.record.pdfSubtype === "Underline" ? "下划线" : "高光";
      const color = CANVAS_HIGHLIGHT_COLORS.find((item) => (
        item.id === String(entry.record.color || "").toLocaleLowerCase()
      ));
      menu.addItem((item) => item
        .setTitle(marks.length > 1 ? `删除${color?.label || "此处"}${kind}` : `删除此${kind}`)
        .setIcon("eraser")
        .onClick(async () => {
          try {
            await this.deletePdfMark(paper, entry);
            new Notice(`已删除 PDF ${kind}`);
          } catch (error) {
            console.error("Paper Library: failed to delete native PDF annotation", error);
            new Notice(`删除 PDF ${kind}失败：${error.message || error}`);
          }
        }));
    });
    if (marks.length > 1) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("删除此处全部标注")
        .setIcon("trash-2")
        .onClick(async () => {
          try {
            for (const entry of marks) await this.deletePdfMark(paper, entry);
            new Notice("已删除此处全部 PDF 标注");
          } catch (error) {
            console.error("Paper Library: failed to delete native PDF annotations", error);
            new Notice(`删除 PDF 标注失败：${error.message || error}`);
          }
        }));
    }
    menu.showAtMouseEvent(event);
  },

  async getNativePdfAnnotationData(file, pageNumber, annotationEl) {
    const rawId = annotationEl.dataset?.annotationId
      || annotationEl.getAttribute?.("data-annotation-id")
      || String(annotationEl.id || "").replace(/^annotation[_-]?/, "");
    const buffer = await this.readPdfBinary(file);
    const pdfjs = await loadPdfJs();
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    try {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: "display" });
      return annotations.find((annotation) => String(annotation.id || "") === String(rawId || "")) || null;
    } finally {
      await document.destroy?.();
    }
  },

  pdfMarkRectDistance(mark, actualRect) {
    if (!Array.isArray(actualRect) || actualRect.length !== 4) return Number.POSITIVE_INFINITY;
    const rects = (mark.pdfRects || []).map((item) => item.rect).filter((rect) => rect?.length === 4);
    if (!rects.length) return Number.POSITIVE_INFINITY;
    const selectionRect = [
      Math.min(...rects.map((rect) => rect[0])),
      Math.min(...rects.map((rect) => rect[1])),
      Math.max(...rects.map((rect) => rect[2])),
      Math.max(...rects.map((rect) => rect[3]))
    ];
    const expected = mark.pdfSubtype === "Text"
      ? [selectionRect[2], Math.max(selectionRect[1], selectionRect[3] - 18), selectionRect[2] + 18, selectionRect[3]]
      : selectionRect;
    return expected.reduce((total, value, index) => total + Math.abs(Number(value) - Number(actualRect[index])), 0);
  },

  async getNativePdfSelectionContext(leaf, textLayer, options = {}) {
    const selection = textLayer.ownerDocument.defaultView?.getSelection?.();
    if (!selection?.rangeCount) return null;
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) return null;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const libraryPaper = this.getPaperForPdfFile(file);
    if (!libraryPaper && options.requirePaper !== false) throw new Error("请先把这个 PDF 加入论文库");
    const paper = libraryPaper || {
      title: file?.basename || file?.name || "文档",
      pdfPath: file?.path || ""
    };
    const anchorElement = selection.anchorNode?.nodeType === 3
      ? selection.anchorNode.parentElement
      : selection.anchorNode;
    // 以选区起点所在页为准：事件目标可能落在另一页（跨页拖动），
    // 用错误页的坐标换算会把高亮放大到整页；起点页信息缺失时回退到事件目标页
    const anchorPageEl = anchorElement?.closest?.(".page[data-page-number], .page");
    const anchorPageNumber = Number(anchorPageEl?.dataset?.pageNumber
      || anchorPageEl?.getAttribute?.("data-page-number"));
    const pageEl = anchorPageNumber ? anchorPageEl : textLayer.closest(".page[data-page-number], .page");
    const activeLayer = pageEl?.querySelector?.(".textLayer") || textLayer;
    const page = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
    if (!page) throw new Error("无法识别当前 PDF 页码");
    const spans = this.getNativePdfTextSpans(activeLayer);
    const closestSpan = (node) => {
      const element = node?.nodeType === 3 ? node.parentElement : node;
      const span = element?.closest?.("span");
      return span && activeLayer.contains(span) ? span : null;
    };
    const anchorSpan = closestSpan(selection.anchorNode);
    const focusSpan = closestSpan(selection.focusNode);
    const anchorIndex = spans.indexOf(anchorSpan);
    const focusIndex = spans.indexOf(focusSpan);
    if (anchorIndex < 0 || focusIndex < 0) throw new Error("无法读取 PDF 文字选区");
    const forward = anchorIndex < focusIndex || (anchorIndex === focusIndex && selection.anchorOffset <= selection.focusOffset);
    const domRects = this.captureDomSelectionRects(selection.getRangeAt(0), activeLayer);
    const selectionData = await this.getNativePdfSelectionData(file, page, activeLayer, domRects);
    if (!selectionData.pdfRects.length) throw new Error("未能识别选区，请重新选择文字");
    const fallbackRange = {
      beginIndex: forward ? anchorIndex : focusIndex,
      beginOffset: forward ? selection.anchorOffset : selection.focusOffset,
      endIndex: forward ? focusIndex : anchorIndex,
      endOffset: forward ? selection.focusOffset : selection.anchorOffset
    };
    const mappedRange = this.getPdfSelectionRangeFromRects(
      selectionData.textItems,
      selectionData.pdfRects,
      fallbackRange
    );
    return {
      paper,
      text: text.slice(0, 8000),
      page,
      range: mappedRange,
      pdfRects: selectionData.pdfRects,
      pdfPath: file.path,
      sourceLeaf: leaf,
      refreshViews: true,
      selectionSource: "native",
      rectCoordinateSpace: "pdf"
    };
  },

  getNativePdfTextSpans(textLayer) {
    return Array.from(textLayer?.querySelectorAll?.("span") || [])
      .filter((span) => !span.querySelector("span") && span.textContent);
  },

  captureDomSelectionRects(range, layer) {
    const bounds = layer.getBoundingClientRect();
    return Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
      .map((rect) => ({
        left: Math.max(0, rect.left - bounds.left),
        right: Math.min(bounds.width, rect.right - bounds.left),
        top: Math.max(0, rect.top - bounds.top),
        bottom: Math.min(bounds.height, rect.bottom - bounds.top)
      }))
      // 其他页的矩形裁剪后只剩退化的零宽/零高条带，直接丢弃；
      // 否则跨页选区会被放大成整页高亮
      .filter((rect) => rect.right - rect.left > 0.5 && rect.bottom - rect.top > 0.5);
  },

  async getNativePdfSelectionData(file, pageNumber, textLayer, rects) {
    if (!rects.length) return { pdfRects: [], textItems: [] };
    const buffer = await this.readPdfBinary(file);
    const pdfjs = await loadPdfJs();
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    try {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const base = page.getViewport({ scale: 1 });
      const layerRect = textLayer.getBoundingClientRect();
      const viewport = page.getViewport({ scale: layerRect.width / Math.max(1, base.width) });
      const maxRectHeight = base.height * 0.15;
      const marginX = base.width * 0.02;
      const marginY = base.height * 0.02;
      const pdfRects = rects.map((rect) => {
        const topLeft = viewport.convertToPdfPoint(rect.left, rect.top);
        const topRight = viewport.convertToPdfPoint(rect.right, rect.top);
        const bottomLeft = viewport.convertToPdfPoint(rect.left, rect.bottom);
        const bottomRight = viewport.convertToPdfPoint(rect.right, rect.bottom);
        return {
          quad: [...topLeft, ...topRight, ...bottomLeft, ...bottomRight],
          rect: [
            Math.min(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
            Math.min(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
            Math.max(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
            Math.max(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1])
          ]
        };
      }).filter((item) => {
        const [x1, y1, x2, y2] = item.rect;
        if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
        const width = x2 - x1;
        const height = y2 - y1;
        // 单条选区矩形不可能很高：整页高亮通常来自跨页/缩放异常产生的离群矩形
        if (width <= 0.5 || height <= 0.5 || height > maxRectHeight) return false;
        if (width > base.width * 1.05) return false;
        if (x1 < -marginX || x2 > base.width + marginX) return false;
        if (y1 < -marginY || y2 > base.height + marginY) return false;
        return true;
      });
      return { pdfRects, textItems: textContent.items || [] };
    } finally {
      await document.destroy?.();
    }
  },

  handleNativePdfFigureClick(event, leaf, container) {
    const state = this.nativePdfStates.get(container);
    if (state?.mode || event.button !== 0 || event.defaultPrevented) return;
    if (event.target?.closest?.("button, a, .annotationLayer")) return;
    const selection = event.target?.ownerDocument?.defaultView?.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    const pageEl = event.target?.closest?.(".page[data-page-number], .page");
    if (!pageEl || !container.contains(pageEl)) return;
    const rect = pageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    if (!file || !pageNumber) return;
    const paper = this.getPaperForPdfFile(file);
    void this.openPdfFigureAtPoint(
      file.path,
      paper,
      pageNumber,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height
    );
  },

  ensureNativePdfFigureDragZones(leaf, container, state) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const path = normalizePath(file?.path || "");
    const paper = this.getPaperForPdfFile(file);
    if (!path || (!this.settings.enableFigureRecognition && !this.getPortablePdfFigurePayload(path))) {
      container?.querySelectorAll?.(".paperlib-pdf-figure-drag-zone")?.forEach?.((zone) => zone.remove());
      return;
    }
    const cached = this.pdfFigureCatalogCache.get(path);
    if (cached) {
      this.installPdfFigureDragZones(container, path, paper, cached);
      return;
    }
    if (state.figureDragLoadingPath === path) return;
    state.figureDragLoadingPath = path;
    void this.getPdfFigureCatalog(path)
      .then((catalog) => {
        const currentFile = leaf?.view?.file || this.app.workspace.getActiveFile();
        if (normalizePath(currentFile?.path || "") !== path || !container.isConnected) return;
        this.installPdfFigureDragZones(container, path, paper, catalog);
      })
      .catch((error) => console.warn("Paper Library: native PDF image drag unavailable", error))
      .finally(() => {
        if (state.figureDragLoadingPath === path) state.figureDragLoadingPath = "";
      });
  },
};

export { toolbarMethods };
