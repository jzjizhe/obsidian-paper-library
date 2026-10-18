import { Notice, normalizePath } from "obsidian";
import { PDF_TEXT_COLORS } from "../constants.js";
import { workspaceId } from "../paper-utils.js";

const textboxMethods = {
  getPdfTextBoxFontSize(mark) {
    // 已有标注按自身保存的字号渲染；缺失时回退旧默认值，避免修改全局设置导致旧框外观变化
    const value = mark ? Number(mark.fontSize) || 11 : Number(this.settings.pdfTextBoxFontSize) || 18;
    return Math.max(8, Math.min(48, value));
  },

  measurePdfTextBoxText(mark, pageSize) {
    // FreeText 没有外观流时由阅读器按 DA/Contents 自行排版，矩形必须容纳真实文字：
    // 兼容显式换行和中文全角字符，避免写回后文字溢出到框外。
    const fontSize = this.getPdfTextBoxFontSize(mark);
    const text = String(mark?.comment || mark?.text || "");
    const rawLines = text.split(/\r?\n/);
    const measure = (line) => Array.from(line).reduce((width, char) => {
      const fullWidth = /[\u1100-\u11FF\u2E80-\u9FFF\uA960-\uA97F\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(char);
      return width + fontSize * (fullWidth ? 1 : /\s/.test(char) ? 0.35 : 0.55);
    }, 0);
    const maxLineWidth = Math.max(0, ...rawLines.map(measure));
    const box = mark?.box || {};
    const pageWidth = Math.max(1, Number(pageSize?.width) || 612);
    const originX = Math.max(0, Math.min(1, Number(box.x) || 0.6)) * pageWidth;
    const availableWidth = Math.max(48, pageWidth - originX);
    const storedWidth = Math.max(48, (Number(box.width) || 0.32) * pageWidth);
    const width = Math.min(availableWidth, Math.max(storedWidth, maxLineWidth + 8));
    const usableWidth = Math.max(fontSize, width - 8);
    const lines = rawLines.reduce((count, line) => {
      return count + Math.max(1, Math.ceil(measure(line) / usableWidth));
    }, 0);
    return {
      fontSize,
      x: originX,
      width,
      height: Math.max(fontSize + 8, lines * (fontSize * 1.5) + 8)
    };
  },

  getPdfTextBoxTextColorValue(mark) {
    const id = String(mark?.textColor || "default");
    return (PDF_TEXT_COLORS.find((color) => color.id === id) || PDF_TEXT_COLORS[0]).value;
  },

  pdfTextColorOperator(mark) {
    const id = String(mark?.textColor || "default");
    if (id === "default") return "0 g";
    const hex = String((PDF_TEXT_COLORS.find((color) => color.id === id) || {}).value || "#000000").replace("#", "");
    const red = parseInt(hex.slice(0, 2), 16) / 255;
    const green = parseInt(hex.slice(2, 4), 16) / 255;
    const blue = parseInt(hex.slice(4, 6), 16) / 255;
    return `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)} rg`;
  },

  async createPdfTextBox(paper, file, pageNumber, box, fontSize = null, textColor = "orange") {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !file?.path || !pageNumber) return null;
    const id = workspaceId("textbox");
    const mark = {
      id,
      pdfAnnotationId: id,
      text: "",
      page: pageNumber,
      comment: "",
      selection: { beginIndex: -1, beginOffset: -1, endIndex: -1, endOffset: -1 },
      selectionSource: "textbox",
      rectCoordinateSpace: "page-relative",
      fontSize: Math.max(8, Math.min(48, Number(fontSize) || Number(this.settings.pdfTextBoxFontSize) || 18)),
      textColor: PDF_TEXT_COLORS.some((color) => color.id === textColor) ? textColor : "orange",
      color: "yellow",
      pdfSubtype: "FreeText",
      box: { x: box.x, y: box.y, width: box.width || 0.02 },
      pdfRects: [],
      pdfPath: file.path,
      createdAt: new Date().toISOString()
    };
    paper.annotations = Array.isArray(paper.annotations) ? paper.annotations : [];
    paper.annotations.push(mark);
    this.recordNativePdfUndoAction(paper, file.path, "create", [{ source: "paper-annotation", record: mark }]);
    await this.saveSettings();
    // 空文本框先不写回 PDF，等用户输入内容后由 updatePdfTextBox 触发
    await this.refreshNativePdfTextBoxes(paper);
    const content = this.app.workspace.getLeavesOfType?.("pdf")?.find((leaf) => leaf.view?.file?.path === file.path)
      ?.view?.containerEl?.querySelector?.(`.paperlib-pdf-textbox-card[data-mark-id="${id}"] .paperlib-pdf-textbox-content`);
    if (content) {
      const card = content.closest?.(".paperlib-pdf-textbox-card");
      if (card) {
        card.dataset.editing = "true";
        card.classList.add("is-editing");
        content.setAttribute("contenteditable", "true");
        content.focus?.();
      }
    }
    return mark;
  },

  async updatePdfTextBox(paper, markId, changes = {}) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return false;
    const mark = (paper.annotations || []).find((item) => item.id === markId && item.pdfSubtype === "FreeText");
    if (!mark) return false;
    if (typeof changes.comment === "string") mark.comment = changes.comment;
    if (changes.box) mark.box = { ...(mark.box || {}), ...changes.box };
    if (Number.isFinite(Number(changes.fontSize))) {
      mark.fontSize = Math.max(8, Math.min(48, Number(changes.fontSize)));
    }
    mark.updatedAt = new Date().toISOString();
    await this.saveSettings();
    await this.syncLocalPdfAnnotation(mark);
    await this.upsertPdfTextBoxNoteEntry(paper, mark);
    await this.refreshNativePdfTextBoxes(paper);
    return true;
  },

  async deletePdfTextBox(paper, mark) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !mark) return;
    await this.deletePdfMark(paper, { record: mark, source: "paper-annotation" });
    await this.removePdfTextBoxNoteEntry(paper, mark);
    await this.refreshNativePdfTextBoxes(paper);
  },

  async cleanupEmptyPdfTextBoxes(paper, pdfPath = paper?.pdfPath) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return 0;
    const path = normalizePath(pdfPath || paper.pdfPath || "");
    const empties = (paper.annotations || []).filter((mark) => (
      mark.pdfSubtype === "FreeText"
      && normalizePath(mark.pdfPath || paper.pdfPath || "") === path
      && !String(mark.comment || "").trim()
    ));
    if (!empties.length) return 0;
    const ids = new Set(empties.map((mark) => mark.id));
    paper.annotations = (paper.annotations || []).filter((mark) => !ids.has(mark.id));
    await this.saveSettings();
    for (const mark of empties) {
      try {
        await this.removePdfTextBoxNoteEntry(paper, mark);
      } catch (error) {
        // 空文本框通常没有笔记条目，失败不影响清理
      }
    }
    try {
      await this.removeLocalPdfAnnotations(empties);
    } catch (error) {
      console.warn("Paper Library: failed to remove empty text box annotations", error);
    }
    await this.refreshNativePdfTextBoxes(paper);
    new Notice(`已清理 ${empties.length} 个空文本框`);
    return empties.length;
  },

  async upsertPdfTextBoxNoteEntry(paper, mark) {
    const noteFile = await this.ensurePaperNote(paper);
    if (!noteFile) return;
    const heading = this.settings.annotationHeading || "PDF Annotations";
    const headingLine = `## ${heading}`;
    const text = String(mark.comment || "").trim();
    if (!text) return;
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    const block = `> [!pdf|yellow]+ PDF 文本框 · p. ${mark.page}\n${quoted}\n>\n> 保存于 ${new Date().toLocaleString()}\n\n^${mark.id}`;
    let content = await this.app.vault.read(noteFile);
    if (!content.includes(headingLine)) content = `${content.trimEnd()}\n\n${headingLine}\n`;
    const marker = `^${mark.id}`;
    const markerIndex = content.indexOf(marker);
    if (markerIndex === -1) {
      content = `${content.trimEnd()}\n\n${block}\n`;
    } else {
      const blockStart = content.lastIndexOf("\n> [!pdf", markerIndex);
      if (blockStart !== -1) {
        content = `${content.slice(0, blockStart + 1)}${block}${content.slice(markerIndex + marker.length)}`;
      }
    }
    await this.app.vault.modify(noteFile, content);
  },

  async removePdfTextBoxNoteEntry(paper, mark) {
    const noteFile = await this.ensurePaperNote(paper);
    if (!noteFile) return;
    let content = await this.app.vault.read(noteFile);
    const marker = `^${mark.id}`;
    const markerIndex = content.indexOf(marker);
    if (markerIndex === -1) return;
    const blockStart = content.lastIndexOf("\n> [!pdf", markerIndex);
    if (blockStart === -1) return;
    let end = markerIndex + marker.length;
    while (content[end] === "\n") end += 1;
    content = `${content.slice(0, blockStart)}${content.slice(end)}`;
    await this.app.vault.modify(noteFile, content);
  },
};

export { textboxMethods };
