/* 引文样式弹窗：CSL 样式导入与自定义模板编辑。 */

import { Modal, Notice, Setting } from "obsidian";
import { uniqueId } from "../paper-utils.js";
import { citationFieldBag, normalizeCitationAuthorRules, renderCitationTemplate, validateCitationTemplate } from "../citation-engine.js";

class CslImportModal extends Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
    this.styleId = "";
  }

  onOpen() {
    this.contentEl.addClass("paperlib-modal");
    this.contentEl.createEl("h2", { text: "从 CSL 样式库导入引用样式" });
    this.contentEl.createEl("p", {
      cls: "paperlib-modal-intro",
      text: "输入期刊名（如 Optica、Nature Photonics）即可搜索 10,000+ 官方 CSL 模板（Scholar Sidekick 在线 API 同款来源）；也可以直接输入样式 ID。导入后可在详情页引用面板中直接使用。"
    });
    new Setting(this.contentEl).setName("搜索期刊 / 样式 ID").addText((text) => {
      text.setPlaceholder("例如：optica 或 nature photonics");
      this.inputEl = text.inputEl;
      text.onChange((value) => {
        this.styleId = value.trim();
        window.clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => void this.search(), 300);
      });
      window.setTimeout(() => text.inputEl.focus(), 0);
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); this.import(); }
      });
    });
    this.results = this.contentEl.createDiv({ cls: "paperlib-csl-results" });
    this.status = this.contentEl.createDiv({ cls: "paperlib-citation-style-status" });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    this.importButton = buttons.createEl("button", { cls: "mod-cta", text: "导入" });
    this.importButton.addEventListener("click", () => this.import());
  }

  async search() {
    const query = this.styleId;
    const token = (this.searchToken || 0) + 1;
    this.searchToken = token;
    this.results.empty();
    if (!query || query.length < 2) return;
    try {
      const matches = await this.plugin.searchCslStyles(query);
      if (token !== this.searchToken) return;
      this.results.empty();
      if (!matches.length) {
        this.results.createDiv({ cls: "paperlib-csl-result-empty", text: "没有匹配的样式；可直接输入样式 ID 后点击导入" });
        return;
      }
      matches.forEach((entry) => {
        const item = this.results.createEl("button", { cls: "paperlib-csl-result", attr: { type: "button" } });
        item.createSpan({ cls: "paperlib-csl-result-title", text: entry.title });
        item.createSpan({
          cls: "paperlib-csl-result-meta",
          text: `${entry.name}${entry.categories?.format ? ` · ${entry.categories.format}` : ""}`
        });
        item.addEventListener("click", () => {
          this.styleId = entry.name;
          if (this.inputEl) this.inputEl.value = entry.name;
          this.results.empty();
          void this.import();
        });
      });
    } catch (_) {
      // 索引不可用（离线等）时静默降级：仍可直接输入样式 ID 导入
    }
  }

  async import() {
    if (!this.styleId) return new Notice("请输入样式 ID");
    if (this.importing) return;
    this.importing = true;
    this.importButton.disabled = true;
    this.status.setText("正在下载并解析样式模板…");
    try {
      const style = await this.plugin.importCslCitationStyle(this.styleId);
      new Notice(`已导入引用样式：${style.label}`);
      this.onDone?.();
      this.close();
    } catch (error) {
      console.error("Paper Library: CSL import failed", error);
      this.status.setText(`导入失败：${error.message || error}`);
    } finally {
      this.importing = false;
      this.importButton.disabled = false;
    }
  }

  onClose() {
    window.clearTimeout(this.searchTimer);
    this.contentEl.empty();
  }
}

class CitationStyleModal extends Modal {
  constructor(app, plugin, style = null, onDone = null) {
    super(app);
    this.plugin = plugin;
    this.style = style;
    this.onDone = onDone;
    this.label = style?.label || "";
    this.template = style?.template || "{authors} ({year}). {title}.[ {venue}.][ {url}]";
    this.authorRules = normalizeCitationAuthorRules(style?.authors);
  }

