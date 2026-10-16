/* 删除确认弹窗：标签、收藏夹、论文、图片识别运行时、本地管线。 */

import { Modal } from "obsidian";
import { collectionPathContains, expandCollectionPaths } from "../collection-utils.js";

class DeleteTagModal extends Modal {
  constructor(app, plugin, tag) {
    super(app);
    this.plugin = plugin;
    this.tag = tag;
  }

  onOpen() {
    const count = this.plugin.settings.papers.filter((paper) => paper.tags.includes(this.tag)).length;
    this.contentEl.createEl("h2", { text: "删除这个标签？" });
    this.contentEl.createEl("p", { text: `标签 “${this.tag}” 将从 ${count} 篇论文中移除。论文和笔记不会被删除。` });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-warning", text: "删除标签" }).addEventListener("click", async () => {
      await this.plugin.deleteTag(this.tag);
      this.close();
    });
  }
}

class DeleteCollectionModal extends Modal {
  constructor(app, plugin, collection) {
    super(app);
    this.plugin = plugin;
    this.collection = collection;
  }

  onOpen() {
    const count = this.plugin.settings.papers.filter((paper) => (paper.collections || [])
      .some((candidate) => collectionPathContains(this.collection, candidate))).length;
    const descendants = expandCollectionPaths(this.plugin.settings.collections)
      .filter((path) => path !== this.collection && collectionPathContains(this.collection, path)).length;
    this.contentEl.createEl("h2", { text: "删除这个分类？" });
    this.contentEl.createEl("p", {
      text: `分类 “${this.collection}”${descendants ? ` 及其 ${descendants} 个子目录` : ""}将从 ${count} 篇论文中移除。论文、PDF 和笔记都不会被删除。`
    });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-warning", text: "删除分类" }).addEventListener("click", async () => {
      await this.plugin.deleteCollection(this.collection);
      this.close();
    });
  }
}

class DeletePaperModal extends Modal {
  constructor(app, plugin, paper) {
    super(app);
    this.plugin = plugin;
    this.paper = paper;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "Delete this paper?" });
    this.contentEl.createEl("p", { text: `“${this.paper.title}” will be removed from the library. Its PDF and note will not be deleted.` });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-warning", text: "Delete" }).addEventListener("click", async () => {
      this.plugin.markPapersDeleted([this.paper]);
      this.plugin.settings.papers = this.plugin.settings.papers.filter((paper) => paper.id !== this.paper.id);
      if (this.plugin.uiState.selectedId === this.paper.id) {
        this.plugin.uiState.selectedId = this.plugin.settings.papers[0]?.id || null;
      }
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
      this.close();
    });
  }
}

class DeletePapersModal extends Modal {
  constructor(app, plugin, papers, onDone = null) {
    super(app);
    this.plugin = plugin;
    this.papers = papers;
    this.onDone = onDone;
  }
  onOpen() {
    const count = this.papers.length;
    this.contentEl.createEl("h2", { text: `删除 ${count} 篇论文？` });
    this.contentEl.createEl("p", { text: `这 ${count} 篇论文将从库中移除，它们的 PDF 和笔记不会被删除。` });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-warning", text: `删除 ${count} 篇` }).addEventListener("click", async () => {
      const ids = new Set(this.papers.map((paper) => paper.id));
      this.plugin.markPapersDeleted(this.papers);
      this.plugin.settings.papers = this.plugin.settings.papers.filter((paper) => !ids.has(paper.id));
      if (ids.has(this.plugin.uiState.selectedId)) {
        this.plugin.uiState.selectedId = this.plugin.settings.papers[0]?.id || null;
      }
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
      this.onDone?.();
      this.close();
    });
  }
}

class DeleteFigureRecognitionRuntimeModal extends Modal {
  constructor(app, plugin, onComplete) {
    super(app);
    this.plugin = plugin;
    this.onComplete = onComplete;
  }

  onOpen() {
    this.contentEl.addClass("paperlib-modal");
    this.contentEl.createEl("h2", { text: "删除图片识别运行时？" });
    this.contentEl.createEl("p", {
      text: "将删除可重新下载的 DocLayout-YOLO ONNX 模型、Python 运行时与图片识别缓存，预计释放约 240–300 MB。论文、PDF、笔记和批注不会被删除。"
    });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    const remove = buttons.createEl("button", { cls: "mod-warning", text: "删除并关闭" });
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      await this.plugin.removeDocLayoutRuntime();
      this.onComplete?.();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

class DeleteLocalPipelineModal extends Modal {
  constructor(app, plugin, onComplete) {
    super(app);
    this.plugin = plugin;
    this.onComplete = onComplete;
  }

  onOpen() {
    this.contentEl.addClass("paperlib-modal", "paperlib-mineru-modal");
    this.contentEl.createEl("h2", { text: "删除本地解析模型？" });
    this.contentEl.createEl("p", {
      text: "将删除可重新下载的模型、当前平台运行时和解析缓存。论文、PDF、笔记与对话不会被删除。"
    });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons paperlib-mineru-modal-actions" });
    buttons.createEl("button", { cls: "paperlib-mineru-secondary", text: "取消" })
      .addEventListener("click", () => this.close());
    const remove = buttons.createEl("button", { cls: "paperlib-mineru-danger", text: "删除模型包" });
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      await this.plugin.removeLocalPipelinePack();
      this.onComplete?.();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

export {
  DeleteCollectionModal,
  DeleteFigureRecognitionRuntimeModal,
  DeleteLocalPipelineModal,
  DeletePaperModal,
  DeletePapersModal,
  DeleteTagModal
};
