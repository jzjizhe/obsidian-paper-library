/* 论文元数据编辑弹窗：论文表单（添加/编辑共用）、标签编辑。 */

import { Modal, Notice, Setting, normalizePath } from "obsidian";
import { setPaperlibIcon } from "../ui-utils.js";
import { normalizeDoiInput, normalizePaperTag, normalizePaperTags, uniqueId } from "../paper-utils.js";
import { expandCollectionPaths, normalizeCollectionPath } from "../collection-utils.js";
import { normalizeTitleForMatch } from "../metadata-match.js";

class PaperFormModal extends Modal {
  constructor(app, plugin, paper = null, draft = null) {
    super(app);
    this.plugin = plugin;
    this.paper = paper;
    this.draft = draft;
    this.inputs = {};
    this.pendingPdf = draft?.pendingPdf || null;
    this.autoOrganizePdf = Boolean(draft?.autoOrganizePdf);
    const source = paper || draft || {};
    this.lookupMetadata = {
      semanticScholarPaperId: source.semanticScholarPaperId || "",
      serpApiResultId: source.serpApiResultId || "",
      serpApiCitesId: source.serpApiCitesId || "",
      serpApiCitationCount: Number.isFinite(source.serpApiCitationCount) ? source.serpApiCitationCount : null,
      serpApiSourceUrl: source.serpApiSourceUrl || "",
      originalPdfName: source.originalPdfName || draft?.pendingPdf?.name || ""
    };
    this.values = {
      title: source.title || "",
      authors: Array.isArray(source.authors) ? source.authors.join("; ") : String(source.authors || ""),
      year: source.year ? String(source.year) : "",
      venue: source.venue || "",
      volume: source.volume || "",
      issue: source.issue || "",
      pages: source.pages || "",
      journalAbbreviation: source.journalAbbreviation || "",
      venueRanks: plugin.formatVenueRanksInput(source.venueRanks),
      abstract: source.abstract || "",
      tags: Array.isArray(source.tags) ? source.tags.join(", ") : String(source.tags || ""),
      collections: Array.isArray(source.collections) ? source.collections.join(", ") : String(source.collections || ""),
      doi: source.doi || "",
      arxiv: source.arxiv || "",
      pdfPath: source.pdfPath || "",
      notePath: source.notePath || ""
    };
    this.initialPdfPath = normalizePath(this.values.pdfPath || "");
    this.initialNotePath = normalizePath(this.values.notePath || "");
    this.initialIdentity = {
      title: normalizeTitleForMatch(this.values.title),
      doi: normalizeDoiInput(this.values.doi)
    };
  }

  field(content, label, key, placeholder = "", area = false) {
    new Setting(content)
      .setName(label)
      .addText((text) => {
        this.inputs[key] = text;
        text.setValue(this.values[key]).setPlaceholder(placeholder);
        if (area) text.inputEl.addClass("paperlib-long-input");
        text.onChange((value) => { this.values[key] = value; });
      });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("paperlib-modal");
    contentEl.createEl("h2", { text: this.paper ? "Edit paper" : this.draft ? "确认识别结果" : "Add a paper" });
    this.matchStatus = contentEl.createEl("p", {
      cls: "paperlib-modal-intro",
      text: this.draft
        ? "已从当前 PDF 自动识别并填入信息。确认后才会把文件保存到 Vault。"
        : "填写基础元数据；作者用分号分隔，标签和分类用逗号分隔。"
    });
    this.field(contentEl, "Title", "title");
    this.field(contentEl, "Authors", "authors");
    this.field(contentEl, "Year", "year");
    this.field(contentEl, "Venue", "venue");
    this.field(contentEl, "Volume", "volume", "卷，例如 384");
    this.field(contentEl, "Issue", "issue", "期，例如 7");
    this.field(contentEl, "Pages", "pages", "页码，例如 610-618");
    this.field(contentEl, "Journal abbreviation", "journalAbbreviation", "期刊缩写，例如 N Engl J Med");
    this.field(contentEl, "Venue rankings", "venueRanks", "例如：CCF:A；JCR:Q1；中科院:1区");
    this.field(contentEl, "Abstract", "abstract", "", true);
    this.field(contentEl, "Tags", "tags");
    this.field(contentEl, "Collections", "collections");
    this.field(contentEl, "DOI", "doi");
    this.field(contentEl, "arXiv", "arxiv");
    this.field(contentEl, "PDF path / URL", "pdfPath");
    this.field(contentEl, "Note path", "notePath");

    const buttons = contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    if (this.draft) {
      this.rematchButton = buttons.createEl("button", { cls: "paperlib-rematch-button" });
      setPaperlibIcon(this.rematchButton.createSpan(), "refresh-cw");
      this.rematchButton.createSpan({ text: "重新匹配信息" });
      this.rematchButton.addEventListener("click", () => this.rematchMetadata());
    }
    this.saveButton = buttons.createEl("button", { cls: "mod-cta", text: this.paper ? "Save changes" : "Add paper" });
    this.saveButton.addEventListener("click", () => this.submit());
  }