  insertToken(textarea, snippet) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = `${textarea.value.slice(0, start)}${snippet}${textarea.value.slice(end)}`;
    textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
    textarea.dispatchEvent(new Event("input"));
    textarea.focus();
  }

  previewSample() {
    return this.plugin.settings.papers.find((paper) => paper?.title) || {
      title: "Measured measurement",
      authors: ["Aspelmeyer, Markus", "Zeilinger, Anton"],
      year: 2009,
      venue: "Nature Physics",
      journalAbbreviation: "Nature Phys",
      volume: "5",
      issue: "1",
      pages: "11-12",
      doi: "10.1038/nphys1170"
    };
  }

  refreshPreview() {
    const problems = validateCitationTemplate(this.template);
    const rendered = renderCitationTemplate(
      { template: this.template, authors: this.authorRules },
      citationFieldBag(this.previewSample())
    );
    this.previewEl.setText(rendered || "（无输出）");
    this.statusEl.setText(problems.length ? problems.join("；") : "");
    this.statusEl.toggleClass("has-error", problems.length > 0);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("paperlib-modal");
    contentEl.addClass("paperlib-citation-style-modal");
    contentEl.createEl("h2", { text: this.style ? "编辑引用样式" : "新建引用样式" });

    new Setting(contentEl).setName("样式名称").addText((text) => text
      .setValue(this.label)
      .setPlaceholder("例如：GB/T 7714 或 My Journal")
      .onChange((value) => { this.label = value.trim(); }));

    const templateSetting = new Setting(contentEl)
      .setName("引用模板")
      .setDesc("点击下面按钮在光标处插入占位符；[ ] 内为可选段，字段为空时自动省略")
      .addTextArea((area) => {
        area.setValue(this.template).onChange((value) => {
          this.template = value;
          this.refreshPreview();
        });
        area.inputEl.rows = 4;
        area.inputEl.addClass("paperlib-citation-template-input");
        this.templateInput = area.inputEl;
      });
    templateSetting.controlEl.addClass("paperlib-citation-template-control");

    const tokens = contentEl.createDiv({ cls: "paperlib-citation-tokens" });
    [
      ["作者", "{authors}"], ["年份", "{year}"], ["标题", "{title}"],
      ["标题·Title Case", "{title:title}"], ["标题·句式", "{title:sentence}"],
      ["期刊", "{venue}"], ["期刊缩写", "{venue:abbr}"],
      ["卷", "{volume}"], ["期", "{issue}"], ["页码", "{pages}"],
      ["短页码", "{pages:short}"], ["DOI", "{doi}"], ["链接", "{url}"]
    ].forEach(([label, snippet]) => {
      const chip = tokens.createEl("button", { text: label, attr: { type: "button" } });
      chip.addEventListener("click", () => this.insertToken(this.templateInput, snippet));
    });
    const groupChip = tokens.createEl("button", { text: "[可选段]", attr: { type: "button", title: "字段为空时整段省略" } });
    groupChip.addEventListener("click", () => this.insertToken(this.templateInput, "[]"));
    const italicChip = tokens.createEl("button", { text: "斜体", attr: { type: "button", title: "在文字两侧各加一个 *" } });
    italicChip.addEventListener("click", () => this.insertToken(this.templateInput, "*"));
    const boldChip = tokens.createEl("button", { text: "粗体", attr: { type: "button", title: "在文字两侧各加两个 *" } });
    boldChip.addEventListener("click", () => this.insertToken(this.templateInput, "**"));

    contentEl.createEl("h3", { text: "作者规则" });
    const ruleSetting = (name, build) => {
      const setting = new Setting(contentEl).setName(name);
      build(setting);
      return setting;
    };
    ruleSetting("姓名顺序", (setting) => setting.addDropdown((dropdown) => dropdown
      .addOptions({ family: "姓在前（Aspelmeyer, M.）", given: "名在前（M. Aspelmeyer）", "first-family": "仅首作者姓在前" })
      .setValue(this.authorRules.order)
      .onChange((value) => { this.authorRules.order = value; this.refreshPreview(); })));
    ruleSetting("名字缩写", (setting) => setting.addDropdown((dropdown) => dropdown
      .addOptions({ "spaced-dot": "F. P.", "compact-dot": "F.P.", plain: "FP", full: "不缩写" })
      .setValue(this.authorRules.initials)
      .onChange((value) => { this.authorRules.initials = value; this.refreshPreview(); })));
    ruleSetting("姓后逗号", (setting) => setting.addToggle((toggle) => toggle
      .setValue(this.authorRules.familyComma)
      .onChange((value) => { this.authorRules.familyComma = value; this.refreshPreview(); })));
    ruleSetting("作者分隔符", (setting) => setting.addText((text) => text
      .setValue(this.authorRules.delimiter)
      .onChange((value) => { this.authorRules.delimiter = value; this.refreshPreview(); })));
    ruleSetting("末位连接符", (setting) => setting.addText((text) => text
      .setValue(this.authorRules.lastDelimiter)
      .setPlaceholder("留空 = 用分隔符；如 “ & ” 或 “ and ”")
      .onChange((value) => { this.authorRules.lastDelimiter = value; this.refreshPreview(); })));
    ruleSetting("et al. 省略阈值", (setting) => setting.addText((text) => {
      text.setValue(String(this.authorRules.etAlMin || ""))
        .setPlaceholder("0 = 不省略")
        .onChange((value) => { this.authorRules.etAlMin = Number(value) || 0; this.refreshPreview(); });
      text.inputEl.type = "number";
    }));
    ruleSetting("省略时保留人数", (setting) => setting.addText((text) => {
      text.setValue(String(this.authorRules.etAlShow || ""))
        .onChange((value) => { this.authorRules.etAlShow = Number(value) || 1; this.refreshPreview(); });
      text.inputEl.type = "number";
    }));

    contentEl.createEl("h3", { text: "预览" });
    this.previewEl = contentEl.createDiv({ cls: "paperlib-citation-live-preview" });
    this.statusEl = contentEl.createDiv({ cls: "paperlib-citation-style-status" });

    const buttons = contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-cta", text: "保存样式" }).addEventListener("click", async () => {
      if (!this.label) return new Notice("请填写样式名称");
      const problems = validateCitationTemplate(this.template);
      if (problems.length) return new Notice(`模板有问题：${problems.join("；")}`);
      await this.plugin.saveCustomCitationStyle({
        id: this.style?.id || `custom-${uniqueId()}`,
        label: this.label,
        template: this.template,
        authors: { ...this.authorRules },
        source: this.style?.source || "custom",
        cslId: this.style?.cslId || ""
      });
      new Notice(`已保存引用样式：${this.label}`);
      this.onDone?.();
      this.close();
    });
    this.refreshPreview();
  }

  onClose() { this.contentEl.empty(); }
}

export {
  CitationStyleModal,
  CslImportModal
};
