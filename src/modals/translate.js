import { Modal, Notice } from "obsidian";

class TranslationModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.loading = true;
    this.translation = "";
    this.error = "";
    this.closed = false;
  }

  onOpen() {
    this.render();
    this.load();
  }

  onClose() {
    this.closed = true;
    this.contentEl.empty();
  }

  async load() {
    try {
      this.translation = String(await this.options.translate?.() || "").trim();
    } catch (error) {
      this.error = String(error?.message || error);
    } finally {
      this.loading = false;
    }
    if (!this.closed) this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.classList.add("paperlib-translation-modal");
    contentEl.createEl("h2", { text: "翻译" });
    contentEl.createEl("p", {
      cls: "paperlib-translation-meta",
      text: `${this.options.providerLabel || "翻译服务"} → ${this.options.targetLabel || "中文"}`
    });
    if (this.loading) {
      contentEl.createEl("p", { cls: "paperlib-translation-loading", text: "翻译中…" });
    } else if (this.error) {
      contentEl.createEl("p", { cls: "paperlib-translation-error", text: this.error });
      contentEl.createEl("p", {
        cls: "paperlib-translation-meta",
        text: "可以在「设置 → 翻译」中切换翻译服务或填写 API 密钥。"
      });
    } else {
      contentEl.createDiv({ cls: "paperlib-translation-result", text: this.translation });
    }
    const original = String(this.options.original || "").trim();
    if (original) {
      const details = contentEl.createEl("details", { cls: "paperlib-translation-original" });
      details.createEl("summary", { text: "原文" });
      details.createEl("div", { text: original });
    }
    const actions = contentEl.createDiv({ cls: "paperlib-translation-actions" });
    if (!this.loading && !this.error && this.translation) {
      const copy = actions.createEl("button", { text: "复制译文", attr: { type: "button" } });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(this.translation);
          new Notice("译文已复制");
        } catch (error) {
          new Notice(`复制失败：${error.message || error}`);
        }
      });
    }
    const close = actions.createEl("button", { text: "关闭", attr: { type: "button" } });
    close.addEventListener("click", () => this.close());
  }
}

export { TranslationModal };
