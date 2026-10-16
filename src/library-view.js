/* 论文库视图：主视图（表格/卡片/排序筛选）与导航、详情两个子类。
   Navigation/Detail 继承 PaperLibraryView，三类同模块以保持继承链。
   插件交互全部通过构造注入的 plugin 进行。 */

import { ItemView, Menu, Notice, setIcon } from "obsidian";
import {
  DETAIL_VIEW_TYPE,
  FAVORITE_COLORS,
  NAV_VIEW_TYPE,
  PAPER_TABLE_COLUMNS,
  PAPER_TABLE_COLUMN_META,
  VIEW_TYPE,
  favoriteColorValue,
  normalizeFavoriteColor
} from "./constants.js";
import { STAR_FEEDBACK_DELAY, iconButton, itemViewContentRoot, setPaperlibIcon } from "./ui-utils.js";
import { truncate } from "./text-utils.js";
import {
  collectionBaseName,
  collectionParentPath,
  collectionPathContains,
  expandCollectionPaths,
  normalizeCollectionPath
} from "./collection-utils.js";
import { findVenueRankingRule, isRepositoryVenue } from "./venue-rankings.js";
import { ConferenceFollowModal } from "./modals/misc.js";
import { TagModal } from "./modals/paper-form.js";
import {
  DeleteCollectionModal,
  DeletePaperModal,
  DeletePapersModal,
  DeleteTagModal
} from "./modals/delete.js";

