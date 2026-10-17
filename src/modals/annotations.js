/* PDF 标注回看弹窗：按页码列出当前论文的所有高亮，点击跳页定位，支持删除。 */

import { Modal, normalizePath } from "obsidian";
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
    contentEl.createEl("h2", { text: "PDF 标注" });
    const paper = this.plugin.getCanonicalPaper({ id: this.paperId });
    if (!paper) {
      contentEl.createEl("p", { text: "未找到对应论文。" });
      return;
    }
    const path = normalizePath(this.pdfPath || paper.pdfPath || "");
    const marks = (this.plugin.ensureResearchWorkspace(paper).highlights || [])
      .filter((mark) => normalizePath(mark.pdfPath || paper.pdfPath || "") === path)
      .sort((first, second) => (
        (Number(first.page) || 0) - (Number(second.page) || 0)
        || String(first.createdAt || "").localeCompare(String(second.createdAt || ""))
      ));
    if (!marks.length) {
      contentEl.createEl("p", { cls: "paperlib-annotation-empty", text: "这篇论文还没有标注。" });
      return;
    }
    const list = contentEl.createDiv({ cls: "paperlib-annotations-list" });
    for (const mark of marks) {
      const color = CANVAS_HIGHLIGHT_COLORS.find((item) => (
        item.id === String(mark.color || "").toLocaleLowerCase()
      )) || CANVAS_HIGHLIGHT_COLORS[0];
      const row = list.createDiv({ cls: "paperlib-annotation-row", attr: { role: "button", tabindex: "0" } });
      const dot = row.createSpan({ cls: "paperlib-annotation-dot" });
      dot.style.background = color.value;
      row.createSpan({ cls: "paperlib-annotation-page", text: `第 ${mark.page} 页` });
      row.createSpan({ cls: "paperlib-annotation-text", text: truncate(mark.text || "", 90) });
      const remove = row.createEl("button", {
        cls: "paperlib-annotation-delete",
        attr: { type: "button", "aria-label": "删除标注", title: "删除标注" }
      });
      setPaperlibIcon(remove, "trash-2");
      remove.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.plugin.deletePdfMark(paper, { record: mark, source: "canvas-highlight" });
        this.render();
      });
      const jump = () => {
        this.close();
        void this.plugin.openNativePdfAtPage(paper, mark.page);
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

export { PdfAnnotationsModal };
