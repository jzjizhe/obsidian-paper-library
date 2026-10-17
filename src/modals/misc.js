/* 其他弹窗：会议关注、原生 PDF 批注。 */

import { Modal, Notice, Setting } from "obsidian";
import { truncate } from "../text-utils.js";

class ConferenceFollowModal extends Modal {
  constructor(app, plugin, onSave) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.selected = new Set(plugin.settings.followedConferences || []);
    this.query = "";
  }

  onOpen() {
    this.modalEl.addClass("paperlib-conference-follow-modal");
    this.render();
  }

  render() {
    this.contentEl.empty();
    const header = this.contentEl.createDiv({ cls: "paperlib-conference-follow-header" });
    const copy = header.createDiv();
    copy.createEl("h2", { text: "关注会议" });
    copy.createEl("p", { text: "选择希望在 Daily Board 追踪截稿日期的会议。" });
    const search = this.contentEl.createEl("input", {
      cls: "paperlib-conference-follow-search",
      attr: { type: "search", placeholder: "搜索会议缩写或全称…", value: this.query }
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList(list);
    });
    const list = this.contentEl.createDiv({ cls: "paperlib-conference-follow-list" });
    this.renderList(list);
    const footer = this.contentEl.createDiv({ cls: "paperlib-conference-follow-footer" });
    footer.createSpan({ text: `已关注 ${this.selected.size} 个会议` });
    const save = footer.createEl("button", { cls: "mod-cta", text: "保存", attr: { type: "button" } });
    save.addEventListener("click", async () => {
      this.plugin.settings.followedConferences = [...this.selected];
      await this.plugin.saveSettings();
      this.onSave?.();
      this.close();
    });
    window.setTimeout(() => search.focus(), 0);
  }

  renderList(list) {
    list.empty();
    const query = this.query.trim().toLocaleLowerCase();
    const conferences = [...(this.plugin.settings.conferenceRankingDatabase?.conferences || [])]
      .filter((conference) => Array.isArray(conference.confs) && conference.confs.length)
      .filter((conference) => !query || [conference.shortName, conference.fullName, ...(conference.aliases || [])]
        .join(" ").toLocaleLowerCase().includes(query))
      .sort((left, right) => String(left.shortName).localeCompare(String(right.shortName)))
      .slice(0, 160);
    if (!conferences.length) {
      list.createEl("p", {
        cls: "paperlib-daily-empty",
        text: "尚未载入可用会议。请保持联网，插件会自动同步 CCF-DDL 数据。"
      });
      return;
    }
    conferences.forEach((conference) => {
      const label = list.createEl("label", { cls: "paperlib-conference-follow-item" });
      const checkbox = label.createEl("input", {
        attr: { type: "checkbox", value: conference.shortName }
      });
      checkbox.checked = this.selected.has(conference.shortName);
      const text = label.createDiv();
      text.createEl("strong", { text: conference.shortName });
      text.createSpan({ text: conference.fullName || conference.shortName });
      const ranks = label.createDiv({ cls: "paperlib-conference-follow-ranks" });
      (conference.ranks || []).slice(0, 3).forEach((rank) => ranks.createSpan({ text: `${rank.system} ${rank.rank}` }));
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(conference.shortName);
        else this.selected.delete(conference.shortName);
        this.contentEl.querySelector(".paperlib-conference-follow-footer > span")
          ?.setText?.(`已关注 ${this.selected.size} 个会议`);
      });
    });
  }

  onClose() { this.contentEl.empty(); }
}

class NativePdfAnnotationModal extends Modal {
  constructor(app, plugin, context, colorId) {
    super(app);
    this.plugin = plugin;
    this.context = context;
    this.colorId = colorId || "yellow";
    this.comment = "";
  }

  onOpen() {
    this.contentEl.addClass("paperlib-modal", "paperlib-highlight-modal");
    this.contentEl.createEl("h2", { text: "添加 PDF 注释" });
    this.contentEl.createEl("p", {
      cls: "paperlib-modal-intro",
      text: `第 ${this.context.page} 页 · ${truncate(this.context.text, 120)}`
    });
    new Setting(this.contentEl)
      .setName("注释内容")
      .setDesc("注释将同时写入论文笔记和本地 PDF 文件。")
      .addTextArea((text) => {
        text.setPlaceholder("写下你的想法……");
        text.inputEl.rows = 6;
        text.onChange((value) => { this.comment = value.trim(); });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-cta", text: "保存注释" }).addEventListener("click", async () => {
      if (!this.comment) return new Notice("请输入注释内容");
      await this.plugin.savePdfHighlight(this.context, this.colorId, this.comment, {
        openWorkspace: false,
        pdfSubtype: "Text"
      });
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

export {
  ConferenceFollowModal,
  NativePdfAnnotationModal
};