class PaperLibraryView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.query = "";
    this.sortKey = "addedAt";
    this.sortDirection = "desc";
    this.paperglassRankOnly = false;
    this.collapsedCollections = new Set();
    this.pendingCollectionDraft = null;
    this.renamingCollection = null;
    this.tagCloudQuery = "";
    this.tagCloudPositions = new Map();
    this.sidebarViewportCleanup = null;
    this.selectionMode = false;
    this.checkedPaperIds = new Set();
    this.lastClickedPaperId = null;
    this.mobileTap = null;
    this.mobileDetailTimer = null;
    this.tableScroll = { top: 0, left: 0 };
    this.dailyQueueOffset = 0;
  }

  get selectionActive() { return this.selectionMode || this.checkedPaperIds.size > 0; }

  get scope() { return this.plugin.uiState.scope; }
  set scope(value) { this.plugin.uiState.scope = value; }
  get selectedId() { return this.plugin.uiState.selectedId; }
  set selectedId(value) { this.plugin.uiState.selectedId = value; }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Paper Library"; }
  getIcon() { return "library"; }

  async onOpen() {
    this.containerEl.addClass("paperlib-view");
    this.contentEl?.addClass?.("paperlib-view-content");
    this.render();
  }

  async onClose() {
    if (this.clickTimer) window.clearTimeout(this.clickTimer);
    if (this.mobileDetailTimer) window.clearTimeout(this.mobileDetailTimer);
    this.mobileDetailTimer = null;
    this.mobileTap = null;
    if (this.detailRefreshFrame) cancelAnimationFrame(this.detailRefreshFrame);
    this.closeFavoriteColorPicker();
    this.dragGhostEl?.remove();
    this.dragGhostEl = null;
    this.columnResizeCleanup?.();
    this.columnResizeCleanup = null;
    this.tagCloudDragCleanup?.();
    this.tagCloudDragCleanup = null;
    this.sidebarViewportCleanup?.();
    this.sidebarViewportCleanup = null;
    if (this.tagCloudFrame) {
      cancelAnimationFrame(this.tagCloudFrame);
      this.tagCloudFrame = null;
    }
  }

  getFilteredPapers() {
    const q = this.query.trim().toLocaleLowerCase();
    let papers = [...this.plugin.settings.papers];
    if (this.scope === "starred") papers = papers.filter((paper) => paper.starred);
    if (this.scope === "flagged") papers = papers.filter((paper) => paper.flagged);
    if (this.scope === "recent") papers = papers.filter((paper) => paper.lastOpened);
    if (this.scope.startsWith("collection:")) {
      const collection = this.scope.slice("collection:".length);
      papers = papers.filter((paper) => (paper.collections || [])
        .some((candidate) => collectionPathContains(collection, candidate)));
    }
    if (this.scope.startsWith("tag:")) {
      const tag = this.scope.slice("tag:".length);
      papers = papers.filter((paper) => paper.tags.includes(tag));
    }
    if (q) {
      papers = papers.filter((paper) => [
        paper.title,
        paper.venue,
        paper.abstract,
        this.plugin.formatVenueRanksInput(this.plugin.getPaperVenueRanks(paper)),
        ...paper.authors,
        ...paper.tags,
        ...paper.collections
      ].join(" ").toLocaleLowerCase().includes(q));
    }
    if (this.paperglassRankOnly && this.plugin.getLibraryAppearanceBase() === "paperglass") {
      papers = papers.filter((paper) => this.plugin.getPaperVenueRanks(paper)
        .some(({ system, rank }) => system === "CCF" && String(rank).toLocaleUpperCase() === "A"));
    }
    papers.sort((a, b) => {
      let left = a[this.sortKey] ?? "";
      let right = b[this.sortKey] ?? "";
      if (this.sortKey === "authors") {
        left = a.authors.join(" ");
        right = b.authors.join(" ");
      } else if (this.sortKey === "rankings") {
        left = this.plugin.formatVenueRanksInput(this.plugin.getPaperVenueRanks(a));
        right = this.plugin.formatVenueRanksInput(this.plugin.getPaperVenueRanks(b));
      } else if (this.sortKey === "favorite") {
        left = a.starred ? `1:${normalizeFavoriteColor(a.favoriteColor)}` : "0";
        right = b.starred ? `1:${normalizeFavoriteColor(b.favoriteColor)}` : "0";
      } else if (this.sortKey === "attachment") {
        left = a.pdfPath ? "1" : "0";
        right = b.pdfPath ? "1" : "0";
      }
      const value = String(left).localeCompare(String(right), undefined, { numeric: true });
      return this.sortDirection === "asc" ? value : -value;
    });
    return papers;
  }

  getScopeTitle() {
    const fixed = {
      all: "My Papers",
      daily: "Daily Board",
      starred: "Starred",
      recent: "Recently Read",
      flagged: "Flagged"
    };
    if (fixed[this.scope]) return fixed[this.scope];
    return this.scope.split(":").slice(1).join(":") || "My Papers";
  }

  selectScope(scope, reveal = true) {
    this.scope = scope;
    this.plugin.refreshLibraryScopeViews();
    if (reveal) void this.plugin.activateMainView(true);
  }

  syncScopeNavigationState() {
    this.containerEl?.querySelectorAll?.("[data-paperlib-scope]").forEach((item) => {
      item.toggleClass("is-active", item.dataset.paperlibScope === this.scope);
    });
  }

  refreshScopeContent() {
    this.syncScopeNavigationState();
    if (this.scope === "daily" || this.containerEl?.querySelector?.(".paperlib-daily-dashboard")) {
      this.render();
      return;
    }
    const title = this.getScopeTitle();
    this.containerEl?.querySelector?.(".paperlib-severance-copy h2")?.setText?.(title);
    this.containerEl?.querySelector?.(".paperlib-list-head h3")?.setText?.(title);
    const count = this.containerEl?.querySelector?.(".paperlib-severance-count");
    if (count) count.setText(String(this.getFilteredPapers().length).padStart(3, "0"));
    this.renderTable();
  }

  render() {
    this.captureTableScroll();
    const root = itemViewContentRoot(this);
    if (!root) return;
    root.empty();
    root.addClass("paperlib-root");
    root.toggleClass("paperlib-mobile-layout", this.plugin.isMobileApp());
    this.plugin.applyLibraryViewStyle(root);
    const content = root.createDiv({ cls: "paperlib-content" });
    this.renderMain(content.createDiv({ cls: "paperlib-main" }));
  }

  renderSidebar(sidebar) {
    const appearance = this.plugin.getLibraryAppearanceDefinition();
    const titleRow = sidebar.createDiv({ cls: "paperlib-sidebar-title" });
    const title = titleRow.createDiv({ cls: "paperlib-sidebar-identity" });
    title.createSpan({
      cls: "paperlib-severance-eyebrow",
      text: appearance.sidebarEyebrow
    });
    title.createEl("h2", { text: "Library" });
    const viewToggle = iconButton(
      titleRow,
      "palette",
      `选择外观（当前：${this.plugin.getLibraryAppearanceName()}）`,
      (event) => this.plugin.showLibraryAppearanceMenu(event),
      "paperlib-view-style-toggle"
    );
    viewToggle.toggleClass("is-active", this.plugin.getLibraryAppearanceId() !== "standard");

    const nav = sidebar.createDiv({ cls: "paperlib-nav" });
    this.createNavItem(nav, "star", "Starred", "starred");
    this.createNavItem(nav, "library", "My Papers", "all", this.plugin.settings.papers.length, true);
    this.createNavItem(nav, "calendar-days", "Daily Board", "daily");
    this.createNavItem(nav, "history", "Recently Read", "recent");
    this.createNavItem(nav, "flag", "Flagged", "flagged");

    const collectionHeader = nav.createDiv({ cls: "paperlib-section-header" });
    const collectionTitle = collectionHeader.createDiv({ cls: "paperlib-section-label" });
    setPaperlibIcon(collectionTitle.createSpan({ cls: "paperlib-nav-icon" }), "folders");
    collectionTitle.createSpan({ text: "Collections" });
    iconButton(collectionHeader, "plus", "新建分类", () => this.startCollectionDraft(""));

    const collections = nav.createDiv({ cls: "paperlib-collections" });
    this.renderCollectionTree(collections);

    const tagDock = sidebar.createDiv({ cls: "paperlib-tag-dock" });
    const tagHeader = tagDock.createDiv({ cls: "paperlib-section-header" });
    const tagTitle = tagHeader.createDiv({ cls: "paperlib-section-label" });
    setPaperlibIcon(tagTitle.createSpan({ cls: "paperlib-nav-icon" }), "tags");
    tagTitle.createSpan({ text: "Tags" });
    iconButton(tagHeader, "plus", "新建标签", () => new TagModal(this.app, this.plugin).open());
    this.renderTagCloud(tagDock);
    const bottom = sidebar.createDiv({ cls: "paperlib-sidebar-bottom" });
    bottom.createSpan({ text: `${this.plugin.settings.papers.length} 篇论文` });
    iconButton(bottom, "folder-plus", "新建分类", () => this.startCollectionDraft(""));
  }

  renderCollectionTree(parent) {
    const paths = expandCollectionPaths([
      ...(this.plugin.settings.collections || []),
      ...this.plugin.settings.papers.flatMap((paper) => paper.collections || [])
    ]);
    const children = new Map();
    paths.forEach((path) => {
      const parentPath = collectionParentPath(path);
      if (!children.has(parentPath)) children.set(parentPath, []);
      children.get(parentPath).push(path);
    });
    const renderBranch = (host, parentPath = "") => {
      (children.get(parentPath) || []).forEach((collection) => {
        const descendants = children.get(collection) || [];
        const isRenaming = this.renamingCollection === collection;
        const collapsed = this.collapsedCollections.has(collection);
        const item = host.createEl(isRenaming ? "div" : "button", {
          cls: `paperlib-nav-item paperlib-collection-item ${isRenaming ? "paperlib-collection-draft" : ""} ${this.scope === `collection:${collection}` ? "is-active" : ""}`,
          attr: {
            "aria-label": `分类 ${collection}`,
            "data-paperlib-scope": `collection:${collection}`
          }
        });
        if (descendants.length) item.setAttribute("aria-expanded", String(!collapsed));
        const leading = item.createSpan({ cls: "paperlib-collection-leading" });
        const disclosure = leading.createSpan({ cls: `paperlib-collection-disclosure ${descendants.length ? "" : "is-empty"}` });
        if (descendants.length) {
          setPaperlibIcon(disclosure, collapsed ? "chevron-right" : "chevron-down");
          disclosure.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (this.collapsedCollections.has(collection)) this.collapsedCollections.delete(collection);
            else this.collapsedCollections.add(collection);
            const sidebar = parent.closest(".paperlib-sidebar");
            if (sidebar) this.renderSidebarRefresh(sidebar);
          });
        }
        setPaperlibIcon(leading.createSpan({ cls: "paperlib-nav-icon" }), descendants.length ? "folders" : "folder");
        if (isRenaming) {
          const input = item.createEl("input", {
            cls: "paperlib-collection-draft-input paperlib-collection-rename-input",
            attr: { type: "text", "aria-label": "重命名分类" }
          });
          input.value = collectionBaseName(collection);
          input.addEventListener("click", (event) => event.stopPropagation());
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              this.commitCollectionRename(input);
            } else if (event.key === "Escape") {
              event.preventDefault();
              this.cancelCollectionRename();
            }
          });
          input.addEventListener("blur", () => this.commitCollectionRename(input));
        } else {
          item.createSpan({ cls: "paperlib-nav-label", text: collectionBaseName(collection) });
        }
        const count = this.plugin.settings.papers.filter((paper) => (paper.collections || [])
          .some((candidate) => collectionPathContains(collection, candidate))).length;
        if (count) item.createSpan({ cls: "paperlib-count", text: String(count) });
        if (!isRenaming) {
          item.addEventListener("click", () => {
            this.selectScope(`collection:${collection}`);
          });
          this.installCollectionDropTarget(item, collection);
        }
        item.addEventListener("contextmenu", (event) => this.showCollectionContextMenu(event, collection));
        const hasDraftChild = this.pendingCollectionDraft?.parentPath === collection;
        if ((descendants.length || hasDraftChild) && !collapsed) {
          const childHost = host.createDiv({ cls: "paperlib-collection-children" });
          renderBranch(childHost, collection);
        }
      });
      if (this.pendingCollectionDraft && this.pendingCollectionDraft.parentPath === parentPath) {
        this.renderCollectionDraftRow(host);
      }
    };
    renderBranch(parent);
    if (!paths.length && !this.pendingCollectionDraft) parent.createDiv({ cls: "paperlib-sidebar-empty", text: "暂无分类" });
  }

  installCollectionDropTarget(item, collection) {
    if (this.plugin.isMobileApp()) return;
    const type = "application/x-paperlib-papers";
    const isPaperDrag = (event) => Array.from(event.dataTransfer?.types || []).includes(type);
    item.addEventListener("dragover", (event) => {
      if (!isPaperDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      item.addClass("is-drop-target");
    });
    item.addEventListener("dragleave", () => item.removeClass("is-drop-target"));
    item.addEventListener("drop", async (event) => {
      if (!isPaperDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      item.removeClass("is-drop-target");
      let ids = [];
      try { ids = JSON.parse(event.dataTransfer?.getData(type) || "[]"); } catch (_) { /* 忽略坏数据 */ }
      if (!ids.length) return;
      const moved = await this.plugin.addPapersToCollection(ids, collection);
      new Notice(moved ? `已将 ${moved} 篇论文加入「${collection}」` : `所选论文已在「${collection}」中`);
      if (moved) {
        this.app.workspace.getLeavesOfType(VIEW_TYPE)
          .forEach((leaf) => leaf.view?.setSelectionMode?.(false));
      }
    });
  }

  startCollectionDraft(parentPath = "") {
    const parent = normalizeCollectionPath(parentPath);
    this.renamingCollection = null;
    this.pendingCollectionDraft = { parentPath: parent };
    let current = parent;
    while (current) {
      this.collapsedCollections.delete(current);
      current = collectionParentPath(current);
    }
    const sidebar = this.containerEl.querySelector(".paperlib-sidebar");
    if (!sidebar) return;
    this.renderSidebarRefresh(sidebar);
    const input = sidebar.querySelector(".paperlib-collection-draft-input");
    if (input) window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  renderCollectionDraftRow(parent) {
    const item = parent.createDiv({ cls: "paperlib-nav-item paperlib-collection-item paperlib-collection-draft" });
    const leading = item.createSpan({ cls: "paperlib-collection-leading" });
    leading.createSpan({ cls: "paperlib-collection-disclosure is-empty" });
    setPaperlibIcon(leading.createSpan({ cls: "paperlib-nav-icon" }), "folder");
    const input = item.createEl("input", {
      cls: "paperlib-collection-draft-input",
      attr: { type: "text", "aria-label": "新分类名称" }
    });
    input.value = "未命名分类";
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.commitCollectionDraft(input);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.cancelCollectionDraft();
      }
    });
    input.addEventListener("blur", () => this.commitCollectionDraft(input));
  }

  async commitCollectionDraft(input) {
    const draft = this.pendingCollectionDraft;
    if (!draft) return;
    const name = input.value.trim();
    if (!name) {
      this.cancelCollectionDraft();
      return;
    }
    if (/[\\/]/.test(name) || name === "." || name === "..") {
      new Notice("目录名称不能包含 / 或 \\");
      window.setTimeout(() => { input.focus(); input.select(); }, 0);
      return;
    }
    const target = normalizeCollectionPath([draft.parentPath, name].filter(Boolean).join("/"));
    const duplicate = expandCollectionPaths([
      ...(this.plugin.settings.collections || []),
      ...this.plugin.settings.papers.flatMap((paper) => paper.collections || [])
    ]).find((path) => path.toLocaleLowerCase() === target.toLocaleLowerCase());
    if (duplicate) {
      new Notice("这个分类已经存在");
      window.setTimeout(() => { input.focus(); input.select(); }, 0);
      return;
    }
    this.pendingCollectionDraft = null;
    await this.plugin.createCollection(target);
  }

  cancelCollectionDraft() {
    if (!this.pendingCollectionDraft) return;
    this.pendingCollectionDraft = null;
    const sidebar = this.containerEl.querySelector(".paperlib-sidebar");
    if (sidebar) this.renderSidebarRefresh(sidebar);
  }

  startCollectionRename(collection) {
    const target = normalizeCollectionPath(collection);
    if (!target) return;
    this.pendingCollectionDraft = null;
    this.renamingCollection = target;
    let current = collectionParentPath(target);
    while (current) {
      this.collapsedCollections.delete(current);
      current = collectionParentPath(current);
    }
    const sidebar = this.containerEl.querySelector(".paperlib-sidebar");
    if (!sidebar) return;
    this.renderSidebarRefresh(sidebar);
    const input = sidebar.querySelector(".paperlib-collection-rename-input");
    if (input) window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  async commitCollectionRename(input) {
    const old = this.renamingCollection;
    if (!old) return;
    const name = input.value.trim();
    if (!name || name === collectionBaseName(old)) {
      this.cancelCollectionRename();
      return;
    }
    if (/[\\/]/.test(name) || name === "." || name === "..") {
      new Notice("目录名称不能包含 / 或 \\");
      window.setTimeout(() => { input.focus(); input.select(); }, 0);
      return;
    }
    const target = normalizeCollectionPath([collectionParentPath(old), name].filter(Boolean).join("/"));
    const duplicate = expandCollectionPaths([
      ...(this.plugin.settings.collections || []),
      ...this.plugin.settings.papers.flatMap((paper) => paper.collections || [])
    ]).find((path) => path !== old && !collectionPathContains(old, path)
      && path.toLocaleLowerCase() === target.toLocaleLowerCase());
    if (duplicate) {
      new Notice("这个分类已经存在");
      window.setTimeout(() => { input.focus(); input.select(); }, 0);
      return;
    }
    this.renamingCollection = null;
    await this.plugin.renameCollection(old, target);
  }

  cancelCollectionRename() {
    if (!this.renamingCollection) return;
    this.renamingCollection = null;
    const sidebar = this.containerEl.querySelector(".paperlib-sidebar");
    if (sidebar) this.renderSidebarRefresh(sidebar);
  }

  renderSidebarRefresh(sidebar) {
    sidebar.empty();
    this.renderSidebar(sidebar);
  }

  getInitialTagCloudPosition(tag, index, total) {
    if (this.tagCloudPositions.has(tag)) return this.tagCloudPositions.get(tag);
    let hash = 0;
    for (const character of tag) hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
    // 斐波那契球面均匀分布，附带标签哈希抖动
    const phi = Math.acos(1 - 2 * (index + 0.5) / Math.max(1, total));
    const theta = index * 2.3999632297 + (hash % 360) * Math.PI / 180;
    const position = {
      vx: Math.sin(phi) * Math.cos(theta),
      vy: Math.cos(phi),
      vz: Math.sin(phi) * Math.sin(theta),
      ox: 0,
      oy: 0,
      x: 0.5,
      y: 0.5
    };
    this.tagCloudPositions.set(tag, position);
    return position;
  }

  renderTagCloud(parent) {
    if (this.plugin.getLibraryAppearanceBase() === "paperglass") {
      this.renderPaperglassTags(parent);
      return;
    }
    const search = parent.createDiv({ cls: "paperlib-tag-search" });
    setPaperlibIcon(search.createSpan(), "search");
    const input = search.createEl("input", {
      type: "search",
      value: this.tagCloudQuery,
      placeholder: "搜索标签…",
      attr: { "aria-label": "搜索标签" }
    });
    const clear = search.createEl("button", { cls: "paperlib-tag-search-clear", attr: { "aria-label": "清空标签搜索" } });
    setPaperlibIcon(clear, "x");
    clear.toggleClass("is-visible", Boolean(this.tagCloudQuery));
    const host = parent.createDiv({ cls: "paperlib-tag-cloud-host" });
    const rerender = () => {
      clear.toggleClass("is-visible", Boolean(this.tagCloudQuery));
      this.renderTagCloudStage(host);
    };
    input.addEventListener("input", () => {
      this.tagCloudQuery = input.value.trim();
      rerender();
    });
    clear.addEventListener("click", () => {
      this.tagCloudQuery = "";
      input.value = "";
      input.focus();
      rerender();
    });
    this.renderTagCloudStage(host);
  }

  renderPaperglassTags(parent) {
    const search = parent.createDiv({ cls: "paperlib-tag-search paperlib-paperglass-tag-search" });
    setPaperlibIcon(search.createSpan(), "search");
    const input = search.createEl("input", {
      type: "search",
      value: this.tagCloudQuery,
      placeholder: "Filter tags…",
      attr: { "aria-label": "搜索标签" }
    });
    const list = parent.createDiv({ cls: "paperlib-paperglass-tag-list" });
    const paint = () => {
      list.empty();
      const query = this.tagCloudQuery.toLocaleLowerCase();
      const tags = this.plugin.getAllTags().map((tag) => ({
        tag,
        count: this.plugin.settings.papers.filter((paper) => (paper.tags || []).includes(tag)).length
      })).filter(({ tag }) => !query || tag.toLocaleLowerCase().includes(query))
        .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
      if (!tags.length) {
        list.createSpan({ cls: "paperlib-tag-cloud-empty", text: query ? "没有匹配的标签" : "暂无标签" });
        return;
      }
      tags.forEach(({ tag, count }) => {
        const button = list.createEl("button", {
          cls: `paperlib-paperglass-tag ${this.scope === `tag:${tag}` ? "is-active" : ""}`,
          attr: { "data-paperlib-scope": `tag:${tag}`, title: `${tag} · ${count} 篇` }
        });
        setPaperlibIcon(button.createSpan(), "tag");
        button.createSpan({ cls: "paperlib-paperglass-tag-label", text: tag });
        button.createSpan({ cls: "paperlib-paperglass-tag-count", text: String(count) });
        button.addEventListener("click", () => this.selectScope(this.scope === `tag:${tag}` ? "all" : `tag:${tag}`));
      });
    };
    input.addEventListener("input", () => {
      this.tagCloudQuery = input.value.trim();
      paint();
    });
    paint();
  }

  renderTagCloudStage(host) {
    this.tagCloudDragCleanup?.();
    this.tagCloudDragCleanup = null;
    if (this.tagCloudFrame) {
      cancelAnimationFrame(this.tagCloudFrame);
      this.tagCloudFrame = null;
    }
    host.empty();
    const query = this.tagCloudQuery.toLocaleLowerCase();
    const tagStats = this.plugin.getAllTags().map((tag) => ({
      tag,
      count: this.plugin.settings.papers.filter((paper) => (paper.tags || []).includes(tag)).length
    })).filter(({ tag }) => !query || tag.toLocaleLowerCase().includes(query));
    tagStats.sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
    const visible = tagStats.slice(0, query ? 48 : 32);
    if (!visible.length) {
      const empty = host.createDiv({ cls: "paperlib-tag-cloud-empty" });
      setPaperlibIcon(empty.createSpan(), "cloud-off");
      empty.createSpan({ text: query ? "没有匹配的标签" : "暂无标签" });
      return;
    }
    const stage = host.createDiv({ cls: "paperlib-tag-cloud", attr: { title: "拖动标签调整位置；拖动空白处全向旋转标签云" } });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "paperlib-tag-cloud-links");
    svg.setAttribute("aria-hidden", "true");
    stage.appendChild(svg);
    const visibleNames = new Set(visible.map(({ tag }) => tag));
    const edgeWeights = new Map();
    this.plugin.settings.papers.forEach((paper) => {
      const paperTags = [...new Set((paper.tags || []).filter((tag) => visibleNames.has(tag)))];
      paperTags.forEach((left, index) => paperTags.slice(index + 1).forEach((right) => {
        const key = [left, right].sort().join("\u0000");
        edgeWeights.set(key, (edgeWeights.get(key) || 0) + 1);
      }));
    });
    const lines = [];
    [...edgeWeights.entries()].sort((left, right) => right[1] - left[1]).slice(0, 46).forEach(([key, weight]) => {
      const [left, right] = key.split("\u0000");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "paperlib-tag-cloud-link");
      line.style.setProperty("--paperlib-edge-weight", String(Math.min(4, weight)));
      svg.appendChild(line);
      lines.push({ left, right, line });
    });
    const nodes = new Map();
    const maxCount = Math.max(1, ...visible.map(({ count }) => count));
    const PERSPECTIVE = 2.4;
    const cloudStyle = typeof getComputedStyle === "function" ? getComputedStyle(stage) : null;
    const cloudNumber = (name, fallback) => {
      const value = Number.parseFloat(cloudStyle?.getPropertyValue?.(name) || "");
      return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
    };
    const nodeOpacityMin = cloudNumber("--paperlib-tag-depth-opacity-min", 0.42);
    const nodeOpacityMax = cloudNumber("--paperlib-tag-depth-opacity-max", 1);
    const linkOpacityMin = cloudNumber("--paperlib-tag-link-opacity-min", 0.12);
    const linkOpacityMax = cloudNumber("--paperlib-tag-link-opacity-max", 0.57);
    let activeInteractions = 0;
    const paint = () => {
      nodes.forEach((node, tag) => {
        const position = this.tagCloudPositions.get(tag);
        if (!position) return;
        const scale = PERSPECTIVE / (PERSPECTIVE - position.vz);
        position.x = Math.min(0.93, Math.max(0.07, 0.5 + position.vx * scale * 0.4 + position.ox));
        position.y = Math.min(0.91, Math.max(0.09, 0.5 + position.vy * scale * 0.32 + position.oy));
        const depth = (position.vz + 1) / 2;
        node.style.left = `${position.x * 100}%`;
        node.style.top = `${position.y * 100}%`;
        node.style.opacity = (nodeOpacityMin + (nodeOpacityMax - nodeOpacityMin) * depth).toFixed(3);
        node.style.zIndex = String(10 + Math.round(depth * 90));
        node.style.setProperty("--paperlib-tag-scale", (Number(node.dataset.baseScale || 1) * (0.8 + 0.38 * depth)).toFixed(3));
      });
      lines.forEach(({ left, right, line }) => {
        const a = this.tagCloudPositions.get(left);
        const b = this.tagCloudPositions.get(right);
        if (!a || !b) return;
        line.setAttribute("x1", `${a.x * 100}%`);
        line.setAttribute("y1", `${a.y * 100}%`);
        line.setAttribute("x2", `${b.x * 100}%`);
        line.setAttribute("y2", `${b.y * 100}%`);
        const depth = ((a.vz + b.vz) / 2 + 1) / 2;
        line.style.opacity = (linkOpacityMin + (linkOpacityMax - linkOpacityMin) * depth).toFixed(3);
      });
    };
    const rotateCloud = (yaw, pitch, origins = null) => {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const applyTo = (position) => {
        const x = position.vx * cy + position.vz * sy;
        const z = -position.vx * sy + position.vz * cy;
        const y = position.vy * cp - z * sp;
        position.vz = position.vy * sp + z * cp;
        position.vx = x;
        position.vy = y;
      };
      if (origins) {
        origins.forEach((origin, tag) => {
          const current = this.tagCloudPositions.get(tag);
          if (!current) return;
          const rotated = { ...origin };
          applyTo(rotated);
          current.vx = rotated.vx;
          current.vy = rotated.vy;
          current.vz = rotated.vz;
        });
      } else {
        this.tagCloudPositions.forEach((position) => applyTo(position));
      }
    };
    visible.forEach(({ tag, count }, index) => {
      this.getInitialTagCloudPosition(tag, index, visible.length);
      const node = stage.createEl("button", {
        cls: `paperlib-sidebar-tag ${this.scope === `tag:${tag}` ? "is-active" : ""}`,
        attr: {
          "aria-label": `${tag}，${count} 篇论文`,
          title: `${tag} · ${count} 篇论文`,
          "data-paperlib-scope": `tag:${tag}`
        }
      });
      const inner = node.createSpan({ cls: "paperlib-tag-node-inner" });
      inner.createSpan({ text: tag });
      if (count) inner.createSpan({ cls: "paperlib-sidebar-tag-count", text: String(count) });
      node.dataset.baseScale = String(0.88 + 0.2 * (count / maxCount));
      node.style.setProperty("--paperlib-float-delay", `${-(index % 9) * 0.42}s`);
      nodes.set(tag, node);
      let moved = false;
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = stage.getBoundingClientRect();
        const start = { x: event.clientX, y: event.clientY };
        const origin = { ...this.tagCloudPositions.get(tag) };
        node.addClass("is-dragging");
        activeInteractions += 1;
        const move = (moveEvent) => {
          const current = this.tagCloudPositions.get(tag);
          if (!current) return;
          if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > 3) moved = true;
          current.ox = Math.min(0.6, Math.max(-0.6, origin.ox + (moveEvent.clientX - start.x) / Math.max(1, rect.width)));
          current.oy = Math.min(0.6, Math.max(-0.6, origin.oy + (moveEvent.clientY - start.y) / Math.max(1, rect.height)));
          paint();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          node.removeClass("is-dragging");
          activeInteractions -= 1;
          if (moved) node.dataset.draggedAt = String(Date.now());
          this.tagCloudDragCleanup = null;
        };
        this.tagCloudDragCleanup = up;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
      });
      node.addEventListener("click", () => {
        if (Date.now() - Number(node.dataset.draggedAt || 0) < 300) return;
        this.selectScope(`tag:${tag}`);
      });
      node.addEventListener("contextmenu", (event) => this.showTagContextMenu(event, tag));
    });
    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest?.(".paperlib-sidebar-tag")) return;
      event.preventDefault();
      activeInteractions += 1;
      const start = { x: event.clientX, y: event.clientY };
      const origins = new Map(visible.map(({ tag }) => [tag, { ...this.tagCloudPositions.get(tag) }]));
      stage.addClass("is-rotating");
      const move = (moveEvent) => {
        // 全方向旋转：水平拖动绕垂直轴，垂直拖动绕水平轴
        rotateCloud((moveEvent.clientX - start.x) / 115, (moveEvent.clientY - start.y) / 115, origins);
        paint();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        activeInteractions -= 1;
        stage.removeClass("is-rotating");
        this.tagCloudDragCleanup = null;
      };
      this.tagCloudDragCleanup = up;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
    const footer = stage.createDiv({ cls: "paperlib-tag-cloud-hint" });
    setPaperlibIcon(footer.createSpan(), "orbit");
    footer.createSpan({ text: tagStats.length > visible.length ? `显示 ${visible.length}/${tagStats.length} · 拖动旋转` : "拖动空白处全向旋转" });
    paint();
    if (this.tagCloudFrame) cancelAnimationFrame(this.tagCloudFrame);
    if (visible.length > 1) {
      const animate = () => {
        if (!stage.isConnected) {
          this.tagCloudFrame = null;
          return;
        }
        if (!activeInteractions) {
          rotateCloud(0.0026, 0);
          paint();
        }
        this.tagCloudFrame = requestAnimationFrame(animate);
      };
      this.tagCloudFrame = requestAnimationFrame(animate);
    }
  }

  createNavItem(parent, icon, label, scope, count = "", strong = false) {
    const item = parent.createEl("button", {
      cls: `paperlib-nav-item ${this.scope === scope ? "is-active" : ""} ${strong ? "is-strong" : ""}`,
      attr: { "data-paperlib-scope": scope }
    });
    setPaperlibIcon(item.createSpan({ cls: "paperlib-nav-icon" }), icon);
    item.createSpan({ cls: "paperlib-nav-label", text: label });
    if (count !== "") item.createSpan({ cls: "paperlib-count", text: String(count) });
    item.addEventListener("click", () => {
      this.selectScope(scope);
    });
    return item;
  }

  showTagContextMenu(event, tag) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(`查看 “${tag}”`)
      .setIcon("filter")
      .onClick(() => {
        this.selectScope(`tag:${tag}`);
      }));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("重命名标签")
      .setIcon("pencil")
      .onClick(() => new TagModal(this.app, this.plugin, tag).open()));
    menu.addItem((item) => item
      .setTitle("删除标签")
      .setIcon("trash-2")
      .onClick(() => new DeleteTagModal(this.app, this.plugin, tag).open()));
    menu.showAtMouseEvent(event);
  }

  showCollectionContextMenu(event, collection) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(`查看 “${collection}”`)
      .setIcon("filter")
      .onClick(() => {
        this.selectScope(`collection:${collection}`);
      }));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("新建子目录")
      .setIcon("folder-plus")
      .onClick(() => this.startCollectionDraft(collection)));
    menu.addItem((item) => item
      .setTitle("重命名分类")
      .setIcon("pencil")
      .onClick(() => this.startCollectionRename(collection)));
    menu.addItem((item) => item
      .setTitle("删除分类")
      .setIcon("trash-2")
      .onClick(() => new DeleteCollectionModal(this.app, this.plugin, collection).open()));
    menu.showAtMouseEvent(event);
  }

  renderMain(main) {
    const appearanceBase = this.plugin.getLibraryAppearanceBase();
    const appearance = this.plugin.getLibraryAppearanceDefinition();
    this.installPdfDropTarget(main);
    if (this.scope === "daily") {
      this.tableHost = null;
      this.renderDailyDashboard(main);
      return;
    }
    const toolbar = main.createDiv({ cls: "paperlib-toolbar" });
    const searchWrap = toolbar.createDiv({ cls: "paperlib-search" });
    setPaperlibIcon(searchWrap.createSpan(), "search");
    const input = searchWrap.createEl("input", {
      type: "search",
      placeholder: "Search my papers…",
      value: this.query,
      attr: { "aria-label": "搜索论文" }
    });
    input.addEventListener("input", (event) => {
      this.query = event.target.value;
      this.renderTable(main);
      severanceCount.setText(String(this.getFilteredPapers().length).padStart(3, "0"));
    });
    if (appearanceBase === "paperglass" && !this.plugin.isMobileApp()) {
      this.renderPaperglassToolbarControls(toolbar);
    }
    const viewToggle = iconButton(
      toolbar,
      "palette",
      `选择外观（当前：${this.plugin.getLibraryAppearanceName()}）`,
      (event) => this.plugin.showLibraryAppearanceMenu(event),
      "paperlib-view-style-toggle"
    );
    viewToggle.toggleClass("is-active", this.plugin.getLibraryAppearanceId() !== "standard");
    const selectToggle = iconButton(toolbar, "list-checks",
      this.selectionActive ? "退出多选" : "多选论文",
      () => this.setSelectionMode(!this.selectionActive),
      "paperlib-select-toggle");
    selectToggle.toggleClass("is-active", this.selectionActive);
    if (this.plugin.isMobileApp()) this.renderMobileToolbarActions(toolbar);
    const severanceMasthead = main.createDiv({ cls: "paperlib-severance-masthead" });
    const severanceMark = severanceMasthead.createDiv({ cls: "paperlib-severance-mark", attr: { "aria-hidden": "true" } });
    severanceMark.createSpan({ text: appearance.mastheadMark });
    const severanceCopy = severanceMasthead.createDiv({ cls: "paperlib-severance-copy" });
    severanceCopy.createSpan({
      cls: "paperlib-severance-kicker",
      text: appearance.mastheadEyebrow
    });
    severanceCopy.createEl("h2", { text: this.getScopeTitle() });
    severanceCopy.createSpan({
      cls: "paperlib-severance-motto",
      text: appearance.mastheadMotto
    });
    const severanceCount = severanceMasthead.createSpan({
      cls: "paperlib-severance-count",
      text: String(this.getFilteredPapers().length).padStart(3, "0")
    });
    const listHead = main.createDiv({ cls: "paperlib-list-head" });
    const heading = listHead.createDiv();
    heading.createEl("h3", { text: this.getScopeTitle() });
    heading.createSpan({
      cls: "paperlib-subtitle",
      text: this.plugin.isMobileApp()
        ? "点击导入按钮选择 PDF；双击论文直接打开原生 PDF"
        : "拖入 PDF，即可识别并添加论文"
    });
    if (this.plugin.isMobileApp()) this.renderMobileSort(listHead);

    this.tableHost = main.createDiv({ cls: "paperlib-table-host" });
    this.renderTable(main);
  }

  dailyDateKey(value) {
    const date = value instanceof Date ? value : new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  getDailyReadingPriority(paper) {
    if (paper.flagged) return { id: "deep", label: "精读", minutesPerPage: 3, fallbackMinutes: 45 };
    if (paper.starred || Number(paper.rating) >= 4) return { id: "browse", label: "泛读", minutesPerPage: 1.5, fallbackMinutes: 25 };
    return { id: "skim", label: "略读", minutesPerPage: 0.55, fallbackMinutes: 8 };
  }

  getDailyReadingProgress(paper) {
    const pageCount = Math.max(0, Number(paper.pdfMeta?.pageCount) || 0);
    const pages = [];
    (paper.annotations || []).forEach((item) => pages.push(Number(item.page) || 0));
    (paper.researchWorkspace?.highlights || []).forEach((item) => pages.push(Number(item.page) || 0));
    (paper.researchWorkspace?.nodes || []).forEach((item) => pages.push(Number(item.page) || 0));
    const currentPage = Math.max(0, ...pages);
    const percent = pageCount && currentPage ? Math.min(100, Math.max(1, Math.round((currentPage / pageCount) * 100))) : 0;
    return { pageCount, currentPage: Math.min(pageCount || currentPage, currentPage), percent };
  }

  parseCcfDeadline(value, timezone = "") {
    const raw = String(value || "").trim();
    if (!raw || /^(?:tbd|n\/a|none)$/i.test(raw)) return null;
    if (/[zZ]$|[+-]\d\d:?\d\d$/.test(raw)) {
      const parsed = new Date(raw.replace(" ", "T"));
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
    const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return null;
    const zone = String(timezone || "").trim();
    let offset = 0;
    if (/^aoe$/i.test(zone)) offset = -12;
    else if (/^(?:pt|pst|pdt)$/i.test(zone)) offset = -7;
    else if (/^(?:et|est|edt)$/i.test(zone)) offset = -4;
    else {
      const utc = zone.match(/^(?:utc|gmt)\s*([+-]\d+(?:\.\d+)?)$/i);
      if (utc) offset = Number(utc[1]) || 0;
    }
    return new Date(Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4] || 23) - offset, Number(match[5] || 59), Number(match[6] || 59)
    ));
  }

  getFollowedConferenceDeadlines(now = new Date()) {
    const followed = [...new Set(this.plugin.settings.followedConferences || [])];
    if (!followed.length) return [];
    const conferences = this.plugin.settings.conferenceRankingDatabase?.conferences || [];
    const byName = new Map(conferences.map((conference) => [conference.shortName, conference]));
    const tracked = followed.map((shortName) => {
      const conference = byName.get(shortName) || {
        shortName,
        fullName: shortName,
        ranks: [],
        confs: []
      };
      const candidates = [];
      (conference.confs || []).forEach((edition) => {
        (edition.timeline || []).forEach((timeline, index) => {
          [
            [timeline.abstractDeadline, "摘要截止"],
            [timeline.deadline, timeline.comment || `投稿截止${index > 0 ? ` · 第 ${index + 1} 轮` : ""}`]
          ].forEach(([raw, stage]) => {
            const date = this.parseCcfDeadline(raw, edition.timezone);
            if (!date || date < now) return;
            candidates.push({
              id: `${conference.shortName}-${edition.year}-${raw}-${stage}`,
              conference,
              edition,
              date,
              stage,
              raw
            });
          });
        });
      });
      candidates.sort((left, right) => left.date - right.date);
      if (candidates.length) return candidates[0];
      const edition = [...(conference.confs || [])]
        .sort((left, right) => Number(right.year || 0) - Number(left.year || 0))[0] || {};
      return {
        id: `${conference.shortName}-pending`,
        conference,
        edition,
        date: null,
        stage: "下一届截止日期待公布",
        raw: ""
      };
    });
    return tracked.sort((left, right) => {
      if (left.date && right.date) return left.date - right.date;
      if (left.date) return -1;
      if (right.date) return 1;
      return String(left.conference.shortName).localeCompare(String(right.conference.shortName));
    });
  }

  getDailyDashboardModel() {
    const now = new Date();
    const today = this.dailyDateKey(now);
    const activity = new Map();
    const bump = (value, amount = 1) => {
      const key = this.dailyDateKey(value);
      if (!key) return;
      activity.set(key, (activity.get(key) || 0) + amount);
    };
    const openedToday = [];
    const importedToday = [];
    let annotationsToday = 0;
    this.plugin.settings.papers.forEach((paper) => {
      bump(paper.addedAt);
      bump(paper.lastOpened);
      if (this.dailyDateKey(paper.addedAt) === today) importedToday.push(paper);
      if (this.dailyDateKey(paper.lastOpened) === today) openedToday.push(paper);
      (Array.isArray(paper.annotations) ? paper.annotations : []).forEach((annotation) => {
        const stamp = annotation.createdAt || annotation.updatedAt;
        bump(stamp);
        if (this.dailyDateKey(stamp) === today) annotationsToday += 1;
      });
    });
    const completedToday = this.plugin.settings.papers
      .filter((paper) => this.dailyDateKey(paper.dailyReadCompletedAt) === today);
    const queue = [...this.plugin.settings.papers]
      .sort((left, right) => {
        const leftCompleted = this.dailyDateKey(left.dailyReadCompletedAt) === today ? 1 : 0;
        const rightCompleted = this.dailyDateKey(right.dailyReadCompletedAt) === today ? 1 : 0;
        if (leftCompleted !== rightCompleted) return rightCompleted - leftCompleted;
        const leftPriority = (left.flagged ? 4 : 0) + (left.starred ? 2 : 0) + (Number(left.rating) || 0) / 5;
        const rightPriority = (right.flagged ? 4 : 0) + (right.starred ? 2 : 0) + (Number(right.rating) || 0) / 5;
        if (leftPriority !== rightPriority) return rightPriority - leftPriority;
        return String(right.addedAt || "").localeCompare(String(left.addedAt || ""));
      });
    const quarterHeatmaps = [];
    const currentQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    for (let quarterOffset = 3; quarterOffset >= 0; quarterOffset -= 1) {
      const quarterStart = new Date(now.getFullYear(), currentQuarterStartMonth - quarterOffset * 3, 1);
      const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
      const gridStart = new Date(quarterStart);
      gridStart.setDate(gridStart.getDate() - gridStart.getDay());
      const gridEnd = new Date(quarterEnd);
      gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
      const days = [];
      for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
        const date = new Date(cursor);
        const key = this.dailyDateKey(date);
        const inQuarter = date >= quarterStart && date <= quarterEnd;
        days.push({
          key,
          date,
          count: inQuarter ? (activity.get(key) || 0) : 0,
          inQuarter,
          future: date > now
        });
      }
      quarterHeatmaps.push({
        key: `${quarterStart.getFullYear()}-Q${Math.floor(quarterStart.getMonth() / 3) + 1}`,
        year: quarterStart.getFullYear(),
        quarter: Math.floor(quarterStart.getMonth() / 3) + 1,
        current: quarterOffset === 0,
        weeks: Math.ceil(days.length / 7),
        total: days.reduce((sum, item) => sum + item.count, 0),
        days
      });
    }
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const weekStartKey = this.dailyDateKey(weekStart);
    const weekActivity = [...activity.entries()]
      .filter(([key]) => key >= weekStartKey && key <= today)
      .reduce((sum, [, count]) => sum + count, 0);
    return {
      now,
      today,
      activity,
      quarterHeatmaps,
      openedToday,
      importedToday,
      annotationsToday,
      weekActivity,
      queue,
      completedToday,
      deadlines: this.getFollowedConferenceDeadlines(now),
      recommendations: this.plugin.getPaperRecommendations(8)
    };
  }

  renderDailyPaperCard(parent, paper) {
    const today = this.dailyDateKey(new Date());
    const completed = this.dailyDateKey(paper.dailyReadCompletedAt) === today;
    const priority = this.getDailyReadingPriority(paper);
    const progress = this.getDailyReadingProgress(paper);
    const estimated = progress.pageCount
      ? Math.max(5, Math.min(90, Math.round(progress.pageCount * priority.minutesPerPage)))
      : priority.fallbackMinutes;
    const card = parent.createDiv({
      cls: `paperlib-daily-paper paperlib-daily-paper-rich priority-${priority.id} ${completed ? "is-completed" : ""} ${paper.id === this.selectedId ? "is-selected" : ""}`,
      attr: { role: "button", tabindex: "0", "data-paper-id": paper.id }
    });
    const checkbox = card.createEl("button", {
      cls: "paperlib-daily-read-check",
      attr: { type: "button", "aria-label": completed ? "标记为未读" : "标记为今日已读", "aria-pressed": String(completed) }
    });
    setPaperlibIcon(checkbox, completed ? "check" : "circle");
    const body = card.createDiv({ cls: "paperlib-daily-paper-body" });
    const titleRow = body.createDiv({ cls: "paperlib-daily-paper-title-row" });
    titleRow.createEl("strong", { text: paper.title || "未命名论文" });
    titleRow.createSpan({ cls: "paperlib-daily-priority", text: priority.label });
    const metadata = body.createDiv({ cls: "paperlib-daily-paper-metadata" });
    const author = Array.isArray(paper.authors) && paper.authors.length
      ? `${paper.authors[0]}${paper.authors.length > 1 ? " et al." : ""}` : "作者待补全";
    const citationCount = Number(paper.citationCount ?? paper.metrics?.citationCount);
    metadata.createSpan({
      text: [author, paper.year, Number.isFinite(citationCount) && citationCount > 0 ? `引用 ${citationCount.toLocaleString()} 次` : ""]
        .filter(Boolean).join(" · ")
    });
    const chips = body.createDiv({ cls: "paperlib-daily-paper-chips" });
    const venue = String(paper.venue || "").trim();
    if (venue) chips.createSpan({ cls: "is-venue", text: truncate(this.plugin.formatVenueDisplay(venue), 24) });
    if (paper.tags?.[0]) chips.createSpan({ cls: "is-topic", text: truncate(paper.tags[0], 22) });
    chips.createSpan({ cls: "is-time", text: completed ? `已读 · ${estimated} min` : `预计 ${estimated} min` });
    if (progress.percent > 0 && !completed) {
      const progressRow = body.createDiv({ cls: "paperlib-daily-reading-progress" });
      const track = progressRow.createDiv({ cls: "paperlib-daily-reading-track" });
      track.createSpan({ attr: { style: `width:${progress.percent}%` } });
      progressRow.createSpan({ text: `阅读中 · ${progress.percent}%（第 ${progress.currentPage} / ${progress.pageCount} 页）` });
    }
    checkbox.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (this.dailyDateKey(paper.dailyReadCompletedAt) === today) delete paper.dailyReadCompletedAt;
      else paper.dailyReadCompletedAt = new Date().toISOString();
      await this.plugin.saveSettings();
      if (this.scope === "daily") this.render();
    });
    card.addEventListener("click", () => {
      this.selectedId = paper.id;
      paper.lastOpened = new Date().toISOString();
      parent.querySelectorAll(".paperlib-daily-paper").forEach((item) => item.toggleClass("is-selected", item === card));
      this.plugin.refreshSelectedPaperViews();
      void this.plugin.saveSettings();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
    card.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void this.plugin.openPaperPdf(paper);
    });
  }

  renderDailyQueue(parent, queue) {
    parent.empty();
    if (!queue.length) {
      parent.createEl("p", { cls: "paperlib-daily-empty", text: "今天的待读队列已经清空。" });
      return;
    }
    const pageCount = Math.max(1, Math.ceil(queue.length / 3));
    const page = Math.min(pageCount - 1, Math.max(0, Math.floor(this.dailyQueueOffset / 3)));
    const start = page * 3;
    const visible = queue.slice(start, start + 3);
    visible.forEach((paper) => this.renderDailyPaperCard(parent, paper));
    if (queue.length <= 3) return;
    const nextPage = (page + 1) % pageCount;
    const nextStart = nextPage * 3;
    const preview = queue.slice(nextStart, nextStart + 2);
    const remaining = queue.length - visible.length;
    const stack = parent.createEl("button", {
      cls: "paperlib-daily-queue-stack",
      attr: {
        type: "button",
        "aria-label": `还有 ${remaining} 篇论文，显示下一组`,
        title: "显示下一组三篇论文"
      }
    });
    const visual = stack.createDiv({ cls: "paperlib-daily-queue-stack-visual", attr: { "aria-hidden": "true" } });
    visual.createSpan();
    visual.createSpan();
    visual.createSpan();
    const copy = stack.createDiv({ cls: "paperlib-daily-queue-stack-copy" });
    copy.createEl("strong", { text: `还有 ${remaining} 篇在队列中` });
    copy.createSpan({
      text: preview.length
        ? preview.map((paper) => truncate(paper.title || "未命名论文", 30)).join(" · ")
        : "返回队列开头"
    });
    const indicator = stack.createDiv({ cls: "paperlib-daily-queue-stack-indicator" });
    indicator.createSpan({ text: `${page + 1}/${pageCount}` });
    setPaperlibIcon(indicator.createSpan(), "chevron-right");
    stack.addEventListener("click", () => {
      this.dailyQueueOffset = nextStart;
      this.renderDailyQueue(parent, queue);
    });
  }

  renderConferenceDeadlinePanel(parent, model) {
    const panel = parent.createDiv({ cls: "paperlib-daily-panel paperlib-daily-deadlines" });
    const header = panel.createDiv({ cls: "paperlib-daily-card-heading" });
    const title = header.createDiv();
    title.createSpan({ cls: "paperlib-daily-heading-dot" });
    title.createEl("h2", { text: "CCF-DDL" });
    const followed = this.plugin.settings.followedConferences || [];
    title.createSpan({ cls: "paperlib-daily-card-meta", text: followed.length ? `${followed.length} 个关注` : "" });
    const manage = header.createEl("button", { attr: { type: "button", title: "选择关注会议" } });
    setPaperlibIcon(manage, "sliders-horizontal");
    const openManager = async () => {
      await this.plugin.syncConferenceRankingDatabase(false);
      new ConferenceFollowModal(this.app, this.plugin, () => {
        if (this.scope === "daily") this.render();
      }).open();
    };
    manage.addEventListener("click", () => void openManager());
    if (!followed.length) {
      const empty = panel.createDiv({ cls: "paperlib-daily-deadline-empty" });
      setPaperlibIcon(empty.createSpan(), "calendar-days");
      empty.createEl("strong", { text: "关注你准备投稿的会议" });
      empty.createEl("p", { text: "选择会议后，这里会按日期显示下一轮摘要与投稿截止时间。" });
      const choose = empty.createEl("button", { text: "选择关注会议", attr: { type: "button" } });
      choose.addEventListener("click", () => void openManager());
      return;
    }
    const list = panel.createDiv({ cls: "paperlib-daily-deadline-list" });
    if (!model.deadlines.length) {
      list.createEl("p", { cls: "paperlib-daily-empty", text: "关注的会议暂无未来截稿日期。" });
      return;
    }
    model.deadlines.forEach((deadline) => {
      const days = deadline.date
        ? Math.max(0, Math.ceil((deadline.date - model.now) / 86400000))
        : null;
      const item = list.createDiv({ cls: "paperlib-daily-deadline-item" });
      item.toggleClass("is-pending", !deadline.date);
      const date = item.createDiv({ cls: "paperlib-daily-deadline-date" });
      date.createEl("strong", { text: deadline.date ? String(deadline.date.getDate()).padStart(2, "0") : "—" });
      date.createSpan({ text: deadline.date ? `${deadline.date.getMonth() + 1}月` : "待定" });
      const copy = item.createDiv({ cls: "paperlib-daily-deadline-copy" });
      const name = copy.createDiv();
      name.createEl("strong", { text: `${deadline.conference.shortName} ${deadline.edition.year || ""}`.trim() });
      name.createSpan({ text: deadline.stage });
      copy.createEl("small", {
        text: deadline.date
          ? `本地 ${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(deadline.date)} · 原时区 ${deadline.edition.timezone || "未注明"}`
          : "CCF-DDL 尚未发布新的截稿时间"
      });
      const ranks = copy.createDiv({ cls: "paperlib-daily-deadline-ranks" });
      (deadline.conference.ranks || []).slice(0, 3).forEach((rank) => ranks.createSpan({ text: `${rank.system} ${rank.rank}` }));
      const countdown = item.createDiv({ cls: "paperlib-daily-deadline-countdown" });
      countdown.createEl("strong", { text: days === null ? "待" : String(days) });
      countdown.createSpan({ text: days === null ? "公布" : "天" });
      if (deadline.edition.link) {
        item.addEventListener("click", () => window.open(deadline.edition.link, "_blank"));
        item.setAttribute("role", "link");
        item.setAttribute("tabindex", "0");
      }
    });
  }

  renderDailyDashboard(main) {
    const model = this.getDailyDashboardModel();
    const dashboard = main.createDiv({ cls: "paperlib-daily-dashboard" });
    const hero = dashboard.createDiv({ cls: "paperlib-daily-hero" });
    const heroCopy = hero.createDiv({ cls: "paperlib-daily-hero-copy" });
    heroCopy.createSpan({ cls: "paperlib-daily-kicker", text: "DAILY RESEARCH BOARD" });
    heroCopy.createEl("h1", { text: "Daily Board" });
    heroCopy.createEl("p", {
      text: new Intl.DateTimeFormat("zh-CN", {
        year: "numeric", month: "long", day: "numeric", weekday: "long"
      }).format(model.now)
    });
    const heroActions = hero.createDiv({ cls: "paperlib-daily-hero-actions" });
    iconButton(
      heroActions,
      "palette",
      `选择外观（当前：${this.plugin.getLibraryAppearanceName()}）`,
      (event) => this.plugin.showLibraryAppearanceMenu(event),
      "paperlib-view-style-toggle"
    );
    const refresh = iconButton(heroActions, "refresh-cw", "刷新推荐", async () => {
      if (refresh.hasClass("is-loading")) return;
      refresh.addClass("is-loading");
      refresh.setAttribute("aria-busy", "true");
      try {
        await this.plugin.refreshDailyRecommendations(true);
        if (this.scope === "daily") this.render();
      } finally {
        refresh.removeClass("is-loading");
        refresh.removeAttribute("aria-busy");
      }
    }, "paperlib-daily-refresh");

    const summary = dashboard.createDiv({ cls: "paperlib-daily-summary" });
    [
      ["book-open-check", model.openedToday.length, "今日阅读", "已打开的论文"],
      ["highlighter", model.annotationsToday, "今日摘录", "高亮与批注"],
      ["file-plus-2", model.importedToday.length, "今日入库", "新加入的论文"],
      ["activity", model.weekActivity, "本周活跃", "研究动作总数"]
    ].forEach(([icon, value, label, description]) => {
      const item = summary.createDiv({ cls: "paperlib-daily-stat" });
      const visual = item.createDiv({ cls: "paperlib-daily-stat-icon" });
      setPaperlibIcon(visual, icon);
      const copy = item.createDiv();
      copy.createEl("strong", { text: String(value) });
      copy.createSpan({ text: label });
      copy.createEl("small", { text: description });
    });

    const grid = dashboard.createDiv({ cls: "paperlib-daily-grid" });
    const queuePanel = grid.createDiv({ cls: "paperlib-daily-panel paperlib-daily-queue" });
    const queueHeader = queuePanel.createDiv({ cls: "paperlib-daily-section-head" });
    const queueTitle = queueHeader.createDiv();
    queueTitle.createSpan({ text: "TODAY'S QUEUE" });
    queueTitle.createEl("h2", { text: "今日阅读队列" });
    const allPapers = queueHeader.createEl("button", {
      cls: "paperlib-daily-view-all",
      text: "查看全部文献库 →",
      attr: { type: "button" }
    });
    allPapers.addEventListener("click", () => this.selectScope("all"));
    const queueList = queuePanel.createDiv({ cls: "paperlib-daily-paper-list" });
    this.renderDailyQueue(queueList, model.queue);

    const activityPanel = grid.createDiv({ cls: "paperlib-daily-panel paperlib-daily-activity" });
    const activityHeader = activityPanel.createDiv({ cls: "paperlib-daily-section-head" });
    const activityTitle = activityHeader.createDiv();
    activityTitle.createSpan({ text: "RESEARCH RHYTHM" });
    activityTitle.createEl("h2", { text: "研究足迹" });
    activityHeader.createSpan({ cls: "paperlib-daily-section-count", text: "近四季度" });
    const quarterList = activityPanel.createDiv({
      cls: "paperlib-daily-quarter-list",
      attr: { role: "group", "aria-label": "按季度排列的过去一年论文阅读与摘录活跃度" }
    });
    const peak = Math.max(1, ...model.quarterHeatmaps.flatMap((quarter) => quarter.days.map((item) => item.count)));
    const currentQuarter = model.quarterHeatmaps.find((quarter) => quarter.current)
      || model.quarterHeatmaps[model.quarterHeatmaps.length - 1];
    const knownKeys = new Set(model.quarterHeatmaps.map((quarter) => quarter.key));
    const activeQuarterKey = knownKeys.has(this.dailyActiveQuarterKey)
      ? this.dailyActiveQuarterKey
      : currentQuarter?.key;
    const orderedQuarters = [...model.quarterHeatmaps].sort((left, right) => {
      if (left.key === activeQuarterKey) return -1;
      if (right.key === activeQuarterKey) return 1;
      return right.key.localeCompare(left.key);
    });
    const activateQuarter = (row, key) => {
      if (row.hasClass("is-active")) return;
      this.dailyActiveQuarterKey = key;
      quarterList.prepend(row);
      [...quarterList.querySelectorAll(".paperlib-daily-quarter")].forEach((candidate, index) => {
        const active = candidate === row;
        candidate.toggleClass("is-active", active);
        candidate.toggleClass("is-collapsed", !active);
        candidate.setAttribute("aria-expanded", String(active));
        candidate.style.setProperty("--paperlib-quarter-stack-index", String(Math.max(0, index - 1)));
      });
    };
    orderedQuarters.forEach((quarter, index) => {
      const active = quarter.key === activeQuarterKey;
      const row = quarterList.createEl("button", {
        cls: `paperlib-daily-quarter ${active ? "is-active" : "is-collapsed"} ${quarter.current ? "is-current" : ""}`,
        attr: {
          type: "button",
          "aria-expanded": String(active),
          "aria-label": `${quarter.year} 年第 ${quarter.quarter} 季度，${quarter.total} 次研究活动`
        }
      });
      row.style.setProperty("--paperlib-quarter-stack-index", String(Math.max(0, index - 1)));
      const label = row.createDiv({ cls: "paperlib-daily-quarter-label" });
      label.createEl("strong", { text: `Q${quarter.quarter}` });
      label.createSpan({ text: String(quarter.year) });
      const grid = row.createDiv({ cls: "paperlib-daily-quarter-grid" });
      grid.style.setProperty("--paperlib-quarter-weeks", String(quarter.weeks));
      quarter.days.forEach((item) => {
        const level = item.count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((item.count / peak) * 4)));
        grid.createSpan({
          cls: `paperlib-daily-heatmap-cell level-${level} ${item.inQuarter ? "" : "is-outside"} ${item.future ? "is-future" : ""}`.trim(),
          attr: item.inQuarter ? {
            title: `${item.key} · ${item.count} 次研究活动`,
            "data-date": item.key,
            "data-count": String(item.count)
          } : { "aria-hidden": "true" }
        });
      });
      const summary = row.createDiv({ cls: "paperlib-daily-quarter-summary" });
      summary.createSpan({ text: `${quarter.total} 次活动` });
      const disclosure = summary.createSpan({ cls: "paperlib-daily-quarter-disclosure" });
      setPaperlibIcon(disclosure, "chevron-down");
      row.addEventListener("click", () => activateQuarter(row, quarter.key));
    });
    const legend = activityPanel.createDiv({ cls: "paperlib-daily-heatmap-legend" });
    legend.createSpan({ text: "少" });
    [0, 1, 2, 3, 4].forEach((level) => legend.createSpan({ cls: `paperlib-daily-heatmap-cell level-${level}` }));
    legend.createSpan({ text: "多" });

    this.renderConferenceDeadlinePanel(dashboard, model);

    const recommendationPanel = dashboard.createDiv({ cls: "paperlib-daily-panel paperlib-daily-recommendations" });
    const recommendationHeader = recommendationPanel.createDiv({ cls: "paperlib-daily-section-head" });
    const recommendationTitle = recommendationHeader.createDiv();
    recommendationTitle.createSpan({ text: "RELATION DISCOVERY" });
    recommendationTitle.createEl("h2", { text: "为你推荐" });
    recommendationHeader.createSpan({
      cls: "paperlib-daily-section-count",
      text: model.recommendations.length ? `${model.recommendations.length} 篇近期文献` : "等待关系数据"
    });
    const recommendationList = recommendationPanel.createDiv({ cls: "paperlib-daily-recommendation-grid" });
    if (model.recommendations.length) {
      model.recommendations.forEach((recommendation) => {
        const item = recommendationList.createDiv({ cls: "paperlib-daily-recommendation" });
        const source = item.createDiv({ cls: "paperlib-daily-recommendation-source" });
        setPaperlibIcon(source.createSpan(), recommendation.relationType === "citedBy" ? "quote" : "git-branch");
        source.createSpan({ text: recommendation.reason });
        item.createEl("h3", { text: recommendation.title });
        const rawVenue = String(recommendation.venue || "").trim();
        if (rawVenue) {
          const venueDisplay = this.plugin.formatVenueDisplay(rawVenue);
          const venueRule = this.plugin.findConferenceRankingRule(rawVenue) || findVenueRankingRule(rawVenue);
          const venueKind = isRepositoryVenue(rawVenue)
            ? "预印本"
            : venueRule?.kind === "conference" || /conference|proceedings|symposium|workshop/i.test(rawVenue)
              ? "会议"
              : "期刊";
          const venue = item.createDiv({
            cls: "paperlib-daily-recommendation-venue",
            attr: { title: venueDisplay }
          });
          setPaperlibIcon(venue.createSpan({ cls: "paperlib-daily-recommendation-venue-icon" }),
            venueKind === "会议" ? "presentation" : venueKind === "期刊" ? "book-open" : "archive");
          venue.createSpan({ cls: "paperlib-daily-recommendation-venue-kind", text: venueKind });
          venue.createSpan({ cls: "paperlib-daily-recommendation-venue-name", text: venueDisplay });
        }
        item.createEl("p", {
          text: [recommendation.authors?.slice(0, 3).join(", "), recommendation.year]
            .filter(Boolean).join(" · ") || "出版信息待补全"
        });
        const footer = item.createDiv({ cls: "paperlib-daily-recommendation-footer" });
        footer.createSpan({ text: recommendation.providerLabel });
        if (recommendation.url) {
          const open = footer.createEl("button", { attr: { type: "button", title: "打开来源" } });
          open.createSpan({ text: "查看论文" });
          setPaperlibIcon(open.createSpan(), "arrow-up-right");
          open.addEventListener("click", () => window.open(recommendation.url, "_blank"));
        }
      });
    } else {
      const empty = recommendationList.createDiv({ cls: "paperlib-daily-recommendation-empty" });
      setPaperlibIcon(empty.createSpan(), "network");
      const copy = empty.createDiv();
      copy.createEl("strong", { text: "正在建立你的文献关系画像" });
      copy.createEl("p", { text: "刷新后会优先读取本地缓存，不足时再按当前数据源补充关系。" });
    }

    if (model.recommendations.length < 4) {
      void this.plugin.refreshDailyRecommendations(false).then((changed) => {
        if (changed && this.scope === "daily") this.render();
      });
    }
  }

  renderPaperglassToolbarControls(toolbar) {
    if (!["year", "title", "rating"].includes(this.sortKey)) {
      this.sortKey = "year";
      this.sortDirection = "desc";
    }
    const sort = toolbar.createDiv({ cls: "paperlib-paperglass-sort", attr: { role: "group", "aria-label": "论文排序" } });
    [
      ["year", "Year", "desc"],
      ["title", "Title", "asc"],
      ["rating", "Rating", "desc"]
    ].forEach(([key, label, direction]) => {
      const button = sort.createEl("button", {
        cls: this.sortKey === key ? "is-active" : "",
        text: label,
        attr: { "aria-pressed": String(this.sortKey === key) }
      });
      button.addEventListener("click", () => {
        if (this.sortKey === key) this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        else {
          this.sortKey = key;
          this.sortDirection = direction;
        }
        sort.querySelectorAll("button").forEach((candidate) => {
          const active = candidate === button;
          candidate.toggleClass("is-active", active);
          candidate.setAttribute("aria-pressed", String(active));
        });
        this.renderTable();
      });
    });
    const rank = toolbar.createEl("button", {
      cls: `paperlib-paperglass-rank-filter ${this.paperglassRankOnly ? "is-active" : ""}`,
      attr: { "aria-pressed": String(this.paperglassRankOnly), title: "仅显示 CCF A 论文" }
    });
    setPaperlibIcon(rank.createSpan(), "sliders-horizontal");
    rank.createSpan({ text: "CCF · A" });
    rank.addEventListener("click", () => {
      this.paperglassRankOnly = !this.paperglassRankOnly;
      rank.toggleClass("is-active", this.paperglassRankOnly);
      rank.setAttribute("aria-pressed", String(this.paperglassRankOnly));
      this.renderTable();
    });
  }

  setSelectionMode(active) {
    this.selectionMode = Boolean(active);
    if (!this.selectionMode) this.checkedPaperIds.clear();
    this.syncSelectionToggle();
    this.renderTable();
  }

  syncSelectionToggle() {
    const toggle = this.containerEl.querySelector(".paperlib-select-toggle");
    if (!toggle) return;
    toggle.toggleClass("is-active", this.selectionActive);
    const label = this.selectionActive ? "退出多选" : "多选论文";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
  }

  togglePaperChecked(paperId, visiblePapers = null) {
    if (!paperId) return;
    this.selectionMode = true;
    if (this.checkedPaperIds.has(paperId)) this.checkedPaperIds.delete(paperId);
    else this.checkedPaperIds.add(paperId);
    this.lastClickedPaperId = paperId;
    this.syncSelectionToggle();
    this.renderTable();
  }

  checkPaperRange(targetId, visiblePapers = []) {
    const order = visiblePapers.map((paper) => paper.id);
    const anchorIndex = order.indexOf(this.lastClickedPaperId);
    const targetIndex = order.indexOf(targetId);
    if (targetIndex < 0) return;
    this.selectionMode = true;
    if (anchorIndex < 0) this.checkedPaperIds.add(targetId);
    else {
      const [from, to] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      order.slice(from, to + 1).forEach((id) => this.checkedPaperIds.add(id));
    }
    this.lastClickedPaperId = targetId;
    this.syncSelectionToggle();
    this.renderTable();
  }

  getCheckedPapers() {
    const ids = this.checkedPaperIds;
    return this.plugin.settings.papers.filter((paper) => ids.has(paper.id));
  }

  async setCheckedPapersFlag(key, value) {
    const papers = this.getCheckedPapers();
    if (!papers.length) return;
    papers.forEach((paper) => { paper[key] = value; });
    await this.plugin.saveSettings();
    this.plugin.refreshPaperPresentation({ table: true, detail: true });
  }

  renderBatchBar(host, visiblePapers) {
    const bar = host.createDiv({ cls: "paperlib-batch-bar" });
    const checked = this.getCheckedPapers();
    bar.createSpan({ cls: "paperlib-batch-count", text: `已选 ${checked.length} 篇` });
    const allStarred = checked.length > 0 && checked.every((paper) => paper.starred);
    const allFlagged = checked.length > 0 && checked.every((paper) => paper.flagged);
    const star = bar.createEl("button", { cls: "paperlib-batch-action", text: allStarred ? "取消收藏" : "收藏" });
    star.disabled = !checked.length;
    star.addEventListener("click", () => void this.setCheckedPapersFlag("starred", !allStarred));
    const flag = bar.createEl("button", { cls: "paperlib-batch-action", text: allFlagged ? "取消标记" : "标记" });
    flag.disabled = !checked.length;
    flag.addEventListener("click", () => void this.setCheckedPapersFlag("flagged", !allFlagged));
    const remove = bar.createEl("button", { cls: "paperlib-batch-action mod-warning", text: "删除" });
    remove.disabled = !checked.length;
    remove.addEventListener("click", () => {
      if (!checked.length) return;
      new DeletePapersModal(this.app, this.plugin, checked, () => this.setSelectionMode(false)).open();
    });
    const spacer = bar.createSpan({ cls: "paperlib-batch-spacer" });
    spacer.setAttribute("aria-hidden", "true");
    const visibleIds = visiblePapers.map((paper) => paper.id);
    const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => this.checkedPaperIds.has(id));
    const selectAll = bar.createEl("button", {
      cls: "paperlib-batch-action",
      text: allVisibleChecked ? "取消全选" : "全选"
    });
    selectAll.disabled = !visibleIds.length;
    selectAll.addEventListener("click", () => {
      if (allVisibleChecked) visibleIds.forEach((id) => this.checkedPaperIds.delete(id));
      else visibleIds.forEach((id) => this.checkedPaperIds.add(id));
      this.renderTable();
    });
    bar.createEl("button", { cls: "paperlib-batch-action", text: "完成" })
      .addEventListener("click", () => this.setSelectionMode(false));
  }

  renderMobileToolbarActions(toolbar) {
    const actions = toolbar.createDiv({ cls: "paperlib-mobile-toolbar-actions" });
    iconButton(actions, "panel-left-open", "打开论文分类", () => this.plugin.ensureNavigationView(true));
    const picker = actions.createEl("input", {
      type: "file",
      cls: "paperlib-hidden-file-input",
      attr: { accept: "application/pdf,.pdf", multiple: "", "aria-label": "选择一个或多个 PDF 文件" }
    });
    iconButton(actions, "file-plus-2", "从设备导入 PDF", () => picker.click(), "paperlib-mobile-import");
    const detail = iconButton(actions, "info", "打开论文详情", () => this.plugin.ensureDetailView(true));
    detail.disabled = !this.selectedId;
    picker.addEventListener("change", () => {
      const files = Array.from(picker.files || []);
      picker.value = "";
      if (!files.length) return;
      void this.plugin.importPdfFiles(files);
    });
  }

  renderMobileSort(parent) {
    const controls = parent.createDiv({ cls: "paperlib-mobile-sort" });
    const select = controls.createEl("select", { attr: { "aria-label": "论文排序方式" } });
    [
      ["addedAt", "添加时间"], ["title", "标题"], ["authors", "作者"],
      ["year", "年份"], ["venue", "期刊/会议"], ["rating", "评分"]
    ].forEach(([value, label]) => select.createEl("option", { value, text: label }));
    select.value = this.sortKey;
    select.addEventListener("change", () => {
      this.sortKey = select.value;
      this.renderTable();
    });
    iconButton(controls, this.sortDirection === "asc" ? "arrow-up" : "arrow-down", "切换排序方向", () => {
      this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
      this.render();
    });
  }

  installPdfDropTarget(main) {
    const overlay = main.createDiv({ cls: "paperlib-drop-overlay", attr: { "aria-hidden": "true" } });
    setPaperlibIcon(overlay.createDiv({ cls: "paperlib-drop-icon" }), "file-down");
    overlay.createEl("strong", { text: "松开以导入 PDF" });
    overlay.createSpan({ text: "支持批量导入：先显示文件，再在后台逐步补全论文信息" });
    const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
    main.addEventListener("dragenter", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      main.addClass("is-dragging-pdf");
    });
    main.addEventListener("dragover", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      main.addClass("is-dragging-pdf");
    });
    main.addEventListener("dragleave", (event) => {
      if (!main.contains(event.relatedTarget)) main.removeClass("is-dragging-pdf");
    });
    main.addEventListener("drop", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      main.removeClass("is-dragging-pdf");
      const pdfs = Array.from(event.dataTransfer?.files || []).filter((file) => (
        file.type === "application/pdf" || file.name.toLocaleLowerCase().endsWith(".pdf")
      ));
      if (!pdfs.length) return new Notice("这里只能拖入 PDF 文件");
      void this.plugin.importPdfFiles(pdfs);
    });
  }

  renderTable() {
    if (!this.tableHost) return;
    this.captureTableScroll();
    this.closeFavoriteColorPicker();
    this.tableHost.empty();
    const papers = this.getFilteredPapers();
    if (this.checkedPaperIds.size) {
      const existing = new Set(this.plugin.settings.papers.map((paper) => paper.id));
      [...this.checkedPaperIds].forEach((id) => {
        if (!existing.has(id)) this.checkedPaperIds.delete(id);
      });
    }
    const selectionActive = this.selectionActive;
    this.tableHost.toggleClass("is-selection-active", selectionActive);
    if (selectionActive) this.renderBatchBar(this.tableHost, papers);
    const table = this.tableHost.createDiv({ cls: "paperlib-table" });
    table.toggleClass("is-selection-mode", selectionActive);
    const columnWidths = this.getTableColumnWidths();
    const columnOrder = this.getTableColumnOrder();
    this.applyTableColumnWidths(table, columnWidths, columnOrder);
    const paperglassRows = this.plugin.getLibraryAppearanceBase() === "paperglass" && !this.plugin.isMobileApp();
    if (paperglassRows) {
      const header = table.createDiv({ cls: "paperlib-paperglass-table-header" });
      ["#", "Title", "Venue", "Rank", "Rating"].forEach((label) => header.createSpan({ text: label }));
    } else {
      const header = table.createDiv({ cls: "paperlib-row paperlib-table-header" });
      columnOrder.forEach((key) => {
        const meta = PAPER_TABLE_COLUMN_META[key] || { label: key };
        this.createSortHeader(header, key, meta.label, table, meta.icon || "");
      });
    }

    if (!papers.length) {
      const empty = table.createDiv({ cls: "paperlib-empty" });
      setPaperlibIcon(empty.createDiv(), "file-down");
      empty.createEl("h3", { text: "没有找到论文" });
      empty.createEl("p", {
        text: this.plugin.isMobileApp() ? "换个关键词，或点击上方导入按钮选择 PDF。" : "换个关键词，或直接把 PDF 拖到这里。"
      });
      this.restoreTableScroll(table);
      return;
    }

    papers.forEach((paper, paperIndex) => {
      const storedImportStatus = String(paper.importStatus || "");
      const importStatus = storedImportStatus === "error" || this.plugin.isPaperImportActive(paper)
        ? storedImportStatus
        : "";
      const isChecked = this.checkedPaperIds.has(paper.id);
      const isCurrent = paper.id === this.selectedId && !selectionActive;
      // Chromium sizes <button> flex/grid containers from fixed heights, not
      // intrinsic content, so Paperglass rich rows use a div[role=button]
      // whose flex layout can grow with the three-line content.
      const row = table.createEl(paperglassRows ? "div" : "button", {
        cls: `paperlib-row paperlib-paper-row ${paperglassRows ? "paperlib-pg-row paperlib-pg-rise" : ""} ${isCurrent ? "is-selected" : ""} ${isChecked ? "is-checked" : ""} ${importStatus ? "is-importing" : ""} ${importStatus === "error" ? "is-import-error" : ""}`.trim(),
        attr: {
          "aria-busy": importStatus && importStatus !== "error" ? "true" : "false",
          "aria-pressed": selectionActive ? String(isChecked) : "false",
          "data-paper-id": paper.id,
          "data-sheet-number": String(paperIndex + 1).padStart(3, "0"),
          title: importStatus ? this.plugin.batchImportStatusLabel(importStatus, paper.importError) : paper.title,
          ...(paperglassRows ? { role: "button", tabindex: "0" } : {})
        }
      });
      if (paperglassRows) {
        row.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
      }
      if (paperglassRows) this.renderPaperglassRowCells(row, paper, paperIndex);
      else columnOrder.forEach((key) => this.renderPaperTableCell(row, key, paper));
      row.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          if (this.clickTimer) window.clearTimeout(this.clickTimer);
          this.togglePaperChecked(paper.id, papers);
          return;
        }
        if (event.shiftKey && selectionActive) {
          event.preventDefault();
          if (this.clickTimer) window.clearTimeout(this.clickTimer);
          this.checkPaperRange(paper.id, papers);
          return;
        }
        if (this.selectionActive) {
          event.preventDefault();
          if (this.clickTimer) window.clearTimeout(this.clickTimer);
          this.togglePaperChecked(paper.id, papers);
          return;
        }
        this.lastClickedPaperId = paper.id;
        if (this.clickTimer) window.clearTimeout(this.clickTimer);
        const mobile = this.plugin.isMobileApp();
        const tapTime = Date.now();
        const doubleTap = mobile
          && this.mobileTap?.paperId === paper.id
          && tapTime - this.mobileTap.time <= 360;
        if (this.mobileDetailTimer) window.clearTimeout(this.mobileDetailTimer);
        this.mobileDetailTimer = null;
        // Selection is visual state: update it in the same frame instead of
        // waiting for the double-click window and a full data.json write.
        this.selectedId = paper.id;
        paper.lastOpened = new Date().toISOString();
        this.syncSelectedPaperRows();
        if (doubleTap) {
          this.mobileTap = null;
          void this.plugin.saveSettings().catch((error) => (
            console.warn("Paper Library: opened-paper timestamp save unavailable", error)
          ));
          void this.plugin.openPaperPdf(paper);
          return;
        }
        if (mobile) {
          this.mobileTap = { paperId: paper.id, time: tapTime };
          // Keep the row available until the double-tap window closes. Opening
          // the detail drawer immediately after tap one used to intercept tap
          // two, making mobile PDF opening impossible.
          this.mobileDetailTimer = window.setTimeout(() => {
            this.mobileDetailTimer = null;
            if (this.mobileTap?.paperId !== paper.id) return;
            this.mobileTap = null;
            this.scheduleSelectedPaperDetailRefresh();
          }, 380);
        } else {
          this.scheduleSelectedPaperDetailRefresh();
        }
        this.clickTimer = window.setTimeout(() => {
          this.clickTimer = null;
          void this.plugin.saveSettings().catch((error) => (
            console.warn("Paper Library: selected-paper timestamp save unavailable", error)
          ));
        }, 120);
      });
      row.addEventListener("dblclick", async (event) => {
        event.preventDefault();
        // Touch devices use the explicit two-tap recognizer in the click
        // handler. Ignoring a synthetic dblclick here prevents opening twice.
        if (this.plugin.isMobileApp()) return;
        if (this.selectionActive) return;
        if (this.clickTimer) window.clearTimeout(this.clickTimer);
        this.clickTimer = null;
        this.selectedId = paper.id;
        paper.lastOpened = new Date().toISOString();
        this.syncSelectedPaperRows();
        this.scheduleSelectedPaperDetailRefresh();
        void this.plugin.saveSettings().catch((error) => (
          console.warn("Paper Library: opened-paper timestamp save unavailable", error)
        ));
        await this.plugin.openPaperPdf(paper);
      });
      row.addEventListener("contextmenu", (event) => this.showPaperContextMenu(event, paper));
      if (!this.plugin.isMobileApp()) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => {
          const ids = this.selectionActive && this.checkedPaperIds.has(paper.id)
            ? [...this.checkedPaperIds]
            : [paper.id];
          event.dataTransfer?.setData("application/x-paperlib-papers", JSON.stringify(ids));
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
          if (event.dataTransfer && ids.length > 1) {
            this.dragGhostEl?.remove();
            const ghost = document.body.createDiv({ cls: "paperlib-drag-ghost" });
            setPaperlibIcon(ghost.createSpan(), "files");
            ghost.createSpan({ text: `${ids.length} 篇论文` });
            event.dataTransfer.setDragImage(ghost, 18, 18);
            this.dragGhostEl = ghost;
          }
          row.addClass("is-drag-source");
        });
        row.addEventListener("dragend", () => {
          row.removeClass("is-drag-source");
          this.dragGhostEl?.remove();
          this.dragGhostEl = null;
        });
      }
    });

    const status = this.tableHost.createDiv({ cls: "paperlib-table-status" });
    status.createSpan({ text: `${papers.length} 篇` });
    status.createSpan({
      text: this.checkedPaperIds.size
        ? `已选 ${this.checkedPaperIds.size} 篇`
        : (this.selectedId ? "1 selected" : "0 selected")
    });
    this.restoreTableScroll(table);
  }

  captureTableScroll() {
    const table = this.tableHost?.querySelector?.(".paperlib-table");
    if (!table) return;
    this.tableScroll = {
      top: Math.max(0, Number(table.scrollTop) || 0),
      left: this.plugin.getLibraryAppearanceBase() === "paperglass"
        ? 0
        : Math.max(0, Number(table.scrollLeft) || 0)
    };
  }

  restoreTableScroll(table) {
    if (!table || !this.tableScroll) return;
    const target = {
      ...this.tableScroll,
      left: this.plugin.getLibraryAppearanceBase() === "paperglass" ? 0 : this.tableScroll.left
    };
    const apply = () => {
      if (!table.isConnected) return;
      table.scrollTop = target.top;
      table.scrollLeft = target.left;
    };
    apply();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
  }

  syncSelectedPaperRows() {
    this.tableHost?.querySelectorAll?.(".paperlib-paper-row[data-paper-id]").forEach((row) => {
      row.toggleClass("is-selected", !this.selectionActive && row.dataset.paperId === this.selectedId);
    });
  }

  scheduleSelectedPaperDetailRefresh() {
    if (this.detailRefreshFrame && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.detailRefreshFrame);
    }
    const refresh = () => {
      this.detailRefreshFrame = null;
      this.plugin.refreshViews(DETAIL_VIEW_TYPE);
      void this.plugin.ensureDetailView(true);
    };
    if (typeof requestAnimationFrame !== "function") {
      window.setTimeout(refresh, 0);
      return;
    }
    // Two frames intentionally let the selected-row style paint before the
    // more expensive detail sidebar is rebuilt.
    this.detailRefreshFrame = requestAnimationFrame(() => {
      this.detailRefreshFrame = requestAnimationFrame(refresh);
    });
  }

  renderPaperTableCell(row, key, paper) {
    if (key === "favorite") {
      const cell = row.createSpan({ cls: "paperlib-cell paperlib-favorite" });
      const favorite = cell.createSpan({
        cls: `paperlib-favorite-dot ${paper.starred ? "is-active" : ""}`,
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": paper.starred ? `收藏颜色：${normalizeFavoriteColor(paper.favoriteColor)}` : "选择收藏颜色",
          title: paper.starred ? "更改收藏颜色" : "收藏并选择颜色"
        }
      });
      favorite.style.setProperty("--paperlib-favorite-color", favoriteColorValue(paper.favoriteColor));
      const openPicker = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openFavoriteColorPicker(favorite, paper);
      };
      favorite.addEventListener("click", openPicker);
      favorite.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openPicker(event);
      });
      return;
    }
    if (key === "attachment") {
      const attachment = row.createSpan({ cls: "paperlib-cell paperlib-attachment" });
      const importing = this.plugin.isPaperImportActive(paper);
      setPaperlibIcon(attachment, paper.pdfPath ? "paperclip" : (importing ? "loader-circle" : "file-text"));
      attachment.toggleClass("is-importing", Boolean(importing));
      attachment.setAttribute("title", importing
        ? this.plugin.batchImportStatusLabel(paper.importStatus)
        : (paper.pdfPath ? "PDF 已保存" : "没有 PDF"));
      return;
    }
    if (key === "authors") {
      row.createSpan({ cls: "paperlib-cell paperlib-authors", text: truncate(paper.authors.join(", "), 42) });
      return;
    }
    if (key === "year") {
      row.createSpan({ cls: "paperlib-cell paperlib-year", text: String(paper.year || "—") });
      return;
    }
    if (key === "title") {
      row.createSpan({ cls: "paperlib-cell paperlib-title", text: paper.title });
      return;
    }
    if (key === "rating") {
      const rating = Math.max(0, Math.min(5, Math.round(Number(paper.rating) || 0)));
      const cell = row.createSpan({
        cls: "paperlib-cell paperlib-table-rating",
        attr: { "aria-label": `个人评分：${rating} 星`, role: "group" }
      });
      for (let score = 1; score <= 5; score += 1) {
        const star = cell.createSpan({
          cls: `paperlib-table-rating-star ${score <= rating ? "is-active" : ""}`,
          attr: { role: "button", tabindex: "0", "aria-label": `${score} 星`, title: `${score} 星` }
        });
        setPaperlibIcon(star, "star");
        const updateRating = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          paper.rating = paper.rating === score ? 0 : score;
          await this.plugin.saveSettings();
          this.plugin.refreshPaperPresentation({ table: true, detail: true });
        };
        star.addEventListener("click", (event) => void updateRating(event));
        star.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") void updateRating(event);
        });
      }
      return;
    }
    if (key === "venue") {
      row.createSpan({ cls: "paperlib-cell paperlib-venue", text: this.plugin.formatVenueDisplay(paper.venue) || "—" });
      return;
    }
    if (key === "rankings") {
      const rankings = row.createSpan({ cls: "paperlib-cell paperlib-rankings" });
      this.renderVenueRankPills(rankings, paper);
    }
  }

  // Paperglass / 纸境 rich row: index · venue eyebrow + serif title + authors ·
  // venue year + acceptance · rank chips · star rating, matching the liquid
  // glass reference layout.
  renderPaperglassRowCells(row, paper, paperIndex) {
    row.style.animationDelay = `${Math.min(paperIndex * 40, 320)}ms`;
    row.createSpan({ cls: "paperlib-pg-index", text: String(paperIndex + 1).padStart(3, "0") });

    const venueDisplay = this.plugin.formatVenueDisplay(paper.venue) || "Unpublished";
    const [venueShortRaw, ...venueRest] = venueDisplay.split(" · ");
    const venueShort = venueShortRaw || venueDisplay;
    const venueFull = venueRest.join(" · ");

    const main = row.createSpan({ cls: "paperlib-pg-main" });
    const eyebrow = main.createSpan({ cls: "paperlib-pg-eyebrow" });
    const clip = eyebrow.createSpan({ cls: "paperlib-pg-clip" });
    const importing = this.plugin.isPaperImportActive(paper);
    setPaperlibIcon(clip, paper.pdfPath ? "paperclip" : (importing ? "loader-circle" : "file-text"));
    clip.toggleClass("is-importing", Boolean(importing));
    eyebrow.createSpan({ cls: "paperlib-pg-venue", text: venueShort });
    if (venueFull) eyebrow.createSpan({ cls: "paperlib-pg-venue-full", text: `· ${venueFull}` });
    main.createSpan({ cls: "paperlib-pg-title", text: paper.title });
    const authorPreview = paper.authors.slice(0, 3).join(", ") + (paper.authors.length > 3 ? " …" : "");
    main.createSpan({ cls: "paperlib-pg-authors", text: authorPreview || "—" });

    const venueCol = row.createSpan({ cls: "paperlib-pg-venuecol" });
    const yearShort = String(paper.year || "").slice(-2);
    venueCol.createSpan({
      cls: "paperlib-pg-venuecol-main",
      text: `${venueShort}${yearShort ? ` ’${yearShort}` : ""}`
    });
    const ranks = this.plugin.getPaperVenueRanks(paper);
    const acceptance = ranks.find(({ system }) => String(system).startsWith("录用率"));
    if (acceptance) venueCol.createSpan({ cls: "paperlib-pg-acceptance", text: `录用率 ${acceptance.rank}` });

    const rankCol = row.createSpan({ cls: "paperlib-pg-ranks" });
    const visibleRanks = ranks.filter(({ system }) => !String(system).startsWith("录用率"));
    if (!visibleRanks.length) rankCol.createSpan({ cls: "paperlib-pg-rank-empty", text: "—" });
    visibleRanks.slice(0, 2).forEach(({ system, rank }) => {
      rankCol.createSpan({
        cls: `paperlib-pg-rank-chip is-${this.plugin.getVenueRankTone(rank, system)}`,
        text: `${system} ${rank}`,
        attr: { "aria-label": `${system} 等级 ${rank}` }
      });
    });

    this.renderPaperTableCell(row, "rating", paper);
  }

  closeFavoriteColorPicker() {
    this.favoriteColorPickerCleanup?.();
    this.favoriteColorPickerCleanup = null;
    this.favoriteColorPickerEl?.remove();
    this.favoriteColorPickerEl = null;
  }

  openFavoriteColorPicker(anchor, paper) {
    this.closeFavoriteColorPicker();
    const picker = document.body.createDiv({
      cls: "paperlib-favorite-picker",
      attr: { role: "dialog", "aria-label": "选择收藏颜色" }
    });
    this.favoriteColorPickerEl = picker;
    picker.createSpan({ cls: "paperlib-favorite-picker-label", text: "收藏颜色" });
    const colors = picker.createDiv({ cls: "paperlib-favorite-picker-colors" });
    FAVORITE_COLORS.forEach((color) => {
      const option = colors.createEl("button", {
        cls: `paperlib-favorite-color-option ${paper.starred && normalizeFavoriteColor(paper.favoriteColor) === color.id ? "is-selected" : ""}`,
        attr: { "aria-label": color.label, title: color.label }
      });
      option.style.setProperty("--paperlib-favorite-color", color.value);
      option.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        paper.starred = true;
        paper.favoriteColor = color.id;
        await this.plugin.saveSettings();
        this.closeFavoriteColorPicker();
        this.plugin.refreshPaperPresentation({ table: true, detail: true });
      });
    });
    const remove = picker.createEl("button", {
      cls: "paperlib-favorite-remove",
      text: "取消收藏"
    });
    remove.disabled = !paper.starred;
    remove.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      paper.starred = false;
      await this.plugin.saveSettings();
      this.closeFavoriteColorPicker();
      this.plugin.refreshPaperPresentation({ table: true, detail: true });
    });
    const rect = anchor.getBoundingClientRect();
    const pickerWidth = 224;
    picker.style.left = `${Math.max(8, Math.min(window.innerWidth - pickerWidth - 8, rect.left))}px`;
    picker.style.top = `${Math.min(window.innerHeight - 110, rect.bottom + 7)}px`;
    const closeOnOutside = (event) => {
      if (!picker.contains(event.target) && event.target !== anchor) this.closeFavoriteColorPicker();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") this.closeFavoriteColorPicker();
    };
    window.setTimeout(() => document.addEventListener("pointerdown", closeOnOutside, true), 0);
    document.addEventListener("keydown", closeOnEscape, true);
    this.favoriteColorPickerCleanup = () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }

  showPaperContextMenu(event, paper) {
    event.preventDefault();
    event.stopPropagation();

    if (this.selectionActive && this.checkedPaperIds.has(paper.id)) {
      const checked = this.getCheckedPapers();
      const menu = new Menu();
      menu.addItem((item) => item
        .setTitle(`收藏 ${checked.length} 篇论文`)
        .setIcon("star")
        .onClick(() => void this.setCheckedPapersFlag("starred", true)));
      menu.addItem((item) => item
        .setTitle(`标记 ${checked.length} 篇论文`)
        .setIcon("flag")
        .onClick(() => void this.setCheckedPapersFlag("flagged", true)));
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(`删除 ${checked.length} 篇论文`)
        .setIcon("trash-2")
        .onClick(() => new DeletePapersModal(this.app, this.plugin, checked, () => this.setSelectionMode(false)).open()));
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("退出多选")
        .setIcon("x")
        .onClick(() => this.setSelectionMode(false)));
      menu.showAtMouseEvent(event);
      return;
    }

    this.selectedId = paper.id;
    this.plugin.refreshSelectedPaperViews();

    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle("编辑论文信息")
      .setIcon("square-pen")
      .onClick(() => this.plugin.editPaperInSidebar(paper)));
    menu.addItem((item) => item
      .setTitle("多选论文")
      .setIcon("list-checks")
      .onClick(() => this.togglePaperChecked(paper.id)));
    menu.addItem((item) => item
      .setTitle("选择标签与分类")
      .setIcon("tags")
      .onClick(() => this.plugin.editPaperInSidebar(paper)));
    menu.addItem((item) => item
      .setTitle("打开或创建阅读笔记")
      .setIcon("notebook-pen")
      .onClick(() => this.plugin.openOrCreateNote(paper)));
    menu.addItem((item) => item
      .setTitle("添加到 Paper Composer")
      .setIcon("messages-square")
      .onClick(() => void this.plugin.addPaperToPaperComposer(paper)));
    if (paper.pdfPath) {
      menu.addItem((item) => item
        .setTitle("用原生 PDF 阅读器打开")
        .setIcon("file-text")
        .onClick(() => this.plugin.openPaperPdf(paper, { native: true })));
    }
    menu.addItem((item) => item
      .setTitle("用 Research Workspace 打开")
      .setIcon("waypoints")
      .onClick(() => this.plugin.openResearchWorkspace(paper, this.app.workspace.activeLeaf, true)));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(paper.starred ? "取消收藏" : "收藏论文")
      .setIcon("star")
      .onClick(async () => {
        paper.starred = !paper.starred;
        await this.plugin.saveSettings();
        this.plugin.refreshPaperPresentation({ table: true, detail: true });
      }));
    menu.addItem((item) => item
      .setTitle(paper.flagged ? "取消标记" : "标记论文")
      .setIcon("flag")
      .onClick(async () => {
        paper.flagged = !paper.flagged;
        await this.plugin.saveSettings();
        this.plugin.refreshPaperPresentation({ table: true, detail: true });
      }));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("删除论文")
      .setIcon("trash-2")
      .onClick(() => new DeletePaperModal(this.app, this.plugin, paper).open()));
    menu.showAtMouseEvent(event);
  }

  getTableColumnWidths() {
    const widths = this.plugin.normalizePaperTableColumnWidths(this.plugin.settings.tableColumnWidths);
    const available = Math.max(0, Number(this.tableHost?.clientWidth) || 0);
    const total = Object.values(widths).reduce((sum, width) => sum + width, 0);
    if (available > total) widths.title += available - total;
    this.currentTableColumnWidths = widths;
    return widths;
  }

  getTableColumnOrder() {
    return this.plugin.normalizePaperTableColumnOrder(this.plugin.settings.tableColumnOrder);
  }

  applyTableColumnWidths(table, widths, order = this.getTableColumnOrder()) {
    const normalized = this.plugin.normalizePaperTableColumnWidths(widths);
    Object.entries(normalized).forEach(([key, width]) => {
      table.style.setProperty(`--paperlib-column-${key}`, `${width}px`);
    });
    const normalizedOrder = this.plugin.normalizePaperTableColumnOrder(order);
    table.style.setProperty(
      "--paperlib-table-columns",
      normalizedOrder.map((key) => `var(--paperlib-column-${key}, ${PAPER_TABLE_COLUMNS[key].width}px)`).join(" ")
    );
    const total = normalizedOrder.reduce((sum, key) => sum + normalized[key], 0);
    table.style.setProperty("--paperlib-table-width", `${total}px`);
    this.currentTableColumnWidths = normalized;
  }

  async saveTableColumnWidths(widths) {
    this.plugin.settings.tableColumnWidths = this.plugin.normalizePaperTableColumnWidths(widths);
    await this.plugin.saveSettings();
  }

  async saveTableColumnOrder(order) {
    this.plugin.settings.tableColumnOrder = this.plugin.normalizePaperTableColumnOrder(order);
    await this.plugin.saveSettings();
  }

  clearColumnDropIndicators(header) {
    header?.querySelectorAll?.(".is-drop-before, .is-drop-after, .is-dragging")
      .forEach((element) => element.classList.remove("is-drop-before", "is-drop-after", "is-dragging"));
  }

  installColumnReorder(cell, key) {
    cell.draggable = true;
    cell.setAttribute("title", `${cell.getAttribute("title") || PAPER_TABLE_COLUMN_META[key]?.label || key}；拖动调整列顺序`);
    cell.addEventListener("dragstart", (event) => {
      this.draggedTableColumn = key;
      cell.addClass("is-dragging");
      event.dataTransfer?.setData("text/x-paperlib-column", key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    cell.addEventListener("dragover", (event) => {
      const source = this.draggedTableColumn || event.dataTransfer?.getData("text/x-paperlib-column");
      if (!source || source === key) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const rect = cell.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      this.clearColumnDropIndicators(cell.parentElement);
      cell.addClass(after ? "is-drop-after" : "is-drop-before");
    });
    cell.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const source = this.draggedTableColumn || event.dataTransfer?.getData("text/x-paperlib-column");
      if (!source || source === key) return;
      const rect = cell.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      const order = this.getTableColumnOrder().filter((column) => column !== source);
      let targetIndex = order.indexOf(key);
      if (targetIndex < 0) return;
      if (after) targetIndex += 1;
      order.splice(targetIndex, 0, source);
      this.columnDragFinishedAt = Date.now();
      this.draggedTableColumn = "";
      this.clearColumnDropIndicators(cell.parentElement);
      void this.saveTableColumnOrder(order).then(() => this.renderTable());
    });
    cell.addEventListener("dragend", () => {
      this.columnDragFinishedAt = Date.now();
      this.draggedTableColumn = "";
      this.clearColumnDropIndicators(cell.parentElement);
    });
  }

  installColumnResizer(cell, key, label, table) {
    const config = PAPER_TABLE_COLUMNS[key];
    if (!config) return;
    const handle = cell.createSpan({
      cls: "paperlib-column-resizer",
      attr: {
        role: "separator",
        tabindex: "0",
        "aria-orientation": "vertical",
        "aria-label": `调整 ${label} 列宽`,
        "aria-valuemin": String(config.min),
        "aria-valuemax": String(config.max),
        "aria-valuenow": String(this.currentTableColumnWidths?.[key] || config.width),
        title: `拖动调整 ${label} 宽度；双击重置`
      }
    });
    handle.draggable = false;
    const commitWidth = (width) => {
      const widths = { ...(this.currentTableColumnWidths || this.getTableColumnWidths()), [key]: width };
      this.applyTableColumnWidths(table, widths);
      void this.saveTableColumnWidths(widths);
    };
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.columnResizeCleanup?.();
      const startX = event.clientX;
      const startWidth = Number(this.currentTableColumnWidths?.[key]) || config.width;
      table.addClass("is-resizing-column");
      handle.addClass("is-active");
      document.body.addClass("paperlib-is-column-resizing");
      handle.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const width = Math.min(config.max, Math.max(config.min, Math.round(startWidth + moveEvent.clientX - startX)));
        const widths = { ...this.currentTableColumnWidths, [key]: width };
        this.applyTableColumnWidths(table, widths);
        handle.setAttribute("aria-valuenow", String(width));
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        table.removeClass("is-resizing-column");
        handle.removeClass("is-active");
        document.body.removeClass("paperlib-is-column-resizing");
        if (this.columnResizeCleanup === finish) this.columnResizeCleanup = null;
        void this.saveTableColumnWidths(this.currentTableColumnWidths);
      };
      this.columnResizeCleanup = finish;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    });
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      commitWidth(config.width);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const current = Number(this.currentTableColumnWidths?.[key]) || config.width;
      commitWidth(Math.min(config.max, Math.max(config.min, current + direction * 16)));
    });
  }

  createSortHeader(parent, key, label, table, icon = "") {
    const button = parent.createEl("button", { cls: `paperlib-cell paperlib-sort paperlib-${key}` });
    if (icon) setPaperlibIcon(button.createSpan({ cls: "paperlib-column-header-icon" }), icon);
    else button.createSpan({ text: label });
    button.setAttribute("aria-label", label);
    if (this.sortKey === key) setPaperlibIcon(button.createSpan(), this.sortDirection === "asc" ? "chevron-up" : "chevron-down");
    this.installColumnReorder(button, key);
    this.installColumnResizer(button, key, label, table);
    button.addEventListener("click", () => {
      if (Date.now() - Number(this.columnDragFinishedAt || 0) < 180) return;
      if (this.sortKey === key) this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
      else {
        this.sortKey = key;
        this.sortDirection = "asc";
      }
      this.render();
    });
  }

  renderVenueRankPills(parent, paper) {
    const ranks = this.plugin.getPaperVenueRanks(paper);
    if (!ranks.length) {
      parent.createSpan({ cls: "paperlib-rank-empty", text: "—" });
      return;
    }
    const pills = parent.createSpan({ cls: "paperlib-rank-pills" });
    ranks.forEach(({ system, rank }) => {
      pills.createSpan({
        cls: `paperlib-rank-pill is-${this.plugin.getVenueRankTone(rank, system)}`,
        text: `${system} ${rank}`,
        attr: { "aria-label": `${system} 等级 ${rank}` }
      });
    });
  }

  renderDetail(detail) {
    this.closeFavoriteColorPicker();
    const paper = this.plugin.settings.papers.find((item) => item.id === this.selectedId);
    if (!paper) {
      const empty = detail.createDiv({ cls: "paperlib-detail-empty" });
      setPaperlibIcon(empty.createDiv(), "mouse-pointer-click");
      empty.createEl("h3", { text: "选择一篇论文" });
      empty.createEl("p", { text: "摘要、标签和标识符会显示在这里。" });
      return;
    }

    const detailBar = detail.createDiv({ cls: "paperlib-detail-bar" });
    const tabs = detailBar.createDiv({ cls: "paperlib-detail-tabs" });
    const detailTab = this.plugin.uiState.detailTab || "info";
    const scroll = detail.createDiv({ cls: "paperlib-detail-scroll" });

    // Tab switching updates only the content area in place. Re-rendering the
    // whole view here flashes the entire right sidebar and resets its state.
    const DETAIL_PAGE_CLASSES = ["paperlib-inline-editor", "paperlib-attachments-page", "paperlib-export-page"];
    const renderTabContent = (tab) => {
      scroll.empty();
      DETAIL_PAGE_CLASSES.forEach((cls) => scroll.removeClass(cls));
      if (tab === "data") this.renderPaperData(scroll, paper);
      else if (tab === "attachments") this.renderPaperAttachments(scroll, paper);
      else if (tab === "export") this.renderPaperExport(scroll, paper);
      else if (tab === "edit") this.renderPaperEditor(scroll, paper);
      else this.renderPaperInfo(scroll, paper);
    };
    const syncFooter = (tab) => {
      detail.querySelector(".paperlib-detail-footer")?.remove();
      if (["edit", "attachments", "export"].includes(tab)) return;
      const footer = detail.createDiv({ cls: "paperlib-detail-footer" });
      iconButton(footer, "waypoints", "打开研究画布", () => this.plugin.openResearchWorkspace(paper, this.app.workspace.activeLeaf, true));
      iconButton(footer, "notebook-pen", "打开论文笔记", () => this.plugin.openOrCreateNote(paper));
      if (tab === "info") {
        const refresh = iconButton(footer, "refresh-cw", "刷新论文信息", () => void this.plugin.refreshPaperInfo(paper),
          this.plugin.infoLoading?.has(paper.id) ? "is-spinning" : "");
        refresh.disabled = Boolean(this.plugin.infoLoading?.has(paper.id));
      }
      iconButton(footer, "trash-2", "删除论文", () => new DeletePaperModal(this.app, this.plugin, paper).open(), "paperlib-danger-button");
    };
    const switchDetailTab = (tab) => {
      if ((this.plugin.uiState.detailTab || "info") === tab) return;
      this.plugin.uiState.detailTab = tab;
      tabs.querySelectorAll("[data-detail-tab]").forEach((button) => {
        button.toggleClass("is-active", button.dataset.detailTab === tab);
      });
      renderTabContent(tab);
      syncFooter(tab);
      scroll.scrollTop = 0;
    };
    const createTab = (icon, label, tab) => {
      const button = iconButton(tabs, icon, label, () => switchDetailTab(tab), detailTab === tab ? "is-active" : "");
      button.dataset.detailTab = tab;
    };
    createTab("info", "论文信息", "info");
    createTab("edit-3", "编辑论文信息", "edit");
    createTab("bar-chart-2", "论文数据", "data");
    createTab("paperclip", "论文附件", "attachments");
    createTab("upload", "导出论文", "export");
    const right = detailBar.createDiv({ cls: "paperlib-detail-actions" });
    iconButton(right, "x", "取消选择", () => {
      this.selectedId = null;
      this.plugin.refreshSelectedPaperViews();
    });

    renderTabContent(detailTab);
    syncFooter(detailTab);
  }

  renderPaperInfo(scroll, paper) {
    const infoHeader = scroll.createDiv({ cls: "paperlib-info-header" });
    const venueLine = infoHeader.createDiv({ cls: "paperlib-kicker" });
    venueLine.createSpan({ text: this.plugin.formatVenueDisplay(paper.venue) || "Unpublished" });
    venueLine.createSpan({ text: String(paper.year || "") });
    if (this.plugin.getPaperVenueRanks(paper).length) {
      const ranks = infoHeader.createDiv({ cls: "paperlib-detail-rankings" });
      this.renderVenueRankPills(ranks, paper);
    }
    infoHeader.createEl("h1", { cls: "paperlib-detail-title", text: paper.title });
    infoHeader.createDiv({ cls: "paperlib-detail-authors", text: paper.authors.join(" · ") });

    const abstractBlock = scroll.createDiv({ cls: "paperlib-abstract" });
    const abstractTitle = abstractBlock.createDiv({ cls: "paperlib-abstract-title" });
    abstractTitle.createEl("h4", { text: "Abstract" });
    const abstractText = abstractBlock.createEl("p", { text: paper.abstract || "No abstract yet." });
    const isExpanded = this.plugin.expandedAbstractIds?.has(paper.id);
    abstractText.toggleClass("is-expanded", Boolean(isExpanded));
    if (paper.abstract) {
      const toggleAbstract = iconButton(
        abstractTitle,
        isExpanded ? "chevron-up" : "chevron-down",
        isExpanded ? "收起摘要" : "展开全部摘要",
        () => {
          const expanded = !abstractText.hasClass("is-expanded");
          abstractText.toggleClass("is-expanded", expanded);
          if (expanded) this.plugin.expandedAbstractIds.add(paper.id);
          else this.plugin.expandedAbstractIds.delete(paper.id);
          toggleAbstract.empty();
          setPaperlibIcon(toggleAbstract, expanded ? "chevron-up" : "chevron-down");
          toggleAbstract.setAttribute("aria-label", expanded ? "收起摘要" : "展开全部摘要");
          toggleAbstract.setAttribute("title", expanded ? "收起摘要" : "展开全部摘要");
          toggleAbstract.setAttribute("aria-expanded", String(expanded));
        },
        "paperlib-abstract-toggle"
      );
      toggleAbstract.setAttribute("aria-expanded", String(Boolean(isExpanded)));
      // WebKit on iPad can report identical scrollHeight/clientHeight for a
      // line-clamped paragraph. Keep the explicit expander available on touch
      // devices instead of incorrectly hiding it after that measurement.
      if (!isExpanded && !this.plugin.isMobileApp()) {
        toggleAbstract.addClass("is-pending");
        window.requestAnimationFrame(() => {
          if (!toggleAbstract.isConnected) return;
          toggleAbstract.removeClass("is-pending");
          const visuallyClamped = abstractText.scrollHeight > abstractText.clientHeight + 1;
          const likelyClamped = String(paper.abstract || "").length > 420;
          toggleAbstract.toggleClass("is-hidden", !visuallyClamped && !likelyClamped);
        });
      }
    }

    const quick = scroll.createDiv({ cls: "paperlib-quick-actions" });
    const rating = quick.createDiv({ cls: "paperlib-rating", attr: { "aria-label": "论文评分", role: "group" } });
    for (let score = 1; score <= 5; score += 1) {
      const ratingStar = iconButton(rating, "star", `${score} 星`, async () => {
        paper.rating = paper.rating === score ? 0 : score;
        this.setRatingState(rating, paper.rating, true);
        await this.plugin.saveSettings();
        await new Promise((resolve) => window.setTimeout(resolve, STAR_FEEDBACK_DELAY));
        this.plugin.refreshPaperTableViews();
      }, `paperlib-rating-star ${score <= paper.rating ? "is-active is-filled" : ""}`.trim());
      ratingStar.setAttribute("aria-pressed", String(score <= paper.rating));
      ratingStar.addEventListener("pointerenter", () => {
        rating.dataset.preview = String(score);
      });
      ratingStar.addEventListener("pointerleave", () => {
        rating.dataset.preview = String(paper.rating || 0);
      });
      ratingStar.addEventListener("focus", () => {
        rating.dataset.preview = String(score);
      });
    }
    rating.addEventListener("focusout", () => {
      rating.dataset.preview = String(paper.rating || 0);
    });
    this.setRatingState(rating, paper.rating, false);

    const primaryActions = quick.createDiv({ cls: "paperlib-quick-primary" });
    const star = iconButton(primaryActions, "circle", "选择收藏颜色", (event) => {
      this.openFavoriteColorPicker(star, paper);
    }, `paperlib-star-toggle ${paper.starred ? "is-active is-filled" : ""}`.trim());
    star.style.setProperty("--paperlib-favorite-color", favoriteColorValue(paper.favoriteColor));
    this.setStarToggleState(star, paper.starred, false);
    const flagButton = iconButton(primaryActions, "flag", paper.flagged ? "取消标记" : "标记", async () => {
      paper.flagged = !paper.flagged;
      flagButton.toggleClass("is-active", paper.flagged);
      flagButton.toggleClass("is-filled", paper.flagged);
      flagButton.setAttribute("aria-pressed", String(paper.flagged));
      flagButton.setAttribute("aria-label", paper.flagged ? "取消标记" : "标记");
      flagButton.setAttribute("title", paper.flagged ? "取消标记" : "标记");
      await this.plugin.saveSettings();
      this.plugin.refreshPaperTableViews();
    }, `paperlib-flag-toggle ${paper.flagged ? "is-active is-filled" : ""}`.trim());
    flagButton.setAttribute("aria-pressed", String(Boolean(paper.flagged)));
    quick.prepend(primaryActions);

    this.renderChipSection(scroll, "Tags", paper.tags, "tag", paper, "tags");
    this.renderChipSection(scroll, "Collections", paper.collections, "collection", paper, "collections");

    const identifiers = scroll.createDiv({ cls: "paperlib-meta-section" });
    identifiers.createEl("h4", { text: "Identifiers" });
    if (!paper.doi && !paper.arxiv) identifiers.createEl("p", { cls: "paperlib-muted", text: "No identifiers" });
    if (paper.doi) this.createIdentifier(identifiers, "DOI", paper.doi, `https://doi.org/${paper.doi}`);
    if (paper.arxiv) this.createIdentifier(identifiers, "arXiv", paper.arxiv, `https://arxiv.org/abs/${paper.arxiv}`);
  }

  setStarToggleState(button, active, animate) {
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-filled", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "更改收藏颜色" : "收藏并选择颜色");
    button.setAttribute("title", active ? "更改收藏颜色" : "收藏并选择颜色");
    if (!animate) return;
    button.classList.remove("is-filling", "is-clearing");
    button.querySelector(".paperlib-star-burst")?.remove();
    void button.offsetWidth;
    button.addClass(active ? "is-filling" : "is-clearing");
    if (active) button.createSpan({ cls: "paperlib-star-burst", attr: { "aria-hidden": "true" } });
    window.setTimeout(() => {
      button.classList.remove("is-filling", "is-clearing");
      button.querySelector(".paperlib-star-burst")?.remove();
    }, 420);
  }

  setRatingState(group, value, animate) {
    const normalized = Math.max(0, Math.min(5, Number(value) || 0));
    group.dataset.value = String(normalized);
    group.dataset.preview = String(normalized);
    group.setAttribute("aria-label", normalized ? `论文评分：${normalized} 星` : "论文评分：未评分");
    Array.from(group.children).forEach((child, index) => {
      const active = index < normalized;
      child.classList.toggle("is-active", active);
      child.classList.toggle("is-filled", active);
      child.setAttribute("aria-pressed", String(active));
      if (!animate) return;
      child.classList.remove("is-animating");
      if (active) {
        void child.offsetWidth;
        child.classList.add("is-animating");
        window.setTimeout(() => child.classList.remove("is-animating"), 420 + index * 35);
      }
    });
    if (animate && !normalized) {
      group.classList.add("is-clearing");
      window.setTimeout(() => group.classList.remove("is-clearing"), 320);
    }
  }

  renderPaperEditor(scroll, paper) {
    scroll.addClass("paperlib-inline-editor");
    const heading = scroll.createDiv({ cls: "paperlib-editor-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("span", { cls: "paperlib-kicker", text: "Edit metadata" });
    headingText.createEl("h2", { text: "编辑论文信息" });
    const draft = {
      title: paper.title || "",
      authors: (paper.authors || []).join("; "),
      year: String(paper.year || ""),
      venue: paper.venue || "",
      venueRanks: this.plugin.formatVenueRanksInput(paper.venueRanks),
      abstract: paper.abstract || "",
      doi: paper.doi || "",
      arxiv: paper.arxiv || "",
      pdfPath: paper.pdfPath || "",
      notePath: paper.notePath || ""
    };
    const selectedTags = new Set(paper.tags || []);
    const selectedCollections = new Set(paper.collections || []);
    const field = (label, key, options = {}) => {
      const wrap = scroll.createDiv({ cls: "paperlib-editor-field" });
      wrap.createEl("label", { text: label });
      const input = options.area
        ? wrap.createEl("textarea", { attr: { rows: String(options.rows || 5), placeholder: options.placeholder || "" } })
        : wrap.createEl("input", { type: options.type || "text", value: draft[key], attr: { placeholder: options.placeholder || "" } });
      if (options.area) input.value = draft[key];
      input.addEventListener("input", () => { draft[key] = input.value; });
      return input;
    };
    field("标题", "title");
    field("作者", "authors");
    const pair = scroll.createDiv({ cls: "paperlib-editor-pair" });
    const compactField = (parent, label, key) => {
      const wrap = parent.createDiv({ cls: "paperlib-editor-field" });
      wrap.createEl("label", { text: label });
      const input = wrap.createEl("input", { type: "text", value: draft[key] });
      input.addEventListener("input", () => { draft[key] = input.value; });
    };
    compactField(pair, "年份", "year");
    compactField(pair, "期刊 / 会议", "venue");
    field("期刊 / 会议等级", "venueRanks", { placeholder: "例如：CCF:A；JCR:Q1；中科院:1区" });
    field("摘要", "abstract", { area: true, rows: 7 });
    this.renderEditorChoices(scroll, "Tags", "tag", this.plugin.getAllTags(), selectedTags);
    const collectionChoices = [...new Set([...(this.plugin.settings.collections || []), ...(paper.collections || [])])];
    this.renderEditorChoices(scroll, "Collections", "folder", collectionChoices, selectedCollections);
    field("DOI", "doi");
    field("arXiv", "arxiv");
    field("PDF 路径", "pdfPath");
    field("笔记路径", "notePath");

    const actions = scroll.createDiv({ cls: "paperlib-editor-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => {
      this.plugin.uiState.detailTab = "info";
      this.render({ preserveScroll: false });
    });
    actions.createEl("button", { cls: "mod-cta", text: "保存修改" }).addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!draft.title.trim()) return new Notice("标题不能为空");
      button.disabled = true;
      const identityChanged = paper.title !== draft.title.trim() || paper.doi !== draft.doi.trim();
      Object.assign(paper, {
        title: draft.title.trim(),
        authors: draft.authors.split(";").map((value) => value.trim()).filter(Boolean),
        year: Number.parseInt(draft.year, 10) || 0,
        venue: draft.venue.trim(),
        venueRanks: this.plugin.parseVenueRanksInput(draft.venueRanks),
        abstract: draft.abstract.trim(),
        tags: [...selectedTags],
        collections: [...selectedCollections],
        doi: normalizeDoiInput(draft.doi),
        arxiv: draft.arxiv.trim(),
        pdfPath: draft.pdfPath.trim(),
        notePath: draft.notePath.trim()
      });
      try { await this.plugin.enrichPaperVenueRanks(paper); }
      catch (error) { console.warn("Paper Library: venue rank lookup unavailable", error); }
      if (identityChanged) {
        delete paper.metrics;
        delete paper.relations;
        this.plugin.relationCache.delete(paper.id);
      }
      try {
        await this.plugin.organizePaperFiles(paper);
      } catch (error) {
        console.error("Paper Library: failed to reorganize edited paper", error);
        new Notice(`论文信息已保存，但文件整理失败：${error.message || error}`);
      }
      await this.plugin.saveSettings();
      this.plugin.uiState.detailTab = "info";
      this.plugin.refreshPaperTableViews();
      this.plugin.refreshNavigationViews();
      this.render({ preserveScroll: false });
      new Notice("论文信息已更新");
    });
  }

  renderEditorChoices(parent, label, icon, values, selected) {
    const section = parent.createDiv({ cls: "paperlib-editor-choice-section" });
    section.createEl("label", { text: label });
    const choices = section.createDiv({ cls: "paperlib-editor-choices" });
    if (!values.length) choices.createSpan({ cls: "paperlib-muted", text: `请先在左侧栏创建 ${label}` });
    values.forEach((value) => {
      const choice = choices.createEl("button", { cls: `paperlib-editor-choice ${selected.has(value) ? "is-selected" : ""}`, attr: { title: value } });
      setPaperlibIcon(choice.createSpan(), selected.has(value) ? "check" : icon);
      choice.createSpan({ text: value });
      choice.addEventListener("click", () => {
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        choice.toggleClass("is-selected", selected.has(value));
        const iconEl = choice.querySelector("span");
        if (iconEl) setPaperlibIcon(iconEl, selected.has(value) ? "check" : icon);
      });
    });
  }

  renderPaperData(scroll, paper) {
    const heading = scroll.createDiv({ cls: "paperlib-data-heading" });
    const title = heading.createDiv();
    title.createEl("span", { cls: "paperlib-kicker", text: "Research metrics" });
    title.createEl("h2", { text: paper.title });
    const dataLoading = this.plugin.metricsLoading?.has(paper.id)
      || [...(this.plugin.relationLoading || [])].some((key) => key.startsWith(`${paper.id}:`));
    iconButton(heading, "refresh-cw", "刷新论文数据", () => {
      void (async () => {
        await this.plugin.loadPaperMetrics(paper, true);
        await this.plugin.loadPaperRelations(paper, true);
      })();
    }, dataLoading ? "is-spinning" : "");

    const metrics = paper.metrics;
    const metricsAge = Date.now() - Date.parse(metrics?.updatedAt || "");
    if (metrics && metricsAge > 24 * 60 * 60 * 1000 && !this.plugin.metricsLoading?.has(paper.id)) {
      void this.plugin.loadPaperMetrics(paper);
    }
    if (!metrics) {
      const state = scroll.createDiv({ cls: "paperlib-data-state" });
      setPaperlibIcon(state.createDiv(), "loader-circle");
      state.createEl("h3", { text: "正在获取论文数据" });
      state.createEl("p", { text: "正在匹配论文信息与引用数据，请稍候。" });
      void this.plugin.loadPaperMetrics(paper);
      this.renderCitationRelations(scroll, paper);
      return;
    }
    if (metrics.status !== "ready") {
      const state = scroll.createDiv({ cls: "paperlib-data-state" });
      setPaperlibIcon(state.createDiv(), metrics.status === "not-found" ? "database-zap" : "circle-alert");
      state.createEl("h3", { text: metrics.status === "not-found" ? "没有匹配到论文数据" : "论文数据暂时不可用" });
      state.createEl("p", { text: metrics.message || "请检查 DOI 或标题，然后点击右上角刷新按钮。" });
      this.renderCitationRelations(scroll, paper);
      return;
    }

    const grid = scroll.createDiv({ cls: "paperlib-metrics-grid" });
    this.createMetricCard(grid, "quote", "引用次数", metrics.citations, `${metrics.source} 收录的引用数量`);
    this.createMetricCard(grid, "list-tree", "参考文献", metrics.references, `${metrics.source} 收录的参考文献数量`);
    this.createMetricCard(grid, "calendar-days", "发表年份", metrics.publishedYear || paper.year || "—", "登记的发表年份");
    this.createMetricCard(
      grid,
      "file-type-2",
      "文献类型",
      metrics.type || "—",
      "文献数据库返回的类型（结合本地正式出版信息校正）"
    );

    const details = scroll.createDiv({ cls: "paperlib-data-details" });
    details.createEl("h4", { text: "数据详情" });
    const rows = [
      ["匹配标题", metrics.matchedTitle || paper.title],
      ["出版方", metrics.publisher || "—"],
      ["来源", metrics.source || "Crossref"],
      ["索引更新时间", metrics.indexedAt ? new Date(metrics.indexedAt).toLocaleString() : "—"],
      ["本地刷新时间", metrics.updatedAt ? new Date(metrics.updatedAt).toLocaleString() : "—"]
    ];
    rows.forEach(([label, value]) => {
      const row = details.createDiv({ cls: "paperlib-data-row" });
      row.createSpan({ text: label });
      row.createSpan({ text: String(value) });
    });
    if (metrics.sourceUrl) {
      const link = details.createEl("a", { text: "打开来源记录", href: metrics.sourceUrl });
      link.setAttr("target", "_blank");
    }
    scroll.createEl("p", {
      cls: "paperlib-data-note",
      text: `不同文献数据库的引用统计口径可能不同；这里显示 ${metrics.source} 当前返回的数据。`
    });
    this.renderCitationRelations(scroll, paper);
  }

  renderReferencePageHeader(scroll, paper, sectionLabel) {
    const header = scroll.createDiv({ cls: "paperlib-reference-header" });
    header.createDiv({
      cls: "paperlib-kicker",
      text: [paper.venue, paper.year].filter(Boolean).join(" ") || sectionLabel
    });
    header.createEl("h2", { text: paper.title });
    return header;
  }

  renderPaperAttachments(scroll, paper) {
    scroll.addClass("paperlib-attachments-page");
    this.renderReferencePageHeader(scroll, paper, "Paper files");
    const list = scroll.createDiv({ cls: "paperlib-attachment-list" });
    const items = this.plugin.getPaperAttachmentItems(paper);
    if (!items.length) {
      const empty = list.createDiv({ cls: "paperlib-attachment-empty" });
      setPaperlibIcon(empty.createDiv(), "files");
      empty.createEl("h3", { text: "还没有 PDF 附件" });
      empty.createEl("p", { text: "可添加主论文、补充材料或其他相关 PDF。" });
    } else {
      items.forEach((item) => this.renderAttachmentCard(list, paper, item));
    }

    const picker = scroll.createEl("input", {
      type: "file",
      cls: "paperlib-hidden-file-input",
      attr: { accept: "application/pdf,.pdf", multiple: "" }
    });
    const add = scroll.createEl("button", { cls: "paperlib-add-files-button" });
    setPaperlibIcon(add.createSpan(), "circle-plus");
    add.createSpan({ text: "添加 PDF 文件" });
    add.addEventListener("click", () => picker.click());
    picker.addEventListener("change", async () => {
      const files = Array.from(picker.files || []);
      if (!files.length) return;
      add.disabled = true;
      add.addClass("is-loading");
      try { await this.plugin.addPaperAttachments(paper, files); }
      finally {
        add.disabled = false;
        add.removeClass("is-loading");
        picker.value = "";
      }
    });
  }

  renderAttachmentCard(parent, paper, item) {
    const card = parent.createDiv({ cls: "paperlib-file-card" });
    const preview = card.createDiv({ cls: "paperlib-file-preview" });
    const placeholder = preview.createDiv({ cls: "paperlib-file-preview-placeholder" });
    setPaperlibIcon(placeholder, "file-text");
    const canvas = preview.createEl("canvas");
    void this.plugin.renderPdfThumbnail(item.path, canvas).then((rendered) => {
      if (rendered) placeholder.remove();
      else canvas.remove();
    });

    const content = card.createDiv({ cls: "paperlib-file-content" });
    const controls = content.createDiv({ cls: "paperlib-file-controls" });
    const open = controls.createEl("button", { cls: "paperlib-file-open", text: "打开 PDF" });
    open.addEventListener("click", () => this.plugin.openPdf(item.path));
    const more = controls.createEl("button", { cls: "paperlib-file-more" });
    more.createSpan({ text: "更多" });
    setPaperlibIcon(more.createSpan(), "chevron-down");
    more.addEventListener("click", (event) => this.plugin.showAttachmentMenu(event, paper, item));

    content.createDiv({ cls: "paperlib-file-name", text: item.name });
    const size = content.createDiv({ cls: "paperlib-file-meta", text: this.plugin.formatFileSize(item.size) });
    const pages = content.createDiv({
      cls: "paperlib-file-meta",
      text: item.pageCount ? `${item.pageCount} 页` : "正在读取页数…"
    });
    void this.plugin.ensurePaperAttachmentMetadata(paper, item).then((metadata) => {
      if (!metadata) return;
      size.setText(this.plugin.formatFileSize(metadata.size));
      pages.setText(metadata.pageCount ? `${metadata.pageCount} 页` : "页数未知");
    });
  }

  renderPaperExport(scroll, paper) {
    scroll.addClass("paperlib-export-page");
    this.renderReferencePageHeader(scroll, paper, "Export");
    const styleSection = scroll.createDiv({ cls: "paperlib-citation-style" });
    styleSection.createEl("label", { text: "选择引用样式" });
    const styleSelect = styleSection.createEl("select", { attr: { "aria-label": "选择引用样式" } });
    this.plugin.listCitationStyles().forEach((style) => styleSelect.createEl("option", { text: style.label, value: style.id }));
    styleSelect.value = this.plugin.resolveCitationStyle(this.plugin.uiState.exportStyle).id;
    const preview = styleSection.createDiv({ cls: "paperlib-citation-preview" });
    const previewText = preview.createDiv();
    const copy = preview.createEl("button", { attr: { "aria-label": "复制引用", title: "复制引用" } });
    setPaperlibIcon(copy, "copy");
    const updatePreview = () => {
      const style = this.plugin.resolveCitationStyle(styleSelect.value);
      this.plugin.uiState.exportStyle = style.id;
      previewText.setText(this.plugin.formatCitation(paper, style.id));
    };
    styleSelect.addEventListener("input", updatePreview);
    styleSelect.addEventListener("change", updatePreview);
    copy.addEventListener("click", async () => {
      await this.plugin.copyText(previewText.textContent || "");
      new Notice("引用已复制");
    });
    updatePreview();

    const exports = scroll.createDiv({ cls: "paperlib-export-actions" });
    [
      ["bib", "Export to BibTeX (.bib)"],
      ["ris", "Export to RefMan (.ris)"],
      ["csv", "Comma-separated Values (.csv)"],
      ["xlsx", "Microsoft Excel (.xlsx)"],
      ["json", "Export to JSON (.json)"]
    ].forEach(([format, label]) => {
      const button = exports.createEl("button", { cls: "paperlib-export-button", text: label });
      button.addEventListener("click", () => this.plugin.exportPaper(paper, format));
    });
  }

  renderCitationRelations(parent, paper) {
    const block = parent.createDiv({ cls: "paperlib-relations" });
    const heading = block.createDiv({ cls: "paperlib-relations-heading" });
    heading.createEl("span", { cls: "paperlib-kicker", text: "Citation graph" });
    heading.createEl("h3", { text: "论文关系" });

    const relations = this.plugin.relationCache?.get(paper.id);
    const baseLoading = this.plugin.relationLoading?.has(`${paper.id}:base`);
    if (relations?.status === "ready") this.plugin.reconcilePaperRelationTotals(paper, relations);
    if (relations && !this.plugin.isPaperRelationCacheFresh(relations) && !baseLoading) {
      // Keep showing the last successful result while refreshing it in the background.
      void this.plugin.loadPaperRelations(paper);
    }
    if (!relations) {
      const state = block.createDiv({ cls: "paperlib-relation-loading" });
      setPaperlibIcon(state.createSpan(), "loader-circle");
      state.createSpan({ text: "正在加载引用关系…" });
      void this.plugin.loadPaperRelations(paper);
      return;
    }
    if (relations.status !== "ready") {
      const state = block.createDiv({ cls: "paperlib-relation-error" });
      setPaperlibIcon(state.createSpan(), relations.status === "not-found" ? "search-x" : "circle-alert");
      state.createSpan({ text: relations.message || "引用关系数据暂时不可用。" });
      return;
    }
    void this.plugin.prefetchSemanticScholarRelationCache(paper, relations);
    this.renderRelationSection(block, paper, "citedBy", "被引论文", "quote");
    this.renderRelationSection(block, paper, "references", "引用列表", "list-tree");
  }

  renderRelationSection(parent, paper, type, title, icon) {
    const relations = this.plugin.relationCache.get(paper.id);
    const relation = relations?.[type] || { items: [], total: 0 };
    const loadingKey = `${paper.id}:${type}`;
    const loading = this.plugin.relationLoading.has(loadingKey);
    const visibleLimit = relation.visibleLimit || 5;
    const displayCap = this.plugin.getPaperRelationDisplayCap();
    const section = parent.createDiv({ cls: "paperlib-relation-section" });
    const header = section.createDiv({ cls: "paperlib-relation-header" });
    const label = header.createDiv();
    setPaperlibIcon(label.createSpan(), icon);
    label.createEl("h4", { text: title });
    label.createSpan({
      cls: "paperlib-relation-count",
      text: this.plugin.paperRelationCountLabel(relation)
    });

    const list = section.createDiv({ cls: "paperlib-relation-list" });
    const visibleItems = relation.items.slice(0, visibleLimit);
    if (!visibleItems.length) list.createDiv({
      cls: "paperlib-relation-empty",
      text: relation.loadFailed ? "此部分暂时无法加载，可稍后手动刷新" : "暂无可显示的论文"
    });
    visibleItems.forEach((item) => {
      const row = list.createDiv({ cls: "paperlib-relation-item" });
      const link = row.createEl("a", { text: item.title || "Untitled work", href: item.url || item.id });
      link.setAttr("target", "_blank");
      const meta = [item.year, item.venue, item.authors?.slice(0, 2).join("、")].filter(Boolean).join(" · ");
      if (meta) row.createDiv({ cls: "paperlib-relation-meta", text: meta });
    });

    if (relation.total > 5 || relation.items.length > 5 || !relation.allLoaded) {
      const controls = section.createDiv({ cls: "paperlib-relation-controls" });
      if (visibleLimit > 5) {
        const collapse = controls.createEl("button", { cls: "paperlib-relation-toggle is-secondary" });
        setPaperlibIcon(collapse.createSpan(), "chevron-up");
        collapse.createSpan({ text: "收起到 5 篇" });
        collapse.addEventListener("click", () => this.plugin.collapsePaperRelation(paper, type));
      }
      const paginationTotal = this.plugin.paperRelationPaginationTotal(relation);
      const nextLimit = this.plugin.nextPaperRelationLimit(visibleLimit, paginationTotal);
      const canRevealCached = relation.items.length > visibleLimit;
      const canLoadMore = nextLimit > visibleLimit && (canRevealCached || !relation.allLoaded);
      if (canLoadMore) {
        const more = controls.createEl("button", { cls: "paperlib-relation-toggle" });
        if (loading) {
          setPaperlibIcon(more.createSpan(), "loader-circle");
          more.createSpan({ text: "正在加载…" });
          more.disabled = true;
        } else {
          setPaperlibIcon(more.createSpan(), "list-plus");
          more.createSpan({ text: `显示至 ${nextLimit} 篇` });
          more.addEventListener("click", () => this.plugin.loadMorePaperRelation(paper, type));
        }
      } else if (paginationTotal >= displayCap && visibleLimit >= displayCap) {
        const suffix = relation.totalKnown === false ? "" : ` / ${relation.total}`;
        controls.createDiv({ cls: "paperlib-relation-limit", text: `已达到显示上限 ${displayCap}${suffix}` });
      }
    }
  }

  createMetricCard(parent, icon, label, value, description) {
    const card = parent.createDiv({ cls: "paperlib-metric-card" });
    setPaperlibIcon(card.createDiv({ cls: "paperlib-metric-icon" }), icon);
    card.createEl("strong", { text: String(value ?? 0) });
    card.createSpan({ cls: "paperlib-metric-label", text: label });
    card.createSpan({ cls: "paperlib-metric-description", text: description });
  }

  renderChipSection(parent, title, values, scopeType, paper, key) {
    const section = parent.createDiv({ cls: "paperlib-meta-section" });
    const header = section.createDiv({ cls: "paperlib-meta-title" });
    header.createEl("h4", { text: title });
    iconButton(header, "pencil", `编辑 ${title}`, () => this.plugin.editPaperInSidebar(paper));
    const chips = section.createDiv({ cls: "paperlib-chips" });
    if (!values.length) chips.createSpan({ cls: "paperlib-muted", text: "None" });
    values.forEach((value) => {
      const chip = chips.createEl("button", { cls: "paperlib-chip", text: value, attr: { title: value } });
      chip.addEventListener("click", () => {
        this.selectScope(`${scopeType}:${value}`);
      });
    });
    void key;
  }

  createIdentifier(parent, type, value, url) {
    const row = parent.createDiv({ cls: "paperlib-identifier" });
    row.createSpan({ cls: "paperlib-identifier-type", text: type });
    const link = row.createEl("a", { text: truncate(value, 34), href: url });
    link.setAttr("target", "_blank");
    iconButton(row, "copy", `复制 ${type}`, async () => {
      await navigator.clipboard.writeText(value);
      new Notice(`${type} 已复制`);
    });
  }
}

