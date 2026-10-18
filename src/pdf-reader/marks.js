import { CANVAS_HIGHLIGHT_COLORS } from "../constants.js";
import { Notice, normalizePath } from "obsidian";
import { workspaceId } from "../paper-utils.js";

const marksMethods = {
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
  },

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
    this.recordNativePdfUndoAction(paper, pdfPath, "create", [{ source: "canvas-highlight", record: highlight }]);
    await this.persistResearchWorkspace(paper, false);
    await this.syncLocalPdfAnnotation(highlight);
    this.refreshResearchPdfHighlights(paper);
    return true;
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  pdfRectsOverlap(first, second) {
    if (!Array.isArray(first) || first.length !== 4 || !Array.isArray(second) || second.length !== 4) return false;
    const overlapWidth = Math.min(first[2], second[2]) - Math.max(first[0], second[0]);
    const overlapHeight = Math.min(first[3], second[3]) - Math.max(first[1], second[1]);
    if (overlapWidth <= 0.1 || overlapHeight <= 0.1) return false;
    const minimumHeight = Math.min(Math.abs(first[3] - first[1]), Math.abs(second[3] - second[1]));
    return overlapHeight >= Math.max(0.35, minimumHeight * 0.18);
  },

  getPdfTextItemIndexesForRects(textItems, pdfRects) {
    const selectionRects = (pdfRects || []).map((item) => item?.rect).filter((rect) => rect?.length === 4);
    if (!Array.isArray(textItems) || !selectionRects.length) return [];
    const indexes = [];
    textItems.forEach((item, index) => {
      const itemRect = this.getPdfTextItemRect(item);
      if (itemRect && selectionRects.some((rect) => this.pdfRectsOverlap(itemRect, rect))) indexes.push(index);
    });
    return indexes;
  },

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
  },

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
  },

  async deletePdfMark(paper, entry) {
    paper = this.getCanonicalPaper(paper);
    if (!paper || !entry?.record) return false;
    if (entry.source === "canvas-highlight") return this.removeCanvasHighlight(paper, entry.record.id);
    const workspace = this.ensureResearchWorkspace(paper);
    const isDraftText = entry.record.pdfSubtype === "FreeText"
      && !String(entry.record.comment || "").trim();
    if (!this.nativePdfUndoSuppressed) {
      if (isDraftText) {
        this.dropNativePdfUndoCreate(entry.record.pdfPath || paper.pdfPath, entry.record.id);
      } else {
        this.recordNativePdfUndoAction(
          paper,
          entry.record.pdfPath || paper.pdfPath,
          "delete",
          [{ source: "paper-annotation", record: entry.record }]
        );
      }
    }
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
  },

  async removeCanvasHighlight(paper, highlightId) {
    return this.removeCanvasHighlights(paper, [highlightId]);
  },

  async removeCanvasHighlights(paper, highlightIds) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return false;
    const workspace = this.ensureResearchWorkspace(paper);
    const ids = new Set(highlightIds || []);
    const before = workspace.highlights.length;
    const removed = workspace.highlights.filter((highlight) => ids.has(highlight.id));
    if (!this.nativePdfUndoSuppressed && removed.length) {
      const groups = new Map();
      removed.forEach((highlight) => {
        const path = normalizePath(highlight.pdfPath || paper.pdfPath || "");
        if (!groups.has(path)) groups.set(path, []);
        groups.get(path).push({ source: "canvas-highlight", record: highlight });
      });
      groups.forEach((records, path) => {
        this.recordNativePdfUndoAction(paper, path, "delete", records);
      });
    }
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
  },
};

export { marksMethods };
