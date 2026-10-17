/* PDF 图片服务：识别结果目录（加载/缓存/迁移）、画布拖拽区、
   位图渲染（pdf-lib/DocLayout 裁剪）与高分辨率导出。
   方法体从插件主类搬出，this 改为首个参数 plugin；主类保留委托壳。
   DocLayout 运行时安装/卸载属管线域，仍留在主类。 */

import { Notice, loadPdfJs, normalizePath } from "obsidian";
import { arrayBufferToDataUrl } from "../binary-utils.js";
import { PdfFigureCarouselModal, PdfFigureGalleryModal } from "../modals/figures.js";

export function clearPdfFigureRecognitionState(plugin) {
  (plugin.pdfFigureCatalogCache || new Map()).forEach((entry) => {
    try { void entry.document?.destroy?.(); } catch (_) {}
  });
  plugin.pdfFigureCatalogCache?.clear?.();
  plugin.pdfFigureProgressListeners?.clear?.();
  plugin.pdfFigureAssetCache?.clear?.();
  plugin.pdfFigureAssetDirectoryCache?.clear?.();
}

export function emitPdfFigureProgress(plugin, pdfPath, state) {
  const listeners = plugin.pdfFigureProgressListeners?.get(pdfPath);
  listeners?.forEach((listener) => {
    try { listener(state); } catch (_) {}
  });
}

export function getPortablePdfFigurePayload(plugin, pdfPath) {
  const path = normalizePath(pdfPath || "");
  if (!path) return null;
  const paper = plugin.settings.papers.find((item) => (
    normalizePath(item.pdfPath || "") === path
    || (item.attachments || []).some((attachment) => normalizePath(attachment.path || "") === path)
  ));
  const payload = paper?.figureCatalogs?.[path]
    || (normalizePath(paper?.pdfPath || "") === path ? paper?.figureCatalog : null);
  return Array.isArray(payload?.figures) ? payload : null;
}

export function sanitizePortablePdfFigurePayload(plugin, payload = {}) {
  const numericFields = ["pageNumber", "pageWidth", "pageHeight", "x", "y", "width", "height", "confidence"];
  const figures = (Array.isArray(payload.figures) ? payload.figures : []).map((figure, index) => {
    const portable = {
      figureKey: String(figure.figureKey || `doclayout:${figure.pageNumber || 1}:${index + 1}`),
      source: String(figure.source || payload.engine || "doclayout-yolo-onnx"),
      label: String(figure.label || `Figure ${index + 1}`),
      caption: String(figure.caption || "")
    };
    numericFields.forEach((key) => { portable[key] = Number(figure[key]) || 0; });
    if (figure.objectId) portable.objectId = String(figure.objectId);
    return portable;
  }).filter((figure) => figure.pageNumber > 0 && figure.width > 0 && figure.height > 0);
  return {
    version: 1,
    engine: String(payload.engine || "doclayout-yolo-onnx"),
    totalPages: Number(payload.totalPages || payload.pageCount) || 0,
    updatedAt: new Date().toISOString(),
    figures
  };
}

export function setPortablePdfFigurePayload(plugin, pdfPath, payload) {
  const path = normalizePath(pdfPath || "");
  const paper = plugin.settings.papers.find((item) => (
    normalizePath(item.pdfPath || "") === path
    || (item.attachments || []).some((attachment) => normalizePath(attachment.path || "") === path)
  ));
  if (!paper || !Array.isArray(payload?.figures)) return false;
  const portable = plugin.sanitizePortablePdfFigurePayload(payload);
  paper.figureCatalogs ||= {};
  const previous = paper.figureCatalogs[path];
  const comparable = (value) => JSON.stringify({
    engine: value?.engine || "",
    totalPages: Number(value?.totalPages) || 0,
    figures: value?.figures || []
  });
  if (comparable(previous) === comparable(portable)) return false;
  paper.figureCatalogs[path] = portable;
  return true;
}