  async rematchMetadata() {
    if (this.rematching) return;
    const title = this.values.title.trim();
    const doi = normalizeDoiInput(this.values.doi);
    if (!title && !doi) return new Notice("请先填写论文标题或 DOI");
    this.rematching = true;
    this.rematchButton.disabled = true;
    this.saveButton.disabled = true;
    this.rematchButton.empty();
    setPaperlibIcon(this.rematchButton.createSpan(), "loader-circle");
    this.rematchButton.createSpan({ text: "正在匹配…" });
    try {
      const current = {
        title,
        authors: this.values.authors.split(";").map((value) => value.trim()).filter(Boolean),
        year: Number.parseInt(this.values.year, 10) || 0,
        venue: this.values.venue.trim(),
        venueRanks: this.plugin.parseVenueRanksInput(this.values.venueRanks),
        abstract: this.values.abstract.trim(),
        tags: normalizePaperTags(this.values.tags.split(",")),
        doi,
        arxiv: this.values.arxiv.trim(),
        matchBy: normalizeTitleForMatch(title) !== this.initialIdentity.title
          && doi === this.initialIdentity.doi ? "title" : "auto"
      };
      const remote = await this.plugin.rematchPaperMetadata(current);
      if (!remote) {
        this.matchStatus.setText("没有找到足够匹配的记录。请检查标题或 DOI 后重试。");
        return new Notice("没有匹配到论文信息");
      }
      const merged = this.plugin.mergePaperMetadata(current, remote);
      Object.assign(this.lookupMetadata, {
        semanticScholarPaperId: merged.semanticScholarPaperId || "",
        serpApiResultId: merged.serpApiResultId || "",
        serpApiCitesId: merged.serpApiCitesId || "",
        serpApiCitationCount: Number.isFinite(merged.serpApiCitationCount) ? merged.serpApiCitationCount : null,
        serpApiSourceUrl: merged.serpApiSourceUrl || ""
      });
      Object.assign(this.values, {
        title: merged.title || this.values.title,
        authors: (merged.authors || []).join("; "),
        year: String(merged.year || this.values.year),
        venue: merged.venue || this.values.venue,
        volume: merged.volume || this.values.volume,
        issue: merged.issue || this.values.issue,
        pages: merged.pages || this.values.pages,
        journalAbbreviation: merged.journalAbbreviation || this.values.journalAbbreviation,
        abstract: merged.abstract || this.values.abstract,
        tags: (merged.tags || []).join(", "),
        doi: normalizeDoiInput(merged.doi),
        arxiv: merged.arxiv || this.values.arxiv
      });
      ["title", "authors", "year", "venue", "volume", "issue", "pages", "journalAbbreviation", "abstract", "tags", "doi", "arxiv"].forEach((key) => {
        this.inputs[key]?.setValue(this.values[key]);
      });
      this.initialIdentity = {
        title: normalizeTitleForMatch(this.values.title),
        doi: normalizeDoiInput(this.values.doi)
      };
      this.matchStatus.setText("已完成重新匹配。请检查结果后再添加。");
      new Notice("论文信息已重新匹配");
    } catch (error) {
      console.error("Paper Library: metadata rematch failed", error);
      this.matchStatus.setText(`重新匹配失败：${error?.message || "网络请求错误"}`);
      new Notice("重新匹配失败，请稍后重试");
    } finally {
      this.rematching = false;
      this.rematchButton.disabled = false;
      this.saveButton.disabled = false;
      this.rematchButton.empty();
      setPaperlibIcon(this.rematchButton.createSpan(), "refresh-cw");
      this.rematchButton.createSpan({ text: "重新匹配信息" });
    }
  }

