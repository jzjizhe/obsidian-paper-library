import { normalizePath } from "obsidian";

const readingpositionMethods = {
  recordPdfReadingPosition(paper, page) {
    // 打开时的定位/钉回顶部属于程序性滚动，抑制记录，避免覆盖真实阅读位置
    if (Date.now() < this.nativePdfPositionSuppressUntil) return;
    const id = paper?.id;
    const value = Math.max(1, Number(page) || 0);
    if (!id || !value) return;
    this.paperReadingPositions.set(id, value);
    if (this.paperReadingPositionTimer) clearTimeout(this.paperReadingPositionTimer);
    this.paperReadingPositionTimer = setTimeout(() => {
      this.paperReadingPositionTimer = null;
      this.persistPaperReadingPositions();
    }, 2000);
  },

  persistPaperReadingPositions() {
    if (this.paperReadingPositionTimer) {
      clearTimeout(this.paperReadingPositionTimer);
      this.paperReadingPositionTimer = null;
    }
    if (!this.paperReadingPositions.size) return;
    let changed = false;
    for (const [paperId, page] of this.paperReadingPositions) {
      const stored = this.settings.papers?.find((item) => item.id === paperId);
      if (!stored) continue;
      if (Number(stored.readingPosition?.page) !== page) {
        stored.readingPosition = { page, updatedAt: new Date().toISOString() };
        changed = true;
      }
    }
    this.paperReadingPositions.clear();
    if (changed) {
      void this.saveSettings().catch((error) => (
        console.warn("Paper Library: reading position save unavailable", error)
      ));
    }
  },

  async restoreNativePdfReadingPosition(file, paper) {
    if (!file?.path) return;
    if (this.settings.pdfOpenPosition === "first") {
      await this.pinNativePdfToFirstPage(file);
      return;
    }
    const target = Math.max(1, Number(paper?.readingPosition?.page) || 0);
    if (target <= 1) return;
    await this.scrollNativePdfToPage(file, target);
  },

  findNativePdfPageElement(file, page) {
    const leaves = this.app.workspace.getLeavesOfType?.("pdf")?.filter((leaf) => leaf.view?.file?.path === file?.path) || [];
    const active = this.app.workspace.activeLeaf;
    const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
    return leaf?.view?.containerEl?.querySelector?.(`.page[data-page-number="${page}"]`) || null;
  },

  findNativePdfScroller(pageEl) {
    for (let element = pageEl?.parentElement; element; element = element.parentElement) {
      try {
        const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
        if (style && /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
      } catch (error) { /* 忽略跨文档样式查询失败 */ }
    }
    return pageEl?.parentElement || null;
  },

  alignNativePdfFirstPage(pageEl, scroller) {
    const pageTop = pageEl?.getBoundingClientRect?.().top ?? 0;
    const scrollerTop = scroller?.getBoundingClientRect?.().top ?? 0;
    const delta = pageTop - scrollerTop;
    if (Math.abs(delta) <= 4) return false;
    if (scroller) {
      scroller.scrollTop = Math.max(0, Number(scroller.scrollTop || 0) + delta);
    } else {
      pageEl?.scrollIntoView?.({ block: "start" });
    }
    return true;
  },

  async pinNativePdfToFirstPage(file) {
    // Obsidian 会恢复文件上次的滚动位置，且恢复时机可能晚于 openFile（大 PDF 加载完成后才恢复）。
    // 在约 5 秒内持续检查并纠正；检测到用户交互（点击/滚轮/按键）后立即停止，避免和用户抢滚动。
    let interacting = false;
    let boundContainer = null;
    const markInteractive = () => { interacting = true; };
    const bind = (container) => {
      if (!container || container === boundContainer) return;
      boundContainer = container;
      container.addEventListener("pointerdown", markInteractive, true);
      container.addEventListener("wheel", markInteractive, { capture: true, passive: true });
      container.addEventListener("keydown", markInteractive, true);
    };
    try {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        if (interacting) return false;
        const pageEl = this.findNativePdfPageElement(file, 1);
        if (pageEl) {
          bind(pageEl.closest?.(".pdf-viewer, .pdf-container") || pageEl.parentElement);
          const scroller = this.findNativePdfScroller(pageEl);
          // 第 1 页可能在视口上方（Obsidian 恢复到第 N 页），也可能在下方；
          // 两个方向都要纠正，只向下判断会永远修不回来。
          this.alignNativePdfFirstPage(pageEl, scroller);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      boundContainer?.removeEventListener?.("pointerdown", markInteractive, true);
      boundContainer?.removeEventListener?.("wheel", markInteractive, { capture: true });
      boundContainer?.removeEventListener?.("keydown", markInteractive, true);
    }
    return true;
  },

  async scrollNativePdfToPage(file, page) {
    const target = Math.max(1, Number(page) || 0);
    if (!file?.path || !target) return false;
    // 原生视图是连续滚动 + 全页占位符：等占位符出现后定位，未渲染的远页也能滚到
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const leaves = this.app.workspace.getLeavesOfType?.("pdf")?.filter((leaf) => leaf.view?.file?.path === file.path) || [];
      const active = this.app.workspace.activeLeaf;
      const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
      const pageEl = leaf?.view?.containerEl?.querySelector?.(`.page[data-page-number="${target}"]`);
      if (pageEl) {
        pageEl.scrollIntoView?.({ block: "start" });
        return true;
      }
      if (!leaves.length && attempt === 0) {
        await this.app.workspace.getLeaf("tab").openFile(file);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  },

  async openNativePdfAtPage(paper, page) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(paper?.pdfPath || ""));
    if (!file || file.extension?.toLocaleLowerCase() !== "pdf") return false;
    const existing = this.app.workspace.getLeavesOfType("pdf").find((leaf) => leaf.view?.file?.path === file.path);
    if (existing) this.app.workspace.setActiveLeaf?.(existing, { focus: true });
    else await this.app.workspace.getLeaf("tab").openFile(file);
    return this.scrollNativePdfToPage(file, page);
  },
};

export { readingpositionMethods };