export async function computePdfFigureCacheKey(plugin, pdfPath, file) {
  const input = `${normalizePath(pdfPath || "")}:${file?.stat?.mtime || 0}:${file?.stat?.size || 0}:doclayout-onnx-v1`;
  if (!plugin.isMobileApp()) {
    return require("crypto").createHash("sha1").update(input).digest("hex");
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder !== "function") return "";
  const digest = await subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function readSyncedPdfFigurePayload(plugin, pdfPath) {
  const path = normalizePath(pdfPath || "");
  const file = plugin.app.vault.getAbstractFileByPath(path);
  const adapter = plugin.app.vault.adapter;
  if (!file || !adapter?.read) return null;
  const cacheKey = await plugin.computePdfFigureCacheKey(path, file);
  if (!cacheKey) return null;
  const manifestPath = plugin.getPluginVaultPath(`figure-cache/${cacheKey}/figures.json`);
  try {
    if (adapter.exists && !(await adapter.exists(manifestPath))) return null;
    const payload = JSON.parse(await adapter.read(manifestPath));
    return Array.isArray(payload?.figures) ? payload : null;
  } catch (_) {
    return null;
  }
}

export async function loadPdfFigureDocument(plugin, pdfPath) {
  const path = normalizePath(pdfPath || "");
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!file) throw new Error("找不到 PDF 文件");
  const [pdfjs, buffer] = await Promise.all([loadPdfJs(), plugin.readPdfBinary(file)]);
  return pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
}

export function createPdfFigureCatalog(plugin, pdfPath, payload, document = null) {
  const figures = Array.isArray(payload?.figures) ? payload.figures : [];
  const pageSizes = new Map();
  figures.forEach((figure) => pageSizes.set(Number(figure.pageNumber), {
    width: Number(figure.pageWidth) || 1,
    height: Number(figure.pageHeight) || 1
  }));
  return {
    path: normalizePath(pdfPath || ""),
    engine: payload?.engine || "doclayout-yolo-onnx",
    device: payload?.device || "cpu",
    document,
    figures,
    placements: figures,
    pageSizes
  };
}

export async function resolveRecognizedPdfFigureCache(plugin, pdfPath, cacheKey, figureKey) {
  const path = normalizePath(pdfPath || "");
  const adapter = plugin.app.vault.adapter;
  const resolutionKey = `${path}:${cacheKey}`;
  const cached = plugin.pdfFigureAssetDirectoryCache?.get?.(resolutionKey);
  if (cached) return cached;
  const cacheRoot = plugin.getPluginVaultPath("figure-cache");
  const currentDirectory = normalizePath(`${cacheRoot}/${cacheKey}`);
  const portable = plugin.getPortablePdfFigurePayload(path);
  const signature = (figure) => [
    figure?.figureKey || "", Number(figure?.pageNumber) || 0,
    Number(figure?.pageWidth) || 0, Number(figure?.pageHeight) || 0,
    Number(figure?.x) || 0, Number(figure?.y) || 0,
    Number(figure?.width) || 0, Number(figure?.height) || 0
  ].join(":");
  const expected = new Set((portable?.figures || []).map(signature));
  const inspect = async (directory) => {
    try {
      const manifestPath = normalizePath(`${directory}/figures.json`);
      if (adapter.exists && !(await adapter.exists(manifestPath))) return null;
      const payload = JSON.parse(await adapter.read(manifestPath));
      const figures = Array.isArray(payload?.figures) ? payload.figures : [];
      if (!figures.some((figure) => figure.figureKey === figureKey)) return null;
      const overlap = expected.size ? figures.filter((figure) => expected.has(signature(figure))).length : 1;
      return overlap > 0 ? { directory, payload, overlap } : null;
    } catch (_) {
      return null;
    }
  };
  const current = await inspect(currentDirectory);
  if (current) {
    plugin.pdfFigureAssetDirectoryCache ||= new Map();
    plugin.pdfFigureAssetDirectoryCache.set(resolutionKey, current);
    return current;
  }
  // Older recognized images may remain valid after a sync or metadata-only
  // timestamp change even though the current cache hash differs. Match the
  // saved layout coordinates against existing recognition manifests instead
  // of falling back to cropping the source page.
  if (!expected.size) throw new Error("这张图片没有可用的识别结果，请重新执行图片识别");
  let listing = null;
  try {
    if (typeof adapter.list === "function") listing = await adapter.list(cacheRoot);
  } catch (_) {}
  const directories = Array.from(listing?.folders || []).map((directory) => normalizePath(directory));
  const matches = (await Promise.all(directories.map(inspect))).filter(Boolean)
    .sort((left, right) => right.overlap - left.overlap);
  const resolved = matches[0];
  if (!resolved) throw new Error("这张图片没有可用的识别结果，请重新执行图片识别");
  plugin.pdfFigureAssetDirectoryCache ||= new Map();
  plugin.pdfFigureAssetDirectoryCache.set(resolutionKey, resolved);
  return resolved;
}