  async submit() {
    if (!this.values.title.trim()) return new Notice("Title is required");
    if (this.rematching) return new Notice("请等待重新匹配完成");
    if (this.submitting) return;
    this.submitting = true;
    const payload = {
      title: this.values.title.trim(),
      authors: this.values.authors.split(";").map((item) => item.trim()).filter(Boolean),
      year: Number.parseInt(this.values.year, 10) || 0,
      venue: this.values.venue.trim(),
      volume: this.values.volume.trim(),
      issue: this.values.issue.trim(),
      pages: this.values.pages.trim(),
      journalAbbreviation: this.values.journalAbbreviation.trim(),
      venueRanks: this.plugin.parseVenueRanksInput(this.values.venueRanks),
      abstract: this.values.abstract.trim(),
      tags: normalizePaperTags(this.values.tags.split(",")),
      collections: [...new Set(this.values.collections.split(",").map(normalizeCollectionPath).filter(Boolean))],
      doi: normalizeDoiInput(this.values.doi),
      arxiv: this.values.arxiv.trim(),
      pdfPath: this.values.pdfPath.trim(),
      notePath: this.values.notePath.trim(),
      ...this.lookupMetadata
    };
    const importedPdf = Boolean(this.pendingPdf);
    if (this.pendingPdf) {
      try {
        const pdfPathWasNotEdited = normalizePath(payload.pdfPath || "") === this.initialPdfPath;
        const notePathWasNotEdited = normalizePath(payload.notePath || "") === this.initialNotePath;
        if (this.autoOrganizePdf && pdfPathWasNotEdited) {
          const paths = this.plugin.getAvailableOrganizedPaperPaths(payload);
          payload.pdfPath = await this.plugin.saveDroppedPdf(this.pendingPdf, paths.pdfPath);
          if (notePathWasNotEdited) payload.notePath = paths.notePath;
        } else {
          payload.pdfPath = await this.plugin.saveDroppedPdf(this.pendingPdf, payload.pdfPath);
        }
        this.pendingPdf = null;
      } catch (error) {
        this.submitting = false;
        console.error("Paper Library: failed to save dropped PDF", error);
        return new Notice(`PDF 保存失败：${error.message || error}`);
      }
    }
    let savedPaper = this.paper;
    if (this.paper) {
      const identityChanged = this.paper.doi !== payload.doi || this.paper.title !== payload.title;
      Object.assign(this.paper, payload);
      if (identityChanged) delete this.paper.metrics;
      try {
        await this.plugin.organizePaperFiles(this.paper);
      } catch (error) {
        console.error("Paper Library: failed to reorganize edited paper", error);
        new Notice(`论文信息已保存，但文件整理失败：${error.message || error}`);
      }
    } else {
      savedPaper = {
        id: uniqueId(), ...payload, starred: false, flagged: false, rating: 0,
        attachments: [], addedAt: new Date().toISOString(), lastOpened: ""
      };
      this.plugin.settings.papers.unshift(savedPaper);
    }
    try { await this.plugin.enrichPaperVenueRanks(savedPaper); }
    catch (error) { console.warn("Paper Library: venue rank lookup unavailable", error); }
    this.plugin.settings.collections = expandCollectionPaths([
      ...(this.plugin.settings.collections || []),
      ...payload.collections
    ]);
    payload.tags.forEach((tag) => {
      if (!this.plugin.settings.tags.includes(tag)) this.plugin.settings.tags.push(tag);
    });
    if (savedPaper?.notePath) await this.plugin.syncPaperNoteTags(savedPaper);
    await this.plugin.saveSettings();
    if (importedPdf && savedPaper) await this.plugin.ensurePaperNote(savedPaper);
    this.plugin.refreshViews();
    new Notice(this.paper ? "Paper updated" : "Paper added");
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class AddPaperModal extends PaperFormModal {}

class TagModal extends Modal {
  constructor(app, plugin, oldName = "") {
    super(app);
    this.plugin = plugin;
    this.oldName = oldName;
    this.name = oldName;
  }

  onOpen() {
    this.contentEl.createEl("h2", { text: this.oldName ? "重命名标签" : "新建标签" });
    new Setting(this.contentEl)
      .setName("标签名称")
      .addText((text) => {
        text.setValue(this.name).setPlaceholder("例如：diffusion");
        text.onChange((value) => { this.name = value.trim(); });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    const buttons = this.contentEl.createDiv({ cls: "paperlib-modal-buttons" });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { cls: "mod-cta", text: this.oldName ? "保存" : "创建" }).addEventListener("click", () => this.submit());
  }

  async submit() {
    if (!this.name) return new Notice("标签名称不能为空");
    const normalizedName = normalizePaperTag(this.name);
    if (!normalizedName) return new Notice("标签必须包含文字，并且不能只包含数字");
    this.name = normalizedName;
    const duplicate = this.plugin.getAllTags().find((tag) => tag.toLocaleLowerCase() === this.name.toLocaleLowerCase());
    if (duplicate && duplicate !== this.oldName) return new Notice("这个标签已经存在");
    if (this.oldName) await this.plugin.renameTag(this.oldName, this.name);
    else {
      this.plugin.settings.tags.push(this.name);
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
      new Notice(`已创建标签：${this.name}`);
    }
    this.close();
  }
}

export {
  AddPaperModal,
  PaperFormModal,
  TagModal
};
