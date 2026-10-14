// Paper Library Web Importer — popup controller

"use strict";

const ui = {
  paperCard: document.getElementById("paper-card"),
  emptyCard: document.getElementById("empty-card"),
  title: document.getElementById("paper-title"),
  authors: document.getElementById("paper-authors"),
  meta: document.getElementById("paper-meta"),
  access: document.getElementById("access-state"),
  libraryBadge: document.getElementById("library-badge"),
  lookupSkeleton: document.getElementById("lookup-skeleton"),
  libraryCard: document.getElementById("library-card"),
  localVenue: document.getElementById("local-venue"),
  localRanks: document.getElementById("local-ranks"),
  citations: document.getElementById("metric-citations"),
  references: document.getElementById("metric-references"),
  metricYear: document.getElementById("metric-year"),
  metricType: document.getElementById("metric-type"),
  localStars: document.getElementById("local-stars"),
  localLabels: document.getElementById("local-labels"),
  metricsSource: document.getElementById("metrics-source"),
  status: document.getElementById("status"),
  importActions: document.getElementById("import-actions"),
  destination: document.getElementById("import-destination"),
  collection: document.getElementById("collection-select"),
  collectionHint: document.getElementById("collection-hint"),
  refreshCollections: document.getElementById("refresh-collections-btn"),
  importPdf: document.getElementById("import-pdf-btn"),
  metadata: document.getElementById("metadata-btn"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsPanel: document.getElementById("settings-panel"),
  token: document.getElementById("token-input"),
  port: document.getElementById("port-input"),
  save: document.getElementById("save-config-btn"),
  test: document.getElementById("test-btn"),
  connection: document.getElementById("conn-state")
};

let currentPaper = null;
let currentTabId = null;
let currentLibraryPaper = null;
let currentConnection = "";
let destinationPreference = null;
let collectionsReady = false;
let importing = false;
let connectionRefresh = 0;
let connectionLoading = false;

function pdfLike(value) {
  const url = String(value || "");
  return /\.pdf(?:$|[?#])/i.test(url)
    || /\/pdf(?:\/|$)/i.test(url)
    || /\/doi\/(?:e?pdf)\//i.test(url)
    || /\/content\/pdf\//i.test(url)
    || /\/stamp(?:PDF)?\/.*\.jsp/i.test(url)
    || /pdfft/i.test(url)
    || /arxiv\.org\/pdf\//i.test(url);
}

function cleanViewerTitle(value) {
  const title = String(value || "").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  return /^(?:pdf|full[ -]?text pdf|download pdf|chrome pdf viewer)$/i.test(title) ? "" : title;
}

async function activeTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
}

function fallbackFromTab(tab) {
  const url = String(tab?.url || "");
  const isPdfPage = pdfLike(url) || /pdf/i.test(String(tab?.title || ""));
  const arxiv = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1] || "";
  let site = "";
  try { site = new URL(url).hostname; } catch (_) { /* non-web tab */ }
  return {
    url,
    title: cleanViewerTitle(tab?.title),
    authors: [], year: 0, venue: "", abstract: "", doi: "", arxiv,
    pdfUrl: isPdfPage ? url : (arxiv ? `https://arxiv.org/pdf/${arxiv}` : ""),
    isPdfPage,
    site
  };
}

async function detect(tab) {
  if (!tab?.id) return fallbackFromTab(tab);
  try {
    const detected = await chrome.tabs.sendMessage(tab.id, { type: "paperlib:detect" });
    if (detected && typeof detected === "object") {
      if (!detected.pdfUrl && pdfLike(tab.url)) {
        detected.pdfUrl = tab.url;
        detected.isPdfPage = true;
      }
      if (!detected.title) detected.title = cleanViewerTitle(tab.title);
      return detected;
    }
  } catch (_) {
    // Browser PDF viewers and restricted pages do not accept content scripts.
  }
  return fallbackFromTab(tab);
}

function recognized(paper) {
  return Boolean(paper && (paper.title || paper.doi || paper.arxiv || paper.pdfUrl || paper.isPdfPage));
}

function addChip(text) {
  if (!text) return;
  const chip = document.createElement("span");
  chip.textContent = text;
  ui.meta.appendChild(chip);
}

function render(paper) {
  const available = recognized(paper);
  ui.paperCard.classList.toggle("hidden", !available);
  ui.emptyCard.classList.toggle("hidden", available);
  ui.importPdf.disabled = !available;
  ui.metadata.disabled = !available || (!paper?.title && !paper?.doi && !paper?.arxiv);
  ui.destination.classList.toggle("hidden", !available || Boolean(currentLibraryPaper));
  if (!available) return;

  ui.title.textContent = paper.title || (paper.isPdfPage ? "当前 PDF" : "未识别标题");
  ui.authors.textContent = Array.isArray(paper.authors) && paper.authors.length
    ? `${paper.authors.slice(0, 5).join(", ")}${paper.authors.length > 5 ? " 等" : ""}`
    : "";
  ui.meta.replaceChildren();
  addChip(paper.venue);
  addChip(paper.year ? String(paper.year) : "");
  addChip(paper.doi ? `DOI ${paper.doi}` : "");
  addChip(paper.arxiv ? `arXiv ${paper.arxiv}` : "");

  if (paper.isPdfPage) {
    ui.access.className = "access-state ready";
    ui.access.textContent = "当前页面是 PDF，可以直接导入";
  } else if (paper.pdfUrl) {
    ui.access.className = "access-state ready";
    ui.access.textContent = "已发现 PDF；订阅网站将使用当前登录状态下载";
  } else {
    ui.access.className = "access-state pending";
    ui.access.textContent = "将先查找 Open Access PDF；订阅网站请先登录并打开全文页";
  }
}

function rankTone(system, rank) {
  if (/^IF(?:\s|$)/i.test(system)) return "metric";
  if (/录用率|acceptance rate/i.test(system)) return "rate";
  const value = String(rank || "").toLocaleUpperCase().replace(/\s+/g, "");
  if (/^(?:A\*?|Q1|1区)$/.test(value)) return "top";
  if (/^(?:B|Q2|2区)$/.test(value)) return "high";
  if (/^(?:C|Q3|3区)$/.test(value)) return "mid";
  return "base";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date)
    : "";
}

