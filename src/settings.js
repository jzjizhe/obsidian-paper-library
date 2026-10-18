/* 设置页：Paper Library 的全部设置 UI（外观、引用样式、图片识别、本地管线等）。
   依赖 Obsidian 设置 API 与各工具/弹窗模块。 */

import { Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { CANVAS_HIGHLIGHT_COLORS, DEFAULT_SETTINGS } from "./constants.js";
import { normalizeCustomAppearanceId } from "./appearance.js";
import { formatAIFileSize } from "./text-utils.js";
import { CitationStyleModal, CslImportModal } from "./modals/citation.js";
import { DeleteFigureRecognitionRuntimeModal, DeleteLocalPipelineModal } from "./modals/delete.js";
import { EnableFigureRecognitionModal, InstallLocalPipelineModal } from "./modals/pipeline.js";

class PaperLibrarySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.composerSettingsExpanded = false;
    this.composerSettingsDetails = null;
    this.composerSettingsHost = null;
    this.composerSettingsObserver = null;
    this.updateBusy = false;
    this.updateInfo = null;
    this.updateMessage = "";
  }

  normalizeEmbeddedComposerSurface(root) {
    if (!root || typeof document === "undefined") return;
    // Paper Composer is the only user-facing surface. The embedded runtime's
    // optional collaboration tab is intentionally not exposed by Paper Library.
    root.querySelectorAll?.(".paper-composer-settings-tab, button[role='tab']").forEach((element) => {
      if (/^(collab|collaboration|协作)$/i.test(String(element.textContent || "").trim())) element.remove();
    });
    const refresh = root.querySelector?.(
      ".paper-composer-provider-model-picker--codex .paper-composer-provider-model-picker-action"
    );
    if (refresh && !refresh.paperLibraryModelRefreshBound) {
      refresh.paperLibraryModelRefreshBound = true;
      refresh.addEventListener("click", () => this.syncRefreshedComposerModels(refresh));
    }
  }

  async syncRefreshedComposerModels(button) {
    const runtime = this.plugin.claudianRuntime;
    if (!runtime?.settings || !button) return;
    const before = Number(runtime.settings.providerConfigs?.codex?.catalogTimestamp) || 0;
    const deadline = Date.now() + 30000;
    while (button.isConnected && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      const codex = runtime.settings.providerConfigs?.codex;
      const finished = (Number(codex?.catalogTimestamp) || 0) !== before
        || (!button.disabled && !/loading/i.test(String(button.textContent || "")));
      if (!finished) continue;
      const models = [...new Set((codex?.discoveredModels || [])
        .map((entry) => String(entry?.model || "").trim()).filter(Boolean))];
      if (!models.length || (Array.isArray(codex.visibleModels)
        && models.length === codex.visibleModels.length
        && models.every((model, index) => model === codex.visibleModels[index]))) return;
      await runtime.mutateSettings((settings) => {
        const config = settings.providerConfigs?.codex;
        if (config) config.visibleModels = models;
      });
      await runtime.notifyProviderChatOptionsChanged?.("codex");
      if (this.composerSettingsHost?.isConnected) await this.renderEmbeddedComposerSettings();
      return;
    }
  }

  async renderEmbeddedComposerSettings() {
    const host = this.composerSettingsHost;
    if (!host) return;
    this.composerSettingsObserver?.disconnect?.();
    this.composerSettingsObserver = null;
    host.empty();
    const settingTab = this.plugin.claudianSettingTab;
    if (!settingTab || typeof settingTab.renderSettings !== "function") {
      host.createEl("p", {
        cls: "paperlib-composer-settings-unavailable",
        text: this.plugin.claudianLoadError
          ? `完整 AI 设置暂时不可用：${this.plugin.claudianLoadError?.message || this.plugin.claudianLoadError}`
          : "完整 AI 运行时仍在载入，请稍后重新展开。"
      });
      return;
    }
    try {
      await Promise.resolve(settingTab.renderSettings(host));
      this.normalizeEmbeddedComposerSurface(host);
      if (typeof MutationObserver !== "undefined") {
        this.composerSettingsObserver = new MutationObserver(() => this.normalizeEmbeddedComposerSurface(host));
        this.composerSettingsObserver.observe(host, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["placeholder", "aria-label", "title"]
        });
      }
    } catch (error) {
      console.error("Paper Library: embedded Composer settings failed to render", error);
      host.empty();
      host.createEl("p", {
        cls: "paperlib-composer-settings-unavailable",
        text: `完整 AI 设置无法显示：${error?.message || error}`
      });
    }
  }

  openEmbeddedComposerSettings() {
    this.composerSettingsExpanded = true;
    if (!this.composerSettingsDetails) return;
    this.composerSettingsDetails.open = true;
    void this.renderEmbeddedComposerSettings();
    window.setTimeout(() => {
      this.composerSettingsDetails?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 40);
  }

  renderPaperComposerCliSettings(container) {
    const runtime = this.plugin.claudianRuntime;
    if (!runtime?.settings) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: "CLI 提供商将在 Paper Composer 运行时加载完成后显示。"
      });
      return;
    }
    const selectedProvider = this.plugin.getPaperComposerSettingsProvider();
    new Setting(container)
      .setName("默认对话提供商")
      .setDesc("选择新对话使用的账号与 CLI。各 Provider 设置页中的可见模型会同步到对话框模型菜单。")
      .addDropdown((dropdown) => dropdown
        .addOption("codex", "ChatGPT · Codex CLI")
        .addOption("claude", "Claude · Claude Code CLI")
        .addOption("kimi", "Kimi · Kimi Code CLI")
        .setValue(selectedProvider)
        .onChange(async (value) => {
          await this.plugin.selectPaperComposerSettingsProvider(value);
          this.display();
        }));
  }

  renderPluginUpdateSettings(containerEl) {
    containerEl.createEl("h3", { text: "插件更新" });
    const currentVersion = this.plugin.manifest?.version || "未知";
    const description = this.plugin.isMobileApp()
      ? `当前版本 ${currentVersion} · 自动更新仅支持桌面端。`
      : this.updateMessage || `当前版本 ${currentVersion} · 更新时保留设置、论文数据、本地模型与缓存。`;
    const setting = new Setting(containerEl)
      .setName("检查 Paper Library 更新")
      .setDesc(description)
      .addButton((button) => {
        button.buttonEl.addClass("paperlib-update-button");
        button
          .setButtonText(this.updateBusy ? "检查中…" : "检查更新")
          .setDisabled(this.updateBusy || this.plugin.isMobileApp())
          .onClick(async () => {
            if (this.updateBusy) return;
            this.updateBusy = true;
            this.updateMessage = "正在检查 GitHub Release…";
            this.display();
            try {
              this.updateInfo = await this.plugin.checkForPaperLibraryUpdate();
              this.updateMessage = this.updateInfo.available
                ? `发现 ${this.updateInfo.version}，可以直接下载并安装。`
                : `当前已是最新版本 ${currentVersion}。`;
            } catch (error) {
              this.updateInfo = null;
              this.updateMessage = `检查失败：${error?.message || error}`;
            } finally {
              this.updateBusy = false;
              this.display();
            }
          });
      });
    if (this.updateInfo?.available && !this.plugin.isMobileApp()) {
      setting.addButton((button) => {
        button.buttonEl.addClass("paperlib-update-button");
        button.buttonEl.addClass("is-primary");
        button
          .setButtonText(this.updateBusy ? "更新中…" : `更新到 ${this.updateInfo.version}`)
          .setDisabled(this.updateBusy)
          .onClick(async () => {
            if (this.updateBusy) return;
            this.updateBusy = true;
            this.updateMessage = `正在下载 ${this.updateInfo.version}…`;
            this.display();
            try {
              await this.plugin.installPaperLibraryUpdate(this.updateInfo, (message) => {
                this.updateMessage = message;
                this.display();
              });
            } catch (error) {
              this.updateBusy = false;
              this.updateMessage = `更新失败，原版本已保留：${error?.message || error}`;
              this.display();
            }
          });
      });
    }
  }

  display() {
    this.composerSettingsObserver?.disconnect?.();
    this.composerSettingsObserver = null;
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("paperlib-settings");
    containerEl.createEl("h2", { text: "Paper Library" });
    this.renderPluginUpdateSettings(containerEl);
    containerEl.createEl("h3", { text: "外观" });
    const customProfiles = this.plugin.getCustomAppearanceProfiles();
    new Setting(containerEl)
      .setName(`当前${this.plugin.isMobileApp() ? "移动端" : "桌面端"}外观`)
      .setDesc("外观会同时作用于左侧导航、论文主页和右侧详情。选择保存在当前设备，不经 Obsidian Sync 同步到另一端。")
      .addDropdown((dropdown) => {
        dropdown.addOption("standard", "标准视图");
        dropdown.addOption("gallery", "画廊视图");
        dropdown.addOption("paperglass", "纸境视图");
        customProfiles.forEach((profile) => dropdown.addOption(`custom:${profile.id}`, `我的外观 / ${profile.name}`));
        dropdown.setValue(this.plugin.getLibraryAppearanceSelectionId());
        dropdown.onChange(async (value) => {
          await this.plugin.setLibraryAppearance(value);
          this.display();
        });
      });
    new Setting(containerEl)
      .setName("当前设备强调色")
      .setDesc("控制选中状态、链接、图标和所有外观的主色；仅保存在当前设备，不影响另一端或 Obsidian 主题。")
      .addColorPicker((picker) => picker
        .setValue(this.plugin.getLibraryAccentColor())
        .onChange(async (value) => {
          await this.plugin.setLibraryAccentColor(value);
        }))
      .addButton((button) => button
        .setButtonText("恢复默认")
        .onClick(async () => {
          await this.plugin.setLibraryAccentColor(DEFAULT_SETTINGS.globalAccentColor);
          this.display();
        }));

    const editorCandidate = normalizeCustomAppearanceId(this.plugin.settings.appearanceEditorProfileId, this.plugin.getActiveCustomAppearanceId());
    const editorProfile = customProfiles.find((profile) => profile.id === editorCandidate) || customProfiles[0];
    this.plugin.settings.appearanceEditorProfileId = editorProfile.id;
    const customAppearanceDetails = containerEl.createEl("details", { cls: "paperlib-appearance-editor" });
    customAppearanceDetails.createEl("summary", { text: "管理我的外观" });
    customAppearanceDetails.createEl("p", {
      cls: "setting-item-description",
      text: "“我的外观”可继承标准、画廊、纸境或蓝图方案，再用 CSS 改写组件尺寸、排列、层级、动效和材质。"
    });
    new Setting(customAppearanceDetails)
      .setName("编辑外观")
      .setDesc("每个外观独立保存名称、基础方案与 CSS。蓝图是预置的“我的外观”之一。")
      .addDropdown((dropdown) => {
        customProfiles.forEach((profile) => dropdown.addOption(profile.id, profile.name));
        dropdown.setValue(editorProfile.id).onChange(async (value) => {
          this.plugin.settings.appearanceEditorProfileId = value;
          await this.plugin.saveSettings();
          this.display();
        });
      })
      .addButton((button) => button.setButtonText("新建").onClick(async () => {
        await this.plugin.createCustomAppearanceProfile();
        this.display();
      }))
      .addButton((button) => {
        button.setButtonText("删除").setDisabled(Boolean(editorProfile.builtin)).onClick(async () => {
          await this.plugin.deleteCustomAppearanceProfile(editorProfile.id);
          this.display();
        });
      });
    new Setting(customAppearanceDetails)
      .setName("外观名称")
      .addText((text) => {
        text.setPlaceholder("我的外观").setValue(editorProfile.name).setDisabled(Boolean(editorProfile.builtin));
        text.onChange(async (value) => this.plugin.updateCustomAppearanceProfile(editorProfile.id, { name: value }));
      });
    new Setting(customAppearanceDetails)
      .setName("基础布局")
      .setDesc("继承一个稳定骨架，然后只覆盖需要改变的部分。")
      .addDropdown((dropdown) => dropdown
        .addOption("standard", "标准视图")
        .addOption("gallery", "画廊视图")
        .addOption("paperglass", "纸境视图")
        .addOption("blueprint", "蓝图方案")
        .setValue(editorProfile.base)
        .setDisabled(Boolean(editorProfile.builtin))
        .onChange(async (value) => this.plugin.updateCustomAppearanceProfile(editorProfile.id, { base: value })));
    const cssSetting = new Setting(customAppearanceDetails)
      .setName("外观 CSS")
      .setDesc("CSS 会被限制在 Paper Library 的自定义外观根节点内。可使用 --paperlib-global-accent 等协议变量。完整接口见插件目录 APPEARANCE_API.md。")
      .addTextArea((area) => {
        area.setPlaceholder(`.paperlib-main {\n  /* 可以重排整个主页，而不只是换色 */\n}\n\n.paperlib-sidebar {\n  /* 左侧栏布局 */\n}`);
        area.setValue(editorProfile.css || "");
        area.onChange(async (value) => {
          await this.plugin.updateCustomAppearanceProfile(editorProfile.id, { css: value });
        });
        area.inputEl.rows = 12;
      });
    cssSetting.settingEl.addClass("paperlib-custom-appearance-css-setting");

    containerEl.createEl("h3", { text: "文献库" });
    new Setting(containerEl)
      .setName("文献库目录")
      .setDesc("PDF 与笔记按“首个 Collection / 年份 / 论文标题”整理到此目录；未分类论文进入 Uncategorized。")
      .addText((text) => text
        .setPlaceholder("Papers")
        .setValue(this.plugin.settings.libraryFolder || "Papers")
        .onChange(async (value) => {
          this.plugin.settings.libraryFolder = value.trim() || "Papers";
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button
        .setButtonText("整理现有文件")
        .onClick(() => this.plugin.organizeLibraryFiles(true)));

    containerEl.createEl("h3", { text: "浏览器扩展" });
    const extensionToggle = new Setting(containerEl)
      .setName("启用浏览器扩展服务")
      .setDesc("在 127.0.0.1 上开启一个仅本机可访问的接收服务，配套浏览器扩展可将论文页面 / PDF 一键导入库中。仅桌面端可用。")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings.extensionServerEnabled))
        .onChange(async (value) => {
          this.plugin.settings.extensionServerEnabled = value;
          await this.plugin.saveSettings();
          if (value) {
            await this.plugin.ensureExtensionToken();
            try { this.plugin.startExtensionServer(); }
            catch (error) { console.warn("Paper Library: extension server unavailable", error); }
          } else {
            this.plugin.stopExtensionServer();
          }
          this.display();
        }));
    if (this.plugin.isMobileApp()) extensionToggle.setDisabled(true);
    if (this.plugin.settings.extensionServerEnabled && !this.plugin.isMobileApp()) {
      new Setting(containerEl)
        .setName("端口")
        .setDesc("浏览器扩展连接的本机端口，修改后即时生效。")
        .addText((text) => text
          .setPlaceholder("23987")
          .setValue(String(this.plugin.settings.extensionServerPort || 23987))
          .onChange(async (value) => {
            const port = Math.floor(Number(value));
            if (!Number.isFinite(port) || port < 1024 || port > 65535) return;
            this.plugin.settings.extensionServerPort = port;
            await this.plugin.saveSettings();
            this.plugin.stopExtensionServer();
            try { this.plugin.startExtensionServer(); }
            catch (error) { console.warn("Paper Library: extension server unavailable", error); }
          }));
      new Setting(containerEl)
        .setName("访问令牌（Token）")
        .setDesc("粘贴到浏览器扩展的设置中。令牌仅保存在当前 Vault，用于阻止其他网页冒用导入接口。")
        .addText((text) => {
          text.setValue(this.plugin.settings.extensionToken || "");
          text.inputEl.type = "password";
          text.setDisabled(true);
        })
        .addButton((button) => button
          .setButtonText("复制")
          .onClick(async () => {
            const token = await this.plugin.ensureExtensionToken();
            await navigator.clipboard.writeText(token);
            new Notice("Token 已复制，请粘贴到浏览器扩展设置中");
            this.display();
          }))
        .addButton((button) => button
          .setButtonText("重新生成")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.extensionToken = "";
            await this.plugin.ensureExtensionToken();
            new Notice("已生成新 Token，请同步更新浏览器扩展");
            this.display();
          }));
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: "扩展安装：打开浏览器 chrome://extensions（或 edge://extensions），开启“开发者模式”，选择“加载已解压的扩展程序”，选中插件目录下的 browser-extension 文件夹，然后在扩展弹窗中粘贴上方 Token。"
      });
    }

    containerEl.createEl("h3", { text: "引用样式" });
    new Setting(containerEl)
      .setName("添加引用样式")
      .setDesc("自定义模板（占位符 + 符号自由组合），或从 CSL 样式库（10,000+ 期刊模板，Scholar Sidekick 在线 API 同款来源）导入。")
      .addButton((button) => button
        .setButtonText("新建自定义样式")
        .onClick(() => new CitationStyleModal(this.app, this.plugin, null, () => this.display()).open()))
      .addButton((button) => button
        .setButtonText("导入 CSL 样式")
        .onClick(() => new CslImportModal(this.app, this.plugin, () => this.display()).open()));
    (this.plugin.settings.customCitationStyles || []).forEach((style) => {
      new Setting(containerEl)
        .setName(style.label)
        .setDesc(style.source === "csl" ? `从 CSL 样式库导入（${style.cslId}）` : "自定义模板")
        .addButton((button) => button
          .setButtonText("编辑")
          .onClick(() => new CitationStyleModal(this.app, this.plugin, style, () => this.display()).open()))
        .addButton((button) => button
          .setButtonText("删除")
          .setWarning()
          .onClick(async () => {
            await this.plugin.deleteCustomCitationStyle(style.id);
            this.display();
          }));
    });
    containerEl.createEl("h3", { text: "Paper Composer" });
    const composerCard = containerEl.createDiv({ cls: "paperlib-composer-launch-card" });
    const composerCardTop = composerCard.createDiv({ cls: "paperlib-composer-launch-card__top" });
    const composerCardCopy = composerCardTop.createDiv();
    composerCardCopy.createEl("strong", { text: "Paper Library 内置的完整智能写作侧栏" });
    composerCardCopy.createEl("p", {
      text: "包含多标签会话、会话历史、Inline Edit、Plan Mode、Skills、MCP、Vault 文件代理、模型管理与 Claude Code / Codex 账号能力。"
    });
    const composerState = this.plugin.claudianRuntime
      ? { cls: "is-ready", label: "Ready" }
      : this.plugin.claudianLoadError
        ? { cls: "is-error", label: "Unavailable" }
        : this.plugin.isMobileApp()
          ? { cls: "is-desktop", label: "Desktop" }
          : { cls: "is-loading", label: "Loading" };
    composerCardTop.createSpan({
      cls: `paperlib-composer-status ${composerState.cls}`,
      text: composerState.label,
      attr: this.plugin.claudianLoadError
        ? { title: String(this.plugin.claudianLoadError?.message || this.plugin.claudianLoadError) }
        : undefined
    });
    const composerActions = composerCard.createDiv({ cls: "paperlib-composer-launch-card__actions" });
    const openComposerButton = composerActions.createEl("button", {
      cls: "paperlib-composer-action is-primary"
    });
    setIcon(openComposerButton, "wand-sparkles");
    openComposerButton.createSpan({ text: "打开 Paper Composer" });
    openComposerButton.addEventListener("click", () => this.plugin.openSmartComposer());
    const composerSettingsButton = composerActions.createEl("button", {
      cls: "paperlib-composer-action is-secondary"
    });
    setIcon(composerSettingsButton, "sliders-horizontal");
    composerSettingsButton.createSpan({ text: "模型与账号" });
    composerSettingsButton.addEventListener("click", () => this.openEmbeddedComposerSettings());
    composerCard.createEl("p", {
      cls: "paperlib-composer-oauth-warning",
      text: "账号连接由各 Provider 的本机 CLI 管理，Paper Library 不保存第三方 OAuth 令牌。启用状态、模型、路径与环境变量统一在下方 Provider 设置中管理。完整代理仅支持桌面端与 Obsidian 1.13+。"
    });
    const composerCliSettings = composerCard.createDiv({ cls: "paperlib-composer-cli-settings" });
    this.renderPaperComposerCliSettings(composerCliSettings);
    const composerSettingsDetails = composerCard.createEl("details", {
      cls: "paperlib-composer-embedded-settings"
    });
    this.composerSettingsDetails = composerSettingsDetails;
    composerSettingsDetails.open = this.composerSettingsExpanded;
    const composerSettingsSummary = composerSettingsDetails.createEl("summary", {
      attr: { "aria-label": "Agent、模型与账号设置" }
    });
    setIcon(composerSettingsSummary, "settings-2");
    composerSettingsSummary.createSpan({ text: "Agent、模型与账号设置" });
    this.composerSettingsHost = composerSettingsDetails.createDiv({
      cls: "paperlib-composer-embedded-settings__host"
    });
    composerSettingsDetails.addEventListener("toggle", () => {
      this.composerSettingsExpanded = composerSettingsDetails.open;
      if (composerSettingsDetails.open) void this.renderEmbeddedComposerSettings();
    });
    if (composerSettingsDetails.open) void this.renderEmbeddedComposerSettings();

    containerEl.createEl("h3", { text: "Paper Composer · PDF" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "文档链路已经并入 Paper Composer：本地模式解析版面、文字、公式与表格并按问题检索全文；源文件模式把完整文档交给当前 Claude Code / Codex Agent。选区和圈选图片会自动关联完整文档。"
    });
    new Setting(containerEl)
      .setName("默认 PDF 处理模式")
      .setDesc("也可在 Paper Composer 输入框顶部随时切换；切换会作用于下一次发送。")
      .addDropdown((dropdown) => dropdown
        .addOption("local", "本地解析 + 全文检索")
        .addOption("direct", "源文件")
        .setValue(this.plugin.getPdfAiMode())
        .onChange(async (value) => {
          await this.plugin.setPdfAiMode(value);
          this.plugin.refreshComposerPdfTrays?.();
        }));
    const localPipelineStatus = this.plugin.getLocalPipelinePackStatus();
    const pipelineSetting = new Setting(containerEl)
      .setName("本地解析模型")
      .setDesc(localPipelineStatus.ready
        ? `已就绪 · ${process.platform}-${process.arch} · 模型 ${formatAIFileSize(localPipelineStatus.totalBytes || 0)}。`
        : `未安装完整：${formatAIFileSize(localPipelineStatus.installedBytes || 0)} / ${formatAIFileSize(localPipelineStatus.totalBytes || 0)}。未就绪时自动发送完整原文件。`)
      .addButton((button) => button
        .setClass("paperlib-mineru-setting-button")
        .setButtonText(localPipelineStatus.ready ? "校验/更新" : "下载安装")
        .onClick(() => new InstallLocalPipelineModal(this.app, this.plugin, () => this.display()).open()));
    if (localPipelineStatus.ready || localPipelineStatus.installedBytes > 0 || localPipelineStatus.marker) {
      pipelineSetting.addExtraButton((button) => button
        .setIcon("trash-2")
        .setTooltip("删除本地解析模型、运行时与缓存")
        .onClick(() => new DeleteLocalPipelineModal(this.app, this.plugin, () => this.display()).open()));
    }
    new Setting(containerEl)
      .setName("打开 Paper Composer")
      .setDesc("使用同一个侧栏完成对话、PDF 拖放、全文联动和圈选 Ask AI。")
      .addButton((button) => button.setButtonText("打开").setCta().onClick(() => this.plugin.openSmartComposer()));

    containerEl.createEl("h3", { text: "在线数据源" });
    new Setting(containerEl)
      .setName("在线补全论文信息")
      .setDesc("利用本地从 PDF 提取的 DOI、arXiv 编号和标题，联网查询 Crossref 或 arXiv 补全元数据。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.onlineMetadataLookup)
        .onChange(async (value) => {
          this.plugin.settings.onlineMetadataLookup = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Google Scholar 数据源")
      .setDesc("网页解析免费但可能被 Google 限流；SerpApi 返回结构化结果，匹配更稳定。")
      .addDropdown((dropdown) => dropdown
        .addOption("html", "Google Scholar 网页（免费）")
        .addOption("serpapi", "SerpApi（结构化，消耗额度）")
        .setValue(this.plugin.getGoogleScholarProvider())
        .onChange(async (value) => {
          this.plugin.settings.googleScholarProvider = value === "serpapi" ? "serpapi" : "html";
          await this.plugin.saveSettings();
          this.display();
        }));
    const serpApiSetting = new Setting(containerEl)
      .setName("SerpApi API key")
      .setDesc("仅保存在当前 Vault。免费方案每月 250 次成功查询；缓存、失败和额度检查不计次数。")
      .addText((text) => {
        text.setPlaceholder("SerpApi private API key");
        text.setValue(this.plugin.settings.serpApiKey || "");
        text.inputEl.type = "password";
        text.onChange(async (value) => {
          this.plugin.settings.serpApiKey = value.trim();
          this.plugin.serpApiAccountStatus = null;
          await this.plugin.saveSettings();
        });
      });
    serpApiSetting.addButton((button) => button
      .setButtonText("检查剩余额度")
      .onClick(async () => {
        if (!this.plugin.settings.serpApiKey?.trim()) return new Notice("请先填写 SerpApi API key");
        button.setDisabled(true).setButtonText("正在检查…");
        try {
          const account = await this.plugin.getSerpApiAccountStatus(true);
          if (!account) throw new Error("没有返回账户信息");
          const remaining = Number.isFinite(account.remaining) ? account.remaining : "—";
          const limit = Number.isFinite(account.limit) ? account.limit : "—";
          const used = Number.isFinite(account.used) ? account.used : "—";
          new Notice(`SerpApi 本周期已用 ${used}/${limit}，剩余 ${remaining} 次`);
        } catch (_) {
          new Notice("SerpApi 额度检查失败，请核对 API key 或网络连接");
        } finally {
          button.setDisabled(false).setButtonText("检查剩余额度");
        }
      }));
    new Setting(containerEl)
      .setName("允许 SerpApi 后台修复")
      .setDesc("关闭时，只有导入论文或手动刷新信息会使用 SerpApi；开启后也会在启动时逐步修复仍显示为 arXiv 的论文。")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings.serpApiBackgroundLookup))
        .onChange(async (value) => {
          this.plugin.settings.serpApiBackgroundLookup = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("论文信息与引用数据源")
      .setDesc("可使用默认聚合、Semantic Scholar 补全，或由 SerpApi 提供论文信息与引用次数（参考文献仍由 Semantic Scholar 提供）。")
      .addDropdown((dropdown) => dropdown
        .addOption("auto", "默认（Crossref → Google Scholar → DBLP → OpenAlex）")
        .addOption("semantic-scholar", "默认优先，Semantic Scholar 补全")
        .addOption("serpapi", "全部使用 SerpApi（参考文献使用 Semantic Scholar）")
        .setValue(["semantic-scholar", "serpapi"].includes(this.plugin.settings.metadataSource)
          ? this.plugin.settings.metadataSource
          : "auto")
        .onChange(async (value) => {
          this.plugin.settings.metadataSource = ["semantic-scholar", "serpapi"].includes(value) ? value : "auto";
          if (value === "serpapi") this.plugin.settings.googleScholarProvider = "serpapi";
          // A provider switch changes how the next refresh is performed. It must
          // never destroy metadata and relation pages that have already been
          // downloaded, especially because both remote APIs are rate limited.
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.display();
        }));
    new Setting(containerEl)
      .setName("Semantic Scholar API key（可选）")
      .setDesc("留空可匿名使用但有共享限流；免费 key 可在 semanticscholar.org/product/api 申请，可显著提高稳定性。")
      .addText((text) => {
        text.setPlaceholder("Semantic Scholar API key");
        text.setValue(this.plugin.settings.semanticScholarApiKey || "");
        text.inputEl.type = "password";
        text.onChange(async (value) => {
          this.plugin.settings.semanticScholarApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("OpenAlex API key（可选）")
      .setDesc("被引与参考文献列表可匿名试用；填写免费 key 可提高每日请求额度。可在 openalex.org/settings/api 创建。")
      .addText((text) => {
        text.setPlaceholder("OpenAlex API key");
        text.setValue(this.plugin.settings.openAlexApiKey || "");
        text.inputEl.type = "password";
        text.onChange(async (value) => {
          this.plugin.settings.openAlexApiKey = value.trim();
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        });
      });
    containerEl.createEl("h3", { text: "会议数据" });
    const rankingDatabaseUpdatedAt = Date.parse(this.plugin.settings.conferenceRankingDatabase?.updatedAt || "");
    const rankingDatabaseCount = (this.plugin.settings.conferenceRankingDatabase?.conferences || []).length;
    new Setting(containerEl)
      .setName("会议等级数据库")
      .setDesc(rankingDatabaseCount
        ? `已缓存 ${rankingDatabaseCount} 个会议的 CCF、CORE 与 TH-CPL 等级；${Number.isFinite(rankingDatabaseUpdatedAt) ? new Date(rankingDatabaseUpdatedAt).toLocaleString() : "未知时间"}更新。插件每 7 天自动同步。`
        : "尚未缓存。插件会从 CCFDDL 下载完整会议等级索引并每 7 天自动更新。")
      .addButton((button) => button
        .setButtonText("立即更新")
        .onClick(async () => {
          button.setDisabled(true);
          const notice = new Notice("正在更新完整会议等级数据库…", 0);
          try {
            const database = await this.plugin.syncConferenceRankingDatabase(true);
            await this.plugin.enrichExistingVenueRanks();
            notice.hide?.();
            new Notice(`会议等级数据库已更新：${database?.conferences?.length || 0} 个会议`);
            this.display();
          } catch (error) {
            notice.hide?.();
            new Notice(`会议等级数据库更新失败：${error.message || error}`);
          } finally {
            button.setDisabled(false);
          }
        }));
    const rateDatabaseUpdatedAt = Date.parse(this.plugin.settings.conferenceRateDatabase?.updatedAt || "");
    const rateDatabaseCount = Object.keys(this.plugin.settings.conferenceRateDatabase?.series || {}).length;
    new Setting(containerEl)
      .setName("会议录用率数据库")
      .setDesc(rateDatabaseCount
        ? `已缓存 ${rateDatabaseCount} 个会议；${Number.isFinite(rateDatabaseUpdatedAt) ? new Date(rateDatabaseUpdatedAt).toLocaleString() : "未知时间"}更新。插件每 7 天自动同步。`
        : "尚未缓存。插件会在线下载完整会议录用率数据库并每 7 天自动更新。")
      .addButton((button) => button
        .setButtonText("立即更新")
        .onClick(async () => {
          button.setDisabled(true);
          const notice = new Notice("正在更新会议录用率数据库…", 0);
          try {
            await this.plugin.syncConferenceRateDatabase(true);
            await this.plugin.enrichExistingVenueRanks();
            notice.hide?.();
            new Notice("会议录用率数据库已更新");
            this.display();
          } catch (error) {
            notice.hide?.();
            new Notice(`会议录用率数据库更新失败：${error.message || error}`);
          } finally {
            button.setDisabled(false);
          }
        }));
    containerEl.createEl("h3", { text: "PDF 与笔记" });
    const mobile = this.plugin.isMobileApp();
    const runtimeInstalled = !mobile && this.plugin.isDocLayoutRuntimeInstalled();
    const figureSetting = new Setting(containerEl)
      .setName("DocLayout-YOLO 图片识别")
      .setDesc(mobile
        ? "手机端不运行 Python/ONNX 模型；桌面端已经识别并同步的 PDF 图片仍可点击查看轮播图和全部缩略图。"
        : this.plugin.settings.enableFigureRecognition
        ? "已开启。PDF 全部载入后会显示逐页识别进度；模型与识别均留在本机。"
        : runtimeInstalled
          ? "已安装但未开启；点击开关即可使用，不会重复下载。"
          : "默认关闭。确认开启后才会下载约 240–300 MB 的 ONNX 运行时与模型，不安装 PyTorch。")
      .addToggle((toggle) => toggle
        .setValue(!mobile && Boolean(this.plugin.settings.enableFigureRecognition))
        .setDisabled(mobile)
        .onChange(async (value) => {
          if (mobile) return;
          if (!value) {
            this.plugin.settings.enableFigureRecognition = false;
            this.plugin.clearPdfFigureRecognitionState();
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
            this.display();
            return;
          }
          if (this.plugin.isDocLayoutRuntimeInstalled()) {
            this.plugin.settings.enableFigureRecognition = true;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
            this.display();
            return;
          }
          toggle.setValue(false);
          new EnableFigureRecognitionModal(this.app, this.plugin, () => this.display()).open();
        }));
    if (!mobile && this.plugin.hasDocLayoutRuntimeArtifacts()) {
      figureSetting.addButton((button) => button
        .setButtonText("释放空间")
        .setWarning()
        .onClick(() => new DeleteFigureRecognitionRuntimeModal(
          this.app,
          this.plugin,
          () => this.display()
        ).open()));
    }
    new Setting(containerEl)
      .setName("默认高亮颜色")
      .setDesc("长按拖出摘录、荧光笔与 PDF 选区弹条使用的初始颜色。")
      .addDropdown((dropdown) => {
        CANVAS_HIGHLIGHT_COLORS.forEach((color) => dropdown.addOption(color.id, color.label));
        const current = String(this.plugin.settings.defaultHighlightColor || "yellow").toLocaleLowerCase();
        dropdown
          .setValue(CANVAS_HIGHLIGHT_COLORS.some((color) => color.id === current) ? current : "yellow")
          .onChange(async (value) => {
            this.plugin.settings.defaultHighlightColor = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName("PDF 批注标题")
      .setDesc("PDF 高亮与注释会追加到论文笔记中此 Markdown 标题之下。")
      .addText((text) => text
        .setPlaceholder("PDF Annotations")
        .setValue(this.plugin.settings.annotationHeading)
        .onChange(async (value) => {
          this.plugin.settings.annotationHeading = value.trim() || "PDF Annotations";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("批注写回 PDF 文件")
      .setDesc("写回后批注在外部 PDF 阅读器中可见。即时写回会让正在阅读的原生 PDF 视图重载（闪烁一下）；离开视图时写回则完全无感，也可随时用命令/Cmd+Shift+S 手动写回。")
      .addDropdown((dropdown) => dropdown
        .addOption("on-leave", "离开视图时写回（推荐）")
        .addOption("immediate", "即时写回")
        .addOption("off", "不写回（仅保存在论文库内）")
        .setValue(this.plugin.settings.pdfAnnotationWriteback || "on-leave")
        .onChange(async (value) => {
          this.plugin.settings.pdfAnnotationWriteback = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("双击打开论文的方式")
      .setDesc("双击论文卡片或表格行时打开原生 PDF 阅读器，还是研究画布（摘录/笔记工作台）。")
      .addDropdown((dropdown) => dropdown
        .addOption("native", "原生 PDF 阅读器（推荐）")
        .addOption("canvas", "研究画布")
        .setValue(this.plugin.settings.pdfOpenMode || "native")
        .onChange(async (value) => {
          this.plugin.settings.pdfOpenMode = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("PDF 打开时的位置")
      .setDesc("从论文库打开 PDF 时恢复上次阅读的页码，或总是从第一页开始。")
      .addDropdown((dropdown) => dropdown
        .addOption("last", "上次浏览位置（推荐）")
        .addOption("first", "从第一页开始")
        .setValue(this.plugin.settings.pdfOpenPosition || "last")
        .onChange(async (value) => {
          this.plugin.settings.pdfOpenPosition = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("PDF 文本框字号")
      .setDesc("插入文本框时的默认字号（8-48），插入面板中可直接输入。")
      .addSlider((slider) => slider
        .setLimits(8, 48, 1)
        .setValue(Number(this.plugin.settings.pdfTextBoxFontSize) || 18)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.pdfTextBoxFontSize = value;
          await this.plugin.saveSettings();
        }));
    containerEl.createEl("h3", { text: "开发者" });
    new Setting(containerEl)
      .setName("显示调试命令")
      .setDesc("在命令面板显示 debug-*、重写 PDF 内嵌批注等开发者命令。修改后需要重新加载插件。")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.settings.developerMode))
        .onChange(async (value) => {
          this.plugin.settings.developerMode = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("研究画布笔记标题")
      .setDesc("摘录卡片、想法与连接自动同步到论文笔记中的此标题下。")
      .addText((text) => text
        .setPlaceholder("Research Workspace")
        .setValue(this.plugin.settings.researchWorkspaceHeading || "Research Workspace")
        .onChange(async (value) => {
          this.plugin.settings.researchWorkspaceHeading = value.trim() || "Research Workspace";
          await this.plugin.saveSettings();
        }));
  }
}

export { PaperLibrarySettingTab };
