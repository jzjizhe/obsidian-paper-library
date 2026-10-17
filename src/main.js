import * as pdfLib from "../vendor/pdf-lib.min.js";
import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  addIcon,
  requireApiVersion,
  loadPdfJs,
  normalizePath,
  requestUrl,
  setIcon,
} from "obsidian";
const {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
} = pdfLib;
import {
  CITATION_STYLES,
  citationFieldBag,
  citationFamilyName,
  csvEscape,
  formatCitationAuthors,
  isLikelyChinesePersonalName,
  normalizeCitationAuthorRules,
  normalizeConferenceVenueLookup,
  normalizeVenueLookup,
  parseCslStyleToTemplate,
  parseCsvLine,
  renderCitationTemplate,
  validateCitationTemplate,
  xmlEscape
} from "./citation-engine.js";
import {
  ALL_VIEW_TYPES,
  CANVAS_HIGHLIGHT_COLORS,
  CLAUDIAN_COLLAB_DETAIL_VIEW_TYPE,
  CLAUDIAN_VIEW_TYPE,
  CLAUDIAN_VIEW_TYPES,
  DEFAULT_PAPER_TABLE_COLUMN_ORDER,
  DEFAULT_RESEARCH_WORKSPACE_ZOOM,
  DEFAULT_SETTINGS,
  DETAIL_VIEW_TYPE,
  FAVORITE_COLORS,
  LEGACY_CLAUDIAN_VIEW_TYPES,
  NAV_VIEW_TYPE,
  PAPER_COMPOSER_CHATGPT_BUNDLED_CODEX_PATH,
  PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL,
  PAPER_COMPOSER_CLI_PROVIDERS,
  PAPER_COMPOSER_ICON,
  PAPER_COMPOSER_MODEL_OPTIONS_VERSION,
  PAPER_TABLE_COLUMNS,
  PAPER_TABLE_COLUMN_META,
  RESEARCH_VIEW_TYPE,
  VIEW_TYPE,
  favoriteColorValue,
  normalizeFavoriteColor
} from "./constants.js";
import {
  PAPER_LIBRARY_RELEASES_API,
  PAPER_LIBRARY_UPDATE_REQUIRED_FILES,
  comparePaperLibraryVersions,
  isPaperLibraryReleaseFile,
  isSafePaperLibraryZipEntry,
  normalizePaperLibraryReleaseVersion,
  selectPaperLibraryReleaseAsset
} from "./update-checker.js";
import { DEMO_COLLECTIONS, DEMO_PAPER_IDS, DEMO_TAGS, SAMPLE_PAPERS } from "./demo-data.js";
import {
  APPEARANCE_PROTOCOL_VERSION,
  LIBRARY_APPEARANCES,
  appearanceContrastColor,
  normalizeAppearanceBase,
  normalizeAppearanceColor,
  normalizeCustomAppearanceId,
  normalizeCustomAppearanceProfiles,
  normalizeLibraryAppearance
} from "./appearance.js";
import { arrayBufferToBase64, arrayBufferToDataUrl, base64ToArrayBuffer, bytesContainAscii, createStoredZip } from "./binary-utils.js";
import {
  TITLE_MATCH_THRESHOLD,
  authorListSimilarity,
  chooseMetadataAuthors,
  crossrefVenue,
  displayPublicationType,
  fileNameToTitle,
  formatCrossrefAuthor,
  hasCjkText,
  hasFormalPublicationVenue,
  isPreprintLikeCrossref,
  isPreprintLikeType,
  isTitleSufficientForLookup,
  normalizeTitleForMatch,
  publicationTypeContext,
  splitMetadataAuthors,
  titleSimilarity
} from "./metadata-match.js";
import { STAR_FEEDBACK_DELAY, highlighterCursor, iconButton, isPaperLibraryMobile, itemViewContentRoot, setPaperlibIcon } from "./ui-utils.js";
import { decodeEntities, formatAIFileSize, formatAIRemainingTime, markdownText, stripMarkup, truncate } from "./text-utils.js";
import {
  arxivIdFromDoi,
  isArxivDoi,
  isPlausiblePaperYear,
  normalizeArxivId,
  normalizeDoiInput,
  normalizePaperTag,
  normalizePaperTags,
  safeFileName,
  uniqueId,
  workspaceId,
  yearFromArxivId
} from "./paper-utils.js";
import {
  collectionBaseName,
  collectionParentPath,
  collectionPathContains,
  expandCollectionPaths,
  normalizeCollectionPath,
  safeCollectionPath
} from "./collection-utils.js";
import { CslImportModal, CitationStyleModal } from "./modals/citation.js";
import { ClearAnnotationsModal, PdfAnnotationsModal } from "./modals/annotations.js";
import {
  DeleteCollectionModal,
  DeleteFigureRecognitionRuntimeModal,
  DeleteLocalPipelineModal,
  DeletePaperModal,
  DeletePapersModal,
  DeleteTagModal
} from "./modals/delete.js";
import { PdfFigureCarouselModal, PdfFigureGalleryModal } from "./modals/figures.js";
import { ConferenceFollowModal, NativePdfAnnotationModal } from "./modals/misc.js";
import { AddPaperModal, PaperFormModal, TagModal } from "./modals/paper-form.js";
import { EnableFigureRecognitionModal, InstallLocalPipelineModal } from "./modals/pipeline.js";
import { PaperLibrarySettingTab } from "./settings.js";
import {
  cacheSemanticScholarPaper,
  createSemanticScholarMetrics,
  getCachedSemanticScholarPaper,
  mapSemanticScholarPaper,
  mapSemanticScholarRelationItem,
  mergeSemanticScholarFallback,
  prefetchSemanticScholarRelationCache,
  requestSemanticScholar,
  resolveSemanticScholarPaper,
  resolveSemanticScholarPaperUncached,
  scheduleSemanticScholarCacheSave,
  semanticScholarDelay,
  semanticScholarErrorStatus,
  semanticScholarPaperAliasKeys,
  semanticScholarRetryDelay,
  semanticScholarSearchQuery,
  semanticScholarVenue,
  useSemanticScholar
} from "./services/semantic-scholar.js";
import {
  clearPdfFigureRecognitionState,
  computePdfFigureCacheKey,
  createPdfFigureCatalog,
  createRecognizedPdfFigureDragPreview,
  emitPdfFigureProgress,
  exportPdfFigureHighResolution,
  getPdfFigureCatalog,
  getPortablePdfFigurePayload,
  installPdfFigureDragZones,
  loadPdfFigureDocument,
  migratePortablePdfFigureCatalogs,
  openPdfFigureAtPoint,
  openPdfFigureGallery,
  paintDocLayoutFigure,
  paintPdfImageObject,
  pdfFigureDragToAIAttachment,
  readRecognizedPdfFigureAsset,
  readSyncedPdfFigurePayload,
  renderPdfFigure,
  renderPdfFigureCrop,
  renderPdfThumbnail,
  resolveRecognizedPdfFigureCache,
  sanitizePortablePdfFigurePayload,
  setPortablePdfFigurePayload
} from "./services/pdf-figures.js";
import {
  checkForPaperLibraryUpdate,
  collectPaperLibraryUpdateFiles,
  extractPaperLibraryUpdate,
  installPaperLibraryUpdate,
  listPaperLibraryZipEntries
} from "./services/self-update.js";
import { PaperResearchWorkspaceView } from "./research-workspace-view.js";
import { PaperLibraryDetailView, PaperLibraryNavigationView, PaperLibraryView } from "./library-view.js";
import {
  CCFDDL_ACCEPTANCE_BASE_URL,
  CCFDDL_CONFERENCE_DATABASE_URL,
  CONFERENCE_RANKING_DATABASE_MAX_AGE,
  CONFERENCE_RANKING_HISTORICAL_ALIASES,
  CONFERENCE_RATE_DATABASE_MAX_AGE,
  CS_CONF_STATS_URL,
  SHOW_JCR,
  findVenueRankingRule,
  inferScholarPublication,
  isRepositoryVenue
} from "./venue-rankings.js";

function aiMimeForName(name = "") {
  const extension = String(name).split(".").pop().toLocaleLowerCase();
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml"
  })[extension] || "application/octet-stream";
}

function aiAttachmentIcon(type) {
  return ({ image: "image", pdf: "file-text", node: "sticky-note", paper: "book-open", selection: "text-quote" })[type]
    || "paperclip";
}

class PaperLibraryPlugin extends Plugin {
  // 供单元测试访问的模块级纯函数（Obsidian 运行时不使用）
  static citationInternals = {
    parseCslStyleToTemplate,
    renderCitationTemplate,
    citationFieldBag,
    validateCitationTemplate,
    formatCitationAuthors
  };

  static updateInternals = {
    normalizePaperLibraryReleaseVersion,
    comparePaperLibraryVersions,
    selectPaperLibraryReleaseAsset,
    isSafePaperLibraryZipEntry,
    isPaperLibraryReleaseFile
  };

  removeLegacyComposerSettingTabs() {
    const setting = this.app.setting;
    if (!setting || !Array.isArray(setting.pluginTabs) || typeof setting.removeSettingTab !== "function") return;
    const legacyTabs = setting.pluginTabs.filter((tab) => {
      const id = String(tab?.id || tab?.plugin?.manifest?.id || "");
      const navLabel = String(tab?.navEl?.textContent || "").trim();
      // Also clear a stale parent-id tab left by a hot reload. The current
      // Paper Library tab is registered immediately after this cleanup.
      return id === "paper-library-claudian-runtime"
        || id === "paper-library-paper-composer-runtime"
        || id === this.manifest.id
        || navLabel === "Paper Composer";
    });
    legacyTabs.forEach((tab) => setting.removeSettingTab(tab));
  }

  registerPaperComposerIcon() {
    addIcon(PAPER_COMPOSER_ICON, [
      '<g transform="scale(4.1666667)">',
      '<path d="M6 2.75h7.5L18 7.25v14H6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
      '<path d="M13.5 2.75v4.5H18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
      '<path d="m10 9 .55 1.45L12 11l-1.45.55L10 13l-.55-1.45L8 11l1.45-.55z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>',
      '<path d="m14.5 13 .75 1.75L17 15.5l-1.75.75L14.5 18l-.75-1.75L12 15.5l1.75-.75z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>',
      '</g>'
    ].join(""));
  }

  refreshPaperComposerLeafIcon(leaf) {
    if (!leaf) return;
    this.registerPaperComposerIcon();
    leaf.updateHeader?.();
    const targets = new Set([
      leaf.tabHeaderInnerIconEl,
      leaf.tabHeaderEl?.querySelector?.(".workspace-tab-header-inner-icon"),
      leaf.view?.containerEl?.querySelector?.(".view-header-icon")
    ].filter(Boolean));
    targets.forEach((element) => setPaperlibIcon(element, PAPER_COMPOSER_ICON));
  }

  checkForPaperLibraryUpdate(...args) {
    return checkForPaperLibraryUpdate(this, ...args);
  }

  listPaperLibraryZipEntries(...args) {
    return listPaperLibraryZipEntries(this, ...args);
  }

  extractPaperLibraryUpdate(...args) {
    return extractPaperLibraryUpdate(this, ...args);
  }

  collectPaperLibraryUpdateFiles(...args) {
    return collectPaperLibraryUpdateFiles(this, ...args);
  }

  installPaperLibraryUpdate(...args) {
    return installPaperLibraryUpdate(this, ...args);
  }


  async onload() {
    this.removeLegacyComposerSettingTabs();
    this.registerPaperComposerIcon();
    // Paper AI was a temporary standalone transport. Upgrades must also
    // remove its persisted sidebar leaf so Paper Composer is the only AI UI.
    this.app.workspace.detachLeavesOfType("paper-library-ai-view");
    LEGACY_CLAUDIAN_VIEW_TYPES.forEach((type) => this.app.workspace.detachLeavesOfType(type));
    this.mobile = isPaperLibraryMobile();
    this.settingsSaveQueue = Promise.resolve();
    this.settingsSyncPollActive = false;
    this.activePaperImportIds = new Set();
    this.claudianRuntime = null;
    this.claudianSettingTab = null;
    this.paperLibrarySettingTab = null;
    this.paperLibraryUpdatePromise = null;
    this.claudianStyleEl = null;
    this.claudianLoadError = null;
    this.composerPdfTabs = new Set();
    this.composerMountObserver = null;
    await this.loadSettings();
    this.installCustomAppearanceStyle();
    this.lastAnnotationKey = "";
    this.metricsLoading = new Set();
    this.infoLoading = new Set();
    this.relationCache = new Map();
    this.relationLoading = new Set();
    this.restorePaperRelationCache();
    this.attachmentMetadataLoading = new Map();
    this.jcrRankIndex = null;
    this.jcrRankLoading = null;
    this.conferenceRateLoading = new Map();
    this.conferenceRateDatabaseLoading = null;
    this.conferenceRateDatabaseLastAttemptAt = 0;
    this.conferenceRankingDatabaseLoading = null;
    this.conferenceRankingDatabaseLastAttemptAt = 0;
    this.conferenceRankingLookup = null;
    this.pdfMutationQueues = new Map();
    this.pendingPdfAnnotationSyncs = new Map();
    this.nativePdfPageSizeCache = new Map();
    this.nativeOwnAnnotationIdsCache = { key: "", annotations: Promise.resolve(new Map()) };
    this.nativeOverlayHidden = false;
    this.nativeEmbeddedHidden = false;
    this.nativeAnnotationLayersHidden = false;
    this.nativeSelectionToolbarCleanup = null;
    this.paperReadingPositions = new Map();
    this.paperReadingPositionTimer = null;
    this.nativePdfPositionSuppressUntil = 0;
    this.nativePdfStates = new WeakMap();
    this.nativePdfBindings = new WeakMap();
    this.nativePdfBindingList = [];
    this.nativeSelectionDragCleanup = null;
    this.nativeSelectionDrag = null;
    this.nativeInkDrawingCleanup = null;
    this.pdfInkRegionDragCleanup = null;
    this.pdfInkRegionDrag = null;
    this.pdfInkContextMenuSuppressedUntil = 0;
    this.pdfInkContextMenuCleanup = null;
    this.pdfFigureCatalogCache = new Map();
    this.pdfFigureCatalogLoading = new Map();
    this.pdfFigureProgressListeners = new Map();
    this.pdfFigureAssetCache = new Map();
    this.pdfFigureAssetDirectoryCache = new Map();
    this.pdfFigureOpenBusy = new Set();
    this.figureRuntimeInstallPromise = null;
    this.expandedAbstractIds = new Set();
    this.serpApiAccountStatus = null;
    this.serpApiMissingKeyNotified = false;
    this.semanticScholarRequestQueue = Promise.resolve();
    this.semanticScholarLastRequestAt = 0;
    this.semanticScholarPaperLookups = new Map();
    this.semanticScholarCacheSaveTimer = null;
    this.semanticRelationPrefetches = new Map();
    this.dailyRecommendationLoading = null;
    this.dailyRecommendationLastAttemptAt = 0;
    this.uiState = {
      scope: "all",
      selectedId: this.settings.papers[0]?.id || null,
      activePdfPaperId: null,
      detailTab: "info",
      exportStyle: "apa-7"
    };
    this.registerView(VIEW_TYPE, (leaf) => new PaperLibraryView(leaf, this));
    this.registerView(NAV_VIEW_TYPE, (leaf) => new PaperLibraryNavigationView(leaf, this));
    this.registerView(DETAIL_VIEW_TYPE, (leaf) => new PaperLibraryDetailView(leaf, this));
    this.registerView(RESEARCH_VIEW_TYPE, (leaf) => new PaperResearchWorkspaceView(leaf, this));
    try { await this.loadEmbeddedClaudian(); }
    catch (error) {
      this.claudianLoadError = error;
      console.error("Paper Library: Paper Composer runtime failed to load", error);
    }
    this.installClaudianDropBridge();
    this.installPaperComposerWorkspaceBridge();
    this.addRibbonIcon("library", "Open Paper Library", () => this.activateView());
    const composerRibbon = this.addRibbonIcon(PAPER_COMPOSER_ICON, "Open Paper Composer", () => this.openSmartComposer());
    setPaperlibIcon(composerRibbon, PAPER_COMPOSER_ICON);
    this.addCommand({ id: "open-paper-library", name: "Open paper library", callback: () => this.activateView() });
    this.addCommand({
      id: "open-daily-research-board",
      name: "Open daily research board",
      callback: () => {
        this.uiState.scope = "daily";
        this.refreshLibraryScopeViews();
        return this.activateMainView(true);
      }
    });
    this.addCommand({ id: "open-paper-navigation", name: "Open paper navigation in left sidebar", callback: () => this.ensureNavigationView(true) });
    this.addCommand({ id: "open-paper-details", name: "Open paper details in right sidebar", callback: () => this.ensureDetailView(true) });
    this.addCommand({
      id: "toggle-paper-library-view-style",
      name: "Toggle standard / gallery library view",
      callback: () => this.toggleLibraryViewStyle()
    });
    this.addCommand({
      id: "open-research-workspace",
      name: "Open Liquid-style research workspace",
      callback: () => {
        const paper = this.settings.papers.find((item) => item.id === this.uiState.selectedId);
        if (!paper) return new Notice("请先在论文库中选择一篇论文");
        return this.openResearchWorkspace(paper, this.app.workspace.activeLeaf, true);
      }
    });
    this.addCommand({ id: "add-paper", name: "Add paper", callback: () => new AddPaperModal(this.app, this).open() });
    this.addCommand({
      id: "merge-overlapping-highlights",
      name: "合并重叠的重复标注",
      callback: async () => {
        const leaves = this.app.workspace.getLeavesOfType?.("pdf") || [];
        const active = this.app.workspace.activeLeaf;
        const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
        const file = leaf?.view?.file;
        const paper = file ? this.getPaperForPdfFile(file) : null;
        if (!file || !paper) {
          new Notice("请先打开一篇已加入论文库的 PDF");
          return;
        }
        const path = normalizePath(file.path);
        const marks = (this.ensureResearchWorkspace(paper).highlights || [])
          .filter((mark) => normalizePath(mark.pdfPath || paper.pdfPath || "") === path)
          .sort((first, second) => String(first.createdAt || "").localeCompare(String(second.createdAt || "")));
        const kept = [];
        const duplicates = [];
        for (const mark of marks) {
          const union = this.getPdfRectsUnion(mark.pdfRects);
          if (!union) { kept.push(mark); continue; }
          const overlap = kept.find((other) => {
            if (Number(other.page) !== Number(mark.page)) return false;
            const otherUnion = this.getPdfRectsUnion(other.pdfRects);
            return otherUnion ? this.pdfRectsOverlapRatio(union, otherUnion) >= 0.9 : false;
          });
          if (overlap) duplicates.push(mark);
          else kept.push(mark);
        }
        if (!duplicates.length) {
          new Notice("没有发现重叠的重复标注");
          return;
        }
        for (const mark of duplicates) {
          try {
            await this.removeCanvasHighlights(paper, [mark.id]);
          } catch (error) {
            console.error("Paper Library: failed to remove duplicate highlight", error);
          }
        }
        new Notice(`已合并 ${duplicates.length} 条重叠标注（保留最新的一条），请确认效果`);
      }
    });
    this.addCommand({
      id: "rewrite-pdf-annotations",
      name: "重写 PDF 内嵌批注（去除外观流）",
      callback: async () => {
        const leaves = this.app.workspace.getLeavesOfType?.("pdf") || [];
        const active = this.app.workspace.activeLeaf;
        const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
        const file = leaf?.view?.file;
        const paper = file ? this.getPaperForPdfFile(file) : null;
        if (!file || !paper) {
          new Notice("请先打开一篇已加入论文库的 PDF");
          return;
        }
        const path = normalizePath(file.path);
        const marks = (this.ensureResearchWorkspace(paper).highlights || []).filter((mark) => (
          normalizePath(mark.pdfPath || paper.pdfPath || "") === path
            && Array.isArray(mark.pdfRects) && mark.pdfRects.length
        ));
        let written = 0;
        try {
          await this.mutateLocalPdf(path, async (document) => {
            // 一次写入内完成：清空本插件的全部注释，再按库内标注重建（不带外观流）
            document.getPages().forEach((page) => {
              const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
              if (!annots) return;
              for (let index = annots.size() - 1; index >= 0; index -= 1) {
                const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
                if (!dictionary) continue;
                const idValue = document.context.lookupMaybe(dictionary.get(PDFName.of("NM")), PDFString, PDFHexString);
                const value = idValue?.decodeText?.() || idValue?.asString?.() || "";
                if (value.startsWith("paperlib:")) annots.remove(index);
              }
            });
            marks.forEach((mark) => {
              if (this.writeLocalPdfAnnotation(document, mark)) written += 1;
            });
            return true;
          });
        } catch (error) {
          console.error("Paper Library: failed to rewrite PDF annotations", error);
          new Notice(`重写失败：${error.message || error}`);
          return;
        }
        new Notice(`已重写 ${written} 条批注（去除外观流），并清理孤儿注释`);
      }
    });
    this.addCommand({
      id: "debug-hide-annotation-layers",
      name: "调试：显示/隐藏所有注释层容器",
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType?.("pdf") || [];
        const active = this.app.workspace.activeLeaf;
        const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
        const container = leaf?.view?.containerEl;
        if (!container) {
          new Notice("请先打开一个 PDF");
          return;
        }
        this.nativeAnnotationLayersHidden = !this.nativeAnnotationLayersHidden;
        const layers = [...container.querySelectorAll(".annotationLayer, .annotationEditorLayer")];
        layers.forEach((layer) => { layer.style.display = this.nativeAnnotationLayersHidden ? "none" : ""; });
        new Notice(this.nativeAnnotationLayersHidden
          ? `已隐藏 ${layers.length} 个注释层容器（高亮若仍可见则说明画在页面画布上）`
          : "已恢复注释层容器");
      }
    });
    this.addCommand({
      id: "debug-toggle-embedded-highlights",
      name: "调试：显示/隐藏所有内嵌高亮注释",
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType?.("pdf") || [];
        const active = this.app.workspace.activeLeaf;
        const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
        const container = leaf?.view?.containerEl;
        if (!container) {
          new Notice("请先打开一个 PDF");
          return;
        }
        this.nativeEmbeddedHidden = !this.nativeEmbeddedHidden;
        container.querySelectorAll(".highlightAnnotation").forEach((element) => {
          element.style.display = this.nativeEmbeddedHidden ? "none" : "";
        });
        new Notice(this.nativeEmbeddedHidden
          ? `已隐藏 ${container.querySelectorAll(".highlightAnnotation").length} 个内嵌高亮注释元素`
          : "已恢复内嵌高亮注释显示");
      }
    });
    this.addCommand({
      id: "debug-toggle-pdf-highlight-overlay",
      name: "调试：显示/隐藏高亮覆盖层",
      callback: () => {
        const leaves = this.app.workspace.getLeavesOfType?.("pdf") || [];
        const active = this.app.workspace.activeLeaf;
        const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
        const container = leaf?.view?.containerEl;
        if (!container) {
          new Notice("请先打开一个 PDF");
          return;
        }
        this.nativeOverlayHidden = !this.nativeOverlayHidden;
        container.querySelectorAll(".paperlib-native-pdf-highlight-layer").forEach((layer) => {
          layer.style.display = this.nativeOverlayHidden ? "none" : "";
        });
        new Notice(this.nativeOverlayHidden ? "已隐藏高亮覆盖层（PDF 自身渲染仍可见则说明注释被画进页面）" : "已恢复高亮覆盖层");
      }
    });
    this.addCommand({
      id: "debug-native-pdf-annotations",
      name: "调试：输出 PDF 注释层结构",
      callback: async () => {
        const leaves = this.app.workspace.getLeavesOfType?.("pdf") || [];
        const active = this.app.workspace.activeLeaf;
        const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
        const file = leaf?.view?.file;
        const container = leaf?.view?.containerEl;
        if (!file || !container) {
          console.warn("[Paper Library debug] 没有激活的 PDF 视图");
          new Notice("请先打开一个 PDF 再运行诊断");
          return;
        }
        const pageEls = [...container.querySelectorAll(".page")];
        const diagnostics = {
          file: file.path,
          pageCount: pageEls.length,
          containerClasses: String(container.className || ""),
          containerChildren: [...container.children].map((el) => `${el.tagName}.${String(el.className?.baseVal ?? el.className)}`).slice(0, 20),
          canvasCount: container.querySelectorAll("canvas").length,
          annotationLikeElements: [...container.querySelectorAll("[class*='annot' i], [data-annotation-id]")]
            .slice(0, 20)
            .map((el) => `${el.tagName}.${String(el.className?.baseVal ?? el.className)}#${el.getAttribute?.("data-annotation-id") || ""}`),
          highlightAnnotationCount: container.querySelectorAll(".highlightAnnotation").length,
          annotationLayers: [...container.querySelectorAll(".annotationLayer")].map((layer) => ({
            parentClass: String(layer.parentElement?.className || ""),
            pageNumber: layer.closest(".page")?.dataset?.pageNumber || layer.parentElement?.dataset?.pageNumber || "",
            sectionCount: layer.querySelectorAll("section").length,
            highlightIds: [...layer.querySelectorAll(".highlightAnnotation")].map((el) => el.getAttribute("data-annotation-id"))
          })),
          pages: []
        };
        let ownIds = new Map();
        try {
          ownIds = await this.getNativePdfOwnAnnotations(file);
        } catch (error) {
          diagnostics.ownIdsError = String(error?.message || error);
        }
        diagnostics.ownIds = [...ownIds.entries()].map(([page, list]) => [page, list.map((annotation) => annotation.id)]);
        {
          const paper = this.getPaperForPdfFile(file);
          const highlights = paper ? (this.ensureResearchWorkspace(paper).highlights || []) : [];
          const path = normalizePath(file.path);
          diagnostics.libraryHighlights = highlights
            .filter((mark) => normalizePath(mark.pdfPath || paper?.pdfPath || "") === path)
            .map((mark) => ({
              id: mark.id,
              page: mark.page,
              color: mark.color,
              rects: (mark.pdfRects || []).map((item) => (item.rect || []).map((value) => Math.round(value))),
              createdAt: mark.createdAt || ""
            }));
        }
        try {
          const buffer = await this.readPdfBinary(file);
          const pdfjs = await loadPdfJs();
          const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
          try {
            diagnostics.highlightAnnotations = [];
            for (let pageNumber = 1; pageNumber <= (document.numPages || 0); pageNumber += 1) {
              const page = await document.getPage(pageNumber);
              const annotations = await page.getAnnotations();
              (annotations || []).forEach((annotation) => {
                if (String(annotation.subtype || "").toLowerCase() !== "highlight") return;
                diagnostics.highlightAnnotations.push({
                  page: pageNumber,
                  id: annotation.id,
                  titleStr: annotation.titleObj?.str || "",
                  hasAppearance: Boolean(annotation.hasAppearance),
                  hasOwnCanvas: Boolean(annotation.hasOwnCanvas),
                  rect: (annotation.rect || []).map((value) => Math.round(value)),
                  keys: Object.keys(annotation)
                });
              });
            }
          } finally {
            await document.destroy?.();
          }
        } catch (error) {
          diagnostics.highlightAnnotationsError = String(error?.message || error);
        }
        {
          const allOwn = new Set();
          for (const list of ownIds.values()) for (const annotation of list) allOwn.add(String(annotation.id));
          diagnostics.ownDomHits = [...container.querySelectorAll("[data-annotation-id]")]
            .map((el) => ({
              id: el.getAttribute("data-annotation-id"),
              className: String(el.className?.baseVal ?? el.className),
              display: el.ownerDocument?.defaultView?.getComputedStyle?.(el)?.display || "",
              rect: (() => { const r = el.getBoundingClientRect?.(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null; })()
            }))
            .filter((item) => allOwn.has(item.id));
          diagnostics.ownIdsMissingDom = [...allOwn].filter((id) => !diagnostics.ownDomHits.some((hit) => hit.id === id));
        }
        try {
          const buffer = await this.readPdfBinary(file);
          const pdfjs = await loadPdfJs();
          const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
          try {
            const page = await document.getPage(1);
            const annotations = await page.getAnnotations();
            diagnostics.annotationSample = (annotations || []).slice(0, 5).map((annotation) => ({
              id: annotation.id,
              subtype: annotation.subtype,
              titleStr: annotation.titleObj?.str || "",
              nm: annotation.nm || "",
              keys: Object.keys(annotation)
            }));
          } finally {
            await document.destroy?.();
          }
        } catch (error) {
          diagnostics.annotationSampleError = String(error?.message || error);
        }
        pageEls.slice(0, 3).forEach((pageEl) => {
          const pageNumber = pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number");
          const annotationLayer = pageEl.querySelector(".annotationLayer");
          const annotationEls = [...pageEl.querySelectorAll("[data-annotation-id]")];
          const overlay = pageEl.querySelector(".paperlib-native-pdf-highlight-layer");
          diagnostics.pages.push({
            pageNumber,
            className: pageEl.className,
            children: [...pageEl.children].map((el) => `${el.tagName}.${String(el.className?.baseVal ?? el.className)}`),
            annotationLayerPresent: Boolean(annotationLayer),
            annotationLayerClass: annotationLayer?.className || "",
            annotationElements: annotationEls.slice(0, 20).map((el) => ({
              tag: el.tagName,
              className: String(el.className?.baseVal ?? el.className),
              annotationId: el.dataset?.annotationId || el.getAttribute?.("data-annotation-id") || "",
              display: el.ownerDocument?.defaultView?.getComputedStyle?.(el)?.display || "",
              rect: (() => {
                const rect = el.getBoundingClientRect?.();
                return rect ? { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } : null;
              })()
            })),
            highlightPaths: overlay?.querySelectorAll?.("path")?.length || 0,
            overlaySignature: overlay?.dataset?.signature || ""
          });
        });
        console.log("[Paper Library debug] PDF 注释层结构", diagnostics);
        console.log(JSON.stringify(diagnostics, null, 2));
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
            new Notice("诊断信息已输出到控制台并复制到剪贴板");
            return;
          } catch (error) { /* 剪贴板不可用时仅输出控制台 */ }
        }
        new Notice("诊断信息已输出到开发者控制台");
      }
    });
    this.addCommand({ id: "organize-paper-files", name: "Organize paper PDFs and notes", callback: () => this.organizeLibraryFiles(true) });
    this.addCommand({
      id: "flush-pdf-annotation-writeback",
      name: "立即把论文批注写回 PDF 文件",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "s" }],
      callback: () => { void this.flushPdfAnnotationSyncs(null, true); }
    });
    this.addCommand({ id: "import-active-note", name: "Import current note as paper", callback: () => this.importActiveNote() });
    this.addCommand({ id: "open-paper-composer", name: "Open full Paper Composer in right sidebar", callback: () => this.openSmartComposer() });
    this.addCommand({ id: "open-paper-composer-settings", name: "Open Paper Composer model and account settings", callback: () => this.openSmartComposerSettings() });
    this.addCommand({
      id: "ask-ai-about-selection",
      name: "Ask AI about selection",
      editorCallback: (editor, view) => {
        const text = String(editor.getSelection?.() || "").trim();
        if (!text) return new Notice("请先选择一段文字");
        const file = view?.file;
        void this.addAIContext({
          type: "selection",
          label: file ? `${file.basename} · 文字选区` : "文字选区",
          detail: `${text.length} 字符`,
          text,
          path: file?.path || ""
        }, { draft: "请解释这段文字，并指出它在论证中的作用。" });
      }
    });
    if (this.app.workspace?.on && this.registerEvent) {
      this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const text = String(editor?.getSelection?.() || "").trim();
        if (!text) return;
        menu.addItem((item) => item
          .setTitle("Ask AI")
          .setIcon("sparkles")
          .onClick(() => this.addAIContext({
            type: "selection",
            label: view?.file ? `${view.file.basename} · 文字选区` : "文字选区",
            detail: `${text.length} 字符`,
            text,
            path: view?.file?.path || ""
          }, { draft: "请解释这段文字，并指出它在论证中的作用。" })));
      }));
    }
    this.paperLibrarySettingTab = new PaperLibrarySettingTab(this.app, this);
    this.addSettingTab(this.paperLibrarySettingTab);
    this.setupNativePdfToolbar();
    if (this.app.vault?.on && this.registerEvent) {
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        void this.handleManagedPdfRename(file, oldPath).catch((error) => {
          console.warn("Paper Library: failed to keep PDF markings attached after rename", error);
        });
      }));
    }
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        // Keep the navigation view registered in the native left sidebar on
        // every platform. Mobile previously skipped this, so iPad had no
        // Paper Library tab/button until an unreachable in-view action ran.
        try { await this.ensureNavigationView(false); }
        catch (error) { console.warn("Paper Library: left navigation view unavailable", error); }
        if (!this.isMobileApp()) {
          try { await this.migratePortablePdfFigureCatalogs(); }
          catch (error) { console.warn("Paper Library: portable figure catalog migration unavailable", error); }
        }
        try { await this.syncConferenceRankingDatabase(); }
        catch (error) { console.warn("Paper Library: conference ranking database update unavailable", error); }
        try { await this.repairMisreadPdfPublicationMetadata(); }
        catch (error) { console.warn("Paper Library: imported publication metadata repair unavailable", error); }
        try { await this.syncConferenceRateDatabase(); }
        catch (error) { console.warn("Paper Library: conference rate database update unavailable", error); }
        try { await this.upgradeRepositoryVenueMetadata(); }
        catch (error) { console.warn("Paper Library: repository venue upgrade unavailable", error); }
        await this.enrichExistingVenueRanks();
        if (!this.isMobileApp()) {
          try { await this.organizeLibraryFiles(false); }
          catch (error) { console.warn("Paper Library: startup file reconciliation unavailable", error); }
        }
      })();
    });
    if (this.registerInterval) {
      this.registerInterval(window.setInterval(() => {
        void (async () => {
          const rankingBefore = this.settings.conferenceRankingDatabase?.updatedAt || "";
          const rankingDatabase = await this.syncConferenceRankingDatabase();
          const before = this.settings.conferenceRateDatabase?.updatedAt || "";
          const database = await this.syncConferenceRateDatabase();
          if ((rankingDatabase?.updatedAt || "") !== rankingBefore
            || (database?.updatedAt || "") !== before) await this.enrichExistingVenueRanks();
        })().catch((error) => console.warn("Paper Library: scheduled conference rate update unavailable", error));
      }, 12 * 60 * 60 * 1000));
      this.registerInterval(window.setInterval(() => {
        void this.reloadSyncedSettingsIfChanged();
      }, 5 * 1000));
    }
    if (this.registerDomEvent && typeof document !== "undefined") {
      this.registerDomEvent(document, "visibilitychange", () => {
        if (document.visibilityState === "visible") void this.reloadSyncedSettingsIfChanged();
      });
    }
    if (this.settings.extensionServerEnabled) {
      try { this.startExtensionServer(); }
      catch (error) { console.warn("Paper Library: extension server unavailable", error); }
    }
  }

  onunload() {
    this.stopExtensionServer();
    void this.flushPdfAnnotationSyncs();
    this.composerMountObserver?.disconnect?.();
    this.composerMountObserver = null;
    document.body?.removeClass?.("paperlib-paperglass-active");
    document.body?.removeClass?.("paperlib-gallery-active");
    document.body?.removeClass?.("paperlib-blueprint-active");
    this.customAppearanceStyleEl?.remove?.();
    this.customAppearanceStyleEl = null;
    for (const tab of this.composerPdfTabs || []) {
      const state = tab?.paperLibraryPdfState;
      if (state?.originalSendMessage && tab.controllers?.inputController) {
        tab.controllers.inputController.sendMessage = state.originalSendMessage;
      }
      state?.topControlsObserver?.disconnect?.();
      this.cleanupComposerUnifiedModelControl(tab, state);
      state?.strip?.remove?.();
      delete tab.paperLibraryPdfState;
    }
    this.composerPdfTabs?.clear?.();
    try { this.claudianRuntime?.unload?.(); }
    catch (error) { console.warn("Paper Library: Paper Composer runtime unload failed", error); }
    this.claudianRuntime = null;
    this.claudianSettingTab = null;
    this.paperLibrarySettingTab = null;
    this.claudianStyleEl?.remove?.();
    this.claudianStyleEl = null;
    if (this.batchImportRefreshTimer) globalThis.clearTimeout(this.batchImportRefreshTimer);
    if (this.semanticScholarCacheSaveTimer) window.clearTimeout(this.semanticScholarCacheSaveTimer);
    if (this.nativePdfMountTimer) window.clearTimeout(this.nativePdfMountTimer);
    this.nativeAiRegionCleanup?.();
    this.nativeAiRegionCleanup = null;
    this.nativeSelectionDragCleanup?.(true);
    this.nativeSelectionDragCleanup = null;
    this.dismissNativePdfSelectionToolbar();
    this.nativeInkDrawingCleanup?.(true);
    this.nativeInkDrawingCleanup = null;
    this.pdfInkRegionDragCleanup?.(true);
    this.pdfInkRegionDragCleanup = null;
    this.pdfInkContextMenuCleanup?.();
    this.pdfInkContextMenuCleanup = null;
    this.nativePdfToolbarObserver?.disconnect();
    (this.nativePdfBindingList || []).forEach(({ container, pointerDown, pointerUp, contextMenu, dragStart, click, scroll, pointerMove }) => {
      container.removeEventListener("pointerdown", pointerDown, true);
      container.removeEventListener("pointerup", pointerUp, true);
      container.removeEventListener("contextmenu", contextMenu, true);
      container.removeEventListener("dragstart", dragStart, true);
      container.removeEventListener("click", click, true);
      container.removeEventListener("scroll", scroll, true);
      container.removeEventListener("pointermove", pointerMove, true);
    });
    this.persistPaperReadingPositions();
    this.nativePdfBindingList = [];
    document.querySelectorAll(".paperlib-native-pdf-tools").forEach((element) => element.remove());
    document.querySelectorAll(".paperlib-pdf-figure-drag-zone, .paperlib-pdf-figure-drag-preview")
      .forEach((element) => element.remove());
    document.querySelectorAll(".paperlib-native-highlight-mode, .paperlib-native-note-mode, .paperlib-native-ai-region-mode, .paperlib-native-ink-mode")
      .forEach((element) => element.classList.remove(
        "paperlib-native-highlight-mode", "paperlib-native-note-mode", "paperlib-native-ai-region-mode", "paperlib-native-ink-mode"
      ));
    document.querySelectorAll(".paperlib-native-pdf-ink-layer").forEach((element) => element.remove());
    document.querySelectorAll(".paperlib-native-pdf-host")
      .forEach((element) => element.classList.remove("paperlib-native-pdf-host"));
    (this.pdfFigureCatalogCache || new Map()).forEach((entry) => {
      try { void entry.document?.destroy?.(); } catch (_) {}
    });
    this.pdfFigureCatalogCache?.clear?.();
    this.pdfFigureAssetCache?.clear?.();
    this.pdfFigureAssetDirectoryCache?.clear?.();
    CLAUDIAN_VIEW_TYPES.forEach((type) => this.app.workspace.detachLeavesOfType(type));
    LEGACY_CLAUDIAN_VIEW_TYPES.forEach((type) => this.app.workspace.detachLeavesOfType(type));
    ALL_VIEW_TYPES.forEach((type) => this.app.workspace.detachLeavesOfType(type));
  }

  async installClaudianStyle() {
    if (this.claudianStyleEl || typeof document === "undefined") return;
    const adapter = this.app.vault.adapter;
    const stylePath = this.getPluginVaultPath("vendor/claudian.css");
    const css = await adapter.read(stylePath);
    const style = document.createElement("style");
    style.id = "paperlib-paper-composer-runtime-style";
    style.textContent = css;
    document.head.appendChild(style);
    this.claudianStyleEl = style;
  }

  loadEmbeddedClaudianModule() {
    const fs = require("fs");
    const nodePath = require("path");
    const filename = this.getDesktopPluginPath("vendor/claudian.bundle.js");
    const cliProviderPath = this.getDesktopPluginPath("vendor/paper-composer-cli-providers.cjs");
    // Obsidian keeps Node's module cache across a community-plugin toggle.
    // Reload this tiny adapter so an updated Paper Library never revives an
    // older Kimi settings renderer from the previous plugin instance.
    try { delete require.cache[require.resolve(cliProviderPath)]; } catch (_) {}
    const cliProviderFactory = require(cliProviderPath);
    const source = fs.readFileSync(filename, "utf8")
      // The vendored runtime must never impersonate another installed plugin
      // in global menus. Give the embedded surface its own product name,
      // notices and attachment
      // router. Upstream appends an @[[path]] string here; Paper Composer must
      // render a native linked-content/image/document chip instead.
      .replace(
        'let i=e.getView()?.appendToActiveInput($gt(t.path))??!1;',
        'let i=await e.paperLibraryAddFileToActiveChat?.(t)??!1;'
      )
      // In Paper Library this provider is the direct ChatGPT account
      // connection. Rename only the embedded provider registration.
      .replace('id:"codex",displayName:"Codex"', 'id:"codex",displayName:"ChatGPT"')
      // Kimi is an independent CLI provider. Registering it inside this
      // isolated runtime lets Composer use Kimi's own subprocess and login.
      .replace(
        "idt=[Y6e,Het,Snt,aot,edt]",
        "idt=[Y6e,Het,Snt,aot,edt,...paperComposerCliProviders({taskResultInterpreter:Q6e,obsidianComponents:paperComposerObsidianComponents})]"
      )
      // Normalize every remaining user-visible upstream product label. This
      // is deliberately case-sensitive so storage keys and CSS namespaces are
      // left untouched for compatibility with existing conversations.
      .replace(/\bClaudian\b/g, "Paper Composer");
    const runtimeModule = { exports: {} };
    // A nested Node module cannot resolve Obsidian's virtual `obsidian`
    // package. Compile the vendored CommonJS artifact with the same require
    // function that Obsidian supplied to this parent plugin.
    const compile = new Function(
      "require", "module", "exports", "__filename", "__dirname", "paperComposerCliProviders",
      "paperComposerObsidianComponents", source
    );
    compile(
      require, runtimeModule, runtimeModule.exports, filename, nodePath.dirname(filename), cliProviderFactory,
      { Notice, Setting }
    );
    return runtimeModule.exports;
  }

  applyPaperComposerModelOptions(runtime) {
    if (!runtime?.settings || Number(this.settings?.paperComposerModelOptionsVersion) >= PAPER_COMPOSER_MODEL_OPTIONS_VERSION) {
      return false;
    }

    const fs = require("fs");
    const previousOptionsVersion = Number(this.settings?.paperComposerModelOptionsVersion) || 0;
    const settings = runtime.settings;
    const providerConfigs = settings.providerConfigs && typeof settings.providerConfigs === "object"
      && !Array.isArray(settings.providerConfigs) ? { ...settings.providerConfigs } : {};
    const codex = providerConfigs.codex && typeof providerConfigs.codex === "object"
      && !Array.isArray(providerConfigs.codex) ? { ...providerConfigs.codex } : {};
    const opencode = providerConfigs.opencode && typeof providerConfigs.opencode === "object"
      && !Array.isArray(providerConfigs.opencode) ? { ...providerConfigs.opencode } : {};

    const hasExplicitCodexPath = Boolean(String(codex.cliPath || "").trim()
      || Object.values(codex.cliPathsByHost || {}).some((value) => String(value || "").trim()));
    if (!hasExplicitCodexPath && process.platform === "darwin" && fs.existsSync(PAPER_COMPOSER_CHATGPT_BUNDLED_CODEX_PATH)) {
      codex.cliPath = PAPER_COMPOSER_CHATGPT_BUNDLED_CODEX_PATH;
      codex.catalogFingerprint = "";
      codex.catalogTimestamp = 0;
    }

    codex.enabled = true;
    const discoveredChatGptModels = (Array.isArray(codex.discoveredModels) ? codex.discoveredModels : [])
      .filter((entry) => entry && typeof entry.model === "string" && entry.model.trim());
    const visibleChatGptModels = Array.isArray(codex.visibleModels)
      ? new Set(codex.visibleModels.map((model) => String(model || "").trim()).filter(Boolean))
      : null;
    const discoveredDefault = discoveredChatGptModels.find((entry) => (
      entry.isDefault === true && (!visibleChatGptModels || visibleChatGptModels.has(entry.model))
    )) || discoveredChatGptModels.find((entry) => (
      !visibleChatGptModels || visibleChatGptModels.has(entry.model)
    )) || discoveredChatGptModels[0] || null;
    const chatGptRuntimeModel = discoveredDefault?.model || PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL;
    const chatGptSelection = discoveredDefault
      ? chatGptRuntimeModel
      : `codex:${PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL}`;

    // Keep a lightweight fallback in the selector until the Codex catalog has
    // been discovered on this computer. Once discovery succeeds, the native
    // catalog entry wins and this line is ignored as a duplicate.
    if (!discoveredDefault) {
      const customModels = String(codex.customModels || "").split(/\r?\n/)
        .map((model) => model.trim()).filter(Boolean);
      if (!customModels.includes(PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL)) {
        customModels.push(PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL);
      }
      codex.customModels = customModels.join("\n");
    }
    codex.modelAliases = codex.modelAliases && typeof codex.modelAliases === "object"
      && !Array.isArray(codex.modelAliases) ? { ...codex.modelAliases } : {};
    // Version 5 assigned the product name "ChatGPT" as an automatic alias to
    // the default GPT-5.6 model. Model aliases belong to the user: remove only
    // that generated value and let the catalog's real model name show again.
    for (const [modelId, alias] of Object.entries(codex.modelAliases)) {
      if (/^gpt-5\.6(?:-|$)/i.test(modelId) && String(alias || "").trim() === "ChatGPT") {
        delete codex.modelAliases[modelId];
      }
    }

    // Earlier versions exposed Kimi/GLM as fake OpenCode model IDs. Remove
    // those stale entries; Kimi now uses its own CLI provider and GLM has been
    // removed completely.
    const legacyCliModels = new Set(["moonshotai/kimi-k2.5", "zai/glm-5.2"]);
    if (Array.isArray(opencode.visibleModels)) {
      opencode.visibleModels = opencode.visibleModels.filter((model) => !legacyCliModels.has(String(model || "").trim()));
    }
    if (opencode.modelAliases && typeof opencode.modelAliases === "object") {
      opencode.modelAliases = { ...opencode.modelAliases };
      legacyCliModels.forEach((model) => delete opencode.modelAliases[model]);
    }

    let detectedKimiPath = null;
    try {
      const helpers = require(this.getDesktopPluginPath("vendor/paper-composer-cli-providers.cjs"));
      detectedKimiPath = helpers.resolveCliPath(settings, helpers.PROVIDERS.kimi);
    } catch (_) { /* Keep settings usable when desktop path discovery is unavailable. */ }
    for (const providerId of PAPER_COMPOSER_CLI_PROVIDERS) {
      const current = providerConfigs[providerId] && typeof providerConfigs[providerId] === "object"
        && !Array.isArray(providerConfigs[providerId]) ? providerConfigs[providerId] : {};
      providerConfigs[providerId] = {
        enabled: providerId === "kimi" && Boolean(detectedKimiPath) ? true : current.enabled === true,
        cliPath: String(current.cliPath || ""),
        model: String(current.model || ""),
        visibleModels: Array.isArray(current.visibleModels)
          ? [...current.visibleModels]
          : (String(current.model || "").trim() ? [String(current.model).trim()] : null),
        modelAliases: current.modelAliases && typeof current.modelAliases === "object"
          && !Array.isArray(current.modelAliases) ? { ...current.modelAliases } : {},
        argsTemplate: String(current.argsTemplate || ""),
        environmentVariables: String(current.environmentVariables || "")
      };
    }

    providerConfigs.codex = codex;
    providerConfigs.opencode = opencode;
    delete providerConfigs.glm;
    settings.providerConfigs = providerConfigs;
    const legacySelection = legacyCliModels.has(String(settings.model || ""))
      || legacyCliModels.has(String(settings.lastSelectedChatModel?.model || ""))
      || String(settings.settingsProvider || "") === "glm"
      || String(settings.model || "") === "glm:default";
    if (previousOptionsVersion < 1 || !settings.settingsProvider || legacySelection) settings.settingsProvider = "codex";
    if (previousOptionsVersion < 1 || !settings.model || legacySelection) settings.model = chatGptSelection;
    if (previousOptionsVersion < 1 || !settings.lastSelectedChatModel || legacySelection) {
      settings.lastSelectedChatModel = { providerId: "codex", model: chatGptSelection };
    }
    settings.savedProviderModel = {
      ...(settings.savedProviderModel && typeof settings.savedProviderModel === "object"
        ? settings.savedProviderModel : {}),
      codex: chatGptSelection
    };
    delete settings.savedProviderModel.glm;
    return true;
  }

  getPaperComposerCliProviderConfig(providerId) {
    if (!PAPER_COMPOSER_CLI_PROVIDERS.has(providerId)) return {};
    const configs = this.claudianRuntime?.settings?.providerConfigs;
    const config = configs && typeof configs === "object" && !Array.isArray(configs)
      ? configs[providerId] : null;
    return config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {};
  }

  getPaperComposerSettingsProvider() {
    const providerId = String(this.claudianRuntime?.settings?.settingsProvider || "codex");
    return ["codex", "claude", "kimi"].includes(providerId) ? providerId : "codex";
  }

  resolvePaperComposerCliPath(providerId) {
    if (!PAPER_COMPOSER_CLI_PROVIDERS.has(providerId)) return null;
    try {
      const helpers = require(this.getDesktopPluginPath("vendor/paper-composer-cli-providers.cjs"));
      const spec = helpers.PROVIDERS?.[providerId];
      return spec ? helpers.resolveCliPath(this.claudianRuntime?.settings || {}, spec) : null;
    } catch (_) {
      return null;
    }
  }

  getPaperComposerCliModels(providerId) {
    if (!PAPER_COMPOSER_CLI_PROVIDERS.has(providerId)) {
      return { models: [], defaultModel: "", configPath: "" };
    }
    try {
      const helpers = require(this.getDesktopPluginPath("vendor/paper-composer-cli-providers.cjs"));
      const spec = helpers.PROVIDERS?.[providerId];
      return spec && typeof helpers.discoverCliModels === "function"
        ? helpers.discoverCliModels(spec)
        : { models: [], defaultModel: "", configPath: "" };
    } catch (_) {
      return { models: [], defaultModel: "", configPath: "" };
    }
  }

  getPaperComposerCliVisibleModels(providerId) {
    if (!PAPER_COMPOSER_CLI_PROVIDERS.has(providerId)) return [];
    try {
      const helpers = require(this.getDesktopPluginPath("vendor/paper-composer-cli-providers.cjs"));
      const spec = helpers.PROVIDERS?.[providerId];
      return spec && typeof helpers.configuredCliModels === "function"
        ? helpers.configuredCliModels(this.claudianRuntime?.settings || {}, spec)
        : [];
    } catch (_) {
      return [];
    }
  }

  getPaperComposerCliDefaultSelection(providerId) {
    if (!PAPER_COMPOSER_CLI_PROVIDERS.has(providerId)) return "";
    try {
      const helpers = require(this.getDesktopPluginPath("vendor/paper-composer-cli-providers.cjs"));
      const spec = helpers.PROVIDERS?.[providerId];
      const rawModel = this.getPaperComposerCliVisibleModels(providerId)[0] || "";
      return spec && typeof helpers.encodeCliModel === "function"
        ? helpers.encodeCliModel(spec, rawModel)
        : "";
    } catch (_) {
      return "";
    }
  }

  getPaperComposerCliMenuOptions() {
    try {
      const helpers = require(this.getDesktopPluginPath("vendor/paper-composer-cli-providers.cjs"));
      const settings = this.claudianRuntime?.settings || {};
      const result = [];
      for (const providerId of PAPER_COMPOSER_CLI_PROVIDERS) {
        const config = this.getPaperComposerCliProviderConfig(providerId);
        const spec = helpers.PROVIDERS?.[providerId];
        if (!spec || config.enabled !== true || typeof helpers.createChatUIConfig !== "function") continue;
        const options = helpers.createChatUIConfig(spec).getModelOptions(settings);
        options.forEach((option) => result.push({
          ...option,
          providerId,
          providerLabel: spec.displayName,
          rawModel: typeof helpers.decodeCliModel === "function"
            ? helpers.decodeCliModel(spec, option.value)
            : ""
        }));
      }
      return result;
    } catch (_) {
      return [];
    }
  }

  async updatePaperComposerCliProvider(providerId, patch = {}) {
    if (!PAPER_COMPOSER_CLI_PROVIDERS.has(providerId)) return;
    const runtime = await this.loadEmbeddedClaudian();
    await runtime.mutateSettings((settings) => {
      const providerConfigs = settings.providerConfigs && typeof settings.providerConfigs === "object"
        && !Array.isArray(settings.providerConfigs) ? { ...settings.providerConfigs } : {};
      const current = providerConfigs[providerId] && typeof providerConfigs[providerId] === "object"
        && !Array.isArray(providerConfigs[providerId]) ? providerConfigs[providerId] : {};
      providerConfigs[providerId] = { ...current, ...patch };
      settings.providerConfigs = providerConfigs;
    });
    await runtime.notifyProviderChatOptionsChanged?.(providerId);
  }

  async selectPaperComposerSettingsProvider(providerId) {
    const runtime = await this.loadEmbeddedClaudian();
    const selected = ["codex", "claude", "kimi"].includes(providerId) ? providerId : "codex";
    const cliModel = this.getPaperComposerCliDefaultSelection(selected);
    await runtime.mutateSettings((settings) => {
      const providerConfigs = settings.providerConfigs && typeof settings.providerConfigs === "object"
        && !Array.isArray(settings.providerConfigs) ? { ...settings.providerConfigs } : {};
      providerConfigs[selected] = {
        ...(providerConfigs[selected] && typeof providerConfigs[selected] === "object"
          ? providerConfigs[selected] : {}),
        enabled: true
      };
      settings.providerConfigs = providerConfigs;
      const model = cliModel
        || settings.savedProviderModel?.[selected]
        || (selected === "codex" ? `codex:${PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL}` : "");
      settings.settingsProvider = selected;
      if (model) {
        settings.model = model;
        settings.lastSelectedChatModel = { providerId: selected, model };
        settings.savedProviderModel = {
          ...(settings.savedProviderModel && typeof settings.savedProviderModel === "object"
            ? settings.savedProviderModel : {}),
          [selected]: model
        };
      } else {
        settings.model = "";
        settings.lastSelectedChatModel = null;
      }
    });
    runtime.notifyProviderChatOptionsChanged?.(selected);
  }

  async testPaperComposerCli(providerId) {
    if (!PAPER_COMPOSER_CLI_PROVIDERS.has(providerId)) throw new Error("未知 CLI 提供商");
    const command = this.resolvePaperComposerCliPath(providerId)
      || String(this.getPaperComposerCliProviderConfig(providerId).cliPath || "").trim();
    if (!command) throw new Error(`未找到 ${providerId} 命令，请填写 CLI 路径`);
    const { spawn } = require("node:child_process");
    return await new Promise((resolve, reject) => {
      let output = "";
      let settled = false;
      let timer = null;
      const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const finish = (error, value = "") => {
        if (settled) return;
        settled = true;
        if (timer !== null) window.clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
      child.once("error", (error) => finish(error));
      child.once("close", (code) => code === 0
        ? finish(null, output.trim().split(/\r?\n/)[0] || "")
        : finish(new Error(output.trim() || `退出码 ${code}`)));
      timer = window.setTimeout(() => {
        try { child.kill("SIGTERM"); } catch (_) {}
        finish(new Error("检测超时"));
      }, 8000);
    });
  }

  async loadEmbeddedClaudian() {
    if (this.claudianRuntime) return this.claudianRuntime;
    if (this.isMobileApp()) throw new Error("完整 Paper Composer 仅支持桌面端");
    if (typeof requireApiVersion === "function" && !requireApiVersion("1.13.0")) {
      throw new Error("完整 Paper Composer 需要 Obsidian 1.13 或更高版本");
    }
    await this.installClaudianStyle();
    const embeddedModule = this.loadEmbeddedClaudianModule();
    const PaperComposerRuntime = embeddedModule?.default || embeddedModule;
    if (typeof PaperComposerRuntime !== "function") throw new Error("Paper Composer runtime export is unavailable");
    const runtimeManifest = {
      ...this.manifest,
      id: "paper-library-paper-composer-runtime",
      name: "Paper Composer",
      version: "2.2.5",
      minAppVersion: "1.13.0",
      description: "Paper Composer AI workspace embedded in Paper Library.",
      author: "Paper Library",
      isDesktopOnly: true,
      dir: this.manifest.dir
    };
    const runtime = new PaperComposerRuntime(this.app, runtimeManifest);
    runtime.paperLibraryAddFileToActiveChat = (file) => this.addFileToPaperComposer(file, runtime);
    // Never let the embedded runtime reuse a leaf owned by another plugin.
    // Every Paper Composer activation resolves or
    // creates its dedicated right-sidebar leaf using a namespaced view type.
    runtime.activateView = () => this.activateIsolatedPaperComposerView(runtime);
    // The parent owns the only ribbon entry. Returning an inert element keeps
    // the embedded lifecycle intact without creating a duplicate.
    runtime.addRibbonIcon = () => document.createElement("span");
    // Paper Composer is an internal Paper Library runtime, not a second
    // Obsidian plugin. Capture its settings renderer and host it inside the
    // parent tab instead of registering a duplicate entry in Settings.
    runtime.addSettingTab = (settingTab) => {
      this.claudianSettingTab = settingTab;
      return settingTab;
    };
    // Paper Library deliberately ships one Composer surface. Keep the
    // embedded collaboration runtime inert even if an older settings file
    // had enabled it.
    runtime.collabSurfaceFactory = null;
    runtime.isCollabEnabled = () => false;
    runtime.setCollabEnabled = async () => {
      if (runtime.settings) runtime.settings.collabEnabled = false;
    };
    if (typeof runtime.loadSettings === "function") {
      const runtimeLoadSettings = runtime.loadSettings.bind(runtime);
      runtime.loadSettings = async (...args) => {
        const result = await runtimeLoadSettings(...args);
        if (runtime.settings) runtime.settings.collabEnabled = false;
        runtime.collabSurfaceFactory = null;
        if (this.applyPaperComposerModelOptions(runtime)) {
          try {
            await runtime.saveSettings();
            this.settings.paperComposerModelOptionsVersion = PAPER_COMPOSER_MODEL_OPTIONS_VERSION;
            await this.saveSettings();
          } catch (error) {
            console.warn("Paper Library: Paper Composer model defaults could not be persisted", error);
          }
        }
        return result;
      };
    }
    this.claudianRuntime = runtime;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const runtimeOnload = runtime.onload.bind(runtime);
    runtime.onload = async () => {
      try {
        await runtimeOnload();
        // Some embedded-runtime versions load settings before Obsidian calls
        // the patched loadSettings method above. Reconcile once more after the
        // runtime is fully ready so migrations always reach persisted state.
        if (this.applyPaperComposerModelOptions(runtime)) {
          await runtime.saveSettings();
          this.settings.paperComposerModelOptionsVersion = PAPER_COMPOSER_MODEL_OPTIONS_VERSION;
          await this.saveSettings();
        }
        resolveReady(runtime);
      } catch (error) {
        rejectReady(error);
      }
    };
    runtime.load();
    try {
      await ready;
      this.claudianLoadError = null;
      for (const leaf of this.app.workspace.getLeavesOfType?.(CLAUDIAN_VIEW_TYPE) || []) {
        this.refreshPaperComposerLeafIcon(leaf);
      }
      return runtime;
    } catch (error) {
      try { runtime.unload?.(); } catch (_) {}
      this.claudianRuntime = null;
      this.claudianSettingTab = null;
      throw error;
    }
  }

  async activateIsolatedPaperComposerView(runtime = this.claudianRuntime) {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType?.(CLAUDIAN_VIEW_TYPE)?.[0] || null;
    if (!leaf) {
      // Keep Paper Composer in the right sidebar's existing tab group. Passing
      // `true` creates another vertical sidebar split, which makes context-menu
      // opens appear as a pane at the bottom of the right sidebar.
      leaf = workspace.getRightLeaf?.(false) || workspace.getLeaf?.("tab") || null;
      if (!leaf) throw new Error("无法创建独立的 Paper Composer 侧栏");
      await leaf.setViewState({ type: CLAUDIAN_VIEW_TYPE, active: true });
    }
    workspace.revealLeaf?.(leaf);
    this.refreshPaperComposerLeafIcon(leaf);
    window.setTimeout(() => this.refreshPaperComposerLeafIcon(leaf), 0);
    const view = leaf.view || runtime?.getView?.();
    view?.focusActiveInput?.();
    return leaf;
  }

  async addFileToPaperComposer(file, runtime = this.claudianRuntime) {
    if (!file?.path) return false;
    await this.activateIsolatedPaperComposerView(runtime);
    const tab = await this.waitForClaudianTab();
    const path = normalizePath(file.path);
    const extension = String(file.extension || path.split(".").pop() || "").toLocaleLowerCase();
    if (extension === "pdf") {
      const targetTab = await this.ensureComposerTabForDocumentSources([`vault:${path}`], tab);
      this.syncComposerPdfLinkedContent(targetTab, path);
      this.replaceComposerWorkspaceLinkedPdf(targetTab, {
        name: file.name,
        path,
        byteLength: file.stat?.size || 0,
        key: `vault:${path}`,
        keepBytes: false
      }, () => this.app.vault.readBinary(file));
      targetTab.dom?.inputEl?.focus?.();
      return true;
    }
    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(extension)) {
      const attachments = await this.vaultFileToAIAttachment(file);
      if (!attachments?.length) return false;
      await this.addClaudianContexts(attachments, { tab, sourcePath: file.path });
      return true;
    }
    const controller = tab.ui?.linkedContentController;
    if (!controller?.selectExplicit) return false;
    const snapshot = controller.getSnapshot?.();
    if (snapshot?.mode === "locked" && controller.resetAutoDraft) controller.resetAutoDraft();
    controller.selectExplicit(path);
    this.ensureClaudianPdfBridge(tab);
    tab.dom?.inputEl?.focus?.();
    return true;
  }

  async addPaperToPaperComposer(paper) {
    if (!paper) return false;
    try {
      const sourcePaths = [paper.pdfPath, paper.notePath]
        .map((path) => normalizePath(path || ""))
        .filter((path) => path && !/^https?:\/\//i.test(path));
      const sourceFile = sourcePaths
        .map((path) => this.app.vault.getAbstractFileByPath(path))
        .find((file) => file?.path);
      if (sourceFile) return await this.addFileToPaperComposer(sourceFile);

      const attachment = await this.paperToAIAttachment(paper);
      await this.addAIContext(attachment, { allowActiveFileFallback: false });
      new Notice("论文没有可绑定的本地源文件，已添加论文信息");
      return true;
    } catch (error) {
      console.error("Paper Library: failed to add paper to Paper Composer", error);
      new Notice(`无法添加论文到 Paper Composer：${error?.message || error}`);
      return false;
    }
  }

  installPaperComposerWorkspaceBridge() {
    if (!this.app.workspace?.on || !this.registerEvent) return;
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      const extension = String(file?.extension || "").toLocaleLowerCase();
      if (extension !== "md" && extension !== "pdf") return;
      // Let Obsidian finish changing the active leaf and let the embedded
      // runtime process its own event first. The follow-up below only touches
      // the namespaced Paper Composer runtime, never another plugin instance.
      window.setTimeout(() => {
        const sync = extension === "pdf"
          ? this.syncPaperComposerLinkedPdf(file)
          : this.syncPaperComposerLinkedMarkdown(file);
        void sync.catch((error) => {
          console.warn("Paper Library: failed to sync linked content into Paper Composer", error);
        });
      }, 0);
    }));
  }

  async syncPaperComposerLinkedPdf(file) {
    if (String(file?.extension || "").toLocaleLowerCase() !== "pdf" || !file?.path) return false;
    const runtime = this.claudianRuntime;
    const view = runtime?.getView?.();
    if (!view) return false;
    await view.getTabManager?.()?.waitForTabSwitchIdle?.();
    const tab = view.getTabManager?.()?.getActiveTab?.();
    if (!tab?.dom?.inputEl) return false;
    const path = normalizePath(file.path);
    this.syncComposerPdfLinkedContent(tab, path);
    this.replaceComposerWorkspaceLinkedPdf(tab, {
      name: file.name,
      path,
      byteLength: file.stat?.size || 0,
      key: `vault:${path}`,
      keepBytes: false
    }, () => this.app.vault.readBinary(file));
    tab.dom?.inputEl?.focus?.();
    return true;
  }

  syncComposerPdfLinkedContent(tab, pdfPath = "") {
    const controller = tab?.ui?.linkedContentController;
    if (!controller?.getSnapshot || !controller?.selectExplicit) return false;
    const path = normalizePath(pdfPath || "");
    if (!path) return false;
    const snapshot = controller.getSnapshot();
    const linkedPath = normalizePath(snapshot?.path || "");
    if (linkedPath === path) return true;
    try {
      if (snapshot?.mode === "locked" && controller.resetAutoDraft) controller.resetAutoDraft();
      controller.selectExplicit(path);
      return true;
    } catch (_) {
      return false;
    }
  }

  replaceComposerWorkspaceLinkedPdf(tab, descriptor, loadBuffer) {
    const state = this.ensureClaudianPdfBridge(tab);
    if (!state) return null;
    const key = descriptor.key || `vault:${descriptor.path}`;
    for (const attachment of state.attachments) {
      if (attachment.workspaceLinked && attachment.key !== key) attachment.cancelled = true;
    }
    state.attachments = state.attachments.filter((attachment) => (
      !attachment.workspaceLinked || attachment.key === key
    ));
    state.documentSourceSignature = key;
    this.renderComposerPdfTray(tab);
    return this.queueComposerPdfAttachment(tab, {
      ...descriptor,
      key,
      workspaceLinked: true
    }, loadBuffer);
  }

  clearComposerWorkspaceLinkedPdf(tab) {
    const state = this.getComposerPdfState(tab);
    if (!state) return;
    for (const attachment of state.attachments) {
      if (attachment.workspaceLinked) attachment.cancelled = true;
    }
    state.attachments = state.attachments.filter((attachment) => !attachment.workspaceLinked);
    state.documentSourceSignature = "";
    this.renderComposerPdfTray(tab);
  }

  async syncPaperComposerLinkedMarkdown(file) {
    if (String(file?.extension || "").toLocaleLowerCase() !== "md" || !file?.path) return false;
    const runtime = this.claudianRuntime;
    const view = runtime?.getView?.();
    if (!view) return false;
    await view.getTabManager?.()?.waitForTabSwitchIdle?.();
    const tab = view.getTabManager?.()?.getActiveTab?.();
    if (!tab?.dom?.inputEl) return false;
    const controller = tab.ui?.linkedContentController;
    if (!controller?.getSnapshot) return false;
    const snapshot = controller.getSnapshot();
    const path = normalizePath(file.path);
    if (normalizePath(snapshot?.path || "") === path) {
      this.clearComposerWorkspaceLinkedPdf(tab);
      return true;
    }
    if (!controller?.selectExplicit) return false;
    if (snapshot?.mode === "locked" && controller.resetAutoDraft) controller.resetAutoDraft();
    controller.selectExplicit(path);
    this.ensureClaudianPdfBridge(tab);
    this.clearComposerWorkspaceLinkedPdf(tab);
    return true;
  }

  async openSmartComposer(openNewChat = false) {
    try {
      const runtime = this.claudianRuntime || await this.loadEmbeddedClaudian();
      // Opening the view creates its initial conversation. Calling openNewTab
      // immediately afterwards produced two tabs on the first launch.
      const alreadyOpen = Boolean(runtime.getView?.());
      if (openNewChat && alreadyOpen && typeof runtime.openNewTab === "function") {
        await runtime.openNewTab();
      } else {
        await runtime.activateView();
      }
      const tab = await this.waitForClaudianTab();
      this.ensureClaudianPdfBridge(tab);
    } catch (error) {
      console.error("Paper Library: Paper Composer unavailable", error);
      new Notice(`Paper Composer 无法打开：${error?.message || error}`);
    }
  }

  async openSmartComposerSettings() {
    try {
      if (!this.claudianRuntime) await this.loadEmbeddedClaudian();
      this.app.setting?.open?.();
      this.app.setting?.openTabById?.(this.manifest.id);
      window.setTimeout(() => this.paperLibrarySettingTab?.openEmbeddedComposerSettings(), 60);
    } catch (error) {
      console.error("Paper Library: Paper Composer settings unavailable", error);
      new Notice(`Paper Composer 设置无法打开：${error?.message || error}`);
    }
  }

  async waitForClaudianTab() {
    const runtime = this.claudianRuntime || await this.loadEmbeddedClaudian();
    await runtime.activateView();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const view = runtime.getView?.();
      const tab = view?.getTabManager?.()?.getActiveTab?.();
      if (tab?.dom?.inputEl) {
        this.ensureClaudianPdfBridge(tab);
        return tab;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    throw new Error("聊天输入区尚未准备好");
  }

  claudianImageFromAttachment(attachment) {
    const match = String(attachment?.dataUrl || "").match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,([\s\S]+)$/i);
    if (!match) return null;
    const mediaType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const data = match[2].replace(/\s+/g, "");
    const size = Math.floor(data.length * 3 / 4);
    if (size > 5 * 1024 * 1024) return null;
    return {
      id: `paperlib-${uniqueId()}`,
      name: attachment.label || `paper-library-image.${mediaType.split("/")[1]}`,
      mediaType,
      data,
      size,
      source: "drop"
    };
  }

  formatClaudianContext(attachment) {
    // Images are rendered by the Composer image tray. Never leak an
    // implementation tag or placeholder into the visible prompt.
    if (attachment?.dataUrl && attachment?.type === "image") return "";
    const body = String(attachment?.text || "").trim();
    if (!body) return "";
    if (attachment.type === "selection" && attachment.label === "拖入的文字") return body;
    const source = [
      String(attachment.label || "").trim(),
      attachment.page && !String(attachment.label || "").includes(`第 ${attachment.page} 页`)
        ? `第 ${attachment.page} 页`
        : ""
    ].filter(Boolean).join(" · ");
    return source ? `${body}\n\n— 来源：${source}` : body;
  }

  decorateClaudianImageTray(tab, images) {
    const row = tab?.dom?.inputEl?.closest?.(".paper-composer-input-wrapper")
      ?.querySelector?.(".paper-composer-context-row");
    if (!row) return;
    for (const image of images || []) {
      const chip = Array.from(row.querySelectorAll('.paper-composer-context-chip[data-context-slot="images"]'))
        .find((element) => element.dataset.contextId === image.id);
      const main = chip?.querySelector?.(".paper-composer-context-chip-main");
      if (!main || main.querySelector(".paperlib-paper-composer-image-preview")) continue;
      const preview = document.createElement("img");
      preview.className = "paperlib-paper-composer-image-preview";
      preview.src = `data:${image.mediaType};base64,${image.data}`;
      preview.alt = image.name || "圈选图片";
      preview.draggable = false;
      main.prepend(preview);
      chip.addClass("paperlib-paper-composer-image-chip");
      const label = main.querySelector(".paper-composer-context-chip-label");
      if (label) label.textContent = image.name || "圈选图片";
    }
  }

  decorateClaudianSentImageCards(tab) {
    const messages = tab?.dom?.messagesEl
      || tab?.dom?.inputEl?.closest?.(".paper-composer-tab-content")?.querySelector?.(".paper-composer-messages");
    if (!messages?.querySelectorAll) return;
    for (const group of messages.querySelectorAll(".paper-composer-message-images")) {
      group.addClass?.("paperlib-paper-composer-sent-images");
      for (const button of group.querySelectorAll("button.paper-composer-message-image")) {
        button.addClass?.("paperlib-paper-composer-sent-image");
        button.style.setProperty("width", "58px", "important");
        button.style.setProperty("min-width", "58px", "important");
        button.style.setProperty("max-width", "58px", "important");
        button.style.setProperty("height", "58px", "important");
        button.style.setProperty("min-height", "58px", "important");
        button.style.setProperty("max-height", "58px", "important");
        button.style.setProperty("flex", "0 0 58px", "important");
      }
    }
  }

  decorateClaudianSentPdfCards(tab) {
    const conversationId = String(tab?.conversationId || "");
    const records = this.settings?.paperComposerPdfMessageCards?.[conversationId];
    const messages = tab?.dom?.messagesEl;
    if (!conversationId || !records || typeof records !== "object" || !messages?.querySelectorAll) return;
    const messageElements = Array.from(messages.querySelectorAll('.paper-composer-message-user[data-message-id]'));
    const seenDocumentCards = new Set();
    for (const message of messageElements) {
      const messageId = String(message.dataset.messageId || "");
      const descriptors = Array.isArray(records[messageId]) ? records[messageId] : [];
      let group = Array.from(messages.querySelectorAll(".paperlib-paper-composer-sent-pdfs"))
        .find((element) => element.dataset.messageId === messageId);
      const visibleDescriptors = descriptors.filter((descriptor) => {
        const detail = String(descriptor?.detail || "");
        const mode = String(descriptor?.mode || (detail.startsWith("源文件") ? "direct" : "local"));
        const signature = [
          mode,
          String(descriptor?.key || descriptor?.label || "document"),
          String(descriptor?.contextSignature || "legacy")
        ].join("\n");
        if (seenDocumentCards.has(signature)) return false;
        seenDocumentCards.add(signature);
        return true;
      });
      if (!visibleDescriptors.length) {
        group?.remove();
        continue;
      }
      if (!group) {
        group = document.createElement("div");
        group.className = "paperlib-paper-composer-sent-pdfs";
        group.dataset.messageId = messageId;
        message.before(group);
      }
      const signature = JSON.stringify(visibleDescriptors);
      if (group.dataset.signature === signature) continue;
      group.dataset.signature = signature;
      group.replaceChildren();
      for (const descriptor of visibleDescriptors) {
        const card = document.createElement("div");
        card.className = "paperlib-paper-composer-sent-pdf";
        card.title = String(descriptor.label || "PDF");
        const icon = document.createElement("span");
        icon.className = "paperlib-paper-composer-sent-pdf-icon";
        setIcon(icon, "file-text");
        const copy = document.createElement("span");
        copy.className = "paperlib-paper-composer-sent-pdf-copy";
        const label = document.createElement("strong");
        label.textContent = String(descriptor.label || "document.pdf");
        const detail = document.createElement("small");
        detail.textContent = String(descriptor.detail || "PDF");
        copy.append(label, detail);
        card.append(icon, copy);
        group.append(card);
      }
    }
  }

  composerSentPdfDescriptor(attachment, options = {}) {
    const local = attachment?.pdfMode === "local" && attachment?.pdfSession;
    const detail = local
      ? `本地上下文 · ${Math.max(0, Number(options.selectedPageCount) || 0)} 页`
      : attachment?.localFallbackReason
        ? "源文件 · 本地解析不可用"
        : `源文件 · ${formatAIFileSize(attachment?.byteLength || 0)}`;
    return {
      key: String(attachment?.key || attachment?.label || uniqueId()),
      label: String(attachment?.label || "document.pdf"),
      detail,
      mode: local ? "local" : "direct",
      contextSignature: String(options.contextSignature || "")
    };
  }

  composerDirectContextExecutionSignature(tab) {
    const conversationId = String(tab?.conversationId || "");
    if (!conversationId) return "";
    const conversation = this.claudianRuntime?.getCachedConversation?.(conversationId) || null;
    const providerId = String(conversation?.providerId || tab?.providerId || "");
    const sessionId = String(conversation?.sessionId || "");
    const selectedModel = conversation?.selectedModel ?? tab?.selectedModel ?? "";
    const modelKey = typeof selectedModel === "string"
      ? selectedModel
      : JSON.stringify(selectedModel || {});
    return JSON.stringify({ conversationId, providerId, sessionId, modelKey });
  }

  composerDirectContextAttachmentKey(attachment) {
    return String(
      attachment?.key
      || attachment?.path
      || attachment?.nativePath
      || attachment?.label
      || "document"
    );
  }

  composerDirectContextSourceFingerprint(attachment) {
    const path = normalizePath(attachment?.path || "");
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    let nativeModifiedAt = 0;
    if (!file?.stat?.mtime && attachment?.nativePath) {
      try { nativeModifiedAt = Number(require("fs").statSync(attachment.nativePath).mtimeMs) || 0; }
      catch (_) {}
    }
    return JSON.stringify({
      key: this.composerDirectContextAttachmentKey(attachment),
      path,
      nativePath: String(attachment?.nativePath || ""),
      byteLength: Number(attachment?.byteLength) || Number(file?.stat?.size) || 0,
      modifiedAt: Number(file?.stat?.mtime) || nativeModifiedAt
    });
  }

  hasComposerDocumentContextBinding(tab, attachment, mode = "direct") {
    if (!attachment?.workspaceLinked) return false;
    const conversationId = String(tab?.conversationId || "");
    const executionSignature = this.composerDirectContextExecutionSignature(tab);
    if (!conversationId || !executionSignature) return false;
    const conversationRecord = this.settings?.paperComposerDirectContextBindings?.[conversationId];
    const binding = conversationRecord?.bindings?.[this.composerDirectContextAttachmentKey(attachment)];
    return Boolean(
      binding
      && (binding.mode || "direct") === mode
      && binding.executionSignature === executionSignature
      && binding.sourceFingerprint === this.composerDirectContextSourceFingerprint(attachment)
    );
  }

  hasComposerDirectContextBinding(tab, attachment) {
    return this.hasComposerDocumentContextBinding(tab, attachment, "direct");
  }

  hasComposerLocalContextBinding(tab, attachment) {
    return this.hasComposerDocumentContextBinding(tab, attachment, "local");
  }

  async rememberComposerDocumentContextBindings(tab, attachments, mode = "direct") {
    const list = (attachments || []).filter((attachment) => attachment?.workspaceLinked);
    const conversationId = String(tab?.conversationId || "");
    const executionSignature = this.composerDirectContextExecutionSignature(tab);
    if (!list.length || !conversationId || !executionSignature) return false;
    const store = this.settings.paperComposerDirectContextBindings
      && typeof this.settings.paperComposerDirectContextBindings === "object"
      && !Array.isArray(this.settings.paperComposerDirectContextBindings)
      ? { ...this.settings.paperComposerDirectContextBindings }
      : {};
    const previous = store[conversationId]
      && typeof store[conversationId] === "object"
      && !Array.isArray(store[conversationId]) ? store[conversationId] : {};
    const bindings = previous.bindings
      && typeof previous.bindings === "object"
      && !Array.isArray(previous.bindings) ? { ...previous.bindings } : {};
    const updatedAt = Date.now();
    for (const attachment of list) {
      bindings[this.composerDirectContextAttachmentKey(attachment)] = {
        mode,
        executionSignature,
        sourceFingerprint: this.composerDirectContextSourceFingerprint(attachment),
        updatedAt
      };
    }
    store[conversationId] = { bindings, updatedAt };
    this.settings.paperComposerDirectContextBindings = Object.fromEntries(
      Object.entries(store)
        .sort((left, right) => (Number(right[1]?.updatedAt) || 0) - (Number(left[1]?.updatedAt) || 0))
        .slice(0, 100)
    );
    await this.saveSettings();
    return true;
  }

  async rememberComposerDirectContextBindings(tab, attachments) {
    return this.rememberComposerDocumentContextBindings(tab, attachments, "direct");
  }

  async rememberComposerLocalContextBindings(tab, attachments) {
    return this.rememberComposerDocumentContextBindings(tab, attachments, "local");
  }

  async invalidateComposerDirectContextBindings(tab, attachments) {
    const conversationId = String(tab?.conversationId || "");
    const record = this.settings?.paperComposerDirectContextBindings?.[conversationId];
    if (!conversationId || !record?.bindings) return false;
    const bindings = { ...record.bindings };
    let changed = false;
    for (const attachment of attachments || []) {
      const key = this.composerDirectContextAttachmentKey(attachment);
      if (!Object.prototype.hasOwnProperty.call(bindings, key)) continue;
      delete bindings[key];
      changed = true;
    }
    if (!changed) return false;
    const store = { ...this.settings.paperComposerDirectContextBindings };
    if (Object.keys(bindings).length) store[conversationId] = { bindings, updatedAt: Date.now() };
    else delete store[conversationId];
    this.settings.paperComposerDirectContextBindings = store;
    await this.saveSettings();
    return true;
  }

  async recordComposerSentPdfCards(tab, descriptors, previousUserMessageIds = new Set(), options = {}) {
    if (!descriptors?.length) return false;
    const deadline = Date.now() + Math.max(0, Number(options.timeoutMs) || 10000);
    let conversationId = "";
    let messageId = "";
    do {
      if (options.cancellation?.cancelled) return false;
      conversationId = String(tab?.conversationId || "");
      const conversation = conversationId
        ? this.claudianRuntime?.getCachedConversation?.(conversationId)
        : null;
      const userMessage = [...(conversation?.messages || [])].reverse()
        .find((message) => message?.role === "user" && message.id && !previousUserMessageIds.has(message.id));
      const domMessage = Array.from(tab?.dom?.messagesEl?.querySelectorAll?.('.paper-composer-message-user[data-message-id]') || [])
        .reverse().find((element) => !previousUserMessageIds.has(element.dataset.messageId));
      messageId = String(userMessage?.id || domMessage?.dataset?.messageId || "");
      if (conversationId && messageId) break;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    } while (true);
    if (options.cancellation?.cancelled) return false;
    if (!conversationId || !messageId) return false;
    const store = this.settings.paperComposerPdfMessageCards
      && typeof this.settings.paperComposerPdfMessageCards === "object"
      && !Array.isArray(this.settings.paperComposerPdfMessageCards)
      ? { ...this.settings.paperComposerPdfMessageCards }
      : {};
    const conversationRecords = store[conversationId]
      && typeof store[conversationId] === "object"
      && !Array.isArray(store[conversationId]) ? { ...store[conversationId] } : {};
    conversationRecords[messageId] = descriptors.map((descriptor) => ({ ...descriptor }));
    store[conversationId] = conversationRecords;
    this.settings.paperComposerPdfMessageCards = store;
    this.decorateClaudianSentPdfCards(tab);
    await this.saveSettings();
    return true;
  }

  getComposerPdfState(tab) {
    if (!tab) return null;
    let state = tab.paperLibraryPdfState;
    if (!state) {
      state = {
        attachments: [],
        documentSourceSignature: "",
        directContextInflight: new Set(),
        busy: false,
        strip: null,
        contextRow: null,
        contextRowFallback: false,
        topControlsObserver: null,
        topControlsScheduled: false,
        voiceRecognition: null,
        linkedContentObserver: null,
        linkedContentObserverRow: null,
        linkedPdfReconcileScheduled: false,
        modelControl: null,
        modelControlRetryTimer: null,
        modelControlRetryCount: 0,
        modelMenuOwnerDocument: null,
        modelMenuOutsideListener: null,
        modelMenuKeyListener: null,
        originalSendMessage: null
      };
      tab.paperLibraryPdfState = state;
    }
    if (!(state.directContextInflight instanceof Set)) state.directContextInflight = new Set();
    this.composerPdfTabs?.add(tab);
    return state;
  }

  ensureClaudianPdfBridge(tab) {
    const input = tab?.dom?.inputEl;
    const wrapper = input?.closest?.(".paper-composer-input-wrapper");
    if (!input || !wrapper) return null;
    const state = this.getComposerPdfState(tab);
    this.decorateClaudianSentImageCards(tab);
    this.decorateClaudianSentPdfCards(tab);
    this.ensureComposerTopControls(tab, state);
    this.ensureComposerCodexInput(tab, state);
    const controller = tab.controllers?.inputController;
    if (controller?.sendMessage && !state.originalSendMessage) {
      const original = controller.sendMessage.bind(controller);
      state.originalSendMessage = original;
      controller.sendMessage = (options) => this.sendClaudianMessageWithPdf(tab, original, options);
    }
    const nativeContextRow = Array.from(wrapper.querySelectorAll(".paper-composer-context-row"))
      .find((element) => !element.classList.contains("paperlib-composer-context-row"));
    if (nativeContextRow && state.contextRow !== nativeContextRow) {
      state.strip?.remove?.();
      if (state.contextRowFallback) state.contextRow?.remove?.();
      state.strip = null;
      state.contextRow = nativeContextRow;
      state.contextRowFallback = false;
    }
    if (!state.contextRow?.isConnected) {
      state.contextRow = document.createElement("div");
      state.contextRow.className = "paper-composer-context-row paperlib-composer-context-row";
      wrapper.prepend(state.contextRow);
      state.contextRowFallback = true;
    }
    let createdStrip = false;
    if (!state.strip?.isConnected || state.strip.parentElement !== state.contextRow) {
      state.strip?.remove?.();
      state.strip = document.createElement("div");
      state.strip.className = "paperlib-composer-pdf-strip";
      state.contextRow.append(state.strip);
      createdStrip = true;
    }
    this.ensureComposerLinkedPdfObserver(tab, state);
    this.scheduleComposerLinkedPdfReconcile(tab, state);
    // focusin/click are only discovery hooks for newly activated Composer tabs.
    // Replacing the strip during pointerdown -> focusin destroys the pressed
    // button before its click event, which made mode switching/removal inert.
    if (createdStrip) this.renderComposerPdfTray(tab);
    return state;
  }

  ensureComposerLinkedPdfObserver(tab, state = this.getComposerPdfState(tab)) {
    const row = state?.contextRow;
    if (!row) return;
    if (state.linkedContentObserver && state.linkedContentObserverRow === row) return;
    state.linkedContentObserver?.disconnect?.();
    state.linkedContentObserverRow = row;
    state.linkedContentObserver = new MutationObserver((mutations) => {
      const nativeChanged = mutations.some((mutation) => {
        const element = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
        return !element?.closest?.(".paperlib-composer-pdf-strip, .paperlib-linked-pdf-status");
      });
      if (!nativeChanged) return;
      this.scheduleComposerLinkedPdfReconcile(tab, state);
    });
    // The native runtime may replace the chip or reuse it and only change its
    // label. Ignore mutations inside our own strip to avoid a render loop.
    state.linkedContentObserver.observe(row, { childList: true, subtree: true, characterData: true });
  }

  scheduleComposerLinkedPdfReconcile(tab, state = this.getComposerPdfState(tab)) {
    if (!state || state.linkedPdfReconcileScheduled) return;
    state.linkedPdfReconcileScheduled = true;
    window.setTimeout(() => {
      state.linkedPdfReconcileScheduled = false;
      this.reconcileComposerLinkedPdfState(tab);
    }, 0);
  }

  reconcileComposerLinkedPdfState(tab) {
    const state = this.getComposerPdfState(tab);
    const snapshot = tab?.ui?.linkedContentController?.getSnapshot?.();
    const path = normalizePath(snapshot?.path || "");
    if (!/\.pdf$/i.test(path)) {
      if (state.attachments.some((attachment) => attachment.workspaceLinked)) {
        for (const attachment of state.attachments) {
          if (attachment.workspaceLinked) attachment.cancelled = true;
        }
        state.attachments = state.attachments.filter((attachment) => !attachment.workspaceLinked);
        state.documentSourceSignature = "";
        this.renderComposerPdfTray(tab);
      }
      return false;
    }
    const key = `vault:${path}`;
    const existing = state.attachments.find((attachment) => (
      attachment.key === key || normalizePath(attachment.path || "") === path
    ));
    if (existing) {
      existing.workspaceLinked = true;
      state.documentSourceSignature = key;
      this.decorateComposerLinkedPdfChip(tab, existing);
      return true;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file?.path) return false;
    this.replaceComposerWorkspaceLinkedPdf(tab, {
      name: file.name,
      path,
      byteLength: file.stat?.size || 0,
      key,
      keepBytes: false
    }, () => this.app.vault.readBinary(file));
    return true;
  }

  ensureComposerCodexInput(tab, state = this.getComposerPdfState(tab)) {
    const input = tab?.dom?.inputEl;
    const wrapper = input?.closest?.(".paper-composer-input-wrapper");
    const toolbar = wrapper?.querySelector?.(".paper-composer-input-toolbar");
    if (!input || !wrapper || !toolbar) return;
    wrapper.addClass("paperlib-codex-composer-input");
    this.ensureComposerUnifiedModelControl(tab, state);

    let fileInput = toolbar.querySelector("input.paperlib-codex-file-input");
    if (!fileInput) {
      fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.accept = "application/pdf,image/*,.md,.markdown,.canvas,.txt";
      fileInput.className = "paperlib-codex-file-input";
      fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = "";
        if (!files.length) return;
        void this.addComposerDrop({ files }, { tab }).then((recognized) => {
          if (!recognized) new Notice("没有识别到可用的文件");
          this.refreshComposerCodexInput(tab);
        }).catch((error) => {
          console.error("Paper Library: Codex-style attachment picker failed", error);
          new Notice(`无法添加附件：${error?.message || error}`);
        });
      });
      toolbar.append(fileInput);
    }

    let attachButton = toolbar.querySelector(".paperlib-codex-attach-btn");
    if (!attachButton) {
      attachButton = document.createElement("button");
      attachButton.type = "button";
      attachButton.className = "paperlib-codex-action paperlib-codex-attach-btn";
      attachButton.setAttribute("aria-label", "添加附件");
      attachButton.title = "添加 PDF、图片或笔记";
      setIcon(attachButton, "plus");
      attachButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileInput.click();
      });
      toolbar.append(attachButton);
    }

    if (state?.voiceRecognition) {
      try { state.voiceRecognition.stop?.(); } catch (_) {}
      state.voiceRecognition = null;
    }
    toolbar.querySelector(".paperlib-codex-voice-btn")?.remove?.();

    let sendButton = toolbar.querySelector(".paperlib-codex-send-btn");
    if (!sendButton) {
      sendButton = document.createElement("button");
      sendButton.type = "button";
      sendButton.className = "paperlib-codex-action paperlib-codex-send-btn";
      sendButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const controller = tab?.controllers?.inputController;
        if (tab?.state?.isStreaming) controller?.cancelStreaming?.();
        else void controller?.sendMessage?.();
        window.setTimeout(() => this.refreshComposerCodexInput(tab), 30);
        window.setTimeout(() => this.refreshComposerCodexInput(tab), 260);
      });
      toolbar.append(sendButton);
    }

    if (!input.paperLibraryCodexInputListener) {
      input.paperLibraryCodexInputListener = () => this.refreshComposerCodexInput(tab);
      input.addEventListener("input", input.paperLibraryCodexInputListener);
    }
    const permission = toolbar.querySelector(".paper-composer-permission-toggle");
    if (permission && !permission.paperLibraryCodexClickListener) {
      permission.paperLibraryCodexClickListener = (event) => {
        if (event.target?.closest?.(".paper-composer-toggle-switch")) return;
        permission.querySelector(".paper-composer-toggle-switch")?.click?.();
      };
      permission.addEventListener("click", permission.paperLibraryCodexClickListener);
    }
    this.refreshComposerCodexInput(tab);
  }

  ensureComposerUnifiedModelControl(tab, state = this.getComposerPdfState(tab)) {
    const input = tab?.dom?.inputEl;
    const wrapper = input?.closest?.(".paper-composer-input-wrapper");
    const toolbar = wrapper?.querySelector?.(".paper-composer-input-toolbar");
    if (!wrapper || !toolbar || !state) return null;
    const modelSelector = toolbar.querySelector(".paper-composer-model-selector");
    const thinkingSelector = toolbar.querySelector(".paper-composer-thinking-selector");
    if (!modelSelector) {
      if (!state.modelControlRetryTimer && state.modelControlRetryCount < 30 && input?.isConnected) {
        state.modelControlRetryCount += 1;
        state.modelControlRetryTimer = window.setTimeout(() => {
          state.modelControlRetryTimer = null;
          this.ensureComposerUnifiedModelControl(tab, state);
        }, 80);
      }
      return null;
    }
    if (state.modelControlRetryTimer) window.clearTimeout(state.modelControlRetryTimer);
    state.modelControlRetryTimer = null;
    state.modelControlRetryCount = 0;

    let control = toolbar.querySelector(".paperlib-codex-model-control");
    if (!control) {
      if (state.modelControl && !state.modelControl.isConnected) this.cleanupComposerUnifiedModelControl(tab, state);
      control = document.createElement("div");
      control.className = "paperlib-codex-model-control";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "paperlib-codex-model-trigger";
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");

      const bolt = document.createElement("span");
      bolt.className = "paperlib-codex-model-bolt";
      setIcon(bolt, "zap");
      trigger.append(bolt);

      const model = document.createElement("span");
      model.className = "paperlib-codex-model-name";
      trigger.append(model);

      const effort = document.createElement("span");
      effort.className = "paperlib-codex-model-effort";
      trigger.append(effort);

      const chevron = document.createElement("span");
      chevron.className = "paperlib-codex-model-chevron";
      setIcon(chevron, "chevron-down");
      trigger.append(chevron);

      const menu = document.createElement("div");
      menu.className = "paperlib-codex-model-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-hidden", "true");
      control.append(trigger, menu);
      toolbar.append(control);

      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleComposerUnifiedModelMenu(tab, control);
      });
      menu.addEventListener("pointerdown", (event) => event.stopPropagation());
      menu.addEventListener("click", (event) => event.stopPropagation());

      const ownerDocument = control.ownerDocument || document;
      state.modelControl = control;
      state.modelMenuOwnerDocument = ownerDocument;
      state.modelMenuOutsideListener = (event) => {
        if (!control.contains(event.target)) this.closeComposerUnifiedModelMenu(control);
      };
      state.modelMenuKeyListener = (event) => {
        if (event.key === "Escape") {
          this.closeComposerUnifiedModelMenu(control);
          trigger.focus?.();
        }
      };
      ownerDocument.addEventListener("pointerdown", state.modelMenuOutsideListener, true);
      ownerDocument.addEventListener("keydown", state.modelMenuKeyListener, true);
    }

    this.refreshComposerUnifiedModelControl(tab, control, thinkingSelector);
    return control;
  }

  cleanupComposerUnifiedModelControl(tab, state = tab?.paperLibraryPdfState) {
    if (!state) return;
    if (state.modelControlRetryTimer) window.clearTimeout(state.modelControlRetryTimer);
    const ownerDocument = state.modelMenuOwnerDocument || state.modelControl?.ownerDocument;
    if (ownerDocument && state.modelMenuOutsideListener) {
      ownerDocument.removeEventListener("pointerdown", state.modelMenuOutsideListener, true);
    }
    if (ownerDocument && state.modelMenuKeyListener) {
      ownerDocument.removeEventListener("keydown", state.modelMenuKeyListener, true);
    }
    state.modelControl?.remove?.();
    state.modelControl = null;
    state.modelControlRetryTimer = null;
    state.modelControlRetryCount = 0;
    state.modelMenuOwnerDocument = null;
    state.modelMenuOutsideListener = null;
    state.modelMenuKeyListener = null;
  }

  formatComposerModelDisplayLabel(value) {
    return String(value || "模型")
      .replace(/^GPT-/i, "")
      .replace(/-(Sol|Terra|Luna)$/i, " $1")
      .trim();
  }

  formatComposerReasoningDisplayLabel(value) {
    const raw = String(value || "").trim();
    const labels = {
      none: "无",
      off: "关闭",
      minimal: "最低",
      low: "低",
      medium: "中",
      high: "高",
      "extra high": "很高",
      xhigh: "很高",
      max: "最高",
      ultra: "极高"
    };
    return labels[raw.toLowerCase()] || raw;
  }

  getComposerUnifiedModelValues(tab) {
    const wrapper = tab?.dom?.inputEl?.closest?.(".paper-composer-input-wrapper");
    const modelSelector = wrapper?.querySelector?.(".paper-composer-model-selector");
    const thinkingSelector = wrapper?.querySelector?.(".paper-composer-thinking-selector");
    const serviceTier = wrapper?.querySelector?.(".paper-composer-service-tier-toggle");
    const visibleThinking = Array.from(thinkingSelector?.querySelectorAll?.(".paper-composer-thinking-effort, .paper-composer-thinking-budget") || [])
      .find((element) => !element.classList.contains("paper-composer-hidden"));
    return {
      wrapper,
      modelSelector,
      thinkingSelector,
      serviceTier,
      model: this.formatComposerModelDisplayLabel(modelSelector?.querySelector?.(".paper-composer-model-label")?.textContent),
      effort: this.formatComposerReasoningDisplayLabel(visibleThinking?.querySelector?.(".paper-composer-thinking-current")?.textContent),
      speedFast: Boolean(serviceTier?.querySelector?.(".paper-composer-service-tier-button")?.classList.contains("active")),
      speedAvailable: Boolean(serviceTier && !serviceTier.classList.contains("paper-composer-hidden"))
    };
  }

  refreshComposerUnifiedModelControl(tab, control = null) {
    const wrapper = tab?.dom?.inputEl?.closest?.(".paper-composer-input-wrapper");
    control ||= wrapper?.querySelector?.(".paperlib-codex-model-control");
    if (!control) return;
    const values = this.getComposerUnifiedModelValues(tab);
    const model = control.querySelector(".paperlib-codex-model-name");
    const effort = control.querySelector(".paperlib-codex-model-effort");
    if (model && model.textContent !== values.model) model.textContent = values.model;
    if (effort) {
      effort.textContent = values.effort;
      effort.toggleAttribute("hidden", !values.effort);
    }
    const bolt = control.querySelector(".paperlib-codex-model-bolt");
    const speedActive = values.speedAvailable && values.speedFast;
    if (bolt) {
      bolt.toggleAttribute("hidden", !speedActive);
      bolt.setAttribute("aria-hidden", speedActive ? "false" : "true");
      bolt.title = speedActive ? "1.5 倍加速已开启" : "";
    }
    const trigger = control.querySelector(".paperlib-codex-model-trigger");
    trigger?.setAttribute("aria-label", [
      "模型",
      values.model,
      values.effort && `推理强度 ${values.effort}`,
      speedActive && "1.5 倍加速已开启"
    ].filter(Boolean).join("，"));
    if (control.classList.contains("is-open")) this.renderComposerUnifiedModelMenu(tab, control);
  }

  closeComposerUnifiedModelMenu(control) {
    if (!control) return;
    control.removeClass?.("is-open");
    control.classList.remove("is-open");
    control.querySelector(".paperlib-codex-model-trigger")?.setAttribute("aria-expanded", "false");
    control.querySelector(".paperlib-codex-model-menu")?.setAttribute("aria-hidden", "true");
  }

  toggleComposerUnifiedModelMenu(tab, control) {
    const opening = !control.classList.contains("is-open");
    const ownerDocument = control.ownerDocument || document;
    ownerDocument.querySelectorAll(".paperlib-codex-model-control.is-open").forEach((other) => {
      if (other !== control) this.closeComposerUnifiedModelMenu(other);
    });
    if (!opening) return this.closeComposerUnifiedModelMenu(control);
    this.renderComposerUnifiedModelMenu(tab, control, "root");
    control.addClass?.("is-open");
    control.classList.add("is-open");
    control.querySelector(".paperlib-codex-model-trigger")?.setAttribute("aria-expanded", "true");
    control.querySelector(".paperlib-codex-model-menu")?.setAttribute("aria-hidden", "false");
  }

  async chooseComposerCliModel(tab, control, option) {
    const findNativeOption = () => {
      const wrapper = tab?.dom?.inputEl?.closest?.(".paper-composer-input-wrapper");
      const candidates = Array.from(wrapper?.querySelectorAll?.(".paper-composer-model-option") || []);
      return candidates.find((candidate) => {
        const title = String(candidate.getAttribute("title") || "");
        const label = this.formatComposerModelDisplayLabel(candidate.textContent);
        return (option.rawModel && title.includes(option.rawModel))
          || label === this.formatComposerModelDisplayLabel(option.label);
      }) || null;
    };

    try {
      // Provider sessions cannot be resumed by another CLI. Keep the existing
      // conversation in history and switch this tab to a fresh draft before
      // forwarding the model choice to Composer's native transition logic.
      if (tab?.conversationId && tab?.providerId !== option.providerId) {
        const conversationController = tab?.controllers?.conversationController;
        if (!conversationController?.createNew) throw new Error("无法创建新的模型会话");
        await conversationController.createNew({ force: true });
      }
      await this.claudianRuntime?.notifyProviderChatOptionsChanged?.(option.providerId);
      for (const delay of [0, 50, 140, 280]) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        const nativeOption = findNativeOption();
        if (!nativeOption) continue;
        nativeOption.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        this.closeComposerUnifiedModelMenu(control);
        window.setTimeout(() => this.refreshComposerUnifiedModelControl(tab, control), 80);
        window.setTimeout(() => this.refreshComposerUnifiedModelControl(tab, control), 320);
        return;
      }
      throw new Error(`${option.providerLabel} 模型尚未载入`);
    } catch (error) {
      console.error("Paper Library: failed to select CLI model", error);
      new Notice(`无法切换到 ${option.label}：${error?.message || error}`);
    }
  }

  renderComposerUnifiedModelMenu(tab, control, page = control?.dataset?.menuPage || "root") {
    const menu = control?.querySelector?.(".paperlib-codex-model-menu");
    if (!menu) return;
    control.dataset.menuPage = page;
    menu.replaceChildren();
    const values = this.getComposerUnifiedModelValues(tab);

    const makeIcon = (name, className = "") => {
      const icon = document.createElement("span");
      icon.className = className;
      setIcon(icon, name);
      return icon;
    };
    const makeRow = ({ label, value = "", selected = false, disabled = false, onClick, activateOnPointerDown = false }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "paperlib-codex-model-menu-row";
      row.setAttribute("role", "menuitem");
      row.toggleClass?.("is-selected", selected);
      row.classList.toggle("is-selected", selected);
      row.disabled = disabled;
      const labelEl = document.createElement("span");
      labelEl.className = "paperlib-codex-model-menu-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "paperlib-codex-model-menu-value";
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      if (onClick) {
        let pointerHandled = false;
        if (activateOnPointerDown) {
          row.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || row.disabled) return;
            pointerHandled = true;
            event.preventDefault();
            event.stopPropagation();
            onClick();
          });
        }
        // Keep keyboard activation intact. A physical click following an
        // already-handled pointerdown is suppressed to avoid double changes.
        row.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pointerHandled) {
            pointerHandled = false;
            return;
          }
          if (!row.disabled) onClick();
        });
      }
      return row;
    };
    const chooseNativeOption = (nativeOption) => {
      nativeOption?.dispatchEvent?.(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      this.closeComposerUnifiedModelMenu(control);
      window.setTimeout(() => this.refreshComposerUnifiedModelControl(tab, control), 40);
      window.setTimeout(() => this.refreshComposerUnifiedModelControl(tab, control), 240);
    };

    if (page !== "root") {
      const header = document.createElement("button");
      header.type = "button";
      header.className = "paperlib-codex-model-menu-header";
      header.append(makeIcon("chevron-left"), document.createTextNode(page === "model" ? "模型" : page === "reasoning" ? "推理强度" : "速度"));
      const returnToRoot = () => this.renderComposerUnifiedModelMenu(tab, control, "root");
      // Composer can refresh its toolbar between pointerdown and click. Open
      // the requested page on pointerdown so replacing this button cannot
      // swallow a real mouse click; retain click for keyboard activation.
      header.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        returnToRoot();
      });
      header.addEventListener("click", () => {
        if (control.dataset.menuPage !== "root") returnToRoot();
      });
      menu.append(header);

      if (page === "model") {
        values.modelSelector?.dispatchEvent?.(new MouseEvent("mouseenter", { bubbles: false }));
        const options = Array.from(values.modelSelector?.querySelectorAll?.(".paper-composer-model-option") || []);
        const cliOptions = this.getPaperComposerCliMenuOptions();
        const nativeCliModels = new Set();
        for (const option of options) {
          const title = String(option.getAttribute("title") || "");
          cliOptions.forEach((cliOption) => {
            if ((cliOption.rawModel && title.includes(cliOption.rawModel))
              || this.formatComposerModelDisplayLabel(option.textContent) === this.formatComposerModelDisplayLabel(cliOption.label)) {
              nativeCliModels.add(cliOption.value);
            }
          });
          menu.append(makeRow({
            label: this.formatComposerModelDisplayLabel(option.textContent),
            selected: option.classList.contains("selected"),
            activateOnPointerDown: true,
            onClick: () => chooseNativeOption(option)
          }));
        }
        for (const option of cliOptions) {
          if (nativeCliModels.has(option.value)) continue;
          menu.append(makeRow({
            label: this.formatComposerModelDisplayLabel(option.label),
            value: option.providerLabel,
            selected: tab?.providerId === option.providerId
              && this.formatComposerModelDisplayLabel(option.label) === values.model,
            activateOnPointerDown: true,
            onClick: () => void this.chooseComposerCliModel(tab, control, option)
          }));
        }
      } else if (page === "reasoning") {
        const visibleGroup = Array.from(values.thinkingSelector?.querySelectorAll?.(".paper-composer-thinking-effort, .paper-composer-thinking-budget") || [])
          .find((element) => !element.classList.contains("paper-composer-hidden"));
        const options = Array.from(visibleGroup?.querySelectorAll?.(".paper-composer-thinking-gear") || []);
        for (const option of options) {
          menu.append(makeRow({
            label: this.formatComposerReasoningDisplayLabel(option.textContent),
            selected: option.classList.contains("selected"),
            activateOnPointerDown: true,
            onClick: () => chooseNativeOption(option)
          }));
        }
      } else {
        const serviceButton = values.serviceTier?.querySelector?.(".paper-composer-service-tier-button");
        for (const option of [{ label: "标准", fast: false }, { label: "快速", fast: true }]) {
          menu.append(makeRow({
            label: option.label,
            selected: values.speedFast === option.fast,
            disabled: !values.speedAvailable,
            activateOnPointerDown: true,
            onClick: () => {
              if (values.speedAvailable && values.speedFast !== option.fast) serviceButton?.click?.();
              this.closeComposerUnifiedModelMenu(control);
              window.setTimeout(() => this.refreshComposerUnifiedModelControl(tab, control), 80);
              window.setTimeout(() => this.refreshComposerUnifiedModelControl(tab, control), 300);
            }
          }));
        }
      }
      return;
    }

    const advanced = document.createElement("div");
    advanced.className = "paperlib-codex-model-advanced";
    if (control.dataset.advancedCollapsed === "true") advanced.hidden = true;
    const navigationRows = [
      { label: "模型", value: values.model, page: "model", disabled: false },
      { label: "推理强度", value: values.effort || "默认", page: "reasoning", disabled: !values.effort },
      { label: "速度", value: values.speedAvailable ? (values.speedFast ? "快速" : "标准") : "默认", page: "speed", disabled: !values.speedAvailable }
    ];
    for (const item of navigationRows) {
      const openSubmenu = () => this.renderComposerUnifiedModelMenu(tab, control, item.page);
      const row = makeRow({
        label: item.label,
        value: item.value,
        disabled: item.disabled,
        onClick: () => {
          if (control.dataset.menuPage !== item.page) openSubmenu();
        }
      });
      row.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || row.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        openSubmenu();
      });
      row.append(makeIcon("chevron-right", "paperlib-codex-model-menu-arrow"));
      advanced.append(row);
    }
    menu.append(advanced);

    const advancedToggle = document.createElement("button");
    advancedToggle.type = "button";
    advancedToggle.className = "paperlib-codex-model-advanced-toggle";
    advancedToggle.append(document.createTextNode("高级"), makeIcon(advanced.hidden ? "chevron-down" : "chevron-up"));
    advancedToggle.addEventListener("click", () => {
      control.dataset.advancedCollapsed = String(!advanced.hidden);
      this.renderComposerUnifiedModelMenu(tab, control, "root");
    });
    menu.append(advancedToggle);
  }

  refreshComposerCodexInput(tab) {
    const input = tab?.dom?.inputEl;
    const wrapper = input?.closest?.(".paper-composer-input-wrapper");
    const sendButton = wrapper?.querySelector?.(".paperlib-codex-send-btn");
    if (!input || !sendButton) return;
    const streaming = Boolean(tab?.state?.isStreaming);
    const state = this.getComposerPdfState(tab);
    const hasImages = Boolean(tab?.ui?.imageContextManager?.hasImages?.());
    const hasContent = Boolean(String(input.value || "").trim() || hasImages || state?.attachments?.length);
    const permissionLabel = wrapper.querySelector(".paper-composer-permission-label");
    if (permissionLabel) {
      const permissionNames = {
        YOLO: "完全访问",
        SAFE: "受限访问",
        PLAN: "规划模式"
      };
      const visibleName = String(permissionLabel.textContent || "").trim();
      const localizedName = permissionNames[visibleName.toUpperCase()];
      if (localizedName && visibleName !== localizedName) permissionLabel.textContent = localizedName;
    }
    const visualState = streaming ? "stop" : "send";
    if (sendButton.dataset.visualState !== visualState) {
      sendButton.dataset.visualState = visualState;
      setIcon(sendButton, streaming ? "square" : "arrow-up");
    }
    sendButton.disabled = !streaming && !hasContent;
    sendButton.toggleClass("is-streaming", streaming);
    sendButton.setAttribute("aria-label", streaming ? "停止生成" : "发送消息");
    sendButton.title = streaming ? "停止生成" : "发送消息";
    this.ensureComposerUnifiedModelControl(tab, state);
  }

  ensureComposerTopControls(tab, state = this.getComposerPdfState(tab)) {
    const input = tab?.dom?.inputEl;
    const container = input?.closest?.(".paper-composer-container");
    const wrapper = input?.closest?.(".paper-composer-input-wrapper");
    if (!container || !wrapper) return;
    let button = container.querySelector(".paperlib-composer-settings-btn");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "paper-composer-input-nav-btn paperlib-composer-settings-btn";
      button.setAttribute("aria-haspopup", "menu");
      setIcon(button, "settings-2");
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleComposerPdfModeMenu(button);
      });
    }
    const actions = container.querySelector(".paper-composer-input-nav-actions");
    if (actions) {
      // focusin is observed during pointerdown. Moving an already-mounted
      // button here makes the browser cancel the click that follows.
      if (button.parentElement !== actions) actions.append(button);
      container.querySelector(".paperlib-composer-mode-settings-row")?.remove?.();
    } else {
      let row = wrapper.parentElement?.querySelector?.(".paperlib-composer-mode-settings-row");
      if (!row) {
        row = document.createElement("div");
        row.className = "paperlib-composer-mode-settings-row";
        wrapper.before(row);
      }
      if (button.parentElement !== row) row.append(button);
    }
    if (typeof MutationObserver !== "undefined" && state && !state.topControlsObserver) {
      state.topControlsObserver = new MutationObserver(() => {
        if (state.topControlsScheduled) return;
        state.topControlsScheduled = true;
        window.setTimeout(() => {
          state.topControlsScheduled = false;
          if (!container.isConnected || !tab?.dom?.inputEl?.isConnected) {
            state.topControlsObserver?.disconnect?.();
            state.topControlsObserver = null;
            return;
          }
          this.ensureComposerTopControls(tab, state);
          this.ensureComposerCodexInput(tab, state);
        }, 0);
      });
      state.topControlsObserver.observe(container, { childList: true, subtree: true });
    }
    this.refreshComposerModeButtons();
  }

  refreshComposerModeButtons() {
    const mode = this.getPdfAiMode();
    document.querySelectorAll(".paperlib-composer-settings-btn").forEach((button) => {
      button.dataset.mode = mode;
      button.title = mode === "local" ? "文档处理：本地解析" : "文档处理：源文件";
      button.setAttribute("aria-label", button.title);
    });
    document.querySelectorAll(".paperlib-composer-mode-menu").forEach((menu) => {
      menu.querySelectorAll("[data-mode]").forEach((item) => {
        const active = item.dataset.mode === mode;
        item.toggleClass?.("is-active", active);
        item.setAttribute("aria-checked", String(active));
      });
    });
  }

  closeComposerPdfModeMenus() {
    document.querySelectorAll(".paperlib-composer-mode-menu").forEach((menu) => {
      menu.paperLibraryCleanup?.();
      menu.remove();
    });
    document.querySelectorAll(".paperlib-composer-settings-btn[aria-expanded='true']")
      .forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  toggleComposerPdfModeMenu(button) {
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    this.closeComposerPdfModeMenus();
    if (wasOpen) return;
    const menu = document.createElement("div");
    menu.className = "paperlib-composer-mode-menu";
    menu.setAttribute("role", "menu");
    const heading = document.createElement("div");
    heading.className = "paperlib-composer-mode-menu-heading";
    heading.textContent = "文档处理方式";
    menu.append(heading);
    [
      { id: "local", label: "本地解析", detail: "在本机处理并按问题检索全文", icon: "scan-text" },
      { id: "direct", label: "源文件", detail: "将完整文件直接交给当前模型", icon: "file-up" }
    ].forEach((mode) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "paperlib-composer-mode-option";
      item.dataset.mode = mode.id;
      item.setAttribute("role", "menuitemradio");
      const icon = document.createElement("span");
      icon.className = "paperlib-composer-mode-option-icon";
      setIcon(icon, mode.icon);
      const copy = document.createElement("span");
      const label = document.createElement("strong");
      label.textContent = mode.label;
      const detail = document.createElement("small");
      detail.textContent = mode.detail;
      copy.append(label, detail);
      const check = document.createElement("span");
      check.className = "paperlib-composer-mode-option-check";
      setIcon(check, "check");
      item.append(icon, copy, check);
      item.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (mode.id !== this.getPdfAiMode()) await this.setPdfAiMode(mode.id);
        this.closeComposerPdfModeMenus();
      });
      menu.append(item);
    });
    document.body.append(menu);
    button.setAttribute("aria-expanded", "true");
    const rect = button.getBoundingClientRect();
    const width = Math.min(286, Math.max(220, window.innerWidth - 20));
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(10, Math.min(window.innerWidth - width - 10, rect.right - width))}px`;
    menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 10, rect.bottom + 7)}px`;
    const dismiss = (event) => {
      if (menu.contains(event.target) || button.contains(event.target)) return;
      this.closeComposerPdfModeMenus();
    };
    menu.paperLibraryCleanup = () => document.removeEventListener("pointerdown", dismiss, true);
    window.setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
    this.refreshComposerModeButtons();
  }

  renderComposerPdfTray(tab) {
    const state = this.getComposerPdfState(tab);
    const strip = state?.strip;
    if (!strip) return;
    const currentMode = this.getPdfAiMode();
    const linkedAttachment = state.attachments.find((attachment) => attachment.workspaceLinked) || null;
    const visibleAttachments = state.attachments.filter((attachment) => !attachment.workspaceLinked);
    this.decorateComposerLinkedPdfChip(tab, linkedAttachment);
    const hasPdfs = visibleAttachments.length > 0;
    const processingCount = currentMode === "local"
      ? visibleAttachments.filter((attachment) => attachment.processing).length
      : 0;
    const isVisible = hasPdfs;
    strip.hidden = !isVisible;
    strip.setAttribute("aria-hidden", String(!isVisible));
    strip.toggleClass?.("has-pdfs", hasPdfs);
    strip.toggleClass?.("is-busy", state.busy);
    strip.toggleClass?.("is-processing", processingCount > 0);
    const contextRow = state.contextRow;
    if (contextRow) {
      if (isVisible) contextRow.classList.add("has-content");
      else if (state.contextRowFallback) contextRow.classList.remove("has-content");
    }
    if (!isVisible) {
      Array.from(strip.children).forEach((chip) => chip.remove());
      this.refreshComposerCodexInput(tab);
      return;
    }
    const stale = new Set(Array.from(strip.children));
    visibleAttachments.forEach((attachment, index) => {
      let chip = Array.from(strip.children)
        .find((element) => element.paperLibraryAttachment === attachment);
      if (!chip) {
        chip = document.createElement("div");
        chip.className = "paperlib-composer-pdf-chip";
        chip.paperLibraryAttachment = attachment;
        const icon = document.createElement("span");
        icon.className = "paperlib-composer-pdf-chip-icon";
        setIcon(icon, "file-text");
        const copy = document.createElement("div");
        const label = document.createElement("strong");
        const detail = document.createElement("span");
        const progressTrack = document.createElement("span");
        progressTrack.className = "paperlib-composer-pdf-progress";
        const progressValue = document.createElement("i");
        progressTrack.append(progressValue);
        copy.append(label, detail, progressTrack);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "paperlib-composer-pdf-remove";
        setIcon(remove, "x");
        remove.addEventListener("pointerdown", (event) => event.stopPropagation());
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          const currentAttachment = chip.paperLibraryAttachment;
          currentAttachment.cancelled = true;
          state.attachments = state.attachments.filter((item) => item !== currentAttachment);
          this.renderComposerPdfTray(tab);
        });
        chip.paperLibraryParts = { label, detail, progressTrack, progressValue, remove };
        chip.append(icon, copy, remove);
      }
      stale.delete(chip);
      chip.paperLibraryAttachment = attachment;
      const { label, detail, progressTrack, progressValue, remove } = chip.paperLibraryParts;
      const showProcessing = currentMode === "local" && Boolean(attachment.processing);
      const showProcessingError = currentMode === "local" && Boolean(attachment.processingError);
      chip.toggleClass?.("is-processing", showProcessing);
      chip.toggleClass?.("has-error", showProcessingError);
      label.textContent = attachment.label || "document.pdf";
      const progress = attachment.processingProgress || {};
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)));
      if (currentMode === "direct") {
        detail.textContent = `源文件 · ${formatAIFileSize(attachment.byteLength || 0)}`;
      } else if (showProcessing) {
        const eta = percent >= 2 && Number.isFinite(progress.etaMs)
          ? ` · 剩余${formatAIRemainingTime(progress.etaMs)}`
          : " · 正在估算时间";
        detail.textContent = `${progress.stage || "准备本地解析"} · ${percent}%${eta}`;
      } else if (showProcessingError) {
        detail.textContent = "文件读取失败 · 点击移除后重试";
        chip.title = attachment.processingError;
      } else if (attachment.pdfMode === "direct") {
        detail.textContent = formatAIFileSize(attachment.byteLength || 0);
      } else if (attachment.pdfSession) {
        detail.textContent = `${attachment.pdfSession.processedPages} 页 · ${attachment.pdfSession.characterCount} 字符${attachment.pdfSession.cacheHit ? " · 已复用" : " · 已保存"}`;
      } else {
        detail.textContent = "等待处理";
      }
      if (!showProcessing && currentMode === "local" && attachment.pdfMode === "direct" && attachment.localFallbackReason) {
        detail.textContent = "处理不可用，将发送原文件";
        chip.title = attachment.localFallbackReason;
      }
      if (!showProcessingError) chip.title = detail.textContent;
      progressTrack.style.display = showProcessing ? "block" : "none";
      progressValue.style.width = `${Math.max(2, percent)}%`;
      remove.title = "移除 PDF 上下文";
      remove.setAttribute("aria-label", `移除 ${attachment.label || "PDF"}`);
      const currentAtIndex = strip.children[index];
      if (currentAtIndex !== chip) strip.insertBefore(chip, currentAtIndex || null);
    });
    stale.forEach((chip) => chip.remove());
    this.refreshComposerCodexInput(tab);
  }

  decorateComposerLinkedPdfChip(tab, attachment = null) {
    const row = this.getComposerPdfState(tab)?.contextRow;
    if (!row) return;
    const currentMode = this.getPdfAiMode();
    const nativeChips = Array.from(row.querySelectorAll(
      '.paper-composer-context-chip[data-context-slot="linked-content"]'
    ));
    const expectedLabel = String(attachment?.label || "")
      .replace(/\.pdf$/i, "").trim().toLocaleLowerCase();
    const targetChip = attachment ? (nativeChips.find((chip) => {
      const label = String(chip.querySelector?.(".paper-composer-context-chip-label")?.textContent || chip.textContent || "")
        .replace(/\.pdf$/i, "").trim().toLocaleLowerCase();
      return expectedLabel && (label === expectedLabel || label.includes(expectedLabel) || expectedLabel.includes(label));
    }) || nativeChips[0] || null) : null;
    for (const chip of nativeChips) {
      const isLinkedPdfChip = Boolean(attachment && chip === targetChip);
      const showProcessing = currentMode === "local" && Boolean(isLinkedPdfChip && attachment?.processing);
      const showProcessingError = currentMode === "local" && Boolean(isLinkedPdfChip && attachment?.processingError);
      chip.classList.toggle("paperlib-paper-composer-linked-pdf-chip", isLinkedPdfChip);
      chip.classList.toggle("is-processing", showProcessing);
      chip.classList.toggle("has-error", showProcessingError);
      chip.classList.toggle("has-status", isLinkedPdfChip);
      let status = chip.querySelector(":scope > .paperlib-linked-pdf-status");
      if (!isLinkedPdfChip) {
        chip.style.removeProperty("--paperlib-linked-pdf-progress");
        status?.remove();
        continue;
      }
      const progress = attachment.processingProgress || {};
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)));
      if (showProcessing) chip.style.setProperty("--paperlib-linked-pdf-progress", `${Math.max(2, percent)}%`);
      else chip.style.removeProperty("--paperlib-linked-pdf-progress");
      if (!status) {
        status = document.createElement("span");
        status.className = "paperlib-linked-pdf-status";
        status.setAttribute("aria-live", "polite");
        status.setAttribute("aria-atomic", "true");
        chip.append(status);
      }
      let statusText = "";
      if (currentMode === "direct") {
        statusText = `源文件 · ${formatAIFileSize(attachment.byteLength || 0)}`;
      } else if (showProcessing) {
        const eta = percent >= 2 && Number.isFinite(progress.etaMs)
          ? ` · 剩余${formatAIRemainingTime(progress.etaMs)}`
          : " · 正在估算时间";
        statusText = `${progress.stage || "本地解析"} · ${percent}%${eta}`;
      } else if (showProcessingError) {
        statusText = "文件处理失败 · 请移除后重试";
      } else if (attachment.pdfSession) {
        const session = attachment.pdfSession;
        const processedPages = Number(session.processedPages) || 0;
        const totalPages = Number(session.totalPages) || processedPages;
        const characterCount = Number(session.characterCount) || 0;
        statusText = `解析完成 · ${processedPages}/${totalPages} 页 · ${characterCount} 字符${session.cacheHit ? " · 已复用" : " · 已保存"}`;
      } else if (attachment.localFallbackReason) {
        statusText = "本地解析不可用 · 将发送源文件";
      } else {
        statusText = `源文件 · ${formatAIFileSize(attachment.byteLength || 0)}`;
      }
      if (status.textContent !== statusText) status.textContent = statusText;
      chip.title = showProcessingError
        ? `${statusText}：${attachment.processingError}`
        : statusText;
    }
  }

  refreshComposerPdfTrays() {
    for (const tab of this.composerPdfTabs || []) {
      if (!tab?.dom?.inputEl?.isConnected) {
        tab?.paperLibraryPdfState?.topControlsObserver?.disconnect?.();
        tab?.paperLibraryPdfState?.linkedContentObserver?.disconnect?.();
        tab?.paperLibraryPdfState?.voiceRecognition?.abort?.();
        this.cleanupComposerUnifiedModelControl(tab);
        this.composerPdfTabs.delete(tab);
        continue;
      }
      this.renderComposerPdfTray(tab);
    }
  }

  addComposerPdfAttachments(tab, attachments) {
    const state = this.ensureClaudianPdfBridge(tab);
    if (!state) return;
    const known = new Set(state.attachments.map((item) => item.key || `${item.path}:${item.label}`));
    for (const attachment of attachments || []) {
      const key = attachment.key || `${attachment.path}:${attachment.label}`;
      if (!known.has(key)) {
        state.attachments.push(attachment);
        known.add(key);
      }
    }
    this.renderComposerPdfTray(tab);
  }

  updateComposerPdfProgress(tab, attachment, update = {}) {
    if (!attachment || attachment.cancelled) return;
    const startedAt = attachment.processingStartedAt || Date.now();
    attachment.processingStartedAt = startedAt;
    const percent = Math.max(0, Math.min(100, Number(update.percent) || 0));
    const elapsed = Math.max(1, Date.now() - startedAt);
    const measuredEta = percent >= 2 && percent < 100
      ? elapsed * (100 - percent) / percent
      : null;
    attachment.processingProgress = {
      ...(attachment.processingProgress || {}),
      ...update,
      percent,
      etaMs: Number.isFinite(update.etaMs) ? update.etaMs : measuredEta
    };
    this.renderComposerPdfTray(tab);
  }

  queueComposerPdfAttachment(tab, descriptor, loadBuffer) {
    const state = this.ensureClaudianPdfBridge(tab);
    const descriptorKey = descriptor.key || `pdf:${descriptor.path || descriptor.name || uniqueId()}`;
    const existing = state?.attachments?.find((item) => item.key === descriptorKey);
    if (existing) {
      if (descriptor.workspaceLinked) existing.workspaceLinked = true;
      return existing;
    }
    const attachment = {
      type: "pdf",
      label: descriptor.name || "document.pdf",
      path: descriptor.path || "",
      nativePath: descriptor.nativePath || "",
      byteLength: Number(descriptor.byteLength) || 0,
      key: descriptorKey,
      metadataText: descriptor.metadataText || "",
      linkedPage: Number(descriptor.linkedPage) || null,
      workspaceLinked: Boolean(descriptor.workspaceLinked),
      processing: true,
      processingStartedAt: Date.now(),
      processingProgress: { stage: "读取文件", percent: 1, etaMs: null }
    };
    this.addComposerPdfAttachments(tab, [attachment]);
    const sourceReadyPromise = (async () => {
      const buffer = await loadBuffer();
      const bytes = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      attachment.byteLength = bytes.byteLength;
      if (descriptor.keepBytes) attachment.pdfData = arrayBufferToBase64(bytes);
      this.updateComposerPdfProgress(tab, attachment, { stage: "准备本地解析", percent: 2 });
      return bytes;
    })();
    attachment.sourceReadyPromise = sourceReadyPromise;
    attachment.processingPromise = (async () => {
      try {
        const bytes = await sourceReadyPromise;
        const prepared = await this.createPdfAIAttachment(bytes, {
          name: attachment.label,
          path: attachment.path,
          key: attachment.key,
          keepBytes: Boolean(descriptor.keepBytes),
          onProgress: (progress) => this.updateComposerPdfProgress(tab, attachment, progress)
        });
        Object.assign(attachment, prepared, {
          nativePath: attachment.nativePath,
          metadataText: attachment.metadataText,
          processing: false,
          processingError: ""
        });
        this.updateComposerPdfProgress(tab, attachment, { stage: "解析完成", percent: 100, etaMs: 0 });
        return attachment;
      } catch (error) {
        attachment.processing = false;
        attachment.processingError = String(error?.message || error);
        console.error("Paper Library: document attachment preparation failed", error);
        if (!attachment.cancelled) new Notice(`文件处理失败：${attachment.processingError}`);
        throw error;
      } finally {
        this.renderComposerPdfTray(tab);
      }
    })();
    // The card owns the error state; avoid an unhandled rejection when the user
    // removes it before sending.
    attachment.processingPromise.catch(() => {});
    return attachment;
  }

  async composerPdfFilePath(attachment) {
    if (attachment?.nativePath) return attachment.nativePath;
    if (attachment?.path) return normalizePath(attachment.path);
    if (attachment?.composerCachePath) return attachment.composerCachePath;
    if (!attachment?.pdfData) throw new Error(`找不到 PDF 原文件：${attachment?.label || "未知文件"}`);
    const adapter = this.app.vault.adapter;
    // Keep the existing cache directory so upgrades continue to reuse earlier
    // local parsing results; it already lives under Paper Library's plugin dir.
    const cacheDir = normalizePath(`${this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`}/claudian-pdf-cache`);
    if (!await adapter.exists(cacheDir)) await adapter.mkdir(cacheDir);
    const safeName = String(attachment.label || "document.pdf")
      .replace(/[^a-zA-Z0-9._\-\u3400-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document.pdf";
    const cachePath = normalizePath(`${cacheDir}/${uniqueId()}-${safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`}`);
    await adapter.writeBinary(cachePath, base64ToArrayBuffer(attachment.pdfData));
    attachment.composerCachePath = typeof adapter.getFullPath === "function"
      ? adapter.getFullPath(cachePath)
      : cachePath;
    return attachment.composerCachePath;
  }

  async sendClaudianMessageWithPdf(tab, originalSendMessage, options) {
    const state = this.getComposerPdfState(tab);
    const pending = [...(state?.attachments || [])];
    if (!pending.length) return originalSendMessage(options);
    const input = tab.dom?.inputEl;
    const content = options?.content !== undefined ? String(options.content || "") : String(input?.value || "");
    if (/^\/compact(?:\s|$)/i.test(content.trim())) return originalSendMessage(options);
    if (!content.trim() && input && options?.content === undefined) {
      input.value = "请分析这些 PDF，并在回答中引用相关页码。";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    }
    const visibleContent = options?.content !== undefined ? String(options.content || "") : String(input?.value || "");
    const previousUserMessageIds = new Set((this.claudianRuntime?.getCachedConversation?.(tab?.conversationId)?.messages || [])
      .filter((message) => message?.role === "user" && message.id)
      .map((message) => message.id));
    const directInflightKeys = [];
    state.busy = true;
    this.renderComposerPdfTray(tab);
    try {
      const imageManager = tab.ui?.imageContextManager;
      const images = options?.images ?? imageManager?.getAttachedImages?.() ?? [];
      const controller = tab.controllers?.inputController;
      const built = controller?.buildTurnSubmission?.({
        content: visibleContent,
        images: images.length ? [...images] : undefined,
        editorContextOverride: options?.editorContextOverride,
        browserContextOverride: options?.browserContextOverride,
        canvasContextOverride: options?.canvasContextOverride
      });
      const existingRequest = options?.turnRequestOverride;
      const request = existingRequest ? {
        ...existingRequest,
        images: existingRequest.images ? [...existingRequest.images] : undefined,
        externalContextPaths: existingRequest.externalContextPaths
          ? [...existingRequest.externalContextPaths]
          : undefined
      } : (built?.turnRequest || {
        text: visibleContent,
        images: images.length ? [...images] : undefined
      });
      const localBlocks = [];
      const directFiles = [];
      const directContextPaths = [];
      const directBindingsToRemember = [];
      const localBindingsToRemember = [];
      const sentPdfCards = [];
      for (const attachment of pending) {
        const prepared = await this.preparePdfAttachmentForMode(attachment);
        if (prepared.pdfMode === "direct") {
          const path = await this.composerPdfFilePath(prepared);
          // Keep the path available as a persistent linked workspace root, but
          // introduce the actual source document only once per model session.
          directContextPaths.push(path);
          const inflightKey = `direct:${this.composerDirectContextSourceFingerprint(prepared)}`;
          const introduceSource = !prepared.workspaceLinked
            || (!state.directContextInflight.has(inflightKey)
              && !this.hasComposerDirectContextBinding(tab, prepared));
          if (introduceSource) {
            directFiles.push({
              label: prepared.label || "document.pdf",
              path,
              metadataText: prepared.metadataText || "",
              fallbackReason: prepared.localFallbackReason || ""
            });
            sentPdfCards.push(this.composerSentPdfDescriptor(prepared, {
              contextSignature: this.composerDirectContextExecutionSignature(tab)
            }));
            if (prepared.workspaceLinked) {
              state.directContextInflight.add(inflightKey);
              directInflightKeys.push(inflightKey);
              directBindingsToRemember.push(prepared);
            }
          }
        } else {
          const inflightKey = `local:${this.composerDirectContextSourceFingerprint(prepared)}`;
          const introduceLocalContext = !prepared.workspaceLinked
            || (!state.directContextInflight.has(inflightKey)
              && !this.hasComposerLocalContextBinding(tab, prepared));
          if (introduceLocalContext) {
            const initialContext = this.buildInitialLocalPdfContext(prepared.pdfSession);
            sentPdfCards.push(this.composerSentPdfDescriptor(prepared, {
              selectedPageCount: initialContext.selectedPages.length,
              contextSignature: this.composerDirectContextExecutionSignature(tab)
            }));
            if (prepared.workspaceLinked) {
              state.directContextInflight.add(inflightKey);
              directInflightKeys.push(inflightKey);
              localBindingsToRemember.push(prepared);
            }
            localBlocks.push([
              `### ${prepared.label || "PDF"}`,
              prepared.metadataText || "",
              initialContext.text
            ].filter(Boolean).join("\n\n"));
          }
        }
      }
      if (localBlocks.length) {
        request.text = [
          request.text || visibleContent,
          "## Paper Library 本地 PDF 全文上下文",
          "以下内容由本地解析生成，仅在当前模型会话首次建立文档上下文时注入。后续消息请沿用这份上下文，并在回答中标注页码。",
          ...localBlocks
        ].filter(Boolean).join("\n\n");
      }
      if (directContextPaths.length) {
        request.externalContextPaths = [...new Set([
          ...(request.externalContextPaths || []),
          ...directContextPaths
        ])];
      }
      if (directFiles.length) {
        request.text = [
          request.text || visibleContent,
          "## Paper Library 原始 PDF 文件",
          "请直接读取下列 PDF 文件本身，并结合整篇文档回答；引用结论时注明页码。不要只依据当前选区。",
          ...directFiles.map((item) => [
            `- ${item.label}: ${item.path}`,
            item.metadataText
          ].filter(Boolean).join("\n"))
        ].filter(Boolean).join("\n\n");
        const automatic = directFiles.filter((item) => item.fallbackReason);
        if (automatic.length) {
          new Notice(`本地解析不可用，已将 ${automatic.length} 个文档改为完整原文件发送`);
        }
      }
      const sentPdfCardCancellation = { cancelled: false };
      const sendTask = Promise.resolve(originalSendMessage({ ...(options || {}), turnRequestOverride: request }));
      // The user's message is admitted near the start of sendTask, while the
      // promise resolves only after the assistant finishes. Bind the visible
      // card concurrently so it appears during streaming, not after it.
      const sentPdfCardTask = this.recordComposerSentPdfCards(tab, sentPdfCards, previousUserMessageIds, {
        cancellation: sentPdfCardCancellation,
        timeoutMs: 10000
      }).catch((error) => {
        console.error("Paper Library: sent PDF card persistence failed", error);
        return false;
      });
      let result;
      try {
        result = await sendTask;
      } catch (error) {
        sentPdfCardCancellation.cancelled = true;
        throw error;
      }
      // Keep the relationship card after sending. Both source and local modes
      // remember the admitted model session and do not inject the document again.
      state.attachments = state.attachments.filter((item) => (
        !pending.includes(item) || item.workspaceLinked
      ));
      await sentPdfCardTask;
      try {
        await this.rememberComposerDirectContextBindings(tab, directBindingsToRemember);
        await this.rememberComposerLocalContextBindings(tab, localBindingsToRemember);
      } catch (error) {
        console.warn("Paper Library: failed to persist document context binding", error);
      }
      return result;
    } catch (error) {
      try {
        await this.invalidateComposerDirectContextBindings(tab, pending);
      } catch (bindingError) {
        console.warn("Paper Library: failed to invalidate direct document context binding", bindingError);
      }
      console.error("Paper Library: Paper Composer PDF submission failed", error);
      new Notice(`PDF 上下文发送失败：${error?.message || error}`);
      throw error;
    } finally {
      directInflightKeys.forEach((key) => state.directContextInflight.delete(key));
      state.busy = false;
      this.renderComposerPdfTray(tab);
    }
  }

  async addClaudianContexts(attachments, options = {}) {
    const list = (attachments || []).filter(Boolean);
    if (!list.length && !options.draft) return null;
    const tab = options.tab || await this.waitForClaudianTab();
    this.bindComposerLinkedContent(tab, list, options);
    const pdfs = list.filter((attachment) => attachment.type === "pdf");
    if (pdfs.length) this.addComposerPdfAttachments(tab, pdfs);
    const visibleAttachments = list.filter((attachment) => attachment.type !== "pdf");
    const images = visibleAttachments.map((attachment) => this.claudianImageFromAttachment(attachment)).filter(Boolean);
    if (images.length) {
      const manager = tab.ui?.imageContextManager;
      const combinedImages = [...(manager?.getAttachedImages?.() || []), ...images];
      manager?.setImages?.(combinedImages);
      this.decorateClaudianImageTray(tab, combinedImages);
    }
    const contextText = visibleAttachments.map((attachment) => this.formatClaudianContext(attachment)).filter(Boolean).join("\n\n");
    const input = tab.dom.inputEl;
    const current = String(input.value || "");
    const insertion = [
      !current.trim() ? String(options.draft || "").trim() : "",
      contextText
    ].filter(Boolean).join("\n\n");
    if (insertion) {
      const start = Number.isFinite(input.selectionStart) ? input.selectionStart : current.length;
      const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const leftGap = before && !before.endsWith("\n") ? "\n\n" : "";
      const rightGap = after && !after.startsWith("\n") ? "\n\n" : "";
      input.value = `${before}${leftGap}${insertion}${rightGap}${after}`;
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromDrop",
        data: insertion
      }));
      const cursor = before.length + leftGap.length + insertion.length;
      input.setSelectionRange(cursor, cursor);
    }
    input.focus();
    return tab;
  }

  resolveComposerLinkedContentPath(attachments, options = {}) {
    const candidates = [];
    for (const attachment of attachments || []) {
      candidates.push(attachment?.linkedContentPath, attachment?.sourcePath, attachment?.path);
    }
    candidates.push(options.sourcePath);
    if (options.allowActiveFileFallback !== false) {
      candidates.push(this.app.workspace.getActiveFile?.()?.path);
    }
    for (const candidate of candidates) {
      const rawPath = String(candidate || "").trim();
      if (!rawPath || /^https?:\/\//i.test(rawPath)) continue;
      const path = normalizePath(rawPath);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file?.path) return file.path;
    }
    return "";
  }

  bindComposerLinkedContent(tab, attachments, options = {}) {
    const path = this.resolveComposerLinkedContentPath(attachments, options);
    const controller = tab?.ui?.linkedContentController;
    if (!path || !controller?.getSnapshot || !controller?.selectExplicit) return false;
    const snapshot = controller.getSnapshot();
    if (normalizePath(snapshot?.path || "") === normalizePath(path)) return true;
    try {
      if (snapshot?.mode === "locked" && controller.resetAutoDraft) controller.resetAutoDraft();
      controller.selectExplicit(path);
      this.ensureClaudianPdfBridge(tab);
      return true;
    } catch (error) {
      console.warn("Paper Library: failed to bind Composer Linked content", error);
      return false;
    }
  }

  installClaudianDropBridge() {
    if (!this.registerDomEvent || typeof document === "undefined") return;
    let mountScheduled = false;
    const mountComposerInputs = () => {
      if (mountScheduled) return;
      mountScheduled = true;
      window.setTimeout(() => {
        mountScheduled = false;
        const runtime = this.claudianRuntime;
        const views = typeof runtime?.getAllViews === "function"
          ? runtime.getAllViews()
          : [runtime?.getView?.()].filter(Boolean);
        for (const view of views || []) {
          const manager = view?.getTabManager?.();
          const tabs = typeof manager?.getAllTabs === "function"
            ? manager.getAllTabs()
            : [manager?.getActiveTab?.()].filter(Boolean);
          for (const tab of tabs || []) {
            if (tab?.dom?.inputEl?.isConnected) {
              this.ensureClaudianPdfBridge(tab);
              this.decorateClaudianSentImageCards(tab);
              this.decorateClaudianSentPdfCards(tab);
            }
          }
        }
      }, 0);
    };
    const composerMountSelector = ".paper-composer-input-wrapper, .paper-composer-input-toolbar, textarea.paper-composer-input, .paper-composer-message-images, .paper-composer-message-user";
    this.composerMountObserver?.disconnect?.();
    this.composerMountObserver = new MutationObserver((mutations) => {
      const hasComposerInput = mutations.some((mutation) => Array.from(mutation.addedNodes || []).some((node) => (
        node?.nodeType === 1 && (node.matches?.(composerMountSelector) || node.querySelector?.(composerMountSelector))
      )));
      if (hasComposerInput) mountComposerInputs();
    });
    this.composerMountObserver.observe(document.body, { childList: true, subtree: true });
    this.register?.(() => this.composerMountObserver?.disconnect?.());
    if (this.app.workspace?.on && this.registerEvent) {
      this.registerEvent(this.app.workspace.on("layout-change", mountComposerInputs));
      this.registerEvent(this.app.workspace.on("active-leaf-change", mountComposerInputs));
    }
    this.app.workspace?.onLayoutReady?.(mountComposerInputs);
    mountComposerInputs();

    const findWrapper = (event) => event.target?.closest?.(
      '.workspace-leaf-content[data-type="paperlib-paper-composer-view"] .paper-composer-input-wrapper'
    );
    const dragOver = (event) => {
      const wrapper = findWrapper(event);
      if (!wrapper) return;
      event.preventDefault();
      wrapper.addClass("paperlib-paper-composer-drag-over");
    };
    const dragLeave = (event) => {
      const wrapper = findWrapper(event);
      if (!wrapper || wrapper.contains(event.relatedTarget)) return;
      wrapper.removeClass("paperlib-paper-composer-drag-over");
    };
    const drop = (event) => {
      const wrapper = findWrapper(event);
      if (!wrapper) return;
      const targetTab = this.findComposerTabForInputWrapper(wrapper);
      event.preventDefault();
      event.stopImmediatePropagation();
      wrapper.removeClass("paperlib-paper-composer-drag-over");
      // DataTransfer data may be cleared once the event returns, so retain the
      // small descriptor and File references before starting asynchronous work.
      const snapshot = {
        paperIdsRaw: event.dataTransfer?.getData("application/x-paperlib-papers") || "",
        nodeId: event.dataTransfer?.getData("application/x-paperlib-node") || "",
        pdfSelectionRaw: event.dataTransfer?.getData("application/x-paperlib-pdf-selection") || "",
        pdfFigureRaw: event.dataTransfer?.getData("application/x-paperlib-pdf-figure") || "",
        droppedText: event.dataTransfer?.getData("text/plain")
          || event.dataTransfer?.getData("text/uri-list") || "",
        sourcePath: this.app.workspace.getActiveFile?.()?.path || "",
        files: Array.from(event.dataTransfer?.files || [])
      };
      void (async () => {
        try {
          const recognized = await this.addComposerDrop(snapshot, { tab: targetTab });
          if (!recognized) return new Notice("没有识别到可用的 PDF、图片、节点或文字");
        } catch (error) {
          console.error("Paper Library: Paper Composer drop bridge failed", error);
          new Notice(`无法添加上下文：${error?.message || error}`);
        }
      })();
    };
    this.registerDomEvent(document, "dragenter", dragOver, true);
    this.registerDomEvent(document, "dragover", dragOver, true);
    this.registerDomEvent(document, "dragleave", dragLeave, true);
    this.registerDomEvent(document, "drop", drop, true);
    const decorateActiveComposer = (event) => {
      if (!event.target?.closest?.('.workspace-leaf-content[data-type="paperlib-paper-composer-view"]')) return;
      window.setTimeout(() => {
        const view = this.claudianRuntime?.getView?.();
        const tab = view?.getTabManager?.()?.getActiveTab?.();
        if (tab?.dom?.inputEl) this.ensureClaudianPdfBridge(tab);
      }, 0);
    };
    this.registerDomEvent(document, "focusin", decorateActiveComposer, true);
    this.registerDomEvent(document, "click", decorateActiveComposer, true);
  }

  findComposerTabForInputWrapper(wrapper) {
    if (!wrapper) return null;
    const runtime = this.claudianRuntime;
    const views = runtime?.getAllViews?.() || [runtime?.getView?.()].filter(Boolean);
    for (const view of views) {
      for (const tab of view?.getTabManager?.()?.getAllTabs?.() || []) {
        if (tab?.dom?.inputEl && wrapper.contains(tab.dom.inputEl)) return tab;
      }
    }
    return null;
  }

  async addAIContext(attachment, options = {}) {
    return this.addAIContexts([attachment], options);
  }

  async addAIContexts(attachments, options = {}) {
    const list = (attachments || []).filter(Boolean);
    const sourceKeys = this.composerPdfSourceKeysFromAttachments(list);
    const tab = await this.ensureComposerTabForDocumentSources(sourceKeys, options.tab || null);
    this.queueLinkedPdfAttachments(tab, list);
    return this.addClaudianContexts(list, { ...options, tab });
  }

  composerPdfSourceKeysFromAttachments(attachments) {
    const keys = [];
    for (const attachment of attachments || []) {
      const path = normalizePath(attachment?.path || "");
      if (path && /\.pdf$/i.test(path)) {
        keys.push(`vault:${path}`);
        continue;
      }
      if (attachment?.type !== "pdf") continue;
      if (attachment.nativePath) keys.push(`native:${attachment.nativePath}`);
      else if (attachment.key) keys.push(String(attachment.key));
      else if (attachment.label) keys.push(`document:${attachment.label}`);
    }
    return [...new Set(keys)].sort();
  }

  composerTabHasMessages(tab) {
    const conversation = tab?.conversationId
      ? this.claudianRuntime?.getCachedConversation?.(tab.conversationId)
      : null;
    return Boolean(
      conversation?.messages?.length
      || tab?.dom?.messagesEl?.querySelector?.(".paper-composer-message")
    );
  }

  async ensureComposerTabForDocumentSources(sourceKeys, preferredTab = null) {
    const signature = [...new Set((sourceKeys || []).filter(Boolean))].sort().join("\n");
    let tab = preferredTab || await this.waitForClaudianTab();
    if (!signature) return tab;
    let state = this.getComposerPdfState(tab);
    const attachedSignature = this.composerPdfSourceKeysFromAttachments(state?.attachments).join("\n");
    const currentSignature = state?.documentSourceSignature || attachedSignature;
    const needsNewConversation = currentSignature
      ? currentSignature !== signature
      : this.composerTabHasMessages(tab);
    if (needsNewConversation) {
      const runtime = this.claudianRuntime || await this.loadEmbeddedClaudian();
      const previousTabId = tab?.id;
      const view = runtime.getView?.();
      if (typeof view?.createNewTab === "function") await view.createNewTab();
      else if (typeof runtime.openNewTab === "function") await runtime.openNewTab();
      else throw new Error("无法创建新的 Paper Composer 对话");
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const candidate = runtime.getView?.()?.getTabManager?.()?.getActiveTab?.();
        if (candidate?.dom?.inputEl && (!previousTabId || candidate.id !== previousTabId)) {
          tab = candidate;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (tab?.id === previousTabId) throw new Error("新的 Paper Composer 对话尚未准备好");
      this.ensureClaudianPdfBridge(tab);
      state = this.getComposerPdfState(tab);
    }
    state.documentSourceSignature = signature;
    return tab;
  }

  queueLinkedPdfAttachments(tab, attachments) {
    const list = (attachments || []).filter(Boolean);
    const queued = [];
    for (const attachment of list) {
      const path = normalizePath(attachment?.path || "");
      if (!path || !/\.pdf$/i.test(path) || attachment.type === "pdf") continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file?.path) continue;
      queued.push(this.queueComposerPdfAttachment(tab, {
        name: file.name,
        path: file.path,
        byteLength: file.stat?.size || 0,
        key: `vault:${file.path}`,
        keepBytes: false,
        linkedPage: Number(attachment.page) || null
      }, () => this.app.vault.readBinary(file)));
    }
    return queued;
  }

  findResearchNodeForAI(nodeId) {
    for (const paper of this.settings.papers || []) {
      const node = paper.researchWorkspace?.nodes?.find((item) => item.id === nodeId);
      if (node) return { paper, node };
    }
    return null;
  }

  researchNodeToAIAttachment(paper, node) {
    const label = node.type === "excerpt"
      ? `${paper.title} · 第 ${node.page || "—"} 页摘录`
      : `${paper.title} · ${this.researchNodeLabel(node)}`;
    const parts = [
      `论文：${paper.title}`,
      node.page ? `页码：${node.page}` : "",
      node.text ? `内容：\n${node.text}` : "",
      node.comment ? `批注：\n${node.comment}` : ""
    ].filter(Boolean);
    return {
      type: "node",
      label,
      detail: node.type === "excerpt" ? "PDF 摘录节点" : "研究节点",
      text: parts.join("\n\n"),
      path: node.pdfPath || paper.pdfPath || paper.notePath || "",
      page: node.page || null,
      key: `node:${paper.id}:${node.id}`
    };
  }

  async paperToAIAttachment(paper) {
    const metadata = [
      `标题：${paper.title}`,
      paper.authors?.length ? `作者：${paper.authors.join(", ")}` : "",
      paper.year ? `年份：${paper.year}` : "",
      paper.venue ? `期刊/会议：${paper.venue}` : "",
      paper.doi ? `DOI：${paper.doi}` : "",
      paper.abstract ? `摘要：\n${paper.abstract}` : ""
    ].filter(Boolean).join("\n");
    let pdfAttachment = null;
    if (paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath)) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath));
      if (file) [pdfAttachment] = await this.vaultFileToAIAttachment(file);
    }
    if (pdfAttachment) {
      pdfAttachment.label = paper.title || pdfAttachment.label;
      pdfAttachment.metadataText = metadata;
      pdfAttachment.key = `paper:${paper.id}`;
      return pdfAttachment;
    }
    return {
      type: "paper",
      label: paper.title || "论文",
      detail: "论文元数据",
      text: metadata,
      path: paper.pdfPath || paper.notePath || "",
      key: `paper:${paper.id}`
    };
  }

  getPdfAiMode() {
    return this.settings.pdfAiMode === "local" ? "local" : "direct";
  }

  async setPdfAiMode(mode) {
    this.settings.pdfAiMode = mode === "local" ? "local" : "direct";
    // Reflect the selected transport immediately. Local preparation may safely
    // continue in the background so switching back can reuse its result.
    this.refreshComposerModeButtons();
    this.refreshComposerPdfTrays();
    await this.saveSettings();
    if (this.settings.pdfAiMode === "local") {
      for (const tab of this.composerPdfTabs || []) {
        const state = this.getComposerPdfState(tab);
        for (const attachment of state?.attachments || []) {
          if (!attachment.processing && !attachment.pdfSession) {
            this.startComposerPdfLocalPreparation(tab, attachment);
          }
        }
      }
    }
    this.refreshComposerPdfTrays();
  }

  composerPdfAttachmentBytes(attachment) {
    if (attachment?.sourceReadyPromise) return attachment.sourceReadyPromise;
    if (attachment?.pdfData) return Promise.resolve(base64ToArrayBuffer(attachment.pdfData));
    if (attachment?.path) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(attachment.path));
      if (file?.path) return this.app.vault.readBinary(file);
    }
    if (attachment?.nativePath) {
      return require("fs").promises.readFile(attachment.nativePath).then((buffer) => (
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      ));
    }
    return Promise.reject(new Error(`找不到原文件：${attachment?.label || "未知文件"}`));
  }

  startComposerPdfLocalPreparation(tab, attachment) {
    if (!attachment || attachment.cancelled || attachment.processing || attachment.pdfSession) {
      return attachment?.processingPromise || null;
    }
    attachment.processing = true;
    attachment.processingError = "";
    attachment.processingStartedAt = Date.now();
    attachment.processingProgress = { stage: "准备本地解析", percent: 1, etaMs: null };
    this.renderComposerPdfTray(tab);
    const keepBytes = Boolean(attachment.pdfData) || (!attachment.path && !attachment.nativePath);
    attachment.processingPromise = (async () => {
      try {
        const source = await this.composerPdfAttachmentBytes(attachment);
        const bytes = source instanceof ArrayBuffer
          ? source
          : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        const prepared = await this.createPdfAIAttachment(bytes, {
          name: attachment.label,
          path: attachment.path,
          key: attachment.key,
          cacheKey: attachment.key,
          keepBytes,
          onProgress: (progress) => this.updateComposerPdfProgress(tab, attachment, progress)
        });
        Object.assign(attachment, prepared, {
          processing: false,
          processingError: ""
        });
        this.updateComposerPdfProgress(tab, attachment, { stage: "解析完成", percent: 100, etaMs: 0 });
        return attachment;
      } catch (error) {
        attachment.processing = false;
        attachment.processingError = String(error?.message || error);
        if (!attachment.cancelled) new Notice(`文件处理失败：${attachment.processingError}`);
        throw error;
      } finally {
        this.renderComposerPdfTray(tab);
      }
    })();
    attachment.processingPromise.catch(() => {});
    return attachment.processingPromise;
  }

  getLocalPipelinePackStatus() {
    if (this.isMobileApp()) return { ready: false, reason: "mobile", missing: ["desktop runtime"] };
    try {
      const fs = require("fs");
      const nodePath = require("path");
      const contractPath = this.getDesktopPluginPath("pipeline/models.json");
      const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
      const modelRoot = this.getDesktopPluginPath("models/mineru-pipeline");
      const runtimeRoot = this.getDesktopPluginPath("pipeline-runtime");
      const workerPath = this.getDesktopPluginPath("pipeline/worker.cjs");
      const markerPath = this.getDesktopPluginPath(contract.runtime?.marker || "pipeline-runtime/install.json");
      const artifacts = (contract.models || []).flatMap((model) => model.artifacts || [])
        .map((artifact) => ({ ...artifact, absolutePath: nodePath.join(modelRoot, artifact.path) }));
      const missing = artifacts
        .filter((artifact) => {
          if (!fs.existsSync(artifact.absolutePath)) return true;
          return Number(artifact.size) > 0 && fs.statSync(artifact.absolutePath).size !== Number(artifact.size);
        })
        .map((artifact) => artifact.absolutePath);
      const nativeRuntimeFiles = process.platform === "darwin"
        ? ["onnxruntime_binding.node", `libonnxruntime.${contract.runtime?.onnxRuntimeCommonVersion || "1.22.0"}.dylib`]
        : process.platform === "win32"
          ? ["onnxruntime_binding.node", "onnxruntime.dll"]
          : ["onnxruntime_binding.node", "libonnxruntime.so.1"];
      const runtimeFiles = [
        nodePath.join(runtimeRoot, "node_modules/paddleocr/dist/index.cjs"),
        nodePath.join(runtimeRoot, "node_modules/onnxruntime-common/dist/cjs/index.js"),
        nodePath.join(runtimeRoot, "node_modules/onnxruntime-node/dist/index.js"),
        ...nativeRuntimeFiles.map((filename) => nodePath.join(
          runtimeRoot,
          "node_modules/onnxruntime-node/bin/napi-v6",
          process.platform,
          process.arch,
          filename
        ))
      ];
      runtimeFiles.filter((filename) => !fs.existsSync(filename)).forEach((filename) => missing.unshift(filename));
      let marker = null;
      try { marker = JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch (_) {}
      const runtimeReady = Boolean(
        marker
        && marker.pipeline === contract.pipeline
        && marker.platform === process.platform
        && marker.arch === process.arch
      );
      if (!runtimeReady) missing.unshift(markerPath);
      if (!fs.existsSync(workerPath)) missing.unshift(workerPath);
      const totalBytes = artifacts.reduce((sum, artifact) => sum + (Number(artifact.size) || 0), 0);
      const installedBytes = artifacts.reduce((sum, artifact) => {
        try { return sum + Math.min(fs.statSync(artifact.absolutePath).size, Number(artifact.size) || Infinity); }
        catch (_) { return sum; }
      }, 0);
      return {
        ready: !missing.length,
        contract,
        contractPath,
        modelRoot,
        runtimeRoot,
        workerPath,
        markerPath,
        marker,
        artifacts,
        totalBytes,
        installedBytes,
        missing
      };
    } catch (error) {
      return { ready: false, reason: String(error?.message || error), missing: ["pipeline/models.json"] };
    }
  }

  async resolveLocalPipelineNode() {
    const electronNode = process.execPath ? {
      command: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    } : null;
    const commands = process.platform === "win32"
      ? [process.env.PAPERLIB_NODE, "node.exe", "node"]
      : [process.env.PAPERLIB_NODE, "/opt/homebrew/bin/node", "/usr/local/bin/node", "node"];
    const candidates = [...commands.filter(Boolean).map((command) => ({ command, env: process.env })), electronNode]
      .filter(Boolean);
    for (const candidate of candidates) {
      try {
        const result = await this.runDesktopProcess(candidate.command, ["-p", "process.versions.node"], {
          timeout: 15 * 1000,
          env: candidate.env
        });
        const version = String(result.stdout || result.stderr || "").trim();
        const major = Number(version.match(/^v?(\d+)\./)?.[1] || 0);
        if (major < 18) continue;
        return candidate;
      } catch (_) {}
    }
    throw new Error("无法启动 Obsidian 内置 Node 运行时，也未找到系统 Node.js");
  }

  async hashLocalFile(filename) {
    const fs = require("fs");
    const crypto = require("crypto");
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filename);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async downloadLocalPipelineFile(url, destination, options = {}) {
    const fs = require("fs");
    const nodePath = require("path");
    const https = require("https");
    const http = require("http");
    await fs.promises.mkdir(nodePath.dirname(destination), { recursive: true });
    const partial = `${destination}.part`;
    let existing = 0;
    try { existing = (await fs.promises.stat(partial)).size; } catch (_) {}
    const expectedSize = Number(options.size) || 0;
    if (expectedSize > 0 && existing > expectedSize) {
      await fs.promises.rm(partial, { force: true });
      existing = 0;
    }
    if (expectedSize > 0 && existing === expectedSize) {
      const validDigest = !options.sha256
        || await this.hashLocalFile(partial) === String(options.sha256).toLowerCase();
      if (validDigest) {
        await fs.promises.rm(destination, { force: true });
        await fs.promises.rename(partial, destination);
        options.onProgress?.(expectedSize, expectedSize);
        return;
      }
      await fs.promises.rm(partial, { force: true });
      existing = 0;
    }
    const token = options.token;
    const requestOnce = (targetUrl, redirects = 0) => new Promise((resolve, reject) => {
      if (token?.cancelled) return reject(new Error("已取消下载"));
      const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
      const client = targetUrl.startsWith("http:") ? http : https;
      const request = client.get(targetUrl, { headers }, (response) => {
        const location = response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (redirects >= 8) return reject(new Error("下载重定向次数过多"));
          return resolve(requestOnce(new URL(location, targetUrl).toString(), redirects + 1));
        }
        if (![200, 206].includes(response.statusCode)) {
          response.resume();
          return reject(new Error(`下载失败（HTTP ${response.statusCode}）`));
        }
        const resumed = response.statusCode === 206 && existing > 0;
        if (!resumed) existing = 0;
        const total = existing + (Number(response.headers["content-length"]) || 0);
        const output = fs.createWriteStream(partial, { flags: resumed ? "a" : "w" });
        let received = existing;
        response.on("data", (chunk) => {
          received += chunk.length;
          options.onProgress?.(received, expectedSize || total);
        });
        response.on("error", reject);
        output.on("error", reject);
        output.on("close", resolve);
        response.pipe(output);
      });
      if (token) token.request = request;
      request.on("error", reject);
      request.setTimeout(60 * 1000, () => request.destroy(new Error("下载连接超时")));
    });
    await requestOnce(url);
    if (expectedSize > 0) {
      const actual = (await fs.promises.stat(partial)).size;
      if (actual !== expectedSize) throw new Error(`文件大小校验失败：${nodePath.basename(destination)}`);
    }
    if (options.sha256) {
      const digest = await this.hashLocalFile(partial);
      if (digest !== String(options.sha256).toLowerCase()) {
        await fs.promises.rm(partial, { force: true });
        throw new Error(`SHA-256 校验失败：${nodePath.basename(destination)}`);
      }
    }
    await fs.promises.rm(destination, { force: true });
    await fs.promises.rename(partial, destination);
  }

  async fetchLocalPipelineJson(url) {
    const https = require("https");
    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers: { "User-Agent": "Paper-Library" } }, (response) => {
        if (response.headers.location) {
          response.resume();
          return resolve(this.fetchLocalPipelineJson(new URL(response.headers.location, url).toString()));
        }
        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`无法读取运行时清单（HTTP ${response.statusCode}）`));
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      });
      request.on("error", reject);
    });
  }

  async installLocalPipelineRuntime(status, onProgress, token) {
    const nodePath = require("path");
    const packages = [
      {
        name: "paddleocr",
        version: status.contract.runtime.paddleOcrJsVersion,
        keep: (path) => path === "/package.json" || path === "/dist/index.cjs"
      },
      {
        name: "onnxruntime-common",
        version: status.contract.runtime.onnxRuntimeCommonVersion,
        keep: (path) => path === "/package.json" || path === "/dist/cjs/package.json" || /^\/dist\/cjs\/[^/]+\.js$/.test(path)
      },
      {
        name: "onnxruntime-node",
        version: status.contract.runtime.onnxRuntimeVersion,
        keep: (path) => path === "/package.json"
          || /^\/dist\/[^/]+\.js$/.test(path)
          || path.startsWith(`/bin/napi-v6/${process.platform}/${process.arch}/`)
      }
    ];
    for (const packageInfo of packages) {
      const metadata = await this.fetchLocalPipelineJson(
        `https://unpkg.com/${packageInfo.name}@${packageInfo.version}/?meta`
      );
      const files = (metadata.files || []).filter((entry) => packageInfo.keep(entry.path));
      if (!files.length) throw new Error(`运行时包缺少当前平台文件：${packageInfo.name}`);
      let index = 0;
      for (const entry of files) {
        index += 1;
        const relative = entry.path.replace(/^\/+/, "");
        const destination = nodePath.join(status.runtimeRoot, "node_modules", packageInfo.name, relative);
        const integrity = String(entry.integrity || "");
        const sha256 = integrity.startsWith("sha256-")
          ? Buffer.from(integrity.slice(7), "base64").toString("hex")
          : "";
        onProgress(`运行时 · ${packageInfo.name} ${index}/${files.length}`);
        await this.downloadLocalPipelineFile(
          `https://unpkg.com/${packageInfo.name}@${packageInfo.version}${entry.path}`,
          destination,
          { size: entry.size, sha256, token }
        );
      }
    }
  }

  async installLocalPipelinePack(onProgress = () => {}) {
    if (this.isMobileApp()) throw new Error("本地解析仅支持桌面端");
    if (this.localPipelineInstallPromise) return this.localPipelineInstallPromise;
    const token = { cancelled: false, request: null };
    this.localPipelineInstallToken = token;
    this.localPipelineInstallPromise = (async () => {
      const fs = require("fs");
      const nodePath = require("path");
      let status = this.getLocalPipelinePackStatus();
      await fs.promises.mkdir(status.modelRoot, { recursive: true });
      await fs.promises.mkdir(status.runtimeRoot, { recursive: true });
      onProgress("正在安装当前平台 ONNX Runtime…");
      await this.installLocalPipelineRuntime(status, onProgress, token);
      const total = status.artifacts.reduce((sum, artifact) => sum + (Number(artifact.size) || 0), 0);
      let completed = 0;
      for (const artifact of status.artifacts) {
        if (token.cancelled) throw new Error("已取消下载");
        let valid = false;
        try {
          const stat = await fs.promises.stat(artifact.absolutePath);
          valid = !artifact.size || stat.size === Number(artifact.size);
          if (valid && artifact.sha256) valid = await this.hashLocalFile(artifact.absolutePath) === artifact.sha256;
        } catch (_) {}
        if (!valid) {
          const label = nodePath.basename(artifact.path);
          await this.downloadLocalPipelineFile(artifact.url, artifact.absolutePath, {
            size: artifact.size,
            sha256: artifact.sha256,
            token,
            onProgress: (received) => {
              const current = Math.min(total, completed + received);
              onProgress(`模型 ${formatAIFileSize(current)} / ${formatAIFileSize(total)} · ${label}`);
            }
          });
        }
        completed += Number(artifact.size) || 0;
      }
      const node = await this.resolveLocalPipelineNode();
      await this.runDesktopProcess(node.command, ["-e", [
        `const root=${JSON.stringify(status.runtimeRoot)}`,
        "require(require('path').join(root,'node_modules','onnxruntime-node'))",
        "require(require('path').join(root,'node_modules','paddleocr'))"
      ].join(";")], { timeout: 60 * 1000, env: node.env });
      onProgress("正在校验本地解析工作进程…");
      await this.runDesktopProcess(node.command, [
        status.workerPath,
        "--self-test",
        "--models", status.modelRoot,
        "--runtime", status.runtimeRoot,
        "--contract", status.contractPath
      ], { timeout: 5 * 60 * 1000, env: node.env });
      const marker = {
        pipeline: status.contract.pipeline,
        platform: process.platform,
        arch: process.arch,
        installedAt: new Date().toISOString(),
        runtime: status.contract.runtime
      };
      const temporary = `${status.markerPath}.tmp`;
      await fs.promises.writeFile(temporary, JSON.stringify(marker, null, 2));
      await fs.promises.rename(temporary, status.markerPath);
      status = this.getLocalPipelinePackStatus();
      if (!status.ready) throw new Error(`安装后仍缺少 ${status.missing.length} 个文件`);
      onProgress("安装完成 · 本地解析已就绪");
      this.refreshComposerPdfTrays();
      new Notice("本地解析已就绪");
    })();
    try { return await this.localPipelineInstallPromise; }
    finally {
      this.localPipelineInstallPromise = null;
      this.localPipelineInstallToken = null;
    }
  }

  cancelLocalPipelineInstall() {
    const token = this.localPipelineInstallToken;
    if (!token) return;
    token.cancelled = true;
    try { token.request?.destroy?.(new Error("已取消下载")); } catch (_) {}
  }

  async removeLocalPipelinePack() {
    if (this.isMobileApp()) throw new Error("本地解析仅支持桌面端");
    const fs = require("fs");
    await Promise.all([
      this.getDesktopPluginPath("models/mineru-pipeline"),
      this.getDesktopPluginPath("pipeline-runtime"),
      this.getDesktopPluginPath("pipeline-cache")
    ].map((path) => fs.promises.rm(path, { recursive: true, force: true })));
    this.refreshComposerPdfTrays();
    new Notice("已删除本地解析运行时、模型与缓存");
  }

  async renderPdfForLocalPipeline(buffer, inputRoot, options = {}) {
    const fs = require("fs");
    const nodePath = require("path");
    const pdfjs = await loadPdfJs();
    let document = null;
    try {
      document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
      const totalPages = Number(document.numPages) || 0;
      const pageCount = Math.min(totalPages, Math.max(1, Number(this.settings.aiLocalPdfMaxPages) || 500));
      await fs.promises.mkdir(inputRoot, { recursive: true });
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, Math.max(1.25, 1800 / Math.max(baseViewport.width, baseViewport.height)));
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        await page.render({ canvasContext: context, viewport }).promise;
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const filename = `page-${String(pageNumber).padStart(4, "0")}.rgba`;
        await fs.promises.writeFile(nodePath.join(inputRoot, filename), Buffer.from(image.data.buffer));
        pages.push({ page: pageNumber, width: canvas.width, height: canvas.height, file: filename });
        options.onProgress?.(pageNumber, pageCount);
        canvas.width = 1;
        canvas.height = 1;
      }
      const descriptor = { totalPages, processedPages: pageCount, pages };
      const descriptorPath = nodePath.join(inputRoot, "pages.json");
      await fs.promises.writeFile(descriptorPath, JSON.stringify(descriptor));
      return descriptorPath;
    } finally {
      try { await document?.destroy?.(); } catch (_) {}
    }
  }

  async tryNativeLocalPdfPipeline(buffer, options = {}) {
    if (this.isMobileApp()) return null;
    const status = this.getLocalPipelinePackStatus();
    if (!status.ready) return null;
    const fs = require("fs");
    const nodePath = require("path");
    const crypto = require("crypto");
    const file = options.path ? this.app.vault.getAbstractFileByPath(normalizePath(options.path)) : null;
    const bytes = buffer instanceof ArrayBuffer
      ? buffer
      : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const cacheHash = crypto.createHash("sha256").update(String(status.contract.pipeline || "local-pipeline"));
    if (options.cacheKey) cacheHash.update(String(options.cacheKey));
    else if (file) cacheHash.update(`${file.path}:${file.stat?.mtime || 0}:${file.stat?.size || 0}`);
    else cacheHash.update(Buffer.from(bytes));
    const cacheKey = cacheHash.digest("hex");
    const outputPath = this.getDesktopPluginPath(nodePath.join("pipeline-cache", cacheKey));
    const documentPath = nodePath.join(outputPath, "document.json");
    const metadataPath = nodePath.join(outputPath, "cache.json");
    await fs.promises.mkdir(outputPath, { recursive: true });
    const cacheHit = fs.existsSync(documentPath);
    if (cacheHit) {
      options.onProgress?.({ stage: "读取本地缓存", percent: 100, etaMs: 0, cacheHit: true });
    } else {
      options.onProgress?.({ stage: "渲染页面", percent: 2 });
      const inputRoot = nodePath.join(outputPath, "input");
      const inputPath = await this.renderPdfForLocalPipeline(bytes, inputRoot, {
        onProgress: (current, total) => options.onProgress?.({
          stage: `渲染页面 ${current}/${total}`,
          current,
          total,
          percent: 2 + (28 * current / Math.max(1, total))
        })
      });
      const node = await this.resolveLocalPipelineNode();
      let outputTail = "";
      try {
        await this.runDesktopProcess(node.command, [
          status.workerPath,
          "--input", inputPath,
          "--models", status.modelRoot,
          "--output", outputPath,
          "--runtime", status.runtimeRoot,
          "--contract", status.contractPath
        ], {
          timeout: 90 * 60 * 1000,
          env: node.env,
          onOutput: (_stream, value) => {
            outputTail += String(value || "");
            const lines = outputTail.split(/\r?\n/);
            outputTail = lines.pop() || "";
            for (const line of lines) {
              const match = line.match(/PAGE\s+(\d+)\/(\d+)/i);
              if (!match) continue;
              const current = Number(match[1]) || 1;
              const total = Number(match[2]) || 1;
              options.onProgress?.({
                stage: `识别页面 ${current}/${total}`,
                current,
                total,
                percent: 30 + (68 * Math.max(0, current - 1) / Math.max(1, total))
              });
            }
          }
        });
      } finally {
        // Rendered RGBA pages are only an intermediate representation and can
        // be much larger than the source. Keep the reusable result, not these.
        await fs.promises.rm(inputRoot, { recursive: true, force: true });
      }
      options.onProgress?.({ stage: "整理解析结果", percent: 99 });
    }
    const payload = JSON.parse(await fs.promises.readFile(documentPath, "utf8"));
    if (!Array.isArray(payload.pages)) throw new Error("本地解析没有生成有效结果");
    const pages = payload.pages.map((page, index) => ({
      page: Number(page.page || page.pageNumber) || index + 1,
      text: String(page.markdown || page.text || "").trim(),
      blocks: Array.isArray(page.blocks) ? page.blocks : []
    }));
    let createdAt = new Date().toISOString();
    try {
      const previous = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
      if (previous.createdAt) createdAt = previous.createdAt;
    } catch (_) {}
    await fs.promises.writeFile(metadataPath, JSON.stringify({
      version: 1,
      cacheKey,
      sourceName: options.name || file?.name || "document.pdf",
      sourcePath: file?.path || options.path || "",
      pipeline: status.contract.pipeline,
      createdAt,
      lastAccessedAt: new Date().toISOString(),
      totalPages: Number(payload.totalPages) || pages.length,
      processedPages: pages.length,
      characterCount: pages.reduce((sum, page) => sum + page.text.length, 0)
    }, null, 2));
    return {
      version: 1,
      engine: status.contract.pipeline,
      textEngine: "mineru-layout-ocr-table-formula-markdown",
      name: options.name || file?.name || "document.pdf",
      path: file?.path || options.path || "",
      totalPages: Number(payload.totalPages) || pages.length,
      processedPages: pages.length,
      truncated: false,
      characterCount: pages.reduce((sum, page) => sum + page.text.length, 0),
      pages,
      assetsPath: payload.assetsPath || outputPath,
      cacheKey,
      cacheHit
    };
  }

  buildInitialLocalPdfContext(session) {
    if (!session?.pages?.length) return {
      text: "[本地解析没有提取到文字；可能是扫描件或模型包尚未完成文字识别。]",
      selectedPages: [],
      characterCount: 0,
      truncated: false
    };
    const maxCharacters = Math.max(12000, Number(this.settings.aiLocalContextCharacters) || 90000);
    let used = 0;
    const blocks = [];
    const selectedPages = [];
    let cutByCharacterLimit = false;
    for (const page of session.pages) {
      const remaining = maxCharacters - used;
      if (remaining <= 0) break;
      const source = String(page.text || "").trim();
      if (!source) continue;
      const text = source.slice(0, remaining);
      blocks.push(`[PDF 第 ${page.page} 页]\n${text}`);
      used += text.length;
      selectedPages.push(Number(page.page) || selectedPages.length + 1);
      if (text.length < source.length) {
        cutByCharacterLimit = true;
        break;
      }
    }
    const truncated = selectedPages.length < session.pages.filter((page) => String(page.text || "").trim()).length
      || cutByCharacterLimit;
    const header = [
      `PDF：${session.name}`,
      `本地解析覆盖：${session.processedPages}/${session.totalPages} 页，${session.characterCount} 字符`,
      `本次一次性注入：${selectedPages.length} 页，${used} 字符。后续消息不会再次注入或检索。`,
      "回答时请引用页码；如当前会话中的证据不足，请明确说明。"
    ];
    if (session.truncated || truncated) header.push("警告：受本地页数或上下文长度限制，部分尾部内容未注入当前模型会话。");
    return {
      text: `${header.join("\n")}\n\n${blocks.join("\n\n")}`,
      selectedPages,
      characterCount: used,
      truncated: Boolean(session.truncated || truncated)
    };
  }

  composeLocalPdfContext(session) {
    return this.buildInitialLocalPdfContext(session).text;
  }

  async createPdfAIAttachment(buffer, options = {}) {
    const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const byteLength = bytes.byteLength;
    const maxBytes = Math.max(1, Number(this.settings.aiDirectPdfMaxMb) || 32) * 1024 * 1024;
    if (this.getPdfAiMode() === "direct" && byteLength > maxBytes) {
      throw new Error(`PDF 为 ${formatAIFileSize(byteLength)}，超过原文件模式 ${this.settings.aiDirectPdfMaxMb || 32} MB 的安全上限`);
    }
    const base = {
      type: "pdf",
      label: options.name || "document.pdf",
      path: options.path || "",
      byteLength,
      key: options.key || `pdf:${options.path || options.name || byteLength}`
    };
    if (this.getPdfAiMode() === "direct") {
      return { ...base, detail: `原始 PDF · ${formatAIFileSize(byteLength)}`, pdfData: arrayBufferToBase64(bytes), pdfMode: "direct" };
    }
    let session = null;
    let localError = "";
    try { session = await this.tryNativeLocalPdfPipeline(bytes, options); }
    catch (error) {
      localError = String(error?.message || error);
      console.warn("Paper Library: local document pipeline failed; sending source document", error);
    }
    if (!session) {
      const reason = localError || "本地解析模型未安装或不完整";
      return {
        ...base,
        detail: `原文件 · 本地解析不可用`,
        pdfData: options.keepBytes ? arrayBufferToBase64(bytes) : "",
        pdfMode: "direct",
        localFallbackReason: reason
      };
    }
    return {
      ...base,
      detail: `本地全文 · ${session.processedPages} 页 · ${session.characterCount} 字符`,
      pdfSession: session,
      pdfData: options.keepBytes ? arrayBufferToBase64(bytes) : "",
      pdfMode: "local"
    };
  }

  async buildAIAttachmentsFromFile(file) {
    if (!file) return [];
    const name = file.name || "附件";
    const mime = file.type || aiMimeForName(name);
    const buffer = await file.arrayBuffer();
    if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
      let nativePath = String(file.path || "");
      if (!nativePath) {
        try { nativePath = String(require("electron")?.webUtils?.getPathForFile?.(file) || ""); }
        catch (_) { /* 非 Electron 环境会在发送时写入插件私有缓存。 */ }
      }
      const attachment = await this.createPdfAIAttachment(buffer, {
        name,
        keepBytes: true,
        key: `external-pdf:${name}:${file.size || buffer.byteLength}:${file.lastModified || ""}`
      });
      attachment.nativePath = nativePath;
      return [attachment];
    }
    if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) {
      return [{
        type: "image", label: name, detail: `${Math.max(1, Math.round(buffer.byteLength / 1024))} KB`,
        dataUrl: arrayBufferToDataUrl(buffer, mime.startsWith("image/") ? mime : aiMimeForName(name)),
        mime: mime.startsWith("image/") ? mime : aiMimeForName(name),
        key: `external-image:${name}:${file.size || buffer.byteLength}:${file.lastModified || ""}`
      }];
    }
    if (mime.startsWith("text/") || /\.(md|txt|json|canvas)$/i.test(name)) {
      const text = new TextDecoder().decode(buffer).slice(0, 120000);
      return [{ type: "selection", label: name, detail: `${text.length} 字符`, text, key: `external-text:${name}` }];
    }
    return [];
  }

  async vaultFileToAIAttachment(file) {
    if (!file?.path) return [];
    const extension = String(file.extension || file.path.split(".").pop() || "").toLocaleLowerCase();
    if (extension === "pdf") {
      const buffer = await this.app.vault.readBinary(file);
      return [await this.createPdfAIAttachment(buffer, {
        name: file.name,
        path: file.path,
        key: `vault:${file.path}`,
        cacheKey: `vault:${file.path}:${file.stat?.mtime || 0}:${file.stat?.size || buffer.byteLength}`
      })];
    }
    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(extension)) {
      const buffer = await this.app.vault.readBinary(file);
      const mime = aiMimeForName(file.name);
      return [{
        type: "image", label: file.name, detail: `${Math.max(1, Math.round(buffer.byteLength / 1024))} KB`,
        dataUrl: arrayBufferToDataUrl(buffer, mime), mime, path: file.path, key: `vault:${file.path}`
      }];
    }
    if (["md", "txt", "json", "canvas"].includes(extension)) {
      let text = await this.app.vault.cachedRead(file);
      if (extension === "canvas") {
        try {
          const canvas = JSON.parse(text);
          text = (canvas.nodes || []).map((node, index) => {
            const content = node.text || node.file || node.url || node.label || "";
            return `节点 ${index + 1}${node.type ? `（${node.type}）` : ""}：${content}`;
          }).join("\n\n") || text;
        } catch (_) { /* 不是标准 Canvas JSON 时保留原文 */ }
      }
      text = text.slice(0, 120000);
      return [{ type: "selection", label: file.name, detail: `${text.length} 字符`, text, path: file.path, key: `vault:${file.path}` }];
    }
    return [];
  }

  aiPathFromDroppedText(value) {
    let text = String(value || "").trim().split(/\r?\n/)[0] || "";
    const wiki = text.match(/^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/);
    if (wiki) text = wiki[1];
    if (/^obsidian:\/\//i.test(text)) {
      try { text = decodeURIComponent(new URL(text).searchParams.get("file") || ""); } catch (_) {}
    }
    return text.replace(/^\/+/, "");
  }

  async addComposerDrop(snapshot = {}, options = {}) {
    // A drag belongs to the input surface under the pointer. It must never
    // route by document identity or create/switch conversations implicitly.
    const tab = options.tab?.dom?.inputEl
      ? options.tab
      : await this.waitForClaudianTab();
    this.ensureClaudianPdfBridge(tab);
    const visibleAttachments = [];
    const queuedPdfAttachments = [];
    let recognized = 0;
    const queueVaultPdf = (file, descriptor = {}) => {
      recognized += 1;
      const attachment = this.queueComposerPdfAttachment(tab, {
        name: descriptor.name || file.name,
        path: file.path,
        byteLength: file.stat?.size || 0,
        key: descriptor.key || `vault:${file.path}`,
        metadataText: descriptor.metadataText || "",
        keepBytes: false,
        linkedPage: Number(descriptor.linkedPage) || null
      }, () => this.app.vault.readBinary(file));
      if (attachment) queuedPdfAttachments.push(attachment);
      return attachment;
    };

    if (snapshot.pdfSelectionRaw) {
      try {
        const selection = JSON.parse(snapshot.pdfSelectionRaw);
        const text = String(selection?.text || "").trim().slice(0, 8000);
        const path = normalizePath(selection?.path || "");
        if (text) {
          visibleAttachments.push({
            type: "selection",
            label: selection.label || "文档文字选区",
            detail: `${text.length} 字符`,
            text,
            path,
            page: Number(selection.page) || null,
            key: `pdf-selection:${path}:${selection.page || ""}:${text.slice(0, 120)}`
          });
          recognized += 1;
          const source = path && this.app.vault.getAbstractFileByPath(path);
          if (source?.path) queueVaultPdf(source, { linkedPage: Number(selection.page) || null });
        }
      } catch (_) { /* Ignore malformed external drag metadata. */ }
    }

    if (snapshot.pdfFigureRaw) {
      const attachment = await this.pdfFigureDragToAIAttachment(snapshot.pdfFigureRaw);
      visibleAttachments.push(attachment);
      recognized += 1;
    }

    let paperIds = [];
    try { paperIds = JSON.parse(snapshot.paperIdsRaw || "[]"); } catch (_) {}
    for (const id of paperIds) {
      const paper = this.settings.papers.find((item) => item.id === id);
      if (!paper) continue;
      const metadataText = [
        `标题：${paper.title}`,
        paper.authors?.length ? `作者：${paper.authors.join(", ")}` : "",
        paper.year ? `年份：${paper.year}` : "",
        paper.venue ? `期刊/会议：${paper.venue}` : "",
        paper.doi ? `DOI：${paper.doi}` : "",
        paper.abstract ? `摘要：\n${paper.abstract}` : ""
      ].filter(Boolean).join("\n");
      const file = paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath)
        ? this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath))
        : null;
      if (file?.path) {
        queueVaultPdf(file, {
          name: paper.title || file.name,
          key: `paper:${paper.id}`,
          metadataText
        });
      } else {
        visibleAttachments.push(await this.paperToAIAttachment(paper));
        recognized += 1;
      }
    }

    if (snapshot.nodeId) {
      const found = this.findResearchNodeForAI(snapshot.nodeId);
      if (found) {
        visibleAttachments.push(this.researchNodeToAIAttachment(found.paper, found.node));
        recognized += 1;
      }
    }

    for (const file of snapshot.files || []) {
      const name = file.name || "附件";
      const mime = file.type || aiMimeForName(name);
      if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
        let nativePath = String(file.path || "");
        if (!nativePath) {
          try { nativePath = String(require("electron")?.webUtils?.getPathForFile?.(file) || ""); }
          catch (_) { /* Source bytes are retained when a native path is unavailable. */ }
        }
        recognized += 1;
        const attachment = this.queueComposerPdfAttachment(tab, {
          name,
          nativePath,
          byteLength: file.size || 0,
          key: `external-pdf:${name}:${file.size || 0}:${file.lastModified || ""}`,
          keepBytes: true
        }, () => file.arrayBuffer());
        if (attachment) queuedPdfAttachments.push(attachment);
      } else {
        const built = await this.buildAIAttachmentsFromFile(file);
        visibleAttachments.push(...built);
        recognized += built.length;
      }
    }

    if (snapshot.droppedText && !snapshot.pdfSelectionRaw && !snapshot.pdfFigureRaw
      && !snapshot.paperIdsRaw && !snapshot.nodeId && !(snapshot.files?.length)) {
      const path = this.aiPathFromDroppedText(snapshot.droppedText);
      const vaultFile = this.app.vault.getAbstractFileByPath(normalizePath(path));
      const extension = String(vaultFile?.extension || vaultFile?.path?.split(".").pop() || "").toLocaleLowerCase();
      if (vaultFile?.path && extension === "pdf") {
        queueVaultPdf(vaultFile);
      } else if (vaultFile?.path) {
        const built = await this.vaultFileToAIAttachment(vaultFile);
        visibleAttachments.push(...built);
        recognized += built.length;
      } else if (snapshot.droppedText.trim().length > 2) {
        const text = snapshot.droppedText.trim().slice(0, 120000);
        visibleAttachments.push({
          type: "selection", label: "拖入的文字", detail: `${text.length} 字符`,
          text, key: `text:${text.slice(0, 120)}`
        });
        recognized += 1;
      }
    }

    const composerAttachments = [...visibleAttachments, ...queuedPdfAttachments];
    if (composerAttachments.length) {
      await this.addClaudianContexts(composerAttachments, {
        tab,
        sourcePath: snapshot.sourcePath || ""
      });
    }
    tab.dom?.inputEl?.focus?.();
    return recognized;
  }

  async buildAIAttachmentsFromDrop(dataTransfer) {
    if (!dataTransfer) return [];
    const attachments = [];
    const paperIdsRaw = dataTransfer.getData("application/x-paperlib-papers");
    if (paperIdsRaw) {
      let ids = [];
      try { ids = JSON.parse(paperIdsRaw); } catch (_) {}
      for (const id of ids) {
        const paper = this.settings.papers.find((item) => item.id === id);
        if (paper) attachments.push(await this.paperToAIAttachment(paper));
      }
    }
    const nodeId = dataTransfer.getData("application/x-paperlib-node");
    if (nodeId) {
      const found = this.findResearchNodeForAI(nodeId);
      if (found) attachments.push(this.researchNodeToAIAttachment(found.paper, found.node));
    }
    const pdfFigureRaw = dataTransfer.getData("application/x-paperlib-pdf-figure");
    if (pdfFigureRaw) attachments.push(await this.pdfFigureDragToAIAttachment(pdfFigureRaw));
    for (const file of Array.from(dataTransfer.files || [])) {
      attachments.push(...await this.buildAIAttachmentsFromFile(file));
    }
    const droppedText = dataTransfer.getData("text/plain") || dataTransfer.getData("text/uri-list");
    if (droppedText && !paperIdsRaw && !nodeId && !pdfFigureRaw && !(dataTransfer.files?.length)) {
      const path = this.aiPathFromDroppedText(droppedText);
      const vaultFile = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (vaultFile?.path) attachments.push(...await this.vaultFileToAIAttachment(vaultFile));
      else if (droppedText.trim().length > 2) attachments.push({
        type: "selection", label: "拖入的文字", detail: `${droppedText.trim().length} 字符`,
        text: droppedText.trim().slice(0, 120000), key: `text:${droppedText.trim().slice(0, 120)}`
      });
    }
    return attachments;
  }

  async preparePdfAttachmentForMode(attachment) {
    if (attachment?.type !== "pdf") return attachment;
    const mode = this.getPdfAiMode();
    if (mode === "local" && attachment.processingPromise) await attachment.processingPromise;
    if (mode === "direct" && !attachment.pdfData && !attachment.path && !attachment.nativePath && attachment.sourceReadyPromise) {
      await attachment.sourceReadyPromise;
    }
    // A failed background local preparation must never prevent source-file mode.
    if (mode === "local" && attachment.processingError) throw new Error(attachment.processingError);
    if (mode === "direct" && (attachment.nativePath || attachment.path)) return { ...attachment, pdfMode: "direct" };
    if (mode === "direct" && attachment.pdfData) return { ...attachment, pdfMode: "direct" };
    if (mode === "local" && attachment.pdfSession) return { ...attachment, pdfMode: "local" };
    let buffer = null;
    if (attachment.pdfData) buffer = base64ToArrayBuffer(attachment.pdfData);
    else if (attachment.path) {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(attachment.path));
      if (file) buffer = await this.app.vault.readBinary(file);
    }
    if (!buffer) throw new Error(`无法重新读取 PDF：${attachment.label || attachment.path || "未知文件"}`);
    const rebuilt = await this.createPdfAIAttachment(buffer, {
      name: attachment.label,
      path: attachment.path,
      key: attachment.key,
      keepBytes: Boolean(attachment.pdfData)
    });
    return { ...attachment, ...rebuilt, linkedPage: attachment.linkedPage || null };
  }


  async loadSettings() {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    const removedLegacyPaperAI = ["aiEndpoint", "aiApiKey", "aiModel", "aiProvider", "aiSystemPrompt"]
      .some((key) => Object.prototype.hasOwnProperty.call(this.settings, key));
    ["aiEndpoint", "aiApiKey", "aiModel", "aiProvider", "aiSystemPrompt"]
      .forEach((key) => delete this.settings[key]);
    this.settings.libraryAppearance = normalizeLibraryAppearance(
      stored?.libraryAppearance,
      stored?.libraryViewStyle
    );
    this.settings.libraryViewStyle = this.settings.libraryAppearance === "gallery" ? "severance" : "default";
    // 移动端外观与桌面端相互独立；首次升级时继承桌面端当前选择，之后各改各的。
    this.settings.libraryAppearanceMobile = stored?.libraryAppearanceMobile
      ? normalizeLibraryAppearance(stored.libraryAppearanceMobile)
      : this.settings.libraryAppearance;
    this.settings.globalAccentColor = normalizeAppearanceColor(stored?.globalAccentColor);
    this.settings.globalAccentColorMobile = stored?.globalAccentColorMobile
      ? normalizeAppearanceColor(stored.globalAccentColorMobile)
      : this.settings.globalAccentColor;
    this.settings.customAppearanceName = String(stored?.customAppearanceName || "我的外观").trim() || "我的外观";
    this.settings.customAppearanceBase = normalizeAppearanceBase(stored?.customAppearanceBase);
    this.settings.customAppearanceCss = String(stored?.customAppearanceCss || "");
    this.settings.customAppearances = normalizeCustomAppearanceProfiles(stored?.customAppearances, {
      name: this.settings.customAppearanceName,
      base: this.settings.customAppearanceBase,
      css: this.settings.customAppearanceCss
    });
    const storedCustomId = stored?.activeCustomAppearanceId
      ? normalizeCustomAppearanceId(stored.activeCustomAppearanceId)
      : (this.settings.customAppearances.find((profile) => profile.id === "legacy")?.id || "blueprint");
    this.settings.activeCustomAppearanceId = this.settings.customAppearances.some((profile) => profile.id === storedCustomId)
      ? storedCustomId
      : "blueprint";
    const editorProfileId = normalizeCustomAppearanceId(stored?.appearanceEditorProfileId, this.settings.activeCustomAppearanceId);
    this.settings.appearanceEditorProfileId = this.settings.customAppearances.some((profile) => profile.id === editorProfileId)
      ? editorProfileId
      : this.settings.activeCustomAppearanceId;
    this.settings.appearanceProtocolVersion = APPEARANCE_PROTOCOL_VERSION;
    this.settings.libraryFolder = stored?.libraryFolder || stored?.notesFolder || DEFAULT_SETTINGS.libraryFolder;
    this.settings.googleScholarProvider = stored?.googleScholarProvider === "serpapi" ? "serpapi" : "html";
    this.settings.extensionServerEnabled = Boolean(stored?.extensionServerEnabled);
    this.settings.extensionServerPort = Math.min(65535, Math.max(1024,
      Math.floor(Number(stored?.extensionServerPort)) || DEFAULT_SETTINGS.extensionServerPort));
    this.settings.extensionToken = String(stored?.extensionToken || "").trim();
    this.settings.pdfAiMode = stored?.pdfAiMode === "local" ? "local" : "direct";
    this.settings.aiDirectPdfMaxMb = Math.min(100, Math.max(1, Number(stored?.aiDirectPdfMaxMb) || DEFAULT_SETTINGS.aiDirectPdfMaxMb));
    this.settings.aiLocalPdfMaxPages = Math.min(2000, Math.max(10, Number(stored?.aiLocalPdfMaxPages) || DEFAULT_SETTINGS.aiLocalPdfMaxPages));
    this.settings.aiLocalContextCharacters = Math.min(300000, Math.max(12000,
      Number(stored?.aiLocalContextCharacters) || DEFAULT_SETTINGS.aiLocalContextCharacters));
    this.settings.paperComposerPdfMessageCards = stored?.paperComposerPdfMessageCards
      && typeof stored.paperComposerPdfMessageCards === "object"
      && !Array.isArray(stored.paperComposerPdfMessageCards)
      ? stored.paperComposerPdfMessageCards
      : {};
    this.settings.paperComposerDirectContextBindings = stored?.paperComposerDirectContextBindings
      && typeof stored.paperComposerDirectContextBindings === "object"
      && !Array.isArray(stored.paperComposerDirectContextBindings)
      ? stored.paperComposerDirectContextBindings
      : {};
    this.settings.serpApiKey = String(stored?.serpApiKey || "").trim();
    this.settings.serpApiBackgroundLookup = Boolean(stored?.serpApiBackgroundLookup);
    this.settings.metadataSource = ["semantic-scholar", "serpapi"].includes(stored?.metadataSource)
      ? stored.metadataSource
      : "auto";
    this.settings.papers = Array.isArray(stored?.papers) ? stored.papers : [];
    let removedStaleImportState = false;
    let repairedPdfMarkPaths = 0;
    this.settings.papers.forEach((paper) => {
      // Import progress belongs to the process that created it. If Obsidian
      // quits, reloads the plugin or receives an old synchronized data file,
      // there is no live worker behind queued/layout/online/organizing. Never
      // revive its infinite loading animation on startup.
      if (paper.importStatus && paper.importStatus !== "error") {
        delete paper.importStatus;
        delete paper.importError;
        removedStaleImportState = true;
      }
      paper.attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
      paper.figureCatalogs = paper.figureCatalogs && typeof paper.figureCatalogs === "object"
        && !Array.isArray(paper.figureCatalogs) ? paper.figureCatalogs : {};
      paper.venueRanks = this.normalizeVenueRanks(paper.venueRanks);
      paper.favoriteColor = normalizeFavoriteColor(paper.favoriteColor);
      paper.tags = normalizePaperTags(paper.tags);
      paper.collections = [...new Set((Array.isArray(paper.collections) ? paper.collections : [])
        .map(normalizeCollectionPath).filter(Boolean))];
      repairedPdfMarkPaths += this.repairOrphanedPaperPdfMarkPaths(paper);
    });
    this.settings.paperDeletionTombstones = stored?.paperDeletionTombstones
      && typeof stored.paperDeletionTombstones === "object"
      && !Array.isArray(stored.paperDeletionTombstones)
      ? { ...stored.paperDeletionTombstones }
      : {};
    if ((stored?.arxivValidationMigrationVersion || 0) < 1) {
      this.settings.papers.forEach((paper) => {
        if (!paper.arxiv) return;
        paper.arxiv = normalizeArxivId(paper.arxiv);
      });
      this.settings.arxivValidationMigrationVersion = 1;
      await this.saveData(this.settings);
    }
    const paperTags = this.settings.papers.flatMap((paper) => Array.isArray(paper.tags) ? paper.tags : []);
    this.settings.tags = normalizePaperTags([...(Array.isArray(stored?.tags) ? stored.tags : []), ...paperTags])
      .sort((left, right) => left.localeCompare(right));
    if ((stored?.obsidianTagNormalizationVersion || 0) < 1) {
      for (const paper of this.settings.papers) {
        try { await this.syncPaperNoteTags(paper); }
        catch (error) { console.warn(`Paper Library: failed to normalize note tags for ${paper.title}`, error); }
      }
      this.settings.obsidianTagNormalizationVersion = 1;
      await this.saveData(this.settings);
    }
    this.settings.collections = expandCollectionPaths([
      ...(Array.isArray(stored?.collections) ? stored.collections : DEFAULT_SETTINGS.collections),
      ...this.settings.papers.flatMap((paper) => paper.collections || [])
    ]);
    this.settings.tableColumnWidths = this.normalizePaperTableColumnWidths(stored?.tableColumnWidths);
    this.settings.tableColumnOrder = this.normalizePaperTableColumnOrder(stored?.tableColumnOrder);
    this.settings.jcrRankCache = stored?.jcrRankCacheVersion === DEFAULT_SETTINGS.jcrRankCacheVersion
      && stored?.jcrRankCache && typeof stored.jcrRankCache === "object" ? stored.jcrRankCache : {};
    this.settings.jcrRankCacheVersion = DEFAULT_SETTINGS.jcrRankCacheVersion;
    this.settings.conferenceRateCache = stored?.conferenceRateCacheVersion === DEFAULT_SETTINGS.conferenceRateCacheVersion
      && stored?.conferenceRateCache && typeof stored.conferenceRateCache === "object"
      ? stored.conferenceRateCache : {};
    this.settings.conferenceRateCacheVersion = DEFAULT_SETTINGS.conferenceRateCacheVersion;
    this.settings.conferenceRateDatabase = stored?.conferenceRateDatabaseVersion === DEFAULT_SETTINGS.conferenceRateDatabaseVersion
      && stored?.conferenceRateDatabase && typeof stored.conferenceRateDatabase === "object"
      ? stored.conferenceRateDatabase
      : { updatedAt: "", source: "", series: {} };
    this.settings.conferenceRateDatabase.series = this.settings.conferenceRateDatabase.series
      && typeof this.settings.conferenceRateDatabase.series === "object"
      ? this.settings.conferenceRateDatabase.series : {};
    this.settings.conferenceRateDatabaseVersion = DEFAULT_SETTINGS.conferenceRateDatabaseVersion;
    this.settings.conferenceRankingDatabase = stored?.conferenceRankingDatabaseVersion
      === DEFAULT_SETTINGS.conferenceRankingDatabaseVersion
      && stored?.conferenceRankingDatabase && typeof stored.conferenceRankingDatabase === "object"
      ? stored.conferenceRankingDatabase
      : { updatedAt: "", source: "", conferences: [] };
    this.settings.conferenceRankingDatabase.conferences = Array.isArray(
      this.settings.conferenceRankingDatabase.conferences
    ) ? this.settings.conferenceRankingDatabase.conferences : [];
    this.settings.conferenceRankingDatabaseVersion = DEFAULT_SETTINGS.conferenceRankingDatabaseVersion;
    this.settings.followedConferences = [...new Set((Array.isArray(stored?.followedConferences)
      ? stored.followedConferences : []).map((value) => String(value || "").trim()).filter(Boolean))];
    delete this.settings.dailyFlashcardReview;
    this.settings.semanticScholarPaperCache = stored?.semanticScholarPaperCacheVersion
      === DEFAULT_SETTINGS.semanticScholarPaperCacheVersion
      && stored?.semanticScholarPaperCache && typeof stored.semanticScholarPaperCache === "object"
      ? stored.semanticScholarPaperCache
      : { papers: {}, aliases: {} };
    this.settings.semanticScholarPaperCache.papers = this.settings.semanticScholarPaperCache.papers
      && typeof this.settings.semanticScholarPaperCache.papers === "object"
      ? this.settings.semanticScholarPaperCache.papers : {};
    this.settings.semanticScholarPaperCache.aliases = this.settings.semanticScholarPaperCache.aliases
      && typeof this.settings.semanticScholarPaperCache.aliases === "object"
      ? this.settings.semanticScholarPaperCache.aliases : {};
    this.settings.semanticScholarPaperCacheVersion = DEFAULT_SETTINGS.semanticScholarPaperCacheVersion;
    if ((stored?.rankingColumnExpansionVersion || 0) < 1) {
      if (Number(this.settings.tableColumnWidths.rankings) <= 220) this.settings.tableColumnWidths.rankings = 300;
      this.settings.rankingColumnExpansionVersion = 1;
      await this.saveData(this.settings);
    }
    if ((stored?.demoPdfMigrationVersion || 0) < 1) {
      const templates = new Map(SAMPLE_PAPERS.map((paper) => [paper.id, paper]));
      const outdatedTitles = new Set([
        "Event-triggered MINFLUX microscopy: smart microscopy enables gentle nanometer-scale imaging",
        "Photonic neuromorphic accelerators for event-based vision",
        "Nanometer resolution imaging and tracking of fluorescent molecules"
      ]);
      this.settings.papers.forEach((paper) => {
        const template = templates.get(paper.id);
        if (!template) return;
        if (!paper.pdfPath) paper.pdfPath = template.pdfPath;
        if (outdatedTitles.has(paper.title)) {
          Object.assign(paper, {
            title: template.title,
            authors: [...template.authors],
            year: template.year,
            venue: template.venue,
            abstract: template.abstract,
            tags: [...template.tags],
            collections: [...template.collections],
            doi: template.doi,
            arxiv: template.arxiv
          });
        }
        if (paper.id === "paper-1" && paper.doi === "10.1038/s41377-024-01490-8") paper.doi = template.doi;
        if (paper.id === "paper-3" && !paper.doi) paper.doi = template.doi;
        if (paper.id === "paper-6" && paper.doi === "10.1117/1.AP.6.1.016001") {
          paper.authors = [...template.authors];
          paper.venue = template.venue;
          paper.doi = template.doi;
          paper.arxiv = template.arxiv;
        }
      });
      this.settings.demoPdfMigrationVersion = 1;
      await this.saveData(this.settings);
    }
    if ((stored?.demoContentRemovalVersion || 0) < 1) {
      this.settings.papers = this.settings.papers.filter((paper) => !DEMO_PAPER_IDS.has(paper.id));
      const activeTags = new Set(this.settings.papers.flatMap((paper) => paper.tags || []));
      const activeCollections = new Set(this.settings.papers.flatMap((paper) => paper.collections || []));
      this.settings.tags = (this.settings.tags || []).filter((tag) => !DEMO_TAGS.has(tag) || activeTags.has(tag));
      this.settings.collections = (this.settings.collections || []).filter((collection) => (
        !DEMO_COLLECTIONS.has(collection) || activeCollections.has(collection)
      ));
      delete this.settings.showSamplePapers;
      this.settings.demoContentRemovalVersion = 1;
      await this.saveData(this.settings);
    }
    if ((stored?.arxivMetadataPriorityMigrationVersion || 0) < 1) {
      this.settings.papers.forEach((paper) => {
        if (paper.arxiv && (!paper.doi || !paper.venue || /^arxiv\b/i.test(paper.venue))) delete paper.metrics;
      });
      this.settings.arxivMetadataPriorityMigrationVersion = 1;
      await this.saveData(this.settings);
    }
    if ((stored?.publishedVenueRepairVersion || 0) < 1) {
      this.settings.papers.forEach((paper) => {
        const isAttentionPaper = normalizeTitleForMatch(paper.title) === "attention is all you need";
        const hasMismergedDoi = normalizeDoiInput(paper.doi) === "10.65215/2q58a426";
        const hasRegistrantAsVenue = /^shenzhen medical academy of research and translation$/i.test(
          String(paper.venue || "").trim()
        );
        if (!isAttentionPaper || (!hasMismergedDoi && !hasRegistrantAsVenue)) return;
        paper.doi = "";
        paper.arxiv = paper.arxiv || "1706.03762";
        paper.venue = "NIPS";
        paper.year = 2017;
        delete paper.metrics;
      });
      this.settings.publishedVenueRepairVersion = 1;
      await this.saveData(this.settings);
    }
    if ((stored?.metricsPublicationTypeRepairVersion || 0) < 2) {
      this.settings.papers.forEach((paper) => {
        if (paper.metrics && isPreprintLikeType(paper.metrics.type) && hasFormalPublicationVenue(paper)) {
          delete paper.metrics;
          return;
        }
        if (paper.metrics?.status === "ready") {
          paper.metrics.type = displayPublicationType(paper, paper.metrics.type);
        }
      });
      this.settings.metricsPublicationTypeRepairVersion = 2;
      await this.saveData(this.settings);
    }
    if ((stored?.fileOrganizationMigrationVersion || 0) < 1) {
      let moved = 0;
      if (this.app?.vault) {
        for (const paper of this.settings.papers) {
          const before = `${paper.pdfPath || ""}\n${paper.notePath || ""}`;
          try {
            await this.organizePaperFiles(paper);
            if (`${paper.pdfPath || ""}\n${paper.notePath || ""}` !== before) moved += 1;
          } catch (error) {
            console.warn(`Paper Library: failed to organize files for ${paper.title}`, error);
          }
        }
      }
      this.settings.fileOrganizationMigrationVersion = 1;
      await this.saveData(this.settings);
      if (moved) new Notice(`已整理 ${moved} 篇论文的 PDF 与笔记`);
    }
    if ((stored?.attachmentSupportMigrationVersion || 0) < 1) {
      this.settings.papers.forEach((paper) => {
        paper.attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
      });
      this.settings.attachmentSupportMigrationVersion = 1;
      await this.saveData(this.settings);
    }
    if ((stored?.collectionHierarchyMigrationVersion || 0) < 1) {
      this.settings.collections = expandCollectionPaths([
        ...(this.settings.collections || []),
        ...this.settings.papers.flatMap((paper) => paper.collections || [])
      ]);
      this.settings.collectionHierarchyMigrationVersion = 1;
      await this.saveData(this.settings);
    }
    if (removedStaleImportState || removedLegacyPaperAI || repairedPdfMarkPaths) {
      await this.saveData(this.settingsForPersistence(this.settings));
    }
    await this.initializeDeviceAppearancePreferences();
    await this.captureSettingsPersistenceBaseline();
  }

  cloneSettingsValue(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  settingsForPersistence(settings = this.settings) {
    const persisted = this.cloneSettingsValue(settings || {}) || {};
    (persisted.papers || []).forEach((paper) => {
      // Keep failed imports diagnosable, but never persist a live loading
      // state. Those workers cannot survive an app/plugin restart.
      if (paper.importStatus !== "error") {
        delete paper.importStatus;
        delete paper.importError;
      }
    });
    return persisted;
  }

  settingsValuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  settingsFingerprint(value) {
    try { return JSON.stringify(value || {}); }
    catch (_) { return ""; }
  }

  async readPersistedPluginData() {
    const adapter = this.app?.vault?.adapter;
    if (adapter?.read) {
      try {
        const path = this.getPluginVaultPath("data.json");
        if (!adapter.exists || await adapter.exists(path)) {
          return JSON.parse(await adapter.read(path));
        }
      } catch (error) {
        console.warn("Paper Library: direct synchronized data read unavailable", error);
      }
    }
    return this.loadData();
  }

  async readPersistedPluginDataSignature() {
    const adapter = this.app?.vault?.adapter;
    if (!adapter?.stat) return "";
    try {
      const stat = await adapter.stat(this.getPluginVaultPath("data.json"));
      return stat ? `${Number(stat.mtime) || 0}:${Number(stat.size) || 0}` : "";
    } catch (_) {
      return "";
    }
  }

  mergeSyncedPaperRecord(local, disk, baseline, tombstones = {}, id = "") {
    if (id && tombstones[id]) return null;
    if (!baseline) return this.cloneSettingsValue(local || disk);
    if (!local && !disk) return null;
    // Absence alone is ambiguous: an older device may simply not have received
    // a newly imported paper yet. Only an explicit synchronized tombstone is a
    // deletion; otherwise keep the copy that still exists.
    if (!local) return this.cloneSettingsValue(disk);
    if (!disk) return this.cloneSettingsValue(local);
    const merged = {};
    const keys = new Set([...Object.keys(baseline), ...Object.keys(local), ...Object.keys(disk)]);
    keys.forEach((key) => {
      const localChanged = !this.settingsValuesEqual(local[key], baseline[key]);
      const diskChanged = !this.settingsValuesEqual(disk[key], baseline[key]);
      if (diskChanged && !localChanged) merged[key] = this.cloneSettingsValue(disk[key]);
      else merged[key] = this.cloneSettingsValue(local[key]);
    });
    return merged;
  }

  mergeSyncedPaperLists(localPapers = [], diskPapers = [], baselinePapers = [], tombstones = {}) {
    const mapById = (papers) => new Map((Array.isArray(papers) ? papers : [])
      .filter((paper) => paper?.id)
      .map((paper) => [paper.id, paper]));
    const local = mapById(localPapers);
    const disk = mapById(diskPapers);
    const baseline = mapById(baselinePapers);
    const order = [...new Set([
      ...local.keys(),
      ...disk.keys(),
      ...baseline.keys()
    ])];
    return order.flatMap((id) => {
      const merged = this.mergeSyncedPaperRecord(local.get(id), disk.get(id), baseline.get(id), tombstones, id);
      return merged ? [merged] : [];
    });
  }

  mergeSyncedSettings(localSettings = {}, diskSettings = {}, baselineSettings = {}) {
    const merged = {};
    const tombstones = {
      ...(baselineSettings.paperDeletionTombstones || {}),
      ...(localSettings.paperDeletionTombstones || {}),
      ...(diskSettings.paperDeletionTombstones || {})
    };
    const keys = new Set([
      ...Object.keys(DEFAULT_SETTINGS),
      ...Object.keys(baselineSettings || {}),
      ...Object.keys(localSettings || {}),
      ...Object.keys(diskSettings || {})
    ]);
    keys.forEach((key) => {
      if (key === "papers") {
        merged.papers = this.mergeSyncedPaperLists(
          localSettings.papers,
          diskSettings.papers,
          baselineSettings.papers,
          tombstones
        );
        return;
      }
      if (key === "paperDeletionTombstones") {
        merged.paperDeletionTombstones = tombstones;
        return;
      }
      const localValue = localSettings[key];
      const diskValue = diskSettings[key];
      const baselineValue = baselineSettings[key];
      const localChanged = !this.settingsValuesEqual(localValue, baselineValue);
      const diskChanged = !this.settingsValuesEqual(diskValue, baselineValue);
      if (["tags", "collections"].includes(key) && localChanged && diskChanged) {
        merged[key] = [...new Set([...(Array.isArray(localValue) ? localValue : []), ...(Array.isArray(diskValue) ? diskValue : [])])];
      } else if (diskChanged && !localChanged) merged[key] = this.cloneSettingsValue(diskValue);
      else merged[key] = this.cloneSettingsValue(localValue !== undefined ? localValue : diskValue);
    });
    return Object.assign({}, DEFAULT_SETTINGS, merged);
  }

  markPapersDeleted(papers = []) {
    const tombstones = { ...(this.settings.paperDeletionTombstones || {}) };
    const deletedAt = new Date().toISOString();
    (Array.isArray(papers) ? papers : [papers]).forEach((paper) => {
      if (paper?.id) tombstones[paper.id] = deletedAt;
      this.activePaperImportIds?.delete(paper?.id);
    });
    this.settings.paperDeletionTombstones = Object.fromEntries(
      Object.entries(tombstones)
        .sort((left, right) => String(right[1]).localeCompare(String(left[1])))
        .slice(0, 500)
    );
  }

  normalizeReloadedSettings(settings = {}) {
    const rawCustomAppearances = settings?.customAppearances;
    const normalized = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    delete normalized.dailyFlashcardReview;
    ["aiEndpoint", "aiApiKey", "aiModel", "aiProvider", "aiSystemPrompt"]
      .forEach((key) => delete normalized[key]);
    normalized.libraryAppearance = normalizeLibraryAppearance(
      normalized.libraryAppearance,
      normalized.libraryViewStyle
    );
    normalized.libraryViewStyle = normalized.libraryAppearance === "gallery" ? "severance" : "default";
    normalized.libraryAppearanceMobile = normalizeLibraryAppearance(
      normalized.libraryAppearanceMobile || normalized.libraryAppearance
    );
    normalized.globalAccentColor = normalizeAppearanceColor(normalized.globalAccentColor);
    normalized.globalAccentColorMobile = normalizeAppearanceColor(
      normalized.globalAccentColorMobile || normalized.globalAccentColor
    );
    normalized.customAppearanceName = String(normalized.customAppearanceName || "我的外观").trim() || "我的外观";
    normalized.customAppearanceBase = normalizeAppearanceBase(normalized.customAppearanceBase);
    normalized.customAppearanceCss = String(normalized.customAppearanceCss || "");
    normalized.customAppearances = normalizeCustomAppearanceProfiles(rawCustomAppearances, {
      name: normalized.customAppearanceName,
      base: normalized.customAppearanceBase,
      css: normalized.customAppearanceCss
    });
    const activeCustomId = normalizeCustomAppearanceId(normalized.activeCustomAppearanceId);
    normalized.activeCustomAppearanceId = normalized.customAppearances.some((profile) => profile.id === activeCustomId)
      ? activeCustomId
      : "blueprint";
    const editorCustomId = normalizeCustomAppearanceId(normalized.appearanceEditorProfileId, normalized.activeCustomAppearanceId);
    normalized.appearanceEditorProfileId = normalized.customAppearances.some((profile) => profile.id === editorCustomId)
      ? editorCustomId
      : normalized.activeCustomAppearanceId;
    normalized.appearanceProtocolVersion = APPEARANCE_PROTOCOL_VERSION;
    normalized.papers = Array.isArray(normalized.papers) ? normalized.papers : [];
    normalized.paperDeletionTombstones = normalized.paperDeletionTombstones
      && typeof normalized.paperDeletionTombstones === "object"
      && !Array.isArray(normalized.paperDeletionTombstones)
      ? { ...normalized.paperDeletionTombstones }
      : {};
    normalized.papers.forEach((paper) => {
      paper.attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
      paper.figureCatalogs = paper.figureCatalogs && typeof paper.figureCatalogs === "object"
        && !Array.isArray(paper.figureCatalogs) ? paper.figureCatalogs : {};
      paper.venueRanks = this.normalizeVenueRanks(paper.venueRanks);
      paper.favoriteColor = normalizeFavoriteColor(paper.favoriteColor);
      paper.tags = normalizePaperTags(paper.tags);
      paper.collections = [...new Set((Array.isArray(paper.collections) ? paper.collections : [])
        .map(normalizeCollectionPath).filter(Boolean))];
    });
    normalized.tags = normalizePaperTags([
      ...(Array.isArray(normalized.tags) ? normalized.tags : []),
      ...normalized.papers.flatMap((paper) => paper.tags || [])
    ]).sort((left, right) => left.localeCompare(right));
    normalized.collections = expandCollectionPaths([
      ...(Array.isArray(normalized.collections) ? normalized.collections : []),
      ...normalized.papers.flatMap((paper) => paper.collections || [])
    ]);
    normalized.tableColumnWidths = this.normalizePaperTableColumnWidths(normalized.tableColumnWidths);
    normalized.tableColumnOrder = this.normalizePaperTableColumnOrder(normalized.tableColumnOrder);
    return normalized;
  }

  async captureSettingsPersistenceBaseline() {
    let disk = null;
    try { disk = await this.readPersistedPluginData(); } catch (_) {}
    this.settingsPersistenceBaseline = this.settingsForPersistence(this.settings || {});
    this.settingsPersistenceFingerprint = this.settingsFingerprint(disk || this.settings || {});
    this.settingsPersistenceSignature = await this.readPersistedPluginDataSignature();
  }

  applyReloadedSettings(settings, previousSettings = null) {
    const activePapers = new Map((this.settings?.papers || [])
      .filter((paper) => this.activePaperImportIds?.has(paper.id))
      .map((paper) => [paper.id, paper]));
    const normalized = this.normalizeReloadedSettings(settings);
    // Batch workers keep direct references to their placeholder paper. A sync
    // merge must update that object in place; replacing it would make the
    // worker finish into a detached object and leave the visible row forever
    // stuck at `organizing` (or remove it on the next save).
    normalized.papers = normalized.papers.map((paper) => {
      const active = activePapers.get(paper.id);
      if (!active) return paper;
      Object.keys(active).forEach((key) => { if (!(key in paper)) delete active[key]; });
      Object.assign(active, paper);
      return active;
    });
    this.settings = normalized;
    this.installCustomAppearanceStyle?.();
    this.conferenceRankingLookup = null;
    this.restorePaperRelationCache?.();
    if (this.uiState && !this.settings.papers.some((paper) => paper.id === this.uiState.selectedId)) {
      this.uiState.selectedId = this.settings.papers[0]?.id || null;
    }
    this.refreshViews?.();
    if (!this.isMobileApp() && previousSettings) {
      const before = new Map((previousSettings.papers || []).map((paper) => [paper.id, paper]));
      const needsOrganization = this.settings.papers.some((paper) => {
        const old = before.get(paper.id);
        return !old
          || old.title !== paper.title
          || Number(old.year) !== Number(paper.year)
          || JSON.stringify(old.collections || []) !== JSON.stringify(paper.collections || []);
      });
      if (needsOrganization) {
        window.setTimeout(() => {
          void this.organizeLibraryFiles(false).catch((error) => (
            console.warn("Paper Library: synchronized file reconciliation unavailable", error)
          ));
        }, 0);
      }
    }
  }

  async reloadSyncedSettingsIfChanged() {
    if (this.settingsSyncPollActive) return false;
    this.settingsSyncPollActive = true;
    const task = (this.settingsSaveQueue || Promise.resolve()).catch(() => {}).then(async () => {
      const signature = await this.readPersistedPluginDataSignature();
      if (signature && signature === this.settingsPersistenceSignature) return false;
      const disk = await this.readPersistedPluginData();
      const fingerprint = this.settingsFingerprint(disk || {});
      if (!fingerprint || fingerprint === this.settingsPersistenceFingerprint) {
        this.settingsPersistenceSignature = signature || this.settingsPersistenceSignature;
        return false;
      }
      const previous = this.cloneSettingsValue(this.settings || {});
      const merged = this.mergeSyncedSettings(
        this.settings || {},
        Object.assign({}, DEFAULT_SETTINGS, disk || {}),
        this.settingsPersistenceBaseline || {}
      );
      this.applyReloadedSettings(merged, previous);
      this.settingsPersistenceBaseline = this.cloneSettingsValue(this.settings);
      this.settingsPersistenceFingerprint = fingerprint;
      this.settingsPersistenceSignature = signature || this.settingsPersistenceSignature;
      return true;
    });
    this.settingsSaveQueue = task;
    try { return await task; }
    catch (error) {
      console.warn("Paper Library: synchronized plugin data reload unavailable", error);
      return false;
    } finally {
      this.settingsSyncPollActive = false;
    }
  }

  async saveSettings() {
    const task = (this.settingsSaveQueue || Promise.resolve()).catch(() => {}).then(async () => {
      let disk = null;
      try { disk = await this.readPersistedPluginData(); } catch (_) {}
      const diskFingerprint = this.settingsFingerprint(disk || {});
      if (diskFingerprint && this.settingsPersistenceFingerprint
        && diskFingerprint !== this.settingsPersistenceFingerprint) {
        const previous = this.cloneSettingsValue(this.settings || {});
        const merged = this.mergeSyncedSettings(
          this.settings || {},
          Object.assign({}, DEFAULT_SETTINGS, disk || {}),
          this.settingsPersistenceBaseline || {}
        );
        this.applyReloadedSettings(merged, previous);
      }
      this.settings.dataRevision = Math.max(
        Number(this.settings.dataRevision) || 0,
        Number(disk?.dataRevision) || 0
      ) + 1;
      this.settings.dataUpdatedAt = new Date().toISOString();
      const persisted = this.settingsForPersistence(this.settings);
      await this.saveData(persisted);
      this.settingsPersistenceBaseline = this.cloneSettingsValue(persisted);
      this.settingsPersistenceFingerprint = this.settingsFingerprint(persisted);
      this.settingsPersistenceSignature = await this.readPersistedPluginDataSignature();
    });
    this.settingsSaveQueue = task;
    return task;
  }

  isMobileApp() { return Boolean(this.mobile || isPaperLibraryMobile()); }

  async activateView() {
    if (this.isMobileApp()) {
      await this.ensureNavigationView(false);
      return this.activateMainView(true);
    }
    await this.ensureNavigationView(true);
    await this.ensureDetailView(true);
    await this.activateMainView(true);
  }

  async activateMainView(reveal = true) {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE) || [];
    // A synced desktop layout can leave the library view in a hidden side dock
    // on iPad. Only reuse the active mobile leaf; otherwise create a real tab.
    const existing = this.isMobileApp()
      ? leaves.find((leaf) => leaf === this.app.workspace.activeLeaf)
      : leaves[0];
    let leaf = existing || null;
    if (!leaf) {
      try { leaf = this.app.workspace.getLeaf("tab"); } catch (_) {}
      if (!leaf) {
        try { leaf = this.app.workspace.getLeaf(true); } catch (_) {}
      }
      if (!leaf) leaf = this.app.workspace.activeLeaf || null;
    }
    if (!leaf) throw new Error("无法创建论文库页面");
    if (!existing || leaf.view?.getViewType?.() !== VIEW_TYPE) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (reveal) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async ensureNavigationView(reveal = false) {
    let leaf = this.app.workspace.getLeavesOfType(NAV_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf?.(false) || null;
      if (!leaf && !this.isMobileApp()) leaf = this.app.workspace.getLeaf("tab");
      if (!leaf) return null;
      await leaf.setViewState({ type: NAV_VIEW_TYPE, active: true });
    }
    if (reveal) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async ensureDetailView(reveal = false) {
    let leaf = this.app.workspace.getLeavesOfType(DETAIL_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf?.(false) || this.app.workspace.getLeaf("tab");
      if (!leaf) return null;
      await leaf.setViewState({ type: DETAIL_VIEW_TYPE, active: true });
    }
    if (reveal) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  refreshViews(types = ALL_VIEW_TYPES) {
    if (!this.app.workspace?.getLeavesOfType) return;
    const targets = Array.isArray(types) ? types : [types];
    targets.forEach((type) => {
      this.app.workspace.getLeavesOfType(type).forEach((leaf) => {
        if (typeof leaf.view?.render === "function") leaf.view.render();
      });
    });
  }

  refreshPaperTableViews() {
    if (!this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view?.scope === "daily") leaf.view?.render?.();
      else leaf.view?.renderTable?.();
    });
  }

  refreshNavigationViews() {
    if (!this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType(NAV_VIEW_TYPE).forEach((leaf) => {
      leaf.view?.render?.();
    });
  }

  refreshDetailViews(options = {}) {
    if (!this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType(DETAIL_VIEW_TYPE).forEach((leaf) => {
      leaf.view?.render?.({ preserveScroll: options.preserveScroll !== false });
    });
  }

  refreshPaperPresentation(options = {}) {
    if (options.table !== false) this.refreshPaperTableViews();
    if (options.navigation) this.refreshNavigationViews();
    if (options.detail !== false) this.refreshDetailViews();
  }

  refreshSelectedPaperViews() {
    if (!this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      leaf.view?.syncSelectedPaperRows?.();
    });
    this.refreshDetailViews({ preserveScroll: false });
  }

  refreshLibraryScopeViews() {
    if (!this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType(NAV_VIEW_TYPE).forEach((leaf) => {
      leaf.view?.syncScopeNavigationState?.();
    });
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      leaf.view?.refreshScopeContent?.();
    });
  }

  getDeviceAppearanceStorageKey() {
    let vaultIdentity = "vault";
    try {
      vaultIdentity = this.app?.vault?.adapter?.getBasePath?.()
        || this.app?.vault?.getName?.()
        || vaultIdentity;
    } catch (_) {}
    const platform = this.isMobileApp() ? "mobile" : "desktop";
    return `paperlib-device-appearance-v1:${encodeURIComponent(String(vaultIdentity))}:${platform}`;
  }

  readDeviceAppearancePreferences() {
    const key = this.getDeviceAppearanceStorageKey();
    if (this.deviceAppearancePreferenceKey === key && this.deviceAppearancePreferences) {
      return { ...this.deviceAppearancePreferences };
    }
    let stored = {};
    try {
      const parsed = JSON.parse(globalThis.localStorage?.getItem?.(key) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
    } catch (_) {}
    const preferences = {
      appearance: Object.hasOwn(LIBRARY_APPEARANCES, String(stored.appearance || ""))
        ? String(stored.appearance)
        : "",
      customAppearanceId: normalizeCustomAppearanceId(stored.customAppearanceId, ""),
      accent: /^#[0-9a-f]{6}$/i.test(String(stored.accent || ""))
        ? normalizeAppearanceColor(stored.accent)
        : ""
    };
    this.deviceAppearancePreferenceKey = key;
    this.deviceAppearancePreferences = preferences;
    return { ...preferences };
  }

  writeDeviceAppearancePreferences(patch = {}) {
    const key = this.getDeviceAppearanceStorageKey();
    const current = this.readDeviceAppearancePreferences();
    const next = {
      appearance: patch.appearance === undefined
        ? current.appearance
        : normalizeLibraryAppearance(patch.appearance),
      customAppearanceId: patch.customAppearanceId === undefined
        ? current.customAppearanceId
        : normalizeCustomAppearanceId(patch.customAppearanceId, ""),
      accent: patch.accent === undefined
        ? current.accent
        : normalizeAppearanceColor(patch.accent)
    };
    try {
      const storage = globalThis.localStorage;
      if (!storage || typeof storage.setItem !== "function") return false;
      storage.setItem(key, JSON.stringify(next));
      this.deviceAppearancePreferenceKey = key;
      this.deviceAppearancePreferences = next;
      return true;
    } catch (_) {
      return false;
    }
  }

  async initializeDeviceAppearancePreferences() {
    const current = this.readDeviceAppearancePreferences();
    const mobile = this.isMobileApp();
    const fallbackAppearance = mobile
      ? this.settings.libraryAppearanceMobile
      : this.settings.libraryAppearance;
    // Blueprint is a structure package for “My Appearance”, not a separate
    // top-level template. Migrate the briefly shipped standalone selection on
    // each device without changing its accent or losing the visual result.
    if (current.appearance === "blueprint" || (!current.appearance && fallbackAppearance === "blueprint")) {
      this.settings.activeCustomAppearanceId = "blueprint";
      if (mobile) this.settings.libraryAppearanceMobile = "custom";
      else this.settings.libraryAppearance = "custom";
      this.writeDeviceAppearancePreferences({
        appearance: "custom",
        customAppearanceId: "blueprint",
        accent: current.accent || (mobile
          ? this.settings.globalAccentColorMobile
          : this.settings.globalAccentColor)
      });
      await this.saveData(this.settingsForPersistence(this.settings));
      return;
    }
    if (current.appearance && current.accent && (current.appearance !== "custom" || current.customAppearanceId)) return;
    this.writeDeviceAppearancePreferences({
      appearance: current.appearance || (mobile
        ? this.settings.libraryAppearanceMobile
        : this.settings.libraryAppearance),
      customAppearanceId: current.customAppearanceId || this.settings.activeCustomAppearanceId,
      accent: current.accent || (mobile
        ? this.settings.globalAccentColorMobile
        : this.settings.globalAccentColor)
    });
  }

  getLibraryAppearanceId() {
    const localAppearance = this.readDeviceAppearancePreferences().appearance;
    if (localAppearance) return normalizeLibraryAppearance(localAppearance);
    return this.isMobileApp()
      ? normalizeLibraryAppearance(this.settings.libraryAppearanceMobile || this.settings.libraryAppearance)
      : normalizeLibraryAppearance(this.settings.libraryAppearance, this.settings.libraryViewStyle);
  }

  getLibraryAccentColor() {
    const localAccent = this.readDeviceAppearancePreferences().accent;
    if (localAccent) return normalizeAppearanceColor(localAccent);
    return normalizeAppearanceColor(this.isMobileApp()
      ? (this.settings.globalAccentColorMobile || this.settings.globalAccentColor)
      : this.settings.globalAccentColor);
  }

  getLibraryAppearanceName(id = this.getLibraryAppearanceId()) {
    if (id === "custom") return this.getActiveCustomAppearanceProfile().name;
    return LIBRARY_APPEARANCES[id]?.name || LIBRARY_APPEARANCES.standard.name;
  }

  getCustomAppearanceProfiles() {
    return normalizeCustomAppearanceProfiles(this.settings.customAppearances, {
      name: this.settings.customAppearanceName,
      base: this.settings.customAppearanceBase,
      css: this.settings.customAppearanceCss
    });
  }

  getActiveCustomAppearanceId() {
    const local = this.readDeviceAppearancePreferences().customAppearanceId;
    const profiles = this.getCustomAppearanceProfiles();
    const candidate = normalizeCustomAppearanceId(local || this.settings.activeCustomAppearanceId);
    return profiles.some((profile) => profile.id === candidate) ? candidate : profiles[0]?.id || "blueprint";
  }

  getActiveCustomAppearanceProfile() {
    const profiles = this.getCustomAppearanceProfiles();
    const id = this.getActiveCustomAppearanceId();
    return profiles.find((profile) => profile.id === id) || profiles[0]
      || { id: "blueprint", name: "蓝图", base: "blueprint", css: "", builtin: true };
  }

  getLibraryAppearanceSelectionId() {
    const id = this.getLibraryAppearanceId();
    return id === "custom" ? `custom:${this.getActiveCustomAppearanceId()}` : id;
  }

  getLibraryAppearanceBase(id = this.getLibraryAppearanceId()) {
    if (id === "custom") return normalizeAppearanceBase(this.getActiveCustomAppearanceProfile().base);
    return LIBRARY_APPEARANCES[id]?.base || "standard";
  }

  getLibraryAppearanceDefinition(id = this.getLibraryAppearanceId()) {
    const base = this.getLibraryAppearanceBase(id);
    const baseDefinition = LIBRARY_APPEARANCES[base] || LIBRARY_APPEARANCES.standard;
    if (id !== "custom") return LIBRARY_APPEARANCES[id] || baseDefinition;
    return {
      ...baseDefinition,
      ...LIBRARY_APPEARANCES.custom,
      id: "custom",
      base,
      name: this.getActiveCustomAppearanceProfile().name,
      scheme: baseDefinition.scheme,
      density: baseDefinition.density,
      geometry: baseDefinition.geometry,
      navigation: baseDefinition.navigation,
      detail: baseDefinition.detail,
      sidebarEyebrow: baseDefinition.sidebarEyebrow,
      mastheadEyebrow: baseDefinition.mastheadEyebrow,
      mastheadMotto: baseDefinition.mastheadMotto,
      mastheadMark: baseDefinition.mastheadMark
    };
  }

  isGalleryView() {
    return this.getLibraryAppearanceBase() === "gallery";
  }

  // Compatibility alias for older layout code and third-party snippets.
  isSeveranceView() {
    return this.isGalleryView();
  }

  applyLibraryViewStyle(root) {
    if (!root) return;
    const id = this.getLibraryAppearanceId();
    const base = this.getLibraryAppearanceBase(id);
    Array.from(root.classList || [])
      .filter((className) => className.startsWith("paperlib-appearance-") || className.startsWith("paperlib-appearance-base-"))
      .forEach((className) => root.classList.remove(className));
    root.classList.add(`paperlib-appearance-${id}`);
    root.classList.add(`paperlib-appearance-base-${base}`);
    root.toggleClass?.("paperlib-severance-view", base === "gallery");
    root.dataset.paperlibAppearance = id;
    root.dataset.paperlibAppearanceBase = base;
    if (id === "custom") root.dataset.paperlibCustomAppearance = this.getActiveCustomAppearanceId();
    else delete root.dataset.paperlibCustomAppearance;
    root.dataset.paperlibAppearanceProtocol = String(APPEARANCE_PROTOCOL_VERSION);
    root.dataset.paperlibSurface = root.classList.contains("paperlib-native-sidebar")
      ? "navigation"
      : root.classList.contains("paperlib-native-detail") ? "detail" : "library";
    const definition = this.getLibraryAppearanceDefinition(id);
    root.dataset.paperlibColorScheme = definition.scheme;
    root.dataset.paperlibMotion = definition.motion;
    root.dataset.paperlibDensity = definition.density;
    root.dataset.paperlibGeometry = definition.geometry;
    root.dataset.paperlibNavigation = definition.navigation;
    root.dataset.paperlibDetailLayout = definition.detail;
    const accent = this.getLibraryAccentColor();
    root.style?.setProperty?.("--paperlib-global-accent", accent);
    root.style?.setProperty?.("--paperlib-accent-contrast", appearanceContrastColor(accent));
    // Stable body-level appearance state is used only to blend mobile system
    // safe areas and drawer transition frames with the selected surface.
    if (typeof document !== "undefined") {
      document.body?.toggleClass?.("paperlib-paperglass-active", base === "paperglass");
      document.body?.toggleClass?.("paperlib-gallery-active", base === "gallery");
      document.body?.toggleClass?.("paperlib-blueprint-active", base === "blueprint");
    }
  }

  applyAppearanceToOpenViews() {
    [VIEW_TYPE, NAV_VIEW_TYPE, DETAIL_VIEW_TYPE].forEach((type) => {
      this.app.workspace.getLeavesOfType(type).forEach((leaf) => {
        this.applyLibraryViewStyle(itemViewContentRoot(leaf.view));
      });
    });
  }

  installCustomAppearanceStyle() {
    if (typeof document === "undefined") return;
    if (!this.customAppearanceStyleEl?.isConnected) {
      this.customAppearanceStyleEl = document.createElement("style");
      this.customAppearanceStyleEl.id = `paperlib-custom-appearance-${this.manifest?.id || "paper-library"}`;
      document.head.appendChild(this.customAppearanceStyleEl);
    }
    this.customAppearanceStyleEl.textContent = this.getCustomAppearanceProfiles()
      .filter((profile) => String(profile.css || "").trim())
      .map((profile) => `@scope ([data-paperlib-custom-appearance="${profile.id}"]) {\n${profile.css}\n}`)
      .join("\n\n");
  }

  showLibraryAppearanceMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const active = this.getLibraryAppearanceId();
    const menu = new Menu();
    ["standard", "gallery", "paperglass"].forEach((id) => {
      menu.addItem((item) => item
        .setTitle(this.getLibraryAppearanceName(id))
        .setIcon(active === id ? "check" : id === "gallery" ? "layout-dashboard" : id === "paperglass" ? "layout-grid" : "table-2")
        .onClick(() => void this.setLibraryAppearance(id)));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("我的外观").setIcon("paintbrush");
      const submenu = item.setSubmenu();
      this.getCustomAppearanceProfiles().forEach((profile) => submenu.addItem((child) => child
        .setTitle(profile.name)
        .setIcon(active === "custom" && this.getActiveCustomAppearanceId() === profile.id ? "check" : profile.base === "blueprint" ? "layout-template" : "palette")
        .onClick(() => void this.setLibraryAppearance(`custom:${profile.id}`))));
    });
    menu.showAtMouseEvent(event);
  }

  async setLibraryAppearance(value, notify = true) {
    const raw = String(value || "");
    const customId = raw.startsWith("custom:") ? normalizeCustomAppearanceId(raw.slice(7)) : "";
    const id = customId ? "custom" : normalizeLibraryAppearance(raw);
    const mobile = this.isMobileApp();
    // Device-local storage is deliberately outside data.json, so Obsidian Sync
    // cannot make a phone appearance overwrite the desktop appearance (or the
    // reverse). Synced fields remain migration fallbacks for older clients.
    if (customId && this.getCustomAppearanceProfiles().some((profile) => profile.id === customId)) {
      this.settings.activeCustomAppearanceId = customId;
    }
    if (!this.writeDeviceAppearancePreferences({ appearance: id, ...(customId ? { customAppearanceId: customId } : {}) })) {
      if (mobile) this.settings.libraryAppearanceMobile = id;
      else {
        this.settings.libraryAppearance = id;
        this.settings.libraryViewStyle = this.getLibraryAppearanceBase(id) === "gallery" ? "severance" : "default";
      }
      await this.saveSettings();
    }
    this.refreshViews([VIEW_TYPE, NAV_VIEW_TYPE, DETAIL_VIEW_TYPE]);
    if (notify) new Notice(`已切换到${this.getLibraryAppearanceName(id)}（仅${mobile ? "移动端" : "桌面端"}）`);
  }

  async setLibraryAccentColor(value) {
    const accent = normalizeAppearanceColor(value);
    if (!this.writeDeviceAppearancePreferences({ accent })) {
      if (this.isMobileApp()) this.settings.globalAccentColorMobile = accent;
      else this.settings.globalAccentColor = accent;
      await this.saveSettings();
    }
    this.applyAppearanceToOpenViews();
  }

  async updateCustomAppearanceProfile(id, patch = {}) {
    const targetId = normalizeCustomAppearanceId(id);
    const profiles = this.getCustomAppearanceProfiles();
    const index = profiles.findIndex((profile) => profile.id === targetId);
    if (index < 0) return;
    const current = profiles[index];
    profiles[index] = {
      ...current,
      ...patch,
      id: current.id,
      name: current.builtin ? current.name : (String(patch.name ?? current.name).trim() || "未命名外观"),
      base: current.builtin ? current.base : normalizeAppearanceBase(patch.base ?? current.base),
      css: String(patch.css ?? current.css),
      builtin: current.builtin
    };
    this.settings.customAppearances = profiles;
    await this.saveSettings();
    this.installCustomAppearanceStyle();
    if (this.getLibraryAppearanceId() === "custom" && this.getActiveCustomAppearanceId() === targetId) {
      this.refreshViews([VIEW_TYPE, NAV_VIEW_TYPE, DETAIL_VIEW_TYPE]);
    }
  }

  async createCustomAppearanceProfile() {
    const profiles = this.getCustomAppearanceProfiles();
    let id = `appearance-${Date.now().toString(36)}`;
    while (profiles.some((profile) => profile.id === id)) id = `${id}-1`;
    profiles.push({ id, name: `我的外观 ${profiles.length}`, base: "standard", css: "", builtin: false });
    this.settings.customAppearances = profiles;
    this.settings.appearanceEditorProfileId = id;
    await this.saveSettings();
    return id;
  }

  async deleteCustomAppearanceProfile(id) {
    const targetId = normalizeCustomAppearanceId(id);
    const profiles = this.getCustomAppearanceProfiles();
    const target = profiles.find((profile) => profile.id === targetId);
    if (!target || target.builtin) return new Notice("预置外观不能删除");
    this.settings.customAppearances = profiles.filter((profile) => profile.id !== targetId);
    this.settings.appearanceEditorProfileId = "blueprint";
    if (this.settings.activeCustomAppearanceId === targetId) this.settings.activeCustomAppearanceId = "blueprint";
    const local = this.readDeviceAppearancePreferences();
    if (local.customAppearanceId === targetId) this.writeDeviceAppearancePreferences({ customAppearanceId: "blueprint" });
    await this.saveSettings();
    this.installCustomAppearanceStyle();
    this.refreshViews([VIEW_TYPE, NAV_VIEW_TYPE, DETAIL_VIEW_TYPE]);
  }

  async toggleLibraryViewStyle() {
    return this.setLibraryAppearance(this.isGalleryView() ? "standard" : "gallery");
  }

  normalizePaperTableColumnWidths(widths = {}) {
    return Object.fromEntries(Object.entries(PAPER_TABLE_COLUMNS).map(([key, config]) => {
      const value = Number(widths?.[key]);
      const width = Number.isFinite(value)
        ? Math.min(config.max, Math.max(config.min, Math.round(value)))
        : config.width;
      return [key, width];
    }));
  }

  normalizePaperTableColumnOrder(order = []) {
    const known = new Set(DEFAULT_PAPER_TABLE_COLUMN_ORDER);
    const normalized = (Array.isArray(order) ? order : [])
      .map((key) => String(key || ""))
      .filter((key, index, values) => known.has(key) && values.indexOf(key) === index);
    DEFAULT_PAPER_TABLE_COLUMN_ORDER.forEach((key) => {
      if (!normalized.includes(key)) normalized.push(key);
    });
    return normalized;
  }

  normalizeVenueRanks(value = []) {
    if (typeof value === "string") return this.parseVenueRanksInput(value);
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.flatMap((item) => {
      if (typeof item === "string") return this.parseVenueRanksInput(item);
      const system = String(item?.system || item?.source || item?.name || "").trim();
      const rank = String(item?.rank || item?.level || item?.value || "").trim();
      if (!system || !rank) return [];
      const key = `${system}:${rank}`.toLocaleLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ system, rank }];
    });
  }

  parseVenueRanksInput(value = "") {
    const entries = String(value || "")
      .split(/[\n,，;；|]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separated = item.match(/^(.+?)\s*[:：]\s*(.+)$/);
        if (separated) return { system: separated[1], rank: separated[2] };
        const spaced = item.match(/^(.+?)\s+(A\*|[ABC]|Q[1-4]|[1-4]\s*区)$/i);
        return spaced ? { system: spaced[1], rank: spaced[2] } : null;
      })
      .filter(Boolean);
    return this.normalizeVenueRanks(entries);
  }

  formatVenueRanksInput(value = []) {
    return this.normalizeVenueRanks(value).map(({ system, rank }) => `${system}:${rank}`).join("; ");
  }

  formatVenueDisplay(venue = "") {
    const name = String(venue || "").trim();
    if (!name || name.includes(" · ")) return name;
    if (/^(?:usenix\s+atc|(?:(?:19|20)\d{2}\s+)?usenix\s+annual\s+technical\s+conference)$/i.test(name)) {
      return "USENIX ATC · USENIX Annual Technical Conference";
    }
    const rule = this.findConferenceRankingRule(name) || findVenueRankingRule(name);
    if (rule?.shortName && rule?.fullName) return `${rule.shortName} · ${rule.fullName}`;
    const parenthesized = name.match(/^(.+?)\s*\(([A-Z][A-Z0-9+.-]{1,15})\)\s*$/);
    if (!parenthesized) return name;
    const fullName = parenthesized[1].replace(/^\s*(?:19|20)\d{2}\s+/, "").trim();
    return `${parenthesized[2]} · ${fullName}`;
  }

  parseConferenceRankingDatabase(yamlText = "") {
    const conferences = [];
    let current = null;
    let currentConf = null;
    let currentTimeline = null;
    let inRank = false;
    const scalar = (value = "") => String(value || "").trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/\\(['"])/g, "$1");
    const commit = () => {
      if (!current?.title) return;
      const firstId = String(current.confs?.[0]?.id || "").trim();
      const idSeries = firstId
        .replace(/(?:19|20)\d{2}.*$/i, "")
        .replace(/\d{2}$/i, "")
        .replace(/[^a-z0-9]+/gi, "")
        .toLocaleLowerCase();
      const shortName = current.title;
      const aliases = [...new Set([
        shortName,
        current.description,
        current.dblp,
        idSeries,
        ...(CONFERENCE_RANKING_HISTORICAL_ALIASES[shortName] || [])
      ].map((value) => String(value || "").trim()).filter(Boolean))];
      const ranks = this.normalizeVenueRanks([
        current.ranks.ccf ? { system: "CCF", rank: current.ranks.ccf } : null,
        current.ranks.core ? { system: "CORE", rank: current.ranks.core } : null,
        current.ranks.thcpl ? { system: "TH-CPL", rank: current.ranks.thcpl } : null
      ].filter(Boolean));
      if (!ranks.length) return;
      conferences.push({
        kind: "conference",
        shortName,
        fullName: current.description || shortName,
        sub: current.sub || "",
        dblp: current.dblp || "",
        aliases,
        ranks,
        acceptanceSeries: shortName,
        acceptanceSeriesAliases: aliases,
        acceptancePath: current.sub && idSeries ? `${current.sub}/${idSeries}.yml` : "",
        confs: current.confs || []
      });
    };
    const commitTimeline = () => {
      if (!currentConf || (!currentTimeline?.deadline && !currentTimeline?.abstractDeadline)) return;
      currentConf.timeline.push({ ...currentTimeline });
      currentTimeline = null;
    };
    const commitConf = () => {
      if (!current || !currentConf) return;
      commitTimeline();
      if (currentConf.id || currentConf.year) current.confs.push(currentConf);
      currentConf = null;
    };
    String(yamlText || "").replace(/^\ufeff/, "").split(/\r?\n/).forEach((line) => {
      const title = line.match(/^- title:\s*(.*?)\s*$/);
      if (title) {
        commitConf();
        commit();
        current = { title: scalar(title[1]), description: "", sub: "", dblp: "", ranks: {}, confs: [] };
        inRank = false;
        return;
      }
      if (!current) return;
      const topField = line.match(/^  (description|sub|dblp):\s*(.*?)\s*$/);
      if (topField) {
        current[topField[1]] = scalar(topField[2]);
        inRank = false;
        return;
      }
      if (/^  rank:\s*$/.test(line)) {
        inRank = true;
        return;
      }
      const rank = inRank ? line.match(/^    (ccf|core|thcpl):\s*(.*?)\s*$/) : null;
      if (rank) {
        current.ranks[rank[1]] = scalar(rank[2]).toLocaleUpperCase();
        return;
      }
      if (/^  confs:\s*$/.test(line)) {
        inRank = false;
        return;
      }
      const confStart = line.match(/^  - year:\s*(.*?)\s*$/);
      if (confStart) {
        commitConf();
        currentConf = { year: Number(scalar(confStart[1])) || scalar(confStart[1]), id: "", link: "", timezone: "", date: "", place: "", timeline: [] };
        return;
      }
      if (!currentConf) return;
      const confField = line.match(/^    (id|link|timezone|date|place):\s*(.*?)\s*$/);
      if (confField) {
        commitTimeline();
        currentConf[confField[1]] = scalar(confField[2]);
        return;
      }
      const timelineStart = line.match(/^    - (deadline|abstract_deadline):\s*(.*?)\s*$/);
      if (timelineStart) {
        commitTimeline();
        currentTimeline = { deadline: "", abstractDeadline: "", comment: "" };
        const key = timelineStart[1] === "abstract_deadline" ? "abstractDeadline" : timelineStart[1];
        currentTimeline[key] = scalar(timelineStart[2]);
        return;
      }
      const timelineField = currentTimeline
        ? line.match(/^      (deadline|abstract_deadline|comment):\s*(.*?)\s*$/)
        : null;
      if (timelineField) {
        const key = timelineField[1] === "abstract_deadline" ? "abstractDeadline" : timelineField[1];
        currentTimeline[key] = scalar(timelineField[2]);
      }
    });
    commitConf();
    commit();
    return conferences;
  }

  async syncConferenceRankingDatabase(force = false) {
    const current = this.settings.conferenceRankingDatabase || { updatedAt: "", source: "", conferences: [] };
    const updatedAt = Date.parse(current.updatedAt || "") || 0;
    const hasData = Array.isArray(current.conferences) && current.conferences.length > 0;
    if (!force && hasData && Date.now() - updatedAt < CONFERENCE_RANKING_DATABASE_MAX_AGE) return current;
    if (!force && Date.now() - this.conferenceRankingDatabaseLastAttemptAt < 5 * 60 * 1000) return current;
    if (this.conferenceRankingDatabaseLoading) return this.conferenceRankingDatabaseLoading;
    this.conferenceRankingDatabaseLastAttemptAt = Date.now();
    this.conferenceRankingDatabaseLoading = (async () => {
      try {
        const response = await requestUrl({
          url: CCFDDL_CONFERENCE_DATABASE_URL,
          method: "GET",
          headers: { Accept: "text/yaml,text/plain" }
        });
        const conferences = this.parseConferenceRankingDatabase(response?.text || "");
        if (conferences.length < 100) throw new Error("CCFDDL 完整会议等级数据库格式无效");
        const database = {
          updatedAt: new Date().toISOString(),
          source: "CCFDDL",
          sourceUrl: CCFDDL_CONFERENCE_DATABASE_URL,
          conferences
        };
        this.settings.conferenceRankingDatabase = database;
        this.conferenceRankingLookup = null;
        await this.saveSettings();
        return database;
      } catch (error) {
        if (force && !hasData) throw error;
        console.warn("Paper Library: online conference ranking database unavailable; keeping local snapshot", error);
        return current;
      } finally {
        this.conferenceRankingDatabaseLoading = null;
      }
    })();
    return this.conferenceRankingDatabaseLoading;
  }

  buildConferenceRankingLookup() {
    const conferences = Array.isArray(this.settings.conferenceRankingDatabase?.conferences)
      ? this.settings.conferenceRankingDatabase.conferences : [];
    const exact = new Map();
    const canonicalCandidates = new Map();
    const searchable = [];
    conferences.forEach((conference) => {
      const aliases = [...new Set([
        conference.shortName,
        conference.fullName,
        conference.dblp,
        ...(conference.aliases || []),
        ...(CONFERENCE_RANKING_HISTORICAL_ALIASES[conference.shortName] || [])
      ].map((value) => String(value || "").trim()).filter(Boolean))];
      aliases.forEach((alias) => {
        const key = normalizeVenueLookup(alias);
        if (!key) return;
        if (!exact.has(key)) exact.set(key, conference);
        const canonicalKey = normalizeConferenceVenueLookup(alias);
        if (canonicalKey) {
          const matches = canonicalCandidates.get(canonicalKey) || [];
          if (!matches.includes(conference)) matches.push(conference);
          canonicalCandidates.set(canonicalKey, matches);
        }
        searchable.push({ key, canonicalKey, conference });
      });
    });
    const canonical = new Map();
    canonicalCandidates.forEach((matches, key) => {
      // Publisher names can distinguish otherwise identical conference names.
      // Only accept a stripped canonical key when it resolves to one series.
      if (matches.length === 1) canonical.set(key, matches[0]);
    });
    this.conferenceRankingLookup = { exact, canonical, searchable };
    return this.conferenceRankingLookup;
  }

  findConferenceRankingRule(value = "") {
    const staticRule = findVenueRankingRule(value);
    if (staticRule) return staticRule;
    const key = normalizeVenueLookup(value);
    if (!key) return null;
    const lookup = this.conferenceRankingLookup || this.buildConferenceRankingLookup();
    const exact = lookup.exact.get(key);
    if (exact) return exact;
    const canonicalKey = normalizeConferenceVenueLookup(value);
    const canonical = canonicalKey ? lookup.canonical.get(canonicalKey) : null;
    if (canonical) return canonical;
    let best = null;
    let bestScore = 0;
    lookup.searchable.forEach((candidate) => {
      const alias = candidate.key;
      const canonicalAlias = candidate.canonicalKey;
      const tokenMatch = key === alias
        || key.startsWith(`${alias} `)
        || key.endsWith(` ${alias}`)
        || key.includes(` ${alias} `);
      const descriptiveMatch = alias.length >= 10 && (key.includes(alias) || alias.includes(key));
      const canonicalContainment = canonicalKey.length >= 12 && canonicalAlias.length >= 12
        && (canonicalKey.includes(canonicalAlias) || canonicalAlias.includes(canonicalKey));
      if (!tokenMatch && !descriptiveMatch && !canonicalContainment) return;
      const score = (tokenMatch ? 1000 : descriptiveMatch ? 500 : 350)
        + Math.min(canonicalAlias.length || alias.length, 300);
      if (score > bestScore) {
        best = candidate.conference;
        bestScore = score;
      }
    });
    return best;
  }

  parseJcrRankIndex(csvText = "") {
    const lines = String(csvText || "").replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return new Map();
    const headers = parseCsvLine(lines[0]);
    const journalIndex = headers.indexOf("Journal");
    const impactFactorIndex = headers.findIndex((header) => /^IF\(\d{4}\)$/i.test(header));
    const quartileIndexes = headers
      .map((header, index) => /^IF Quartile\(/i.test(header) ? index : -1)
      .filter((index) => index >= 0);
    if (journalIndex < 0 || (!quartileIndexes.length && impactFactorIndex < 0)) return new Map();
    const index = new Map();
    lines.slice(1).forEach((line) => {
      const cells = parseCsvLine(line);
      const journal = String(cells[journalIndex] || "").trim();
      const key = normalizeVenueLookup(journal);
      if (!key) return;
      const quartiles = [...new Set(quartileIndexes
        .map((column) => String(cells[column] || "").trim().toLocaleUpperCase())
        .filter((value) => /^Q[1-4]$/.test(value)))]
        .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
      const impactFactor = String(cells[impactFactorIndex] || "").trim();
      if (!quartiles.length && !/^\d+(?:\.\d+)?$/.test(impactFactor)) return;
      const previous = index.get(key) || { quartiles: [], impactFactor: "" };
      index.set(key, {
        quartiles: [...new Set([...previous.quartiles, ...quartiles])]
          .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1))),
        impactFactor: /^\d+(?:\.\d+)?$/.test(impactFactor) ? impactFactor : previous.impactFactor
      });
    });
    return index;
  }

  async loadJcrRankIndex(force = false) {
    if (force) this.jcrRankIndex = null;
    if (this.jcrRankIndex instanceof Map) return this.jcrRankIndex;
    if (this.jcrRankLoading) return this.jcrRankLoading;
    this.jcrRankLoading = (async () => {
      const response = await requestUrl({ url: SHOW_JCR.url, method: "GET" });
      const text = response?.text || (typeof response === "string" ? response : "");
      const index = this.parseJcrRankIndex(text);
      if (!index.size) throw new Error("JCR 数据格式无效");
      this.jcrRankIndex = index;
      return index;
    })();
    try { return await this.jcrRankLoading; }
    finally { this.jcrRankLoading = null; }
  }

  async lookupJcrVenueRanks(venue = "", force = false) {
    const name = String(venue || "").trim();
    if (!name || /^arxiv\b/i.test(name)) return [];
    const venueRule = this.findConferenceRankingRule(name) || findVenueRankingRule(name);
    if (venueRule?.kind === "conference" || /\b(?:conference|symposium|proceedings)\b/i.test(name)) return [];
    const key = normalizeVenueLookup(name);
    if (!key) return [];
    this.settings.jcrRankCache ||= {};
    if (!force && Object.prototype.hasOwnProperty.call(this.settings.jcrRankCache, key)) {
      return this.normalizeVenueRanks(this.settings.jcrRankCache[key]);
    }
    const index = await this.loadJcrRankIndex(force);
    const lookupKeys = [key];
    if (venueRule?.fullName) lookupKeys.push(normalizeVenueLookup(venueRule.fullName));
    const record = lookupKeys.map((lookupKey) => index.get(lookupKey)).find(Boolean);
    const ranks = this.normalizeVenueRanks([
      record?.quartiles?.length ? { system: `JCR ${SHOW_JCR.year}`, rank: record.quartiles.join("/") } : null,
      record?.impactFactor ? { system: `IF ${SHOW_JCR.year}`, rank: record.impactFactor } : null
    ].filter(Boolean));
    this.settings.jcrRankCache[key] = ranks;
    this.venueRankCacheDirty = true;
    return ranks;
  }

  parseConferenceRateDatabase(payload = {}) {
    const conferences = Array.isArray(payload?.conferences) ? payload.conferences : [];
    const series = {};
    conferences.forEach((conference) => {
      const key = String(conference?.series || "").trim().toLocaleUpperCase();
      if (!key) return;
      const rates = (Array.isArray(conference.yearly_data) ? conference.yearly_data : []).flatMap((entry) => {
        const year = Number(entry?.year) || 0;
        const track = entry?.main_track || {};
        const accepted = Number(track.num_acc);
        const submitted = Number(track.num_sub);
        let rate = Number(track.acceptance_rate ?? entry?.acceptance_rate);
        if ((!Number.isFinite(rate) || rate <= 0) && accepted >= 0 && submitted > 0) rate = accepted / submitted;
        if (rate > 1) rate /= 100;
        if (!year || !Number.isFinite(rate) || rate <= 0 || rate > 1) return [];
        return [{ year, accepted: accepted || 0, submitted: submitted || 0, rate }];
      }).sort((left, right) => right.year - left.year);
      if (rates.length) series[key] = rates;
    });
    return series;
  }

  async syncConferenceRateDatabase(force = false) {
    const current = this.settings.conferenceRateDatabase || { updatedAt: "", source: "", series: {} };
    const updatedAt = Date.parse(current.updatedAt || "") || 0;
    const hasData = current.series && Object.keys(current.series).length > 0;
    if (!force && hasData && Date.now() - updatedAt < CONFERENCE_RATE_DATABASE_MAX_AGE) return current;
    if (!force && Date.now() - this.conferenceRateDatabaseLastAttemptAt < 5 * 60 * 1000) return current;
    if (this.conferenceRateDatabaseLoading) return this.conferenceRateDatabaseLoading;
    this.conferenceRateDatabaseLastAttemptAt = Date.now();
    this.conferenceRateDatabaseLoading = (async () => {
      try {
        const response = await requestUrl({
          url: CS_CONF_STATS_URL,
          method: "GET",
          headers: { Accept: "application/json" }
        });
        const payload = response?.json || JSON.parse(response?.text || "{}");
        const series = this.parseConferenceRateDatabase(payload);
        if (!Object.keys(series).length) throw new Error("在线会议录用率数据库格式无效");
        const database = {
          updatedAt: new Date().toISOString(),
          source: "CS Conf Stats",
          sourceUrl: CS_CONF_STATS_URL,
          series
        };
        this.settings.conferenceRateDatabase = database;
        // Per-paper rate entries must be recomputed against the new snapshot.
        this.settings.conferenceRateCache = {};
        this.conferenceRateIndex?.clear?.();
        await this.saveSettings();
        return database;
      } catch (error) {
        if (force) throw error;
        console.warn("Paper Library: online conference rate database unavailable; keeping local snapshot", error);
        return current;
      } finally {
        this.conferenceRateDatabaseLoading = null;
      }
    })();
    return this.conferenceRateDatabaseLoading;
  }

  parseConferenceAcceptanceRates(yamlText = "") {
    const entries = [];
    let current = null;
    const commit = () => {
      if (!current?.year) return;
      let rate = Number.parseFloat(String(current.rate || "").replace(",", "."));
      if (!Number.isFinite(rate)) {
        const percent = String(current.str || "").match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (percent) rate = Number.parseFloat(percent[1].replace(",", ".")) / 100;
      }
      if (!Number.isFinite(rate) && current.submitted > 0 && current.accepted >= 0) {
        rate = current.accepted / current.submitted;
      }
      if (Number.isFinite(rate) && rate >= 0) entries.push({ ...current, rate: rate > 1 ? rate / 100 : rate });
    };
    String(yamlText || "").split(/\r?\n/).forEach((line) => {
      const year = line.match(/^\s*-\s*year:\s*(\d{4})\s*$/i);
      if (year) {
        commit();
        current = { year: Number(year[1]), submitted: 0, accepted: 0, rate: "", str: "" };
        return;
      }
      if (!current) return;
      const field = line.match(/^\s*(submitted|accepted|rate|str):\s*(.*?)\s*$/i);
      if (!field) return;
      const key = field[1].toLocaleLowerCase();
      const value = field[2].replace(/^['"]|['"]$/g, "");
      current[key] = ["submitted", "accepted"].includes(key) ? Number(value) || 0 : value;
    });
    commit();
    return entries;
  }

  async loadConferenceAcceptanceRates(rule) {
    if (!rule) return [];
    const database = await this.syncConferenceRateDatabase();
    const seriesKeys = [...new Set([
      rule.acceptanceSeries,
      rule.shortName,
      rule.dblp,
      ...(rule.acceptanceSeriesAliases || []),
      ...(rule.aliases || [])
    ].map((value) => String(value || "").trim().toLocaleUpperCase()).filter(Boolean))];
    const databaseRates = seriesKeys
      .map((seriesKey) => database?.series?.[seriesKey])
      .find((rates) => Array.isArray(rates) && rates.length) || [];
    if (databaseRates.length) return databaseRates;
    if (!rule.acceptancePath) return [];
    this.conferenceRateIndex ||= new Map();
    if (this.conferenceRateIndex.has(rule.acceptancePath)) return this.conferenceRateIndex.get(rule.acceptancePath);
    this.conferenceRateLoading ||= new Map();
    if (this.conferenceRateLoading.has(rule.acceptancePath)) return this.conferenceRateLoading.get(rule.acceptancePath);
    const loading = (async () => {
      const response = await requestUrl({
        url: `${CCFDDL_ACCEPTANCE_BASE_URL}/${rule.acceptancePath}`,
        method: "GET"
      });
      const text = response?.text || (typeof response === "string" ? response : "");
      const rates = this.parseConferenceAcceptanceRates(text);
      this.conferenceRateIndex.set(rule.acceptancePath, rates);
      return rates;
    })();
    this.conferenceRateLoading.set(rule.acceptancePath, loading);
    try { return await loading; }
    finally { this.conferenceRateLoading.delete(rule.acceptancePath); }
  }

  async lookupConferenceAcceptanceRate(paper = {}, force = false) {
    const name = String(paper.venue || "").trim();
    const matchedRule = this.findConferenceRankingRule(name) || findVenueRankingRule(name);
    const rule = matchedRule?.kind === "conference" ? matchedRule : null;
    if (!rule || (!rule.acceptancePath && !rule.acceptanceSeries)) return null;
    const paperYear = Number(paper.year) || 0;
    const cacheKey = `${rule.shortName.toLocaleLowerCase()}:${paperYear || "latest"}`;
    this.settings.conferenceRateCache ||= {};
    if (!force && Object.prototype.hasOwnProperty.call(this.settings.conferenceRateCache, cacheKey)) {
      return this.settings.conferenceRateCache[cacheKey] || null;
    }
    const rates = await this.loadConferenceAcceptanceRates(rule);
    const exact = paperYear ? rates.find((item) => item.year === paperYear) : null;
    const selected = exact || [...rates].sort((left, right) => right.year - left.year)[0];
    const rank = selected
      ? { system: `录用率 ${selected.year}`, rank: `${(selected.rate * 100).toFixed(1)}%` }
      : null;
    this.settings.conferenceRateCache[cacheKey] = rank;
    this.venueRankCacheDirty = true;
    return rank;
  }

  async enrichPaperVenueRanks(paper, options = {}) {
    if (!paper || !this.settings.onlineMetadataLookup) return false;
    const force = Boolean(options.force);
    if (force || !(this.settings.conferenceRankingDatabase?.conferences || []).length) {
      try { await this.syncConferenceRankingDatabase(force); }
      catch (error) { console.warn("Paper Library: full conference ranking sync unavailable", error); }
    }
    const ranks = this.normalizeVenueRanks(paper.venueRanks);
    const existingSystems = new Set(ranks.map(({ system }) => system.toLocaleLowerCase()));
    const rule = this.findConferenceRankingRule(paper.venue || "") || findVenueRankingRule(paper.venue || "");
    if (rule?.kind) paper.venueRankingKind = rule.kind;
    let discovered = this.normalizeVenueRanks(rule?.ranks || [])
      .filter(({ system }) => !existingSystems.has(system.toLocaleLowerCase()));
    if (rule?.kind === "conference") {
      if (![...existingSystems].some((system) => /^(?:录用率(?:\s|$)|acceptance rate\b)/i.test(system))) {
        try {
          const acceptanceRate = await this.lookupConferenceAcceptanceRate(paper, force);
          if (acceptanceRate) discovered.push(acceptanceRate);
        } catch (error) {
          // Ranking systems and acceptance-rate history are independent. A
          // missing rate file must never discard valid CCF/CORE/TH-CPL ranks.
          console.warn(`Paper Library: acceptance rate unavailable for ${paper.venue || "conference"}`, error);
        }
      }
    } else {
      const jcrRanks = await this.lookupJcrVenueRanks(paper.venue, force);
      discovered.push(...jcrRanks.filter(({ system }) => !existingSystems.has(system.toLocaleLowerCase())));
    }
    discovered = this.normalizeVenueRanks(discovered);
    if (!discovered.length) return false;
    paper.venueRanks = this.normalizeVenueRanks([...ranks, ...discovered]);
    return true;
  }

  async enrichExistingVenueRanks() {
    let changed = false;
    for (const paper of this.settings.papers) {
      try {
        if (await this.enrichPaperVenueRanks(paper)) changed = true;
      } catch (error) {
        console.warn("Paper Library: venue rank lookup unavailable", error);
      }
    }
    if (changed || this.venueRankCacheDirty) {
      this.venueRankCacheDirty = false;
      await this.saveSettings();
      if (changed) this.refreshViews();
    }
  }

  async upgradeRepositoryVenueMetadata(limit = 1) {
    if (!this.settings.onlineMetadataLookup) return false;
    const provider = this.getGoogleScholarProvider();
    if (provider === "serpapi" && !this.settings.serpApiBackgroundLookup) return false;
    const staleBefore = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const candidates = this.settings.papers
      .filter((paper) => isRepositoryVenue(paper.venue) && isTitleSufficientForLookup(paper.title))
      .filter((paper) => {
        const checkedAt = Date.parse(paper.googleScholarVenueCheckedAt || "");
        return paper.googleScholarVenueProvider !== provider || !Number.isFinite(checkedAt) || checkedAt < staleBefore;
      })
      .sort((left, right) => Date.parse(right.addedAt || "") - Date.parse(left.addedAt || ""))
      .slice(0, Math.max(1, limit));
    let changed = false;
    for (const paper of candidates) {
      try {
        const metadata = await this.lookupGoogleScholar({
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          arxiv: paper.arxiv
        });
        paper.googleScholarVenueCheckedAt = new Date().toISOString();
        paper.googleScholarVenueProvider = provider;
        changed = true;
        if (!metadata || isRepositoryVenue(metadata.venue)) continue;
        paper.venue = metadata.venue;
        if (metadata.year) paper.year = metadata.year;
        paper.metadataSource = metadata.source || "Google Scholar";
        if (paper.metrics && isPreprintLikeType(paper.metrics.type)) delete paper.metrics;
      } catch (error) {
        console.warn(`Paper Library: Google Scholar venue check failed for ${paper.title}`, error);
      }
    }
    if (changed) {
      await this.saveSettings();
      this.refreshViews();
    }
    return changed;
  }

  getAutomaticVenueRanks(venue = "") {
    const name = String(venue || "").trim();
    if (!name) return [];
    const rule = this.findConferenceRankingRule(name) || findVenueRankingRule(name);
    return this.normalizeVenueRanks(rule?.ranks || []);
  }

  getPaperVenueRanks(paper = {}) {
    const manual = this.normalizeVenueRanks(paper.venueRanks);
    const manualSystems = new Set(manual.map(({ system }) => system.toLocaleLowerCase()));
    const automatic = this.getAutomaticVenueRanks(paper.venue)
      .filter(({ system }) => !manualSystems.has(system.toLocaleLowerCase()));
    return [...manual, ...automatic];
  }

  getVenueRankTone(rank = "", system = "") {
    if (/^IF(?:\s|$)/i.test(String(system || ""))) return "metric";
    if (/^(?:录用率(?:\s|$)|acceptance rate\b)/i.test(String(system || ""))) return "rate";
    const value = String(rank || "").replace(/\s+/g, "").toLocaleUpperCase();
    const values = value.split(/[\/,，;；|]+/);
    if (values.some((item) => ["A*", "A", "Q1", "1区"].includes(item))) return "top";
    if (values.some((item) => ["B", "Q2", "2区"].includes(item))) return "high";
    if (values.some((item) => ["C", "Q3", "3区"].includes(item))) return "mid";
    if (values.some((item) => ["Q4", "4区"].includes(item))) return "base";
    return "other";
  }

  refreshResearchPdfHighlights(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType(RESEARCH_VIEW_TYPE).forEach((leaf) => {
      if (typeof leaf.view?.refreshPdfHighlights === "function") leaf.view.refreshPdfHighlights(paper);
    });
    this.refreshNativePdfInkOverlays(paper);
    this.refreshNativePdfHighlightOverlays(paper);
    this.refreshNativePdfNoteOverlays(paper);
    this.refreshNativePdfTextBoxes(paper);
  }

  getDesktopPluginPath(relativePath = "") {
    if (this.isMobileApp()) throw new Error("此功能仅支持桌面端 Obsidian");
    const nodePath = require("path");
    const basePath = this.app.vault.adapter?.getBasePath?.() || this.app.vault.adapter?.basePath;
    if (!basePath) throw new Error("DocLayout-YOLO 仅支持本地桌面 Vault");
    const pluginDirectory = this.manifest?.dir || `.obsidian/plugins/obsidian-paper-library`;
    return nodePath.join(basePath, pluginDirectory, relativePath);
  }

  getDocLayoutPythonPath() {
    return this.getDesktopPluginPath(process.platform === "win32"
      ? ".doclayout-runtime/Scripts/python.exe"
      : ".doclayout-runtime/bin/python");
  }

  isDocLayoutRuntimeInstalled() {
    if (this.isMobileApp()) return false;
    try {
      const fs = require("fs");
      return [
        this.getDocLayoutPythonPath(),
        this.getDesktopPluginPath("doclayout_extract.py"),
        this.getDesktopPluginPath("models/doclayout_yolo_docstructbench_imgsz1024.onnx")
      ].every((path) => fs.existsSync(path));
    } catch (_) {
      return false;
    }
  }

  async resolveDocLayoutSystemPython() {
    if (this.isMobileApp()) throw new Error("DocLayout-YOLO 图片识别仅支持桌面端 Obsidian");
    const candidates = process.platform === "win32"
      ? ["python", "python3"]
      : [
          process.env.PAPERLIB_PYTHON,
          "/opt/homebrew/bin/python3",
          "/usr/local/bin/python3",
          "/usr/bin/python3",
          "python3"
        ];
    const tried = new Set();
    for (const candidate of candidates.filter(Boolean)) {
      if (tried.has(candidate)) continue;
      tried.add(candidate);
      try {
        await this.runDesktopProcess(candidate, ["--version"], { timeout: 15 * 1000 });
        return candidate;
      } catch (_) {}
    }
    throw new Error("没有找到可用的 Python 3，请先安装 Python 3 后重试");
  }

  hasDocLayoutRuntimeArtifacts() {
    if (this.isMobileApp()) return false;
    try {
      const fs = require("fs");
      return [
        ".doclayout-runtime",
        "models/doclayout_yolo_docstructbench_imgsz1024.onnx",
        "models/doclayout_yolo_docstructbench_imgsz1024.onnx.data",
        "models/doclayout_yolo_docstructbench_imgsz1024.pt",
        ".doclayout-cache",
        "figure-cache"
      ].some((path) => fs.existsSync(this.getDesktopPluginPath(path)));
    } catch (_) {
      return false;
    }
  }

  runDesktopProcess(command, args, options = {}) {
    if (this.isMobileApp()) return Promise.reject(new Error("此功能仅支持桌面端 Obsidian"));
    const { spawn } = require("child_process");
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const append = (stream, chunk) => {
        const value = chunk.toString();
        if (stream === "stdout") stdout = `${stdout}${value}`.slice(-12 * 1024 * 1024);
        else stderr = `${stderr}${value}`.slice(-12 * 1024 * 1024);
        options.onOutput?.(stream, value);
      };
      child.stdout?.on("data", (chunk) => append("stdout", chunk));
      child.stderr?.on("data", (chunk) => append("stderr", chunk));
      const timer = options.timeout ? window.setTimeout(() => {
        if (settled) return;
        child.kill("SIGTERM");
        settled = true;
        reject(new Error("本地进程运行超时"));
      }, options.timeout) : null;
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else {
          const details = String(stderr || stdout || `退出码 ${code}`).trim().split("\n").slice(-6).join(" ");
          reject(new Error(details || `本地进程退出码 ${code}`));
        }
      });
    });
  }

  async installDocLayoutRuntime(onProgress = () => {}) {
    if (this.isMobileApp()) throw new Error("DocLayout-YOLO 图片识别仅支持桌面端 Obsidian");
    if (this.isDocLayoutRuntimeInstalled()) {
      this.settings.enableFigureRecognition = true;
      await this.saveSettings();
      this.refreshViews();
      return;
    }
    if (this.figureRuntimeInstallPromise) return this.figureRuntimeInstallPromise;
    this.figureRuntimeInstallPromise = (async () => {
      const fs = require("fs");
      const nodePath = require("path");
      const runtimePath = this.getDesktopPluginPath(".doclayout-runtime");
      const modelsPath = this.getDesktopPluginPath("models");
      const modelPath = nodePath.join(modelsPath, "doclayout_yolo_docstructbench_imgsz1024.onnx");
      await fs.promises.mkdir(modelsPath, { recursive: true });
      onProgress("1/4 · 正在创建隔离运行时…");
      // A venv keeps an absolute link to the Python executable used to create
      // it. Xcode and Homebrew upgrades can remove that executable and leave a
      // seemingly installed, but unusable runtime behind. Rebuild only the
      // disposable runtime and resolve a currently executable Python instead
      // of hard-coding the Xcode command-line-tools path.
      const systemPython = await this.resolveDocLayoutSystemPython();
      await fs.promises.rm(runtimePath, { recursive: true, force: true });
      await this.runDesktopProcess(systemPython, ["-m", "venv", runtimePath], { timeout: 5 * 60 * 1000 });
      const pythonPath = this.getDocLayoutPythonPath();
      const installEnvironment = { ...process.env, PIP_NO_CACHE_DIR: "1", PYTHONUNBUFFERED: "1" };
      onProgress("2/4 · 正在更新安装工具…");
      await this.runDesktopProcess(pythonPath, ["-m", "pip", "install", "--no-cache-dir", "--upgrade", "pip"], {
        env: installEnvironment,
        timeout: 10 * 60 * 1000
      });
      onProgress("3/4 · 正在下载轻量 ONNX Runtime 与图片依赖…");
      await this.runDesktopProcess(pythonPath, [
        "-m", "pip", "install", "--no-cache-dir", "--upgrade",
        "onnxruntime", "PyMuPDF", "Pillow"
      ], {
        env: installEnvironment,
        timeout: 45 * 60 * 1000,
        onOutput: (_stream, chunk) => {
          const match = String(chunk).match(/Downloading\s+([^\s]+).*?\(([\d.]+\s*[kMGT]?B)\)/i);
          if (match) onProgress(`3/4 · 正在下载 ${match[1]} · ${match[2]}`);
        }
      });
      onProgress("4/4 · 正在下载 DocLayout-YOLO ONNX 模型（约 72 MB）…");
      const downloadCode = [
        "from urllib.request import urlretrieve",
        `urlretrieve('https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx?download=true', ${JSON.stringify(modelPath)})`
      ].join(";");
      await this.runDesktopProcess(pythonPath, ["-c", downloadCode], {
        env: installEnvironment,
        timeout: 20 * 60 * 1000
      });
      if (!fs.existsSync(modelPath)) throw new Error("模型下载完成后未找到模型文件");
      const modelDigest = await new Promise((resolve, reject) => {
        const hash = require("crypto").createHash("sha256");
        const stream = fs.createReadStream(modelPath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
      });
      if (modelDigest !== "fece9af02f618b603ff7921ccec6861d13e7e1f9830e091dfb7e8ad9311e5b21") {
        await fs.promises.rm(modelPath, { force: true });
        throw new Error("ONNX 模型完整性校验失败，请重试下载");
      }
      this.settings.enableFigureRecognition = true;
      await this.saveSettings();
      this.clearPdfFigureRecognitionState();
      this.refreshViews();
      onProgress("安装完成，图片识别已开启");
      new Notice("图片识别已开启");
    })();
    try {
      return await this.figureRuntimeInstallPromise;
    } catch (error) {
      this.settings.enableFigureRecognition = false;
      await this.saveSettings();
      throw error;
    } finally {
      this.figureRuntimeInstallPromise = null;
    }
  }

  clearPdfFigureRecognitionState(...args) {
    return clearPdfFigureRecognitionState(this, ...args);
  }

  async removeDocLayoutRuntime() {
    if (this.isMobileApp()) throw new Error("DocLayout-YOLO 运行时只能在桌面端管理");
    const fs = require("fs");
    const paths = [
      ".doclayout-runtime",
      "models/doclayout_yolo_docstructbench_imgsz1024.onnx",
      "models/doclayout_yolo_docstructbench_imgsz1024.onnx.data",
      "models/doclayout_yolo_docstructbench_imgsz1024.pt",
      ".doclayout-cache",
      "figure-cache",
      "metadata-cache"
    ].map((path) => this.getDesktopPluginPath(path));
    this.settings.enableFigureRecognition = false;
    await this.saveSettings();
    await Promise.all(paths.map((path) => fs.promises.rm(path, { recursive: true, force: true })));
    this.clearPdfFigureRecognitionState();
    this.refreshDetailViews();
    new Notice("已删除图片识别运行时、模型与缓存");
  }

  emitPdfFigureProgress(...args) {
    return emitPdfFigureProgress(this, ...args);
  }

  async runDocLayoutFigureExtraction(pdfPath, onProgress) {
    if (this.isMobileApp()) throw new Error("DocLayout-YOLO 图片识别仅支持桌面端 Obsidian");
    const fs = require("fs");
    const nodePath = require("path");
    const crypto = require("crypto");
    const file = this.app.vault.getAbstractFileByPath(pdfPath);
    if (!file) throw new Error("找不到 PDF 文件");
    const basePath = this.app.vault.adapter?.getBasePath?.() || this.app.vault.adapter?.basePath;
    if (!basePath) throw new Error("DocLayout-YOLO 仅支持本地桌面 Vault");
    const pythonPath = this.getDocLayoutPythonPath();
    const scriptPath = this.getDesktopPluginPath("doclayout_extract.py");
    const modelPath = this.getDesktopPluginPath("models/doclayout_yolo_docstructbench_imgsz1024.onnx");
    [pythonPath, scriptPath, modelPath].forEach((requiredPath) => {
      if (!fs.existsSync(requiredPath)) throw new Error(`缺少 DocLayout-YOLO 组件：${nodePath.basename(requiredPath)}`);
    });
    const sourcePath = nodePath.join(basePath, pdfPath);
    const cacheKey = crypto.createHash("sha1")
      .update(`${pdfPath}:${file.stat?.mtime || 0}:${file.stat?.size || 0}:doclayout-onnx-v1`)
      .digest("hex");
    const outputPath = this.getDesktopPluginPath(nodePath.join("figure-cache", cacheKey));
    const manifestPath = nodePath.join(outputPath, "figures.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const payload = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
        if (!Array.isArray(payload.figures)) throw new Error("图片索引格式无效");
        onProgress?.({ stage: "complete", current: payload.totalPages || payload.pageCount || 0, total: payload.totalPages || payload.pageCount || 0, figures: payload.figures.length, cached: true });
        return payload;
      } catch (error) {
        console.warn("Paper Library: damaged figure cache will be rebuilt", error);
        await fs.promises.rm(outputPath, { recursive: true, force: true });
      }
    }
    await fs.promises.mkdir(outputPath, { recursive: true });
    const environment = {
      ...process.env,
      MPLCONFIGDIR: this.getDesktopPluginPath(".doclayout-cache/matplotlib"),
      XDG_CACHE_HOME: this.getDesktopPluginPath(".doclayout-cache"),
      PYTHONUNBUFFERED: "1"
    };
    let progressBuffer = "";
    try {
      await this.runDesktopProcess(pythonPath, [
          scriptPath,
          "--pdf", sourcePath,
          "--model", modelPath,
          "--output", outputPath,
          "--dpi", "144",
          "--conf", "0.18"
        ], {
          env: environment,
          timeout: 20 * 60 * 1000,
          onOutput: (stream, chunk) => {
            if (stream !== "stdout") return;
            progressBuffer += chunk;
            const lines = progressBuffer.split("\n");
            progressBuffer = lines.pop() || "";
            lines.forEach((line) => {
              if (!line.startsWith("PAPERLIB_PROGRESS:")) return;
              try { onProgress?.(JSON.parse(line.slice("PAPERLIB_PROGRESS:".length))); } catch (_) {}
            });
          }
        });
      if (!fs.existsSync(manifestPath)) throw new Error("图片识别完成，但没有生成图片索引");
      const payload = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      if (!Array.isArray(payload.figures)) throw new Error("生成的图片索引格式无效");
      return payload;
    } catch (error) {
      await fs.promises.rm(outputPath, { recursive: true, force: true });
      console.error("Paper Library: ONNX figure extraction failed", error);
      const message = String(error?.message || error || "未知错误")
        .replace(/\s+/g, " ")
        .trim();
      throw new Error(`ONNX 图片识别失败：${message}`);
    }
  }

  async runDocLayoutTitleExtraction(pdfPath) {
    if (this.isMobileApp() || !this.isDocLayoutRuntimeInstalled()) return null;
    const fs = require("fs");
    const nodePath = require("path");
    const crypto = require("crypto");
    const path = normalizePath(pdfPath || "");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("找不到用于标题确认的 PDF 文件");
    const basePath = this.app.vault.adapter?.getBasePath?.() || this.app.vault.adapter?.basePath;
    if (!basePath) return null;
    const pythonPath = this.getDocLayoutPythonPath();
    const scriptPath = this.getDesktopPluginPath("doclayout_extract.py");
    const modelPath = this.getDesktopPluginPath("models/doclayout_yolo_docstructbench_imgsz1024.onnx");
    const sourcePath = nodePath.join(basePath, path);
    const cacheKey = crypto.createHash("sha1")
      .update(`${path}:${file.stat?.mtime || 0}:${file.stat?.size || 0}:doclayout-title-v2`)
      .digest("hex");
    const outputPath = this.getDesktopPluginPath(nodePath.join("metadata-cache", cacheKey));
    const manifestPath = nodePath.join(outputPath, "metadata.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const cached = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
        if (Array.isArray(cached.titleCandidates)) return cached;
      } catch (_) {
        await fs.promises.rm(outputPath, { recursive: true, force: true });
      }
    }
    await fs.promises.mkdir(outputPath, { recursive: true });
    const environment = {
      ...process.env,
      MPLCONFIGDIR: this.getDesktopPluginPath(".doclayout-cache/matplotlib"),
      XDG_CACHE_HOME: this.getDesktopPluginPath(".doclayout-cache"),
      PYTHONUNBUFFERED: "1"
    };
    try {
      await this.runDesktopProcess(pythonPath, [
        scriptPath,
        "--pdf", sourcePath,
        "--model", modelPath,
        "--output", outputPath,
        "--dpi", "144",
        "--conf", "0.18",
        "--metadata-only"
      ], { env: environment, timeout: 5 * 60 * 1000 });
      const payload = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      if (!Array.isArray(payload.titleCandidates)) throw new Error("DocLayout 标题索引格式无效");
      return payload;
    } catch (error) {
      await fs.promises.rm(outputPath, { recursive: true, force: true });
      throw error;
    }
  }

  async confirmPaperTitleWithDocLayout(paper, localMetadata = {}) {
    if (!paper?.pdfPath || this.isMobileApp() || !this.isDocLayoutRuntimeInstalled()) return null;
    const payload = await this.runDocLayoutTitleExtraction(paper.pdfPath);
    const baseTitle = String(localMetadata.title || paper.title || "").trim();
    const originalTitle = fileNameToTitle(paper.originalPdfName || "");
    const rawCandidates = (payload?.titleCandidates || []).map((candidate) => ({
      ...candidate,
      text: String(candidate.text || "").replace(/\s+/g, " ").trim()
    }));
    const candidates = rawCandidates.map((candidate) => {
      const text = String(candidate.text || "").replace(/\s+/g, " ").trim();
      if (this.isLowConfidencePdfTitle(text)) return null;
      const confidence = Number(candidate.confidence) || 0;
      const baseAgreement = titleSimilarity(text, baseTitle);
      const fileAgreement = this.isDescriptivePdfFileTitle(originalTitle)
        ? titleSimilarity(text, originalTitle)
        : 0;
      const containsCleanerCandidate = rawCandidates.some((other) => (
        other !== candidate
        && other.text.length >= 16
        && other.text.length < text.length * 0.82
        && normalizeTitleForMatch(text).includes(normalizeTitleForMatch(other.text))
        && !this.isLowConfidencePdfTitle(other.text)
      ));
      const score = confidence * 120 + baseAgreement * 95 + fileAgreement * 70
        + (Number(candidate.pageNumber) === 1 ? 10 : 0)
        + Math.min(text.length, 180) * 0.08 - (containsCleanerCandidate ? 48 : 0);
      return { ...candidate, text, confidence, baseAgreement, fileAgreement, score };
    }).filter(Boolean).sort((left, right) => right.score - left.score);
    const selected = candidates[0];
    if (!selected || selected.confidence < 0.2) return null;
    // When both the PDF text layer and original filename are reliable but the
    // layout region disagrees with both, keep the safer consensus.
    if (!this.isLowConfidencePdfTitle(baseTitle)
      && this.isDescriptivePdfFileTitle(originalTitle)
      && selected.baseAgreement < 0.42
      && selected.fileAgreement < 0.42
      && selected.confidence < 0.55) return null;
    return {
      title: selected.text,
      source: "DocLayout-YOLO",
      confidence: selected.confidence,
      pageNumber: Number(selected.pageNumber) || 1,
      candidates: candidates.slice(0, 5).map(({ text, confidence, pageNumber }) => ({ text, confidence, pageNumber }))
    };
  }

  getPortablePdfFigurePayload(...args) {
    return getPortablePdfFigurePayload(this, ...args);
  }

  sanitizePortablePdfFigurePayload(...args) {
    return sanitizePortablePdfFigurePayload(this, ...args);
  }

  setPortablePdfFigurePayload(...args) {
    return setPortablePdfFigurePayload(this, ...args);
  }

  computePdfFigureCacheKey(...args) {
    return computePdfFigureCacheKey(this, ...args);
  }

  getPluginVaultPath(relativePath = "") {
    let directory = String(this.manifest?.dir || ".obsidian/plugins/obsidian-paper-library");
    const configDir = String(this.app.vault.configDir || ".obsidian").replace(/^\/+|\/+$/g, "");
    const marker = `/${configDir}/`;
    if (directory.includes(marker)) directory = directory.slice(directory.lastIndexOf(marker) + 1);
    directory = directory.replace(/^\/+|\/+$/g, "");
    return normalizePath([directory, relativePath].filter(Boolean).join("/"));
  }

  readSyncedPdfFigurePayload(...args) {
    return readSyncedPdfFigurePayload(this, ...args);
  }

  async readPdfBinary(file) {
    try {
      return await this.app.vault.readBinary(file);
    } catch (error) {
      const permissionDenied = ["EPERM", "EACCES"].includes(error?.code)
        || /\b(?:EPERM|EACCES)\b/.test(String(error?.message || ""));
      if (!permissionDenied || typeof this.app.vault.getResourcePath !== "function"
        || typeof globalThis.fetch !== "function") throw error;
      // Obsidian's resource URL can remain readable when direct file access is denied.
      try {
        const resourcePath = this.app.vault.getResourcePath(file);
        if (!resourcePath) throw new Error("PDF 资源地址为空");
        const response = await globalThis.fetch(resourcePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.arrayBuffer();
      } catch (resourceError) {
        throw new Error(`${error.message || error}；Obsidian PDF 资源读取失败：${resourceError.message || resourceError}`, { cause: error });
      }
    }
  }

  loadPdfFigureDocument(...args) {
    return loadPdfFigureDocument(this, ...args);
  }

  createPdfFigureCatalog(...args) {
    return createPdfFigureCatalog(this, ...args);
  }

  resolveRecognizedPdfFigureCache(...args) {
    return resolveRecognizedPdfFigureCache(this, ...args);
  }

  readRecognizedPdfFigureAsset(...args) {
    return readRecognizedPdfFigureAsset(this, ...args);
  }

  createRecognizedPdfFigureDragPreview(...args) {
    return createRecognizedPdfFigureDragPreview(this, ...args);
  }

  installPdfFigureDragZones(...args) {
    return installPdfFigureDragZones(this, ...args);
  }

  pdfFigureDragToAIAttachment(...args) {
    return pdfFigureDragToAIAttachment(this, ...args);
  }

  migratePortablePdfFigureCatalogs(...args) {
    return migratePortablePdfFigureCatalogs(this, ...args);
  }

  getPdfFigureCatalog(...args) {
    return getPdfFigureCatalog(this, ...args);
  }

  openPdfFigureAtPoint(...args) {
    return openPdfFigureAtPoint(this, ...args);
  }

  openPdfFigureGallery(...args) {
    return openPdfFigureGallery(this, ...args);
  }

  renderPdfFigure(...args) {
    return renderPdfFigure(this, ...args);
  }

  exportPdfFigureHighResolution(...args) {
    return exportPdfFigureHighResolution(this, ...args);
  }

  paintDocLayoutFigure(...args) {
    return paintDocLayoutFigure(this, ...args);
  }

  async getPdfImageObject(page, objectId) {
    await page.getOperatorList();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      };
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`图像对象读取超时：${objectId}`));
      }, 10000);
      try {
        const immediate = page.objs.get(objectId, finish);
        if (immediate) finish(immediate);
      } catch (error) {
        window.clearTimeout(timer);
        reject(error);
      }
    });
  }

  paintPdfImageObject(...args) {
    return paintPdfImageObject(this, ...args);
  }

  renderPdfFigureCrop(...args) {
    return renderPdfFigureCrop(this, ...args);
  }

  handleNativePdfFigureClick(event, leaf, container) {
    const state = this.nativePdfStates.get(container);
    if (state?.mode || event.button !== 0 || event.defaultPrevented) return;
    if (event.target?.closest?.("button, a, .annotationLayer")) return;
    const selection = event.target?.ownerDocument?.defaultView?.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    const pageEl = event.target?.closest?.(".page[data-page-number], .page");
    if (!pageEl || !container.contains(pageEl)) return;
    const rect = pageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    if (!file || !pageNumber) return;
    const paper = this.getPaperForPdfFile(file);
    void this.openPdfFigureAtPoint(
      file.path,
      paper,
      pageNumber,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height
    );
  }

  ensureNativePdfFigureDragZones(leaf, container, state) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const path = normalizePath(file?.path || "");
    const paper = this.getPaperForPdfFile(file);
    if (!path || (!this.settings.enableFigureRecognition && !this.getPortablePdfFigurePayload(path))) {
      container?.querySelectorAll?.(".paperlib-pdf-figure-drag-zone")?.forEach?.((zone) => zone.remove());
      return;
    }
    const cached = this.pdfFigureCatalogCache.get(path);
    if (cached) {
      this.installPdfFigureDragZones(container, path, paper, cached);
      return;
    }
    if (state.figureDragLoadingPath === path) return;
    state.figureDragLoadingPath = path;
    void this.getPdfFigureCatalog(path)
      .then((catalog) => {
        const currentFile = leaf?.view?.file || this.app.workspace.getActiveFile();
        if (normalizePath(currentFile?.path || "") !== path || !container.isConnected) return;
        this.installPdfFigureDragZones(container, path, paper, catalog);
      })
      .catch((error) => console.warn("Paper Library: native PDF image drag unavailable", error))
      .finally(() => {
        if (state.figureDragLoadingPath === path) state.figureDragLoadingPath = "";
      });
  }

  setupNativePdfToolbar() {
    const mount = () => {
      if (this.nativePdfMountTimer) window.clearTimeout(this.nativePdfMountTimer);
      this.nativePdfMountTimer = window.setTimeout(() => {
        this.nativePdfMountTimer = null;
        this.mountNativePdfToolbars();
      }, 60);
    };
    if (this.app.workspace?.on && this.registerEvent) {
      this.registerEvent(this.app.workspace.on("layout-change", mount));
      this.registerEvent(this.app.workspace.on("active-leaf-change", mount));
      // 离开某个 PDF 视图时，把它积累的待写回批注批量写入（重载发生在看不见的时候）
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
        const activePath = normalizePath(this.app.workspace.getActiveFile?.()?.path || "");
        void this.flushPdfAnnotationSyncs((mark) => normalizePath(mark.pdfPath || "") !== activePath);
      }));
    }
    this.nativePdfToolbarObserver = new MutationObserver(mount);
    this.nativePdfToolbarObserver.observe(document.body, { childList: true, subtree: true });
    if (this.register) this.register(() => this.nativePdfToolbarObserver?.disconnect());
    mount();
  }

  mountNativePdfToolbars() {
    const leaves = this.app.workspace?.getLeavesOfType?.("pdf") || [];
    leaves.forEach((leaf) => {
      const container = leaf.view?.containerEl;
      const toolbar = container?.querySelector?.(".pdf-toolbar");
      if (!container || !toolbar) return;
      const existingGroup = container.querySelector(".paperlib-native-pdf-tools");
      if (existingGroup) {
        const existingState = this.nativePdfStates.get(container) || {
          mode: "", highlightColor: String(this.settings.defaultHighlightColor || "yellow").toLocaleLowerCase(), inkColor: "yellow", inkWidth: 4, paletteOpen: false, busy: false
        };
        existingState.highlightColor ||= existingState.color || "yellow";
        existingState.inkColor ||= existingState.color || "yellow";
        existingState.paletteOpen = Boolean(existingState.paletteOpen);
        this.nativePdfStates.set(container, existingState);
        const existingInk = existingGroup.querySelector(".paperlib-native-pdf-tool.is-ink");
        if (existingInk && !existingInk.querySelector("svg.lucide-pencil")) setPaperlibIcon(existingInk, "pencil");
        ["is-highlighter", "is-ink"].forEach((toolClass) => {
          const tool = existingGroup.querySelector(`.paperlib-native-pdf-tool.${toolClass}`);
          if (tool && !tool.querySelector(".paperlib-native-pdf-color-bar")) {
            const colorBar = document.createElement("span");
            colorBar.className = "paperlib-native-pdf-color-bar";
            colorBar.setAttribute("aria-hidden", "true");
            tool.appendChild(colorBar);
          }
        });
        this.updateNativePdfToolbarState(container, existingGroup, existingState);
        this.renderNativePdfInkOverlays(leaf, container);
        void this.renderNativePdfHighlightOverlays(leaf, container);
        void this.renderNativePdfNoteOverlays(leaf, container);
        this.renderNativePdfTextBoxes(leaf, container);
        this.ensureNativePdfFigureDragZones(leaf, container, existingState);
        return;
      }
      container.classList.add("paperlib-native-pdf-host");
      const state = this.nativePdfStates.get(container) || {
        mode: "", highlightColor: String(this.settings.defaultHighlightColor || "yellow").toLocaleLowerCase(), inkColor: "yellow", inkWidth: 4, paletteOpen: false, busy: false
      };
      state.highlightColor ||= state.color || "yellow";
      state.inkColor ||= state.color || "yellow";
      state.inkWidth ||= 4;
      state.paletteOpen = Boolean(state.paletteOpen);
      this.nativePdfStates.set(container, state);
      const group = document.createElement("div");
      group.className = "paperlib-native-pdf-tools";
      group.setAttribute("aria-label", "Paper Library PDF 标注工具");
      const select = document.createElement("button");
      select.className = "clickable-icon paperlib-native-pdf-tool is-select";
      select.title = "鼠标 / 选择";
      select.setAttribute("aria-label", "鼠标 / 选择");
      setPaperlibIcon(select, "mouse-pointer-2");
      group.appendChild(select);
      const highlight = document.createElement("button");
      highlight.className = "clickable-icon paperlib-native-pdf-tool is-highlighter";
      highlight.title = "Paper Library 荧光笔";
      highlight.setAttribute("aria-label", "荧光笔");
      setPaperlibIcon(highlight, "highlighter");
      const highlightColorBar = document.createElement("span");
      highlightColorBar.className = "paperlib-native-pdf-color-bar";
      highlightColorBar.setAttribute("aria-hidden", "true");
      highlight.appendChild(highlightColorBar);
      group.appendChild(highlight);
      const underline = document.createElement("button");
      underline.className = "clickable-icon paperlib-native-pdf-tool is-underline";
      underline.title = "Paper Library 下划线";
      underline.setAttribute("aria-label", "下划线");
      setPaperlibIcon(underline, "underline");
      group.appendChild(underline);
      const palette = document.createElement("div");
      palette.className = "paperlib-native-pdf-palette";
      const colorsColumn = document.createElement("div");
      colorsColumn.className = "paperlib-native-pdf-colors";
      palette.appendChild(colorsColumn);
      CANVAS_HIGHLIGHT_COLORS.forEach((color) => {
        const swatch = document.createElement("button");
        swatch.className = "paperlib-native-pdf-swatch";
        swatch.title = color.label;
        swatch.setAttribute("aria-label", `${color.label}荧光笔`);
        swatch.dataset.color = color.id;
        swatch.style.setProperty("--swatch-color", color.value);
        swatch.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (state.mode === "ink") state.inkColor = color.id;
          else state.highlightColor = color.id;
          if (!["highlight", "ink"].includes(state.mode)) state.mode = "highlight";
          state.paletteOpen = false;
          this.updateNativePdfToolbarState(container, group, state);
        });
        colorsColumn.appendChild(swatch);
      });
      const widths = document.createElement("div");
      widths.className = "paperlib-native-pdf-widths";
      [1.5, 2.5, 4, 6, 8].forEach((width) => {
        const button = document.createElement("button");
        button.className = "paperlib-native-pdf-width";
        button.dataset.width = String(width);
        button.title = width <= 1.5 ? "极细" : width <= 2.5 ? "细" : width <= 4 ? "中" : width <= 6 ? "粗" : "极粗";
        button.setAttribute("aria-label", `画笔粗细：${button.title}`);
        const dot = document.createElement("span");
        dot.style.width = `${width + 2}px`;
        dot.style.height = `${width + 2}px`;
        button.appendChild(dot);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.inkWidth = width;
          this.updateNativePdfToolbarState(container, group, state);
        });
        widths.appendChild(button);
      });
      palette.appendChild(widths);
      group.appendChild(palette);
      const ink = document.createElement("button");
      ink.className = "clickable-icon paperlib-native-pdf-tool is-ink";
      ink.title = "Paper Library 自由画笔";
      ink.setAttribute("aria-label", "自由画笔");
      setPaperlibIcon(ink, "pencil");
      const inkColorBar = document.createElement("span");
      inkColorBar.className = "paperlib-native-pdf-color-bar";
      inkColorBar.setAttribute("aria-hidden", "true");
      ink.appendChild(inkColorBar);
      group.appendChild(ink);
      const note = document.createElement("button");
      note.className = "clickable-icon paperlib-native-pdf-tool is-note";
      note.title = "Paper Library 注释";
      note.setAttribute("aria-label", "注释" );
      setPaperlibIcon(note, "message-square-text");
      group.appendChild(note);
      const askRegion = document.createElement("button");
      askRegion.className = "clickable-icon paperlib-native-pdf-tool is-ai-region";
      askRegion.title = "圈选区域 Ask AI";
      askRegion.setAttribute("aria-label", "圈选区域 Ask AI");
      setPaperlibIcon(askRegion, "scan");
      group.appendChild(askRegion);
      const eraser = document.createElement("button");
      eraser.className = "clickable-icon paperlib-native-pdf-tool is-eraser";
      eraser.title = "橡皮：拖过标注以删除";
      eraser.setAttribute("aria-label", "橡皮");
      setPaperlibIcon(eraser, "eraser");
      group.appendChild(eraser);
      const clearAll = document.createElement("button");
      clearAll.className = "clickable-icon paperlib-native-pdf-tool is-clear-annotations";
      clearAll.title = "清空本文所有标注";
      clearAll.setAttribute("aria-label", "清空所有标注");
      setPaperlibIcon(clearAll, "trash-2");
      group.appendChild(clearAll);
      const annotations = document.createElement("button");
      annotations.className = "clickable-icon paperlib-native-pdf-tool is-annotations";
      annotations.title = "查看本文所有标注";
      annotations.setAttribute("aria-label", "查看标注列表");
      setPaperlibIcon(annotations, "notebook-pen");
      group.appendChild(annotations);
      annotations.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        if (!file) return new Notice("当前没有打开 PDF");
        const paper = this.getPaperForPdfFile(file);
        if (!paper) return new Notice("请先把这个文档加入论文库");
        new PdfAnnotationsModal(this.app, this, paper, file.path).open();
      });
      const figures = document.createElement("button");
      figures.className = "clickable-icon paperlib-native-pdf-tool is-figures";
      figures.title = "浏览 PDF 中的所有图片";
      figures.setAttribute("aria-label", "浏览所有图片");
      setPaperlibIcon(figures, "images");
      group.appendChild(figures);
      eraser.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = state.mode === "eraser" ? "" : "eraser";
        state.paletteOpen = false;
        state.erasing = null;
        this.updateNativePdfToolbarState(container, group, state);
      });
      clearAll.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        if (!file) return new Notice("当前没有打开 PDF");
        const paper = this.getPaperForPdfFile(file);
        if (!paper) return new Notice("请先把这个文档加入论文库");
        const path = normalizePath(file.path);
        const workspace = this.ensureResearchWorkspace(paper);
        const highlightCount = (workspace.highlights || []).filter((mark) => (
          normalizePath(mark.pdfPath || paper.pdfPath || "") === path
        )).length;
        const annotationCount = (paper.annotations || []).filter((mark) => (
          normalizePath(mark.pdfPath || paper.pdfPath || "") === path
          && (mark.pdfSubtype === "FreeText" ? Boolean(mark.box) : Array.isArray(mark.pdfRects) && mark.pdfRects.length)
        )).length;
        const total = highlightCount + annotationCount;
        if (!total) return new Notice("本文没有标注");
        new ClearAnnotationsModal(this.app, this, paper, path, total).open();
      });
      select.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = "";
        state.paletteOpen = false;
        this.updateNativePdfToolbarState(container, group, state);
      });
      highlight.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "highlight";
        state.mode = "highlight";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      underline.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "underline";
        state.mode = "underline";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      ink.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const wasActive = state.mode === "ink";
        state.mode = "ink";
        state.paletteOpen = wasActive ? !state.paletteOpen : true;
        this.updateNativePdfToolbarState(container, group, state);
      });
      note.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = state.mode === "note" ? "" : "note";
        state.paletteOpen = false;
        this.updateNativePdfToolbarState(container, group, state);
      });
      const textbox = document.createElement("button");
      textbox.className = "clickable-icon paperlib-native-pdf-tool is-textbox";
      textbox.title = "文本框：点击页面任意位置插入";
      textbox.setAttribute("aria-label", "插入文本框");
      setPaperlibIcon(textbox, "square-pen");
      group.appendChild(textbox);
      textbox.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = state.mode === "textbox" ? "" : "textbox";
        state.paletteOpen = false;
        this.updateNativePdfToolbarState(container, group, state);
      });
      askRegion.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.mode = state.mode === "ai-region" ? "" : "ai-region";
        state.paletteOpen = false;
        this.updateNativePdfToolbarState(container, group, state);
      });
      figures.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        if (!file) return new Notice("当前没有打开 PDF");
        void this.openPdfFigureGallery(file.path, this.getPaperForPdfFile(file));
      });
      container.appendChild(group);
      this.updateNativePdfToolbarState(container, group, state);
      this.renderNativePdfInkOverlays(leaf, container, true);
      void this.renderNativePdfHighlightOverlays(leaf, container, true);
      void this.renderNativePdfNoteOverlays(leaf, container, true);
      this.renderNativePdfTextBoxes(leaf, container, true);
      this.ensureNativePdfFigureDragZones(leaf, container, state);
      if (!this.nativePdfBindings.has(container)) {
        const pointerDown = (event) => {
          const active = this.nativePdfStates.get(container);
          if (active?.busy) return;
          const pageEl = event.target?.closest?.(".page[data-page-number], .page");
          if (event.button === 2 && pageEl && container.contains(pageEl)) {
            const file = leaf.view?.file || this.app.workspace.getActiveFile();
            const paper = this.getPaperForPdfFile(file);
            const page = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
            const stroke = file && paper
              ? this.findPdfInkStrokeAtEvent(event, pageEl, paper, file.path, page)
              : null;
            const canvas = pageEl.querySelector(".canvasWrapper canvas, canvas");
            if (stroke && canvas) this.schedulePdfInkRegionDrag(event, {
              canvas,
              pageEl,
              paper,
              path: file.path,
              page,
              stroke,
              title: paper.title || file.basename || file.name
            });
            return;
          }
          if (active?.mode === "textbox") {
            const file = leaf.view?.file || this.app.workspace.getActiveFile();
            const paper = file ? this.getPaperForPdfFile(file) : null;
            if (pageEl && paper && container.contains(pageEl)) {
              event.preventDefault();
              event.stopPropagation();
              const bounds = pageEl.getBoundingClientRect();
              if (bounds.width > 0 && bounds.height > 0) {
                const box = {
                  x: Math.max(0, Math.min(0.94, (event.clientX - bounds.left) / bounds.width)),
                  y: Math.max(0, Math.min(0.97, (event.clientY - bounds.top) / bounds.height)),
                  width: 0.32
                };
                const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
                void this.createPdfTextBox(paper, file, pageNumber, box);
              }
            }
            return;
          }
          if (active?.mode === "eraser") {
            if (pageEl && container.contains(pageEl)) {
              active.erasing = { highlights: new Map(), strokes: new Map() };
              void this.collectNativePdfEraseTargets(event, leaf, container, active);
            }
            return;
          }
          if (active?.mode === "ink") {
            if (pageEl && container.contains(pageEl)) this.beginNativePdfInkStroke(event, leaf, container, pageEl, active);
            return;
          }
          if (active?.mode === "ai-region") {
            if (pageEl && container.contains(pageEl)) this.beginNativePdfAIRegion(event, leaf, container, pageEl);
            return;
          }
          if (!active?.mode) this.scheduleNativePdfSelectionDrag(event, leaf, container);
        };
        const pointerUp = (event) => {
          const active = this.nativePdfStates.get(container);
          // 空模式（纯选择）也要放行：选中文字后弹出颜色标注条
          if (!["highlight", "note", "underline", "eraser", ""].includes(active?.mode ?? "") || active.busy) return;
          void this.handleNativePdfPointerUp(event, leaf, container, active);
        };
        const contextMenu = (event) => {
          void this.handleNativePdfContextMenu(event, leaf, container);
        };
        const dragStart = (event) => this.handleNativePdfSelectionDrag(event, leaf, container);
        const click = (event) => this.handleNativePdfFigureClick(event, leaf, container);
        // 滚动时记录阅读页码（防抖落盘），供下次打开恢复
        const scroll = (event) => {
          const file = leaf.view?.file;
          const paper = this.getPaperForPdfFile(file);
          if (!paper) return;
          const scroller = event.target;
          const bounds = scroller?.getBoundingClientRect?.();
          if (!bounds) return;
          const probe = bounds.top + 40;
          let current = 0;
          container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
            const rect = pageEl.getBoundingClientRect?.();
            if (rect && rect.top <= probe) {
              current = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number")) || current;
            }
          });
          if (current) this.recordPdfReadingPosition(paper, current);
        };
        container.addEventListener("pointerdown", pointerDown, true);
        container.addEventListener("pointerup", pointerUp, true);
        container.addEventListener("contextmenu", contextMenu, true);
        container.addEventListener("dragstart", dragStart, true);
        container.addEventListener("click", click, true);
        container.addEventListener("scroll", scroll, true);
        const pointerMove = (event) => {
          const active = this.nativePdfStates.get(container);
          if (active?.mode === "eraser" && active.erasing) {
            void this.collectNativePdfEraseTargets(event, leaf, container, active);
          }
        };
        container.addEventListener("pointermove", pointerMove, true);
        const binding = { container, pointerDown, pointerUp, contextMenu, dragStart, click, scroll, pointerMove };
        this.nativePdfBindings.set(container, binding);
        this.nativePdfBindingList.push(binding);
      }
    });
  }

  handleNativePdfSelectionDrag(event, leaf, container) {
    const textLayer = event.target?.closest?.(".textLayer");
    const transfer = event.dataTransfer;
    if (!textLayer || !container.contains(textLayer) || !transfer) return;
    const selection = textLayer.ownerDocument.defaultView?.getSelection?.();
    const selectionElement = (node) => node?.nodeType === 3 ? node.parentElement : node;
    if (!textLayer.contains(selectionElement(selection?.anchorNode))
      || !textLayer.contains(selectionElement(selection?.focusNode))) return;
    const text = String(selection?.toString?.() || "").replace(/\s+/g, " ").trim().slice(0, 8000);
    if (!text) return;
    const pageEl = textLayer.closest(".page[data-page-number], .page");
    const page = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number")) || null;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    if (!file?.path) return;
    const paper = this.getPaperForPdfFile(file);
    const payload = {
      text,
      path: file.path,
      page,
      label: `${paper?.title || file.basename || file.name} · 第 ${page || "—"} 页选区`
    };
    transfer.setData("application/x-paperlib-pdf-selection", JSON.stringify(payload));
    transfer.setData("text/plain", text);
    transfer.effectAllowed = "copy";
  }

  getNativePdfSelectionDragContext(event, leaf, container) {
    const textLayer = event.target?.closest?.(".textLayer");
    if (!textLayer || !container.contains(textLayer)) return null;
    const selection = textLayer.ownerDocument.defaultView?.getSelection?.();
    const selectionElement = (node) => node?.nodeType === 3 ? node.parentElement : node;
    if (!selection?.rangeCount || selection.isCollapsed
      || !textLayer.contains(selectionElement(selection.anchorNode))
      || !textLayer.contains(selectionElement(selection.focusNode))) return null;
    const text = String(selection.toString?.() || "").replace(/\s+/g, " ").trim().slice(0, 8000);
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const targetSpan = event.target?.closest?.("span");
    if (!targetSpan || !textLayer.contains(targetSpan)) return null;
    try { if (!range.intersectsNode(targetSpan)) return null; } catch (_) { return null; }
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5);
    if (rects.length && !rects.some((rect) => (
      event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3
      && event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3
    ))) return null;
    const pageEl = textLayer.closest(".page[data-page-number], .page");
    const page = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number")) || null;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    if (!file?.path) return null;
    const paper = this.getPaperForPdfFile(file);
    const sourceRect = rects.length ? {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom))
    } : { left: event.clientX, top: event.clientY, right: event.clientX + 120, bottom: event.clientY + 20 };
    sourceRect.width = sourceRect.right - sourceRect.left;
    sourceRect.height = sourceRect.bottom - sourceRect.top;
    return {
      text,
      path: file.path,
      page,
      title: paper?.title || file.basename || file.name || "文档",
      label: `${paper?.title || file.basename || file.name} · 第 ${page || "—"} 页选区`,
      sourceRect,
      selection
    };
  }

  scheduleNativePdfSelectionDrag(event, leaf, container) {
    if (event.button !== 0) return;
    const context = this.getNativePdfSelectionDragContext(event, leaf, container);
    if (!context) return;
    this.nativeSelectionDragCleanup?.(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 8) return;
      moveEvent.preventDefault();
      cleanup(false);
      this.beginNativePdfSelectionPointerDrag(moveEvent, context);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (this.nativeSelectionDragCleanup === cleanup) this.nativeSelectionDragCleanup = null;
    };
    const up = () => cleanup(true);
    this.nativeSelectionDragCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  }

  beginNativePdfSelectionPointerDrag(event, context) {
    const ghost = document.createElement("div");
    ghost.className = "paperlib-excerpt-drag-ghost";
    const echo = document.createElement("div");
    echo.className = "paperlib-excerpt-drag-echo";
    const echoText = document.createElement("span");
    echoText.textContent = truncate(context.text, 150);
    echo.appendChild(echoText);
    ghost.appendChild(echo);
    const card = document.createElement("div");
    card.className = "paperlib-excerpt-drag-card";
    const icon = document.createElement("span");
    icon.className = "paperlib-excerpt-drag-icon";
    setPaperlibIcon(icon, "text-quote");
    card.appendChild(icon);
    const content = document.createElement("div");
    content.className = "paperlib-excerpt-drag-content";
    const strong = document.createElement("strong");
    strong.textContent = `摘录 · 第 ${context.page || "—"} 页`;
    const summary = document.createElement("span");
    summary.textContent = truncate(context.text, 120);
    content.append(strong, summary);
    card.appendChild(content);
    ghost.appendChild(card);
    document.body.appendChild(ghost);
    const sourceRect = context.sourceRect;
    const startWidth = Math.min(380, Math.max(84, Number(sourceRect.width) || 120));
    const startHeight = Math.min(58, Math.max(20, Number(sourceRect.height) || 20));
    Object.assign(ghost.style, {
      left: `${sourceRect.left}px`, top: `${sourceRect.top}px`,
      width: `${startWidth}px`, height: `${startHeight}px`
    });
    ghost.style.setProperty("--paperlib-drag-progress", "0");
    ghost.style.setProperty("--paperlib-drag-card-scale", "0.92");
    this.nativeSelectionDrag = {
      context, ghost, startX: event.clientX, startY: event.clientY,
      sourceRect, startWidth, startHeight
    };
    const move = (moveEvent) => this.moveNativePdfSelectionGhost(moveEvent);
    const cleanup = (cancel = false, upEvent = null) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
      if (this.nativeSelectionDragCleanup === cleanup) this.nativeSelectionDragCleanup = null;
      this.finishNativePdfSelectionPointerDrag(upEvent, cancel);
    };
    const up = (upEvent) => cleanup(false, upEvent);
    const cancelDrag = () => cleanup(true, null);
    this.nativeSelectionDragCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    window.requestAnimationFrame(() => ghost.classList.add("is-visible"));
    this.moveNativePdfSelectionGhost(event);
  }

  moveNativePdfSelectionGhost(event) {
    const drag = this.nativeSelectionDrag;
    if (!drag) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const linear = Math.min(1, Math.max(0, (distance - 4) / 150));
    const progress = linear * linear * (3 - 2 * linear);
    const left = drag.sourceRect.left + (event.clientX + 18 - drag.sourceRect.left) * progress;
    const top = drag.sourceRect.top + (event.clientY + 16 - drag.sourceRect.top) * progress;
    drag.ghost.style.left = `${left}px`;
    drag.ghost.style.top = `${top}px`;
    drag.ghost.style.width = `${drag.startWidth + (286 - drag.startWidth) * progress}px`;
    drag.ghost.style.height = `${drag.startHeight + (88 - drag.startHeight) * progress}px`;
    drag.ghost.style.setProperty("--paperlib-drag-progress", progress.toFixed(3));
    drag.ghost.style.setProperty("--paperlib-drag-card-scale", (0.92 + progress * 0.08).toFixed(3));
    drag.ghost.classList.toggle("is-card", progress > 0.58);
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.classList.remove("paperlib-paper-composer-drag-over"));
    aiTarget?.classList.add("paperlib-paper-composer-drag-over");
    drag.ghost.classList.toggle("is-over-drop-target", Boolean(aiTarget && progress > 0.58));
  }

  finishNativePdfSelectionPointerDrag(event, cancel = false) {
    const drag = this.nativeSelectionDrag;
    this.nativeSelectionDrag = null;
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.classList.remove("paperlib-paper-composer-drag-over"));
    if (!drag) return;
    const dismiss = (className) => {
      drag.ghost.classList.add(className);
      window.setTimeout(() => drag.ghost.remove(), 180);
    };
    if (cancel || !event) return dismiss("is-cancelled");
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    if (!aiTarget) return dismiss("is-cancelled");
    dismiss("is-dropping");
    void this.addAIContext({
      type: "selection",
      label: drag.context.label,
      detail: `${drag.context.text.length} 字符`,
      text: drag.context.text,
      path: drag.context.path,
      page: drag.context.page,
      key: `pdf-selection:${drag.context.path}:${drag.context.page || ""}:${drag.context.text.slice(0, 120)}`
    });
    window.setTimeout(() => drag.context.selection?.removeAllRanges?.(), 0);
  }

  appendNativePdfInkPath(svg, stroke, pending = false) {
    if (!svg || !Array.isArray(stroke?.points)) return null;
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === stroke.color) || CANVAS_HIGHLIGHT_COLORS[0];
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `paperlib-pdf-ink-path${pending ? " is-pending" : ""}`);
    path.dataset.strokeId = stroke.id || "";
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color.value);
    path.setAttribute("stroke-width", String(Math.max(1.5, Number(stroke.width) || 3)));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    const points = stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points;
    path.setAttribute("d", points.map((point, index) => (
      `${index ? "L" : "M"} ${(Number(point.x) * 1000).toFixed(2)} ${(Number(point.y) * 1000).toFixed(2)}`
    )).join(" "));
    svg.appendChild(path);
    return path;
  }

  ensureNativePdfInkLayer(pageEl) {
    let svg = pageEl.querySelector(":scope > .paperlib-native-pdf-ink-layer");
    if (svg) return svg;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "paperlib-native-pdf-ink-layer");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    pageEl.appendChild(svg);
    return svg;
  }

  renderNativePdfInkOverlays(leaf, container, force = false) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) {
      container?.querySelectorAll?.(".paperlib-native-pdf-ink-layer")?.forEach?.((element) => element.remove());
      return;
    }
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
      if (!pageNumber) return;
      const strokes = this.getPdfInkStrokes(paper, file.path, pageNumber);
      const signature = strokes.map((stroke) => (
        `${stroke.id}:${stroke.color}:${stroke.width}:${stroke.points?.length || 0}:${stroke.points?.at?.(-1)?.x || 0}:${stroke.points?.at?.(-1)?.y || 0}`
      )).join("|");
      const existing = pageEl.querySelector(":scope > .paperlib-native-pdf-ink-layer");
      if (!force && existing?.dataset.signature === signature) return;
      const svg = existing || this.ensureNativePdfInkLayer(pageEl);
      svg.replaceChildren();
      svg.dataset.signature = signature;
      strokes.forEach((stroke) => this.appendNativePdfInkPath(svg, stroke));
    });
  }

  refreshNativePdfInkOverlays(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      this.renderNativePdfInkOverlays(leaf, container, true);
    });
  }

  getNativePdfPageSizes(file) {
    // 每个 PDF 的页面尺寸（PDF 点）只读一次并缓存，供原生视图高亮覆盖层换算坐标
    const path = normalizePath(file?.path || "");
    if (!path) return Promise.resolve(null);
    const cached = this.nativePdfPageSizeCache.get(path);
    if (cached) return cached;
    const promise = (async () => {
      const buffer = await this.readPdfBinary(file);
      const pdfjs = await loadPdfJs();
      const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
      try {
        const sizes = new Map();
        for (let pageNumber = 1; pageNumber <= (document.numPages || 0); pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          sizes.set(pageNumber, { width: viewport.width, height: viewport.height });
        }
        return sizes;
      } finally {
        await document.destroy?.();
      }
    })();
    this.nativePdfPageSizeCache.set(path, promise);
    promise.catch(() => this.nativePdfPageSizeCache.delete(path));
    return promise;
  }

  ensureNativePdfHighlightLayer(pageEl) {
    let layer = pageEl.querySelector(":scope > .paperlib-native-pdf-highlight-layer");
    if (layer?.tagName?.toLocaleLowerCase?.() === "svg") return layer;
    layer?.remove?.();
    layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.setAttribute("class", "paperlib-native-pdf-highlight-layer");
    layer.setAttribute("viewBox", "0 0 1000 1000");
    layer.setAttribute("preserveAspectRatio", "none");
    layer.setAttribute("aria-hidden", "true");
    if (this.nativeOverlayHidden) layer.style.display = "none";
    pageEl.appendChild(layer);
    return layer;
  }

  async renderNativePdfHighlightOverlays(leaf, container, force = false) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) {
      container?.querySelectorAll?.(".paperlib-native-pdf-highlight-layer")?.forEach?.((element) => element.remove());
      return;
    }
    const path = normalizePath(file.path);
    const workspace = this.ensureResearchWorkspace(paper);
    const sizes = await this.getNativePdfPageSizes(file);
    const ownAnnotations = await this.getNativePdfOwnAnnotations(file).catch(() => new Map());
    if (!sizes || !container.isConnected) return;
    this.hideOwnNativePdfAnnotations(container, ownAnnotations);
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
      const dims = sizes.get(pageNumber);
      if (!pageNumber || !dims?.width || !dims?.height) return;
      const pageAnnotations = ownAnnotations.get(Number(pageNumber)) || [];
      const marks = (workspace.highlights || []).filter((mark) => (
        normalizePath(mark.pdfPath || paper.pdfPath || "") === path
          && Number(mark.page) === pageNumber
          && Array.isArray(mark.pdfRects) && mark.pdfRects.length
      )).filter((mark) => {
        // 已写进文件的标注由 Obsidian 画在页面画布上；若仍有待写回变更（改色等）则继续用覆盖层
        const key = `${mark.pdfPath || paper.pdfPath || ""}|${mark.pdfAnnotationId || mark.id}`;
        if (this.pendingPdfAnnotationSyncs.has(key)) return true;
        const box = this.getPdfRectsUnion(mark.pdfRects);
        if (!box) return true;
        return !pageAnnotations.some((annotation) => this.pdfRectsClose(annotation.rect, box));
      });
      const signature = `svg1|${marks.map((mark) => `${mark.id}:${mark.color}`).join("|")}`;
      const existing = pageEl.querySelector(":scope > .paperlib-native-pdf-highlight-layer");
      if (!force && existing?.dataset.signature === signature) {
        return;
      }
      const layer = existing || this.ensureNativePdfHighlightLayer(pageEl);
      layer.replaceChildren();
      layer.dataset.signature = signature;
      marks.forEach((mark) => {
        const color = CANVAS_HIGHLIGHT_COLORS.find((item) => (
          item.id === String(mark.color || "").toLocaleLowerCase()
        )) || CANVAS_HIGHLIGHT_COLORS[0];
        // 每个标注画成一条 SVG 路径：同一路径内的重叠子区域只填充一次，
        // 无论选区矩形如何重叠都不会叠色（multiply 只作用于不同标注之间）
        const isUnderline = String(mark.pdfSubtype || "").toLocaleLowerCase() === "underline";
        const segments = [];
        if (isUnderline) {
          // 下划线：合并矩形后只画底部一条线
          const merged = this.mergePdfHighlightViewportRects(
            mark.pdfRects.map((item) => item?.rect).filter((rect) => Array.isArray(rect) && rect.length === 4)
          );
          merged.forEach((rect) => {
            const x1 = Math.min(rect[0], rect[2]) / dims.width * 1000;
            const x2 = Math.max(rect[0], rect[2]) / dims.width * 1000;
            const yBottom = (1 - Math.min(rect[1], rect[3]) / dims.height) * 1000;
            if (x2 - x1 < 0.05) return;
            segments.push(`M${x1.toFixed(2)} ${yBottom.toFixed(2)}H${x2.toFixed(2)}`);
          });
        } else {
          mark.pdfRects.forEach((item) => {
            const rect = item?.rect;
            if (!Array.isArray(rect) || rect.length !== 4) return;
            const x1 = Math.min(rect[0], rect[2]) / dims.width * 1000;
            const x2 = Math.max(rect[0], rect[2]) / dims.width * 1000;
            const yTop = (1 - Math.max(rect[1], rect[3]) / dims.height) * 1000;
            const yBottom = (1 - Math.min(rect[1], rect[3]) / dims.height) * 1000;
            if (x2 - x1 < 0.05 || yBottom - yTop < 0.05) return;
            segments.push(`M${x1.toFixed(2)} ${yTop.toFixed(2)}H${x2.toFixed(2)}V${yBottom.toFixed(2)}H${x1.toFixed(2)}Z`);
          });
        }
        if (!segments.length) return;
        const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pathEl.setAttribute("class", isUnderline ? "paperlib-native-pdf-highlight-path is-underline" : "paperlib-native-pdf-highlight-path");
        pathEl.dataset.markId = mark.id || "";
        pathEl.setAttribute("d", segments.join(""));
        if (isUnderline) {
          pathEl.setAttribute("fill", "none");
          pathEl.setAttribute("stroke", color.value);
          pathEl.setAttribute("stroke-width", "1.6");
          pathEl.setAttribute("vector-effect", "non-scaling-stroke");
        } else {
          pathEl.setAttribute("fill", color.value);
        }
        layer.appendChild(pathEl);
      });
    });
  }

  async getNativePdfOwnAnnotations(file) {
    // 返回 Map<pageNumber, Array<{ id, rect }>>：标题为 "Paper Library" 的注释即我们写入的。
    // Obsidian 的 PDF 查看器会把内嵌注释直接渲染进页面画布（DOM 无法隐藏），
    // 因此这里既用于隐藏 DOM 注释层，也用于避免覆盖层重复绘制。
    // 按文件路径 + mtime/size 缓存；写回修改文件后自动失效重读。
    if (!file?.path) return new Map();
    let stat = null;
    try {
      stat = await this.app.vault.adapter?.stat?.(file.path);
    } catch (error) {
      stat = null;
    }
    const key = `${file.path}|${stat?.mtime || 0}|${stat?.size || 0}`;
    const cached = this.nativeOwnAnnotationIdsCache;
    if (cached.key === key) return cached.annotations;
    const promise = (async () => {
      const buffer = await this.readPdfBinary(file);
      const pdfjs = await loadPdfJs();
      const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
      try {
        const annotations = new Map();
        for (let pageNumber = 1; pageNumber <= (document.numPages || 0); pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const items = await page.getAnnotations();
          const own = (items || [])
            .filter((annotation) => String(annotation?.titleObj?.str || annotation?.title || "") === "Paper Library")
            .map((annotation) => ({
              id: String(annotation.id),
              rect: Array.isArray(annotation.rect) ? annotation.rect.map((value) => Number(value) || 0) : []
            }));
          if (own.length) annotations.set(pageNumber, own);
        }
        return annotations;
      } finally {
        await document.destroy?.();
      }
    })();
    this.nativeOwnAnnotationIdsCache = { key, annotations: promise };
    promise.catch(() => {
      if (this.nativeOwnAnnotationIdsCache.annotations === promise) {
        this.nativeOwnAnnotationIdsCache = { key: "", annotations: Promise.resolve(new Map()) };
      }
    });
    return promise;
  }

  pdfRectsOverlapRatio(first, second) {
    const width = Math.min(first[2], second[2]) - Math.max(first[0], second[0]);
    const height = Math.min(first[3], second[3]) - Math.max(first[1], second[1]);
    if (width <= 0 || height <= 0) return 0;
    const intersection = width * height;
    const areaFirst = Math.max(0, first[2] - first[0]) * Math.max(0, first[3] - first[1]);
    const areaSecond = Math.max(0, second[2] - second[0]) * Math.max(0, second[3] - second[1]);
    const smaller = Math.min(areaFirst, areaSecond);
    return smaller > 0 ? intersection / smaller : 0;
  }

  getPdfRectsUnion(pdfRects) {
    const rects = (pdfRects || []).map((item) => item?.rect).filter((rect) => Array.isArray(rect) && rect.length === 4);
    if (!rects.length) return null;
    return [
      Math.min(...rects.map((rect) => Math.min(rect[0], rect[2]))),
      Math.min(...rects.map((rect) => Math.min(rect[1], rect[3]))),
      Math.max(...rects.map((rect) => Math.max(rect[0], rect[2]))),
      Math.max(...rects.map((rect) => Math.max(rect[1], rect[3])))
    ];
  }

  pdfRectsClose(first, second, tolerance = 3) {
    if (!Array.isArray(first) || first.length !== 4 || !Array.isArray(second) || second.length !== 4) return false;
    return first.every((value, index) => Math.abs(Number(value) - Number(second[index])) <= tolerance);
  }

  hideOwnNativePdfAnnotations(container, annotationsByPage) {
    // 写回后 PDF 注释层会渲染我们写入的内嵌高亮，与覆盖层叠加导致变深且不均匀。
    // 注释层不一定位于 .page 元素内部（Obsidian 的视图结构与 pdf.js 默认不同），
    // 因此在视图容器级别按注释 id 全局匹配隐藏；id 全局唯一，无需按页区分。
    const ids = new Set();
    for (const list of annotationsByPage?.values?.() || []) {
      for (const annotation of list) ids.add(String(annotation.id));
    }
    if (!ids.size) return;
    const elements = container?.querySelectorAll?.("[data-annotation-id]") || [];
    elements.forEach((element) => {
      const id = String(element.dataset?.annotationId || element.getAttribute?.("data-annotation-id") || "");
      element.classList?.toggle?.("paperlib-native-hidden-annotation", Boolean(id && ids.has(id)));
    });
  }

  refreshNativePdfHighlightOverlays(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      void this.renderNativePdfHighlightOverlays(leaf, container, true);
    });
  }

  async renderNativePdfNoteOverlays(leaf, container, force = false) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) {
      container?.querySelectorAll?.(".paperlib-native-pdf-note-layer")?.forEach?.((element) => element.remove());
      return;
    }
    const path = normalizePath(file.path);
    const notes = (paper.annotations || []).filter((mark) => (
      mark.pdfSubtype === "Text"
      && String(mark.comment || "").trim()
      && Array.isArray(mark.pdfRects) && mark.pdfRects.length
      && normalizePath(mark.pdfPath || paper.pdfPath || "") === path
    ));
    const sizes = await this.getNativePdfPageSizes(file).catch(() => null);
    if (!sizes || !container.isConnected) return;
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
      const dims = sizes.get(pageNumber);
      if (!pageNumber || !dims?.width || !dims?.height) return;
      const pageNotes = notes.filter((mark) => Number(mark.page) === pageNumber);
      const signature = pageNotes.map((mark) => `${mark.id}:${String(mark.comment || "").length}`).join("|");
      let layer = pageEl.querySelector(":scope > .paperlib-native-pdf-note-layer");
      if (!force && layer?.dataset.signature === signature) return;
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "paperlib-native-pdf-note-layer";
        pageEl.appendChild(layer);
      }
      layer.replaceChildren();
      layer.dataset.signature = signature;
      pageNotes.forEach((mark) => {
        this.appendPdfNoteBadge(layer, mark, (box) => ({
          left: `${Math.max(box[0], box[2]) / dims.width * 100}%`,
          top: `${(1 - Math.max(box[1], box[3]) / dims.height) * 100}%`
        }));
      });
    });
  }

  refreshNativePdfNoteOverlays(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      void this.renderNativePdfNoteOverlays(leaf, container, true);
    });
  }

  appendPdfNoteBadge(layer, mark, position) {
    const box = this.getPdfRectsUnion(mark.pdfRects);
    if (!box) return;
    const { left, top } = position(box);
    const badge = document.createElement("button");
    badge.className = "paperlib-pdf-note-badge";
    badge.type = "button";
    badge.title = String(mark.comment || "");
    badge.setAttribute("aria-label", `批注：${String(mark.comment || "")}`);
    badge.style.left = left;
    badge.style.top = top;
    const icon = document.createElement("span");
    icon.className = "paperlib-pdf-note-badge-icon";
    setPaperlibIcon(icon, "sticky-note");
    badge.appendChild(icon);
    const label = document.createElement("span");
    label.className = "paperlib-pdf-note-badge-text";
    label.textContent = truncate(String(mark.comment || ""), 48);
    badge.appendChild(label);
    const popup = document.createElement("div");
    popup.className = "paperlib-pdf-note-popup";
    popup.textContent = String(mark.comment || "");
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      badge.classList.toggle("is-open");
    });
    badge.addEventListener("pointerdown", (event) => event.stopPropagation());
    layer.appendChild(badge);
    layer.appendChild(popup);
  }

  renderNativePdfTextBoxes(leaf, container, force = false) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) {
      container?.querySelectorAll?.(".paperlib-native-pdf-textbox-layer")?.forEach?.((element) => element.remove());
      return;
    }
    const path = normalizePath(file.path);
    const boxes = (paper.annotations || []).filter((mark) => (
      mark.pdfSubtype === "FreeText"
      && mark.box
      && normalizePath(mark.pdfPath || paper.pdfPath || "") === path
    ));
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
      if (!pageNumber) return;
      const pageBoxes = boxes.filter((mark) => Number(mark.page) === pageNumber);
      const signature = pageBoxes.map((mark) => (
        `${mark.id}:${Number(mark.box.x).toFixed(4)}:${Number(mark.box.y).toFixed(4)}:${Number(mark.box.width || 0.32).toFixed(4)}:${String(mark.comment || "").length}`
      )).join("|");
      let layer = pageEl.querySelector(":scope > .paperlib-native-pdf-textbox-layer");
      if (!force && layer?.dataset.signature === signature) return;
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "paperlib-native-pdf-textbox-layer";
        pageEl.appendChild(layer);
      }
      layer.replaceChildren();
      layer.dataset.signature = signature;
      pageBoxes.forEach((mark) => this.appendPdfTextBoxCard(layer, mark, paper, pageEl));
    });
  }

  refreshNativePdfTextBoxes(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      this.renderNativePdfTextBoxes(leaf, container, true);
    });
  }

  appendPdfTextBoxCard(layer, mark, paper, pageEl) {
    const box = mark.box || { x: 0.6, y: 0.3, width: 0.32 };
    const card = document.createElement("div");
    card.className = "paperlib-pdf-textbox-card";
    card.dataset.markId = mark.id;
    card.style.left = `${Math.max(0, Math.min(0.94, Number(box.x) || 0)) * 100}%`;
    card.style.top = `${Math.max(0, Math.min(0.97, Number(box.y) || 0)) * 100}%`;
    card.style.width = `${Math.max(0.08, Math.min(1, Number(box.width) || 0.32)) * 100}%`;
    const header = document.createElement("div");
    header.className = "paperlib-pdf-textbox-header";
    const grip = document.createElement("span");
    grip.className = "paperlib-pdf-textbox-grip";
    grip.title = "拖动移动";
    setPaperlibIcon(grip, "grip-vertical");
    header.appendChild(grip);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "paperlib-pdf-textbox-delete";
    remove.title = "删除文本框";
    remove.setAttribute("aria-label", "删除文本框");
    setPaperlibIcon(remove, "trash-2");
    header.appendChild(remove);
    card.appendChild(header);
    const content = document.createElement("div");
    content.className = "paperlib-pdf-textbox-content";
    content.setAttribute("contenteditable", "plaintext-only");
    content.spellcheck = false;
    content.textContent = mark.comment || "";
    card.appendChild(content);

    content.addEventListener("pointerdown", (event) => event.stopPropagation());
    content.addEventListener("contextmenu", (event) => event.stopPropagation());
    content.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        content.blur();
      }
    });
    content.addEventListener("blur", () => {
      const value = content.textContent || "";
      const trimmed = value.trim();
      if (!trimmed && !String(mark.comment || "").trim()) {
        void this.deletePdfTextBox(paper, mark);
        return;
      }
      if (trimmed === String(mark.comment || "").trim()) return;
      void this.updatePdfTextBox(paper, mark.id, { comment: value });
    });

    const startDrag = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      content.blur();
      const pageRect = pageEl.getBoundingClientRect();
      if (!pageRect.width || !pageRect.height) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const startBox = { ...box, width: Number(box.width) || 0.32 };
      let moved = false;
      const move = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        if (!moved && Math.hypot(deltaX, deltaY) < 3) return;
        moved = true;
        const x = Math.max(0, Math.min(1 - startBox.width, startBox.x + deltaX / pageRect.width));
        const y = Math.max(0, Math.min(0.97, startBox.y + deltaY / pageRect.height));
        card.style.left = `${x * 100}%`;
        card.style.top = `${y * 100}%`;
        card.dataset.dragX = String(x);
        card.dataset.dragY = String(y);
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        if (!moved) return;
        const x = Number(card.dataset.dragX || startBox.x);
        const y = Number(card.dataset.dragY || startBox.y);
        void this.updatePdfTextBox(paper, mark.id, { box: { ...startBox, x, y } });
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    header.addEventListener("pointerdown", startDrag);
    grip.addEventListener("pointerdown", startDrag);

    remove.addEventListener("pointerdown", (event) => event.stopPropagation());
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.deletePdfTextBox(paper, mark);
    });
    card.addEventListener("pointerdown", (event) => event.stopPropagation());
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      new Menu().addItem((item) => item
        .setTitle("删除文本框")
        .setIcon("trash-2")
        .onClick(() => { void this.deletePdfTextBox(paper, mark); }))
        .showAtMouseEvent(event);
    });
    layer.appendChild(card);
  }

  async createPdfTextBox(paper, file, pageNumber, box) {
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
      color: "yellow",
      pdfSubtype: "FreeText",
      box: { x: box.x, y: box.y, width: box.width || 0.32 },
      pdfRects: [],
      pdfPath: file.path,
      createdAt: new Date().toISOString()
    };
    paper.annotations = Array.isArray(paper.annotations) ? paper.annotations : [];
    paper.annotations.push(mark);
    await this.saveSettings();
    await this.syncLocalPdfAnnotation(mark);
    this.refreshNativePdfTextBoxes(paper);
    const card = this.app.workspace.getLeavesOfType?.("pdf")?.find((leaf) => leaf.view?.file?.path === file.path)
      ?.view?.containerEl?.querySelector?.(`.paperlib-pdf-textbox-card[data-mark-id="${id}"] .paperlib-pdf-textbox-content`);
    card?.focus?.();
    return mark;
  }

  async updatePdfTextBox(paper, markId, changes = {}) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return false;
    const mark = (paper.annotations || []).find((item) => item.id === markId && item.pdfSubtype === "FreeText");
    if (!mark) return false;
    if (typeof changes.comment === "string") mark.comment = changes.comment;
    if (changes.box) mark.box = { ...(mark.box || {}), ...changes.box };
    mark.updatedAt = new Date().toISOString();
    await this.saveSettings();
    await this.syncLocalPdfAnnotation(mark);
    await this.upsertPdfTextBoxNoteEntry(paper, mark);
    this.refreshNativePdfTextBoxes(paper);
    return true;
  }

  async deletePdfTextBox(paper, mark) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !mark) return;
    await this.deletePdfMark(paper, { record: mark, source: "paper-annotation" });
    await this.removePdfTextBoxNoteEntry(paper, mark);
    this.refreshNativePdfTextBoxes(paper);
  }

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
  }

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
  }

  recordPdfReadingPosition(paper, page) {
    // 打开时的定位/钉回顶部属于程序性滚动，抑制记录，避免覆盖真实阅读位置
    if (Date.now() < this.nativePdfPositionSuppressUntil) return;
    const id = paper?.id;
    const value = Math.max(1, Number(page) || 0);
    if (!id || !value) return;
    this.paperReadingPositions.set(id, value);
    if (this.paperReadingPositionTimer) clearTimeout(this.paperReadingPositionTimer);
    this.paperReadingPositionTimer = setTimeout(() => {
      this.paperReadingPositionTimer = null;
      this.persistPaperReadingPositions();
    }, 2000);
  }

  persistPaperReadingPositions() {
    if (this.paperReadingPositionTimer) {
      clearTimeout(this.paperReadingPositionTimer);
      this.paperReadingPositionTimer = null;
    }
    if (!this.paperReadingPositions.size) return;
    let changed = false;
    for (const [paperId, page] of this.paperReadingPositions) {
      const stored = this.settings.papers?.find((item) => item.id === paperId);
      if (!stored) continue;
      if (Number(stored.readingPosition?.page) !== page) {
        stored.readingPosition = { page, updatedAt: new Date().toISOString() };
        changed = true;
      }
    }
    this.paperReadingPositions.clear();
    if (changed) {
      void this.saveSettings().catch((error) => (
        console.warn("Paper Library: reading position save unavailable", error)
      ));
    }
  }

  async restoreNativePdfReadingPosition(file, paper) {
    if (!file?.path) return;
    if (this.settings.pdfOpenPosition === "first") {
      await this.pinNativePdfToFirstPage(file);
      return;
    }
    const target = Math.max(1, Number(paper?.readingPosition?.page) || 0);
    if (target <= 1) return;
    await this.scrollNativePdfToPage(file, target);
  }

  findNativePdfPageElement(file, page) {
    const leaves = this.app.workspace.getLeavesOfType?.("pdf")?.filter((leaf) => leaf.view?.file?.path === file?.path) || [];
    const active = this.app.workspace.activeLeaf;
    const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
    return leaf?.view?.containerEl?.querySelector?.(`.page[data-page-number="${page}"]`) || null;
  }

  findNativePdfScroller(pageEl) {
    for (let element = pageEl?.parentElement; element; element = element.parentElement) {
      try {
        const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
        if (style && /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
      } catch (error) { /* 忽略跨文档样式查询失败 */ }
    }
    return pageEl?.parentElement || null;
  }

  async pinNativePdfToFirstPage(file) {
    // Obsidian 会恢复文件上次的滚动位置，且恢复时机可能晚于 openFile（大 PDF 加载完成后才恢复）。
    // 在约 5 秒内持续检查并纠正；检测到用户交互（点击/滚轮/按键）后立即停止，避免和用户抢滚动。
    let interacting = false;
    let boundContainer = null;
    const markInteractive = () => { interacting = true; };
    const bind = (container) => {
      if (!container || container === boundContainer) return;
      boundContainer = container;
      container.addEventListener("pointerdown", markInteractive, true);
      container.addEventListener("wheel", markInteractive, { capture: true, passive: true });
      container.addEventListener("keydown", markInteractive, true);
    };
    try {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        if (interacting) return false;
        const pageEl = this.findNativePdfPageElement(file, 1);
        if (pageEl) {
          bind(pageEl.closest?.(".pdf-viewer, .pdf-container") || pageEl.parentElement);
          const scroller = this.findNativePdfScroller(pageEl);
          const pageTop = pageEl.getBoundingClientRect?.().top ?? 0;
          const scrollerTop = scroller?.getBoundingClientRect?.().top ?? 0;
          if (pageTop > scrollerTop + 48) pageEl.scrollIntoView?.({ block: "start" });
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      boundContainer?.removeEventListener?.("pointerdown", markInteractive, true);
      boundContainer?.removeEventListener?.("wheel", markInteractive, { capture: true });
      boundContainer?.removeEventListener?.("keydown", markInteractive, true);
    }
    return true;
  }

  async scrollNativePdfToPage(file, page) {
    const target = Math.max(1, Number(page) || 0);
    if (!file?.path || !target) return false;
    // 原生视图是连续滚动 + 全页占位符：等占位符出现后定位，未渲染的远页也能滚到
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const leaves = this.app.workspace.getLeavesOfType?.("pdf")?.filter((leaf) => leaf.view?.file?.path === file.path) || [];
      const active = this.app.workspace.activeLeaf;
      const leaf = leaves.find((item) => item === active) || leaves[leaves.length - 1];
      const pageEl = leaf?.view?.containerEl?.querySelector?.(`.page[data-page-number="${target}"]`);
      if (pageEl) {
        pageEl.scrollIntoView?.({ block: "start" });
        return true;
      }
      if (!leaves.length && attempt === 0) {
        await this.app.workspace.getLeaf("tab").openFile(file);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return false;
  }

  async openNativePdfAtPage(paper, page) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(paper?.pdfPath || ""));
    if (!file || file.extension?.toLocaleLowerCase() !== "pdf") return false;
    const existing = this.app.workspace.getLeavesOfType("pdf").find((leaf) => leaf.view?.file?.path === file.path);
    if (existing) this.app.workspace.setActiveLeaf?.(existing, { focus: true });
    else await this.app.workspace.getLeaf("tab").openFile(file);
    return this.scrollNativePdfToPage(file, page);
  }

  beginNativePdfInkStroke(event, leaf, container, pageEl, state) {
    if (event.button !== 0) return;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) return new Notice("请先把这个文档加入论文库");
    const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    const bounds = pageEl.getBoundingClientRect();
    if (!pageNumber || !bounds.width || !bounds.height) return;
    event.preventDefault();
    event.stopPropagation();
    this.nativeInkDrawingCleanup?.(true);
    state.busy = true;
    const points = [];
    const stroke = {
      id: workspaceId("ink"), type: "ink", page: pageNumber,
      pdfPath: file.path, color: state.inkColor || state.color || "yellow", width: Number(state.inkWidth) || 4, points
    };
    const svg = this.ensureNativePdfInkLayer(pageEl);
    const path = this.appendNativePdfInkPath(svg, stroke, true);
    let pathData = "";
    const addPoint = (pointer) => {
      const point = {
        x: Math.max(0, Math.min(1, (pointer.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (pointer.clientY - bounds.top) / bounds.height))
      };
      const previous = points[points.length - 1];
      if (previous && Math.hypot((point.x - previous.x) * bounds.width, (point.y - previous.y) * bounds.height) < 1.1) return false;
      points.push(point);
      const x = (point.x * 1000).toFixed(2);
      const y = (point.y * 1000).toFixed(2);
      pathData = points.length === 1 ? `M ${x} ${y} L ${x} ${y}` : `${pathData} L ${x} ${y}`;
      return true;
    };
    addPoint(event);
    path?.setAttribute("d", pathData);
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const samples = moveEvent.getCoalescedEvents?.() || [moveEvent];
      let changed = false;
      samples.forEach((sample) => { changed = addPoint(sample) || changed; });
      if (changed) path?.setAttribute("d", pathData);
    };
    const cleanup = (cancel = false) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelStroke, true);
      if (this.nativeInkDrawingCleanup === cleanup) this.nativeInkDrawingCleanup = null;
      state.busy = false;
      if (cancel || !points.length) {
        path?.remove();
        return;
      }
      path?.classList.remove("is-pending");
      void this.savePdfInkStroke(paper, stroke);
    };
    const up = (upEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      if (addPoint(upEvent)) path?.setAttribute("d", pathData);
      cleanup(false);
    };
    const cancelStroke = () => cleanup(true);
    this.nativeInkDrawingCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelStroke, true);
  }

  beginNativePdfAIRegion(event, leaf, container, pageEl) {
    if (event.button !== 0) return;
    const canvas = pageEl.querySelector(".canvasWrapper canvas, canvas");
    if (!canvas?.width || !canvas?.height) return new Notice("当前 PDF 页面尚未渲染完成");
    event.preventDefault();
    event.stopPropagation();
    this.nativeAiRegionCleanup?.();
    const state = this.nativePdfStates.get(container);
    if (state) state.busy = true;
    const bounds = pageEl.getBoundingClientRect();
    const localWidth = pageEl.offsetWidth || bounds.width;
    const localHeight = pageEl.offsetHeight || bounds.height;
    const point = (pointer) => ({
      x: Math.max(0, Math.min(localWidth, (pointer.clientX - bounds.left) * localWidth / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(localHeight, (pointer.clientY - bounds.top) * localHeight / Math.max(1, bounds.height)))
    });
    const start = point(event);
    const overlay = document.createElement("div");
    overlay.className = "paperlib-ai-region-selection";
    pageEl.appendChild(overlay);
    const update = (pointer) => {
      const current = point(pointer);
      const region = {
        left: Math.min(start.x, current.x),
        top: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y)
      };
      Object.assign(overlay.style, {
        left: `${region.left}px`, top: `${region.top}px`,
        width: `${region.width}px`, height: `${region.height}px`
      });
      return region;
    };
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      update(moveEvent);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      overlay.remove();
      if (state) state.busy = false;
      if (this.nativeAiRegionCleanup === cleanup) this.nativeAiRegionCleanup = null;
    };
    const cancel = () => cleanup();
    const up = (upEvent) => {
      upEvent.preventDefault();
      upEvent.stopPropagation();
      const region = update(upEvent);
      cleanup();
      if (region.width < 10 || region.height < 10) return;
      try {
        const canvasBounds = canvas.getBoundingClientRect();
        const canvasLeft = (canvasBounds.left - bounds.left) * localWidth / Math.max(1, bounds.width);
        const canvasTop = (canvasBounds.top - bounds.top) * localHeight / Math.max(1, bounds.height);
        const canvasLocalWidth = canvasBounds.width * localWidth / Math.max(1, bounds.width);
        const canvasLocalHeight = canvasBounds.height * localHeight / Math.max(1, bounds.height);
        const clipped = {
          left: Math.max(canvasLeft, region.left),
          top: Math.max(canvasTop, region.top),
          right: Math.min(canvasLeft + canvasLocalWidth, region.left + region.width),
          bottom: Math.min(canvasTop + canvasLocalHeight, region.top + region.height)
        };
        if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) throw new Error("圈选区域不在 PDF 页面内");
        const scaleX = canvas.width / Math.max(1, canvasLocalWidth);
        const scaleY = canvas.height / Math.max(1, canvasLocalHeight);
        const sourceX = Math.floor((clipped.left - canvasLeft) * scaleX);
        const sourceY = Math.floor((clipped.top - canvasTop) * scaleY);
        const sourceWidth = Math.max(1, Math.ceil((clipped.right - clipped.left) * scaleX));
        const sourceHeight = Math.max(1, Math.ceil((clipped.bottom - clipped.top) * scaleY));
        const outputScale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
        const crop = document.createElement("canvas");
        crop.width = Math.max(1, Math.round(sourceWidth * outputScale));
        crop.height = Math.max(1, Math.round(sourceHeight * outputScale));
        const context = crop.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, crop.width, crop.height);
        context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);
        const file = leaf.view?.file || this.app.workspace.getActiveFile();
        const paper = this.getPaperForPdfFile(file);
        const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number")) || 1;
        void this.addAIContext({
          type: "image",
          label: `${paper?.title || file?.basename || "PDF"} · 第 ${pageNumber} 页圈选区域`,
          detail: `${crop.width} × ${crop.height}`,
          dataUrl: crop.toDataURL("image/png"),
          mime: "image/png",
          path: file?.path || "",
          page: pageNumber,
          key: `native-pdf-region:${file?.path || ""}:${pageNumber}:${Math.round(region.left)}:${Math.round(region.top)}:${Math.round(region.width)}:${Math.round(region.height)}`
        }, { draft: "请分析我圈选的 PDF 区域：说明图表或公式表达了什么，并结合论文语境解释。" });
      } catch (error) {
        console.error("Paper Library: native PDF region capture failed", error);
        new Notice(`圈选区域失败：${error.message || error}`);
      }
    };
    this.nativeAiRegionCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    update(event);
  }

  updateNativePdfToolbarState(container, group, state) {
    state.highlightColor ||= state.color || "yellow";
    state.inkColor ||= state.color || "yellow";
    const highlightColor = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === state.highlightColor) || CANVAS_HIGHLIGHT_COLORS[0];
    const inkColor = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === state.inkColor) || CANVAS_HIGHLIGHT_COLORS[0];
    const paletteColor = state.mode === "ink" ? inkColor : highlightColor;
    group.style.setProperty("--paperlib-native-highlight", highlightColor.value);
    container.style.setProperty("--paperlib-native-highlight", highlightColor.value);
    container.style.setProperty("--paperlib-native-highlighter-cursor", highlighterCursor(highlightColor.value));
    group.querySelector(".is-highlighter")?.style.setProperty("--tool-highlight-color", highlightColor.value);
    group.querySelector(".is-ink")?.style.setProperty("--tool-highlight-color", inkColor.value);
    group.querySelector(".is-select")?.classList.toggle("is-active", !state.mode);
    group.querySelector(".is-highlighter")?.classList.toggle("is-active", state.mode === "highlight");
    group.querySelector(".is-underline")?.classList.toggle("is-active", state.mode === "underline");
    group.querySelector(".is-ink")?.classList.toggle("is-active", state.mode === "ink");
    group.querySelector(".is-note")?.classList.toggle("is-active", state.mode === "note");
    group.querySelector(".is-textbox")?.classList.toggle("is-active", state.mode === "textbox");
    group.querySelector(".is-ai-region")?.classList.toggle("is-active", state.mode === "ai-region");
    group.querySelector(".is-eraser")?.classList.toggle("is-active", state.mode === "eraser");
    group.querySelectorAll(".paperlib-native-pdf-width").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.width) === Number(state.inkWidth || 3));
    });
    group.querySelector(".paperlib-native-pdf-palette")?.classList.toggle(
      "is-visible", Boolean(state.paletteOpen && ["highlight", "ink", "underline"].includes(state.mode))
    );
    group.querySelectorAll(".paperlib-native-pdf-swatch").forEach((swatch) => {
      swatch.classList.toggle("is-active", swatch.dataset.color === paletteColor.id);
    });
    container.classList.toggle("paperlib-native-highlight-mode", state.mode === "highlight");
    container.classList.toggle("paperlib-native-underline-mode", state.mode === "underline");
    container.classList.toggle("paperlib-native-textbox-mode", state.mode === "textbox");
    container.classList.toggle("paperlib-native-ink-mode", state.mode === "ink");
    container.classList.toggle("paperlib-native-note-mode", state.mode === "note");
    container.classList.toggle("paperlib-native-ai-region-mode", state.mode === "ai-region");
    container.classList.toggle("paperlib-native-eraser-mode", state.mode === "eraser");
  }

  showNativePdfSelectionToolbar(leaf, textLayer) {
    this.dismissNativePdfSelectionToolbar();
    const doc = textLayer.ownerDocument;
    const owner = doc.defaultView;
    const selection = owner?.getSelection?.();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return;
    if (!String(selection.toString()).trim()) return;
    const selectedRange = selection.getRangeAt(0).cloneRange();
    const toolbar = doc.body.createDiv({
      cls: "paperlib-pdf-selection-toolbar",
      attr: { role: "toolbar", "aria-label": "选中文字的高亮颜色" }
    });
    toolbar.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    CANVAS_HIGHLIGHT_COLORS.forEach((color) => {
      const button = toolbar.createEl("button", {
        cls: "paperlib-pdf-selection-color",
        attr: { type: "button", "aria-label": `用${color.label}高亮`, title: `${color.label}高亮` }
      });
      button.dataset.color = color.id;
      button.style.setProperty("--swatch-color", color.value);
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!toolbar.isConnected) return;
        try {
          // 先算选区上下文（依赖当前 selection），再清除选区和弹条
          const context = await this.getNativePdfSelectionContext(leaf, textLayer);
          this.dismissNativePdfSelectionToolbar();
          selection.removeAllRanges();
          if (context?.text) await this.saveCanvasHighlight(context, color.id);
        } catch (error) {
          this.dismissNativePdfSelectionToolbar();
          console.error("Paper Library: failed to highlight PDF selection", error);
          new Notice(`高亮失败：${error.message || error}`);
        }
      });
    });
    toolbar.createDiv({ cls: "paperlib-pdf-selection-divider" });
    const addAction = (icon, label, draft) => {
      const button = toolbar.createEl("button", {
        cls: "paperlib-pdf-selection-action",
        attr: { type: "button", "aria-label": label, title: label }
      });
      setPaperlibIcon(button, icon);
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!toolbar.isConnected) return;
        try {
          const context = await this.getNativePdfSelectionContext(leaf, textLayer);
          this.dismissNativePdfSelectionToolbar();
          selection.removeAllRanges();
          if (!context?.text) return;
          const file = leaf.view?.file || this.app.workspace.getActiveFile();
          const paper = this.getPaperForPdfFile(file);
          await this.addAIContext({
            type: "selection",
            label: `${paper?.title || file?.basename || "PDF"} · 第 ${context.page} 页选区`,
            detail: `${context.text.length} 字符`,
            text: context.text,
            path: context.pdfPath || file?.path || "",
            page: context.page,
            key: `pdf-selection:${context.pdfPath || file?.path || ""}:${context.page}:${context.text.slice(0, 120)}`
          }, { draft });
        } catch (error) {
          this.dismissNativePdfSelectionToolbar();
          console.error("Paper Library: failed to send PDF selection to composer", error);
          new Notice(`发送失败：${error.message || error}`);
        }
      });
    };
    addAction("sparkles", "解释", "Explain this passage from the paper in clear terms.");
    addAction("languages", "翻译", "Translate this passage into Chinese.");
    const popup = toolbar.getBoundingClientRect();
    const rect = selectedRange.getBoundingClientRect();
    const viewport = owner.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || owner.innerWidth);
    const bottom = top + (viewport?.height || owner.innerHeight);
    const x = Math.min(right - popup.width - 8, Math.max(left + 8, (rect.left + rect.right - popup.width) / 2));
    const y = rect.top - popup.height - 8 >= top + 8 ? rect.top - popup.height - 8 : rect.bottom + 8;
    toolbar.style.left = `${Math.max(left + 8, x)}px`;
    toolbar.style.top = `${Math.max(top + 8, Math.min(bottom - popup.height - 8, y))}px`;
    const dismiss = () => this.dismissNativePdfSelectionToolbar();
    const outside = (event) => { if (!toolbar.contains(event.target)) dismiss(); };
    const keydown = (event) => {
      if (event.key === "Escape" || event.metaKey || event.ctrlKey) { dismiss(); return; }
      // 数字键 1-5 快速选择对应颜色
      const index = Number.parseInt(event.key, 10) - 1;
      if (Number.isInteger(index) && index >= 0 && index < CANVAS_HIGHLIGHT_COLORS.length) {
        event.preventDefault();
        event.stopPropagation();
        toolbar.querySelectorAll(".paperlib-pdf-selection-color")[index]?.click();
      }
    };
    const selectionChanged = () => {
      if (!selection.rangeCount || selection.isCollapsed) { dismiss(); return; }
      const range = selection.getRangeAt(0);
      if (range.compareBoundaryPoints(0, selectedRange) || range.compareBoundaryPoints(2, selectedRange)) dismiss();
    };
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", keydown, true);
    doc.addEventListener("selectionchange", selectionChanged);
    owner.addEventListener("scroll", dismiss, true);
    owner.addEventListener("resize", dismiss);
    owner.addEventListener("blur", dismiss);
    viewport?.addEventListener("resize", dismiss);
    viewport?.addEventListener("scroll", dismiss);
    const leafChange = this.app.workspace?.on?.("active-leaf-change", dismiss);
    this.nativeSelectionToolbarCleanup = () => {
      toolbar.remove();
      doc.removeEventListener("pointerdown", outside, true);
      doc.removeEventListener("keydown", keydown, true);
      doc.removeEventListener("selectionchange", selectionChanged);
      owner.removeEventListener("scroll", dismiss, true);
      owner.removeEventListener("resize", dismiss);
      owner.removeEventListener("blur", dismiss);
      viewport?.removeEventListener("resize", dismiss);
      viewport?.removeEventListener("scroll", dismiss);
      if (leafChange) this.app.workspace.offref(leafChange);
      this.nativeSelectionToolbarCleanup = null;
    };
  }

  dismissNativePdfSelectionToolbar() {
    this.nativeSelectionToolbarCleanup?.();
  }

  async handleNativePdfPointerUp(event, leaf, container, state) {
    if (state.mode === "eraser") {
      await this.finishNativePdfErase(leaf, container, state);
      return;
    }
    const textLayer = event.target?.closest?.(".textLayer");
    if (!textLayer || !container.contains(textLayer)) return;
    // 纯选择（无工具激活）：弹出颜色标注条，等用户点颜色后再保存
    if (!state.mode) {
      const tryShow = () => {
        const selection = textLayer.ownerDocument?.defaultView?.getSelection?.();
        if (selection && !selection.isCollapsed && String(selection.toString()).trim()) {
          this.showNativePdfSelectionToolbar(leaf, textLayer);
          return true;
        }
        return false;
      };
      if (!tryShow()) {
        // 双击选词由浏览器在 pointerup 之后应用，延迟一拍再检查
        setTimeout(() => {
          if (!tryShow()) this.dismissNativePdfSelectionToolbar();
        }, 60);
      }
      return;
    }
    state.busy = true;
    try {
      const context = await this.getNativePdfSelectionContext(leaf, textLayer);
      if (!context) return;
      if (state.mode === "highlight") {
        await this.saveCanvasHighlight(context, state.highlightColor || state.color || "yellow");
      } else if (state.mode === "underline") {
        await this.saveCanvasHighlight(context, state.highlightColor || state.color || "yellow", { pdfSubtype: "Underline" });
      } else if (state.mode === "note") {
        new NativePdfAnnotationModal(this.app, this, context, state.highlightColor || state.color || "yellow").open();
      }
      textLayer.ownerDocument.defaultView?.getSelection?.()?.removeAllRanges?.();
    } catch (error) {
      console.error("Paper Library: native PDF annotation failed", error);
      new Notice(`PDF 标注失败：${error.message || error}`);
    } finally {
      state.busy = false;
    }
  }

  async handleNativePdfContextMenu(event, leaf, container) {
    if (this.consumePdfInkDragContextMenu(event)) return;
    const activeSelection = event.target?.ownerDocument?.defaultView?.getSelection?.();
    const directPage = event.target?.closest?.(".page[data-page-number], .page");
    const directPageNumber = Number(directPage?.dataset?.pageNumber || directPage?.getAttribute?.("data-page-number"));
    const directFile = leaf.view?.file || this.app.workspace.getActiveFile();
    const directPaper = this.getPaperForPdfFile(directFile);
    const selectedValue = String(activeSelection?.toString?.() || "").trim();
    const inkStroke = !selectedValue && directPage && container.contains(directPage) && directFile && directPaper
      ? this.findPdfInkStrokeAtEvent(event, directPage, directPaper, directFile.path, directPageNumber)
      : null;
    if (inkStroke) {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      const canvas = directPage.querySelector(".canvasWrapper canvas, canvas");
      if (canvas) menu.addItem((item) => item
        .setTitle("作为图片添加到 Paper Composer")
        .setIcon("image")
        .onClick(() => this.addPdfInkRegionToComposer({
          canvas,
          pageEl: directPage,
          paper: directPaper,
          path: directFile.path,
          page: directPageNumber,
          stroke: inkStroke,
          title: directPaper.title || directFile.basename || directFile.name
        })));
      if (canvas) menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("删除此画笔标注")
        .setIcon("eraser")
        .onClick(() => this.removePdfInkStroke(directPaper, inkStroke.id)));
      menu.showAtMouseEvent(event);
      return;
    }
    const selectionElement = activeSelection?.anchorNode?.nodeType === 3
      ? activeSelection.anchorNode.parentElement
      : activeSelection?.anchorNode;
    const textLayer = event.target?.closest?.(".textLayer") || selectionElement?.closest?.(".textLayer");
    if (textLayer && container.contains(textLayer)) {
      const pageEl = textLayer.closest(".page[data-page-number], .page");
      const pageNumber = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
      const file = leaf.view?.file || this.app.workspace.getActiveFile();
      const paper = this.getPaperForPdfFile(file);
      const targetSpan = event.target?.closest?.("span");
      const spans = this.getNativePdfTextSpans(textLayer);
      const textIndex = spans.indexOf(targetSpan);
      const marks = file && paper && pageNumber && textIndex >= 0
        ? this.getPdfMarkEntriesAtTextIndex(paper, file.path, pageNumber, textIndex)
        : [];
      const selectedText = String(textLayer.ownerDocument.defaultView?.getSelection?.()?.toString?.() || "").trim();
      if (selectedText) {
        event.preventDefault();
        event.stopPropagation();
        try {
          const context = await this.getNativePdfSelectionContext(leaf, textLayer, { requirePaper: false });
          if (!context) return;
          const menu = new Menu();
          menu.addItem((item) => item
            .setTitle("Ask AI")
            .setIcon("sparkles")
            .onClick(() => this.addAIContext({
              type: "selection",
              label: `${context.paper.title} · 第 ${context.page} 页选区`,
              detail: `${context.text.length} 字符`,
              text: context.text,
              path: context.pdfPath || "",
              page: context.page,
              key: `pdf-selection:${context.pdfPath || ""}:${context.page}:${context.text.slice(0, 120)}`
            }, { draft: "请解释这段 PDF 文字，并结合论文上下文回答。" })));
          menu.showAtMouseEvent(event);
        } catch (error) {
          new Notice(`无法读取 PDF 选区：${error.message || error}`);
        }
        return;
      }
      if (marks.length) {
        event.preventDefault();
        event.stopPropagation();
        this.showNativePdfMarkDeleteMenu(event, paper, marks);
        return;
      }
    }
    // 注释层元素被我们隐藏后无法作为右键目标：按库内标注的几何位置命中，
    // 保证右键高亮区域始终能弹出删除菜单
    if (directPage && directFile && directPaper && container.contains(directPage)) {
      const hits = await this.findNativePdfMarksAtEvent(event, directPage, directPaper, directFile);
      if (hits.length) {
        event.preventDefault();
        event.stopPropagation();
        this.showNativePdfMarkDeleteMenu(event, directPaper, hits);
        return;
      }
    }
    const annotationEl = event.target?.closest?.(
      ".annotationLayer [data-annotation-id], .annotationLayer section, .annotationLayer .highlightAnnotation, .annotationLayer .textAnnotation"
    );
    if (!annotationEl || !container.contains(annotationEl)) return;
    const pageEl = annotationEl.closest(".page[data-page-number], .page");
    const pageNumber = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file || !paper || !pageNumber) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const annotation = await this.getNativePdfAnnotationData(file, pageNumber, annotationEl);
      if (!annotation || String(annotation.titleObj?.str || annotation.title || "") !== "Paper Library") return;
      const entries = this.getPdfMarkEntries(paper, file.path)
        .filter(({ record }) => Number(record.page) === pageNumber && Array.isArray(record.pdfRects) && record.pdfRects.length)
        .map((entry) => ({ entry, distance: this.pdfMarkRectDistance(entry.record, annotation.rect) }))
        .sort((a, b) => a.distance - b.distance);
      const match = entries[0];
      if (!match || match.distance > 10) return;
      this.showNativePdfMarkDeleteMenu(event, paper, [match.entry]);
    } catch (error) {
      console.error("Paper Library: failed to identify native PDF annotation", error);
      new Notice(`无法删除此 PDF 标注：${error.message || error}`);
    }
  }

  async findNativePdfMarksAtEvent(event, pageEl, paper, file) {
    const pageNumber = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
    const bounds = pageEl?.getBoundingClientRect?.();
    if (!pageNumber || !paper || !file?.path || !bounds?.width || !bounds?.height) return [];
    const sizes = await this.getNativePdfPageSizes(file).catch(() => null);
    const dims = sizes?.get(pageNumber);
    if (!dims?.width || !dims?.height) return [];
    const path = normalizePath(file.path);
    return this.getPdfMarkEntries(paper, path).filter(({ record }) => {
      if (Number(record.page) !== pageNumber) return false;
      return (record.pdfRects || []).some((item) => {
        const rect = item?.rect;
        if (!Array.isArray(rect) || rect.length !== 4) return false;
        const left = bounds.left + Math.min(rect[0], rect[2]) / dims.width * bounds.width;
        const right = bounds.left + Math.max(rect[0], rect[2]) / dims.width * bounds.width;
        const top = bounds.top + (1 - Math.max(rect[1], rect[3]) / dims.height) * bounds.height;
        const bottom = bounds.top + (1 - Math.min(rect[1], rect[3]) / dims.height) * bounds.height;
        return event.clientX >= left - 2 && event.clientX <= right + 2
          && event.clientY >= top - 2 && event.clientY <= bottom + 2;
      });
    });
  }

  async collectNativePdfEraseTargets(event, leaf, container, state) {
    if (!state.erasing) return;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = file ? this.getPaperForPdfFile(file) : null;
    if (!file || !paper) return;
    const pageEl = event.target?.closest?.(".page[data-page-number], .page")
      || container.ownerDocument?.elementFromPoint?.(event.clientX, event.clientY)?.closest?.(".page");
    if (!pageEl || !container.contains(pageEl)) return;
    const hits = await this.findNativePdfMarksAtEvent(event, pageEl, paper, file);
    hits.forEach((entry) => state.erasing.highlights.set(entry.record.id, entry));
    const card = event.target?.closest?.(".paperlib-pdf-textbox-card");
    if (card) {
      const textboxMark = (paper.annotations || []).find((item) => (
        item.id === card.dataset.markId && item.pdfSubtype === "FreeText"
      ));
      if (textboxMark) state.erasing.highlights.set(textboxMark.id, { record: textboxMark, source: "paper-annotation" });
    }
    const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    const stroke = this.findPdfInkStrokeAtEvent(event, pageEl, paper, file.path, pageNumber);
    if (stroke) state.erasing.strokes.set(stroke.id, stroke);
  }

  async finishNativePdfErase(leaf, container, state) {
    const session = state.erasing;
    state.erasing = null;
    if (!session) return;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const paper = file ? this.getPaperForPdfFile(file) : null;
    if (!paper) return;
    const entries = [...session.highlights.values()];
    const canvasEntries = entries.filter((entry) => entry.source === "canvas-highlight");
    const otherEntries = entries.filter((entry) => entry.source !== "canvas-highlight");
    if (canvasEntries.length) {
      await this.removeCanvasHighlights(paper, canvasEntries.map((entry) => entry.record.id));
    }
    for (const entry of otherEntries) {
      if (entry.record.pdfSubtype === "FreeText") await this.deletePdfTextBox(paper, entry.record);
      else await this.deletePdfMark(paper, entry);
    }
    for (const id of session.strokes.keys()) {
      await this.removePdfInkStroke(paper, id);
    }
    const removed = entries.length + session.strokes.size;
    if (removed) new Notice(`已擦除 ${removed} 处标注`);
  }

  async clearPaperAnnotations(paper, pdfPath) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return 0;
    const path = normalizePath(pdfPath || paper.pdfPath || "");
    const workspace = this.ensureResearchWorkspace(paper);
    const highlights = (workspace.highlights || []).filter((mark) => (
      normalizePath(mark.pdfPath || paper.pdfPath || "") === path
    ));
    const annotations = (paper.annotations || []).filter((mark) => (
      normalizePath(mark.pdfPath || paper.pdfPath || "") === path
      && (mark.pdfSubtype === "FreeText" ? Boolean(mark.box) : Array.isArray(mark.pdfRects) && mark.pdfRects.length)
    ));
    const records = [...highlights, ...annotations];
    if (!records.length) return 0;
    if (highlights.length) {
      const ids = new Set(highlights.map((mark) => mark.id));
      workspace.highlights = (workspace.highlights || []).filter((mark) => !ids.has(mark.id));
      await this.persistResearchWorkspace(paper, false);
    }
    if (annotations.length) {
      const ids = new Set(annotations.map((mark) => mark.pdfAnnotationId || mark.id));
      paper.annotations = (paper.annotations || []).filter((mark) => !ids.has(mark.pdfAnnotationId || mark.id));
      await this.saveSettings();
      const noteFile = await this.ensurePaperNote(paper);
      if (noteFile) {
        let content = await this.app.vault.read(noteFile);
        content = this.removeAnnotationBlocks(content, new Set(annotations.map((mark) => mark.id)));
        content = this.mergeResearchWorkspaceSection(content, paper);
        await this.app.vault.modify(noteFile, content);
      }
    }
    try {
      await this.removeLocalPdfAnnotations(records);
    } catch (error) {
      console.error("Paper Library: failed to clear PDF annotations", error);
    }
    this.refreshResearchPdfHighlights(paper);
    this.refreshNativePdfNoteOverlays(paper);
    this.refreshNativePdfTextBoxes(paper);
    this.refreshViews();
    return records.length;
  }

  showNativePdfMarkDeleteMenu(event, paper, marks) {
    const menu = new Menu();
    marks.forEach((entry) => {
      const kind = entry.record.pdfSubtype === "Text" ? "注释" : entry.record.pdfSubtype === "Underline" ? "下划线" : "高光";
      const color = CANVAS_HIGHLIGHT_COLORS.find((item) => (
        item.id === String(entry.record.color || "").toLocaleLowerCase()
      ));
      menu.addItem((item) => item
        .setTitle(marks.length > 1 ? `删除${color?.label || "此处"}${kind}` : `删除此${kind}`)
        .setIcon("eraser")
        .onClick(async () => {
          try {
            await this.deletePdfMark(paper, entry);
            new Notice(`已删除 PDF ${kind}`);
          } catch (error) {
            console.error("Paper Library: failed to delete native PDF annotation", error);
            new Notice(`删除 PDF ${kind}失败：${error.message || error}`);
          }
        }));
    });
    if (marks.length > 1) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("删除此处全部标注")
        .setIcon("trash-2")
        .onClick(async () => {
          try {
            for (const entry of marks) await this.deletePdfMark(paper, entry);
            new Notice("已删除此处全部 PDF 标注");
          } catch (error) {
            console.error("Paper Library: failed to delete native PDF annotations", error);
            new Notice(`删除 PDF 标注失败：${error.message || error}`);
          }
        }));
    }
    menu.showAtMouseEvent(event);
  }

  async getNativePdfAnnotationData(file, pageNumber, annotationEl) {
    const rawId = annotationEl.dataset?.annotationId
      || annotationEl.getAttribute?.("data-annotation-id")
      || String(annotationEl.id || "").replace(/^annotation[_-]?/, "");
    const buffer = await this.readPdfBinary(file);
    const pdfjs = await loadPdfJs();
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    try {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: "display" });
      return annotations.find((annotation) => String(annotation.id || "") === String(rawId || "")) || null;
    } finally {
      await document.destroy?.();
    }
  }

  pdfMarkRectDistance(mark, actualRect) {
    if (!Array.isArray(actualRect) || actualRect.length !== 4) return Number.POSITIVE_INFINITY;
    const rects = (mark.pdfRects || []).map((item) => item.rect).filter((rect) => rect?.length === 4);
    if (!rects.length) return Number.POSITIVE_INFINITY;
    const selectionRect = [
      Math.min(...rects.map((rect) => rect[0])),
      Math.min(...rects.map((rect) => rect[1])),
      Math.max(...rects.map((rect) => rect[2])),
      Math.max(...rects.map((rect) => rect[3]))
    ];
    const expected = mark.pdfSubtype === "Text"
      ? [selectionRect[2], Math.max(selectionRect[1], selectionRect[3] - 18), selectionRect[2] + 18, selectionRect[3]]
      : selectionRect;
    return expected.reduce((total, value, index) => total + Math.abs(Number(value) - Number(actualRect[index])), 0);
  }

  async getNativePdfSelectionContext(leaf, textLayer, options = {}) {
    const selection = textLayer.ownerDocument.defaultView?.getSelection?.();
    if (!selection?.rangeCount) return null;
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) return null;
    const file = leaf.view?.file || this.app.workspace.getActiveFile();
    const libraryPaper = this.getPaperForPdfFile(file);
    if (!libraryPaper && options.requirePaper !== false) throw new Error("请先把这个 PDF 加入论文库");
    const paper = libraryPaper || {
      title: file?.basename || file?.name || "文档",
      pdfPath: file?.path || ""
    };
    const anchorElement = selection.anchorNode?.nodeType === 3
      ? selection.anchorNode.parentElement
      : selection.anchorNode;
    // 以选区起点所在页为准：事件目标可能落在另一页（跨页拖动），
    // 用错误页的坐标换算会把高亮放大到整页；起点页信息缺失时回退到事件目标页
    const anchorPageEl = anchorElement?.closest?.(".page[data-page-number], .page");
    const anchorPageNumber = Number(anchorPageEl?.dataset?.pageNumber
      || anchorPageEl?.getAttribute?.("data-page-number"));
    const pageEl = anchorPageNumber ? anchorPageEl : textLayer.closest(".page[data-page-number], .page");
    const activeLayer = pageEl?.querySelector?.(".textLayer") || textLayer;
    const page = Number(pageEl?.dataset?.pageNumber || pageEl?.getAttribute?.("data-page-number"));
    if (!page) throw new Error("无法识别当前 PDF 页码");
    const spans = this.getNativePdfTextSpans(activeLayer);
    const closestSpan = (node) => {
      const element = node?.nodeType === 3 ? node.parentElement : node;
      const span = element?.closest?.("span");
      return span && activeLayer.contains(span) ? span : null;
    };
    const anchorSpan = closestSpan(selection.anchorNode);
    const focusSpan = closestSpan(selection.focusNode);
    const anchorIndex = spans.indexOf(anchorSpan);
    const focusIndex = spans.indexOf(focusSpan);
    if (anchorIndex < 0 || focusIndex < 0) throw new Error("无法读取 PDF 文字选区");
    const forward = anchorIndex < focusIndex || (anchorIndex === focusIndex && selection.anchorOffset <= selection.focusOffset);
    const domRects = this.captureDomSelectionRects(selection.getRangeAt(0), activeLayer);
    const selectionData = await this.getNativePdfSelectionData(file, page, activeLayer, domRects);
    if (!selectionData.pdfRects.length) throw new Error("未能识别选区，请重新选择文字");
    const fallbackRange = {
      beginIndex: forward ? anchorIndex : focusIndex,
      beginOffset: forward ? selection.anchorOffset : selection.focusOffset,
      endIndex: forward ? focusIndex : anchorIndex,
      endOffset: forward ? selection.focusOffset : selection.anchorOffset
    };
    const mappedRange = this.getPdfSelectionRangeFromRects(
      selectionData.textItems,
      selectionData.pdfRects,
      fallbackRange
    );
    return {
      paper,
      text: text.slice(0, 8000),
      page,
      range: mappedRange,
      pdfRects: selectionData.pdfRects,
      pdfPath: file.path,
      sourceLeaf: leaf,
      refreshViews: true,
      selectionSource: "native",
      rectCoordinateSpace: "pdf"
    };
  }

  getNativePdfTextSpans(textLayer) {
    return Array.from(textLayer?.querySelectorAll?.("span") || [])
      .filter((span) => !span.querySelector("span") && span.textContent);
  }

  captureDomSelectionRects(range, layer) {
    const bounds = layer.getBoundingClientRect();
    return Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
      .map((rect) => ({
        left: Math.max(0, rect.left - bounds.left),
        right: Math.min(bounds.width, rect.right - bounds.left),
        top: Math.max(0, rect.top - bounds.top),
        bottom: Math.min(bounds.height, rect.bottom - bounds.top)
      }))
      // 其他页的矩形裁剪后只剩退化的零宽/零高条带，直接丢弃；
      // 否则跨页选区会被放大成整页高亮
      .filter((rect) => rect.right - rect.left > 0.5 && rect.bottom - rect.top > 0.5);
  }

  async getNativePdfSelectionData(file, pageNumber, textLayer, rects) {
    if (!rects.length) return { pdfRects: [], textItems: [] };
    const buffer = await this.readPdfBinary(file);
    const pdfjs = await loadPdfJs();
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    try {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const base = page.getViewport({ scale: 1 });
      const layerRect = textLayer.getBoundingClientRect();
      const viewport = page.getViewport({ scale: layerRect.width / Math.max(1, base.width) });
      const maxRectHeight = base.height * 0.15;
      const marginX = base.width * 0.02;
      const marginY = base.height * 0.02;
      const pdfRects = rects.map((rect) => {
        const topLeft = viewport.convertToPdfPoint(rect.left, rect.top);
        const topRight = viewport.convertToPdfPoint(rect.right, rect.top);
        const bottomLeft = viewport.convertToPdfPoint(rect.left, rect.bottom);
        const bottomRight = viewport.convertToPdfPoint(rect.right, rect.bottom);
        return {
          quad: [...topLeft, ...topRight, ...bottomLeft, ...bottomRight],
          rect: [
            Math.min(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
            Math.min(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
            Math.max(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
            Math.max(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1])
          ]
        };
      }).filter((item) => {
        const [x1, y1, x2, y2] = item.rect;
        if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
        const width = x2 - x1;
        const height = y2 - y1;
        // 单条选区矩形不可能很高：整页高亮通常来自跨页/缩放异常产生的离群矩形
        if (width <= 0.5 || height <= 0.5 || height > maxRectHeight) return false;
        if (width > base.width * 1.05) return false;
        if (x1 < -marginX || x2 > base.width + marginX) return false;
        if (y1 < -marginY || y2 > base.height + marginY) return false;
        return true;
      });
      return { pdfRects, textItems: textContent.items || [] };
    } finally {
      await document.destroy?.();
    }
  }

  async editPaperInSidebar(paper) {
    if (!paper) return;
    this.uiState.selectedId = paper.id;
    this.uiState.detailTab = "edit";
    if (this.app.workspace?.getLeavesOfType) this.refreshSelectedPaperViews();
    await this.ensureDetailView(true);
  }

  getAllTags() {
    const paperTags = this.settings.papers.flatMap((paper) => Array.isArray(paper.tags) ? paper.tags : []);
    return normalizePaperTags([...(this.settings.tags || []), ...paperTags])
      .sort((a, b) => a.localeCompare(b));
  }

  async syncPaperNoteTags(paper) {
    if (!paper?.notePath || !this.app?.fileManager?.processFrontMatter) return false;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(paper.notePath));
    if (!file || file.extension !== "md") return false;
    const tags = normalizePaperTags(paper.tags);
    paper.tags = tags;
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.tags = [...tags];
    });
    return true;
  }

  async renameTag(oldName, newName) {
    newName = normalizePaperTag(newName);
    if (!oldName || !newName || oldName === newName) return;
    this.settings.papers.forEach((paper) => {
      paper.tags = normalizePaperTags((paper.tags || []).map((tag) => tag === oldName ? newName : tag));
    });
    this.settings.tags = normalizePaperTags(this.getAllTags().map((tag) => tag === oldName ? newName : tag));
    for (const paper of this.settings.papers.filter((item) => (item.tags || []).includes(newName))) {
      await this.syncPaperNoteTags(paper);
    }
    if (this.uiState.scope === `tag:${oldName}`) this.uiState.scope = `tag:${newName}`;
    await this.saveSettings();
    this.refreshPaperPresentation({ table: true, detail: true, navigation: true });
    new Notice(`标签已重命名为：${newName}`);
  }

  async deleteTag(tagName) {
    this.settings.papers.forEach((paper) => {
      paper.tags = (paper.tags || []).filter((tag) => tag !== tagName);
    });
    this.settings.tags = this.settings.tags.filter((tag) => tag !== tagName);
    for (const paper of this.settings.papers) await this.syncPaperNoteTags(paper);
    if (this.uiState.scope === `tag:${tagName}`) this.uiState.scope = "all";
    await this.saveSettings();
    this.refreshPaperPresentation({ table: true, detail: true, navigation: true });
    new Notice(`标签已删除：${tagName}`);
  }

  async renameCollection(oldName, newName) {
    oldName = normalizeCollectionPath(oldName);
    newName = normalizeCollectionPath(newName);
    if (!oldName || !newName || oldName === newName) return;
    if (collectionPathContains(oldName, newName)) throw new Error("不能把分类移动到自己的子目录中");
    const affected = this.settings.papers.filter((paper) => (paper.collections || [])
      .some((collection) => collectionPathContains(oldName, collection)));
    this.settings.papers.forEach((paper) => {
      paper.collections = [...new Set((paper.collections || []).map((collection) => {
        const normalized = normalizeCollectionPath(collection);
        if (!collectionPathContains(oldName, normalized)) return normalized;
        return `${newName}${normalized.slice(oldName.length)}`;
      }).filter(Boolean))];
    });
    this.settings.collections = expandCollectionPaths((this.settings.collections || []).map((collection) => {
      const normalized = normalizeCollectionPath(collection);
      if (!collectionPathContains(oldName, normalized)) return normalized;
      return `${newName}${normalized.slice(oldName.length)}`;
    }));
    if (this.uiState.scope?.startsWith("collection:")) {
      const active = this.uiState.scope.slice("collection:".length);
      if (collectionPathContains(oldName, active)) this.uiState.scope = `collection:${newName}${active.slice(oldName.length)}`;
    }
    for (const paper of affected) {
      try { await this.organizePaperFiles(paper); }
      catch (error) { console.warn(`Paper Library: failed to reorganize ${paper.title}`, error); }
    }
    await this.saveSettings();
    this.refreshPaperPresentation({ table: true, detail: true, navigation: true });
    new Notice(`分类已重命名为：${newName}`);
  }

  async createCollection(collectionName) {
    const normalized = normalizeCollectionPath(collectionName);
    if (!normalized) return;
    this.settings.collections = expandCollectionPaths([...(this.settings.collections || []), normalized]);
    await this.saveSettings();
    this.refreshPaperPresentation({ table: true, detail: false, navigation: true });
    new Notice(`已创建分类：${normalized}`);
  }

  async addPapersToCollection(paperIds, collection) {
    const target = normalizeCollectionPath(collection);
    const ids = new Set(Array.isArray(paperIds) ? paperIds : []);
    if (!target || !ids.size) return 0;
    let changed = 0;
    const needOrganize = [];
    this.settings.papers.forEach((paper) => {
      if (!ids.has(paper.id)) return;
      paper.collections = Array.isArray(paper.collections) ? paper.collections : [];
      const covered = paper.collections.some((existing) => (
        existing === target || collectionPathContains(target, existing)
      ));
      if (covered) return;
      if (!paper.collections.length) needOrganize.push(paper);
      paper.collections.push(target);
      changed += 1;
    });
    if (!changed) return 0;
    this.settings.collections = expandCollectionPaths([...(this.settings.collections || []), target]);
    for (const paper of needOrganize) {
      try { await this.organizePaperFiles(paper); }
      catch (error) { console.warn(`Paper Library: failed to reorganize ${paper.title}`, error); }
    }
    await this.saveSettings();
    this.refreshPaperPresentation({ table: true, detail: true, navigation: true });
    return changed;
  }

  // ---- Browser extension bridge -------------------------------------------
  // The companion browser extension talks to a small loopback HTTP server so
  // PDFs (including the user's logged-in sessions, downloaded in the browser)
  // can be pushed straight into the library.

  async ensureExtensionToken() {
    if (this.settings.extensionToken) return this.settings.extensionToken;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    this.settings.extensionToken = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await this.saveSettings();
    return this.settings.extensionToken;
  }

  startExtensionServer() {
    if (this.isMobileApp() || this.extensionServer) return;
    let http;
    try { http = require("node:http"); }
    catch (error) {
      console.warn("Paper Library: node:http unavailable, extension bridge disabled", error);
      return;
    }
    const server = http.createServer((req, res) => {
      void this.handleExtensionRequest(req, res).catch((error) => {
        console.error("Paper Library: extension request failed", error);
        this.sendExtensionJson(res, 500, { ok: false, error: String(error?.message || error || "服务器内部错误") });
      });
    });
    server.on("error", (error) => {
      console.warn("Paper Library: extension server error", error);
      new Notice(`浏览器扩展服务启动失败：${error?.message || error}`);
      this.extensionServer = null;
    });
    server.listen(this.settings.extensionServerPort, "127.0.0.1");
    this.extensionServer = server;
  }

  stopExtensionServer() {
    if (!this.extensionServer) return;
    try { this.extensionServer.close(); }
    catch (error) { console.warn("Paper Library: failed to stop extension server", error); }
    this.extensionServer = null;
  }

  sendExtensionJson(res, status, payload) {
    if (res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    res.end(JSON.stringify(payload));
  }

  readExtensionRequestBody(req, limit = 150 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error("请求体过大"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async handleExtensionRequest(req, res) {
    if (req.method === "OPTIONS") {
      this.sendExtensionJson(res, 204, {});
      return;
    }
    const token = await this.ensureExtensionToken();
    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${token}`) {
      this.sendExtensionJson(res, 401, { ok: false, error: "令牌无效，请检查扩展中的 Token 配置" });
      return;
    }
    const url = String(req.url || "").split("?")[0];
    if (req.method === "GET" && url === "/api/ping") {
      this.sendExtensionJson(res, 200, {
        ok: true,
        app: "obsidian-paper-library",
        papers: (this.settings.papers || []).length,
        collections: this.getExtensionCollections()
      });
      return;
    }
    if (req.method === "POST" && url === "/api/lookup") {
      const raw = await this.readExtensionRequestBody(req, 1024 * 1024);
      let payload;
      try { payload = JSON.parse(raw.toString("utf8") || "{}"); }
      catch { this.sendExtensionJson(res, 400, { ok: false, error: "请求体不是有效的 JSON" }); return; }
      const metadata = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : payload;
      const paper = this.findDuplicatePaper(metadata || {});
      this.sendExtensionJson(res, 200, paper
        ? { ok: true, found: true, paper: this.extensionPaperSummary(paper) }
        : { ok: true, found: false });
      return;
    }
    if (req.method === "POST" && url === "/api/import") {
      const raw = await this.readExtensionRequestBody(req);
      let payload;
      try { payload = JSON.parse(raw.toString("utf8") || "{}"); }
      catch { this.sendExtensionJson(res, 400, { ok: false, error: "请求体不是有效的 JSON" }); return; }
      const result = await this.importExtensionPaper(payload);
      this.sendExtensionJson(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.method === "POST" && url === "/api/import-pdf") {
      // Binary envelope: 4-byte big-endian JSON length, UTF-8 JSON metadata,
      // then the original PDF bytes. This avoids Base64's 33% size overhead
      // and keeps large publisher PDFs from exhausting the extension worker.
      const raw = await this.readExtensionRequestBody(req, 250 * 1024 * 1024);
      if (raw.length < 9) {
        this.sendExtensionJson(res, 400, { ok: false, error: "PDF 导入请求不完整" });
        return;
      }
      const metadataLength = raw.readUInt32BE(0);
      if (metadataLength < 2 || metadataLength > 1024 * 1024 || 4 + metadataLength + 5 > raw.length) {
        this.sendExtensionJson(res, 400, { ok: false, error: "PDF 导入元数据长度无效" });
        return;
      }
      let envelope;
      try { envelope = JSON.parse(raw.subarray(4, 4 + metadataLength).toString("utf8")); }
      catch { this.sendExtensionJson(res, 400, { ok: false, error: "PDF 导入元数据无效" }); return; }
      const result = await this.importExtensionPaper({
        metadata: envelope?.metadata || {},
        fileName: envelope?.fileName || "",
        collection: envelope?.collection,
        pdfBuffer: raw.subarray(4 + metadataLength)
      });
      this.sendExtensionJson(res, result.ok ? 200 : 400, result);
      return;
    }
    this.sendExtensionJson(res, 404, { ok: false, error: "未知接口" });
  }

  extensionPaperSummary(paper = {}) {
    const ranks = this.getPaperVenueRanks(paper);
    const metrics = paper.metrics?.status === "ready" ? paper.metrics : {};
    const firstFinite = (...values) => {
      for (const value of values) {
        const number = Number(value);
        if (value !== null && value !== undefined && value !== "" && Number.isFinite(number)) return number;
      }
      return null;
    };
    return {
      id: paper.id || "",
      title: paper.title || "",
      authors: [...(paper.authors || [])],
      year: Number(paper.year) || 0,
      venue: paper.venue || "",
      venueRanks: ranks,
      citations: firstFinite(metrics.citations, paper.serpApiCitationCount, paper.relations?.citedBy?.total),
      references: firstFinite(metrics.references, paper.relations?.references?.total),
      type: metrics.type || displayPublicationType(paper, ""),
      rating: Math.round(Math.max(0, Math.min(5, Number(paper.rating) || 0))),
      tags: [...(paper.tags || [])].slice(0, 8),
      collections: [...(paper.collections || [])].slice(0, 5),
      hasPdf: Boolean(paper.pdfPath),
      metricsSource: metrics.source || paper.metadataSource || "本地论文库",
      metricsUpdatedAt: metrics.updatedAt || paper.updatedAt || paper.addedAt || ""
    };
  }

  getExtensionCollections() {
    return expandCollectionPaths([
      ...(Array.isArray(this.settings.collections) ? this.settings.collections : []),
      ...(this.settings.papers || []).flatMap((paper) => Array.isArray(paper.collections) ? paper.collections : [])
    ]);
  }

  async importExtensionPaper(payload = {}) {
    if (payload.collection !== undefined && typeof payload.collection !== "string") {
      return { ok: false, code: "collection-not-found", error: "导入分类无效，请刷新分类后重新选择" };
    }
    const collection = payload.collection || "";
    if (collection && !this.getExtensionCollections().includes(collection)) {
      return { ok: false, code: "collection-not-found", error: "导入分类已删除或重命名，请刷新分类后重新选择" };
    }
    const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
    metadata.title = String(metadata.title || "").trim();
    if (!metadata.title && !payload.pdfBuffer && !payload.pdfBase64 && !payload.pdfUrl && !payload.filePath) {
      return { ok: false, error: "缺少论文信息" };
    }
    const duplicate = this.findDuplicatePaper(metadata);

    let buffer = null;
    let fileName = String(payload.fileName || "").trim();
    let cleanupPath = "";
    if (payload.pdfBuffer) {
      const buf = Buffer.isBuffer(payload.pdfBuffer)
        ? payload.pdfBuffer
        : Buffer.from(payload.pdfBuffer);
      buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } else if (payload.pdfBase64) {
      const buf = Buffer.from(String(payload.pdfBase64), "base64");
      buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } else if (payload.filePath) {
      // The browser extension hands over a file that chrome.downloads just
      // finished. Only accept paths inside the user's Downloads folder so the
      // endpoint can never be abused to read arbitrary local files.
      const requested = String(payload.filePath);
      try {
        const nodePath = require("node:path");
        const fs = require("node:fs");
        const os = require("node:os");
        const downloadsDir = nodePath.join(os.homedir(), "Downloads") + nodePath.sep;
        const resolved = nodePath.resolve(requested);
        if (!resolved.startsWith(downloadsDir)) {
          return { ok: false, error: "下载文件路径不在允许的目录内" };
        }
        const buf = fs.readFileSync(resolved);
        buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        if (!fileName) fileName = nodePath.basename(resolved);
        if (payload.cleanup) cleanupPath = resolved;
      } catch (error) {
        return { ok: false, error: `读取下载文件失败：${error?.message || error}` };
      }
    } else if (payload.pdfUrl) {
      const response = await requestUrl({ url: String(payload.pdfUrl), throw: false });
      if (response.status >= 400) return { ok: false, error: `PDF 下载失败（HTTP ${response.status}）` };
      buffer = response.arrayBuffer;
    }
    if (buffer) {
      const header = new TextDecoder("latin1").decode(buffer.slice(0, 5));
      if (header !== "%PDF-") {
        if (cleanupPath) { try { require("node:fs").unlinkSync(cleanupPath); } catch (_) { /* ignore */ } }
        return { ok: false, error: "下载到的内容不是 PDF，可能需要先在浏览器中登录出版商网站", needsLogin: true };
      }
      if (!fileName) fileName = `${safeFileName(metadata.title || "paper") || "paper"}.pdf`;
      if (!fileName.toLocaleLowerCase().endsWith(".pdf")) fileName += ".pdf";
      if (duplicate) {
        if (collection) await this.addPapersToCollection([duplicate.id], collection);
        const existingPdf = duplicate.pdfPath
          ? this.app.vault.getAbstractFileByPath(normalizePath(duplicate.pdfPath))
          : null;
        if (!existingPdf) {
          this.applyBatchImportMetadata(duplicate, metadata, metadata.source || "浏览器扩展");
          const paths = this.getAvailableOrganizedPaperPaths(duplicate);
          duplicate.pdfPath = await this.saveDroppedPdf({ name: fileName, buffer }, paths.pdfPath);
          duplicate.notePath ||= paths.notePath;
          duplicate.pdfMeta = { size: buffer.byteLength, pageCount: 0 };
          try { await this.organizePaperFiles(duplicate); }
          catch (error) { console.warn("Paper Library: browser PDF organization unavailable", error); }
          try { await this.ensurePaperNote(duplicate); }
          catch (error) { console.warn("Paper Library: browser PDF note unavailable", error); }
          await this.saveSettings();
          this.refreshViews();
          if (cleanupPath) { try { require("node:fs").unlinkSync(cleanupPath); } catch (_) { /* ignore */ } }
          new Notice(`已为现有论文补充 PDF：${duplicate.title}`);
          return { ok: true, duplicate: true, attachedPdf: true, title: duplicate.title };
        }
        if (cleanupPath) { try { require("node:fs").unlinkSync(cleanupPath); } catch (_) { /* ignore */ } }
        new Notice(`论文已在库中：${duplicate.title}`);
        return { ok: true, duplicate: true, title: duplicate.title };
      }
      const fileShim = { name: fileName, type: "application/pdf", arrayBuffer: async () => buffer };
      const summary = await this.importPdfBatch([fileShim], [metadata], { collection });
      if (!summary.imported) return { ok: false, error: "PDF 保存失败" };
      if (cleanupPath) { try { require("node:fs").unlinkSync(cleanupPath); } catch (_) { /* ignore */ } }
      return { ok: true, duplicate: false, title: metadata.title || fileName };
    }

    // Metadata-only import: the extension could not obtain a PDF (for example
    // a paywalled page), so the bibliographic record is still added.
    if (duplicate) {
      if (collection) await this.addPapersToCollection([duplicate.id], collection);
      new Notice(`论文已在库中：${duplicate.title}`);
      return { ok: true, duplicate: true, title: duplicate.title };
    }
    const paper = this.createBatchImportPaper({ name: fileName || `${metadata.title}.pdf` }, 0);
    if (collection) paper.collections = [collection];
    delete paper.importStatus;
    delete paper.importError;
    this.applyBatchImportMetadata(paper, metadata, metadata.source || "浏览器扩展");
    this.settings.papers.unshift(paper);
    await this.saveSettings();
    this.refreshViews();
    new Notice(`已从浏览器导入：${paper.title}`);
    return { ok: true, duplicate: false, title: paper.title, metadataOnly: true };
  }

  async deleteCollection(collectionName) {
    collectionName = normalizeCollectionPath(collectionName);
    const affected = this.settings.papers.filter((paper) => (paper.collections || [])
      .some((collection) => collectionPathContains(collectionName, collection)));
    this.settings.papers.forEach((paper) => {
      paper.collections = (paper.collections || []).filter((collection) => !collectionPathContains(collectionName, collection));
    });
    this.settings.collections = this.settings.collections.filter((collection) => !collectionPathContains(collectionName, collection));
    if (this.uiState.scope?.startsWith("collection:")
      && collectionPathContains(collectionName, this.uiState.scope.slice("collection:".length))) this.uiState.scope = "all";
    for (const paper of affected) {
      try { await this.organizePaperFiles(paper); }
      catch (error) { console.warn(`Paper Library: failed to reorganize ${paper.title}`, error); }
    }
    await this.saveSettings();
    this.refreshViews();
    new Notice(`分类已删除：${collectionName}`);
  }

  batchImportStatusLabel(status, error = "") {
    const labels = {
      queued: "等待保存 PDF",
      saving: "正在保存 PDF",
      local: "正在提取 PDF 本地信息",
      layout: "正在使用 DocLayout 确认标题",
      online: "正在联网补全论文信息",
      organizing: "正在整理 PDF 与笔记",
      error: `导入失败${error ? `：${error}` : ""}`
    };
    return labels[String(status || "")] || "正在导入";
  }

  isPaperImportActive(paper) {
    return Boolean(paper?.id
      && paper.importStatus
      && paper.importStatus !== "error"
      && this.activePaperImportIds?.has(paper.id));
  }

  scheduleBatchImportRefresh() {
    if (this.batchImportRefreshTimer) return;
    this.batchImportRefreshTimer = globalThis.setTimeout(() => {
      this.batchImportRefreshTimer = null;
      this.refreshViews();
    }, 70);
  }

  flushBatchImportRefresh() {
    if (this.batchImportRefreshTimer) globalThis.clearTimeout(this.batchImportRefreshTimer);
    this.batchImportRefreshTimer = null;
    this.refreshViews();
  }

  async runBatchImportWorkers(items, concurrency, handler) {
    const queue = Array.from(items || []);
    const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, queue.length || 1));
    let cursor = 0;
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < queue.length) {
        const index = cursor;
        cursor += 1;
        await handler(queue[index], index);
      }
    });
    await Promise.all(workers);
  }

  createBatchImportPaper(file, index = 0) {
    const title = fileNameToTitle(file?.name || "") || "Untitled paper";
    return {
      id: uniqueId(),
      title,
      authors: [],
      year: 0,
      venue: "",
      venueRanks: [],
      abstract: "",
      tags: [],
      collections: [],
      doi: "",
      arxiv: "",
      pdfPath: "",
      notePath: "",
      starred: false,
      flagged: false,
      rating: 0,
      attachments: [],
      addedAt: new Date(Date.now() + index).toISOString(),
      lastOpened: "",
      importStatus: "queued",
      originalPdfName: file?.name || "paper.pdf"
    };
  }

  applyBatchImportMetadata(paper, metadata, source = "") {
    if (!paper || !metadata) return;
    const previousTitle = paper.title;
    const previousDoi = paper.doi;
    const merged = this.mergePaperMetadata(paper, metadata);
    Object.assign(paper, {
      title: merged.title || paper.title,
      authors: Array.isArray(merged.authors) ? merged.authors.filter(Boolean) : (paper.authors || []),
      year: Number(merged.year) || Number(paper.year) || 0,
      venue: merged.venue || paper.venue || "",
      journalAbbreviation: merged.journalAbbreviation || paper.journalAbbreviation || "",
      volume: merged.volume || paper.volume || "",
      issue: merged.issue || paper.issue || "",
      pages: merged.pages || paper.pages || "",
      abstract: merged.abstract || paper.abstract || "",
      tags: normalizePaperTags(merged.tags || paper.tags || []),
      doi: normalizeDoiInput(merged.doi || paper.doi || ""),
      arxiv: merged.arxiv || paper.arxiv || "",
      semanticScholarPaperId: merged.semanticScholarPaperId || paper.semanticScholarPaperId || "",
      serpApiResultId: merged.serpApiResultId || paper.serpApiResultId || "",
      serpApiCitesId: merged.serpApiCitesId || paper.serpApiCitesId || "",
      serpApiSourceUrl: merged.serpApiSourceUrl || paper.serpApiSourceUrl || ""
    });
    if (Number.isFinite(merged.serpApiCitationCount)) paper.serpApiCitationCount = merged.serpApiCitationCount;
    if (source) paper.metadataSource = source;
    if (previousTitle !== paper.title || previousDoi !== paper.doi) delete paper.metrics;
    paper.tags.forEach((tag) => {
      if (!this.settings.tags.includes(tag)) this.settings.tags.push(tag);
    });
  }

  async importPdfFiles(files) {
    const pdfs = Array.from(files || []).filter((file) => (
      file && (file.type === "application/pdf" || file.name?.toLocaleLowerCase().endsWith(".pdf"))
    ));
    if (!pdfs.length) return new Notice("请选择 PDF 文件");
    if (pdfs.length === 1) return this.importDroppedPdf(pdfs[0]);
    return this.importPdfBatch(pdfs);
  }

  async importPdfBatch(files, hints = [], options = {}) {
    const hintList = Array.isArray(hints) ? hints : [];
    const entries = Array.from(files || []).map((file, index) => ({
      file,
      hint: hintList[index] || null,
      paper: this.createBatchImportPaper(file, index),
      saved: false,
      local: null
    }));
    if (!entries.length) return { imported: 0, failed: 0 };
    this.activePaperImportIds ||= new Set();
    entries.forEach(({ paper }) => this.activePaperImportIds.add(paper.id));

    // The placeholder records are committed before any PDF parsing or network
    // request. This lets the library paint the whole batch immediately.
    entries.forEach((entry) => {
      if (options.collection) entry.paper.collections = [options.collection];
      if (entry.hint && typeof entry.hint === "object") {
        this.applyBatchImportMetadata(entry.paper, entry.hint, entry.hint.source || "浏览器扩展");
      }
    });
    this.settings.papers.unshift(...entries.map((entry) => entry.paper));
    await this.saveSettings();
    this.flushBatchImportRefresh();

    const total = entries.length;
    let saved = 0;
    let enriched = 0;
    let failed = 0;
    const progress = new Notice(`已加入 ${total} 个 PDF，正在保存文件…`, 0);
    const updateProgress = (message) => progress.setMessage?.(message);

    // Stage 1 only saves files. No PDF parsing happens here, so every valid PDF
    // becomes visible and openable before slower metadata work begins.
    await this.runBatchImportWorkers(entries, 4, async (entry) => {
      const { file, paper } = entry;
      paper.importStatus = "saving";
      this.scheduleBatchImportRefresh();
      try {
        const buffer = await file.arrayBuffer();
        const header = new TextDecoder("latin1").decode(buffer.slice(0, 5));
        if (header !== "%PDF-") throw new Error("文件内容不是有效的 PDF");
        const paths = this.getAvailableOrganizedPaperPaths(paper);
        paper.pdfPath = await this.saveDroppedPdf({ name: file.name, buffer }, paths.pdfPath);
        paper.notePath = paths.notePath;
        paper.pdfMeta = { size: buffer.byteLength, pageCount: 0 };
        paper.importStatus = "local";
        entry.saved = true;
        saved += 1;
        updateProgress(`已保存 ${saved}/${total} 个 PDF，随后将逐步补全信息…`);
      } catch (error) {
        failed += 1;
        paper.importStatus = "error";
        paper.importError = String(error?.message || error || "未知错误");
        this.activePaperImportIds.delete(paper.id);
        console.error(`Paper Library: failed to save batch PDF ${file?.name || ""}`, error);
      }
      this.scheduleBatchImportRefresh();
    });
    await this.saveSettings();
    this.flushBatchImportRefresh();

    const savedEntries = entries.filter((entry) => entry.saved);
    updateProgress(`PDF 已显示，正在提取本地信息 0/${savedEntries.length}…`);

    // Stage 2 reads local metadata with bounded concurrency. Each completed
    // paper is repainted immediately instead of waiting for the full batch.
    let localDone = 0;
    await this.runBatchImportWorkers(savedEntries, 3, async (entry) => {
      const { paper } = entry;
      try {
        const vaultFile = this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath));
        if (!vaultFile) throw new Error("Vault 中找不到已保存的 PDF");
        const buffer = await this.app.vault.readBinary(vaultFile);
        entry.local = await this.extractLocalPdfMetadata(buffer, entry.file.name);
        this.applyBatchImportMetadata(paper, entry.local, "PDF 本地元数据");
      } catch (error) {
        console.warn(`Paper Library: batch local metadata unavailable for ${paper.title}`, error);
      }
      paper.importStatus = (!this.isMobileApp() && this.isDocLayoutRuntimeInstalled())
        ? "layout"
        : (this.settings.onlineMetadataLookup ? "online" : "organizing");
      localDone += 1;
      updateProgress(`正在提取本地信息 ${localDone}/${savedEntries.length}…`);
      this.scheduleBatchImportRefresh();
    });
    await this.saveSettings();
    this.flushBatchImportRefresh();

    // Stage 2b confirms the title region with DocLayout-YOLO. Two bounded
    // workers avoid serial model startup costs without creating an unbounded
    // number of ONNX sessions. Rows and local metadata are already visible.
    if (!this.isMobileApp() && this.isDocLayoutRuntimeInstalled()) {
      let layoutDone = 0;
      updateProgress(`正在使用 DocLayout 确认标题 0/${savedEntries.length}…`);
      await this.runBatchImportWorkers(savedEntries, 2, async (entry) => {
        const { paper } = entry;
        try {
          const confirmation = await this.confirmPaperTitleWithDocLayout(paper, entry.local || {});
          if (confirmation?.title) {
            entry.local = { ...(entry.local || {}), title: confirmation.title };
            this.applyBatchImportMetadata(paper, entry.local, "PDF + DocLayout-YOLO");
            paper.titleConfirmation = confirmation;
          }
        } catch (error) {
          console.warn(`Paper Library: DocLayout title confirmation unavailable for ${paper.title}`, error);
        }
        paper.importStatus = this.settings.onlineMetadataLookup ? "online" : "organizing";
        layoutDone += 1;
        updateProgress(`正在使用 DocLayout 确认标题 ${layoutDone}/${savedEntries.length}…`);
        this.scheduleBatchImportRefresh();
      });
      await this.saveSettings();
      this.flushBatchImportRefresh();
    }

    // Stage 3 uses a smaller pool for remote providers. This is faster than a
    // fully serial import while avoiding an API burst that triggers 429s.
    await this.runBatchImportWorkers(savedEntries, 2, async (entry) => {
      const { paper } = entry;
      try {
        if (this.settings.onlineMetadataLookup) {
          try {
            const remote = await this.lookupPaperMetadata({
              title: paper.title,
              authors: paper.authors,
              year: paper.year,
              venue: paper.venue,
              doi: paper.doi,
              arxiv: paper.arxiv,
              semanticScholarPaperId: paper.semanticScholarPaperId || ""
            });
            if (remote) {
              const source = remote.source ? `PDF + ${remote.source}` : paper.metadataSource;
              this.applyBatchImportMetadata(paper, remote, source);
            }
          } catch (error) {
            console.warn(`Paper Library: batch online metadata unavailable for ${paper.title}`, error);
          }
        }
        paper.importStatus = "organizing";
        enriched += 1;
        updateProgress(`正在补全在线信息 ${enriched}/${savedEntries.length}…`);
        this.scheduleBatchImportRefresh();

        try { await this.enrichPaperVenueRanks(paper); }
        catch (error) { console.warn(`Paper Library: batch venue rank unavailable for ${paper.title}`, error); }
        try { await this.organizePaperFiles(paper); }
        catch (error) { console.warn(`Paper Library: batch file organization unavailable for ${paper.title}`, error); }
        try { await this.ensurePaperNote(paper); }
        catch (error) { console.warn(`Paper Library: batch note creation unavailable for ${paper.title}`, error); }
      } finally {
        delete paper.importStatus;
        delete paper.importError;
        this.activePaperImportIds.delete(paper.id);
        this.scheduleBatchImportRefresh();
      }
    });

    await this.saveSettings();
    this.flushBatchImportRefresh();
    progress.hide?.();
    new Notice(failed
      ? `批量导入完成：${savedEntries.length} 篇成功，${failed} 个文件失败`
      : `批量导入完成：${savedEntries.length} 篇论文`);
    return { imported: savedEntries.length, failed };
  }

  async importDroppedPdf(file) {
    if (!file || !(file.type === "application/pdf" || file.name?.toLocaleLowerCase().endsWith(".pdf"))) {
      new Notice("请选择 PDF 文件");
      return;
    }
    const progress = new Notice(`正在识别 ${file.name}…`, 0);
    try {
      const buffer = await file.arrayBuffer();
      const header = new TextDecoder("latin1").decode(buffer.slice(0, 5));
      if (header !== "%PDF-") throw new Error("文件内容不是有效的 PDF");
      const local = await this.extractLocalPdfMetadata(buffer, file.name);
      let remote = null;
      if (this.settings.onlineMetadataLookup) remote = await this.lookupPaperMetadata(local);
      const metadata = this.mergePaperMetadata(local, remote);
      const suggestedPaths = this.getOrganizedPaperPaths({ ...metadata, collections: [] });
      const draft = {
        ...metadata,
        pdfPath: suggestedPaths.pdfPath,
        notePath: suggestedPaths.notePath,
        collections: [],
        metadataSource: remote?.source ? `PDF + ${remote.source}` : "PDF 本地元数据",
        pendingPdf: { name: file.name, buffer },
        autoOrganizePdf: true
      };
      progress.hide?.();
      const duplicate = this.findDuplicatePaper(draft);
      if (duplicate) new Notice(`可能已存在同一篇论文：“${duplicate.title}”，请确认后再添加`);
      new AddPaperModal(this.app, this, null, draft).open();
    } catch (error) {
      progress.hide?.();
      console.error("Paper Library: PDF import failed", error);
      new Notice(`PDF 识别失败：${error.message || error}`);
    }
  }

  async extractLocalPdfMetadata(buffer, fileName) {
    const fallbackTitle = fileNameToTitle(fileName) || "Untitled paper";
    let info = {};
    let xmp = {};
    let text = "";
    let readingText = "";
    const visualPages = [];
    const pageTexts = [];
    const readingPageTexts = [];
    let pdfDocument = null;
    try {
      const pdfjs = await loadPdfJs();
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) });
      pdfDocument = await loadingTask.promise;
      try {
        const metadata = await pdfDocument.getMetadata();
        info = metadata?.info || {};
        xmp = metadata?.metadata?.getAll?.() || {};
      } catch (_) {
        // Some valid PDFs do not expose a readable metadata dictionary.
      }
      const pageCount = Math.min(pdfDocument.numPages || 0, 2);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const content = await page.getTextContent();
        const visualLines = this.pdfTextLines(content.items || []);
        visualPages.push(visualLines);
        let pageText = visualLines.map((line) => line.text).join("\n");
        let readingPageText = "";
        content.items.forEach((item) => {
          if (!item?.str) return;
          readingPageText += item.str;
          readingPageText += item.hasEOL ? "\n" : " ";
        });
        if (!pageText.trim()) pageText = readingPageText;
        pageTexts.push(pageText);
        readingPageTexts.push(readingPageText);
      }
      text = pageTexts.join("\n").replace(/\u0000/g, " ");
      readingText = readingPageTexts.join("\n").replace(/\u0000/g, " ");
    } catch (error) {
      console.warn("Paper Library: local PDF metadata extraction failed", error);
    } finally {
      await pdfDocument?.destroy?.();
    }

    const metadataText = JSON.stringify({ info, xmp });
    const searchable = `${metadataText}\n${text}\n${readingText}`;
    const doiMatch = searchable.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    const doi = doiMatch ? doiMatch[0].replace(/[\s)>\].,;:]+$/g, "") : "";
    const arxivMatch = searchable.match(/\barXiv\s*:\s*(\d{4}\.\d{4,5})(?:v\d+)?/i)
      || searchable.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?/i);
    const arxiv = normalizeArxivId(arxivMatch?.[1] || "");
    const embeddedTitle = stripMarkup(info.Title || xmp["dc:title"] || "");
    const layoutTitle = this.guessTitleFromPdfLayout(visualPages);
    const guessedTitle = layoutTitle || this.guessTitleFromPdfText(text, fallbackTitle);
    const title = this.selectReliablePdfTitle({ embeddedTitle, guessedTitle, fallbackTitle, fileName });
    const embeddedAuthor = info.Author || xmp["dc:creator"] || "";
    const embeddedAuthors = (Array.isArray(embeddedAuthor) ? embeddedAuthor : [embeddedAuthor])
      .flatMap((value) => splitMetadataAuthors(value));
    const authors = embeddedAuthors.length
      ? [...new Set(embeddedAuthors)]
      : this.extractAuthorsFromPdfText(readingText || text, title);
    const keywords = stripMarkup(info.Keywords || xmp["pdf:keywords"] || "")
      .split(/[,;]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 1)
      .slice(0, 10);
    const dateText = String(info.CreationDate || info.ModDate || "");
    const year = this.guessYearFromPdfMetadata(dateText, text, arxiv);
    return {
      title,
      authors,
      year,
      venue: this.guessVenueFromPdfText(pageTexts[0] || readingPageTexts[0] || text),
      abstract: this.extractAbstractFromPdfText(readingText || text),
      tags: normalizePaperTags(keywords),
      doi,
      arxiv
    };
  }

  isUsefulPdfTitle(title, fileName) {
    const minimumLength = hasCjkText(title) ? 4 : 8;
    if (!title || title.length < minimumLength || title.length > 400) return false;
    if (/^(untitled|microsoft word|document|paper|article)(\b|\s*-)/i.test(title)) return false;
    if (/^(?:中文论文|论文|未命名|新建文档)$/u.test(title.trim())) return false;
    const baseName = String(fileName || "").replace(/\.pdf$/i, "");
    return hasCjkText(title) || normalizeTitleForMatch(title) !== normalizeTitleForMatch(baseName) || title.includes(" ");
  }

  pdfTextLines(items = []) {
    const fragments = items.map((item) => {
      const text = String(item?.str || "").replace(/\s+/g, " ").trim();
      const transform = Array.isArray(item?.transform) ? item.transform : [];
      const x = Number(transform[4]) || 0;
      const y = Number(transform[5]) || 0;
      const transformSize = Math.hypot(Number(transform[0]) || 0, Number(transform[1]) || 0);
      const size = Math.max(1, Number(item?.height) || transformSize || 1);
      return { text, x, y, size, width: Math.max(0, Number(item?.width) || 0) };
    }).filter((item) => item.text);
    fragments.sort((left, right) => right.y - left.y || left.x - right.x);
    const groups = [];
    fragments.forEach((fragment) => {
      const tolerance = Math.max(2.2, fragment.size * 0.32);
      let line = groups.find((candidate) => Math.abs(candidate.y - fragment.y) <= tolerance);
      if (!line) {
        line = { y: fragment.y, fragments: [] };
        groups.push(line);
      }
      line.fragments.push(fragment);
      line.y = line.fragments.reduce((sum, item) => sum + item.y, 0) / line.fragments.length;
    });
    return groups.sort((left, right) => right.y - left.y).map((line) => {
      line.fragments.sort((left, right) => left.x - right.x);
      let text = "";
      let previous = null;
      line.fragments.forEach((fragment) => {
        if (previous) {
          const previousEnd = previous.x + previous.width;
          const gap = fragment.x - previousEnd;
          const needsSpace = gap > Math.max(1.2, Math.min(previous.size, fragment.size) * 0.12)
            || (!/[\s\-–—/(]$/u.test(text) && !/^[,.;:!?%)\]}]/u.test(fragment.text));
          if (needsSpace) text += " ";
        }
        text += fragment.text;
        previous = fragment;
      });
      return {
        text: text.replace(/\s+/g, " ").trim(),
        y: line.y,
        size: Math.max(...line.fragments.map((fragment) => fragment.size)),
        x: Math.min(...line.fragments.map((fragment) => fragment.x))
      };
    }).filter((line) => line.text);
  }

  isLowConfidencePdfTitle(title = "") {
    const value = String(title || "").replace(/\s+/g, " ").trim();
    if (!value) return true;
    if (/^(?:this paper (?:is|was) (?:included|published)|included in the proceedings|proceedings of|conference proceedings|accepted (?:at|for)|preprint|copyright|all rights reserved|arxiv\s*:|doi\b)/i.test(value)) return true;
    if (/^(?:abstract|introduction|keywords?|摘要|关键词|引言)\b/i.test(value)) return true;
    if (!hasCjkText(value) && /^[a-z]/.test(value)) return true;
    if (/\b(?:the|a|an|of|to|for|with|and|or|in|on|via|by)$/i.test(value)) return true;
    const words = value.split(/\s+/).filter(Boolean);
    if (!hasCjkText(value) && words.length < 3) return true;
    return value.length < (hasCjkText(value) ? 5 : 16) || value.length > 380;
  }

  isDescriptivePdfFileTitle(title = "") {
    const value = String(title || "").replace(/\s+/g, " ").trim();
    if (this.isLowConfidencePdfTitle(value)) return false;
    if (/^(?:paper|article|document|download|fulltext|main|manuscript|accepted|camera[ -]?ready)(?:[-_ ]?\d+)?$/i.test(value)) return false;
    if (/^(?:\d{4}\.\d{4,5}|10\.\d{4,9}[-._/]|[a-f\d]{16,}|[A-Z]?\d{7,})$/i.test(value.replace(/\s+/g, ""))) return false;
    return true;
  }

  selectReliablePdfTitle({ embeddedTitle = "", guessedTitle = "", fallbackTitle = "", fileName = "" } = {}) {
    if (this.isUsefulPdfTitle(embeddedTitle, fileName) && !this.isLowConfidencePdfTitle(embeddedTitle)) {
      return embeddedTitle.replace(/\s+/g, " ").trim();
    }
    const guessed = String(guessedTitle || "").replace(/\s+/g, " ").trim();
    const fallback = String(fallbackTitle || "").replace(/\s+/g, " ").trim();
    const fallbackIsDescriptive = this.isDescriptivePdfFileTitle(fallback);
    if (fallbackIsDescriptive) {
      const agreement = titleSimilarity(fallback, guessed);
      // A filename that already resembles a paper title is safer than an
      // unrelated body/header fragment. This is the key distinction required
      // by unattended batch imports, where no confirmation modal is shown.
      if (this.isLowConfidencePdfTitle(guessed) || agreement < 0.58) return fallback;
    }
    if (!this.isLowConfidencePdfTitle(guessed)) return guessed;
    return fallback || guessed || "Untitled paper";
  }

  guessTitleFromPdfLayout(visualPages = []) {
    const pageCandidates = [];
    visualPages.forEach((lines, pageIndex) => {
      if (!Array.isArray(lines) || !lines.length) return;
      const sizes = lines.map((line) => Number(line.size) || 0).filter((size) => size > 0).sort((a, b) => a - b);
      // The median is easily pulled upward on sparse cover pages because title
      // lines make up a large share of all lines. A lower percentile better
      // approximates body text while still ignoring tiny footers.
      const bodySize = sizes[Math.floor(Math.max(0, sizes.length - 1) * 0.35)] || 10;
      const maxY = Math.max(...lines.map((line) => line.y));
      const minY = Math.min(...lines.map((line) => line.y));
      const pageRange = Math.max(1, maxY - minY);
      const candidates = lines.map((line, index) => {
        const topRatio = (maxY - line.y) / pageRange;
        const fontRatio = line.size / Math.max(1, bodySize);
        const lowConfidence = this.isLowConfidencePdfTitle(line.text);
        const score = fontRatio * 130 + Math.min(line.text.length, 150) * 0.45
          + Math.max(0, 80 - topRatio * 120) - pageIndex * 14 - (lowConfidence ? 260 : 0);
        return { ...line, index, score, fontRatio, topRatio, lowConfidence };
      }).filter((line) => line.fontRatio >= 1.16 && line.topRatio <= 0.62 && line.text.length <= 300);
      candidates.sort((left, right) => right.score - left.score);
      const seed = candidates[0];
      if (!seed || seed.lowConfidence) return;
      const block = [seed];
      for (let offset = 1; offset <= 3; offset += 1) {
        const previous = lines[seed.index - offset];
        if (!previous || previous.size < seed.size * 0.76 || Math.abs(previous.y - block[0].y) > seed.size * 2.2 * offset) break;
        if (!/^(?:authors?|by)\b/i.test(previous.text)) block.unshift(previous);
      }
      for (let offset = 1; offset <= 3; offset += 1) {
        const next = lines[seed.index + offset];
        if (!next || next.size < seed.size * 0.76 || Math.abs(next.y - block[block.length - 1].y) > seed.size * 2.2) break;
        if (/^(?:authors?|by|abstract|摘要)\b/i.test(next.text)) break;
        block.push(next);
      }
      const title = block.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
      if (!this.isLowConfidencePdfTitle(title)) pageCandidates.push({ title, score: seed.score });
    });
    pageCandidates.sort((left, right) => right.score - left.score);
    return pageCandidates[0]?.title || "";
  }

  guessTitleFromPdfText(text, fallbackTitle) {
    const candidates = String(text || "").split(/\n+/).slice(0, 45).map((line, index) => ({
      text: line.replace(/\s+/g, " ").trim(),
      index
    })).filter(({ text: line }) => (
      line.length >= (hasCjkText(line) ? 5 : 18)
      && line.length <= 280
      && !/^(abstract|keywords?|introduction|contents?|arxiv|doi\b|https?:|www\.|copyright|received|accepted|published|摘要|关键词|引言|作者简介|中图分类号|文献标识码)/i.test(line)
      && !/^(?:this paper (?:is|was) (?:included|published)|included in the proceedings|proceedings of|conference proceedings)/i.test(line)
      && !/^(?:第\s*\d+\s*[卷期]|\d{4}\s*年\s*第?\s*\d+\s*期)/u.test(line)
      && !/\b(?:journal|volume|vol\.|issue|issn)\b/i.test(line)
    ));
    const scored = candidates.map((candidate) => {
      const wordCount = candidate.text.split(/\s+/).length;
      const punctuationPenalty = (candidate.text.match(/[,;]/g) || []).length * 5;
      const positionBonus = Math.max(0, 400 - candidate.index * 50);
      return { ...candidate, score: Math.min(candidate.text.length, 150) + positionBonus + Math.min(wordCount, 18) * 3 - punctuationPenalty };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.text || fallbackTitle;
  }

  extractAuthorsFromPdfText(text, title = "") {
    const lines = String(text || "").split(/\n+/).slice(0, 50)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!lines.length) return [];
    if (!hasCjkText(`${title}\n${lines.slice(0, 12).join("\n")}`)) {
      const boundary = lines.findIndex((line) => /^(?:abstract|keywords?|index terms|(?:\d+(?:\.\d+)*)?\s*introduction)\b/i.test(line));
      if (boundary < 1) return [];
      const normalizedTitle = normalizeTitleForMatch(title);
      const affiliationPattern = /(?:university|college|institute|school|department|laborator(?:y|ies)|research (?:center|centre)|academy|hospital|corporation|company|inc\.?|ltd\.?|llc)\b|@/i;
      const authors = [];
      for (let index = boundary - 1; index >= Math.max(0, boundary - 24); index -= 1) {
        const line = lines[index];
        const normalizedLine = normalizeTitleForMatch(line);
        if (normalizedLine && normalizedTitle.includes(normalizedLine)) {
          if (authors.length) break;
          continue;
        }
        if (/^\d/.test(line) || affiliationPattern.test(line)) continue;
        const separated = line
          .replace(/\d+(?:\s*,\s*\d+)*(?:\s*[*＊†‡¹²³⁴⁵⁶⁷⁸⁹⁰]+)?/gu, ";")
          .replace(/[*＊†‡¹²³⁴⁵⁶⁷⁸⁹⁰]+/gu, ";")
          .replace(/\s+(?:and|&)\s+/gi, ";")
          .replace(/[•·]+/g, ";");
        const pieces = (separated.includes(";") ? separated.split(";") : separated.split(/\s*,\s*/))
          .map((name) => name.replace(/^authors?\s*[:：]\s*/i, "").replace(/^[\s,;:()[\]]+|[\s,;:()[\]]+$/g, "").trim())
          .filter(Boolean);
        const names = pieces.filter((name) => {
          if (affiliationPattern.test(name) || name.length > 80) return false;
          const words = name.split(/\s+/).filter(Boolean);
          if (words.length < 2 || words.length > 5) return false;
          return words.every((word) => /^(?:[\p{Lu}][\p{L}'’.-]*|[\p{Lu}]\.|de|del|di|da|dos|van|von|la|le)$/u.test(word));
        });
        if (names.length) authors.unshift(...names);
        else if (authors.length) break;
      }
      return [...new Set(authors)].slice(0, 40);
    }
    let titleIndex = -1;
    let bestTitleScore = 0;
    lines.slice(0, 30).forEach((line, index) => {
      const score = titleSimilarity(title, line);
      if (score > bestTitleScore) {
        bestTitleScore = score;
        titleIndex = index;
      }
    });
    const start = bestTitleScore >= 0.72 ? titleIndex + 1 : 0;
    const authors = [];
    for (const line of lines.slice(start, Math.min(lines.length, start + 10))) {
      if (/^(?:摘要|关键词|中图分类号|文献标识码|收稿日期|基金项目|abstract|keywords?|doi\b)/i.test(line)) break;
      if (/(?:大学|学院|学校|医院|研究院|研究所|实验室|中心|公司|邮编|电子邮箱|通讯地址|@)/u.test(line)) {
        if (authors.length) break;
        continue;
      }
      const names = splitMetadataAuthors(line);
      if (!names.length) continue;
      const compactLine = line.replace(/[\s,，、;；\d*＊†‡¹²³⁴⁵⁶⁷⁸⁹⁰]+/gu, "");
      const namesLength = names.join("").replace(/[·•]/g, "").length;
      if (namesLength < Math.max(2, compactLine.replace(/[·•]/g, "").length * 0.7)) continue;
      authors.push(...names);
      if (authors.length >= 20) break;
    }
    return [...new Set(authors)].slice(0, 20);
  }

  extractAbstractFromPdfText(text) {
    const lines = String(text || "").replace(/\u0000/g, " ").split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const start = lines.findIndex((line) => /^abstract\b/i.test(line));
    if (start < 0) return "";
    const inline = lines[start].replace(/^abstract\s*[:：—–-]?\s*/i, "").trim();
    const parts = inline ? [inline] : [];
    for (const line of lines.slice(start + 1)) {
      if (/^(?:keywords?|index terms)\s*[:：]?\b/i.test(line)) break;
      if (/^(?:\d+(?:\.\d+)*)\s+(?:introduction|background|related work|methods?|methodology)\b/i.test(line)) break;
      if (/^(?:introduction|background|related work|methods?|methodology)$/i.test(line)) break;
      parts.push(line);
      if (parts.join(" ").length >= 6000) break;
    }
    const abstract = parts.join(" ")
      .replace(/([\p{L}])-\s+([\p{Ll}])/gu, "$1$2")
      .replace(/\s+/g, " ")
      .trim();
    return abstract.length >= 80 ? abstract.slice(0, 6000) : "";
  }

  guessVenueFromPdfText(text) {
    const source = String(text || "").replace(/\u0000/g, " ");
    const staticRule = findVenueRankingRule(source);
    if (staticRule?.kind === "conference") return staticRule.shortName;

    // Some conference aliases are also ordinary prose words (for example
    // "Performance"). Dynamic matches must be exact lines or lines that
    // explicitly look like publication information, never arbitrary abstracts.
    const venueSignal = /\b(?:conference|symposium|proceedings|workshop|annual meeting)\b/i;
    const lines = source.split(/\r?\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    for (const line of lines.slice(0, 100)) {
      const key = normalizeVenueLookup(line);
      const lookup = this.conferenceRankingLookup || this.buildConferenceRankingLookup();
      const exact = lookup.exact.get(key);
      if (exact?.kind === "conference") return exact.shortName;
      if (!venueSignal.test(line)) continue;
      const rule = this.findConferenceRankingRule(line);
      if (rule?.kind === "conference") return rule.shortName;
    }
    return "";
  }

  guessYearFromPdfMetadata(dateText, text, arxiv = "") {
    const embedded = Number.parseInt(String(dateText || "").match(/(?:D:)?((?:19|20)\d{2})/)?.[1] || "", 10);
    if (embedded) return embedded;
    const arxivYear = yearFromArxivId(arxiv);
    if (arxivYear) return arxivYear;
    // Do not accept digits embedded in identifiers such as 2605.19260.
    return Number.parseInt(String(text || "").match(/(?:^|[^\d.])(?:©|copyright)?\s*((?:19|20)\d{2})(?![\d.])/im)?.[1] || "", 10) || 0;
  }

  isAmbiguousConferenceVenue(value) {
    const rule = this.findConferenceRankingRule(value);
    const shortName = String(rule?.shortName || "").trim();
    return Boolean(shortName
      && normalizeVenueLookup(value) === normalizeVenueLookup(shortName)
      && /^[A-Z][a-z]{5,}$/.test(shortName));
  }

  paperMetadataMissingFields(metadata) {
    const authors = Array.isArray(metadata?.authors) ? metadata.authors.filter(Boolean) : [];
    const year = Number(metadata?.year) || 0;
    const missing = [];
    if (!isTitleSufficientForLookup(metadata?.title || "")) missing.push("title");
    if (!authors.length || authors.some((author) => /…|\.\.\.$/.test(String(author).trim()))) missing.push("authors");
    if (!isPlausiblePaperYear(year, metadata?.arxiv || arxivIdFromDoi(metadata?.doi))) missing.push("year");
    if (!hasFormalPublicationVenue(metadata || {})) missing.push("venue");
    return missing;
  }

  mergeSemanticScholarFallback(...args) {
    return mergeSemanticScholarFallback(this, ...args);
  }

  serpApiAbstractFallbackQueries(metadata = {}) {
    const title = String(metadata.title || "").trim();
    const normalized = this.semanticScholarSearchQuery(title);
    const lead = this.semanticScholarSearchQuery(title.split(/[:：]/, 1)[0] || "");
    const titleTokens = normalized.split(/\s+/).filter(Boolean);
    const lastToken = titleTokens.at(-1) || "";
    const firstAuthor = this.semanticScholarSearchQuery((metadata.authors || [])[0] || "");
    return [...new Set([
      normalized,
      [lead, lastToken, firstAuthor].filter(Boolean).join(" ")
    ].filter(Boolean))];
  }

  async lookupSerpApiAbstractFallback(metadata = {}, options = {}) {
    if (!this.settings.serpApiKey?.trim()) return null;
    const title = String(metadata.title || "").trim();
    if (!isTitleSufficientForLookup(title)) return null;
    const queries = this.serpApiAbstractFallbackQueries(metadata);
    if (options.skipFullQuery && queries.length > 1) queries.shift();
    for (const query of queries) {
      try {
        const payload = await this.requestSerpApiGoogleScholar({ q: query, hl: "en", num: "10" });
        const result = this.parseSerpApiGoogleScholarResults(payload, {
          title,
          authors: metadata.authors || [],
          arxiv: metadata.arxiv || arxivIdFromDoi(metadata.doi)
        });
        if (String(result?.abstract || "").trim()) return result;
      } catch (error) {
        console.warn("Paper Library: SerpApi abstract fallback unavailable", error);
      }
    }
    return null;
  }

  mergeSerpApiAbstractFallback(local, primary, fallback) {
    if (!fallback?.abstract) return primary;
    const supplemented = this.mergePaperMetadata(local, primary || fallback);
    const source = String(supplemented?.source || primary?.source || "").trim();
    return {
      ...supplemented,
      abstract: fallback.abstract,
      abstractSource: "Google Scholar · SerpApi",
      sourceUrl: primary?.sourceUrl || fallback.sourceUrl || "",
      source: /serpapi/i.test(source)
        ? source
        : (source ? `${source} + Google Scholar · SerpApi` : "Google Scholar · SerpApi")
    };
  }

  async supplementSemanticScholarAbstract(local, primary, options = {}) {
    const combined = this.mergePaperMetadata(local, primary);
    const lookup = options.lookup || combined;
    const fallbackLookup = {
      ...combined,
      ...lookup,
      sourceUrl: primary?.sourceUrl || lookup.sourceUrl || combined.sourceUrl || ""
    };
    const hasStableSemanticIdentifier = Boolean(
      lookup.semanticScholarPaperId || primary?.paperId || lookup.doi || lookup.arxiv || arxivIdFromDoi(lookup.doi)
    );
    try {
      const s2 = await this.resolveSemanticScholarPaper({
        paperId: lookup.semanticScholarPaperId || primary?.paperId || "",
        doi: lookup.doi || "",
        arxiv: lookup.arxiv || arxivIdFromDoi(lookup.doi),
        title: lookup.title || local.title || "",
        year: lookup.year || local.year || 0,
        authors: lookup.authors || local.authors || [],
        requireAbstract: true,
        force: Boolean(options.forceSemanticScholar),
        titleMatchOnly: !hasStableSemanticIdentifier
      });
      const semantic = this.mapSemanticScholarPaper(s2, combined);
      if (!semantic) {
        const serpApiFallback = await this.lookupSerpApiAbstractFallback(fallbackLookup, { skipFullQuery: true });
        return this.mergeSerpApiAbstractFallback(local, primary, serpApiFallback);
      }
      const supplemented = options.supplementMissingMetadata
        ? this.mergeSemanticScholarFallback(local, primary, semantic)
        : (primary || semantic);
      const semanticAbstract = String(semantic.abstract || "").trim();
      if (!semanticAbstract) {
        const serpApiFallback = await this.lookupSerpApiAbstractFallback(fallbackLookup, {
          skipFullQuery: !hasStableSemanticIdentifier
        });
        if (serpApiFallback?.abstract) return this.mergeSerpApiAbstractFallback(local, supplemented, serpApiFallback);
        return supplemented ? {
          ...supplemented,
          paperId: semantic.paperId || supplemented.paperId || ""
        } : supplemented;
      }
      const source = String(supplemented?.source || "").trim();
      return {
        ...supplemented,
        abstract: semanticAbstract,
        abstractSource: "Semantic Scholar",
        paperId: semantic.paperId || supplemented?.paperId || "",
        source: /semantic scholar/i.test(source)
          ? source
          : (source ? `${source} + Semantic Scholar` : "Semantic Scholar")
      };
    } catch (error) {
      console.warn("Paper Library: Semantic Scholar abstract lookup unavailable", error);
      // Anonymous Semantic Scholar traffic can be throttled even after retries.
      // Keep Semantic Scholar as the authoritative source, but do not leave a
      // known paper without an abstract when SerpApi can strictly identify it.
      if (!String(primary?.abstract || "").trim()) {
        const serpApiFallback = await this.lookupSerpApiAbstractFallback(fallbackLookup, {
          skipFullQuery: !hasStableSemanticIdentifier
        });
        if (serpApiFallback?.abstract) return this.mergeSerpApiAbstractFallback(local, primary, serpApiFallback);
        try {
          const work = await this.resolveOpenAlexWork({
            doi: lookup.doi || combined.doi || "",
            title: lookup.title || combined.title || local.title || "",
            year: lookup.year || combined.year || local.year || 0,
            authors: lookup.authors || combined.authors || local.authors || []
          });
          const fallbackAbstract = this.openAlexAbstractText(work);
          if (fallbackAbstract) {
            return {
              ...(primary || {}),
              abstract: fallbackAbstract,
              abstractSource: "OpenAlex"
            };
          }
        } catch (fallbackError) {
          console.warn("Paper Library: exact abstract fallback unavailable", fallbackError);
        }
      }
      return primary;
    }
  }

  async lookupPaperMetadata(local) {
    const primary = this.useSerpApiAsPrimary()
      ? await this.lookupGoogleScholarViaSerpApi({
        title: local.title,
        authors: local.authors,
        arxiv: local.arxiv || arxivIdFromDoi(local.doi)
      })
      : await this.lookupDefaultPaperMetadata(local);
    const combined = this.mergePaperMetadata(local, primary);
    const needsSemanticSupplement = !primary || this.paperMetadataMissingFields(combined).length > 0;
    return this.supplementSemanticScholarAbstract(local, primary, {
      // In the dedicated Semantic Scholar mode it may also fill other missing
      // fields. In every mode, however, its abstract is queried directly.
      supplementMissingMetadata: this.settings.metadataSource === "semantic-scholar"
        && needsSemanticSupplement,
      forceSemanticScholar: Boolean(local.forceSemanticScholar)
    });
  }

  async lookupDefaultPaperMetadata(local) {
    let preprintMetadata = null;
    const arxivId = local.arxiv || arxivIdFromDoi(local.doi);
    if (local.doi) {
      const exact = await this.lookupCrossref({ doi: local.doi });
      if (exact && !isPreprintLikeType(exact.publicationType) && !isArxivDoi(exact.doi)) {
        return { ...exact, arxiv: arxivId || exact.arxiv || "" };
      }
      if (exact) preprintMetadata = { ...exact, doi: "", arxiv: arxivId || exact.arxiv || "" };
    }
    let arxivMetadata = null;
    if (arxivId) {
      arxivMetadata = await this.lookupArxiv(arxivId);
      if (arxivMetadata?.doi) {
        const published = await this.lookupCrossref({ doi: arxivMetadata.doi });
        if (published && !isPreprintLikeType(published.publicationType) && !isArxivDoi(published.doi)) {
          return { ...published, arxiv: arxivId };
        }
      }
    }
    const lookupTitle = arxivMetadata?.title || local.title;
    if (isTitleSufficientForLookup(lookupTitle)) {
      const published = await this.lookupCrossref({ title: lookupTitle, authors: local.authors, year: local.year });
      if (published && !isPreprintLikeType(published.publicationType) && !isArxivDoi(published.doi)) {
        return { ...published, arxiv: arxivId || arxivMetadata?.arxiv || "" };
      }
      if (published) preprintMetadata = { ...published, doi: "", arxiv: arxivId || arxivMetadata?.arxiv || "" };
      const scholar = await this.lookupGoogleScholar({
        title: lookupTitle,
        authors: local.authors,
        arxiv: arxivId || arxivMetadata?.arxiv || ""
      });
      if (scholar && !isRepositoryVenue(scholar.venue)) return scholar;
      if (!hasCjkText(lookupTitle)) {
        try {
          const dblp = await this.lookupDblp(lookupTitle);
          if (dblp && !isRepositoryVenue(dblp.venue)) {
            return { ...dblp, arxiv: arxivId || arxivMetadata?.arxiv || "" };
          }
        } catch (error) {
          console.warn("Paper Library: DBLP metadata fallback failed", error);
        }
      }
      try {
        let work = null;
        if (local.doi && !isArxivDoi(local.doi)) {
          work = await this.resolveOpenAlexWork({ doi: local.doi, title: lookupTitle, year: local.year });
        }
        if (!work) work = await this.resolveOpenAlexWork({ doi: "", title: lookupTitle, year: local.year, authors: local.authors });
        if (work) return this.createOpenAlexMetadata(
          work,
          arxivId || arxivMetadata?.arxiv || "",
          arxivMetadata || local
        );
      } catch (error) {
        console.warn("Paper Library: OpenAlex metadata fallback failed", error);
      }
    }
    return arxivMetadata || preprintMetadata;
  }

  async rematchPaperMetadata(current) {
    const primary = this.useSerpApiAsPrimary()
      ? await this.lookupGoogleScholarViaSerpApi({
        title: current.title,
        authors: current.authors,
        arxiv: current.arxiv || arxivIdFromDoi(current.doi)
      })
      : await this.rematchDefaultPaperMetadata(current);
    const combined = this.mergePaperMetadata(current, primary);
    const needsSemanticSupplement = !primary || this.paperMetadataMissingFields(combined).length > 0;
    const titleChanged = current.matchBy === "title";
    return this.supplementSemanticScholarAbstract(current, primary, {
      supplementMissingMetadata: this.settings.metadataSource === "semantic-scholar"
        && needsSemanticSupplement,
      lookup: {
        ...combined,
        semanticScholarPaperId: titleChanged ? "" : (current.semanticScholarPaperId || primary?.paperId || ""),
        doi: titleChanged ? "" : (combined.doi || current.doi || ""),
        arxiv: titleChanged ? "" : (combined.arxiv || current.arxiv || "")
      }
    });
  }

  async rematchDefaultPaperMetadata(current) {
    const doi = normalizeDoiInput(current.doi);
    const title = String(current.title || "").trim();
    if (doi && current.matchBy !== "title") {
      const exact = await this.lookupCrossref({ doi });
      if (exact && !isPreprintLikeType(exact.publicationType) && !isArxivDoi(exact.doi)) {
        return { ...exact, arxiv: current.arxiv || arxivIdFromDoi(doi) || exact.arxiv || "" };
      }
    }
    if (title) {
      const titleQuery = { title };
      if ((current.authors || []).length) titleQuery.authors = current.authors;
      if (current.year) titleQuery.year = current.year;
      const byTitle = await this.lookupCrossref(titleQuery);
      if (byTitle && !isPreprintLikeType(byTitle.publicationType) && !isArxivDoi(byTitle.doi)) {
        return { ...byTitle, arxiv: current.arxiv || arxivIdFromDoi(doi) || byTitle.arxiv || "" };
      }
      const scholar = await this.lookupGoogleScholar({
        title,
        authors: current.authors,
        arxiv: current.arxiv || arxivIdFromDoi(doi) || ""
      });
      if (scholar && !isRepositoryVenue(scholar.venue)) return scholar;
      if (!hasCjkText(title)) {
        try {
          const dblp = await this.lookupDblp(title);
          if (dblp && !isRepositoryVenue(dblp.venue)) {
            return { ...dblp, arxiv: current.arxiv || arxivIdFromDoi(doi) || "" };
          }
        } catch (error) {
          console.warn("Paper Library: DBLP manual rematch failed", error);
        }
      }
    }
    let work = null;
    if (doi) work = await this.resolveOpenAlexWork({ doi, title });
    if (!work && title) work = await this.resolveOpenAlexWork({ doi: "", title });
    return work ? this.createOpenAlexMetadata(work, current.arxiv || "", current) : null;
  }

  openAlexAbstractText(work) {
    const inverted = work?.abstract_inverted_index;
    if (!inverted || typeof inverted !== "object") return "";
    const positions = [];
    for (const [word, indexes] of Object.entries(inverted)) {
      for (const index of Array.isArray(indexes) ? indexes : []) {
        if (Number.isInteger(index) && index >= 0) positions[index] = word;
      }
    }
    return positions.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  createOpenAlexMetadata(work, arxiv = "", fallback = {}) {
    const isPreprint = isPreprintLikeType(work?.type);
    const openAlexAbstract = this.openAlexAbstractText(work);
    const fallbackVenue = stripMarkup(fallback.venue || "");
    const keepFormalFallback = isPreprint && fallbackVenue && !isRepositoryVenue(fallbackVenue);
    return {
      source: "OpenAlex",
      title: stripMarkup(work?.display_name || work?.title || ""),
      authors: (work?.authorships || []).map((entry) => entry?.author?.display_name).filter(Boolean),
      year: isPreprint && fallback.year ? Number(fallback.year) : (Number(work?.publication_year) || 0),
      venue: keepFormalFallback
        ? fallbackVenue
        : stripMarkup(work?.primary_location?.source?.display_name || (arxiv ? "arXiv" : "")),
      abstract: openAlexAbstract || stripMarkup(fallback.abstract || ""),
      tags: normalizePaperTags((work?.topics || []).map((topic) => topic?.display_name || "")).slice(0, 10),
      doi: isPreprint && arxiv ? normalizeDoiInput(fallback.doi) : normalizeDoiInput(work?.doi),
      arxiv,
      publicationType: keepFormalFallback
        ? (fallback.publicationType || "conference-paper")
        : String(work?.type || "")
    };
  }

  async lookupCrossref({ doi = "", title = "", authors = [], year = 0 }) {
    const normalizedDoi = normalizeDoiInput(doi);
    const item = await this.requestCrossrefWork({ doi: normalizedDoi, title, authors, year });
    if (!item) return null;
    const dateParts = item.issued?.["date-parts"]?.[0]
      || item.published?.["date-parts"]?.[0]
      || item.created?.["date-parts"]?.[0]
      || [];
    return {
      source: "Crossref",
      title: stripMarkup(item.title?.[0] || ""),
      authors: (item.author || []).map(formatCrossrefAuthor).filter(Boolean),
      year: Number(dateParts[0]) || 0,
      venue: crossrefVenue(item),
      abstract: stripMarkup(item.abstract || ""),
      tags: normalizePaperTags(item.subject || []).slice(0, 10),
      doi: normalizeDoiInput(item.DOI || normalizedDoi),
      arxiv: "",
      publicationType: String(item.type || "")
    };
  }

  parseGoogleScholarResults(html, { title = "", authors = [], arxiv = "" } = {}) {
    const chunks = String(html || "")
      .split(/<div[^>]+class=["'][^"']*\bgs_ri\b[^"']*["'][^>]*>/i)
      .slice(1);
    const candidates = chunks.flatMap((chunk) => {
      const titleMarkup = chunk.match(/<h3[^>]+class=["'][^"']*\bgs_rt\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "";
      const candidateTitle = stripMarkup(titleMarkup).replace(/^\s*\[[^\]]+\]\s*/, "");
      const metadataMarkup = chunk.match(/<div[^>]+class=["'][^"']*\bgs_a\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
      const publicationLine = stripMarkup(metadataMarkup);
      const link = decodeEntities(titleMarkup.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1] || "");
      const inferred = inferScholarPublication(publicationLine, link);
      if (!candidateTitle || !inferred.venue) return [];
      const similarity = titleSimilarity(title, candidateTitle);
      if (similarity < TITLE_MATCH_THRESHOLD) return [];
      const rawAuthors = publicationLine.split(/\s+-\s+/)[0] || "";
      const scholarAuthors = rawAuthors.split(/\s*,\s*/).map((value) => value.trim()).filter(Boolean);
      const authorSimilarity = authorListSimilarity(authors, scholarAuthors);
      return [{
        similarity,
        authorSimilarity,
        metadata: {
          source: "Google Scholar",
          title: candidateTitle,
          authors: (authors || []).length ? authors : scholarAuthors,
          year: inferred.year,
          venue: inferred.venue,
          abstract: "",
          tags: [],
          doi: normalizeDoiInput(link.match(/https?:\/\/(?:dx\.)?doi\.org\/([^?#]+)/i)?.[1] || ""),
          arxiv,
          publicationType: inferred.publicationType,
          sourceUrl: link
        }
      }];
    });
    candidates.sort((left, right) => (
      right.similarity - left.similarity || right.authorSimilarity - left.authorSimilarity
    ));
    return candidates[0]?.metadata || null;
  }

  getGoogleScholarProvider() {
    return this.settings.googleScholarProvider === "serpapi" ? "serpapi" : "html";
  }

  parseSerpApiGoogleScholarResults(payload, { title = "", authors = [], arxiv = "" } = {}) {
    const results = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
    const candidates = results.flatMap((result) => {
      const candidateTitle = stripMarkup(result?.title || "").replace(/^\s*\[[^\]]+\]\s*/, "");
      const publicationInfo = result?.publication_info || {};
      const publicationLine = stripMarkup(publicationInfo.summary || "");
      const link = stripMarkup(result?.link || "");
      const resourceLinks = (result?.resources || []).map((resource) => stripMarkup(resource?.link || "")).filter(Boolean);
      const scholarAuthors = (publicationInfo.authors || [])
        .map((author) => stripMarkup(typeof author === "string" ? author : author?.name || ""))
        .filter(Boolean);
      let venueLine = publicationLine;
      const lastAuthor = scholarAuthors.at(-1) || "";
      if (lastAuthor) {
        const authorIndex = venueLine.toLocaleLowerCase().lastIndexOf(lastAuthor.toLocaleLowerCase());
        if (authorIndex >= 0) venueLine = venueLine.slice(authorIndex + lastAuthor.length);
      }
      venueLine = venueLine.replace(/^[\s,;·•|–—-]+/, "").replace(/[·•]\s*[^·•]+$/, "").trim();
      const inferenceInput = venueLine
        ? `${scholarAuthors.join(", ") || "Authors"} - ${venueLine}`
        : publicationLine;
      const inferred = inferScholarPublication(inferenceInput, [link, ...resourceLinks].join(" "));
      const inferredVenue = /…|\.\.\./.test(inferred.venue || "") ? "" : inferred.venue;
      if (!candidateTitle) return [];
      const similarity = titleSimilarity(title, candidateTitle);
      if (similarity < TITLE_MATCH_THRESHOLD) return [];
      const authorSimilarity = authorListSimilarity(authors, scholarAuthors);
      const authorsCompatible = !(authors || []).length
        || !scholarAuthors.length
        || authorSimilarity >= 0.16;
      if (!authorsCompatible) return [];
      const urls = [link, ...resourceLinks];
      const doi = normalizeDoiInput(urls
        .map((url) => url.match(/https?:\/\/(?:dx\.)?doi\.org\/([^?#]+)/i)?.[1] || "")
        .find(Boolean) || "");
      const citedBy = result?.inline_links?.cited_by || {};
      const citationCount = Number(citedBy.total);
      const snippet = stripMarkup(result?.snippet || "")
        .replace(/^(?:…|\.\.\.)\s*/u, "")
        .replace(/\s*(?:…|\.\.\.)$/u, "")
        .trim();
      const snippetIsUseful = snippet.length >= 70 && snippet.split(/\s+/).length >= 9;
      return [{
        similarity,
        authorSimilarity,
        metadata: {
          source: "Google Scholar · SerpApi",
          title: candidateTitle,
          authors: scholarAuthors.length ? scholarAuthors : (authors || []),
          year: inferred.year || Number(publicationLine.match(/\b(?:19|20)\d{2}\b/)?.[0]) || 0,
          venue: inferredVenue,
          // Scholar exposes a verified result snippet rather than the full
          // publisher page. Keep it as the fallback abstract only after the
          // title and authors above have both passed local validation.
          abstract: snippetIsUseful ? snippet : "",
          abstractSource: snippetIsUseful ? "Google Scholar · SerpApi" : "",
          tags: [],
          doi,
          arxiv,
          publicationType: inferredVenue ? (inferred.publicationType || "") : "",
          sourceUrl: link,
          serpApiResultId: stripMarkup(result?.result_id || ""),
          serpApiCitesId: stripMarkup(citedBy.cites_id || ""),
          citationCount: Number.isFinite(citationCount) ? citationCount : null
        }
      }];
    });
    candidates.sort((left, right) => (
      right.similarity - left.similarity || right.authorSimilarity - left.authorSimilarity
    ));
    return candidates[0]?.metadata || null;
  }

  async lookupGoogleScholarViaSerpApi({ title = "", authors = [], arxiv = "" } = {}) {
    const queryTitle = String(title || "").trim();
    if (!isTitleSufficientForLookup(queryTitle)) return null;
    const apiKey = this.settings.serpApiKey?.trim();
    if (!apiKey) {
      if (!this.serpApiMissingKeyNotified) {
        this.serpApiMissingKeyNotified = true;
        new Notice("SerpApi 模式尚未配置 API key，请在 Paper Library 设置中填写");
      }
      return null;
    }
    const parameters = {
      // Quoted Scholar queries return zero results for a number of newly
      // indexed titles containing colons or hyphens (for example TENET-v2).
      // The parser still enforces strict title similarity, so use a normalized
      // unquoted query to improve recall without accepting unrelated papers.
      q: this.semanticScholarSearchQuery(queryTitle) || queryTitle,
      hl: "en",
      num: "10"
    };
    try {
      const payload = await this.requestSerpApiGoogleScholar(parameters);
      if (payload?.error || payload?.search_metadata?.status === "Error") return null;
      return this.parseSerpApiGoogleScholarResults(payload, { title: queryTitle, authors, arxiv });
    } catch (_) {
      console.warn("Paper Library: SerpApi Google Scholar lookup unavailable");
      return null;
    }
  }

  async requestSerpApiGoogleScholar(params = {}) {
    const apiKey = this.settings.serpApiKey?.trim();
    if (!apiKey) throw new Error("SerpApi API key 未配置");
    const parameters = new URLSearchParams({
      engine: "google_scholar",
      ...params,
      api_key: apiKey
    });
    const response = await requestUrl({
      url: `https://serpapi.com/search.json?${parameters.toString()}`,
      method: "GET",
      headers: { Accept: "application/json" }
    });
    const payload = response?.json || (response?.text ? JSON.parse(response.text) : {});
    if (payload?.error || payload?.search_metadata?.status === "Error") {
      throw new Error(stripMarkup(payload?.error || "SerpApi 请求失败"));
    }
    return payload;
  }

  async lookupGoogleScholarHtml({ title = "", authors = [], arxiv = "" } = {}) {
    const queryTitle = String(title || "").trim();
    if (!isTitleSufficientForLookup(queryTitle)) return null;
    try {
      const response = await requestUrl({
        url: `https://scholar.google.com/scholar?hl=en&q=${encodeURIComponent(`"${queryTitle}"`)}`,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
        }
      });
      const html = response?.text || "";
      if (/unusual traffic|not a robot|recaptcha/i.test(html)) return null;
      return this.parseGoogleScholarResults(html, { title: queryTitle, authors, arxiv });
    } catch (error) {
      console.warn("Paper Library: Google Scholar lookup failed", error);
      return null;
    }
  }

  async lookupGoogleScholar(query = {}) {
    if (this.getGoogleScholarProvider() === "serpapi") return this.lookupGoogleScholarViaSerpApi(query);
    return this.lookupGoogleScholarHtml(query);
  }

  async getSerpApiAccountStatus(force = false) {
    if (!force && this.serpApiAccountStatus) return this.serpApiAccountStatus;
    const apiKey = this.settings.serpApiKey?.trim();
    if (!apiKey) return null;
    const response = await requestUrl({
      url: `https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`,
      method: "GET",
      headers: { Accept: "application/json" }
    });
    const payload = response?.json || (response?.text ? JSON.parse(response.text) : {});
    if (payload?.error) return null;
    this.serpApiAccountStatus = {
      plan: stripMarkup(payload.plan_name || ""),
      used: Number(payload.this_month_usage),
      limit: Number(payload.searches_per_month),
      remaining: Number(payload.total_searches_left ?? payload.plan_searches_left),
      renewalDate: stripMarkup(payload.plan_renewal_date || "")
    };
    return this.serpApiAccountStatus;
  }

  async lookupDblp(title = "") {
    const queryTitle = String(title || "").trim();
    if (!queryTitle) return null;
    const response = await requestUrl({
      url: `https://dblp.org/search/publ/api?q=${encodeURIComponent(queryTitle)}&h=10&format=json`,
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Obsidian-Paper-Library/0.23.0" }
    });
    const rawHits = response.json?.result?.hits?.hit || [];
    const hits = Array.isArray(rawHits) ? rawHits : [rawHits];
    const candidates = hits.map((hit) => {
      const info = hit?.info || {};
      const type = stripMarkup(info.type || "");
      const venue = stripMarkup(info.venue || "");
      return {
        info,
        venue,
        similarity: titleSimilarity(queryTitle, info.title || ""),
        formal: !isRepositoryVenue(venue) && !/informal|other publications/i.test(type)
      };
    }).filter((entry) => entry.similarity >= TITLE_MATCH_THRESHOLD);
    candidates.sort((left, right) => {
      if (Math.abs(left.similarity - right.similarity) > 0.025) return right.similarity - left.similarity;
      if (left.formal !== right.formal) return left.formal ? -1 : 1;
      return right.similarity - left.similarity;
    });
    const match = candidates[0];
    if (!match) return null;
    const rawAuthors = match.info?.authors?.author || [];
    const authors = (Array.isArray(rawAuthors) ? rawAuthors : [rawAuthors])
      .map((author) => stripMarkup(typeof author === "string" ? author : author?.text || "").replace(/\s+\d{4}$/u, ""))
      .filter(Boolean);
    const formalDoi = normalizeDoiInput(match.info?.doi || "");
    return {
      source: "DBLP",
      title: stripMarkup(match.info?.title || "").replace(/\.$/, ""),
      authors,
      year: Number.parseInt(match.info?.year || "", 10) || 0,
      venue: match.venue,
      abstract: "",
      tags: [],
      doi: isArxivDoi(formalDoi) ? "" : formalDoi,
      arxiv: "",
      publicationType: match.formal && /conference|workshop/i.test(match.info?.type || "")
        ? "conference-paper"
        : String(match.info?.type || ""),
      sourceUrl: stripMarkup(match.info?.url || match.info?.ee || "")
    };
  }

  async requestCrossrefWork({ doi = "", title = "", authors = [], year = 0 }, throwOnError = false) {
    try {
      const normalizedDoi = normalizeDoiInput(doi);
      const titleQuery = hasCjkText(title) ? "query.title" : "query.bibliographic";
      const url = normalizedDoi
        ? `https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`
        : `https://api.crossref.org/works?${titleQuery}=${encodeURIComponent(title)}&rows=8`;
      const response = await requestUrl({
        url,
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": "Obsidian-Paper-Library/0.23.0" }
      });
      const message = response.json?.message;
      const candidates = normalizedDoi ? [message] : (message?.items || []);
      if (!candidates.length) return null;
      let item = candidates[0];
      if (!normalizedDoi) {
        item = candidates
          .map((candidate) => ({
            candidate,
            similarity: titleSimilarity(title, candidate?.title?.[0] || ""),
            authorSimilarity: authorListSimilarity(
              authors,
              (candidate?.author || []).map(formatCrossrefAuthor).filter(Boolean)
            ),
            yearDistance: year && candidate?.issued?.["date-parts"]?.[0]?.[0]
              ? Math.abs(Number(year) - Number(candidate.issued["date-parts"][0][0]))
              : 0,
            formal: !isPreprintLikeCrossref(candidate)
          }))
          .sort((left, right) => {
            if (Math.abs(left.similarity - right.similarity) > 0.025) return right.similarity - left.similarity;
            if (Math.abs(left.authorSimilarity - right.authorSimilarity) > 0.05) {
              return right.authorSimilarity - left.authorSimilarity;
            }
            if (left.formal !== right.formal) return left.formal ? -1 : 1;
            return left.yearDistance - right.yearDistance || right.similarity - left.similarity;
          })[0];
        if (!item || item.similarity < TITLE_MATCH_THRESHOLD) return null;
        item = item.candidate;
      }
      return item || null;
    } catch (error) {
      console.warn("Paper Library: Crossref lookup failed", error);
      if (throwOnError) throw error;
      return null;
    }
  }

  serpApiMetadataFromPaper(paper) {
    if (!paper?.serpApiResultId && !Number.isFinite(paper?.serpApiCitationCount)) return null;
    return {
      source: "Google Scholar · SerpApi",
      title: paper.title,
      authors: paper.authors || [],
      year: paper.year || 0,
      venue: paper.venue || "",
      doi: paper.doi || "",
      arxiv: paper.arxiv || "",
      publicationType: displayPublicationType(paper, ""),
      sourceUrl: paper.serpApiSourceUrl || "",
      serpApiResultId: paper.serpApiResultId || "",
      serpApiCitesId: paper.serpApiCitesId || "",
      citationCount: Number.isFinite(paper.serpApiCitationCount) ? paper.serpApiCitationCount : null
    };
  }

  async loadSerpApiPaperMetrics(paper, force = false) {
    const previousMetrics = paper.metrics;
    const serp = (!force && this.serpApiMetadataFromPaper(paper))
      || await this.lookupGoogleScholarViaSerpApi({
        title: paper.title,
        authors: paper.authors,
        arxiv: paper.arxiv || arxivIdFromDoi(paper.doi)
      });
    if (!serp) {
      paper.serpApiLastMissAt = new Date().toISOString();
      const cachedCitations = Number(paper.relations?.citedBy?.total);
      const cachedReferences = Number(paper.relations?.references?.total);
      if (previousMetrics?.status === "ready"
        || Number.isFinite(cachedCitations)
        || Number.isFinite(cachedReferences)) {
        paper.metrics = previousMetrics?.status === "ready" ? previousMetrics : {
          status: "ready",
          citations: Number.isFinite(cachedCitations) ? cachedCitations : 0,
          references: Number.isFinite(cachedReferences) ? cachedReferences : 0,
          publishedYear: paper.year || 0,
          type: displayPublicationType(paper, ""),
          publisher: paper.venue || "",
          matchedTitle: paper.title,
          indexedAt: "",
          source: "本地已有数据（SerpApi 暂未索引）",
          sourceUrl: paper.doi ? `https://doi.org/${paper.doi}` : "",
          updatedAt: new Date().toISOString()
        };
        await this.saveSettings();
        return paper.metrics;
      }
      paper.metrics = {
        status: "not-found",
        message: "SerpApi 没有找到足够匹配的论文。请检查标题或 API 额度。",
        source: "SerpApi",
        updatedAt: new Date().toISOString()
      };
      await this.saveSettings();
      return paper.metrics;
    }

    if (serp.title) paper.title = serp.title;
    if ((serp.authors || []).length
      && (!(paper.authors || []).length || serp.authors.length >= paper.authors.length)) {
      paper.authors = [...serp.authors];
    }
    if (serp.year) paper.year = Number(serp.year) || paper.year;
    if (serp.venue) paper.venue = serp.venue;
    if (serp.doi) paper.doi = normalizeDoiInput(serp.doi);
    paper.serpApiResultId = serp.serpApiResultId || paper.serpApiResultId || "";
    paper.serpApiCitesId = serp.serpApiCitesId || paper.serpApiCitesId || "";
    paper.serpApiCitationCount = Number.isFinite(serp.citationCount)
      ? serp.citationCount
      : (Number.isFinite(paper.serpApiCitationCount) ? paper.serpApiCitationCount : 0);
    paper.serpApiSourceUrl = serp.sourceUrl || paper.serpApiSourceUrl || "";
    const relationReferences = Number(paper.relations?.references?.total);
    const previousReferences = Number(previousMetrics?.references);
    paper.metrics = {
      status: "ready",
      citations: paper.serpApiCitationCount,
      references: Number.isFinite(relationReferences)
        ? relationReferences
        : (Number.isFinite(previousReferences) ? previousReferences : 0),
      publishedYear: Number(serp.year) || paper.year || 0,
      type: displayPublicationType(publicationTypeContext(paper, serp.venue), serp.publicationType),
      publisher: serp.venue || paper.venue || "",
      matchedTitle: serp.title || paper.title,
      indexedAt: "",
      source: "SerpApi",
      sourceUrl: serp.sourceUrl || "",
      updatedAt: new Date().toISOString()
    };
    await this.saveSettings();
    this.refreshDetailViews();
    // Do not keep metricsLoading locked while waiting for Semantic Scholar.
    // Reference counts and lists are completed by loadSerpApiRelations after
    // the SerpApi metrics card has already become usable.
    return paper.metrics;
  }

  async loadPaperMetrics(paper, force = false) {
    const maxAge = 24 * 60 * 60 * 1000;
    const updatedAt = Date.parse(paper.metrics?.updatedAt || "");
    if (!force && paper.metrics && Number.isFinite(updatedAt) && Date.now() - updatedAt < maxAge) return paper.metrics;
    if (this.metricsLoading.has(paper.id)) return null;
    this.metricsLoading.add(paper.id);
    this.refreshDetailViews();
    try {
      if (this.useSerpApiAsPrimary()) return await this.loadSerpApiPaperMetrics(paper, force);
      if (this.useSemanticScholar()) {
        try {
          const s2 = await this.resolveSemanticScholarPaper({
            paperId: paper.semanticScholarPaperId || "",
            doi: paper.doi || "",
            arxiv: paper.arxiv || "",
            title: paper.title,
            year: paper.year,
            authors: paper.authors
          });
          if (s2) {
            paper.semanticScholarPaperId = s2.paperId || paper.semanticScholarPaperId || "";
            const semanticArxiv = String(s2?.externalIds?.ArXiv || "").trim();
            if (!paper.arxiv && semanticArxiv) paper.arxiv = semanticArxiv;
            paper.metrics = this.createSemanticScholarMetrics(s2, paper);
            await this.saveSettings();
            return paper.metrics;
          }
        } catch (error) {
          console.warn("Paper Library: Semantic Scholar metrics lookup failed, falling back", error);
        }
      }
      let item = await this.requestCrossrefWork({ doi: paper.doi || "", title: paper.doi ? "" : paper.title });
      // A title-only Crossref hit can be a later repository upload of an already
      // published paper. Use OpenAlex for counts instead of presenting that upload
      // as the paper's publication record.
      if (item && isPreprintLikeCrossref(item) && hasFormalPublicationVenue(paper)) item = null;
      if (item) {
        const dateParts = item.issued?.["date-parts"]?.[0]
          || item.published?.["date-parts"]?.[0]
          || item.created?.["date-parts"]?.[0]
          || [];
        paper.metrics = {
          status: "ready",
          citations: Number(item["is-referenced-by-count"] ?? 0),
          references: Number(item["references-count"] ?? item["reference-count"] ?? 0),
          publishedYear: Number(dateParts[0]) || paper.year || 0,
          type: displayPublicationType(publicationTypeContext(paper, crossrefVenue(item)), item.type),
          publisher: stripMarkup(item.publisher || item["container-title"]?.[0] || ""),
          matchedTitle: stripMarkup(item.title?.[0] || paper.title),
          indexedAt: item.indexed?.["date-time"] || "",
          source: "Crossref",
          sourceUrl: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ""),
          updatedAt: new Date().toISOString()
        };
        this.applyPublishedCrossrefMetadata(paper, item, dateParts);
      } else {
        const openAlexWork = await this.resolveOpenAlexWork(paper);
        if (openAlexWork) {
          paper.metrics = this.createOpenAlexMetrics(openAlexWork, paper);
          this.applyPublishedOpenAlexMetadata(paper, openAlexWork);
        } else {
          paper.metrics = {
            status: "not-found",
            message: "没有找到足够匹配的论文数据。请检查标题、DOI 或 arXiv ID。",
            source: "Crossref + OpenAlex",
            updatedAt: new Date().toISOString()
          };
        }
      }
      await this.saveSettings();
      return paper.metrics;
    } catch (error) {
      console.error("Paper Library: metrics lookup failed", error);
      paper.metrics = {
        status: "error",
        message: `论文数据请求失败：${error?.message || "请稍后重试"}`,
        source: "Crossref + OpenAlex",
        updatedAt: new Date().toISOString()
      };
      await this.saveSettings();
      return paper.metrics;
    } finally {
      this.metricsLoading.delete(paper.id);
      this.refreshDetailViews();
    }
  }

  createOpenAlexMetrics(work, paper) {
    const doi = String(work?.doi || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    const publisher = stripMarkup(work?.primary_location?.source?.display_name || "");
    const useLocalPublication = isPreprintLikeType(work?.type) && hasFormalPublicationVenue(paper);
    return {
      status: "ready",
      citations: Number(work?.cited_by_count ?? 0),
      references: Number(work?.referenced_works_count ?? work?.referenced_works?.length ?? 0),
      publishedYear: useLocalPublication ? (paper.year || 0) : (Number(work?.publication_year) || paper.year || 0),
      type: displayPublicationType(
        publicationTypeContext(paper, publisher),
        work?.type || (paper.arxiv ? "preprint" : "")
      ),
      publisher: useLocalPublication ? paper.venue : (publisher || (paper.arxiv ? "arXiv" : "")),
      matchedTitle: stripMarkup(work?.display_name || work?.title || paper.title),
      indexedAt: work?.updated_date || "",
      source: "OpenAlex",
      sourceUrl: useLocalPublication ? (work?.id || "") : (doi ? `https://doi.org/${doi}` : (work?.id || "")),
      updatedAt: new Date().toISOString()
    };
  }

  applyPublishedCrossrefMetadata(paper, item, dateParts = []) {
    if (isPreprintLikeCrossref(item)) return;
    const venue = crossrefVenue(item);
    const doi = String(item?.DOI || "").toLocaleLowerCase();
    const wasArxivOnly = !paper.venue || /^arxiv\b/i.test(paper.venue);
    if (!paper.doi && doi) paper.doi = doi;
    if (venue && wasArxivOnly) paper.venue = venue;
    if (dateParts[0] && (!paper.year || wasArxivOnly)) paper.year = Number(dateParts[0]) || paper.year;
    if (!paper.volume && item?.volume) paper.volume = String(item.volume);
    if (!paper.issue && item?.issue) paper.issue = String(item.issue);
    if (!paper.pages && item?.page) paper.pages = String(item.page);
    const shortContainer = stripMarkup(item?.["short-container-title"]?.[0] || "");
    if (!paper.journalAbbreviation && shortContainer) paper.journalAbbreviation = shortContainer;
    if (!String(paper.abstract || "").trim() && item?.abstract) {
      paper.abstract = stripMarkup(item.abstract);
    }
  }

  applyPublishedOpenAlexMetadata(paper, work) {
    const isPreprint = String(work?.type || "").toLocaleLowerCase() === "preprint";
    const doi = String(work?.doi || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    const venue = stripMarkup(work?.primary_location?.source?.display_name || "");
    const wasArxivOnly = !paper.venue || /^arxiv\b/i.test(paper.venue);
    if (!paper.doi && doi && !isPreprint) paper.doi = doi;
    if (!isPreprint && venue && wasArxivOnly) {
      paper.venue = /^arxiv\b/i.test(venue) ? (paper.venue || "arXiv") : venue;
    }
    if (!isPreprint && work?.publication_year && (!paper.year || wasArxivOnly)) {
      paper.year = Number(work.publication_year) || paper.year;
    }
    const biblio = work?.biblio || {};
    if (!paper.volume && biblio.volume) paper.volume = String(biblio.volume);
    if (!paper.issue && biblio.issue) paper.issue = String(biblio.issue);
    if (!paper.pages && biblio.first_page) {
      paper.pages = biblio.last_page ? `${biblio.first_page}-${biblio.last_page}` : String(biblio.first_page);
    }
    if (!String(paper.abstract || "").trim()) {
      const abstract = this.openAlexAbstractText(work);
      if (abstract) paper.abstract = abstract;
    }
  }

  useSemanticScholar(...args) {
    return useSemanticScholar(this, ...args);
  }

  useSerpApiAsPrimary() { return this.settings.metadataSource === "serpapi"; }

  semanticScholarSearchQuery(...args) {
    return semanticScholarSearchQuery(this, ...args);
  }

  semanticScholarErrorStatus(...args) {
    return semanticScholarErrorStatus(this, ...args);
  }

  semanticScholarRetryDelay(...args) {
    return semanticScholarRetryDelay(this, ...args);
  }

  semanticScholarDelay(...args) {
    return semanticScholarDelay(this, ...args);
  }

  requestSemanticScholar(...args) {
    return requestSemanticScholar(this, ...args);
  }

  semanticScholarVenue(...args) {
    return semanticScholarVenue(this, ...args);
  }

  semanticScholarPaperAliasKeys(...args) {
    return semanticScholarPaperAliasKeys(this, ...args);
  }

  getCachedSemanticScholarPaper(...args) {
    return getCachedSemanticScholarPaper(this, ...args);
  }

  scheduleSemanticScholarCacheSave(...args) {
    return scheduleSemanticScholarCacheSave(this, ...args);
  }

  cacheSemanticScholarPaper(...args) {
    return cacheSemanticScholarPaper(this, ...args);
  }

  mapSemanticScholarPaper(...args) {
    return mapSemanticScholarPaper(this, ...args);
  }

  resolveSemanticScholarPaper(...args) {
    return resolveSemanticScholarPaper(this, ...args);
  }

  resolveSemanticScholarPaperUncached(...args) {
    return resolveSemanticScholarPaperUncached(this, ...args);
  }

  createSemanticScholarMetrics(...args) {
    return createSemanticScholarMetrics(this, ...args);
  }

  mapSemanticScholarRelationItem(...args) {
    return mapSemanticScholarRelationItem(this, ...args);
  }

  async fetchSemanticScholarRelationPage(paperId, endpoint, offset, limit) {
    const fields = "title,authors,year,venue,publicationVenue,journal,externalIds";
    const response = await this.requestSemanticScholar(`/paper/${encodeURIComponent(paperId)}/${endpoint}`, {
      fields,
      offset: String(offset),
      limit: String(Math.min(100, Math.max(1, limit)))
    });
    const key = endpoint === "citations" ? "citingPaper" : "citedPaper";
    const rawData = response?.data;
    const data = Array.isArray(rawData) ? rawData : [];
    const accessInfo = response?.citingPaperInfo || response?.citedPaperInfo || {};
    const disclaimer = String(accessInfo?.openAccessPdf?.disclaimer || "").trim();
    const unavailable = rawData === null || (!Array.isArray(rawData) && Boolean(disclaimer));
    return {
      items: data
        .map((entry) => this.mapSemanticScholarRelationItem(entry?.[key]))
        .filter((item) => item.title),
      hasMore: Number.isInteger(response?.next) && data.length > 0,
      nextOffset: Number.isInteger(response?.next) ? response.next : offset + data.length,
      unavailable,
      unavailableReason: unavailable
        ? (disclaimer || `Semantic Scholar 没有返回 ${endpoint} 数据`)
        : ""
    };
  }

  async loadSemanticScholarRelations(paperId, citationTotal = 0, referenceTotal = 0) {
    // Semantic Scholar API keys start at 1 request/second. Keep these sequential;
    // parallel calls make one side of the relation graph fail with HTTP 429.
    // One relation response can contain up to 100 papers. Fetch that full page
    // up front, but keep the UI's visibleLimit at 5. This maximizes the useful
    // local cache without spending extra API requests merely to expand 5 -> 20.
    const citedPage = await this.fetchSemanticScholarRelationPage(paperId, "citations", 0, 100);
    const referencePage = await this.fetchSemanticScholarRelationPage(paperId, "references", 0, 100);
    return {
      status: "ready",
      provider: "semantic-scholar",
      workId: paperId,
      semanticScholarPaperId: paperId,
      updatedAt: new Date().toISOString(),
      citedBy: { provider: "semantic-scholar", ...this.relationPageState(citedPage, citationTotal) },
      references: { provider: "semantic-scholar", ...this.relationPageState(referencePage, referenceTotal) }
    };
  }

  mapSerpApiRelationItem(result) {
    const publicationInfo = result?.publication_info || {};
    const inferred = inferScholarPublication(publicationInfo.summary || "", result?.link || "");
    return {
      id: stripMarkup(result?.result_id || result?.link || ""),
      title: stripMarkup(result?.title || "").replace(/^\s*\[[^\]]+\]\s*/, ""),
      year: inferred.year || 0,
      authors: (publicationInfo.authors || [])
        .map((author) => stripMarkup(typeof author === "string" ? author : author?.name || ""))
        .filter(Boolean),
      venue: inferred.venue || "",
      doi: normalizeDoiInput(String(result?.link || "").match(/https?:\/\/(?:dx\.)?doi\.org\/([^?#]+)/i)?.[1] || ""),
      url: stripMarkup(result?.link || "")
    };
  }

  async fetchSerpApiCitationPage(citesId, start = 0, limit = 5) {
    const payload = await this.requestSerpApiGoogleScholar({
      cites: String(citesId),
      hl: "en",
      start: String(Math.max(0, start)),
      num: String(Math.min(20, Math.max(1, limit)))
    });
    const results = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
    const total = Number(payload?.search_information?.total_results);
    const items = results.map((result) => this.mapSerpApiRelationItem(result)).filter((item) => item.title);
    return {
      items,
      total: Number.isFinite(total) ? total : null,
      hasMore: results.length > 0 && (!Number.isFinite(total) || start + results.length < total)
    };
  }

  async loadSerpApiRelations(paper) {
    let citesId = paper.serpApiCitesId || "";
    if (!citesId) {
      const serp = await this.lookupGoogleScholarViaSerpApi({
        title: paper.title,
        authors: paper.authors,
        arxiv: paper.arxiv || arxivIdFromDoi(paper.doi)
      });
      citesId = serp?.serpApiCitesId || "";
      if (serp) {
        paper.serpApiResultId = serp.serpApiResultId || paper.serpApiResultId || "";
        paper.serpApiCitesId = citesId;
        paper.serpApiCitationCount = Number.isFinite(serp.citationCount)
          ? serp.citationCount
          : paper.serpApiCitationCount;
      }
    }

    let citedPage = { items: [], total: Number(paper.serpApiCitationCount) || 0, hasMore: false };
    let citedLoadFailed = false;
    if (citesId) {
      try { citedPage = await this.fetchSerpApiCitationPage(citesId, 0, 10); }
      catch (error) {
        citedLoadFailed = true;
        console.warn("Paper Library: SerpApi cited-paper list unavailable", error);
      }
    }

    let semanticPaperId = paper.semanticScholarPaperId || "";
    let referenceTotal = Number(paper.metrics?.references) || Number(paper.relations?.references?.total) || 0;
    let semanticResolveFailed = false;
    if (!semanticPaperId) {
      try {
        const s2 = await this.resolveSemanticScholarPaper({
          doi: paper.doi || "",
          arxiv: paper.arxiv || "",
          title: paper.title,
          year: paper.year,
          authors: paper.authors
        });
        semanticPaperId = s2?.paperId || "";
        if (s2) referenceTotal = Number(s2.referenceCount ?? referenceTotal);
        if (semanticPaperId) paper.semanticScholarPaperId = semanticPaperId;
      } catch (error) {
        semanticResolveFailed = true;
        console.warn("Paper Library: Semantic Scholar reference match unavailable", error);
      }
    }

    let referencePage = { items: [], hasMore: false };
    let referenceLoadFailed = semanticResolveFailed;
    if (semanticPaperId) {
      const cachedUnavailableReason = String(paper.relations?.references?.unavailableReason || "").trim();
      if (cachedUnavailableReason && !(paper.relations?.references?.items || []).length) {
        referencePage = {
          items: [], hasMore: false, unavailable: true,
          unavailableReason: cachedUnavailableReason
        };
      } else try { referencePage = await this.fetchSemanticScholarRelationPage(semanticPaperId, "references", 0, 100); }
      catch (error) {
        referenceLoadFailed = true;
        console.warn("Paper Library: Semantic Scholar reference list unavailable", error);
      }
    } else {
      referenceLoadFailed = true;
    }

    if (paper.metrics?.status === "ready" && referenceTotal > 0) {
      paper.metrics.references = referenceTotal;
      paper.metrics.source = "SerpApi + Semantic Scholar（参考文献）";
      paper.metrics.updatedAt = new Date().toISOString();
    }

    return {
      status: "ready",
      provider: "serpapi + semantic-scholar",
      workId: semanticPaperId,
      semanticScholarPaperId: semanticPaperId,
      serpApiCitesId: citesId,
      updatedAt: new Date().toISOString(),
      citedBy: {
        provider: "serpapi",
        total: Number.isFinite(citedPage.total) ? citedPage.total : (Number(paper.serpApiCitationCount) || 0),
        totalKnown: Number.isFinite(citedPage.total) || Number(paper.serpApiCitationCount) > 0,
        items: citedPage.items,
        visibleLimit: 5,
        processedIndex: citedPage.items.length,
        allLoaded: !citedPage.hasMore,
        loadFailed: citedLoadFailed
      },
      references: {
        provider: "semantic-scholar",
        ...this.relationPageState(referencePage, referenceTotal),
        loadFailed: referenceLoadFailed || Boolean(referencePage.unavailable)
      }
    };
  }

  async requestOpenAlex(path, params = {}) {
    const apiKey = this.settings.openAlexApiKey?.trim();
    const query = new URLSearchParams(apiKey ? { ...params, api_key: apiKey } : params);
    const response = await requestUrl({
      url: `https://api.openalex.org${path}?${query.toString()}`,
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Obsidian-Paper-Library/0.23.0" }
    });
    return response.json;
  }

  openAlexWorkId(value) {
    return String(value || "").split("/").pop();
  }

  mapOpenAlexWork(work) {
    const doi = String(work?.doi || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    return {
      id: work?.id || "",
      title: stripMarkup(work?.display_name || work?.title || ""),
      year: Number(work?.publication_year) || 0,
      authors: (work?.authorships || []).map((entry) => entry?.author?.display_name).filter(Boolean),
      venue: stripMarkup(work?.primary_location?.source?.display_name || ""),
      doi,
      url: doi ? `https://doi.org/${doi}` : (work?.id || "")
    };
  }

  async resolveOpenAlexWork(paper) {
    if (paper.doi) {
      try {
        return await this.requestOpenAlex(`/works/doi:${encodeURIComponent(paper.doi.trim())}`);
      } catch (error) {
        if (error?.status === 404 || error?.statusCode === 404) return null;
        throw error;
      }
    }
    const response = await this.requestOpenAlex("/works", { search: paper.title, per_page: "10" });
    const match = (response?.results || [])
      .map((work) => ({
        work,
        similarity: titleSimilarity(paper.title, work.display_name || work.title || ""),
        authorSimilarity: authorListSimilarity(
          paper.authors,
          (work?.authorships || []).map((entry) => entry?.author?.display_name).filter(Boolean)
        ),
        formal: !isPreprintLikeType(work?.type)
          && !isRepositoryVenue(work?.primary_location?.source?.display_name || ""),
        yearDistance: paper.year && work.publication_year ? Math.abs(Number(paper.year) - Number(work.publication_year)) : 0,
        citations: Number(work.cited_by_count) || 0
      }))
      .sort((left, right) => {
        if (Math.abs(left.similarity - right.similarity) > 0.025) return right.similarity - left.similarity;
        if (Math.abs(left.authorSimilarity - right.authorSimilarity) > 0.05) {
          return right.authorSimilarity - left.authorSimilarity;
        }
        if (left.formal !== right.formal) return left.formal ? -1 : 1;
        return left.yearDistance - right.yearDistance || right.citations - left.citations;
      })[0];
    return match?.similarity >= TITLE_MATCH_THRESHOLD ? match.work : null;
  }

  getPaperRelationCacheMaxAge() { return 2 * 24 * 60 * 60 * 1000; }

  paperRelationsNeedRecovery(relations) {
    if (relations?.status !== "ready") return false;
    return ["citedBy", "references"].some((type) => {
      const relation = relations[type];
      return relation?.provider === "semantic-scholar"
        && !relation.loadFailed
        && Number(relation.total) > 0
        && (!Array.isArray(relation.items) || relation.items.length === 0)
        && (relation.allLoaded || Boolean(relation.unavailableReason));
    });
  }

  isPaperRelationCacheFresh(relations) {
    if (this.paperRelationsNeedRecovery(relations)) return false;
    const updatedAt = Date.parse(relations?.updatedAt || "");
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < this.getPaperRelationCacheMaxAge();
  }

  clonePaperRelations(relations) {
    if (!relations || typeof relations !== "object") return null;
    try { return JSON.parse(JSON.stringify(relations)); }
    catch (_) { return null; }
  }

  paperRelationMetricTotal(paper, type) {
    const value = type === "citedBy" ? paper?.metrics?.citations : paper?.metrics?.references;
    const total = Number(value);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }

  reconcilePaperRelationTotals(paper, relations) {
    if (!relations || relations.status !== "ready") return false;
    let changed = false;
    ["citedBy", "references"].forEach((type) => {
      const relation = relations[type];
      if (!relation) return;
      relation.items = Array.isArray(relation.items) ? relation.items : [];
      const metricTotal = this.paperRelationMetricTotal(paper, type);
      const storedTotal = Math.max(0, Number(relation.total) || 0);
      // The currently displayed metrics provider is authoritative when it has a
      // positive count. A stale relation total (notably 0) must not shadow it.
      const declaredTotal = metricTotal || storedTotal;
      const nextTotal = Math.max(declaredTotal, relation.items.length);
      if (storedTotal !== nextTotal) {
        relation.total = nextTotal;
        changed = true;
      }
      const totalKnown = declaredTotal > 0 || Boolean(relation.allLoaded);
      if (relation.totalKnown !== totalKnown) {
        relation.totalKnown = totalKnown;
        changed = true;
      }
    });
    return changed;
  }

  paperRelationTotalUnknown(relation) {
    if (!relation) return false;
    if (relation.totalKnown === true) return false;
    if (relation.totalKnown === false) return true;
    const itemCount = Array.isArray(relation.items) ? relation.items.length : 0;
    return !relation.allLoaded && (Number(relation.total) || 0) <= itemCount;
  }

  paperRelationCountLabel(relation) {
    const total = Math.max(0, Number(relation?.total) || 0);
    const itemCount = Array.isArray(relation?.items) ? relation.items.length : 0;
    const visibleTotal = Math.max(total, itemCount);
    return this.paperRelationTotalUnknown(relation) ? `${visibleTotal}+` : String(visibleTotal);
  }

  paperRelationPaginationTotal(relation) {
    const total = Math.max(0, Number(relation?.total) || 0);
    const itemCount = Array.isArray(relation?.items) ? relation.items.length : 0;
    // A fallback provider may expose fewer named relation records than the
    // authoritative metric count. Keep the header count, but never promise an
    // expansion beyond the records that the fallback actually returned.
    if (relation?.allLoaded && itemCount < total) return itemCount;
    return this.paperRelationTotalUnknown(relation)
      ? this.getPaperRelationDisplayCap()
      : Math.max(total, itemCount);
  }

  relationPageState(page, declaredTotal = 0) {
    const items = Array.isArray(page?.items) ? page.items : [];
    const suppliedTotal = Math.max(0, Number(declaredTotal) || 0);
    const hasMore = Boolean(page?.hasMore);
    const incomplete = Boolean(page?.unavailable)
      || (suppliedTotal > 0 && items.length === 0 && !hasMore);
    const totalKnown = suppliedTotal > 0 || !hasMore;
    return {
      total: Math.max(suppliedTotal, items.length),
      totalKnown,
      items,
      visibleLimit: 5,
      nextOffset: Number.isInteger(page?.nextOffset) ? page.nextOffset : items.length,
      allLoaded: !hasMore && !incomplete,
      loadFailed: incomplete,
      unavailableReason: page?.unavailableReason || ""
    };
  }

  appendUniqueRelationItems(relation, items) {
    const seen = new Set((relation.items || []).map((item) => item.id || item.doi || item.url || item.title));
    (items || []).forEach((item) => {
      const key = item.id || item.doi || item.url || item.title;
      if (!key || seen.has(key)) return;
      seen.add(key);
      relation.items.push(item);
    });
  }

  updateRelationFromPage(relation, page) {
    this.appendUniqueRelationItems(relation, page?.items || []);
    if (Number.isInteger(page?.nextOffset)) relation.nextOffset = page.nextOffset;
    if (Number.isFinite(page?.total) && Number(page.total) >= 0) {
      relation.total = Math.max(Number(page.total), relation.items.length);
      relation.totalKnown = true;
    } else if (relation.totalKnown === false) {
      relation.total = relation.items.length;
    }
    relation.total = Math.max(Number(relation.total) || 0, relation.items.length);
    relation.allLoaded = !page?.hasMore;
    if (relation.allLoaded && relation.totalKnown === false) {
      relation.total = relation.items.length;
      relation.totalKnown = true;
    }
  }

  restorePaperRelationCache() {
    let migrated = false;
    (this.settings?.papers || []).forEach((paper) => {
      const cached = this.clonePaperRelations(paper.relations);
      if (cached?.updatedAt) {
        migrated = this.reconcilePaperRelationTotals(paper, cached) || migrated;
        this.relationCache.set(paper.id, cached);
        paper.relations = this.clonePaperRelations(cached);
      }
    });
    if (migrated) void this.saveSettings();
  }

  async persistPaperRelations(paper, relations) {
    if (!relations.updatedAt) relations.updatedAt = new Date().toISOString();
    this.relationCache.set(paper.id, relations);
    if (relations.status === "ready" || relations.status === "not-found") {
      const stored = this.clonePaperRelations(relations);
      if (stored) {
        paper.relations = stored;
        await this.saveSettings();
      }
    }
    return relations;
  }

  async loadOpenAlexRelations(paper, totals = {}) {
    const work = await this.resolveOpenAlexWork(paper);
    if (!work) return null;
    const workId = this.openAlexWorkId(work.id);
    const referenceIds = (work.referenced_works || []).map((id) => this.openAlexWorkId(id)).filter(Boolean);
    const citedResponse = await this.requestOpenAlex("/works", {
      filter: `cites:${workId}`,
      sort: "publication_date:desc",
      per_page: "100",
      cursor: "*"
    });
    let referenceResults = [];
    const initialReferenceIds = referenceIds.slice(0, 100);
    if (initialReferenceIds.length) {
      const referenceResponse = await this.requestOpenAlex("/works", {
        filter: `openalex:${initialReferenceIds.join("|")}`,
        per_page: "100"
      });
      referenceResults = referenceResponse?.results || [];
    }
    const citedItems = (citedResponse?.results || []).map((item) => this.mapOpenAlexWork(item));
    const referenceItems = referenceResults.map((item) => this.mapOpenAlexWork(item));
    const citedTotal = Math.max(
      Number(totals.citedBy) || 0,
      Number(citedResponse?.meta?.count ?? work.cited_by_count ?? 0),
      citedItems.length
    );
    const referenceTotal = Math.max(Number(totals.references) || 0, referenceIds.length, referenceItems.length);
    return {
      status: "ready",
      provider: "openalex",
      workId,
      openAlexWorkId: workId,
      updatedAt: new Date().toISOString(),
      citedBy: {
        provider: "openalex",
        total: citedTotal,
        totalKnown: citedTotal > 0 || !citedResponse?.meta?.next_cursor,
        items: citedItems,
        visibleLimit: 5,
        cursor: citedResponse?.meta?.next_cursor || "",
        allLoaded: !citedResponse?.meta?.next_cursor
      },
      references: {
        provider: "openalex",
        total: referenceTotal,
        totalKnown: referenceTotal > 0 || !referenceIds.length,
        referenceIds,
        items: referenceItems,
        visibleLimit: 5,
        processedIndex: initialReferenceIds.length,
        allLoaded: initialReferenceIds.length >= referenceIds.length
      }
    };
  }

  async supplementUnavailableSemanticRelations(paper, relations) {
    if (!relations || relations.status !== "ready") return relations;
    const unavailableTypes = ["citedBy", "references"].filter((type) => {
      const relation = relations[type];
      return relation?.provider === "semantic-scholar"
        && relation.loadFailed
        && relation.items.length === 0
        && Number(relation.total) > 0;
    });
    if (!unavailableTypes.length) return relations;
    try {
      const fallback = await this.loadOpenAlexRelations(paper, {
        citedBy: Number(relations.citedBy?.total) || 0,
        references: Number(relations.references?.total) || 0
      });
      if (!fallback) return relations;
      unavailableTypes.forEach((type) => {
        const semanticTotal = Number(relations[type]?.total) || 0;
        relations[type] = {
          ...fallback[type],
          total: Math.max(semanticTotal, Number(fallback[type]?.total) || 0),
          totalKnown: true,
          provider: "openalex",
          fallbackFrom: "semantic-scholar"
        };
      });
      relations.provider = relations.provider.includes("openalex")
        ? relations.provider
        : `${relations.provider} + openalex`;
      relations.openAlexWorkId = fallback.workId;
      relations.updatedAt = new Date().toISOString();
      return relations;
    } catch (error) {
      console.warn("Paper Library: OpenAlex relation fallback unavailable", error);
      unavailableTypes.forEach((type) => { relations[type].allLoaded = true; });
      return relations;
    }
  }

  recommendationSeedPapers(limit = 4) {
    const selectedId = this.uiState?.selectedId;
    const now = Date.now();
    return [...(this.settings.papers || [])]
      .filter((paper) => paper?.title)
      .sort((left, right) => {
        const recentInterest = (paper) => {
          const openedAt = new Date(paper.lastOpened || 0).getTime();
          if (!Number.isFinite(openedAt) || openedAt <= 0) return 0;
          const ageInDays = Math.max(0, (now - openedAt) / 86400000);
          return ageInDays <= 7 ? 7 : ageInDays <= 30 ? 4 : ageInDays <= 90 ? 2 : 0;
        };
        const priority = (paper) => (paper.id === selectedId ? 12 : 0)
          + recentInterest(paper)
          + (paper.flagged ? 3 : 0)
          + (paper.starred ? 2 : 0)
          + Math.min(2, (Number(paper.rating) || 0) / 2);
        const score = priority(right) - priority(left);
        if (score) return score;
        return String(right.lastOpened || right.addedAt || "")
          .localeCompare(String(left.lastOpened || left.addedAt || ""));
      })
      .slice(0, Math.max(1, limit));
  }

  recommendationTopicTokens(value) {
    const stopWords = new Set([
      "a", "an", "and", "are", "as", "at", "based", "by", "for", "from", "in", "into", "is", "of", "on",
      "or", "paper", "the", "this", "through", "to", "towards", "using", "via", "with", "conference", "journal",
      "international", "proceedings", "ieee", "acm", "arxiv"
    ]);
    return normalizeTitleForMatch(value || "")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token) && !/^\d+$/.test(token));
  }

  recommendationTopicProfile() {
    const profile = new Map();
    const add = (value, weight) => this.recommendationTopicTokens(value).forEach((token) => {
      profile.set(token, (profile.get(token) || 0) + weight);
    });
    const seeds = this.recommendationSeedPapers(18);
    seeds.forEach((paper, index) => {
      const interest = Math.max(0.35, 1 - index / Math.max(20, seeds.length));
      add(paper.title, 1.25 * interest);
      add(paper.venue, 0.45 * interest);
      (paper.tags || []).forEach((tag) => add(tag, 3.6 * interest));
      (paper.collections || []).forEach((collection) => add(collection, 2.4 * interest));
    });
    return profile;
  }

  getPaperRecommendations(limit = 8) {
    const library = this.settings.papers || [];
    const candidates = new Map();
    const currentYear = new Date().getFullYear();
    const topicProfile = this.recommendationTopicProfile();
    const providers = {
      "semantic-scholar": "Semantic Scholar",
      serpapi: "SerpAPI / Google Scholar",
      openalex: "OpenAlex"
    };
    const isInLibrary = (item) => library.some((paper) => {
      const leftDoi = normalizeDoiInput(paper.doi || "");
      const rightDoi = normalizeDoiInput(item.doi || "");
      if (leftDoi && rightDoi && leftDoi === rightDoi) return true;
      return titleSimilarity(paper.title || "", item.title || "") >= 0.96;
    });
    library.forEach((seed) => {
      const root = this.relationCache.get(seed.id) || this.clonePaperRelations(seed.relations);
      if (!root || root.status !== "ready") return;
      ["citedBy", "references"].forEach((relationType) => {
        const relation = root[relationType];
        if (!relation || !Array.isArray(relation.items)) return;
        relation.items.forEach((item, index) => {
          if (!item?.title || isInLibrary(item)) return;
          const normalizedTitle = normalizeTitleForMatch(item.title);
          if (!normalizedTitle) return;
          const doi = normalizeDoiInput(item.doi || "");
          const key = doi ? `doi:${doi}` : `title:${normalizedTitle}`;
          const provider = String(relation.provider || root.provider || "").split(" + ")[0];
          // Papers citing a library item are usually newer than that item's
          // references, so relation direction is useful but no longer the
          // dominant ranking signal.
          const relationWeight = relationType === "citedBy" ? 3.2 : 1.2;
          const seedWeight = (seed.id === this.uiState?.selectedId ? 1.5 : 0)
            + (seed.lastOpened ? 0.8 : 0)
            + (seed.flagged ? 0.5 : 0);
          const positionWeight = Math.max(0, 1 - index / 100);
          const existing = candidates.get(key) || {
            ...item,
            key,
            relationScore: 0,
            seedTitles: new Set(),
            relationTypes: new Set(),
            providers: new Set()
          };
          existing.relationScore = Math.max(
            existing.relationScore,
            relationWeight + seedWeight + positionWeight
          );
          existing.seedTitles.add(seed.title);
          existing.relationTypes.add(relationType);
          if (provider) existing.providers.add(provider);
          if (!existing.url && item.url) existing.url = item.url;
          candidates.set(key, existing);
        });
      });
    });
    return [...candidates.values()].map((item) => {
      const year = Number(item.year) || 0;
      const age = year ? Math.max(0, currentYear - year) : 99;
      const recencyScore = year
        ? Math.max(0, 10 - age * 1.65)
        : 1.5;
      const candidateTokens = [...new Set([
        ...this.recommendationTopicTokens(item.title),
        ...this.recommendationTopicTokens(item.venue)
      ])];
      const matchedTopics = candidateTokens
        .map((token) => ({ token, weight: topicProfile.get(token) || 0 }))
        .filter((entry) => entry.weight > 0)
        .sort((left, right) => right.weight - left.weight);
      const topicScore = Math.min(11, matchedTopics.reduce((sum, entry) => sum + entry.weight, 0));
      // Multiple relation paths are a modest confidence boost, not a hard
      // requirement. A recent, strongly topical paper from one seed can rank
      // above an older paper connected to many library items.
      const graphConfidence = Math.min(1.5, Math.max(0, item.seedTitles.size - 1) * 0.35);
      return {
        ...item,
        year,
        matchedTopics: matchedTopics.slice(0, 3).map((entry) => entry.token),
        score: recencyScore + topicScore + item.relationScore + graphConfidence
      };
    })
      // Keep the dashboard focused on verifiably recent literature. Candidates
      // without a publication year are omitted instead of risking an old paper
      // being presented as a new recommendation.
      .filter((item) => item.year >= currentYear - 5 && item.year <= currentYear + 2)
      .sort((left, right) => right.score - left.score || right.year - left.year)
      .slice(0, Math.max(1, limit))
      .map((item) => {
        const relationType = item.relationTypes.has("citedBy") ? "citedBy" : "references";
        const seedTitle = [...item.seedTitles][0] || "库内论文";
        const yearPrefix = item.year ? `${item.year} · ` : "";
        const reason = item.matchedTopics.length
          ? `${yearPrefix}与 ${item.matchedTopics.slice(0, 2).join("、")} 主题相关`
          : relationType === "citedBy"
            ? `${yearPrefix}与《${seedTitle}》的研究方向相关`
            : `${yearPrefix}《${seedTitle}》关联文献`;
        const providerLabel = [...item.providers]
          .map((provider) => providers[provider] || provider)
          .filter(Boolean).join(" + ") || "本地关系缓存";
        return {
          ...item,
          relationType,
          reason,
          providerLabel,
          seedTitles: [...item.seedTitles],
          relationTypes: [...item.relationTypes],
          providers: [...item.providers]
        };
      });
  }

  async refreshDailyRecommendations(force = false) {
    if (this.dailyRecommendationLoading) return this.dailyRecommendationLoading;
    const now = Date.now();
    if (!force && this.dailyRecommendationLastAttemptAt
      && now - this.dailyRecommendationLastAttemptAt < 60 * 60 * 1000) return false;
    this.dailyRecommendationLastAttemptAt = now;
    const before = this.getPaperRecommendations(20).map((item) => item.key).join("|");
    const sourceLimit = this.useSerpApiAsPrimary() ? 2 : 3;
    const seeds = this.recommendationSeedPapers(sourceLimit);
    this.dailyRecommendationLoading = Promise.resolve().then(async () => {
      for (const paper of seeds) {
        const cached = this.relationCache.get(paper.id) || this.clonePaperRelations(paper.relations);
        if (!force && cached && cached.status === "ready" && this.isPaperRelationCacheFresh(cached)) continue;
        try {
          // Reuse the configured provider pipeline. SerpAPI supplies Google
          // Scholar citations, Semantic Scholar supplies references, and the
          // default path can still fall back to OpenAlex without losing cache.
          await this.loadPaperRelations(paper, force);
        } catch (error) {
          console.warn(`Paper Library: recommendation relation refresh unavailable for ${paper.title}`, error);
        }
      }
      const after = this.getPaperRecommendations(20).map((item) => item.key).join("|");
      return before !== after;
    }).finally(() => {
      this.dailyRecommendationLoading = null;
    });
    return this.dailyRecommendationLoading;
  }

  async loadPaperRelations(paper, force = false) {
    if (!paper) return null;
    if (this.useSerpApiAsPrimary() && this.metricsLoading?.has(paper.id)) return null;
    if (!force) {
      const cached = this.relationCache.get(paper.id) || this.clonePaperRelations(paper.relations);
      if (cached) {
        const corrected = this.reconcilePaperRelationTotals(paper, cached);
        const fresh = this.isPaperRelationCacheFresh(cached);
        this.relationCache.set(paper.id, cached);
        if (corrected) paper.relations = this.clonePaperRelations(cached);
        if (fresh) {
          if (corrected) await this.saveSettings();
          return cached;
        }
      }
    }
    const loadingKey = `${paper.id}:base`;
    if (this.relationLoading.has(loadingKey)) return null;
    this.relationLoading.add(loadingKey);
    if (force) {
      this.relationCache.delete(paper.id);
    }
    this.refreshDetailViews();
    try {
      if (this.useSerpApiAsPrimary()) {
        const serpResult = await this.loadSerpApiRelations(paper);
        const completed = await this.supplementUnavailableSemanticRelations(paper, serpResult);
        return await this.persistPaperRelations(paper, completed);
      }
      if (this.useSemanticScholar()) {
        try {
          if (paper.semanticScholarPaperId) {
            const cachedResult = await this.loadSemanticScholarRelations(
              paper.semanticScholarPaperId,
              this.paperRelationMetricTotal(paper, "citedBy") || Number(paper.relations?.citedBy?.total) || 0,
              this.paperRelationMetricTotal(paper, "references") || Number(paper.relations?.references?.total) || 0
            );
            const completed = await this.supplementUnavailableSemanticRelations(paper, cachedResult);
            return await this.persistPaperRelations(paper, completed);
          }
          const s2 = await this.resolveSemanticScholarPaper({
            doi: paper.doi || "",
            arxiv: paper.arxiv || "",
            title: paper.title,
            year: paper.year,
            authors: paper.authors
          });
          if (s2?.paperId) {
            paper.semanticScholarPaperId = s2.paperId;
            const semanticArxiv = String(s2?.externalIds?.ArXiv || "").trim();
            if (!paper.arxiv && semanticArxiv) paper.arxiv = semanticArxiv;
            const s2Result = await this.loadSemanticScholarRelations(
              s2.paperId,
              Number(s2.citationCount ?? 0),
              Number(s2.referenceCount ?? 0)
            );
            const completed = await this.supplementUnavailableSemanticRelations(paper, s2Result);
            return await this.persistPaperRelations(paper, completed);
          }
        } catch (error) {
          console.warn("Paper Library: Semantic Scholar relations unavailable, using OpenAlex", error);
        }
      }
      const result = await this.loadOpenAlexRelations(paper, {
        citedBy: this.paperRelationMetricTotal(paper, "citedBy"),
        references: this.paperRelationMetricTotal(paper, "references")
      });
      if (!result) {
        return await this.persistPaperRelations(paper, {
          status: "not-found",
          message: "没有找到匹配的引用关系数据。",
          updatedAt: new Date().toISOString()
        });
      }
      return await this.persistPaperRelations(paper, result);
    } catch (error) {
      console.error("Paper Library: paper relation lookup failed", error);
      const status = this.semanticScholarErrorStatus(error);
      const detail = status === 429
        ? "Semantic Scholar 当前请求较多，请稍后点击刷新重试。"
        : (error?.message || error?.status || error?.statusCode || "未知错误");
      const result = {
        status: "error",
        message: `引用关系加载失败：${detail}`,
        updatedAt: new Date().toISOString()
      };
      this.relationCache.set(paper.id, result);
      return result;
    } finally {
      this.relationLoading.delete(loadingKey);
      this.refreshDetailViews();
    }
  }

  getPaperRelationDisplayCap() { return 1000; }

  prefetchSemanticScholarRelationCache(...args) {
    return prefetchSemanticScholarRelationCache(this, ...args);
  }

  nextPaperRelationLimit(current, total) {
    const cap = Math.min(Number(total) || 0, this.getPaperRelationDisplayCap());
    const stages = [5, 20, 50, 100, 250, 500, 1000];
    return Math.min(stages.find((stage) => stage > current) || cap, cap);
  }

  collapsePaperRelation(paper, type) {
    const relation = this.relationCache.get(paper.id)?.[type];
    if (!relation) return;
    relation.visibleLimit = 5;
    this.refreshDetailViews();
  }

  async loadMorePaperRelation(paper, type) {
    const key = `${paper.id}:${type}`;
    const relation = this.relationCache.get(paper.id)?.[type];
    if (!relation) return;
    const target = this.nextPaperRelationLimit(
      relation.visibleLimit || 5,
      this.paperRelationPaginationTotal(relation)
    );
    if (target <= (relation.visibleLimit || 5)) return;
    if (relation.items.length >= target || relation.allLoaded) {
      relation.visibleLimit = target;
      this.refreshDetailViews();
      return;
    }
    if (this.relationLoading.has(key)) return;
    this.relationLoading.add(key);
    this.refreshDetailViews();
    try {
      const relationRoot = this.relationCache.get(paper.id);
      if (relation?.provider === "serpapi") {
        while (relation.items.length < target && !relation.allLoaded) {
          const want = Math.min(20, target - relation.items.length);
          const page = await this.fetchSerpApiCitationPage(
            relationRoot.serpApiCitesId || paper.serpApiCitesId,
            relation.items.length,
            want
          );
          this.updateRelationFromPage(relation, page);
          relationRoot.updatedAt = new Date().toISOString();
          await this.persistPaperRelations(paper, relationRoot);
        }
        relation.visibleLimit = target;
        return;
      }
      if (relation?.provider === "semantic-scholar"
        || (!relation?.provider && relationRoot?.provider === "semantic-scholar")) {
        const endpoint = type === "citedBy" ? "citations" : "references";
        const semanticPaperId = relationRoot.semanticScholarPaperId || relationRoot.workId;
        while (relation.items.length < target && !relation.allLoaded) {
          // Semantic Scholar allows 100 relation records per response. Cache the
          // whole page locally even when the user only asks to reveal 20 items.
          const offset = Number.isInteger(relation.nextOffset) ? relation.nextOffset : relation.items.length;
          const page = await this.fetchSemanticScholarRelationPage(semanticPaperId, endpoint, offset, 100);
          const previousOffset = offset;
          const previousLength = relation.items.length;
          this.updateRelationFromPage(relation, page);
          relationRoot.updatedAt = new Date().toISOString();
          await this.persistPaperRelations(paper, relationRoot);
          if (relation.items.length === previousLength && relation.nextOffset === previousOffset) {
            relation.allLoaded = true;
          }
        }
        relation.visibleLimit = target;
        return;
      }
      if (type === "citedBy") {
        while (relation.cursor && relation.items.length < target) {
          const response = await this.requestOpenAlex("/works", {
            filter: `cites:${relation.openAlexWorkId || relationRoot.openAlexWorkId || relationRoot.workId}`,
            sort: "publication_date:desc",
            per_page: String(Math.min(100, target - relation.items.length)),
            cursor: relation.cursor
          });
          relation.items.push(...(response?.results || []).map((item) => this.mapOpenAlexWork(item)));
          relation.cursor = response?.meta?.next_cursor || "";
          if (!response?.results?.length) break;
        }
        relation.allLoaded = !relation.cursor || relation.items.length >= relation.total;
      } else {
        const referenceIds = relation.referenceIds || [];
        while (relation.processedIndex < Math.min(target, referenceIds.length)) {
          const end = Math.min(relation.processedIndex + 100, target, referenceIds.length);
          const ids = referenceIds.slice(relation.processedIndex, end);
          const response = await this.requestOpenAlex("/works", {
            filter: `openalex:${ids.join("|")}`,
            per_page: "100"
          });
          const byId = new Map((response?.results || []).map((item) => [this.openAlexWorkId(item.id), item]));
          ids.forEach((id) => {
            const item = byId.get(id);
            if (item) relation.items.push(this.mapOpenAlexWork(item));
          });
          relation.processedIndex = end;
        }
        relation.allLoaded = relation.processedIndex >= referenceIds.length;
      }
      relation.visibleLimit = target;
      relationRoot.updatedAt = new Date().toISOString();
      await this.persistPaperRelations(paper, relationRoot);
    } catch (error) {
      console.error("Paper Library: loading more relation items failed", error);
      new Notice("更多论文加载失败，请稍后重试");
    } finally {
      this.relationLoading.delete(key);
      this.refreshDetailViews();
    }
  }

  async lookupArxiv(arxivId) {
    try {
      const response = await requestUrl({
        url: `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`,
        method: "GET",
        headers: { Accept: "application/atom+xml" }
      });
      const entry = response.text?.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];
      if (!entry) return null;
      const readTag = (name) => stripMarkup(entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
      const authorBlocks = [...entry.matchAll(/<author>([\s\S]*?)<\/author>/gi)];
      const authors = authorBlocks.map((match) => stripMarkup(match[1].match(/<name>([\s\S]*?)<\/name>/i)?.[1] || "")).filter(Boolean);
      const categories = [...entry.matchAll(/<category\s+[^>]*term=["']([^"']+)["'][^>]*\/?\s*>/gi)].map((match) => decodeEntities(match[1]));
      const published = readTag("published");
      const journalReference = readTag("arxiv:journal_ref");
      return {
        source: "arXiv",
        title: readTag("title"),
        authors,
        year: Number.parseInt(published.slice(0, 4), 10) || 0,
        venue: journalReference || "arXiv",
        abstract: readTag("summary"),
        tags: normalizePaperTags(categories).slice(0, 10),
        doi: readTag("arxiv:doi"),
        arxiv: arxivId,
        publicationType: journalReference ? "published-paper" : "preprint"
      };
    } catch (error) {
      console.warn("Paper Library: arXiv lookup failed", error);
      return null;
    }
  }

  async refreshPaperInfo(paper) {
    if (!paper || this.infoLoading.has(paper.id)) return;
    const venueRanksBefore = this.formatVenueRanksInput(this.getPaperVenueRanks(paper));
    this.infoLoading.add(paper.id);
    this.refreshDetailViews();
    const progress = new Notice("正在刷新论文信息…", 0);
    try {
      let local = null;
      const pdfFile = paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath)
        ? this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath))
        : null;
      if (pdfFile && pdfFile.extension === "pdf") {
        try {
          const buffer = await this.app.vault.readBinary(pdfFile);
          local = {
            ...(await this.extractLocalPdfMetadata(buffer, paper.originalPdfName || pdfFile.name))
          };
          if (!this.isMobileApp() && this.isDocLayoutRuntimeInstalled()) {
            const confirmation = await this.confirmPaperTitleWithDocLayout(paper, local);
            if (confirmation?.title) {
              local.title = confirmation.title;
              paper.titleConfirmation = confirmation;
            }
          }
        } catch (error) {
          console.warn("Paper Library: refresh PDF re-extraction failed", error);
        }
      }
      let remote = null;
      if (this.settings.onlineMetadataLookup) {
        const localTitleIsReliable = local?.title && !this.isLowConfidencePdfTitle(local.title);
        const lookupTitle = this.isLowConfidencePdfTitle(paper.title) && localTitleIsReliable
          ? local.title
          : (paper.title || local?.title || "");
        const lookupAuthors = (paper.authors || []).length ? paper.authors : (local?.authors || []);
        const lookupArxiv = paper.arxiv || local?.arxiv || "";
        remote = await this.lookupPaperMetadata({
          title: lookupTitle,
          doi: paper.doi || local?.doi || "",
          arxiv: lookupArxiv,
          year: isPlausiblePaperYear(paper.year, lookupArxiv)
            ? paper.year
            : (local?.year || yearFromArxivId(lookupArxiv)),
          authors: lookupAuthors,
          semanticScholarPaperId: paper.semanticScholarPaperId || "",
          forceSemanticScholar: true
        });
      }
      const merged = this.mergePaperMetadata(local || {
        title: "", authors: [], year: 0, venue: "",
        abstract: "", tags: [], doi: "", arxiv: ""
      }, remote);
      const filled = [];
      const fillField = (key, value) => {
        if (String(paper[key] ?? "").trim() || !String(value ?? "").trim()) return;
        paper[key] = value;
        filled.push(key);
      };
      if (String(merged.abstract || "").trim() && paper.abstract !== merged.abstract) {
        paper.abstract = merged.abstract;
        filled.push("abstract");
      }
      const replaceLowConfidenceTitle = this.isLowConfidencePdfTitle(paper.title)
        && !this.isLowConfidencePdfTitle(merged.title)
        && normalizeTitleForMatch(paper.title) !== normalizeTitleForMatch(merged.title);
      if (replaceLowConfidenceTitle) {
        paper.title = merged.title;
        filled.push("title");
      } else fillField("title", merged.title);
      const shouldUpgradeVenue = !isRepositoryVenue(merged.venue) && isRepositoryVenue(paper.venue);
      const shouldReplaceAmbiguousVenue = Boolean(local)
        && this.isAmbiguousConferenceVenue(paper.venue)
        && normalizeVenueLookup(local.venue) !== normalizeVenueLookup(paper.venue);
      if (shouldUpgradeVenue || shouldReplaceAmbiguousVenue) {
        paper.venue = merged.venue;
        if (shouldReplaceAmbiguousVenue) paper.venueRanks = [];
        filled.push("venue");
      } else fillField("venue", merged.venue);
      const existingArxivDoi = arxivIdFromDoi(paper.doi);
      if (existingArxivDoi && !merged.doi) {
        paper.doi = "";
        filled.push("doi");
      } else if (existingArxivDoi && merged.doi && !isArxivDoi(merged.doi)) {
        paper.doi = merged.doi;
        filled.push("doi");
      } else fillField("doi", merged.doi);
      fillField("arxiv", merged.arxiv || existingArxivDoi);
      if (remote?.paperId) paper.semanticScholarPaperId = remote.paperId;
      if (merged.serpApiResultId) paper.serpApiResultId = merged.serpApiResultId;
      if (merged.serpApiCitesId) paper.serpApiCitesId = merged.serpApiCitesId;
      if (Number.isFinite(merged.serpApiCitationCount)) {
        paper.serpApiCitationCount = merged.serpApiCitationCount;
      }
      if (merged.serpApiSourceUrl) paper.serpApiSourceUrl = merged.serpApiSourceUrl;
      const shouldCorrectInvalidYear = merged.year && paper.year !== merged.year
        && !isPlausiblePaperYear(paper.year, paper.arxiv || merged.arxiv);
      if ((shouldUpgradeVenue || shouldCorrectInvalidYear) && merged.year && paper.year !== merged.year) {
        paper.year = merged.year;
        filled.push("year");
      } else if (!paper.year && merged.year) {
        paper.year = merged.year;
        filled.push("year");
      }
      const upgradeChineseAuthors = hasCjkText(merged.title || paper.title)
        && (merged.authors || []).some(hasCjkText)
        && !(paper.authors || []).some(hasCjkText);
      if ((!(paper.authors || []).length || upgradeChineseAuthors) && (merged.authors || []).length) {
        paper.authors = merged.authors;
        filled.push("authors");
      }
      if (!(paper.tags || []).length && (merged.tags || []).length) {
        paper.tags = normalizePaperTags(merged.tags);
        filled.push("tags");
      }
      if (remote?.source) {
        paper.metadataSource = local ? `PDF + ${remote.source}` : remote.source;
      }
      try { await this.enrichPaperVenueRanks(paper, { force: true }); }
      catch (error) { console.warn("Paper Library: refreshed venue rank lookup unavailable", error); }
      // Metadata may have been corrected on another device or by an earlier
      // refresh. Always reconcile the managed PDF/note paths instead of only
      // doing so in the narrow low-confidence-title replacement branch.
      try { await this.organizePaperFiles(paper); }
      catch (error) { console.warn("Paper Library: refreshed file organization unavailable", error); }
      await this.syncPaperNoteTags(paper);
      const venueRanksAfter = this.formatVenueRanksInput(this.getPaperVenueRanks(paper));
      if (venueRanksAfter && venueRanksAfter !== venueRanksBefore) filled.push("venueRanks");
      await this.saveSettings();
      const labels = {
        abstract: "摘要", title: "标题", venue: "期刊/会议", doi: "DOI",
        arxiv: "arXiv ID", year: "年份", authors: "作者", tags: "标签",
        venueRanks: "期刊/会议等级"
      };
      progress.hide?.();
      new Notice(filled.length
        ? `论文信息已刷新，补充了：${filled.map((key) => labels[key] || key).join("、")}`
        : "论文信息已刷新，未发现需要补充的字段");
    } catch (error) {
      console.error("Paper Library: paper info refresh failed", error);
      progress.hide?.();
      new Notice(`论文信息刷新失败：${error?.message || "请稍后重试"}`);
    } finally {
      this.infoLoading.delete(paper.id);
      this.refreshPaperPresentation({ table: true, detail: true, navigation: true });
    }
  }

  async repairMisreadPdfPublicationMetadata() {
    let changed = false;
    for (const paper of this.settings.papers) {
      const arxiv = paper.arxiv || arxivIdFromDoi(paper.doi);
      const badYear = !isPlausiblePaperYear(paper.year, arxiv);
      const ambiguousVenue = this.isAmbiguousConferenceVenue(paper.venue);
      if (!badYear && !ambiguousVenue) continue;
      const file = paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath)
        ? this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath))
        : null;
      let local = null;
      if (file?.extension === "pdf") {
        try {
          local = await this.extractLocalPdfMetadata(await this.app.vault.readBinary(file), paper.originalPdfName || file.name);
        } catch (error) {
          console.warn(`Paper Library: metadata repair skipped for ${paper.title}`, error);
        }
      }
      const correctedYear = local?.year || yearFromArxivId(arxiv);
      if (badYear && correctedYear && paper.year !== correctedYear) {
        paper.year = correctedYear;
        changed = true;
      }
      if (ambiguousVenue && local && normalizeVenueLookup(local.venue) !== normalizeVenueLookup(paper.venue)) {
        paper.venue = local.venue || "";
        paper.venueRanks = [];
        changed = true;
      }
    }
    if (changed) await this.saveSettings();
    return changed;
  }

  mergePaperMetadata(local, remote) {
    const localArxiv = local.arxiv || arxivIdFromDoi(local.doi);
    if (!remote) return {
      ...local,
      doi: isArxivDoi(local.doi) ? "" : local.doi,
      arxiv: localArxiv
    };
    const choose = (key) => remote[key] || local[key] || "";
    const remoteIsPreprint = ["posted-content", "posted_content", "preprint"].includes(
      String(remote.publicationType || "").toLocaleLowerCase()
    );
    const localVenueIsMoreSpecific = local.venue && isRepositoryVenue(remote.venue) && !isRepositoryVenue(local.venue);
    const selectedDoi = remoteIsPreprint && localArxiv
      ? (isArxivDoi(local.doi) ? "" : local.doi)
      : choose("doi");
    return {
      title: choose("title"),
      authors: chooseMetadataAuthors(local.authors, remote.authors, choose("title")),
      year: remoteIsPreprint && isPlausiblePaperYear(local.year, localArxiv)
        ? local.year
        : (remote.year || (isPlausiblePaperYear(local.year, localArxiv) ? local.year : yearFromArxivId(localArxiv))),
      venue: localVenueIsMoreSpecific ? local.venue : choose("venue"),
      journalAbbreviation: choose("journalAbbreviation"),
      volume: choose("volume"),
      issue: choose("issue"),
      pages: choose("pages"),
      abstract: choose("abstract"),
      tags: normalizePaperTags([...(remote.tags || []), ...(local.tags || [])]).slice(0, 12),
      doi: isArxivDoi(selectedDoi) ? "" : selectedDoi,
      arxiv: remote.arxiv || localArxiv || arxivIdFromDoi(remote.doi),
      semanticScholarPaperId: remote.paperId || local.semanticScholarPaperId || "",
      serpApiResultId: remote.serpApiResultId || local.serpApiResultId || "",
      serpApiCitesId: remote.serpApiCitesId || local.serpApiCitesId || "",
      serpApiCitationCount: Number.isFinite(remote.citationCount)
        ? remote.citationCount
        : (Number.isFinite(local.serpApiCitationCount) ? local.serpApiCitationCount : null),
      serpApiSourceUrl: remote.sourceUrl || local.serpApiSourceUrl || ""
    };
  }

  findDuplicatePaper(metadata) {
    const doi = String(metadata.doi || "").toLocaleLowerCase();
    const arxiv = String(metadata.arxiv || "").toLocaleLowerCase();
    return this.settings.papers.find((paper) => (
      (doi && String(paper.doi || "").toLocaleLowerCase() === doi)
      || (arxiv && String(paper.arxiv || "").toLocaleLowerCase() === arxiv)
      || titleSimilarity(paper.title, metadata.title) > 0.96
    )) || null;
  }

  async ensureVaultFolder(folderPath) {
    const segments = normalizePath(folderPath).split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try { await this.app.vault.createFolder(current); }
        catch (error) {
          // Parallel batch workers may discover the same missing directory and
          // race to create it. Treat the second creation as success.
          if (!this.app.vault.getAbstractFileByPath(current)) throw error;
        }
      }
    }
  }

  getLibraryFolder() {
    const candidate = normalizePath(this.settings.libraryFolder || this.settings.notesFolder || "Papers")
      .replace(/^\/+|\/+$/g, "");
    if (!candidate || candidate.split("/").includes("..")) return "Papers";
    return candidate;
  }

  getOrganizedPaperPaths(paper, suffix = "") {
    const collection = safeCollectionPath((paper.collections || [])[0] || "Uncategorized") || "Uncategorized";
    const year = Number.parseInt(paper.year, 10) || "Unknown year";
    const title = safeFileName(paper.title || "Untitled paper") || "Untitled paper";
    const base = normalizePath(`${this.getLibraryFolder()}/${collection}/${year}/${title}${suffix}`);
    return { folder: base.slice(0, base.lastIndexOf("/")), pdfPath: `${base}.pdf`, notePath: `${base}.md` };
  }

  getAvailableOrganizedPaperPaths(paper, currentPaths = []) {
    const current = new Set(currentPaths.filter(Boolean).map((path) => normalizePath(path)));
    let suffix = "";
    let index = 2;
    while (true) {
      const paths = this.getOrganizedPaperPaths(paper, suffix);
      const occupied = [paths.pdfPath, paths.notePath].some((path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file && !current.has(normalizePath(file.path || path));
      });
      if (!occupied) return paths;
      suffix = `-${index}`;
      index += 1;
    }
  }

  isManagedPaperPath(path) {
    const normalized = normalizePath(path || "");
    const roots = [
      this.getLibraryFolder(),
      this.settings.notesFolder,
      this.settings.pdfsFolder
    ].filter(Boolean).map((root) => normalizePath(root).replace(/\/+$/g, ""));
    return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
  }

  async renamePaperFile(file, targetPath) {
    const folder = targetPath.slice(0, targetPath.lastIndexOf("/"));
    if (folder) await this.ensureVaultFolder(folder);
    if (this.app.fileManager?.renameFile) await this.app.fileManager.renameFile(file, targetPath);
    else await this.app.vault.rename(file, targetPath);
    return this.app.vault.getAbstractFileByPath(targetPath) || { ...file, path: targetPath };
  }

  async organizePaperFiles(paper) {
    if (!this.app?.vault?.getAbstractFileByPath) return this.getOrganizedPaperPaths(paper);
    const oldPdfPath = paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath)
      ? normalizePath(paper.pdfPath)
      : "";
    const oldNotePath = paper.notePath ? normalizePath(paper.notePath) : "";
    const pdfFile = oldPdfPath ? this.app.vault.getAbstractFileByPath(oldPdfPath) : null;
    const noteFile = oldNotePath ? this.app.vault.getAbstractFileByPath(oldNotePath) : null;
    const targets = this.getAvailableOrganizedPaperPaths(paper, [oldPdfPath, oldNotePath]);
    let activeNote = noteFile;

    if (pdfFile && this.isManagedPaperPath(oldPdfPath) && oldPdfPath !== targets.pdfPath) {
      await this.renamePaperFile(pdfFile, targets.pdfPath);
      paper.pdfPath = targets.pdfPath;
      this.rebasePaperPdfMarkPaths(paper, oldPdfPath, targets.pdfPath);
    }
    if (noteFile && this.isManagedPaperPath(oldNotePath) && oldNotePath !== targets.notePath) {
      activeNote = await this.renamePaperFile(noteFile, targets.notePath);
      paper.notePath = targets.notePath;
    }
    if (!noteFile && (!oldNotePath || this.isManagedPaperPath(oldNotePath))) {
      paper.notePath = targets.notePath;
    }
    for (const attachment of (paper.attachments || [])) {
      const oldAttachmentPath = normalizePath(attachment.path || "");
      const attachmentFile = oldAttachmentPath ? this.app.vault.getAbstractFileByPath(oldAttachmentPath) : null;
      if (!attachmentFile || !this.isManagedPaperPath(oldAttachmentPath)) continue;
      const originalName = safeFileName(attachment.name || oldAttachmentPath.split("/").pop() || "Supplement.pdf") || "Supplement.pdf";
      const baseName = originalName.toLocaleLowerCase().endsWith(".pdf") ? originalName.slice(0, -4) : originalName;
      let target = normalizePath(`${targets.folder}/${baseName}.pdf`);
      let suffix = 2;
      while (this.app.vault.getAbstractFileByPath(target) && target !== oldAttachmentPath) {
        target = normalizePath(`${targets.folder}/${baseName}-${suffix}.pdf`);
        suffix += 1;
      }
      if (target !== oldAttachmentPath) {
        await this.renamePaperFile(attachmentFile, target);
        this.rebasePaperPdfMarkPaths(paper, oldAttachmentPath, target);
      }
      attachment.path = target;
      attachment.name = target.split("/").pop();
    }

    if (activeNote && oldPdfPath && paper.pdfPath && oldPdfPath !== paper.pdfPath) {
      try {
        const content = await this.app.vault.read(activeNote);
        const updated = content.split(oldPdfPath).join(paper.pdfPath);
        if (updated !== content) await this.app.vault.modify(activeNote, updated);
      } catch (error) {
        console.warn("Paper Library: failed to update PDF links in moved note", error);
      }
    }
    return targets;
  }

  async organizeLibraryFiles(showNotice = false) {
    let changed = 0;
    let failed = 0;
    for (const paper of this.settings.papers) {
      const before = `${paper.pdfPath || ""}\n${paper.notePath || ""}`;
      try {
        await this.organizePaperFiles(paper);
        if (`${paper.pdfPath || ""}\n${paper.notePath || ""}` !== before) changed += 1;
      } catch (error) {
        failed += 1;
        console.warn(`Paper Library: failed to organize files for ${paper.title}`, error);
      }
    }
    await this.saveSettings();
    if (showNotice) {
      new Notice(failed
        ? `已整理 ${changed} 篇论文，${failed} 篇因路径冲突或文件错误未完成`
        : `文件整理完成：已更新 ${changed} 篇论文`);
    }
    return { changed, failed };
  }

  async saveDroppedPdf(pendingPdf, desiredPath = "") {
    let path = normalizePath(desiredPath || `${this.settings.pdfsFolder || "Papers/PDFs"}/${pendingPdf.name}`);
    if (!path.toLocaleLowerCase().endsWith(".pdf")) path += ".pdf";
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("PDF 路径必须位于当前 Vault 内");
    const parts = path.split("/");
    let originalName = safeFileName(parts.pop() || pendingPdf.name) || "paper.pdf";
    if (!originalName.toLocaleLowerCase().endsWith(".pdf")) originalName = `${originalName.replace(/\.+$/g, "")}.pdf`;
    const folder = parts.join("/");
    path = normalizePath(folder ? `${folder}/${originalName}` : originalName);
    if (folder) await this.ensureVaultFolder(folder);
    const base = path.replace(/\.pdf$/i, "");
    let available = path;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(available)) {
      available = `${base}-${suffix}.pdf`;
      suffix += 1;
    }
    await this.app.vault.createBinary(available, pendingPdf.buffer.slice(0));
    return available;
  }

  formatFileSize(bytes) {
    const size = Number(bytes) || 0;
    if (!size) return "大小未知";
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 ** 2)).toFixed(1)} MB`;
  }

  getPaperAttachmentItems(paper) {
    const items = [];
    if (paper.pdfPath) {
      const file = !/^https?:\/\//i.test(paper.pdfPath)
        ? this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath))
        : null;
      items.push({
        id: "primary",
        kind: "primary",
        path: paper.pdfPath,
        name: paper.pdfPath.split("/").pop() || `${paper.title}.pdf`,
        size: paper.pdfMeta?.size || file?.stat?.size || 0,
        pageCount: paper.pdfMeta?.pageCount || 0
      });
    }
    (paper.attachments || []).forEach((attachment) => {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(attachment.path || ""));
      items.push({
        ...attachment,
        kind: "supplement",
        name: attachment.name || attachment.path?.split("/").pop() || "Supplement.pdf",
        size: attachment.size || file?.stat?.size || 0,
        pageCount: attachment.pageCount || 0
      });
    });
    return items;
  }

  async inspectPdfBuffer(buffer) {
    let document = null;
    try {
      const pdfjs = await loadPdfJs();
      const source = buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      document = await pdfjs.getDocument({ data: new Uint8Array(source) }).promise;
      return { pageCount: Number(document.numPages) || 0, size: source.byteLength };
    } finally {
      await document?.destroy?.();
    }
  }

  async ensurePaperAttachmentMetadata(paper, item) {
    if (!item?.path || /^https?:\/\//i.test(item.path)) return { size: item?.size || 0, pageCount: item?.pageCount || 0 };
    if (item.size && item.pageCount) return { size: item.size, pageCount: item.pageCount };
    this.attachmentMetadataLoading = this.attachmentMetadataLoading || new Map();
    const key = normalizePath(item.path);
    if (this.attachmentMetadataLoading.has(key)) return this.attachmentMetadataLoading.get(key);
    const task = (async () => {
      try {
        const file = this.app.vault.getAbstractFileByPath(key);
        if (!file) return null;
        const buffer = await this.app.vault.readBinary(file);
        const metadata = await this.inspectPdfBuffer(buffer);
        metadata.size = file.stat?.size || metadata.size;
        if (item.kind === "primary") paper.pdfMeta = metadata;
        else {
          const record = (paper.attachments || []).find((attachment) => attachment.id === item.id || attachment.path === item.path);
          if (record) Object.assign(record, metadata);
        }
        Object.assign(item, metadata);
        await this.saveSettings();
        return metadata;
      } catch (error) {
        console.warn(`Paper Library: failed to read attachment metadata for ${item.path}`, error);
        return null;
      } finally {
        this.attachmentMetadataLoading.delete(key);
      }
    })();
    this.attachmentMetadataLoading.set(key, task);
    return task;
  }

  renderPdfThumbnail(...args) {
    return renderPdfThumbnail(this, ...args);
  }

  async addPaperAttachments(paper, files) {
    const pdfFiles = (files || []).filter((file) => file?.type === "application/pdf" || file?.name?.toLocaleLowerCase().endsWith(".pdf"));
    if (!pdfFiles.length) return new Notice("请选择 PDF 文件");
    paper.attachments = Array.isArray(paper.attachments) ? paper.attachments : [];
    const organized = this.getOrganizedPaperPaths(paper);
    const primaryFolder = paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath) && paper.pdfPath.includes("/")
      ? normalizePath(paper.pdfPath).split("/").slice(0, -1).join("/")
      : organized.folder;
    let added = 0;
    let failed = 0;
    for (const file of pdfFiles) {
      try {
        const buffer = await file.arrayBuffer();
        const header = new TextDecoder("latin1").decode(buffer.slice(0, 5));
        if (header !== "%PDF-") throw new Error("文件内容不是有效的 PDF");
        const desired = normalizePath(`${primaryFolder}/${safeFileName(file.name) || "Supplement.pdf"}`);
        const path = await this.saveDroppedPdf({ name: file.name, buffer }, desired);
        const metadata = await this.inspectPdfBuffer(buffer).catch(() => ({ pageCount: 0, size: buffer.byteLength }));
        if (!paper.pdfPath) {
          paper.pdfPath = path;
          paper.pdfMeta = metadata;
        } else {
          paper.attachments.push({
            id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: path.split("/").pop(),
            path,
            size: metadata.size || buffer.byteLength,
            pageCount: metadata.pageCount || 0,
            addedAt: new Date().toISOString()
          });
        }
        added += 1;
      } catch (error) {
        failed += 1;
        console.error(`Paper Library: failed to add attachment ${file?.name || ""}`, error);
      }
    }
    await this.saveSettings();
    this.refreshViews();
    new Notice(failed ? `已添加 ${added} 个 PDF，${failed} 个失败` : `已添加 ${added} 个 PDF`);
    return { added, failed };
  }

  async copyText(value) {
    if (globalThis.navigator?.clipboard?.writeText) return globalThis.navigator.clipboard.writeText(String(value || ""));
    return Promise.resolve();
  }

  showAttachmentMenu(event, paper, item) {
    const menu = new Menu();
    menu.addItem((entry) => entry.setTitle("复制 Vault 路径").setIcon("copy").onClick(async () => {
      await this.copyText(item.path);
      new Notice("附件路径已复制");
    }));
    if (item.kind === "primary") {
      menu.addItem((entry) => entry.setTitle("打开论文笔记").setIcon("notebook-pen").onClick(() => this.openOrCreateNote(paper)));
    } else {
      menu.addItem((entry) => entry.setTitle("设为主 PDF").setIcon("file-check-2").onClick(() => this.setPrimaryAttachment(paper, item)));
      menu.addSeparator();
      menu.addItem((entry) => entry.setTitle("从附件列表移除").setIcon("unlink").onClick(async () => {
        paper.attachments = (paper.attachments || []).filter((attachment) => attachment.id !== item.id);
        await this.saveSettings();
        this.refreshViews();
        new Notice("附件已从论文中移除，Vault 文件仍然保留");
      }));
    }
    menu.showAtMouseEvent(event);
  }

  async setPrimaryAttachment(paper, item) {
    if (!item?.path || item.kind === "primary") return;
    const oldPath = paper.pdfPath || "";
    const oldFile = oldPath && !/^https?:\/\//i.test(oldPath) ? this.app.vault.getAbstractFileByPath(normalizePath(oldPath)) : null;
    paper.attachments = (paper.attachments || []).filter((attachment) => attachment.id !== item.id);
    if (oldPath) {
      paper.attachments.unshift({
        id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: oldPath.split("/").pop() || `${paper.title}.pdf`,
        path: oldPath,
        size: paper.pdfMeta?.size || oldFile?.stat?.size || 0,
        pageCount: paper.pdfMeta?.pageCount || 0,
        addedAt: new Date().toISOString()
      });
    }
    paper.pdfPath = item.path;
    paper.pdfMeta = { size: item.size || 0, pageCount: item.pageCount || 0 };
    if (paper.notePath) {
      try {
        const note = this.app.vault.getAbstractFileByPath(normalizePath(paper.notePath));
        if (note) {
          const content = await this.app.vault.read(note);
          const updated = content.replace(/^pdf:\s*.*$/m, `pdf: "${paper.pdfPath.replace(/"/g, "\\\"")}"`);
          if (updated !== content) await this.app.vault.modify(note, updated);
        }
      } catch (error) {
        console.warn("Paper Library: failed to update primary PDF in note", error);
      }
    }
    await this.saveSettings();
    this.refreshViews();
    new Notice("主 PDF 已更新");
  }

  resolveCitationStyle(value = "") {
    const all = [...CITATION_STYLES, ...(this.settings?.customCitationStyles || [])];
    const normalized = String(value || this.uiState?.exportStyle || "apa-7").trim().toLocaleLowerCase();
    return all.find((style) => style.id === normalized || style.label.toLocaleLowerCase() === normalized)
      || all.find((style) => style.label.toLocaleLowerCase().includes(normalized))
      || all[0];
  }

  listCitationStyles() {
    return [...CITATION_STYLES, ...(this.settings?.customCitationStyles || [])];
  }

  async saveCustomCitationStyle(style) {
    this.settings.customCitationStyles = (this.settings.customCitationStyles || [])
      .filter((item) => item.id !== style.id);
    this.settings.customCitationStyles.push(style);
    await this.saveSettings();
    this.refreshViews();
  }

  async deleteCustomCitationStyle(id) {
    this.settings.customCitationStyles = (this.settings.customCitationStyles || [])
      .filter((item) => item.id !== id);
    if (this.uiState?.exportStyle === id) this.uiState.exportStyle = "apa-7";
    await this.saveSettings();
    this.refreshViews();
    new Notice("引用样式已删除");
  }

  async importCslCitationStyle(styleId) {
    const id = String(styleId || "").trim().toLocaleLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) throw new Error("请输入期刊名或样式 ID");
    const fetchCsl = async (target) => {
      for (const prefix of ["", "dependent/"]) {
        const response = await requestUrl({
          url: `https://raw.githubusercontent.com/citation-style-language/styles/master/${prefix}${encodeURIComponent(target)}.csl`,
          throw: false
        });
        if (response.status === 200) return response.text;
        if (response.status !== 404) throw new Error(`下载失败（HTTP ${response.status}）`);
      }
      throw new Error(`CSL 样式库中没有 “${target}”，请先在上方搜索期刊名，或到 zotero.org/styles 查询正确的 ID`);
    };
    let parsed = parseCslStyleToTemplate(await fetchCsl(id), id);
    let label = parsed.label;
    if (parsed.dependent) {
      if (!parsed.parent) throw new Error("这是一个依赖样式，但找不到它的父样式");
      const dependentLabel = label;
      parsed = parseCslStyleToTemplate(await fetchCsl(parsed.parent), parsed.parent);
      label = dependentLabel || parsed.label;
    }
    if (!parsed.template || !parsed.template.includes("{")) throw new Error("解析出的模板为空，该样式可能不含期刊论文格式");
    const style = {
      id: `csl-${id}`,
      label,
      template: parsed.template,
      authors: parsed.authors || {},
      source: "csl",
      cslId: id,
      warnings: parsed.warnings || [],
      importedAt: new Date().toISOString()
    };
    await this.saveCustomCitationStyle(style);
    return style;
  }

  async getCslStyleIndex(force = false) {
    const cache = this.cslStyleIndexCache;
    if (!force && cache && Date.now() - cache.at < 24 * 60 * 60 * 1000) return cache.styles;
    const response = await requestUrl({
      url: "https://www.zotero.org/styles-files/styles.json",
      throw: false
    });
    if (response.status !== 200) throw new Error(`样式索引下载失败（HTTP ${response.status}）`);
    const styles = (Array.isArray(response.json) ? response.json : [])
      .filter((entry) => entry?.name && entry?.title);
    this.cslStyleIndexCache = { at: Date.now(), styles };
    return styles;
  }

  async searchCslStyles(query, limit = 8) {
    const q = String(query || "").trim().toLocaleLowerCase();
    if (q.length < 2) return [];
    const styles = await this.getCslStyleIndex();
    const scored = [];
    for (const entry of styles) {
      const title = String(entry.title).toLocaleLowerCase();
      const name = String(entry.name).toLocaleLowerCase();
      let score = -1;
      if (title === q || name === q) score = 100;
      else if (title.startsWith(q)) score = 80;
      else if (name.startsWith(q)) score = 70;
      else if (title.includes(q)) score = 50;
      else if (name.includes(q)) score = 40;
      if (score >= 0) scored.push([score, entry]);
    }
    return scored
      .sort((a, b) => b[0] - a[0] || String(a[1].title).localeCompare(String(b[1].title)))
      .slice(0, limit)
      .map(([, entry]) => entry);
  }

  formatCitation(paper, styleId = "apa-7", mode = "plain") {
    const style = this.resolveCitationStyle(styleId);
    return renderCitationTemplate(style, citationFieldBag(paper), { mode });
  }

  getPaperExportRecord(paper) {
    return {
      title: paper.title || "",
      authors: [...(paper.authors || [])],
      year: paper.year || "",
      venue: paper.venue || "",
      volume: paper.volume || "",
      issue: paper.issue || "",
      pages: paper.pages || "",
      journalAbbreviation: paper.journalAbbreviation || "",
      venueRanks: this.getPaperVenueRanks(paper),
      doi: normalizeDoiInput(paper.doi),
      arxiv: paper.arxiv || "",
      abstract: paper.abstract || "",
      tags: [...(paper.tags || [])],
      collections: [...(paper.collections || [])],
      pdfPath: paper.pdfPath || "",
      notePath: paper.notePath || "",
      attachments: (paper.attachments || []).map(({ name, path, size, pageCount }) => ({ name, path, size, pageCount }))
    };
  }

  citationKey(paper) {
    const family = citationFamilyName(paper.authors?.[0]).replace(/[^\p{L}\p{N}]+/gu, "");
    const word = normalizeTitleForMatch(paper.title).split(" ").find((part) => part.length > 3) || "paper";
    return `${family || "paper"}${paper.year || "nd"}${word}`;
  }

  buildBibTeX(paper) {
    const conference = /\b(?:conference|proceedings|nips|neurips|icml|iclr|cvpr|eccv|iccv|hpca)\b/i.test(paper.venue || "");
    const fields = [
      ["title", `{${String(paper.title || "").replace(/[{}]/g, "")}}`],
      ["author", `{${(paper.authors || []).join(" and ")}}`],
      ["year", `{${paper.year || ""}}`],
      [conference ? "booktitle" : "journal", `{${String(paper.venue || "").replace(/[{}]/g, "")}}`],
      paper.doi ? ["doi", `{${normalizeDoiInput(paper.doi)}}`] : null,
      paper.arxiv ? ["eprint", `{${paper.arxiv}}`] : null,
      paper.arxiv ? ["archivePrefix", `{arXiv}`] : null,
      paper.abstract ? ["abstract", `{${String(paper.abstract).replace(/[{}]/g, "")}}`] : null
    ].filter((field) => field && field[1] !== "{}");
    return `@${conference ? "inproceedings" : "article"}{${this.citationKey(paper)},\n${fields.map(([key, value]) => `  ${key} = ${value}`).join(",\n")}\n}\n`;
  }

  buildRis(paper) {
    const lines = [
      `TY  - ${/\b(?:conference|proceedings|nips|neurips|hpca)\b/i.test(paper.venue || "") ? "CPAPER" : "JOUR"}`,
      `TI  - ${paper.title || ""}`,
      ...(paper.authors || []).map((author) => `AU  - ${author}`),
      `PY  - ${paper.year || ""}`,
      paper.venue ? `T2  - ${paper.venue}` : "",
      paper.doi ? `DO  - ${normalizeDoiInput(paper.doi)}` : "",
      paper.abstract ? `AB  - ${String(paper.abstract).replace(/\s+/g, " ")}` : "",
      ...(paper.tags || []).map((tag) => `KW  - ${tag}`),
      paper.pdfPath ? `L1  - ${paper.pdfPath}` : "",
      "ER  - "
    ];
    return `${lines.filter(Boolean).join("\n")}\n`;
  }

  buildCsv(paper) {
    const record = this.getPaperExportRecord(paper);
    const headers = ["Title", "Authors", "Year", "Venue", "Venue Rankings", "DOI", "arXiv", "Tags", "Collections", "PDF Path", "Note Path", "Abstract"];
    const values = [record.title, record.authors.join("; "), record.year, record.venue, this.formatVenueRanksInput(record.venueRanks), record.doi, record.arxiv,
      record.tags.join("; "), record.collections.join("; "), record.pdfPath, record.notePath, record.abstract];
    return `\ufeff${headers.map(csvEscape).join(",")}\r\n${values.map(csvEscape).join(",")}\r\n`;
  }

  buildXlsx(paper) {
    const record = this.getPaperExportRecord(paper);
    const headers = ["Title", "Authors", "Year", "Venue", "Venue Rankings", "DOI", "arXiv", "Tags", "Collections", "PDF Path", "Note Path", "Abstract"];
    const values = [record.title, record.authors.join("; "), record.year, record.venue, this.formatVenueRanksInput(record.venueRanks), record.doi, record.arxiv,
      record.tags.join("; "), record.collections.join("; "), record.pdfPath, record.notePath, record.abstract];
    const cell = (value, column, row) => `<c r="${column}${row}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    const columns = headers.map((_, index) => String.fromCharCode(65 + index));
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headers.map((value, index) => cell(value, columns[index], 1)).join("")}</row><row r="2">${values.map((value, index) => cell(value, columns[index], 2)).join("")}</row></sheetData></worksheet>`;
    return createStoredZip([
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Paper" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
      ["xl/worksheets/sheet1.xml", sheet]
    ]);
  }

  buildPaperExport(paper, format) {
    if (format === "bib") return this.buildBibTeX(paper);
    if (format === "ris") return this.buildRis(paper);
    if (format === "csv") return this.buildCsv(paper);
    if (format === "xlsx") return this.buildXlsx(paper);
    if (format === "json") return `${JSON.stringify(this.getPaperExportRecord(paper), null, 2)}\n`;
    throw new Error(`Unsupported export format: ${format}`);
  }

  downloadFile(fileName, data, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportPaper(paper, format) {
    try {
      const extensions = { bib: "bib", ris: "ris", csv: "csv", xlsx: "xlsx", json: "json" };
      const mime = {
        bib: "application/x-bibtex;charset=utf-8", ris: "application/x-research-info-systems;charset=utf-8",
        csv: "text/csv;charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        json: "application/json;charset=utf-8"
      };
      const extension = extensions[format];
      if (!extension) throw new Error("不支持的导出格式");
      this.downloadFile(`${safeFileName(paper.title || "paper")}.${extension}`, this.buildPaperExport(paper, format), mime[format]);
      new Notice(`已导出 ${extension.toLocaleUpperCase()} 文件`);
    } catch (error) {
      console.error("Paper Library: export failed", error);
      new Notice(`导出失败：${error.message || error}`);
    }
  }

  getPaperForPdfFile(file) {
    if (!file?.path) return null;
    const path = normalizePath(file.path);
    return this.settings.papers.find((paper) => (
      (paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath) && normalizePath(paper.pdfPath) === path)
      || (paper.attachments || []).some((attachment) => normalizePath(attachment.path || "") === path)
    )) || null;
  }

  getCanonicalPaper(paper) {
    if (!paper?.id) return paper || null;
    return (this.settings?.papers || []).find((item) => item.id === paper.id) || paper;
  }

  getPaperPdfMarkRecords(paper) {
    if (!paper) return [];
    const workspace = paper.researchWorkspace && typeof paper.researchWorkspace === "object"
      ? paper.researchWorkspace
      : {};
    return [
      ...(Array.isArray(paper.annotations) ? paper.annotations : []),
      ...(Array.isArray(workspace.highlights) ? workspace.highlights : []),
      ...(Array.isArray(workspace.inkStrokes) ? workspace.inkStrokes : []),
      ...(Array.isArray(workspace.nodes) ? workspace.nodes : [])
    ];
  }

  rebasePaperPdfMarkPaths(paper, oldPath, newPath) {
    const from = normalizePath(oldPath || "");
    const to = normalizePath(newPath || "");
    if (!paper || !from || !to || from === to) return 0;
    let changed = 0;
    this.getPaperPdfMarkRecords(paper).forEach((record) => {
      if (normalizePath(record?.pdfPath || "") !== from) return;
      record.pdfPath = to;
      if (typeof record.link === "string" && record.link.startsWith(`${from}#`)) {
        record.link = `${to}${record.link.slice(from.length)}`;
      }
      changed += 1;
    });
    return changed;
  }

  repairOrphanedPaperPdfMarkPaths(paper) {
    const target = normalizePath(paper?.pdfPath || "");
    if (!paper || !target || /^https?:\/\//i.test(target)) return 0;
    const validPaths = new Set([
      target,
      ...(paper.attachments || []).map((attachment) => normalizePath(attachment.path || ""))
    ].filter(Boolean));
    const stalePaths = new Set(this.getPaperPdfMarkRecords(paper)
      .map((record) => normalizePath(record?.pdfPath || ""))
      .filter((path) => path && !validPaths.has(path)));
    let changed = 0;
    stalePaths.forEach((path) => {
      if (this.app?.vault?.getAbstractFileByPath?.(path)) return;
      changed += this.rebasePaperPdfMarkPaths(paper, path, target);
    });
    return changed;
  }

  async handleManagedPdfRename(file, oldPath) {
    const from = normalizePath(oldPath || "");
    const to = normalizePath(file?.path || "");
    if (!from || !to || from === to || String(file?.extension || "").toLocaleLowerCase() !== "pdf") return false;
    const paper = (this.settings.papers || []).find((item) => (
      normalizePath(item.pdfPath || "") === from
      || (item.attachments || []).some((attachment) => normalizePath(attachment.path || "") === from)
    ));
    if (!paper) return false;
    if (normalizePath(paper.pdfPath || "") === from) paper.pdfPath = to;
    (paper.attachments || []).forEach((attachment) => {
      if (normalizePath(attachment.path || "") !== from) return;
      attachment.path = to;
      attachment.name = to.split("/").pop() || attachment.name;
    });
    this.rebasePaperPdfMarkPaths(paper, from, to);
    await this.saveSettings();
    this.refreshViews();
    this.refreshResearchPdfHighlights(paper);
    return true;
  }

  pdfColor(colorId) {
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === String(colorId || "").toLocaleLowerCase())
      || CANVAS_HIGHLIGHT_COLORS[0];
    const value = color.value.replace("#", "");
    return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  }

  pdfDate(date = new Date()) {
    return `D:${date.toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;
  }

  async mutateLocalPdf(pdfPath, mutate) {
    const path = normalizePath(pdfPath || "");
    if (!path || /^https?:\/\//i.test(path) || !this.app.vault?.modifyBinary) return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("找不到本地 PDF 文件");
    const previous = this.pdfMutationQueues.get(path) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const source = await this.readPdfBinary(file);
      const sourceBytes = new Uint8Array(source);
      if (bytesContainAscii(sourceBytes, "/ByteRange") || bytesContainAscii(sourceBytes, "/Type/Sig")
        || bytesContainAscii(sourceBytes, "/Type /Sig")) {
        throw new Error("该 PDF 含数字签名，写入批注会使签名失效，已保留插件内批注但未修改原文件");
      }
      const document = await PDFDocument.load(source, { updateMetadata: false });
      const changed = await mutate(document);
      if (!changed) return false;
      const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
      if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("PDF 序列化失败");
      const output = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await this.app.vault.modifyBinary(file, output);
      return true;
    });
    this.pdfMutationQueues.set(path, current);
    try {
      return await current;
    } finally {
      if (this.pdfMutationQueues.get(path) === current) this.pdfMutationQueues.delete(path);
    }
  }

  async upsertLocalPdfAnnotation(mark) {
    if (!mark?.pdfPath) return false;
    if (mark.pdfSubtype !== "FreeText" && (!Array.isArray(mark.pdfRects) || !mark.pdfRects.length)) return false;
    return this.mutateLocalPdf(mark.pdfPath, async (document) => this.writeLocalPdfAnnotation(document, mark));
  }

  writeLocalPdfAnnotation(document, mark) {
    {
      const page = document.getPage(Math.max(0, Number(mark.page || 1) - 1));
      if (!page) throw new Error("PDF 页码不存在");
      const annotationId = `paperlib:${mark.pdfAnnotationId || mark.id}`;
      const annotsName = PDFName.of("Annots");
      let annots = page.node.lookupMaybe(annotsName, PDFArray);
      if (!annots) {
        annots = document.context.obj([]);
        page.node.set(annotsName, annots);
      }
      for (let index = annots.size() - 1; index >= 0; index -= 1) {
        const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
        if (!dictionary) continue;
        const idValue = document.context.lookupMaybe(dictionary.get(PDFName.of("NM")), PDFString, PDFHexString);
        const value = idValue?.decodeText?.() || idValue?.asString?.() || "";
        if (value === annotationId) annots.remove(index);
      }
      const subtype = mark.pdfSubtype === "Text" ? "Text"
        : mark.pdfSubtype === "Underline" ? "Underline"
          : mark.pdfSubtype === "FreeText" ? "FreeText" : "Highlight";
      const color = this.pdfColor(mark.color);
      let rect;
      if (subtype === "FreeText") {
        // 自由文本框：位置来自页面相对坐标，换算成 PDF 点
        const size = page.getSize?.() || { width: 612, height: 792 };
        const box = mark.box || { x: 0.6, y: 0.3, width: 0.32 };
        const width = Math.max(48, (Number(box.width) || 0.32) * size.width);
        const x = Math.max(0, Math.min(size.width - width, (Number(box.x) || 0.6) * size.width));
        const yTop = (1 - Math.max(0, Math.min(1, Number(box.y) || 0.3))) * size.height;
        const contentText = String(mark.comment || mark.text || "");
        const lines = Math.max(1, Math.ceil(contentText.length / Math.max(8, Math.floor(width / 5))));
        const height = Math.max(20, lines * 12 + 8);
        rect = [x, Math.max(0, yTop - height), Math.min(size.width, x + width), yTop];
      } else {
        const allRects = (mark.pdfRects || []).map((item) => item.rect).filter((item) => item?.length === 4);
        rect = [
          Math.min(...allRects.map((item) => item[0])),
          Math.min(...allRects.map((item) => item[1])),
          Math.max(...allRects.map((item) => item[2])),
          Math.max(...allRects.map((item) => item[3]))
        ];
      }
      const values = {
        Type: "Annot",
        Subtype: subtype,
        Rect: subtype === "Text" ? [rect[2], Math.max(rect[1], rect[3] - 18), rect[2] + 18, rect[3]] : rect,
        C: color,
        CA: subtype === "FreeText" ? 1 : 0.38,
        F: 4,
        T: PDFHexString.fromText("Paper Library"),
        Contents: PDFHexString.fromText(mark.comment || mark.text || "Paper Library annotation"),
        NM: PDFHexString.fromText(annotationId),
        M: PDFString.of(this.pdfDate()),
        P: page.ref
      };
      if (subtype === "FreeText") {
        values.DA = PDFString.of("/Helvetica 10 Tf 0 g");
        values.Border = [0, 0, 1];
      }
      if (subtype === "Highlight") {
        // 写入前合并重叠/相邻矩形：Obsidian 渲染注释时逐个四边形填充，
        // 原始选区矩形大量重叠（同一行拆成多段、上下差 1px），重叠处会被填充两次导致颜色不均。
        // 一行只写一个四边形（QuadPoints 顺序：左上、右上、左下、右下）。
        const mergedRects = this.mergePdfHighlightViewportRects(
          mark.pdfRects.map((item) => item.rect).filter((rect) => Array.isArray(rect) && rect.length === 4)
        );
        // 数学排版（分数、上下标）的文字层矩形常出现又窄又高的离群块，
        // 合并后表现为竖直窄条。按宽度加权的中位行高裁剪这类块，底部对齐基线。
        if (mergedRects.length > 1) {
          const widths = mergedRects.map((rect) => Math.max(0, rect[2] - rect[0]));
          const totalWidth = widths.reduce((sum, width) => sum + width, 0) || 1;
          const weighted = mergedRects
            .map((rect, index) => ({ height: Math.max(0, rect[3] - rect[1]), weight: widths[index] }))
            .sort((first, second) => first.height - second.height);
          let accumulated = 0;
          let medianHeight = weighted[weighted.length - 1]?.height || 0;
          for (const item of weighted) {
            accumulated += item.weight;
            if (accumulated >= totalWidth / 2) { medianHeight = item.height; break; }
          }
          if (medianHeight > 0) {
            mergedRects.forEach((rect, index) => {
              const width = widths[index];
              const height = Math.max(0, rect[3] - rect[1]);
              if (height > medianHeight * 1.8 && width < medianHeight * 2) {
                rect[1] = Math.max(rect[1], rect[3] - medianHeight * 1.2);
              }
            });
          }
        }
        values.QuadPoints = mergedRects.flatMap((rect) => [
          Math.min(rect[0], rect[2]), Math.max(rect[1], rect[3]),
          Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3]),
          Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]),
          Math.max(rect[0], rect[2]), Math.min(rect[1], rect[3])
        ]);
      }
      else values.Name = "Comment";
      const annotation = document.context.obj(values);
      annots.push(document.context.register(annotation));
      return true;
    }
  }

  async removeLocalPdfAnnotations(marks) {
    // 删除时同步清理待写队列：on-leave 模式下标注可能还在队列里，
    // 不清掉的话 flush 会把已删除的标注重新写回 PDF
    (marks || []).forEach((mark) => {
      if (!mark?.pdfPath) return;
      const path = normalizePath(mark.pdfPath);
      for (const [key, pending] of this.pendingPdfAnnotationSyncs) {
        if (!key.startsWith(`${path}|`)) continue;
        if (pending?.id === mark.id
          || (mark.pdfAnnotationId && pending?.pdfAnnotationId === mark.pdfAnnotationId)) {
          this.pendingPdfAnnotationSyncs.delete(key);
        }
      }
    });
    const grouped = new Map();
    (marks || []).forEach((mark) => {
      if (!mark?.pdfPath || !mark.pdfAnnotationId) return;
      const path = normalizePath(mark.pdfPath);
      if (!grouped.has(path)) grouped.set(path, new Set());
      grouped.get(path).add(`paperlib:${mark.pdfAnnotationId}`);
    });
    for (const [path, ids] of grouped) {
      await this.mutateLocalPdf(path, async (document) => {
        let changed = false;
        document.getPages().forEach((page) => {
          const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
          if (!annots) return;
          for (let index = annots.size() - 1; index >= 0; index -= 1) {
            const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
            if (!dictionary) continue;
            const idValue = document.context.lookupMaybe(dictionary.get(PDFName.of("NM")), PDFString, PDFHexString);
            const value = idValue?.decodeText?.() || idValue?.asString?.() || "";
            if (!ids.has(value)) continue;
            annots.remove(index);
            changed = true;
          }
        });
        return changed;
      });
    }
  }

  async syncLocalPdfAnnotation(mark) {
    const mode = ["on-leave", "immediate", "off"].includes(this.settings.pdfAnnotationWriteback)
      ? this.settings.pdfAnnotationWriteback
      : "on-leave";
    if (mode === "off") return true;
    // on-leave：写回 PDF 会让 Obsidian 原生视图重载（闪烁），所以先排队，
    // 等离开该 PDF 视图 / 插件卸载 / 手动命令时再批量写入。
    // 批注本体已即时持久化到论文库与笔记，这里只影响外部阅读器可见的副本。
    if (mode === "on-leave") {
      if (mark?.pdfPath && (mark.pdfAnnotationId || mark.id)) {
        this.pendingPdfAnnotationSyncs.set(`${mark.pdfPath}|${mark.pdfAnnotationId || mark.id}`, mark);
      }
      return true;
    }
    try {
      return await this.upsertLocalPdfAnnotation(mark);
    } catch (error) {
      console.error("Paper Library: failed to write local PDF annotation", error);
      new Notice(`批注已保存到论文笔记，但写入 PDF 失败：${error.message || error}`);
      return false;
    }
  }

  async flushPdfAnnotationSyncs(filter = null, notify = false) {
    const entries = [...this.pendingPdfAnnotationSyncs.entries()]
      .filter(([, mark]) => !filter || filter(mark));
    if (!entries.length) {
      if (notify) new Notice("没有待写回的 PDF 批注");
      return;
    }
    entries.forEach(([key]) => this.pendingPdfAnnotationSyncs.delete(key));
    let written = 0;
    for (const [, mark] of entries) {
      try {
        if (await this.upsertLocalPdfAnnotation(mark)) written += 1;
      } catch (error) {
        console.error("Paper Library: failed to write local PDF annotation", error);
        new Notice(`批注已保存到论文笔记，但写入 PDF 失败：${error.message || error}`);
      }
    }
    const paths = new Set(entries.map(([, mark]) => normalizePath(mark.pdfPath || "")).filter(Boolean));
    for (const path of paths) {
      try {
        await this.pruneLocalPdfAnnotations(path);
      } catch (error) {
        console.error("Paper Library: failed to prune stale PDF annotations", error);
      }
    }
    if (notify) new Notice(written ? `已写回 ${written} 条批注到 PDF 文件` : "没有待写回的 PDF 批注");
  }

  async pruneLocalPdfAnnotations(pdfPath) {
    // 删除 PDF 中属于本插件但已不在论文库里的注释（例如旧版本删除遗留的孤儿注释）
    const path = normalizePath(pdfPath || "");
    if (!path) return false;
    const paper = this.settings.papers?.find((item) => normalizePath(item.pdfPath || "") === path);
    const valid = new Set();
    if (paper) {
      for (const mark of this.ensureResearchWorkspace(paper).highlights || []) {
        if (normalizePath(mark.pdfPath || paper.pdfPath || "") !== path) continue;
        valid.add(`paperlib:${mark.pdfAnnotationId || mark.id}`);
      }
      // paper.annotations（长按拖出摘录的标注）同样会写回 PDF，不能当作孤儿删除
      for (const mark of paper.annotations || []) {
        if (normalizePath(mark.pdfPath || paper.pdfPath || "") !== path) continue;
        valid.add(`paperlib:${mark.pdfAnnotationId || mark.id}`);
      }
    }
    return this.mutateLocalPdf(path, async (document) => {
      let changed = false;
      document.getPages().forEach((page) => {
        const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
        if (!annots) return;
        for (let index = annots.size() - 1; index >= 0; index -= 1) {
          const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
          if (!dictionary) continue;
          const idValue = document.context.lookupMaybe(dictionary.get(PDFName.of("NM")), PDFString, PDFHexString);
          const value = idValue?.decodeText?.() || idValue?.asString?.() || "";
          if (!value.startsWith("paperlib:") || valid.has(value)) continue;
          annots.remove(index);
          changed = true;
        }
      });
      return changed;
    });
  }

  async savePdfHighlight(context, colorName, comment = "", options = {}) {
    const paper = this.getCanonicalPaper(context.paper);
    const { text, page, range } = context;
    if (!paper) return false;
    const pdfPath = context.pdfPath || paper.pdfPath;
    const normalizedColor = String(colorName || "").trim();
    const selectionValue = [range.beginIndex, range.beginOffset, range.endIndex, range.endOffset].join(",");
    const dedupeKey = `${paper.id}|${pdfPath}|${page}|${selectionValue}|${normalizedColor}|${comment}`;
    if (dedupeKey === this.lastAnnotationKey && Date.now() - (this.lastAnnotationAt || 0) < 1500) return false;
    this.lastAnnotationKey = dedupeKey;
    this.lastAnnotationAt = Date.now();

    const workspace = this.ensureResearchWorkspace(paper);
    const noteFile = await this.ensurePaperNote(paper);
    if (!noteFile) return false;
    const heading = this.settings.annotationHeading || "PDF Annotations";
    const headingLine = `## ${heading}`;
    const colorParam = normalizedColor ? `&color=${encodeURIComponent(normalizedColor.toLocaleLowerCase())}` : "";
    const target = `${pdfPath}#page=${page}&selection=${selectionValue}${colorParam}`;
    const sourceLink = `[[${target}|打开原文高亮 · p. ${page}]]`;
    const calloutColor = normalizedColor.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "yellow";
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    const commentBlock = comment
      ? `>\n${comment.split("\n").map((line, index) => `> ${index === 0 ? "**批注：** " : ""}${line}`).join("\n")}\n`
      : "";
    const annotationId = `paperlib-${Date.now().toString(36)}`;
    const timestamp = new Date().toLocaleString();
    const entry = `\n> [!pdf|${calloutColor}]+ PDF 高亮 · p. ${page}\n${quoted}\n${commentBlock}>\n> ${sourceLink}\n> 保存于 ${timestamp}\n\n^${annotationId}\n`;
    let content = await this.app.vault.read(noteFile);
    if (!content.includes(headingLine)) content = `${content.trimEnd()}\n\n${headingLine}\n`;

    paper.annotations = Array.isArray(paper.annotations) ? paper.annotations : [];
    const annotationRecord = {
      id: annotationId,
      pdfAnnotationId: annotationId,
      text,
      page,
      selection: { ...range },
      selectionSource: context.selectionSource || "unknown",
      rectCoordinateSpace: context.rectCoordinateSpace || "unknown",
      color: normalizedColor,
      comment,
      pdfSubtype: ["Text", "Underline"].includes(options.pdfSubtype) ? options.pdfSubtype : "Highlight",
      pdfRects: Array.isArray(context.pdfRects) ? context.pdfRects.map((item) => ({ ...item })) : [],
      link: target,
      pdfPath,
      createdAt: new Date().toISOString()
    };
    paper.annotations.push(annotationRecord);
    const position = options.position || this.nextResearchNodePosition(workspace);
    workspace.nodes.push({
      id: workspaceId("excerpt"),
      annotationId,
      pdfAnnotationId: annotationId,
      type: "excerpt",
      text,
      comment,
      page,
      selection: { ...range },
      selectionSource: context.selectionSource || "unknown",
      rectCoordinateSpace: context.rectCoordinateSpace || "unknown",
      color: normalizedColor,
      pdfSubtype: annotationRecord.pdfSubtype,
      pdfRects: annotationRecord.pdfRects.map((item) => ({ ...item })),
      link: target,
      pdfPath,
      x: position.x,
      y: position.y,
      createdAt: new Date().toISOString()
    });
    content = `${content.trimEnd()}\n${entry}`;
    content = this.mergeResearchWorkspaceSection(content, paper);
    await this.app.vault.modify(noteFile, content);
    this.settings.defaultHighlightColor = normalizedColor || this.settings.defaultHighlightColor;
    await this.saveSettings();
    await this.syncLocalPdfAnnotation(annotationRecord);
    this.refreshNativePdfNoteOverlays(paper);
    if (this.app.workspace?.getLeavesOfType) this.refreshViews();
    if (options.openWorkspace) await this.openResearchWorkspace(paper, context.sourceLeaf, true);
    new Notice(`已拉入研究工作区，并同步到论文笔记（第 ${page} 页）`);
    return true;
  }

  async saveCanvasHighlight(context, colorId = "yellow", options = {}) {
    const paper = this.getCanonicalPaper(context.paper);
    const { text, page, range } = context;
    if (!paper) return false;
    const pdfSubtype = ["Underline", "Text"].includes(options?.pdfSubtype) ? options.pdfSubtype : "Highlight";
    const workspace = this.ensureResearchWorkspace(paper);
    const pdfPath = context.pdfPath || paper.pdfPath;
    const normalizedColor = CANVAS_HIGHLIGHT_COLORS.some((color) => color.id === colorId) ? colorId : "yellow";
    const selectionValue = [range.beginIndex, range.beginOffset, range.endIndex, range.endOffset].join(",");
    const selectionUnion = this.getPdfRectsUnion(context.pdfRects);
    const existing = workspace.highlights.find((highlight) => {
      if (normalizePath(highlight.pdfPath || paper.pdfPath) !== normalizePath(pdfPath)) return false;
      if (Number(highlight.page) !== Number(page)) return false;
      const sameSelection = [highlight.selection?.beginIndex, highlight.selection?.beginOffset,
        highlight.selection?.endIndex, highlight.selection?.endOffset].join(",") === selectionValue;
      if (sameSelection) return true;
      // 选区索引可能因文字层差异而不稳定：几何高度重叠视为同一处标注，更新颜色而非新建
      const otherUnion = this.getPdfRectsUnion(highlight.pdfRects);
      if (!selectionUnion || !otherUnion) return false;
      return this.pdfRectsOverlapRatio(selectionUnion, otherUnion) >= 0.9;
    });
    const target = `${pdfPath}#page=${page}&selection=${selectionValue}&color=${normalizedColor}`;
    if (existing) {
      // 颜色、类型、几何范围都相同才视为无变化；扩大/缩小选区或改类型都要更新
      const existingUnion = this.getPdfRectsUnion(existing.pdfRects);
      const sameGeometry = Boolean(selectionUnion && existingUnion
        && this.pdfRectsClose(selectionUnion, existingUnion, 0.5));
      if (existing.color === normalizedColor
        && (existing.pdfSubtype || "Highlight") === pdfSubtype
        && sameGeometry) return false;
      existing.color = normalizedColor;
      existing.pdfSubtype = pdfSubtype;
      existing.link = target;
      existing.text = text;
      existing.selection = { ...range };
      if (Array.isArray(context.pdfRects) && context.pdfRects.length) {
        existing.pdfRects = context.pdfRects.map((item) => ({ ...item }));
      }
      existing.selectionSource = context.selectionSource || existing.selectionSource || "unknown";
      existing.rectCoordinateSpace = context.rectCoordinateSpace || existing.rectCoordinateSpace || "unknown";
      existing.updatedAt = new Date().toISOString();
      await this.persistResearchWorkspace(paper, false);
      await this.syncLocalPdfAnnotation(existing);
      this.refreshResearchPdfHighlights(paper);
      return true;
    }
    const id = workspaceId("highlight");
    const highlight = {
      id,
      pdfAnnotationId: id,
      type: "highlight",
      text,
      page,
      selection: { ...range },
      selectionSource: context.selectionSource || "unknown",
      rectCoordinateSpace: context.rectCoordinateSpace || "unknown",
      color: normalizedColor,
      pdfSubtype,
      pdfRects: Array.isArray(context.pdfRects) ? context.pdfRects.map((item) => ({ ...item })) : [],
      link: target,
      pdfPath,
      createdAt: new Date().toISOString()
    };
    workspace.highlights.push(highlight);
    await this.persistResearchWorkspace(paper, false);
    await this.syncLocalPdfAnnotation(highlight);
    this.refreshResearchPdfHighlights(paper);
    return true;
  }

  getPdfMarkEntries(paper, pdfPath = paper?.pdfPath) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return [];
    this.repairOrphanedPaperPdfMarkPaths(paper);
    const path = normalizePath(pdfPath || paper.pdfPath || "");
    const workspace = this.ensureResearchWorkspace(paper);
    const entries = [];
    const seen = new Set();
    const add = (source, record) => {
      if (!record) return;
      if (normalizePath(record.pdfPath || paper.pdfPath || "") !== path) return;
      const key = record.pdfAnnotationId || record.id;
      if (!key || seen.has(key)) return;
      seen.add(key);
      entries.push({ source, record });
    };
    (workspace.highlights || []).forEach((record) => add("canvas-highlight", record));
    (paper.annotations || []).forEach((record) => add("annotation", record));
    return entries;
  }

  getPdfTextItemRect(item) {
    if (!item?.str || !Array.isArray(item.transform) || item.transform.length < 6) return null;
    const [a, b, c, d, x, y] = item.transform.map(Number);
    const width = Math.max(0.1, Math.abs(Number(item.width) || 0));
    const height = Math.max(0.1, Math.abs(Number(item.height) || Math.hypot(c, d) || Math.hypot(a, b) || 0));
    const horizontalLength = Math.hypot(a, b) || 1;
    const verticalLength = Math.hypot(c, d) || 1;
    const horizontal = [a / horizontalLength, b / horizontalLength];
    const vertical = Math.hypot(c, d) > 0
      ? [c / verticalLength, d / verticalLength]
      : [-horizontal[1], horizontal[0]];
    const corners = [
      [x, y],
      [x + horizontal[0] * width, y + horizontal[1] * width],
      [x + vertical[0] * height, y + vertical[1] * height],
      [x + horizontal[0] * width + vertical[0] * height,
        y + horizontal[1] * width + vertical[1] * height]
    ];
    return [
      Math.min(...corners.map((point) => point[0])),
      Math.min(...corners.map((point) => point[1])),
      Math.max(...corners.map((point) => point[0])),
      Math.max(...corners.map((point) => point[1]))
    ];
  }

  getPdfTextRangeRects(textItems, range) {
    if (!Array.isArray(textItems) || !range) return [];
    const beginIndex = Math.max(0, Number(range.beginIndex) || 0);
    const endIndex = Math.min(textItems.length - 1, Number(range.endIndex) || 0);
    const rectangles = [];
    for (let index = beginIndex; index <= endIndex; index += 1) {
      const item = textItems[index];
      if (!item?.str || !Array.isArray(item.transform) || item.transform.length < 6) continue;
      const length = item.str.length;
      if (!length) continue;
      const startOffset = index === beginIndex
        ? Math.max(0, Math.min(length, Number(range.beginOffset) || 0))
        : 0;
      const endOffset = index === endIndex
        ? Math.max(0, Math.min(length, Number(range.endOffset) || 0))
        : length;
      if (endOffset <= startOffset) continue;
      const [a, b, c, d, x, y] = item.transform.map(Number);
      const width = Math.max(0.1, Math.abs(Number(item.width) || 0));
      const height = Math.max(0.1, Math.abs(Number(item.height) || Math.hypot(c, d) || Math.hypot(a, b) || 0));
      const horizontalLength = Math.hypot(a, b) || 1;
      const verticalLength = Math.hypot(c, d) || 1;
      const horizontal = [a / horizontalLength, b / horizontalLength];
      const vertical = Math.hypot(c, d) > 0
        ? [c / verticalLength, d / verticalLength]
        : [-horizontal[1], horizontal[0]];
      const startDistance = width * startOffset / length;
      const endDistance = width * endOffset / length;
      const bottomStart = [x + horizontal[0] * startDistance, y + horizontal[1] * startDistance];
      const bottomEnd = [x + horizontal[0] * endDistance, y + horizontal[1] * endDistance];
      const topStart = [bottomStart[0] + vertical[0] * height, bottomStart[1] + vertical[1] * height];
      const topEnd = [bottomEnd[0] + vertical[0] * height, bottomEnd[1] + vertical[1] * height];
      const points = [topStart, topEnd, bottomStart, bottomEnd];
      rectangles.push({
        quad: points.flat(),
        rect: [
          Math.min(...points.map((point) => point[0])),
          Math.min(...points.map((point) => point[1])),
          Math.max(...points.map((point) => point[0])),
          Math.max(...points.map((point) => point[1]))
        ]
      });
    }
    return rectangles;
  }

  getPdfMarkDisplayRects(mark, textItems) {
    const stored = Array.isArray(mark?.pdfRects) ? mark.pdfRects : [];
    const calculated = this.getPdfTextRangeRects(textItems, mark?.selection);
    if (!calculated.length) return stored;
    if (mark.rectCoordinateSpace === "pdf") return stored.length ? stored : calculated;
    if (mark.selectionSource === "workspace") return calculated;
    if (mark.selectionSource === "native") return stored.length ? stored : calculated;
    const endIndex = Number(mark?.selection?.endIndex);
    const endLength = String(textItems?.[endIndex]?.str || "").length;
    const hasPartialBoundary = Number(mark?.selection?.beginOffset) > 0
      || (endLength > 0 && Number(mark?.selection?.endOffset) < endLength);
    return hasPartialBoundary ? calculated : (stored.length ? stored : calculated);
  }

  mergePdfHighlightViewportRects(rectangles) {
    const normalized = (rectangles || [])
      .filter((rect) => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite))
      .filter((rect) => rect[2] - rect[0] > 0.1 && rect[3] - rect[1] > 0.1)
      .sort((first, second) => first[1] - second[1] || first[0] - second[0]);
    const merged = [];
    normalized.forEach((rect) => {
      const match = merged.find((candidate) => {
        const verticalOverlap = Math.min(candidate[3], rect[3]) - Math.max(candidate[1], rect[1]);
        const minimumHeight = Math.min(candidate[3] - candidate[1], rect[3] - rect[1]);
        const horizontalGap = Math.max(rect[0] - candidate[2], candidate[0] - rect[2], 0);
        return verticalOverlap >= minimumHeight * 0.45 && horizontalGap <= 1.5;
      });
      if (!match) {
        merged.push([...rect]);
        return;
      }
      match[0] = Math.min(match[0], rect[0]);
      match[1] = Math.min(match[1], rect[1]);
      match[2] = Math.max(match[2], rect[2]);
      match[3] = Math.max(match[3], rect[3]);
    });
    return merged;
  }

  pdfRectsOverlap(first, second) {
    if (!Array.isArray(first) || first.length !== 4 || !Array.isArray(second) || second.length !== 4) return false;
    const overlapWidth = Math.min(first[2], second[2]) - Math.max(first[0], second[0]);
    const overlapHeight = Math.min(first[3], second[3]) - Math.max(first[1], second[1]);
    if (overlapWidth <= 0.1 || overlapHeight <= 0.1) return false;
    const minimumHeight = Math.min(Math.abs(first[3] - first[1]), Math.abs(second[3] - second[1]));
    return overlapHeight >= Math.max(0.35, minimumHeight * 0.18);
  }

  getPdfTextItemIndexesForRects(textItems, pdfRects) {
    const selectionRects = (pdfRects || []).map((item) => item?.rect).filter((rect) => rect?.length === 4);
    if (!Array.isArray(textItems) || !selectionRects.length) return [];
    const indexes = [];
    textItems.forEach((item, index) => {
      const itemRect = this.getPdfTextItemRect(item);
      if (itemRect && selectionRects.some((rect) => this.pdfRectsOverlap(itemRect, rect))) indexes.push(index);
    });
    return indexes;
  }

  getPdfSelectionRangeFromRects(textItems, pdfRects, fallbackRange) {
    const indexes = this.getPdfTextItemIndexesForRects(textItems, pdfRects);
    if (!indexes.length) return { ...fallbackRange };
    const beginIndex = Math.min(...indexes);
    const endIndex = Math.max(...indexes);
    return {
      beginIndex,
      beginOffset: 0,
      endIndex,
      endOffset: String(textItems[endIndex]?.str || "").length
    };
  }

  getPdfMarkEntriesAtTextIndex(paper, pdfPath, page, textIndex, textItems = null) {
    return this.getPdfMarkEntries(paper, pdfPath).filter(({ record }) => {
      if (Array.isArray(textItems) && Array.isArray(record.pdfRects) && record.pdfRects.length) {
        const indexes = this.getPdfTextItemIndexesForRects(textItems, this.getPdfMarkDisplayRects(record, textItems));
        if (indexes.length) return indexes.includes(Number(textIndex));
      }
      const range = record.selection || {};
      return Number(record.page) === Number(page)
        && Number(textIndex) >= Number(range.beginIndex)
        && Number(textIndex) <= Number(range.endIndex);
    });
  }

  async deletePdfMark(paper, entry) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !entry?.record) return false;
    if (entry.source === "canvas-highlight") return this.removeCanvasHighlight(paper, entry.record.id);
    const workspace = this.ensureResearchWorkspace(paper);
    const node = workspace.nodes.find((item) => (
      item.annotationId === entry.record.id
      || (item.pdfAnnotationId && item.pdfAnnotationId === entry.record.pdfAnnotationId)
    ));
    if (node) {
      await this.removeResearchNode(paper, node.id);
      return true;
    }
    const before = (paper.annotations || []).length;
    paper.annotations = (paper.annotations || []).filter((annotation) => annotation.id !== entry.record.id);
    if (paper.annotations.length === before) return false;
    await this.saveSettings();
    const noteFile = await this.ensurePaperNote(paper);
    if (noteFile) {
      let content = await this.app.vault.read(noteFile);
      content = this.removeAnnotationBlocks(content, new Set([entry.record.id]));
      content = this.mergeResearchWorkspaceSection(content, paper);
      await this.app.vault.modify(noteFile, content);
    }
    await this.removeLocalPdfAnnotations([entry.record]);
    this.refreshNativePdfNoteOverlays(paper);
    this.refreshViews();
    return true;
  }

  async removeCanvasHighlight(paper, highlightId) {
    return this.removeCanvasHighlights(paper, [highlightId]);
  }

  async removeCanvasHighlights(paper, highlightIds) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const ids = new Set(highlightIds || []);
    const before = workspace.highlights.length;
    const removed = workspace.highlights.filter((highlight) => ids.has(highlight.id));
    workspace.highlights = workspace.highlights.filter((highlight) => !ids.has(highlight.id));
    if (workspace.highlights.length === before) return false;
    await this.persistResearchWorkspace(paper, false);
    try {
      await this.removeLocalPdfAnnotations(removed);
    } catch (error) {
      console.error("Paper Library: failed to remove local PDF annotation", error);
      new Notice(`插件内高亮已删除，但 PDF 文件中的高亮删除失败：${error.message || error}`);
    }
    this.refreshResearchPdfHighlights(paper);
    return true;
  }

  getPdfInkStrokes(paper, pdfPath = paper?.pdfPath, page = null) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return [];
    this.repairOrphanedPaperPdfMarkPaths(paper);
    const path = normalizePath(pdfPath || paper.pdfPath || "");
    return (this.ensureResearchWorkspace(paper).inkStrokes || []).filter((stroke) => (
      normalizePath(stroke.pdfPath || paper.pdfPath || "") === path
      && (page == null || Number(stroke.page) === Number(page))
    ));
  }

  async savePdfInkStroke(paper, source = {}) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !Array.isArray(source.points) || !source.points.length) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const stroke = {
      id: source.id || workspaceId("ink"),
      type: "ink",
      page: Math.max(1, Number(source.page) || 1),
      pdfPath: normalizePath(source.pdfPath || paper.pdfPath || ""),
      color: CANVAS_HIGHLIGHT_COLORS.some((item) => item.id === source.color) ? source.color : "yellow",
      width: Math.max(1.5, Math.min(8, Number(source.width) || 3)),
      points: source.points.map((point) => ({
        x: Math.max(0, Math.min(1, Number(point.x) || 0)),
        y: Math.max(0, Math.min(1, Number(point.y) || 0))
      })),
      createdAt: source.createdAt || new Date().toISOString()
    };
    const index = workspace.inkStrokes.findIndex((item) => item.id === stroke.id);
    if (index >= 0) workspace.inkStrokes[index] = stroke;
    else workspace.inkStrokes.push(stroke);
    await this.persistResearchWorkspace(paper, false);
    this.refreshResearchPdfHighlights(paper);
    return true;
  }

  async removePdfInkStroke(paper, strokeId) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !strokeId) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const before = workspace.inkStrokes.length;
    workspace.inkStrokes = workspace.inkStrokes.filter((stroke) => stroke.id !== strokeId);
    if (workspace.inkStrokes.length === before) return false;
    await this.persistResearchWorkspace(paper, false);
    this.refreshResearchPdfHighlights(paper);
    new Notice("已删除画笔标注");
    return true;
  }

  pdfInkPointSegmentDistance(point, first, second) {
    const dx = Number(second.x) - Number(first.x);
    const dy = Number(second.y) - Number(first.y);
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(Number(point.x) - Number(first.x), Number(point.y) - Number(first.y));
    const offset = ((Number(point.x) - Number(first.x)) * dx + (Number(point.y) - Number(first.y)) * dy) / lengthSquared;
    const ratio = Math.max(0, Math.min(1, offset));
    return Math.hypot(
      Number(point.x) - (Number(first.x) + ratio * dx),
      Number(point.y) - (Number(first.y) + ratio * dy)
    );
  }

  findPdfInkStrokeAtEvent(event, pageEl, paper, pdfPath, pageNumber) {
    const rect = pageEl?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return null;
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };
    const threshold = Math.max(0.008, 10 / Math.max(1, Math.min(rect.width, rect.height)));
    return this.getPdfInkStrokes(paper, pdfPath, pageNumber)
      .slice().reverse().find((stroke) => {
        const points = stroke.points || [];
        if (points.length === 1) return this.pdfInkPointSegmentDistance(point, points[0], points[0]) <= threshold;
        for (let index = 1; index < points.length; index += 1) {
          if (this.pdfInkPointSegmentDistance(point, points[index - 1], points[index]) <= threshold) return true;
        }
        return false;
      }) || null;
  }

  capturePdfInkRegionAttachment({ canvas, pageEl, stroke, path = "", page = 1, title = "文档" } = {}) {
    const points = Array.isArray(stroke?.points) ? stroke.points : [];
    const pageRect = pageEl?.getBoundingClientRect?.();
    const canvasRect = canvas?.getBoundingClientRect?.();
    if (!points.length || !canvas?.width || !canvas?.height || !pageRect?.width || !pageRect?.height) return null;

    const localWidth = Math.max(1, Number(pageEl.offsetWidth) || pageRect.width);
    const localHeight = Math.max(1, Number(pageEl.offsetHeight) || pageRect.height);
    const canvasLeft = ((canvasRect?.left ?? pageRect.left) - pageRect.left) * localWidth / pageRect.width;
    const canvasTop = ((canvasRect?.top ?? pageRect.top) - pageRect.top) * localHeight / pageRect.height;
    const canvasLocalWidth = Math.max(1, (canvasRect?.width || pageRect.width) * localWidth / pageRect.width);
    const canvasLocalHeight = Math.max(1, (canvasRect?.height || pageRect.height) * localHeight / pageRect.height);
    const canvasRight = canvasLeft + canvasLocalWidth;
    const canvasBottom = canvasTop + canvasLocalHeight;
    const pointXs = points.map((point) => Math.max(0, Math.min(1, Number(point.x) || 0)) * localWidth);
    const pointYs = points.map((point) => Math.max(0, Math.min(1, Number(point.y) || 0)) * localHeight);
    const padding = Math.max(14, (Number(stroke.width) || 3) * 4);
    let left = Math.min(...pointXs) - padding;
    let right = Math.max(...pointXs) + padding;
    let top = Math.min(...pointYs) - padding;
    let bottom = Math.max(...pointYs) + padding;
    const minimumWidth = Math.min(96, canvasLocalWidth);
    const minimumHeight = Math.min(72, canvasLocalHeight);
    if (right - left < minimumWidth) {
      const center = (left + right) / 2;
      left = center - minimumWidth / 2;
      right = center + minimumWidth / 2;
    }
    if (bottom - top < minimumHeight) {
      const center = (top + bottom) / 2;
      top = center - minimumHeight / 2;
      bottom = center + minimumHeight / 2;
    }
    const width = Math.min(canvasLocalWidth, right - left);
    const height = Math.min(canvasLocalHeight, bottom - top);
    left = Math.max(canvasLeft, Math.min(left, canvasRight - width));
    top = Math.max(canvasTop, Math.min(top, canvasBottom - height));
    right = left + width;
    bottom = top + height;
    if (right <= left || bottom <= top) return null;

    const scaleX = canvas.width / canvasLocalWidth;
    const scaleY = canvas.height / canvasLocalHeight;
    const sourceX = Math.max(0, Math.floor((left - canvasLeft) * scaleX));
    const sourceY = Math.max(0, Math.floor((top - canvasTop) * scaleY));
    const sourceWidth = Math.max(1, Math.min(canvas.width - sourceX, Math.ceil(width * scaleX)));
    const sourceHeight = Math.max(1, Math.min(canvas.height - sourceY, Math.ceil(height * scaleY)));
    const outputScale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight));
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(sourceWidth * outputScale));
    crop.height = Math.max(1, Math.round(sourceHeight * outputScale));
    const context = crop.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, crop.width, crop.height);
    context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, crop.width, crop.height);

    const normalizedPath = normalizePath(path || stroke.pdfPath || "");
    return {
      type: "image",
      label: `${title || "文档"} · 第 ${page || "—"} 页画笔圈选`,
      detail: `${crop.width} × ${crop.height}`,
      dataUrl: crop.toDataURL("image/png"),
      mime: "image/png",
      path: normalizedPath,
      page: Number(page) || null,
      key: `pdf-ink-region:${normalizedPath}:${page || ""}:${stroke.id || Date.now()}`,
      sourceRect: {
        left: pageRect.left + left * pageRect.width / localWidth,
        top: pageRect.top + top * pageRect.height / localHeight,
        width: width * pageRect.width / localWidth,
        height: height * pageRect.height / localHeight
      }
    };
  }

  async addPdfInkRegionToComposer(context) {
    try {
      const attachment = this.capturePdfInkRegionAttachment(context);
      if (!attachment) throw new Error("无法读取画笔圈选区域");
      await this.addAIContext(attachment);
    } catch (error) {
      console.error("Paper Library: failed to add ink region to Paper Composer", error);
      new Notice(`添加画笔圈选区域失败：${error.message || error}`);
    }
  }

  schedulePdfInkRegionDrag(event, context) {
    if (event.button !== 2) return false;
    if (!Array.isArray(context?.stroke?.points) || !context.stroke.points.length) return false;
    this.pdfInkRegionDragCleanup?.(true);
    const drag = {
      active: false,
      attachment: null,
      ghost: null,
      startX: event.clientX,
      startY: event.clientY
    };
    this.pdfInkRegionDrag = drag;
    const move = (moveEvent) => {
      if (!drag.active && Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) < 7) return;
      moveEvent.preventDefault();
      if (!drag.active) {
        try {
          drag.attachment = this.capturePdfInkRegionAttachment(context);
        } catch (error) {
          console.error("Paper Library: failed to prepare ink region drag", error);
        }
        if (!drag.attachment) return cleanup(true, null);
        drag.active = true;
        this.armPdfInkDragContextMenuSuppression();
        drag.ghost = this.createPdfInkRegionDragGhost(drag.attachment);
        window.requestAnimationFrame(() => drag.ghost?.classList.add("is-visible"));
      }
      this.movePdfInkRegionDragGhost(moveEvent);
    };
    const cleanup = (cancel = false, upEvent = null) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
      if (this.pdfInkRegionDragCleanup === cleanup) this.pdfInkRegionDragCleanup = null;
      this.finishPdfInkRegionDrag(upEvent, cancel || !drag.active);
    };
    const up = (upEvent) => {
      if (drag.active) {
        upEvent.preventDefault();
        upEvent.stopPropagation();
      }
      cleanup(false, upEvent);
    };
    const cancelDrag = () => cleanup(true, null);
    this.pdfInkRegionDragCleanup = cleanup;
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    return true;
  }

  createPdfInkRegionDragGhost(attachment) {
    const ghost = document.createElement("div");
    ghost.className = "paperlib-excerpt-drag-ghost paperlib-ink-region-drag-ghost";
    const echo = document.createElement("div");
    echo.className = "paperlib-excerpt-drag-echo";
    const preview = document.createElement("img");
    preview.src = attachment.dataUrl;
    preview.alt = "画笔圈选区域";
    echo.appendChild(preview);
    ghost.appendChild(echo);
    const card = document.createElement("div");
    card.className = "paperlib-excerpt-drag-card";
    const icon = document.createElement("span");
    icon.className = "paperlib-excerpt-drag-icon";
    setPaperlibIcon(icon, "image");
    const content = document.createElement("div");
    content.className = "paperlib-excerpt-drag-content";
    const strong = document.createElement("strong");
    strong.textContent = `画笔圈选 · 第 ${attachment.page || "—"} 页`;
    const summary = document.createElement("span");
    summary.textContent = "松开以作为图片加入 Paper Composer";
    content.append(strong, summary);
    card.append(icon, content);
    ghost.appendChild(card);
    document.body.appendChild(ghost);
    const source = attachment.sourceRect;
    Object.assign(ghost.style, {
      left: `${source.left}px`,
      top: `${source.top}px`,
      width: `${Math.min(320, Math.max(72, source.width))}px`,
      height: `${Math.min(180, Math.max(48, source.height))}px`
    });
    ghost.style.setProperty("--paperlib-drag-progress", "0");
    ghost.style.setProperty("--paperlib-drag-card-scale", "0.92");
    return ghost;
  }

  movePdfInkRegionDragGhost(event) {
    const drag = this.pdfInkRegionDrag;
    if (!drag?.active || !drag.ghost) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const linear = Math.min(1, Math.max(0, (distance - 4) / 130));
    const progress = linear * linear * (3 - 2 * linear);
    const source = drag.attachment.sourceRect;
    drag.ghost.style.left = `${source.left + (event.clientX + 18 - source.left) * progress}px`;
    drag.ghost.style.top = `${source.top + (event.clientY + 16 - source.top) * progress}px`;
    drag.ghost.style.width = `${Math.min(320, Math.max(72, source.width)) + (286 - Math.min(320, Math.max(72, source.width))) * progress}px`;
    drag.ghost.style.height = `${Math.min(180, Math.max(48, source.height)) + (88 - Math.min(180, Math.max(48, source.height))) * progress}px`;
    drag.ghost.style.setProperty("--paperlib-drag-progress", progress.toFixed(3));
    drag.ghost.style.setProperty("--paperlib-drag-card-scale", (0.92 + progress * 0.08).toFixed(3));
    drag.ghost.classList.toggle("is-card", progress > 0.58);
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.classList.remove("paperlib-paper-composer-drag-over"));
    aiTarget?.classList.add("paperlib-paper-composer-drag-over");
    drag.ghost.classList.toggle("is-over-drop-target", Boolean(aiTarget && progress > 0.58));
  }

  finishPdfInkRegionDrag(event, cancel = false) {
    const drag = this.pdfInkRegionDrag;
    this.pdfInkRegionDrag = null;
    document.querySelectorAll(".paper-composer-input-wrapper.paperlib-paper-composer-drag-over")
      .forEach((element) => element.classList.remove("paperlib-paper-composer-drag-over"));
    if (!drag?.ghost) return;
    const dismiss = (className) => {
      drag.ghost.classList.add(className);
      window.setTimeout(() => drag.ghost?.remove(), 180);
    };
    if (cancel || !event) return dismiss("is-cancelled");
    const aiTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".paper-composer-input-wrapper");
    if (!aiTarget) return dismiss("is-cancelled");
    dismiss("is-dropping");
    void this.addAIContext(drag.attachment);
  }

  consumePdfInkDragContextMenu(event) {
    if (Date.now() > Number(this.pdfInkContextMenuSuppressedUntil || 0)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  armPdfInkDragContextMenuSuppression() {
    this.pdfInkContextMenuCleanup?.();
    this.pdfInkContextMenuSuppressedUntil = Date.now() + 900;
    let timer = null;
    const block = (event) => {
      if (Date.now() <= this.pdfInkContextMenuSuppressedUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
      cleanup();
    };
    const cleanup = () => {
      document.removeEventListener("contextmenu", block, true);
      if (timer) window.clearTimeout(timer);
      if (this.pdfInkContextMenuCleanup === cleanup) this.pdfInkContextMenuCleanup = null;
    };
    this.pdfInkContextMenuCleanup = cleanup;
    document.addEventListener("contextmenu", block, true);
    timer = window.setTimeout(cleanup, 950);
  }

  ensureResearchWorkspace(paper) {
    if (!paper.researchWorkspace || typeof paper.researchWorkspace !== "object") {
      paper.researchWorkspace = {
        version: 4, zoom: DEFAULT_RESEARCH_WORKSPACE_ZOOM, nodes: [], links: [], highlights: [], inkStrokes: [],
        pdfFrame: { x: 32, y: 32, width: 720, height: 1080 }
      };
    }
    const workspace = paper.researchWorkspace;
    workspace.zoom = Number(workspace.zoom) || DEFAULT_RESEARCH_WORKSPACE_ZOOM;
    if (Number.isFinite(Number(workspace.mobileZoom))) {
      workspace.mobileZoom = Math.min(2, Math.max(0.1, Number(workspace.mobileZoom)));
    }
    workspace.nodes = Array.isArray(workspace.nodes) ? workspace.nodes : [];
    workspace.links = Array.isArray(workspace.links) ? workspace.links : [];
    workspace.highlights = Array.isArray(workspace.highlights) ? workspace.highlights : [];
    workspace.inkStrokes = Array.isArray(workspace.inkStrokes) ? workspace.inkStrokes : [];
    workspace.nodes.forEach((node) => { if (!node.id) node.id = workspaceId(node.type || "node"); });
    workspace.links.forEach((link) => { if (!link.id) link.id = workspaceId("link"); });
    workspace.highlights.forEach((highlight) => { if (!highlight.id) highlight.id = workspaceId("highlight"); });
    workspace.inkStrokes.forEach((stroke) => { if (!stroke.id) stroke.id = workspaceId("ink"); });
    if ((Number(workspace.version) || 1) < 2) {
      workspace.nodes.forEach((node) => { node.x = Number(node.x || 0) + 780; });
    }
    workspace.version = 4;
    workspace.pdfFrame = workspace.pdfFrame && typeof workspace.pdfFrame === "object"
      ? workspace.pdfFrame
      : { x: 32, y: 32, width: 720, height: 1080 };
    const imported = new Set(workspace.nodes.map((node) => node.annotationId).filter(Boolean));
    (paper.annotations || []).forEach((annotation) => {
      if (!annotation?.id || imported.has(annotation.id)) return;
      const position = this.nextResearchNodePosition(workspace);
      workspace.nodes.push({
        id: workspaceId("excerpt"),
        annotationId: annotation.id,
        type: "excerpt",
        text: annotation.text || "",
        comment: annotation.comment || "",
        page: annotation.page || 1,
        selection: annotation.selection ? { ...annotation.selection } : null,
        color: annotation.color || "Yellow",
        link: annotation.link || "",
        pdfPath: annotation.pdfPath || paper.pdfPath,
        x: position.x,
        y: position.y,
        createdAt: annotation.createdAt || new Date().toISOString()
      });
      imported.add(annotation.id);
    });
    return workspace;
  }

  nextResearchNodePosition(workspace) {
    const count = workspace.nodes.length;
    return {
      x: 820 + (count % 4) * 330,
      y: 62 + Math.floor(count / 4) * 230
    };
  }

  async addResearchNode(paper, source = {}) {
    const workspace = this.ensureResearchWorkspace(paper);
    const position = this.nextResearchNodePosition(workspace);
    workspace.nodes.push({
      id: workspaceId(source.type || "note"),
      type: source.type || "note",
      text: source.text || "",
      comment: source.comment || "",
      x: Number.isFinite(source.x) ? source.x : position.x,
      y: Number.isFinite(source.y) ? source.y : position.y,
      isNew: Boolean(source.isNew),
      createdAt: new Date().toISOString()
    });
    await this.persistResearchWorkspace(paper);
  }

  async removeResearchNode(paper, nodeId) {
    const workspace = this.ensureResearchWorkspace(paper);
    const removed = workspace.nodes.find((node) => node.id === nodeId);
    workspace.nodes = workspace.nodes.filter((node) => node.id !== nodeId);
    workspace.links = workspace.links.filter((link) => link.from !== nodeId && link.to !== nodeId);
    const annotationIds = new Set([removed?.annotationId, removed?.id].filter(Boolean));
    const removedPdfMarks = [];
    if (removed?.type === "excerpt") {
      paper.annotations = (paper.annotations || []).filter((annotation) => {
        const sameId = annotationIds.has(annotation.id);
        const sameLegacyExcerpt = !removed.annotationId
          && Number(annotation.page) === Number(removed.page)
          && String(annotation.text || "") === String(removed.text || "")
          && JSON.stringify(annotation.selection || {}) === JSON.stringify(removed.selection || {});
        if (sameId || sameLegacyExcerpt) {
          if (annotation.id) annotationIds.add(annotation.id);
          removedPdfMarks.push(annotation);
          return false;
        }
        return true;
      });
    }
    await this.saveSettings();
    const noteFile = await this.ensurePaperNote(paper);
    if (noteFile) {
      let content = await this.app.vault.read(noteFile);
      content = this.removeAnnotationBlocks(content, annotationIds);
      content = this.mergeResearchWorkspaceSection(content, paper);
      await this.app.vault.modify(noteFile, content);
    }
    try {
      await this.removeLocalPdfAnnotations(removedPdfMarks.length ? removedPdfMarks : [removed]);
    } catch (error) {
      console.error("Paper Library: failed to remove excerpt annotation from PDF", error);
      new Notice(`卡片已删除，但 PDF 文件中的批注删除失败：${error.message || error}`);
    }
    this.refreshViews();
  }

  removeAnnotationBlocks(content, annotationIds) {
    if (!annotationIds?.size) return content;
    const lines = String(content || "").split("\n");
    annotationIds.forEach((id) => {
      const marker = `^${id}`;
      let markerIndex = lines.findIndex((line) => line.trim() === marker);
      while (markerIndex >= 0) {
        let start = markerIndex;
        while (start > 0 && !/^> \[!pdf(?:\||\])/.test(lines[start])) start -= 1;
        if (!/^> \[!pdf(?:\||\])/.test(lines[start])) start = markerIndex;
        let end = markerIndex + 1;
        while (end < lines.length && !lines[end].trim()) end += 1;
        lines.splice(start, end - start);
        markerIndex = lines.findIndex((line) => line.trim() === marker);
      }
    });
    return lines.join("\n");
  }

  async connectResearchNodes(paper, from, to, fromSide = "", toSide = "") {
    const workspace = this.ensureResearchWorkspace(paper);
    const duplicate = workspace.links.some((link) => (
      (link.from === from && link.to === to) || (link.from === to && link.to === from)
    ));
    if (!duplicate) workspace.links.push({
      id: workspaceId("link"), from, to, fromSide, toSide, createdAt: new Date().toISOString()
    });
    await this.persistResearchWorkspace(paper);
  }

  async removeResearchLink(paper, linkId) {
    const workspace = this.ensureResearchWorkspace(paper);
    workspace.links = workspace.links.filter((link) => link.id !== linkId);
    await this.persistResearchWorkspace(paper);
  }

  async arrangeResearchWorkspace(paper) {
    const workspace = this.ensureResearchWorkspace(paper);
    const groups = workspace.nodes.filter((node) => node.type === "group");
    const content = workspace.nodes.filter((node) => node.type !== "group");
    [...groups, ...content].forEach((node, index) => {
      node.x = 820;
      node.y = 62 + index * 230;
    });
    await this.persistResearchWorkspace(paper);
  }

  researchNodeLabel(node) {
    const value = markdownText(node?.text || node?.comment || "未命名卡片").replace(/\s+/g, " ");
    return truncate(value.replace(/[\[\]|#]/g, " ").replace(/\s+/g, " ").trim(), 48);
  }

  buildResearchWorkspaceMarkdown(paper) {
    const workspace = this.ensureResearchWorkspace(paper);
    const nodes = [...workspace.nodes].sort((a, b) => (Number(a.y) - Number(b.y)) || (Number(a.x) - Number(b.x)));
    const excerpts = nodes.filter((node) => node.type === "excerpt");
    const ideas = nodes.filter((node) => node.type !== "excerpt");
    const highlights = [...(workspace.highlights || [])].sort((a, b) => Number(a.page) - Number(b.page));
    const lines = [
      `## ${this.settings.researchWorkspaceHeading || "Research Workspace"}`,
      "",
      "> [!info] 可视化研究工作区",
      "> 此区域由 Paper Library 自动同步。请在研究画布中移动、编辑或连接卡片。",
      ""
    ];
    if (highlights.length) {
      lines.push("### PDF 高亮", "");
      highlights.forEach((highlight) => {
        const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === highlight.color)?.label || highlight.color;
        lines.push(`- **${color} · 第 ${highlight.page || "—"} 页：** ${markdownText(highlight.text).replace(/\n+/g, " ")}`);
        if (highlight.link) lines.push(`  - [[${highlight.link}|回到原文]]`);
      });
      lines.push("");
    }
    if (excerpts.length) {
      lines.push("### 摘录", "");
      excerpts.forEach((node) => {
        lines.push(`#### 第 ${node.page || "—"} 页 · ${this.researchNodeLabel(node)}`, "");
        markdownText(node.text).split("\n").forEach((line) => lines.push(`> ${line}`));
        if (node.comment) {
          lines.push("", `**想法：** ${markdownText(node.comment).replace(/\n+/g, "  \n")}`);
        }
        if (node.link) lines.push("", `[[${node.link}|回到原文 · p. ${node.page || "—"}]]`);
        lines.push("", `^${node.id}`, "");
      });
    }
    if (ideas.length) {
      lines.push("### 想法与主题", "");
      ideas.forEach((node) => {
        const prefix = node.type === "group" ? "主题" : "想法";
        lines.push(`- **${prefix}：** ${markdownText(node.text) || "（待补充）"} ^${node.id}`, "");
      });
    }
    const validLinks = workspace.links.filter((link) => (
      workspace.nodes.some((node) => node.id === link.from) && workspace.nodes.some((node) => node.id === link.to)
    ));
    if (validLinks.length) {
      lines.push("### 连接", "");
      validLinks.forEach((link) => {
        const from = workspace.nodes.find((node) => node.id === link.from);
        const to = workspace.nodes.find((node) => node.id === link.to);
        lines.push(`- [[#^${from.id}|${this.researchNodeLabel(from)}]] ↔ [[#^${to.id}|${this.researchNodeLabel(to)}]]`);
      });
      lines.push("");
    }
    if (!nodes.length && !highlights.length) lines.push("暂无摘录、想法或高亮。", "");
    return lines.join("\n").trimEnd();
  }

  mergeResearchWorkspaceSection(content, paper) {
    const start = "<!-- paperlib-research-workspace:start -->";
    const end = "<!-- paperlib-research-workspace:end -->";
    let base = String(content || "");
    const startIndex = base.indexOf(start);
    const endIndex = startIndex >= 0 ? base.indexOf(end, startIndex) : -1;
    if (startIndex >= 0 && endIndex >= 0) {
      base = `${base.slice(0, startIndex).trimEnd()}\n\n${base.slice(endIndex + end.length).trimStart()}`.trimEnd();
    }
    const block = `${start}\n${this.buildResearchWorkspaceMarkdown(paper)}\n${end}`;
    return `${base.trimEnd()}\n\n${block}\n`;
  }

  async persistResearchWorkspace(paper, refresh = true) {
    this.ensureResearchWorkspace(paper);
    await this.saveSettings();
    const noteFile = await this.ensurePaperNote(paper);
    if (noteFile) {
      const content = await this.app.vault.read(noteFile);
      const next = this.mergeResearchWorkspaceSection(content, paper);
      if (next !== content) await this.app.vault.modify(noteFile, next);
    }
    if (refresh && this.app.workspace?.getLeavesOfType) this.refreshViews();
  }

  async openResearchWorkspace(paper, sourceLeaf = null, reveal = true) {
    if (!paper) return null;
    this.uiState.selectedId = paper.id;
    this.uiState.activePdfPaperId = paper.id;
    this.ensureResearchWorkspace(paper);
    let leaf = this.app.workspace.getLeavesOfType(RESEARCH_VIEW_TYPE)[0];
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: RESEARCH_VIEW_TYPE, active: true, state: { paperId: paper.id } });
    if (reveal) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async openResearchSource(paper, node = null) {
    const pdfPath = node?.pdfPath || paper?.pdfPath;
    if (!pdfPath) return new Notice("这篇论文尚未关联 PDF");
    if (/^https?:\/\//i.test(pdfPath)) {
      window.open(pdfPath, "_blank");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(pdfPath));
    if (!file) return new Notice("找不到摘录对应的 PDF 文件");
    const pdfLeaves = this.app.workspace.getLeavesOfType("pdf") || [];
    let leaf = pdfLeaves.find((item) => item.view?.file?.path === file.path);
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    const hash = node?.link?.includes("#") ? `#${node.link.split("#").slice(1).join("#")}` : (node?.page ? `#page=${node.page}` : "");
    await leaf.openFile(file, hash ? { eState: { subpath: hash } } : undefined);
    this.app.workspace.revealLeaf(leaf);
  }

  async importActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return new Notice("请先打开一篇 Markdown 论文笔记");
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter || {};
    const splitList = (value) => Array.isArray(value) ? value : String(value || "").split(/[;,]/).map((part) => part.trim()).filter(Boolean);
    const existing = this.settings.papers.find((paper) => paper.notePath === file.path);
    if (existing) return new Notice("这篇笔记已经在论文库中");
    const importedTags = normalizePaperTags(splitList(fm.tags));
    const importedPaper = {
      id: uniqueId(),
      title: String(fm.title || file.basename),
      authors: splitList(fm.authors || fm.author),
      year: Number(fm.year) || new Date().getFullYear(),
      venue: String(fm.venue || fm.journal || ""),
      venueRanks: this.normalizeVenueRanks(fm.venue_rankings || fm.venueRanks),
      abstract: String(fm.abstract || ""),
      tags: importedTags,
      collections: [...new Set(splitList(fm.collections || fm.collection).map(normalizeCollectionPath).filter(Boolean))],
      starred: Boolean(fm.starred), flagged: false, rating: Number(fm.rating) || 0,
      doi: String(fm.doi || ""), arxiv: String(fm.arxiv || ""),
      pdfPath: String(fm.pdf || ""), notePath: file.path, attachments: [],
      addedAt: new Date().toISOString(), lastOpened: ""
    };
    try { await this.enrichPaperVenueRanks(importedPaper); }
    catch (error) { console.warn("Paper Library: venue rank lookup unavailable", error); }
    this.settings.papers.unshift(importedPaper);
    this.settings.collections = expandCollectionPaths([
      ...(this.settings.collections || []),
      ...importedPaper.collections
    ]);
    importedTags.forEach((tag) => {
      if (!this.settings.tags.includes(tag)) this.settings.tags.push(tag);
    });
    await this.saveSettings();
    this.refreshViews();
    new Notice("已导入当前论文笔记");
  }

  async ensurePaperNote(paper) {
    if (paper.notePath) {
      const existing = this.app.vault.getAbstractFileByPath(normalizePath(paper.notePath));
      if (existing) return existing;
    }
    let path = normalizePath(paper.notePath || "");
    if (!path && paper.pdfPath && !/^https?:\/\//i.test(paper.pdfPath) && this.isManagedPaperPath(paper.pdfPath)) {
      path = normalizePath(paper.pdfPath).replace(/\.pdf$/i, ".md");
    }
    if (!path) path = this.getAvailableOrganizedPaperPaths(paper, [paper.pdfPath]).notePath;
    if (!path.toLocaleLowerCase().endsWith(".md")) path += ".md";
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("笔记路径必须位于当前 Vault 内");
    const folder = path.slice(0, path.lastIndexOf("/"));
    if (folder) await this.ensureVaultFolder(folder);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const yamlList = (values) => values.map((value) => `  - "${String(value).replace(/"/g, "\\\"")}"`).join("\n");
      const heading = this.settings.annotationHeading || "PDF Annotations";
      const rankLabels = this.getPaperVenueRanks(paper).map(({ system, rank }) => `${system}:${rank}`);
      paper.tags = normalizePaperTags(paper.tags);
      const body = `---\ntitle: "${paper.title.replace(/"/g, "\\\"")}"\nauthors:\n${yamlList(paper.authors)}\nyear: ${paper.year}\nvenue: "${paper.venue.replace(/"/g, "\\\"")}"\nvenue_rankings:\n${yamlList(rankLabels)}\ntags:\n${yamlList(paper.tags)}\ncollections:\n${yamlList(paper.collections)}\ndoi: "${paper.doi}"\narxiv: "${paper.arxiv}"\npdf: "${paper.pdfPath}"\nrating: ${paper.rating}\n---\n\n# ${paper.title}\n\n## Abstract\n\n${paper.abstract}\n\n## Notes\n\n## ${heading}\n\n`;
      file = await this.app.vault.create(path, body);
      paper.notePath = path;
      await this.saveSettings();
    }
    return file;
  }

  async openOrCreateNote(paper) {
    const file = await this.ensurePaperNote(paper);
    if (!file) return;
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  async openPaperPdf(paper, options = {}) {
    if (!paper.pdfPath) {
      new Notice("请先为论文设置 Vault 内 PDF 路径");
      await this.editPaperInSidebar(paper);
      return;
    }
    if (/^https?:\/\//i.test(paper.pdfPath)) {
      new Notice("远程 PDF 将在浏览器打开；自动批注同步需要 Vault 内的 PDF 文件");
      window.open(paper.pdfPath, "_blank");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(paper.pdfPath));
    if (!file || file.extension?.toLocaleLowerCase() !== "pdf") {
      new Notice("找不到 PDF，请在编辑论文中检查 Vault 路径");
      return;
    }
    this.uiState.activePdfPaperId = paper.id;
    await this.ensurePaperNote(paper);
    const openNative = options.native ?? (this.settings.pdfOpenMode !== "canvas");
    if (openNative) {
      await this.app.workspace.getLeaf("tab").openFile(file);
      this.nativePdfPositionSuppressUntil = Date.now() + 2500;
      void this.restoreNativePdfReadingPosition(file, paper);
      if (!this.settings.pdfAnnotationHintShown) {
        new Notice("使用 Paper Library 浮动工具栏可高亮或添加注释；批注会同步到论文笔记");
        this.settings.pdfAnnotationHintShown = true;
        await this.saveSettings();
      }
      return;
    }
    await this.openResearchWorkspace(paper, null, true);
    if (!this.settings.canvasDragHintShown) {
      new Notice("在画布 PDF 中选择文字，再长按选区并拖到空白处即可创建摘录卡");
      this.settings.canvasDragHintShown = true;
      await this.saveSettings();
    }
  }

  openPdf(path) {
    if (/^https?:\/\//i.test(path)) {
      window.open(path, "_blank");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!file) return new Notice("找不到 PDF，请在编辑论文中检查路径");
    this.app.workspace.getLeaf("tab").openFile(file);
  }
};

export default PaperLibraryPlugin;