function renderLibraryPaper(paper) {
  currentLibraryPaper = paper || null;
  const found = Boolean(paper);
  ui.libraryBadge.classList.toggle("hidden", !found);
  ui.libraryCard.classList.toggle("hidden", !found);
  ui.importActions.classList.toggle("hidden", found);
  ui.destination.classList.toggle("hidden", found || !recognized(currentPaper));
  if (!found) return;

  ui.localVenue.textContent = paper.venue || "未记录期刊或会议";
  ui.localRanks.replaceChildren();
  (paper.venueRanks || []).forEach(({ system, rank }) => {
    const pill = document.createElement("span");
    pill.className = `rank-pill ${rankTone(system, rank)}`;
    pill.textContent = `${system} · ${rank}`;
    ui.localRanks.appendChild(pill);
  });
  if (!ui.localRanks.childElementCount) {
    const empty = document.createElement("span");
    empty.className = "rank-empty";
    empty.textContent = "暂无分区或会议等级";
    ui.localRanks.appendChild(empty);
  }

  const metric = (value) => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString() : "—";
  ui.citations.textContent = metric(paper.citations);
  ui.references.textContent = metric(paper.references);
  ui.metricYear.textContent = paper.year ? String(paper.year) : "—";
  ui.metricType.textContent = paper.type || "—";
  ui.metricType.title = paper.type || "";

  ui.localStars.classList.toggle("hidden", !(paper.rating > 0));
  ui.localStars.textContent = paper.rating > 0 ? `${"★".repeat(paper.rating)}${"☆".repeat(5 - paper.rating)}` : "";
  ui.localLabels.replaceChildren();
  [...(paper.collections || []).map((value) => `⌁ ${value}`), ...(paper.tags || []).map((value) => `#${value}`)]
    .slice(0, 8)
    .forEach((value) => {
      const label = document.createElement("span");
      label.textContent = value;
      ui.localLabels.appendChild(label);
    });
  const updated = formatDate(paper.metricsUpdatedAt);
  ui.metricsSource.textContent = `${paper.hasPdf ? "PDF 已保存" : "仅文献信息"} · ${paper.metricsSource || "本地论文库"}${updated ? ` · ${updated} 更新` : ""}`;
  ui.access.className = "access-state ready in-library";
  ui.access.textContent = "已存在于 Paper Library，不会重复导入";
}

async function refreshLibraryStatus() {
  if (!recognized(currentPaper)) return;
  ui.lookupSkeleton.classList.remove("hidden");
  ui.importActions.classList.add("hidden");
  try {
    const reply = await chrome.runtime.sendMessage({ type: "paperlib:lookup", info: currentPaper });
    if (reply?.ok) {
      renderLibraryPaper(reply.found ? reply.paper : null);
      if (!reply.found) ui.importActions.classList.remove("hidden");
      return;
    }
    renderLibraryPaper(null);
    ui.importActions.classList.remove("hidden");
    if (reply?.code === "upgrade-plugin") status("working", reply.error);
  } catch (_) {
    renderLibraryPaper(null);
    ui.importActions.classList.remove("hidden");
  } finally {
    ui.lookupSkeleton.classList.add("hidden");
  }
}

function status(kind, message) {
  ui.status.className = `status ${kind}`;
  ui.status.textContent = message;
}

function clearStatus() {
  ui.status.className = "status hidden";
  ui.status.textContent = "";
}

