/* PDF 标注回看弹窗：按页码列出当前论文的所有高亮，点击跳页定位，支持删除。 */

import { Modal, Notice, normalizePath } from "obsidian";
import { CANVAS_HIGHLIGHT_COLORS } from "../constants.js";
import { truncate } from "../text-utils.js";
import { setPaperlibIcon } from "../ui-utils.js";

class PdfAnnotationsModal extends Modal {
  constructor(app, plugin, paper, pdfPath) {
    super(app);
    this.plugin = plugin;
    this.paperId = paper?.id || "";
    this.pdfPath = pdfPath || paper?.pdfPath || "";
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    const paper = this.plugin.getCanonicalPaper({ id: this.paperId });
    if (!paper) {
      contentEl.createEl("h2", { text: "PDF 标注" });
      contentEl.createEl("p", { text: "未找到对应论文。" });
      return;
    }
    const path = normalizePath(this.pdfPath || paper.pdfPath || "");
    const workspace = this.plugin.ensureResearchWorkspace(paper);
    const matchesPath = (record) => normalizePath(record.pdfPath || paper.pdfPath || "") === path;
    const entries = [];
    const seen = new Set();
    const remember = (record) => {
      [record.id, record.pdfAnnotationId].filter(Boolean).forEach((key) => seen.add(key));
    };
    const addEntry = (entry) => entries.push({
      page: Number(entry.record?.page) || 1,
      createdAt: entry.record?.createdAt || "",
      ...entry
    });

    (workspace.highlights || []).filter(matchesPath).forEach((mark) => {
      addEntry({
        kind: mark.pdfSubtype === "Underline" ? "下划线" : "高光",
        source: "canvas-highlight",
        record: mark,
        color: mark.color,
        text: mark.text || ""
      });
      remember(mark);
    });

    (paper.annotations || []).filter(matchesPath).forEach((mark) => {
      const keys = [mark.id, mark.pdfAnnotationId].filter(Boolean);
      if (keys.some((key) => seen.has(key))) return;
      const subtype = String(mark.pdfSubtype || "");
      addEntry({
        kind: subtype === "FreeText" ? "文本框" : subtype === "Text" ? "注释" : subtype === "Underline" ? "下划线" : "高光",
        source: subtype === "FreeText" ? "free-text" : "paper-annotation",
        record: mark,
        color: mark.color,
        text: subtype === "FreeText" || subtype === "Text" ? (mark.comment || mark.text || "") : (mark.text || "")
      });
      remember(mark);
    });

    (workspace.inkStrokes || []).filter(matchesPath).forEach((stroke) => {
      addEntry({
        kind: "画笔",
        source: "ink",
        record: stroke,
        color: stroke.color,
        text: `画笔笔迹 · ${Array.isArray(stroke.points) ? stroke.points.length : 0} 个点`
      });
    });

    const shapeNames = { line: "直线", arrow: "箭头", circle: "圆", ellipse: "椭圆", rect: "矩形" };
    (workspace.pdfShapes || []).filter(matchesPath).forEach((shape) => {
      addEntry({
        kind: "形状",
        source: "shape",
        record: shape,
        color: shape.color,
        text: shapeNames[shape.type] || "形状"
      });
    });

    entries.sort((first, second) => (
      first.page - second.page
      || String(first.createdAt).localeCompare(String(second.createdAt))
      || first.kind.localeCompare(second.kind)
    ));
    contentEl.createEl("h2", { text: `PDF 标注 · ${entries.length} 条` });
    if (!entries.length) {
      contentEl.createEl("p", { cls: "paperlib-annotation-empty", text: "这篇论文还没有标注、画笔或形状。" });
      return;
    }
    const list = contentEl.createDiv({ cls: "paperlib-annotations-list" });
    for (const entry of entries) {
      const color = CANVAS_HIGHLIGHT_COLORS.find((item) => (
        item.id === String(entry.color || "").toLocaleLowerCase()
      )) || CANVAS_HIGHLIGHT_COLORS[0];
      const row = list.createDiv({ cls: "paperlib-annotation-row", attr: { role: "button", tabindex: "0" } });
      const dot = row.createSpan({ cls: "paperlib-annotation-dot" });
      dot.style.background = color.value;
      row.createSpan({ cls: "paperlib-annotation-page", text: `第 ${entry.page} 页` });
      row.createSpan({ cls: "paperlib-annotation-kind", text: entry.kind });
      const preview = truncate(String(entry.text || "").replace(/\s+/g, " ").trim(), 90);
      row.createSpan({ cls: "paperlib-annotation-text", text: preview || entry.kind });
      const remove = row.createEl("button", {
        cls: "paperlib-annotation-delete",
        attr: { type: "button", "aria-label": "删除标注", title: "删除标注" }
      });
      setPaperlibIcon(remove, "trash-2");
      remove.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        remove.disabled = true;
        try {
          if (entry.source === "canvas-highlight") {
            await this.plugin.deletePdfMark(paper, { record: entry.record, source: "canvas-highlight" });
          } else if (entry.source === "free-text") {
            await this.plugin.deletePdfTextBox(paper, entry.record);
          } else if (entry.source === "paper-annotation") {
            await this.plugin.deletePdfMark(paper, { record: entry.record, source: "paper-annotation" });
          } else if (entry.source === "ink") {
            await this.plugin.removePdfInkStroke(paper, entry.record.id);
          } else if (entry.source === "shape") {
            await this.plugin.removePdfShape(paper, entry.record.id);
          }
        } catch (error) {
          console.error("Paper Library: failed to delete PDF annotation", error);
          new Notice(`删除标注失败：${error.message || error}`);
        } finally {
          remove.disabled = false;
        }
        this.render();
      });
      const jump = () => {
        this.close();
        void this.plugin.openNativePdfAtPage(paper, entry.page);
      };
      row.addEventListener("click", jump);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jump();
        }
      });
    }
  }
}

class ClearAnnotationsModal extends Modal {
  constructor(app, plugin, paper, pdfPath, count) {
    super(app);
    this.plugin = plugin;
    this.paper = paper;
    this.pdfPath = pdfPath;
    this.count = count;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "清空所有标注" });
    contentEl.createEl("p", {
      text: `将删除本文的 ${this.count} 条标注（论文库、论文笔记与 PDF 文件中一并移除），此操作不可撤销。`
    });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    const confirm = buttons.createEl("button", { text: "清空", cls: "mod-cta" });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      this.close();
      const removed = await this.plugin.clearPaperAnnotations(this.paper, this.pdfPath);
      new Notice(`已清空 ${removed} 条标注`);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export { ClearAnnotationsModal, PdfAnnotationsModal };