export async function readRecognizedPdfFigureAsset(plugin, pdfPath, figureKey) {
  const path = normalizePath(pdfPath || "");
  const file = plugin.app.vault.getAbstractFileByPath(path);
  const adapter = plugin.app.vault.adapter;
  if (!path || !file || !adapter?.read || !adapter?.readBinary) throw new Error("找不到已识别图片的本地缓存");
  const cacheKey = await plugin.computePdfFigureCacheKey(path, file);
  if (!cacheKey) throw new Error("无法定位已识别图片缓存");
  const assetKey = `${cacheKey}:${figureKey}`;
  const cached = plugin.pdfFigureAssetCache?.get?.(assetKey);
  if (cached) return await cached;
  const loading = (async () => {
    const { directory, payload } = await plugin.resolveRecognizedPdfFigureCache(path, cacheKey, figureKey);
    const figure = (payload.figures || []).find((item) => item.figureKey === figureKey);
    const filename = String(figure?.cropPath || "").split(/[\\/]/).pop();
    if (!figure || !filename || !/^figure-[\w.-]+\.png$/i.test(filename)) {
      throw new Error("这张图片没有可用的识别结果，请重新执行图片识别");
    }
    const bytes = await adapter.readBinary(`${directory}/${filename}`);
    return {
      figure,
      dataUrl: arrayBufferToDataUrl(bytes, "image/png"),
      byteLength: bytes.byteLength || bytes.length || 0
    };
  })();
  plugin.pdfFigureAssetCache ||= new Map();
  plugin.pdfFigureAssetCache.set(assetKey, loading);
  try {
    const asset = await loading;
    plugin.pdfFigureAssetCache.set(assetKey, asset);
    return asset;
  } catch (error) {
    plugin.pdfFigureAssetCache.delete(assetKey);
    throw error;
  }
}

export async function createRecognizedPdfFigureDragPreview(plugin, asset) {
  if (!asset?.dataUrl) return null;
  const image = new Image();
  image.src = asset.dataUrl;
  await image.decode();
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(1, 260 / sourceWidth, 180 / sourceHeight);
  const preview = document.createElement("canvas");
  preview.className = "paperlib-pdf-figure-drag-preview";
  preview.width = Math.max(1, Math.round(sourceWidth * scale));
  preview.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = preview.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, preview.width, preview.height);
  context.drawImage(image, 0, 0, preview.width, preview.height);
  return preview;
}

