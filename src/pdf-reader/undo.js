import { normalizePath } from "obsidian";

const undoMethods = {
  getNativePdfUndoStack(pdfPath) {
    const path = normalizePath(pdfPath || "");
    this.nativePdfUndoStacks = this.nativePdfUndoStacks || new Map();
    if (!this.nativePdfUndoStacks.has(path)) this.nativePdfUndoStacks.set(path, { undo: [], redo: [] });
    return this.nativePdfUndoStacks.get(path);
  },

  cloneNativePdfUndoRecord(record) {
    try {
      return JSON.parse(JSON.stringify(record));
    } catch (error) {
      return { ...record };
    }
  },

  recordNativePdfUndoAction(paper, pdfPath, type, records) {
    if (this.nativePdfUndoSuppressed) return;
    paper = this.getCanonicalPaper(paper);
    const path = normalizePath(pdfPath || paper?.pdfPath || "");
    if (!paper || !path || !Array.isArray(records) || !records.length) return;
    const stack = this.getNativePdfUndoStack(path);
    stack.undo.push({
      type,
      paperId: paper.id,
      pdfPath: path,
      records: records.map(({ source, record }) => ({
        source,
        record: this.cloneNativePdfUndoRecord(record)
      }))
    });
    if (stack.undo.length > 50) stack.undo.shift();
    stack.redo.length = 0;
  },

  dropNativePdfUndoCreate(pdfPath, id) {
    const stack = this.getNativePdfUndoStack(pdfPath);
    stack.undo = stack.undo.filter((action) => !(
      action.type === "create"
      && action.records?.length === 1
      && action.records[0].record?.id === id
    ));
  },

  findNativePdfUndoRecord(paper, source, record) {
    const workspace = this.ensureResearchWorkspace(paper);
    const id = record?.id;
    if (!id) return null;
    if (source === "canvas-highlight") return (workspace.highlights || []).find((item) => item.id === id) || null;
    if (source === "paper-annotation") return (paper.annotations || []).find((item) => item.id === id) || null;
    if (source === "ink") return (workspace.inkStrokes || []).find((item) => item.id === id) || null;
    if (source === "shape") return (workspace.pdfShapes || []).find((item) => item.id === id) || null;
    return null;
  },

  async removeNativePdfUndoRecords(paper, records) {
    const removed = [];
    const bySource = { "canvas-highlight": [], "paper-annotation": [], ink: [], shape: [] };
    for (const item of records || []) {
      const current = this.findNativePdfUndoRecord(paper, item.source, item.record);
      if (!current || !bySource[item.source]) continue;
      bySource[item.source].push(current);
      removed.push({ source: item.source, record: this.cloneNativePdfUndoRecord(current) });
    }
    if (bySource["canvas-highlight"].length) {
      await this.removeCanvasHighlights(paper, bySource["canvas-highlight"].map((mark) => mark.id));
    }
    for (const mark of bySource["paper-annotation"]) {
      if (mark.pdfSubtype === "FreeText") await this.deletePdfTextBox(paper, mark);
      else await this.deletePdfMark(paper, { record: mark, source: "paper-annotation" });
    }
    for (const stroke of bySource.ink) await this.removePdfInkStroke(paper, stroke.id);
    for (const shape of bySource.shape) await this.removePdfShape(paper, shape.id);
    return removed;
  },

  async restoreNativePdfUndoRecords(paper, records) {
    paper = this.getCanonicalPaper(paper);
    if (!paper) return [];
    const workspace = this.ensureResearchWorkspace(paper);
    const restored = [];
    const exists = (list, id) => (list || []).some((item) => item.id === id);
    for (const item of records || []) {
      const record = this.cloneNativePdfUndoRecord(item.record);
      if (!record?.id) continue;
      if (item.source === "canvas-highlight") {
        if (exists(workspace.highlights, record.id)) continue;
        workspace.highlights.push(record);
      } else if (item.source === "paper-annotation") {
        if (exists(paper.annotations, record.id)) continue;
        paper.annotations.push(record);
      } else if (item.source === "ink") {
        if (exists(workspace.inkStrokes, record.id)) continue;
        workspace.inkStrokes.push(record);
      } else if (item.source === "shape") {
        if (exists(workspace.pdfShapes, record.id)) continue;
        workspace.pdfShapes.push(record);
      } else {
        continue;
      }
      restored.push({ source: item.source, record });
    }
    if (!restored.length) return [];
    await this.saveSettings();
    for (const { source, record } of restored) {
      if (source === "paper-annotation" && record.pdfSubtype === "FreeText") {
        try {
          await this.upsertPdfTextBoxNoteEntry(paper, record);
        } catch (error) {
          console.warn("Paper Library: failed to restore text box note entry", error);
        }
      }
      if (source === "canvas-highlight" || source === "paper-annotation" || source === "ink" || source === "shape") {
        try {
          await this.syncLocalPdfAnnotation(record);
        } catch (error) {
          console.warn("Paper Library: failed to restore PDF annotation", error);
        }
      }
    }
    this.refreshResearchPdfHighlights(paper);
    this.refreshNativePdfShapeOverlays(paper);
    await this.refreshNativePdfTextBoxes(paper);
    return restored;
  },

  async applyNativePdfUndoAction(action, invert) {
    const paper = this.getCanonicalPaper({ id: action.paperId });
    if (!paper) return [];
    const effectiveType = invert
      ? (action.type === "create" ? "delete" : "create")
      : action.type;
    if (effectiveType === "create") {
      return this.restoreNativePdfUndoRecords(paper, action.records);
    }
    return this.removeNativePdfUndoRecords(paper, action.records);
  },

  async undoNativePdfAction(pdfPath) {
    const stack = this.getNativePdfUndoStack(pdfPath);
    if (!stack.undo.length) return false;
    const action = stack.undo.pop();
    this.nativePdfUndoSuppressed = true;
    let inverse = null;
    try {
      const records = await this.applyNativePdfUndoAction(action, true);
      if (records?.length) {
        inverse = {
          type: action.type,
          paperId: action.paperId,
          pdfPath: action.pdfPath,
          records
        };
      }
    } finally {
      this.nativePdfUndoSuppressed = false;
    }
    try {
      await this.flushPdfOverlayPersists();
    } catch (error) {
      console.warn("Paper Library: failed to persist undo result", error);
    }
    if (inverse) {
      stack.redo.push(inverse);
      if (stack.redo.length > 50) stack.redo.shift();
    }
    return true;
  },

  async redoNativePdfAction(pdfPath) {
    const stack = this.getNativePdfUndoStack(pdfPath);
    if (!stack.redo.length) return false;
    const action = stack.redo.pop();
    this.nativePdfUndoSuppressed = true;
    let inverse = null;
    try {
      const records = await this.applyNativePdfUndoAction(action, false);
      if (records?.length) {
        inverse = {
          type: action.type,
          paperId: action.paperId,
          pdfPath: action.pdfPath,
          records
        };
      }
    } finally {
      this.nativePdfUndoSuppressed = false;
    }
    try {
      await this.flushPdfOverlayPersists();
    } catch (error) {
      console.warn("Paper Library: failed to persist redo result", error);
    }
    if (inverse) {
      stack.undo.push(inverse);
      if (stack.undo.length > 50) stack.undo.shift();
    }
    return true;
  },

  isNativePdfUndoBlocked(target) {
    const element = target?.nodeType === 1
      ? target
      : (typeof document !== "undefined" ? document.activeElement : null);
    if (!element) return false;
    const tag = String(element.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (element.isContentEditable) return true;
    return Boolean(element.closest?.(".modal, .cm-editor, .paperlib-pdf-textbox-card.is-editing"));
  },
};

export { undoMethods };