function setBusy(busy) {
  importing = busy;
  ui.importPdf.disabled = busy || connectionLoading || !recognized(currentPaper);
  ui.metadata.disabled = busy || connectionLoading || !recognized(currentPaper)
    || (!currentPaper?.title && !currentPaper?.doi && !currentPaper?.arxiv);
  ui.collection.disabled = busy || !collectionsReady;
  ui.refreshCollections.disabled = busy;
  ui.save.disabled = busy;
  ui.test.disabled = busy;
}

function renderCollections(collections) {
  collectionsReady = Array.isArray(collections);
  const previous = destinationPreference?.connection === currentConnection
    ? destinationPreference.collection : "";
  ui.collection.replaceChildren(new Option("未分类（默认）", ""));
  if (collectionsReady) {
    collections.forEach((collection) => ui.collection.add(new Option(collection, collection)));
  }
  ui.collection.value = collectionsReady && collections.includes(previous) ? previous : "";
  ui.collection.disabled = importing || !collectionsReady;
  ui.collectionHint.textContent = !collectionsReady
    ? "请重新加载新版 Paper Library，以支持指定导入分类。"
    : previous && !collections.includes(previous)
      ? "上次选择的分类已不存在，请重新选择；当前为未分类。"
      : collections.length ? "PDF 和文献信息将导入所选分类，并记住本次选择。"
        : "暂无分类，可先在 Paper Library 中创建；当前将导入未分类。";
}

async function refreshConnection() {
  const refresh = ++connectionRefresh;
  connectionLoading = true;
  setBusy(importing);
  collectionsReady = false;
  ui.collection.disabled = true;
  ui.refreshCollections.disabled = true;
  ui.connection.className = "conn-state";
  ui.connection.textContent = "正在检测…";
  try {
    const stored = await chrome.storage.local.get(["paperlibToken", "paperlibPort"]);
    const reply = await chrome.runtime.sendMessage({ type: "paperlib:ping" });
    if (refresh !== connectionRefresh) return;
    if (reply?.ok) {
      currentConnection = `${stored.paperlibPort || 23987}:${stored.paperlibToken || ""}`;
      ui.connection.classList.add("ok");
      ui.connection.textContent = `已连接 · ${reply.papers ?? "—"} 篇`;
      renderCollections(reply.collections);
    } else {
      ui.connection.classList.add("error");
      ui.connection.textContent = reply?.code === "bad-token" ? "Token 无效" : "未连接 Obsidian";
      renderCollections(null);
      ui.collectionHint.textContent = "连接 Obsidian 后可选择分类。";
    }
  } catch (_) {
    if (refresh !== connectionRefresh) return;
    ui.connection.classList.add("error");
    ui.connection.textContent = "未连接 Obsidian";
    renderCollections(null);
    ui.collectionHint.textContent = "连接 Obsidian 后可选择分类。";
  } finally {
    if (refresh === connectionRefresh) {
      connectionLoading = false;
      setBusy(importing);
    }
  }
}

async function importPaper(includePdf) {
  if (!currentPaper || importing || connectionLoading) return;
  const collection = collectionsReady ? ui.collection.value : "";
  // The badge carries progress after this popup closes; failures surface on
  // the badge and in Obsidian's notice.
  chrome.runtime.sendMessage({
    type: "paperlib:import",
    info: currentPaper,
    includePdf,
    collection,
    tabId: currentTabId
  }).catch(() => undefined);
  window.close();
}

async function initialize() {
  const stored = await chrome.storage.local.get(["paperlibToken", "paperlibPort", "paperlibImportDestination"]);
  destinationPreference = stored.paperlibImportDestination || null;
  ui.token.value = stored.paperlibToken || "";
  ui.port.value = stored.paperlibPort || 23987;

  ui.settingsToggle.addEventListener("click", () => {
    const hidden = ui.settingsPanel.classList.toggle("hidden");
    ui.settingsToggle.setAttribute("aria-expanded", String(!hidden));
  });
  ui.save.addEventListener("click", async () => {
    await chrome.storage.local.set({
      paperlibToken: ui.token.value.trim(),
      paperlibPort: Math.min(65535, Math.max(1024, Number(ui.port.value) || 23987))
    });
    status("success", "连接设置已保存");
    await refreshConnection();
  });
  ui.test.addEventListener("click", refreshConnection);
  ui.refreshCollections.addEventListener("click", refreshConnection);
  ui.collection.addEventListener("change", async () => {
    destinationPreference = { connection: currentConnection, collection: ui.collection.value };
    try {
      await chrome.storage.local.set({ paperlibImportDestination: destinationPreference });
    } catch (_) {
      status("error", "分类已选择，但无法记住本次选择。");
    }
  });
  ui.importPdf.addEventListener("click", () => { clearStatus(); void importPaper(true); });
  ui.metadata.addEventListener("click", () => { clearStatus(); void importPaper(false); });

  const tab = await activeTab();
  currentTabId = tab?.id ?? null;
  currentPaper = await detect(tab);
  render(currentPaper);
  await refreshConnection();
  await refreshLibraryStatus();
}

void initialize();
