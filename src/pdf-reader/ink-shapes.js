import { CANVAS_HIGHLIGHT_COLORS } from "../constants.js";
import { Notice, normalizePath } from "obsidian";
import { workspaceId } from "../paper-utils.js";

const inkshapesMethods = {
  getPdfInkStrokes(paper, pdfPath = paper?.pdfPath, page = null) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return [];
    this.repairOrphanedPaperPdfMarkPaths(paper);
    const path = normalizePath(pdfPath || paper.pdfPath || "");
    return (this.ensureResearchWorkspace(paper).inkStrokes || []).filter((stroke) => (
      normalizePath(stroke.pdfPath || paper.pdfPath || "") === path
      && (page == null || Number(stroke.page) === Number(page))
    ));
  },

  async savePdfInkStroke(paper, source = {}) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !Array.isArray(source.points) || !source.points.length) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const stroke = {
      id: source.id || workspaceId("ink"),
      type: "ink",
      pdfSubtype: "Ink",
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
    else {
      workspace.inkStrokes.push(stroke);
      this.recordNativePdfUndoAction(paper, stroke.pdfPath, "create", [{ source: "ink", record: stroke }]);
    }
    this.schedulePdfOverlayPersist();
    void this.syncLocalPdfAnnotation(stroke).catch((error) => (
      console.error("Paper Library: failed to write ink annotation", error)
    ));
    this.refreshResearchPdfHighlights(paper);
    return true;
  },

  async removePdfInkStroke(paper, strokeId) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !strokeId) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const before = workspace.inkStrokes.length;
    const removed = workspace.inkStrokes.find((stroke) => stroke.id === strokeId);
    if (removed && !this.nativePdfUndoSuppressed) {
      this.recordNativePdfUndoAction(paper, removed.pdfPath || paper.pdfPath, "delete", [{ source: "ink", record: removed }]);
    }
    workspace.inkStrokes = workspace.inkStrokes.filter((stroke) => stroke.id !== strokeId);
    if (workspace.inkStrokes.length === before) return false;
    this.schedulePdfOverlayPersist();
    if (removed && this.settings.pdfAnnotationWriteback !== "off") {
      try {
        await this.removeLocalPdfAnnotations([removed]);
      } catch (error) {
        console.error("Paper Library: failed to remove ink annotation from PDF", error);
      }
    }
    this.refreshResearchPdfHighlights(paper);
    if (!this.nativePdfUndoSuppressed) new Notice("已删除画笔标注");
    return true;
  },

  getPdfShapes(paper, pdfPath = paper?.pdfPath, page = null) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return [];
    this.repairOrphanedPaperPdfMarkPaths(paper);
    const path = normalizePath(pdfPath || paper.pdfPath || "");
    return (this.ensureResearchWorkspace(paper).pdfShapes || []).filter((shape) => (
      normalizePath(shape.pdfPath || paper.pdfPath || "") === path
      && (page == null || Number(shape.page) === Number(page))
    ));
  },

  async savePdfShape(paper, source = {}) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !source.start || !source.end) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const clampPoint = (point) => ({
      x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
      y: Math.max(0, Math.min(1, Number(point?.y) || 0))
    });
    const shape = {
      id: source.id || workspaceId("shape"),
      type: ["line", "arrow", "circle", "ellipse", "rect"].includes(source.type) ? source.type : "line",
      pdfSubtype: "Ink",
      page: Math.max(1, Number(source.page) || 1),
      pdfPath: normalizePath(source.pdfPath || paper.pdfPath || ""),
      color: CANVAS_HIGHLIGHT_COLORS.some((item) => item.id === source.color) ? source.color : "yellow",
      width: Math.max(1.5, Math.min(8, Number(source.width) || 2.5)),
      start: clampPoint(source.start),
      end: clampPoint(source.end),
      createdAt: source.createdAt || new Date().toISOString()
    };
    const index = workspace.pdfShapes.findIndex((item) => item.id === shape.id);
    if (index >= 0) workspace.pdfShapes[index] = shape;
    else {
      workspace.pdfShapes.push(shape);
      this.recordNativePdfUndoAction(paper, shape.pdfPath, "create", [{ source: "shape", record: shape }]);
    }
    this.schedulePdfOverlayPersist();
    void this.syncLocalPdfAnnotation(shape).catch((error) => (
      console.error("Paper Library: failed to write shape annotation", error)
    ));
    this.refreshNativePdfShapeOverlays(paper);
    return true;
  },

  async removePdfShape(paper, shapeId) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !shapeId) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const before = workspace.pdfShapes.length;
    const removed = workspace.pdfShapes.find((shape) => shape.id === shapeId);
    if (removed && !this.nativePdfUndoSuppressed) {
      this.recordNativePdfUndoAction(paper, removed.pdfPath || paper.pdfPath, "delete", [{ source: "shape", record: removed }]);
    }
    workspace.pdfShapes = workspace.pdfShapes.filter((shape) => shape.id !== shapeId);
    if (workspace.pdfShapes.length === before) return false;
    this.schedulePdfOverlayPersist();
    if (removed && this.settings.pdfAnnotationWriteback !== "off") {
      try {
        await this.removeLocalPdfAnnotations([removed]);
      } catch (error) {
        console.error("Paper Library: failed to remove shape annotation from PDF", error);
      }
    }
    this.refreshNativePdfShapeOverlays(paper);
    if (!this.nativePdfUndoSuppressed) new Notice("已删除形状");
    return true;
  },

  pdfShapeHitTest(shape, point, rect) {
    if (!shape || !point || !rect?.width || !rect?.height) return false;
    const start = shape.start || {};
    const end = shape.end || {};
    const x1 = Math.max(0, Math.min(1, Number(start.x) || 0));
    const y1 = Math.max(0, Math.min(1, Number(start.y) || 0));
    const x2 = Math.max(0, Math.min(1, Number(end.x) || 0));
    const y2 = Math.max(0, Math.min(1, Number(end.y) || 0));
    const type = ["line", "arrow", "circle", "ellipse", "rect"].includes(shape.type) ? shape.type : "line";
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const tolerance = Math.max(8, (Number(shape.width) || 2.5) + 4);
    const px = point.x * rect.width;
    const py = point.y * rect.height;
    if (type === "line" || type === "arrow") {
      const distance = this.pdfInkPointSegmentDistance(
        { x: px, y: py },
        { x: x1 * rect.width, y: y1 * rect.height },
        { x: x2 * rect.width, y: y2 * rect.height }
      );
      return distance <= tolerance;
    }
    const leftPx = left * rect.width;
    const rightPx = right * rect.width;
    const topPx = top * rect.height;
    const bottomPx = bottom * rect.height;
    if (type === "rect") {
      // 只命中描边，避免一个大的空心矩形挡住内部的文字和标注
      if (px < leftPx - tolerance || px > rightPx + tolerance
        || py < topPx - tolerance || py > bottomPx + tolerance) return false;
      const edgeX = Math.min(Math.abs(px - leftPx), Math.abs(px - rightPx));
      const edgeY = Math.min(Math.abs(py - topPx), Math.abs(py - bottomPx));
      return Math.min(edgeX, edgeY) <= tolerance;
    }
    // 椭圆/圆：按像素空间到椭圆边界的近似距离判断
    const centerX = (leftPx + rightPx) / 2;
    const centerY = (topPx + bottomPx) / 2;
    const radiusX = Math.max(0.5, (rightPx - leftPx) / 2);
    const radiusY = Math.max(0.5, (bottomPx - topPx) / 2);
    const radial = Math.hypot((px - centerX) / radiusX, (py - centerY) / radiusY);
    const distance = Math.abs(radial - 1) * Math.min(radiusX, radiusY);
    return distance <= tolerance;
  },

  findPdfShapeAtEvent(event, pageEl, paper, pdfPath, pageNumber) {
    const rect = pageEl?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return null;
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };
    return this.getPdfShapes(paper, pdfPath, pageNumber)
      .slice()
      .reverse()
      .find((shape) => this.pdfShapeHitTest(shape, point, rect)) || null;
  },

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
  },

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
  },

  async backfillPdfInkAnnotations(paper, file) {
    const mode = this.settings.pdfAnnotationWriteback;
    if (mode === "off" || !paper?.id || !file?.path) return 0;
    const workspace = this.ensureResearchWorkspace(paper);
    const path = normalizePath(file.path);
    const embeddedIds = await this.getNativePdfEmbeddedMarkIds(file).catch(() => new Set());
    const marks = [
      ...(workspace.inkStrokes || []),
      ...(workspace.pdfShapes || [])
    ].filter((mark) => (
      normalizePath(mark.pdfPath || paper.pdfPath || "") === path
      && !embeddedIds.has(`paperlib:${mark.pdfAnnotationId || mark.id}`)
      && !this.pendingPdfAnnotationSyncs.has(`${path}|${mark.pdfAnnotationId || mark.id}`)
    ));
    if (!marks.length) return 0;
    for (const mark of marks) {
      this.pendingPdfAnnotationSyncs.set(`${path}|${mark.pdfAnnotationId || mark.id}`, mark);
    }
    if (mode === "immediate") {
      await this.flushPdfAnnotationSyncs();
    }
    return marks.length;
  },

  schedulePdfOverlayPersist() {
    // 画笔/形状可能每秒产生很多次保存，合并成一次 settings 写入，避免反复重写整个 data.json
    if (this.pdfOverlayPersistTimer) clearTimeout(this.pdfOverlayPersistTimer);
    this.pdfOverlayPersistTimer = setTimeout(() => {
      this.pdfOverlayPersistTimer = null;
      void this.saveSettings().catch((error) => console.error("Paper Library: failed to persist PDF overlays", error));
    }, 350);
  },

  async flushPdfOverlayPersists() {
    if (!this.pdfOverlayPersistTimer) return;
    clearTimeout(this.pdfOverlayPersistTimer);
    this.pdfOverlayPersistTimer = null;
    await this.saveSettings();
  },
};

export { inkshapesMethods };