export function installPdfFigureDragZones(plugin, root, pdfPath, paper, catalog) {
  const path = normalizePath(pdfPath || "");
  if (!root?.querySelectorAll || !path || !catalog?.figures) return false;
  const pages = [
    ...(root.matches?.(".paperlib-selectable-pdf-page, .page[data-page-number], .page") ? [root] : []),
    ...root.querySelectorAll(".paperlib-selectable-pdf-page, .page[data-page-number], .page")
  ];
  let mounted = false;
  pages.forEach((pageEl) => {
    const pageNumber = Number(pageEl.dataset?.page || pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
    if (!pageNumber) return;
    const figures = catalog.figures.filter((figure) => Number(figure.pageNumber) === pageNumber && figure.width > 0 && figure.height > 0);
    const signature = `${path}:${figures.map((figure) => figure.figureKey || `${figure.x}:${figure.y}:${figure.width}:${figure.height}`).join("|")}`;
    const existing = Array.from(pageEl.querySelectorAll(":scope > .paperlib-pdf-figure-drag-zone"));
    if (pageEl.dataset.paperlibFigureDragSignature === signature && existing.length === figures.length) {
      mounted ||= existing.length > 0;
      return;
    }
    existing.forEach((zone) => zone.remove());
    pageEl.dataset.paperlibFigureDragSignature = signature;
    figures.forEach((figure, index) => {
      const pageWidth = Math.max(1, Number(figure.pageWidth) || catalog.pageSizes?.get?.(pageNumber)?.width || 1);
      const pageHeight = Math.max(1, Number(figure.pageHeight) || catalog.pageSizes?.get?.(pageNumber)?.height || 1);
      const zone = document.createElement("div");
      zone.className = "paperlib-pdf-figure-drag-zone";
      zone.draggable = true;
      zone.title = "拖动图片到 Paper Composer";
      zone.setAttribute("aria-label", `${figure.label || `第 ${index + 1} 张图片`}，可拖动到 Paper Composer`);
      Object.assign(zone.style, {
        left: `${Math.max(0, Number(figure.x) / pageWidth) * 100}%`,
        top: `${Math.max(0, Number(figure.y) / pageHeight) * 100}%`,
        width: `${Math.max(0, Math.min(1 - Number(figure.x) / pageWidth, Number(figure.width) / pageWidth)) * 100}%`,
        height: `${Math.max(0, Math.min(1 - Number(figure.y) / pageHeight, Number(figure.height) / pageHeight)) * 100}%`
      });
      const preparePreview = () => {
        if (zone.paperlibFigureAsset || zone.paperlibFigureAssetLoading) return;
        zone.classList.remove("is-unavailable");
        zone.paperlibFigureAssetLoading = true;
        void plugin.readRecognizedPdfFigureAsset(path, String(figure.figureKey || ""))
          .then(async (asset) => {
            if (!zone.isConnected) return;
            zone.paperlibFigureAsset = asset;
            zone.paperlibDragPreview = await plugin.createRecognizedPdfFigureDragPreview(asset);
            zone.classList.add("is-ready");
          })
          .catch((error) => {
            zone.paperlibFigureAssetError = error;
            zone.classList.add("is-unavailable");
          })
          .finally(() => { zone.paperlibFigureAssetLoading = false; });
      };
      zone.addEventListener("pointerenter", preparePreview);
      zone.addEventListener("focus", preparePreview);
      zone.addEventListener("pointerdown", preparePreview);
      zone.addEventListener("dragstart", (event) => {
        const transfer = event.dataTransfer;
        if (!transfer) return;
        preparePreview();
        const payload = {
          path,
          page: pageNumber,
          figureKey: String(figure.figureKey || ""),
          label: String(figure.label || `第 ${pageNumber} 页图片 ${index + 1}`),
          caption: String(figure.caption || "")
        };
        transfer.setData("application/x-paperlib-pdf-figure", JSON.stringify(payload));
        transfer.effectAllowed = "copy";
        const preview = zone.paperlibDragPreview;
        if (preview) {
          document.body.appendChild(preview);
          transfer.setDragImage(preview, Math.round(preview.width / 2), Math.round(preview.height / 2));
          window.setTimeout(() => preview.remove(), 0);
        }
        zone.classList.add("is-dragging");
      });
      zone.addEventListener("dragend", () => {
        zone.classList.remove("is-dragging");
        zone.paperlibDragPreview?.remove?.();
      });
      pageEl.appendChild(zone);
      mounted = true;
    });
  });
  return mounted;
}

export async function pdfFigureDragToAIAttachment(plugin, rawPayload) {
  const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
  const path = normalizePath(payload?.path || "");
  if (!path) throw new Error("拖入的图片缺少来源路径");
  const asset = await plugin.readRecognizedPdfFigureAsset(path, String(payload.figureKey || ""));
  const figure = asset.figure;
  const file = plugin.app.vault.getAbstractFileByPath(path);
  const page = Number(payload.page || figure.pageNumber) || null;
  const label = String(payload.label || figure.label || `${file?.basename || "文档"} · 第 ${page || "—"} 页图片`);
  return {
    type: "image",
    label,
    detail: `${Number(figure.width) || "—"} × ${Number(figure.height) || "—"}`,
    dataUrl: asset.dataUrl,
    mime: "image/png",
    path,
    page,
    key: `pdf-figure:${path}:${payload.figureKey || `${page}:${figure.x}:${figure.y}:${figure.width}:${figure.height}`}`
  };
}

export async function migratePortablePdfFigureCatalogs(plugin) {
  if (plugin.isMobileApp()) return false;
  const fs = require("fs");
  const nodePath = require("path");
  let changed = false;
  for (const paper of plugin.settings.papers) {
    const paths = [paper.pdfPath, ...(paper.attachments || []).map((attachment) => attachment.path)]
      .map((value) => normalizePath(value || ""))
      .filter((value) => value && !/^https?:\/\//i.test(value));
    for (const path of paths) {
      if (plugin.getPortablePdfFigurePayload(path)) continue;
      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (!file) continue;
      const cacheKey = await plugin.computePdfFigureCacheKey(path, file);
      const manifestPath = plugin.getDesktopPluginPath(nodePath.join("figure-cache", cacheKey, "figures.json"));
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const payload = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
        if (plugin.setPortablePdfFigurePayload(path, payload)) changed = true;
      } catch (error) {
        console.warn("Paper Library: failed to migrate a portable figure catalog", error);
      }
    }
  }
  if (changed) await plugin.saveSettings();
  return changed;
}

export async function getPdfFigureCatalog(plugin, pdfPath, onProgress) {
  const path = normalizePath(pdfPath || "");
  if (!path) throw new Error("缺少 PDF 路径");
  const cached = plugin.pdfFigureCatalogCache.get(path);
  if (cached) {
    onProgress?.({ stage: "complete", figures: cached.figures.length, cached: true });
    return cached;
  }
  // Figure coordinates are portable and sufficient for rendering crops from
  // the PDF with PDF.js. Always reuse them before checking the Python/ONNX
  // runtime. This keeps already-recognized figures viewable when a Python
  // update breaks the disposable venv, and is also the mobile sync path.
  const portablePayload = plugin.getPortablePdfFigurePayload(path) || await plugin.readSyncedPdfFigurePayload(path);
  if (portablePayload) {
    const payload = portablePayload;
    if (!plugin.getPortablePdfFigurePayload(path) && plugin.setPortablePdfFigurePayload(path, payload)) {
      await plugin.saveSettings();
    }
    const document = await plugin.loadPdfFigureDocument(path);
    const catalog = plugin.createPdfFigureCatalog(path, payload, document);
    plugin.pdfFigureCatalogCache.set(path, catalog);
    onProgress?.({ stage: "complete", figures: catalog.figures.length, cached: true });
    return catalog;
  }
  if (plugin.isMobileApp()) {
    throw new Error("尚未找到桌面端已识别的图片索引，请先在桌面端识别并同步一次");
  }
  if (!plugin.settings.enableFigureRecognition) throw new Error("图片识别尚未开启");
  if (!plugin.isDocLayoutRuntimeInstalled()) throw new Error("图片识别运行时尚未安装，请在插件设置中完成下载");
  if (onProgress) {
    if (!plugin.pdfFigureProgressListeners.has(path)) plugin.pdfFigureProgressListeners.set(path, new Set());
    plugin.pdfFigureProgressListeners.get(path).add(onProgress);
  }
  const pending = plugin.pdfFigureCatalogLoading.get(path);
  if (pending) return pending;
  const loading = (async () => {
    plugin.emitPdfFigureProgress(path, { stage: "model", current: 0, total: 0, figures: 0 });
    const payload = await plugin.runDocLayoutFigureExtraction(path, (state) => plugin.emitPdfFigureProgress(path, state));
    const catalog = plugin.createPdfFigureCatalog(path, payload);
    plugin.pdfFigureCatalogCache.set(path, catalog);
    if (plugin.setPortablePdfFigurePayload(path, payload)) await plugin.saveSettings();
    plugin.emitPdfFigureProgress(path, { stage: "complete", current: payload.totalPages || 0, total: payload.totalPages || 0, figures: catalog.figures.length });
    return catalog;
  })();
  plugin.pdfFigureCatalogLoading.set(path, loading);
  try {
    return await loading;
  } catch (error) {
    plugin.emitPdfFigureProgress(path, { stage: "error", message: error.message || String(error) });
    throw error;
  } finally {
    plugin.pdfFigureCatalogLoading.delete(path);
    plugin.pdfFigureProgressListeners.delete(path);
  }
}

export async function openPdfFigureAtPoint(plugin, pdfPath, paper, pageNumber, xRatio, yRatio) {
  const path = normalizePath(pdfPath || "");
  if (!plugin.isMobileApp() && !plugin.settings.enableFigureRecognition && !plugin.getPortablePdfFigurePayload(path)) return false;
  if (!path || plugin.pdfFigureOpenBusy.has(path)) return false;
  plugin.pdfFigureOpenBusy.add(path);
  try {
    const catalog = await plugin.getPdfFigureCatalog(path);
    const pageSize = catalog.pageSizes.get(Number(pageNumber));
    if (!pageSize) return false;
    const x = Math.max(0, Math.min(1, Number(xRatio))) * pageSize.width;
    const y = Math.max(0, Math.min(1, Number(yRatio))) * pageSize.height;
    const hits = catalog.placements
      .map((figure) => ({
        figure,
        index: catalog.figures.findIndex((item) => item.figureKey === figure.figureKey)
      }))
      .filter(({ figure }) => {
        if (figure.pageNumber !== Number(pageNumber)) return false;
        const padding = Math.max(5, Math.min(18, Math.min(figure.width, figure.height) * 0.04));
        return x >= figure.x - padding && x <= figure.x + figure.width + padding
          && y >= figure.y - padding && y <= figure.y + figure.height + padding;
      })
      .sort((a, b) => a.figure.width * a.figure.height - b.figure.width * b.figure.height);
    if (!hits.length) return false;
    new PdfFigureCarouselModal(plugin.app, plugin, paper, path, catalog.figures, hits[0].index).open();
    return true;
  } catch (error) {
    console.error("Paper Library: failed to open PDF figure viewer", error);
    if (!plugin.isMobileApp()) new Notice(`图片识别失败：${error.message || error}`);
    return false;
  } finally {
    plugin.pdfFigureOpenBusy.delete(path);
  }
}

export async function openPdfFigureGallery(plugin, pdfPath, paper) {
  const path = normalizePath(pdfPath || "");
  const mobile = plugin.isMobileApp();
  const hasPortableCatalog = Boolean(plugin.getPortablePdfFigurePayload(path));
  if (!mobile && !plugin.settings.enableFigureRecognition && !hasPortableCatalog) {
    return new Notice("请先在 Paper Library 设置中开启 PDF 图片识别");
  }
  if (!mobile && !plugin.isDocLayoutRuntimeInstalled() && !hasPortableCatalog) {
    return new Notice("图片识别运行时尚未安装，请在设置中完成下载");
  }
  if (!path || plugin.pdfFigureOpenBusy.has(path)) return;
  plugin.pdfFigureOpenBusy.add(path);
  const loadingNotice = new Notice(mobile ? "正在读取已识别图片…" : "正在提取整篇 PDF 的图片…", 0);
  try {
    const catalog = await plugin.getPdfFigureCatalog(path);
    loadingNotice.hide?.();
    if (!catalog.figures.length) return new Notice("这篇 PDF 中没有识别到可显示的图片");
    new PdfFigureGalleryModal(plugin.app, plugin, paper, path, catalog.figures).open();
  } catch (error) {
    loadingNotice.hide?.();
    console.error("Paper Library: failed to open PDF figure gallery", error);
    new Notice(`${mobile ? "图片打开失败" : "图片提取失败"}：${error.message || error}`);
  } finally {
    plugin.pdfFigureOpenBusy.delete(path);
  }
}

export async function renderPdfFigure(plugin, pdfPath, figure, canvas, options = {}) {
  const catalog = await plugin.getPdfFigureCatalog(pdfPath);
  const thumbnail = Boolean(options.thumbnail);
  if (figure.cropPath && !plugin.isMobileApp()) return plugin.paintDocLayoutFigure(canvas, figure.cropPath, thumbnail);
  if (!catalog.document) catalog.document = await plugin.loadPdfFigureDocument(pdfPath);
  const page = await catalog.document.getPage(figure.pageNumber);
  if (figure.objectId) {
    try {
      const image = await plugin.getPdfImageObject(page, figure.objectId);
      if (image && (image.bitmap || image.data)) return plugin.paintPdfImageObject(canvas, image, thumbnail);
    } catch (error) {
      console.warn("Paper Library: direct PDF image extraction failed; using page crop", error);
    }
  }
  return plugin.renderPdfFigureCrop(page, figure, canvas, thumbnail);
}

export async function exportPdfFigureHighResolution(plugin, pdfPath, figure) {
  const path = normalizePath(pdfPath || "");
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!file) throw new Error("找不到 PDF 文件");
  const [pdfjs, buffer] = await Promise.all([loadPdfJs(), plugin.readPdfBinary(file)]);
  const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  try {
    const page = await pdfDocument.getPage(Math.max(1, Number(figure.pageNumber) || 1));
    const baseViewport = page.getViewport({ scale: 1 });
    const pageWidth = Math.max(1, Number(figure.pageWidth) || baseViewport.width);
    const pageHeight = Math.max(1, Number(figure.pageHeight) || baseViewport.height);
    const xRatio = Math.max(0, Math.min(1, Number(figure.x) / pageWidth));
    const yRatio = Math.max(0, Math.min(1, Number(figure.y) / pageHeight));
    const widthRatio = Math.max(1 / pageWidth, Math.min(1 - xRatio, Number(figure.width) / pageWidth));
    const heightRatio = Math.max(1 / pageHeight, Math.min(1 - yRatio, Number(figure.height) / pageHeight));

    const targetDpi = 1200;
    let renderScale = targetDpi / 72;
    const baseCropWidth = baseViewport.width * widthRatio;
    const baseCropHeight = baseViewport.height * heightRatio;
    const requestedWidth = baseCropWidth * renderScale;
    const requestedHeight = baseCropHeight * renderScale;
    const maxDimension = 8192;
    const maxPixels = 32 * 1024 * 1024;
    const safetyScale = Math.min(
      1,
      maxDimension / Math.max(1, requestedWidth, requestedHeight),
      Math.sqrt(maxPixels / Math.max(1, requestedWidth * requestedHeight))
    );
    renderScale *= safetyScale;

    const viewport = page.getViewport({ scale: renderScale });
    const cropX = viewport.width * xRatio;
    const cropY = viewport.height * yRatio;
    const width = Math.max(1, Math.round(viewport.width * widthRatio));
    const height = Math.max(1, Math.round(viewport.height * heightRatio));
    const canvas = window.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({
      canvasContext: context,
      viewport,
      transform: [1, 0, 0, 1, -cropX, -cropY]
    }).promise;
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("PNG 编码失败")),
      "image/png"
    ));
    return {
      blob,
      width,
      height,
      dpi: Math.max(72, Math.round(72 * renderScale))
    };
  } finally {
    await pdfDocument.destroy?.();
  }
}

