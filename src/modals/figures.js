/* PDF 图片浏览弹窗：画廊网格与轮播查看器。 */

import { Modal, Notice } from "obsidian";
import { iconButton, setPaperlibIcon } from "../ui-utils.js";
import { safeFileName } from "../paper-utils.js";

class PdfFigureGalleryModal extends Modal {
  constructor(app, plugin, paper, pdfPath, figures) {
    super(app);
    this.plugin = plugin;
    this.paper = paper;
    this.pdfPath = pdfPath;
    this.figures = figures;
    this.renderToken = 0;
  }

  onOpen() {
    this.modalEl.addClass("paperlib-figure-gallery-modal");
    this.contentEl.addClass("paperlib-figure-gallery");
    const header = this.contentEl.createEl("header", { cls: "paperlib-figure-gallery-header" });
    const title = header.createDiv();
    title.createEl("h2", { text: "Figures" });
    title.createSpan({ text: this.paper?.title || this.pdfPath.split("/").pop() });
    header.createSpan({ cls: "paperlib-figure-gallery-count", text: `${this.figures.length} 张图片` });
    const list = this.contentEl.createDiv({ cls: "paperlib-figure-gallery-list" });
    const token = ++this.renderToken;
    const loadThumbnail = async (card, canvas, figure) => {
      if (card.dataset.loaded || token !== this.renderToken) return;
      card.dataset.loaded = "true";
      try {
        await this.plugin.renderPdfFigure(this.pdfPath, figure, canvas, { thumbnail: true });
        if (token === this.renderToken) card.removeClass("is-loading");
      } catch (error) {
        console.error("Paper Library: failed to render figure thumbnail", error);
        card.addClass("is-error");
      }
    };
    this.observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
        entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
          const card = entry.target;
          this.observer.unobserve(card);
          void loadThumbnail(card, card.querySelector("canvas"), this.figures[Number(card.dataset.index)]);
        });
      }, { root: list, rootMargin: "320px" })
      : null;
    this.figures.forEach((figure, index) => {
      const label = figure.label || `Figure ${index + 1}`;
      const card = list.createEl("button", {
        cls: "paperlib-figure-thumbnail-card is-loading",
        attr: {
          type: "button",
          title: `打开 ${label} · PDF 第 ${figure.pageNumber} 页`,
          "aria-label": `打开 ${label}，PDF 第 ${figure.pageNumber} 页`
        }
      });
      card.dataset.index = String(index);
      const preview = card.createDiv({ cls: "paperlib-figure-thumbnail-preview" });
      const canvas = preview.createEl("canvas");
      const spinner = preview.createSpan({ cls: "paperlib-figure-thumbnail-spinner" });
      setPaperlibIcon(spinner, "loader-circle");
      const meta = card.createDiv({ cls: "paperlib-figure-thumbnail-meta" });
      meta.createEl("strong", { text: label });
      meta.createEl("p", { text: figure.caption || "此图片未识别到可用图注。" });
      card.addEventListener("click", () => {
        this.close();
        new PdfFigureCarouselModal(this.app, this.plugin, this.paper, this.pdfPath, this.figures, index).open();
      });
      if (this.observer) this.observer.observe(card);
      else if (index < 80) void loadThumbnail(card, canvas, figure);
    });
  }

  onClose() {
    this.renderToken += 1;
    this.observer?.disconnect?.();
    this.contentEl.empty();
  }
}

class PdfFigureCarouselModal extends Modal {
  constructor(app, plugin, paper, pdfPath, figures, index = 0) {
    super(app);
    this.plugin = plugin;
    this.paper = paper;
    this.pdfPath = pdfPath;
    this.figures = figures;
    this.index = Math.max(0, Math.min(figures.length - 1, index));
    this.zoom = 1;
    this.renderToken = 0;
  }

