/* 共享常量：视图类型标识、画布高亮色板、论文表格列配置、收藏色板、
   Paper Composer 内置常量与 DEFAULT_SETTINGS。纯数据，不依赖 Obsidian。 */

import { APPEARANCE_PROTOCOL_VERSION } from "./appearance.js";

const VIEW_TYPE = "paper-library-view";
const NAV_VIEW_TYPE = "paper-library-navigation-view";
const DETAIL_VIEW_TYPE = "paper-library-detail-view";
const RESEARCH_VIEW_TYPE = "paper-library-research-workspace-view";
const DEFAULT_RESEARCH_WORKSPACE_ZOOM = 1.4;
const CLAUDIAN_VIEW_TYPE = "paperlib-paper-composer-view";
const CLAUDIAN_COLLAB_DETAIL_VIEW_TYPE = "paperlib-paper-composer-collab-detail";
const CLAUDIAN_VIEW_TYPES = [CLAUDIAN_VIEW_TYPE, CLAUDIAN_COLLAB_DETAIL_VIEW_TYPE];
const LEGACY_CLAUDIAN_VIEW_TYPES = ["paperlib-claudian-view", "paperlib-claudian-collab-detail"];
const PAPER_COMPOSER_ICON = "paper-composer";
const ALL_VIEW_TYPES = [VIEW_TYPE, NAV_VIEW_TYPE, DETAIL_VIEW_TYPE, RESEARCH_VIEW_TYPE];

const CANVAS_HIGHLIGHT_COLORS = [
  { id: "yellow", label: "黄色", value: "#ffd65a" },
  { id: "orange", label: "橙色", value: "#ff9f43" },
  { id: "green", label: "绿色", value: "#7bd88f" },
  { id: "blue", label: "蓝色", value: "#6ab7ff" },
  { id: "pink", label: "粉色", value: "#ff86b7" }
];

const PAPER_TABLE_COLUMNS = {
  favorite: { width: 38, min: 34, max: 70 },
  attachment: { width: 40, min: 34, max: 80 },
  authors: { width: 220, min: 140, max: 520 },
  year: { width: 86, min: 68, max: 180 },
  title: { width: 520, min: 240, max: 1100 },
  rating: { width: 104, min: 86, max: 150 },
  venue: { width: 240, min: 140, max: 600 },
  rankings: { width: 300, min: 180, max: 640 }
};
const DEFAULT_PAPER_TABLE_COLUMN_ORDER = [
  "favorite", "attachment", "authors", "year", "title", "rating", "venue", "rankings"
];
const PAPER_TABLE_COLUMN_META = {
  favorite: { label: "收藏", icon: "circle" },
  attachment: { label: "附件", icon: "paperclip" },
  authors: { label: "Authors" },
  year: { label: "Year" },
  title: { label: "Title" },
  rating: { label: "Rating" },
  venue: { label: "Venue" },
  rankings: { label: "Rank" }
};
const FAVORITE_COLORS = [
  { id: "yellow", label: "黄色", value: "#f4c84b" },
  { id: "red", label: "红色", value: "#ef6b67" },
  { id: "pink", label: "粉色", value: "#e78bd6" },
  { id: "purple", label: "紫色", value: "#9a8bd8" },
  { id: "blue", label: "蓝色", value: "#5da8e8" },
  { id: "green", label: "绿色", value: "#6fbc8e" },
  { id: "orange", label: "橙色", value: "#eca35f" },
  { id: "gray", label: "灰色", value: "#aeb3ba" }
];

function normalizeFavoriteColor(value) {
  const id = String(value || "").toLocaleLowerCase();
  return FAVORITE_COLORS.some((color) => color.id === id) ? id : "yellow";
}

function favoriteColorValue(value) {
  const id = normalizeFavoriteColor(value);
  return FAVORITE_COLORS.find((color) => color.id === id)?.value || FAVORITE_COLORS[0].value;
}

const PAPER_COMPOSER_MODEL_OPTIONS_VERSION = 7;
const PAPER_COMPOSER_CHATGPT_FALLBACK_MODEL = "gpt-5.4";
const PAPER_COMPOSER_CHATGPT_BUNDLED_CODEX_PATH = "/Applications/ChatGPT.app/Contents/Resources/codex";
const PAPER_COMPOSER_CLI_PROVIDERS = new Set(["kimi"]);

const DEFAULT_SETTINGS = {
  papers: [],
  tags: [],
  collections: [],
  customCitationStyles: [],
  libraryFolder: "Papers",
  notesFolder: "Papers",
  pdfsFolder: "Papers/PDFs",
  onlineMetadataLookup: true,
  googleScholarProvider: "html",
  serpApiKey: "",
  serpApiBackgroundLookup: false,
  enableFigureRecognition: false,
  openAlexApiKey: "",
  extensionServerEnabled: false,
  extensionServerPort: 23987,
  extensionToken: "",
  metadataSource: "auto",
  semanticScholarApiKey: "",
  annotationHeading: "PDF Annotations",
  pdfAnnotationWriteback: "on-leave",
  pdfOpenMode: "native",
  pdfOpenPosition: "last",
  researchWorkspaceHeading: "Research Workspace",
  defaultHighlightColor: "Yellow",
  tableColumnWidths: Object.fromEntries(Object.entries(PAPER_TABLE_COLUMNS).map(([key, value]) => [key, value.width])),
  tableColumnOrder: [...DEFAULT_PAPER_TABLE_COLUMN_ORDER],
  jcrRankCache: {},
  jcrRankCacheVersion: "showjcr-jcr2025-if",
  conferenceRateCache: {},
  conferenceRateCacheVersion: "conference-rates-v2",
  conferenceRateDatabase: { updatedAt: "", source: "", series: {} },
  conferenceRateDatabaseVersion: "cs-conf-stats-v1",
  conferenceRankingDatabase: { updatedAt: "", source: "", conferences: [] },
  conferenceRankingDatabaseVersion: "ccfddl-allconf-v2",
  followedConferences: [],
  semanticScholarPaperCache: { papers: {}, aliases: {} },
  semanticScholarPaperCacheVersion: "s2-paper-cache-v1",
  paperDeletionTombstones: {},
  obsidianTagNormalizationVersion: 1,
  libraryAppearance: "standard",
  // 移动端独立外观；空字符串表示尚未单独设置（加载时继承桌面端选择）。
  libraryAppearanceMobile: "",
  globalAccentColor: "#2563c9",
  globalAccentColorMobile: "",
  customAppearanceName: "我的外观",
  customAppearanceBase: "standard",
  customAppearanceCss: "",
  customAppearances: [{ id: "blueprint", name: "蓝图", base: "blueprint", css: "", builtin: true }],
  activeCustomAppearanceId: "blueprint",
  appearanceEditorProfileId: "blueprint",
  appearanceProtocolVersion: APPEARANCE_PROTOCOL_VERSION,
  libraryViewStyle: "default",
  pdfAnnotationHintShown: false,
  canvasDragHintShown: false,
  pdfAiMode: "direct",
  aiDirectPdfMaxMb: 32,
  aiLocalPdfMaxPages: 500,
  aiLocalContextCharacters: 90000,
  paperComposerModelOptionsVersion: 0,
  paperComposerPdfMessageCards: {},
  paperComposerDirectContextBindings: {}
};

export {
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
};
