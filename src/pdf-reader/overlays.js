import { CANVAS_HIGHLIGHT_COLORS } from "../constants.js";
import { Menu, loadPdfJs, normalizePath } from "obsidian";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "../../vendor/pdf-lib.min.js";
import { setPaperlibIcon } from "../ui-utils.js";
import { truncate } from "../text-utils.js";

const overlaysMethods = {
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
  },

  ensureNativePdfInkLayer(pageEl) {
    let svg = pageEl.querySelector(":scope > .paperlib-native-pdf-ink-layer");
    if (svg) return svg;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "paperlib-native-pdf-ink-layer");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    pageEl.appendChild(svg);
    return svg;
  },

  appendNativePdfShape(svg, shape, pageEl, pending = false) {
    if (!svg || !shape?.start || !shape?.end) return null;
    const color = CANVAS_HIGHLIGHT_COLORS.find((item) => item.id === shape.color) || CANVAS_HIGHLIGHT_COLORS[0];
    const width = Math.max(1.5, Math.min(8, Number(shape.width) || 2.5));
    const type = ["line", "arrow", "circle", "ellipse", "rect"].includes(shape.type) ? shape.type : "line";
    const x1 = Math.max(0, Math.min(1, Number(shape.start.x) || 0)) * 1000;
    const y1 = Math.max(0, Math.min(1, Number(shape.start.y) || 0)) * 1000;
    const x2 = Math.max(0, Math.min(1, Number(shape.end.x) || 0)) * 1000;
    const y2 = Math.max(0, Math.min(1, Number(shape.end.y) || 0)) * 1000;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `paperlib-pdf-shape${pending ? " is-pending" : ""}`);
    group.dataset.shapeId = shape.id || "";
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const boxWidth = Math.abs(x2 - x1);
    const boxHeight = Math.abs(y2 - y1);
    if (type === "rect" || type === "ellipse" || type === "circle") {
      const node = document.createElementNS("http://www.w3.org/2000/svg", type === "rect" ? "rect" : "ellipse");
      if (type !== "rect") {
        node.setAttribute("cx", String(left + boxWidth / 2));
        node.setAttribute("cy", String(top + boxHeight / 2));
        node.setAttribute("rx", String(boxWidth / 2));
        node.setAttribute("ry", String(boxHeight / 2));
      } else {
        node.setAttribute("x", String(left));
        node.setAttribute("y", String(top));
        node.setAttribute("width", String(boxWidth));
        node.setAttribute("height", String(boxHeight));
      }
      node.setAttribute("fill", "none");
      node.setAttribute("stroke", color.value);
      node.setAttribute("stroke-width", String(width));
      node.setAttribute("vector-effect", "non-scaling-stroke");
      group.appendChild(node);
    } else {
      let lineEndX = x2;
      let lineEndY = y2;
      let head = null;
      if (type === "arrow") {
        const bounds = pageEl?.getBoundingClientRect?.();
        const pageWidth = Math.max(1, bounds?.width || 1);
        const pageHeight = Math.max(1, bounds?.height || 1);
        const dx = (x2 - x1) / 1000 * pageWidth;
        const dy = (y2 - y1) / 1000 * pageHeight;
        const length = Math.hypot(dx, dy);
        if (length > 2) {
          const ux = dx / length;
          const uy = dy / length;
          const size = Math.max(10, width * 4);
          const half = size * 0.45;
          // 线段止于箭头底部，避免圆头笔帽从箭尖后面露出来
          const baseX = x2 - ux * size / pageWidth * 1000;
          const baseY = y2 - uy * size / pageHeight * 1000;
          lineEndX = baseX;
          lineEndY = baseY;
          const leftX = baseX - uy * half / pageWidth * 1000;
          const leftY = baseY + ux * half / pageHeight * 1000;
          const rightX = baseX + uy * half / pageWidth * 1000;
          const rightY = baseY - ux * half / pageHeight * 1000;
          head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          head.setAttribute("points", `${x2},${y2} ${leftX},${leftY} ${rightX},${rightY}`);
          head.setAttribute("fill", color.value);
          head.setAttribute("stroke", "none");
        }
      }
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(lineEndX));
      line.setAttribute("y2", String(lineEndY));
      line.setAttribute("stroke", color.value);
      line.setAttribute("stroke-width", String(width));
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      group.appendChild(line);
      if (head) group.appendChild(head);
    }
    svg.appendChild(group);
    return group;
  },

  ensureNativePdfShapeLayer(pageEl) {
    let svg = pageEl.querySelector(":scope > .paperlib-native-pdf-shape-layer");
    if (svg) return svg;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "paperlib-native-pdf-shape-layer");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    pageEl.appendChild(svg);
    return svg;
  },

  isNativePdfMarkEmbedded(file, mark, embeddedIds) {
    if (this.settings.pdfAnnotationWriteback === "off" || !mark) return false;
    const path = normalizePath(mark.pdfPath || file?.path || "");
    const key = `${path}|${mark.pdfAnnotationId || mark.id}`;
    if (this.pendingPdfAnnotationSyncs?.has(key)) return false;
    return Boolean(embeddedIds?.has?.(`paperlib:${mark.pdfAnnotationId || mark.id}`));
  },

  async renderNativePdfShapeOverlays(leaf, container, force = false) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) {
      container?.querySelectorAll?.(".paperlib-native-pdf-shape-layer")?.forEach?.((element) => element.remove());
      return;
    }
    const embeddedIds = this.settings.pdfAnnotationWriteback === "off"
      ? new Set()
      : await this.getNativePdfEmbeddedMarkIds(file).catch(() => new Set());
    if (!container?.isConnected) return;
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
      if (!pageNumber) return;
      const shapes = this.getPdfShapes(paper, file.path, pageNumber);
      const visible = shapes.filter((shape) => !this.isNativePdfMarkEmbedded(file, shape, embeddedIds));
      const flags = shapes.map((shape) => this.isNativePdfMarkEmbedded(file, shape, embeddedIds) ? 1 : 0).join("");
      const signature = `${flags}|` + visible.map((shape) => (
        `${shape.id}:${shape.type}:${shape.color}:${shape.width}:${shape.start?.x || 0}:${shape.start?.y || 0}:${shape.end?.x || 0}:${shape.end?.y || 0}`
      )).join("|");
      const existing = pageEl.querySelector(":scope > .paperlib-native-pdf-shape-layer");
      if (!force && existing?.dataset.signature === signature) return;
      if (!visible.length && !existing) return;
      const svg = existing || this.ensureNativePdfShapeLayer(pageEl);
      svg.replaceChildren();
      svg.dataset.signature = signature;
      visible.forEach((shape) => this.appendNativePdfShape(svg, shape, pageEl));
    });
  },

  refreshNativePdfShapeOverlays(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      void this.renderNativePdfShapeOverlays(leaf, container, true).catch((error) => console.error("Paper Library: failed to render shape overlays", error));
    });
  },

  async renderNativePdfInkOverlays(leaf, container, force = false) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) {
      container?.querySelectorAll?.(".paperlib-native-pdf-ink-layer")?.forEach?.((element) => element.remove());
      return;
    }
    const embeddedIds = this.settings.pdfAnnotationWriteback === "off"
      ? new Set()
      : await this.getNativePdfEmbeddedMarkIds(file).catch(() => new Set());
    if (!container?.isConnected) return;
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
      if (!pageNumber) return;
      const strokes = this.getPdfInkStrokes(paper, file.path, pageNumber);
      const visible = strokes.filter((stroke) => !this.isNativePdfMarkEmbedded(file, stroke, embeddedIds));
      const flags = strokes.map((stroke) => this.isNativePdfMarkEmbedded(file, stroke, embeddedIds) ? 1 : 0).join("");
      const signature = `${flags}|` + visible.map((stroke) => (
        `${stroke.id}:${stroke.color}:${stroke.width}:${stroke.points?.length || 0}:${stroke.points?.at?.(-1)?.x || 0}:${stroke.points?.at?.(-1)?.y || 0}`
      )).join("|");
      const existing = pageEl.querySelector(":scope > .paperlib-native-pdf-ink-layer");
      if (!force && existing?.dataset.signature === signature) return;
      if (!visible.length && !existing) return;
      const svg = existing || this.ensureNativePdfInkLayer(pageEl);
      svg.replaceChildren();
      svg.dataset.signature = signature;
      visible.forEach((stroke) => this.appendNativePdfInkPath(svg, stroke));
    });
  },

  refreshNativePdfInkOverlays(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      void this.renderNativePdfInkOverlays(leaf, container, true).catch((error) => console.error("Paper Library: failed to render ink overlays", error));
    });
  },

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
  },

  getNativePdfEmbeddedMarkIds(file) {
    // 读取 PDF 里已经写回的 paperlib 注解 NM，用于判断文本框是否已经有内嵌副本
    if (!file?.path) return Promise.resolve(new Set());
    const path = normalizePath(file.path);
    this.nativePdfEmbeddedMarkIdsCache = this.nativePdfEmbeddedMarkIdsCache || new Map();
    return (async () => {
      let stat = null;
      try {
        stat = await this.app.vault.adapter?.stat?.(path);
      } catch (error) {
        stat = null;
      }
      const key = `${path}|${stat?.mtime || 0}|${stat?.size || 0}`;
      const cached = this.nativePdfEmbeddedMarkIdsCache.get(key);
      if (cached) return cached;
      const promise = (async () => {
        const buffer = await this.readPdfBinary(file);
        const document = await PDFDocument.load(buffer, { updateMetadata: false });
        const ids = new Set();
        for (const page of document.getPages()) {
          const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
          if (!annots) continue;
          for (let index = 0; index < annots.size(); index += 1) {
            const dictionary = document.context.lookupMaybe(annots.get(index), PDFDict);
            if (!dictionary) continue;
            const nm = this.readPdfAnnotationString(document, dictionary, "NM");
            if (nm.startsWith("paperlib:")) ids.add(nm);
          }
        }
        return ids;
      })();
      this.nativePdfEmbeddedMarkIdsCache.set(key, promise);
      if (this.nativePdfEmbeddedMarkIdsCache.size > 24) {
        const oldest = this.nativePdfEmbeddedMarkIdsCache.keys().next().value;
        this.nativePdfEmbeddedMarkIdsCache.delete(oldest);
      }
      promise.catch(() => this.nativePdfEmbeddedMarkIdsCache.delete(key));
      return promise;
    })();
  },

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
  },

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
  },

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
              subtype: String(annotation.subtype || ""),
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
  },

  pdfRectsOverlapRatio(first, second) {
    const width = Math.min(first[2], second[2]) - Math.max(first[0], second[0]);
    const height = Math.min(first[3], second[3]) - Math.max(first[1], second[1]);
    if (width <= 0 || height <= 0) return 0;
    const intersection = width * height;
    const areaFirst = Math.max(0, first[2] - first[0]) * Math.max(0, first[3] - first[1]);
    const areaSecond = Math.max(0, second[2] - second[0]) * Math.max(0, second[3] - second[1]);
    const smaller = Math.min(areaFirst, areaSecond);
    return smaller > 0 ? intersection / smaller : 0;
  },

  getPdfRectsUnion(pdfRects) {
    const rects = (pdfRects || []).map((item) => item?.rect).filter((rect) => Array.isArray(rect) && rect.length === 4);
    if (!rects.length) return null;
    return [
      Math.min(...rects.map((rect) => Math.min(rect[0], rect[2]))),
      Math.min(...rects.map((rect) => Math.min(rect[1], rect[3]))),
      Math.max(...rects.map((rect) => Math.max(rect[0], rect[2]))),
      Math.max(...rects.map((rect) => Math.max(rect[1], rect[3])))
    ];
  },

  pdfRectsClose(first, second, tolerance = 3) {
    if (!Array.isArray(first) || first.length !== 4 || !Array.isArray(second) || second.length !== 4) return false;
    return first.every((value, index) => Math.abs(Number(value) - Number(second[index])) <= tolerance);
  },

  hideOwnNativePdfAnnotations(container, annotationsByPage) {
    // 写回后 PDF 注释层会渲染我们写入的内嵌高亮，与覆盖层叠加导致变深且不均匀。
    // 注释层不一定位于 .page 元素内部（Obsidian 的视图结构与 pdf.js 默认不同），
    // 因此在视图容器级别按注释 id 全局匹配隐藏；id 全局唯一，无需按页区分。
    const ids = new Set();
    for (const list of annotationsByPage?.values?.() || []) {
      for (const annotation of list) {
        // Ink 注解由 PDF 注释层自己绘制，覆盖层已跳过，不能再隐藏
        if (String(annotation.subtype || "").toLowerCase() === "ink") continue;
        ids.add(String(annotation.id));
      }
    }
    if (!ids.size) return;
    const elements = container?.querySelectorAll?.("[data-annotation-id]") || [];
    elements.forEach((element) => {
      const id = String(element.dataset?.annotationId || element.getAttribute?.("data-annotation-id") || "");
      element.classList?.toggle?.("paperlib-native-hidden-annotation", Boolean(id && ids.has(id)));
    });
  },

  refreshNativePdfHighlightOverlays(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      void this.renderNativePdfHighlightOverlays(leaf, container, true);
    });
  },

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
  },

  refreshNativePdfNoteOverlays(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      void this.renderNativePdfNoteOverlays(leaf, container, true);
    });
  },

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
  },

  findNearestNativePdfPage(container, clientX, clientY) {
    let best = null;
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const rect = pageEl.getBoundingClientRect?.();
      if (!rect?.width || !rect?.height) return;
      const deltaX = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const deltaY = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      const distance = Math.hypot(deltaX, deltaY);
      if (!best || distance < best.distance) best = { pageEl, rect, distance };
    });
    return best && best.distance <= 320 ? best : null;
  },

  async renderNativePdfTextBoxes(leaf, container, force = false) {
    const file = leaf?.view?.file || this.app.workspace.getActiveFile();
    const paper = this.getPaperForPdfFile(file);
    if (!file?.path || !paper) {
      container?.querySelectorAll?.(".paperlib-native-pdf-textbox-layer")?.forEach?.((element) => element.remove());
      return;
    }
    const path = normalizePath(file.path);
    const sizes = await this.getNativePdfPageSizes(file).catch(() => null);
    const embeddedIds = this.settings.pdfAnnotationWriteback === "off"
      ? new Set()
      : await this.getNativePdfEmbeddedMarkIds(file).catch(() => new Set());
    if (!container?.isConnected) return;
    const boxes = (paper.annotations || []).filter((mark) => (
      mark.pdfSubtype === "FreeText"
      && mark.box
      && normalizePath(mark.pdfPath || paper.pdfPath || "") === path
    ));
    const isEmbedded = (mark) => this.isNativePdfMarkEmbedded(file, mark, embeddedIds);
    container.querySelectorAll(".page[data-page-number], .page").forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset?.pageNumber || pageEl.getAttribute?.("data-page-number"));
      if (!pageNumber) return;
      // 正在编辑时不要重建卡片，否则 contenteditable 会被替换，焦点和输入都会丢失
      if (pageEl.querySelector(":scope > .paperlib-native-pdf-textbox-layer .paperlib-pdf-textbox-card.is-editing")) return;
      const dims = sizes?.get?.(pageNumber);
      const pageRect = pageEl.getBoundingClientRect?.();
      const scale = dims?.width && pageRect?.width ? pageRect.width / dims.width : 1;
      const pageBoxes = boxes.filter((mark) => Number(mark.page) === pageNumber);
      const embeddedFlags = new Map(pageBoxes.map((mark) => [mark.id, isEmbedded(mark)]));
      const signature = `${Math.round(pageRect?.width || 0)}|` + pageBoxes.map((mark) => (
        `${mark.id}:${Number(mark.box.x).toFixed(4)}:${Number(mark.box.y).toFixed(4)}:${String(mark.comment || "").length}:${mark.fontSize || 0}:${mark.textColor || ""}:${embeddedFlags.get(mark.id) ? 1 : 0}`
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
      pageBoxes.forEach((mark) => this.appendPdfTextBoxCard(layer, mark, paper, pageEl, scale, embeddedFlags.get(mark.id)));
    });
    // pdf.js 的注释层可能在页面渲染后才创建，写回后的 FreeText 会和覆盖卡片叠成两份；
    // 这里晚一点再隐藏一次，覆盖异步创建的注释节点。
    void this.getNativePdfOwnAnnotations(file).then((own) => {
      const apply = () => {
        if (container.isConnected) this.hideOwnNativePdfAnnotations(container, own);
      };
      apply();
      setTimeout(apply, 200);
      setTimeout(apply, 800);
    }).catch(() => {});
  },

  async refreshNativePdfTextBoxes(paper) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !this.app.workspace?.getLeavesOfType) return;
    const jobs = [];
    this.app.workspace.getLeavesOfType("pdf").forEach((leaf) => {
      const file = leaf.view?.file;
      const container = leaf.view?.containerEl;
      if (!container || this.getPaperForPdfFile(file)?.id !== paper.id) return;
      jobs.push(this.renderNativePdfTextBoxes(leaf, container, true));
    });
    await Promise.all(jobs);
  },

  appendPdfTextBoxCard(layer, mark, paper, pageEl, scale = 1, embedded = false) {
    const box = mark.box || { x: 0.6, y: 0.3, width: 0.02 };
    const x = Math.max(0, Math.min(0.94, Number(box.x) || 0));
    const y = Math.max(-0.3, Math.min(1.3, Number(box.y) || 0));
    const card = document.createElement("div");
    card.className = "paperlib-pdf-textbox-card";
    if (embedded) card.classList.add("is-embedded");
    card.dataset.markId = mark.id;
    card.style.left = `${x * 100}%`;
    card.style.top = `${y * 100}%`;
    card.style.maxWidth = `${Math.max(0.2, 1 - x) * 100}%`;
    card.style.fontSize = `${this.getPdfTextBoxFontSize(mark) * Math.max(0.2, Number(scale) || 1)}px`;
    const content = document.createElement("div");
    content.className = "paperlib-pdf-textbox-content";
    content.style.color = this.getPdfTextBoxTextColorValue(mark);
    content.setAttribute("contenteditable", "false");
    content.spellcheck = false;
    content.textContent = mark.comment || "";
    card.appendChild(content);

    const enterEdit = () => {
      card.dataset.editing = "true";
      card.classList.remove("is-embedded");
      card.classList.add("is-editing");
      content.setAttribute("contenteditable", "true");
      content.focus();
      const selection = content.ownerDocument?.defaultView?.getSelection?.();
      if (selection) {
        const range = content.ownerDocument.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    };
    const leaveEdit = () => {
      if (card.dataset.editing !== "true") return;
      card.dataset.editing = "false";
      card.classList.remove("is-editing");
      content.setAttribute("contenteditable", "false");
    };

    content.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") content.blur();
    });
    content.addEventListener("blur", () => {
      if (card.dataset.editing !== "true") return;
      leaveEdit();
      const value = content.textContent || "";
      const trimmed = value.trim();
      if (!trimmed) {
        void this.deletePdfTextBox(paper, mark);
        return;
      }
      // 已写回的文本框只是点开又失焦：不触发写回队列，恢复隐藏状态避免叠影
      if (embedded && value === String(mark.comment || "")) {
        card.classList.add("is-embedded");
        return;
      }
      const pageRect = pageEl.getBoundingClientRect?.();
      const width = pageRect?.width > 0
        ? Math.max(0.02, Math.min(0.9, card.offsetWidth / pageRect.width))
        : (Number(box.width) || 0.3);
      const nextX = Math.min(x, Math.max(0, 1 - width));
      void this.updatePdfTextBox(paper, mark.id, { comment: value, box: { x: nextX, y, width } });
      content.textContent = value;
    });

    let press = null;
    const move = (event) => {
      if (!press) return;
      const deltaX = event.clientX - press.startX;
      const deltaY = event.clientY - press.startY;
      if (!press.moved && Math.hypot(deltaX, deltaY) < 4) return;
      press.moved = true;
      const pageRect = pageEl.getBoundingClientRect?.();
      if (!pageRect?.width || !pageRect?.height) return;
      const nextX = Math.max(0, Math.min(0.94, press.x + deltaX / pageRect.width));
      const nextY = Math.max(-0.3, Math.min(1.3, press.y + deltaY / pageRect.height));
      card.style.left = `${nextX * 100}%`;
      card.style.top = `${nextY * 100}%`;
      card.style.maxWidth = `${Math.max(0.2, 1 - nextX) * 100}%`;
      card.dataset.dragX = String(nextX);
      card.dataset.dragY = String(nextY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      const current = press;
      press = null;
      if (!current) return;
      if (current.moved) {
        const nextX = Number(card.dataset.dragX || current.x);
        const nextY = Number(card.dataset.dragY || current.y);
        const pageRect = pageEl.getBoundingClientRect?.();
        const width = pageRect?.width > 0
          ? Math.max(0.02, Math.min(0.9, card.offsetWidth / pageRect.width))
          : (Number(box.width) || 0.3);
        if (embedded) card.classList.add("is-embedded");
        void this.updatePdfTextBox(paper, mark.id, { box: { x: nextX, y: nextY, width } })
          .then(async () => {
            // 已写回的文本框拖动后：立刻把注解移到新位置，否则 PDF 里的旧文字会留在原处
            if (!embedded || this.settings.pdfAnnotationWriteback === "off") return;
            try {
              await this.flushPdfAnnotationSyncs((queued) => queued.id === mark.id);
              await this.refreshNativePdfTextBoxes(paper);
            } catch (error) {
              console.error("Paper Library: failed to write dragged text box", error);
            }
          })
          .catch((error) => console.error("Paper Library: failed to update dragged text box", error));
        return;
      }
      enterEdit();
    };
    card.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (card.dataset.editing === "true") return;
      event.preventDefault();
      event.stopPropagation();
      // 内嵌文本框平时只显示 PDF 里的文字；一旦拖动/点击就先显示卡片，避免用户看不到操作对象
      card.classList.remove("is-embedded");
      press = { startX: event.clientX, startY: event.clientY, x, y, moved: false };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    });
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
  },
};

export { overlaysMethods };