class PaperLibraryNavigationView extends PaperLibraryView {
  getViewType() { return NAV_VIEW_TYPE; }
  getDisplayText() { return "Paper Library"; }
  getIcon() { return "library"; }

  render() {
    const root = itemViewContentRoot(this);
    if (!root) return;
    root.empty();
    root.addClass("paperlib-native-sidebar");
    root.toggleClass("paperlib-mobile-layout", this.plugin.isMobileApp());
    this.plugin.applyLibraryViewStyle(root);
    this.lockSidebarViewport(root);
    const sidebar = root.createDiv({ cls: "paperlib-sidebar" });
    this.renderSidebar(sidebar);
    this.bindSidebarScrollbarVisibility(root, sidebar);
  }

  lockSidebarViewport(root) {
    this.sidebarViewportCleanup?.();
    // The root is already clipped by CSS. Event-level scroll locking here used
    // to reset scrollTop on every wheel gesture, which also pulled nested sidebar
    // scrollers back to the top in some Obsidian/Electron layouts.
    root.scrollLeft = 0;
    root.scrollTop = 0;
    this.sidebarViewportCleanup = null;
  }

  bindSidebarScrollbarVisibility(root, sidebar) {
    const workspaceLeaf = root.closest?.('.workspace-leaf-content[data-type="paper-library-navigation-view"]');
    const surfaces = [...new Set([
      workspaceLeaf,
      root,
      sidebar,
      ...sidebar.querySelectorAll(".paperlib-nav, .paperlib-paperglass-tag-list"),
    ].filter(Boolean))];
    const hideTimers = new Map();
    const listeners = [];

    for (const surface of surfaces) {
      const onScroll = () => {
        surface.classList.add("is-scrollbar-visible");
        const previousTimer = hideTimers.get(surface);
        if (previousTimer) window.clearTimeout(previousTimer);
        const timer = window.setTimeout(() => {
          surface.classList.remove("is-scrollbar-visible");
          hideTimers.delete(surface);
        }, 560);
        hideTimers.set(surface, timer);
      };
      surface.addEventListener("scroll", onScroll, { passive: true });
      listeners.push([surface, onScroll]);
    }

    this.sidebarViewportCleanup = () => {
      for (const [surface, onScroll] of listeners) {
        surface.removeEventListener("scroll", onScroll);
        surface.classList.remove("is-scrollbar-visible");
      }
      for (const timer of hideTimers.values()) window.clearTimeout(timer);
      hideTimers.clear();
    };
  }
}

class PaperLibraryDetailView extends PaperLibraryView {
  getViewType() { return DETAIL_VIEW_TYPE; }
  getDisplayText() { return "Paper Details"; }
  getIcon() { return "info"; }

  render(options = {}) {
    const root = itemViewContentRoot(this);
    if (!root) return;
    const previousScroll = options.preserveScroll === false
      ? 0
      : Math.max(0, Number(root.querySelector?.(".paperlib-detail-scroll")?.scrollTop) || 0);
    root.empty();
    root.addClass("paperlib-native-detail");
    root.toggleClass("paperlib-mobile-layout", this.plugin.isMobileApp());
    this.plugin.applyLibraryViewStyle(root);
    this.renderDetail(root.createDiv({ cls: "paperlib-detail" }));
    if (previousScroll > 0) {
      const restore = () => {
        const scroll = root.querySelector?.(".paperlib-detail-scroll");
        if (scroll) scroll.scrollTop = previousScroll;
      };
      restore();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
    }
  }
}

export { PaperLibraryDetailView, PaperLibraryNavigationView, PaperLibraryView };