  iconButton(parent, icon, label, callback, cls = "") {
    const button = parent.createEl("button", {
      cls: `paperlib-figure-tool ${cls}`.trim(),
      attr: { type: "button", "aria-label": label, title: label }
    });
    setPaperlibIcon(button, icon);
    button.addEventListener("click", callback);
    return button;
  }

  onOpen() {
    this.modalEl.addClass("paperlib-figure-modal");
    this.contentEl.addClass("paperlib-figure-viewer");
    const header = this.contentEl.createEl("header", { cls: "paperlib-figure-header" });
    header.createEl("h2", { text: "Figures" });
    const controls = header.createDiv({ cls: "paperlib-figure-controls" });
    this.iconButton(controls, "chevron-left", "上一张图片", () => this.move(-1));
    this.counter = controls.createSpan({ cls: "paperlib-figure-counter" });
    this.iconButton(controls, "chevron-right", "下一张图片", () => this.move(1));
    controls.createSpan({ cls: "paperlib-figure-divider" });
    this.iconButton(controls, "minus", "缩小", () => this.setZoom(this.zoom - 0.1));
    this.zoomLabel = controls.createEl("button", {
      cls: "paperlib-figure-zoom-label",
      text: "100%",
      attr: { type: "button", title: "恢复为 100%" }
    });
    this.zoomLabel.addEventListener("click", () => this.setZoom(1));
    this.iconButton(controls, "plus", "放大", () => this.setZoom(this.zoom + 0.1));
    this.iconButton(controls, "maximize-2", "切换全屏", () => this.toggleFullscreen(), "is-expand");

    const body = this.contentEl.createDiv({ cls: "paperlib-figure-body" });
    this.stage = body.createDiv({ cls: "paperlib-figure-stage" });
    this.canvasWrap = this.stage.createDiv({ cls: "paperlib-figure-canvas-wrap" });
    this.canvas = this.canvasWrap.createEl("canvas", { cls: "paperlib-figure-canvas" });
    this.loading = this.stage.createDiv({ cls: "paperlib-figure-loading" });
    setPaperlibIcon(this.loading.createSpan(), "loader-circle");
    this.loading.createSpan({ text: "正在载入图片…" });
    if (this.figures.length > 1) {
      const makeNav = (icon, label, cls, callback) => {
        const button = this.stage.createEl("button", {
          cls: `paperlib-figure-nav ${cls}`,
          attr: { type: "button", "aria-label": label, title: label }
        });
        setPaperlibIcon(button, icon);
        button.addEventListener("click", callback);
      };
      makeNav("chevron-left", "上一张图片", "is-prev", () => this.move(-1));
      makeNav("chevron-right", "下一张图片", "is-next", () => this.move(1));
    }
    const sidebar = body.createEl("aside", { cls: "paperlib-figure-sidebar" });
    const sideHead = sidebar.createDiv({ cls: "paperlib-figure-sidebar-head" });
    this.figureTitle = sideHead.createEl("h3");
    this.downloadButton = this.iconButton(sideHead, "download", "下载最高分辨率图片", () => void this.downloadCurrent());
    this.figurePage = sidebar.createDiv({ cls: "paperlib-figure-page" });
    this.figureCaption = sidebar.createEl("p", { cls: "paperlib-figure-caption" });
    this.paperTitle = sidebar.createEl("p", { cls: "paperlib-figure-paper-title" });

    this.keyHandler = (event) => {
      if (event.key === "ArrowLeft") this.move(-1);
      else if (event.key === "ArrowRight") this.move(1);
      else if ((event.key === "+" || event.key === "=") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.setZoom(this.zoom + 0.1);
      } else if (event.key === "-" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.setZoom(this.zoom - 0.1);
      }
    };
    document.addEventListener("keydown", this.keyHandler);
    this.stage.addEventListener("wheel", (event) => {
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      this.setZoom(this.zoom + (event.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });
    void this.renderFigure();
  }

  move(direction) {
    if (!this.figures.length) return;
    this.index = (this.index + direction + this.figures.length) % this.figures.length;
    this.zoom = 1;
    void this.renderFigure();
  }

  setZoom(value) {
    this.zoom = Math.max(0.4, Math.min(4, Math.round(value * 10) / 10));
    if (this.zoomLabel) this.zoomLabel.setText(`${Math.round(this.zoom * 100)}%`);
    this.applyCanvasZoom();
  }

  applyCanvasZoom() {
    if (!this.canvas?.dataset?.displayWidth) return;
    this.canvas.style.width = `${Number(this.canvas.dataset.displayWidth) * this.zoom}px`;
    this.canvas.style.height = `${Number(this.canvas.dataset.displayHeight) * this.zoom}px`;
  }

  async renderFigure() {
    const token = ++this.renderToken;
    const figure = this.figures[this.index];
    if (!figure) return;
    this.loading?.removeClass("is-hidden");
    this.canvas?.addClass("is-loading");
    this.counter?.setText(`${this.index + 1} / ${this.figures.length}`);
    this.figureTitle?.setText(figure.label || `Figure ${this.index + 1}`);
    this.figurePage?.setText(`PDF 第 ${figure.pageNumber} 页${figure.confidence ? ` · 置信度 ${Math.round(figure.confidence * 100)}%` : ""}`);
    this.figureCaption?.setText(figure.caption || "此图片未识别到可用图注。");
    this.paperTitle?.setText(this.paper?.title || this.pdfPath.split("/").pop() || "");
    try {
      const size = await this.plugin.renderPdfFigure(this.pdfPath, figure, this.canvas);
      if (token !== this.renderToken) return;
      this.canvas.dataset.displayWidth = String(size.width);
      this.canvas.dataset.displayHeight = String(size.height);
      this.setZoom(this.zoom);
      this.canvasWrap.scrollTop = 0;
      this.canvasWrap.scrollLeft = 0;
      this.canvas.removeClass("is-loading");
      this.loading.addClass("is-hidden");
    } catch (error) {
      if (token !== this.renderToken) return;
      console.error("Paper Library: failed to render PDF figure", error);
      this.loading.empty();
      setPaperlibIcon(this.loading.createSpan(), "image-off");
      this.loading.createSpan({ text: `图片载入失败：${error.message || error}` });
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement === this.modalEl) void document.exitFullscreen?.();
    else void this.modalEl.requestFullscreen?.();
  }

  async downloadCurrent() {
    const figure = this.figures[this.index];
    if (!figure || this.downloadButton?.disabled) return;
    const button = this.downloadButton;
    if (button) {
      button.disabled = true;
      button.addClass("is-busy");
      button.empty();
      setPaperlibIcon(button, "loader-circle");
    }
    const notice = new Notice("正在从 PDF 原页生成最高分辨率图片…", 0);
    try {
      const { blob, width, height, dpi } = await this.plugin.exportPdfFigureHighResolution(this.pdfPath, figure);
      const name = safeFileName(`${this.paper?.title || "paper"}-${figure.label || `Figure ${this.index + 1}`}`);
      this.plugin.downloadFile(`${name || "figure"}.png`, blob, "image/png");
      notice.hide?.();
      new Notice(`已下载高清图片 · ${width} × ${height}px · ${dpi} DPI`);
    } catch (error) {
      notice.hide?.();
      console.error("Paper Library: failed to export high-resolution figure", error);
      new Notice(`高清图片导出失败：${error.message || error}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.removeClass("is-busy");
        button.empty();
        setPaperlibIcon(button, "download");
      }
    }
  }

  onClose() {
    this.renderToken += 1;
    document.removeEventListener("keydown", this.keyHandler);
    if (document.fullscreenElement === this.modalEl) void document.exitFullscreen?.();
    this.contentEl.empty();
  }
}

export {
  PdfFigureCarouselModal,
  PdfFigureGalleryModal
};