export async function paintDocLayoutFigure(plugin, canvas, cropPath, thumbnail = false) {
  const fs = require("fs");
  const bytes = await fs.promises.readFile(cropPath);
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const sourceWidth = Math.max(1, image.naturalWidth || image.width);
    const sourceHeight = Math.max(1, image.naturalHeight || image.height);
    const maxDimension = thumbnail ? 420 : 2800;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const displayWidth = thumbnail
      ? Math.max(120, Math.min(260, sourceWidth))
      : Math.max(320, Math.min(1200, sourceWidth));
    return { width: displayWidth, height: displayWidth * sourceHeight / sourceWidth };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function paintPdfImageObject(plugin, canvas, image, thumbnail = false) {
  const sourceWidth = Math.max(1, Number(image.width || image.bitmap?.width) || 1);
  const sourceHeight = Math.max(1, Number(image.height || image.bitmap?.height) || 1);
  const maxDimension = thumbnail ? 420 : 2800;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  if (image.bitmap) {
    context.drawImage(image.bitmap, 0, 0, width, height);
  } else {
    const source = image.data;
    const target = context.createImageData(width, height);
    const pixelCount = sourceWidth * sourceHeight;
    const inferredChannels = pixelCount ? Math.round(source.length / pixelCount) : 0;
    const kind = Number(image.kind || 0);
    for (let targetY = 0; targetY < height; targetY += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.floor(targetY / scale));
      for (let targetX = 0; targetX < width; targetX += 1) {
        const sourceX = Math.min(sourceWidth - 1, Math.floor(targetX / scale));
        const targetIndex = (targetY * width + targetX) * 4;
        if (kind === 1 || inferredChannels < 1) {
          const rowBytes = Math.ceil(sourceWidth / 8);
          const bit = (source[sourceY * rowBytes + (sourceX >> 3)] >> (7 - (sourceX & 7))) & 1;
          const value = bit ? 255 : 0;
          target.data[targetIndex] = value;
          target.data[targetIndex + 1] = value;
          target.data[targetIndex + 2] = value;
          target.data[targetIndex + 3] = 255;
        } else if (kind === 3 || inferredChannels === 4) {
          const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
          target.data[targetIndex] = source[sourceIndex];
          target.data[targetIndex + 1] = source[sourceIndex + 1];
          target.data[targetIndex + 2] = source[sourceIndex + 2];
          target.data[targetIndex + 3] = source[sourceIndex + 3];
        } else {
          const sourceIndex = (sourceY * sourceWidth + sourceX) * 3;
          target.data[targetIndex] = source[sourceIndex];
          target.data[targetIndex + 1] = source[sourceIndex + 1];
          target.data[targetIndex + 2] = source[sourceIndex + 2];
          target.data[targetIndex + 3] = 255;
        }
      }
    }
    context.putImageData(target, 0, 0);
  }
  const displayWidth = thumbnail
    ? Math.max(120, Math.min(260, sourceWidth))
    : Math.max(320, Math.min(1200, sourceWidth));
  return { width: displayWidth, height: displayWidth * sourceHeight / sourceWidth };
}

export async function renderPdfFigureCrop(plugin, page, figure, canvas, thumbnail = false) {
  const baseViewport = page.getViewport({ scale: 1 });
  const sourcePageWidth = Math.max(1, Number(figure.pageWidth) || baseViewport.width);
  const sourcePageHeight = Math.max(1, Number(figure.pageHeight) || baseViewport.height);
  const xRatio = Math.max(0, Math.min(1, Number(figure.x) / sourcePageWidth));
  const yRatio = Math.max(0, Math.min(1, Number(figure.y) / sourcePageHeight));
  const widthRatio = Math.max(1 / sourcePageWidth, Math.min(1 - xRatio, Number(figure.width) / sourcePageWidth));
  const heightRatio = Math.max(1 / sourcePageHeight, Math.min(1 - yRatio, Number(figure.height) / sourcePageHeight));
  const baseCropWidth = Math.max(1, baseViewport.width * widthRatio);
  const renderScale = thumbnail
    ? Math.max(0.8, Math.min(2.2, 420 / baseCropWidth))
    : Math.max(1.5, Math.min(4, 1800 / baseCropWidth));
  const viewport = page.getViewport({ scale: renderScale });
  const cropX = viewport.width * xRatio;
  const cropY = viewport.height * yRatio;
  const width = Math.max(1, Math.ceil(viewport.width * widthRatio));
  const height = Math.max(1, Math.ceil(viewport.height * heightRatio));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.restore();
  await page.render({
    canvasContext: context,
    viewport,
    transform: [1, 0, 0, 1, -cropX, -cropY]
  }).promise;
  const displayWidth = thumbnail
    ? Math.max(120, Math.min(260, baseCropWidth))
    : Math.max(320, Math.min(1200, baseCropWidth * 1.35));
  return { width: displayWidth, height: displayWidth * heightRatio * baseViewport.height / baseCropWidth };
}

export async function renderPdfThumbnail(plugin, path, canvas) {
  if (!path || /^https?:\/\//i.test(path) || !canvas?.getContext) return false;
  let document = null;
  try {
    const file = plugin.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!file) return false;
    const buffer = await plugin.app.vault.readBinary(file);
    const pdfjs = await loadPdfJs();
    document = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    const page = await document.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.4, 120 / natural.width) });
    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
    canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }).promise;
    return true;
  } catch (error) {
    console.warn(`Paper Library: failed to render attachment thumbnail for ${path}`, error);
    return false;
  } finally {
    await document?.destroy?.();
  }
}
