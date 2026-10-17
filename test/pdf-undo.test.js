const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  loadPdfJs: async () => ({}),
  normalizePath: (value) => String(value).replace(/\\/g, "/"),
  requestUrl: async () => ({}),
  setIcon: () => {}
};
const filename = path.resolve(__dirname, "../main.js");
const pluginModule = new Module(filename, module);
pluginModule.filename = filename;
pluginModule.paths = Module._nodeModulePaths(path.dirname(filename));
pluginModule.require = (name) => name === "obsidian" ? obsidianMock : module.require(name);
pluginModule._compile(fs.readFileSync(filename, "utf8"), filename);
const PaperLibraryPlugin = pluginModule.exports;

function createPlugin() {
  const paper = {
    id: "paper-1",
    pdfPath: "Papers/test.pdf",
    annotations: [],
    researchWorkspace: { highlights: [], inkStrokes: [], pdfShapes: [], nodes: [], links: [] }
  };
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.settings = { papers: [paper], pdfAnnotationWriteback: "off" };
  plugin.app = { vault: { read: async () => "", modify: async () => {} } };
  plugin.saveSettings = async () => {};
  plugin.persistResearchWorkspace = async () => {};
  plugin.syncLocalPdfAnnotation = async () => true;
  plugin.removeLocalPdfAnnotations = async () => {};
  plugin.refreshResearchPdfHighlights = () => {};
  plugin.refreshNativePdfShapeOverlays = () => {};
  plugin.refreshNativePdfTextBoxes = async () => {};
  plugin.refreshNativePdfNoteOverlays = () => {};
  plugin.refreshViews = () => {};
  plugin.upsertPdfTextBoxNoteEntry = async () => {};
  plugin.removePdfTextBoxNoteEntry = async () => {};
  plugin.ensurePaperNote = async () => null;
  plugin.removeResearchNode = async (targetPaper, nodeId) => {
    const workspace = plugin.ensureResearchWorkspace(targetPaper);
    const node = workspace.nodes.find((item) => item.id === nodeId);
    workspace.nodes = workspace.nodes.filter((item) => item.id !== nodeId);
    if (node?.annotationId) {
      targetPaper.annotations = targetPaper.annotations.filter((item) => item.id !== node.annotationId);
    }
  };
  return { plugin, paper, workspace: plugin.ensureResearchWorkspace(paper) };
}

async function run() {
  const { plugin, paper, workspace } = createPlugin();
  const pdfPath = paper.pdfPath;

  // 新建高亮：撤销移除，重做恢复，再次撤销仍移除
  const highlight = {
    id: "highlight-1", pdfPath, page: 1, text: "hello", color: "yellow",
    pdfSubtype: "Highlight", pdfRects: [{ rect: [10, 20, 30, 40] }], createdAt: "1"
  };
  workspace.highlights.push(highlight);
  plugin.recordNativePdfUndoAction(paper, pdfPath, "create", [{ source: "canvas-highlight", record: highlight }]);
  assert.equal(await plugin.undoNativePdfAction(pdfPath), true);
  assert.equal(workspace.highlights.length, 0, "undo create must remove the highlight");
  assert.equal(await plugin.redoNativePdfAction(pdfPath), true);
  assert.equal(workspace.highlights.length, 1, "redo create must restore the highlight");
  assert.equal(workspace.highlights[0].id, "highlight-1");
  assert.equal(await plugin.undoNativePdfAction(pdfPath), true);
  assert.equal(workspace.highlights.length, 0);

  // 删除形状：撤销恢复，重做再次删除
  const shape = {
    id: "shape-1", type: "rect", pdfPath, page: 1,
    start: { x: 0.2, y: 0.2 }, end: { x: 0.6, y: 0.5 },
    color: "green", width: 2.5, createdAt: "2"
  };
  plugin.recordNativePdfUndoAction(paper, pdfPath, "delete", [{ source: "shape", record: shape }]);
  assert.equal(await plugin.undoNativePdfAction(pdfPath), true);
  assert.equal(workspace.pdfShapes.length, 1, "undo delete must restore the shape");
  assert.equal(workspace.pdfShapes[0].id, "shape-1");
  assert.equal(await plugin.redoNativePdfAction(pdfPath), true);
  assert.equal(workspace.pdfShapes.length, 0, "redo delete must remove the shape again");

  // 批量删除：一次撤销恢复全部
  const batchHighlight = { ...highlight, id: "highlight-2" };
  const batchStroke = {
    id: "ink-1", type: "ink", pdfPath, page: 1, color: "blue", width: 3,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], createdAt: "3"
  };
  workspace.highlights.push(batchHighlight);
  plugin.recordNativePdfUndoAction(paper, pdfPath, "delete", [
    { source: "canvas-highlight", record: batchHighlight },
    { source: "ink", record: batchStroke }
  ]);
  workspace.highlights = workspace.highlights.filter((mark) => mark.id !== batchHighlight.id);
  assert.equal(await plugin.undoNativePdfAction(pdfPath), true);
  assert.equal(workspace.highlights.length, 1, "batch undo must restore the highlight");
  assert.equal(workspace.inkStrokes.length, 1, "batch undo must restore the ink stroke");
  assert.equal(await plugin.redoNativePdfAction(pdfPath), true);
  assert.equal(workspace.highlights.length, 0, "batch redo must remove the highlight");
  assert.equal(workspace.inkStrokes.length, 0, "batch redo must remove the ink stroke");

  // 空文本框的删除不产生撤销动作
  const draft = {
    id: "textbox-draft", pdfPath, page: 1, pdfSubtype: "FreeText",
    comment: "", box: { x: 0.4, y: 0.4, width: 0.2 }, pdfRects: [], createdAt: "4"
  };
  paper.annotations.push(draft);
  plugin.recordNativePdfUndoAction(paper, pdfPath, "create", [{ source: "paper-annotation", record: draft }]);

  await plugin.deletePdfMark(paper, { record: draft, source: "paper-annotation" });
  const stack = plugin.getNativePdfUndoStack(pdfPath);
  assert.equal(stack.undo.some((action) => action.records.some((item) => item.record.id === draft.id)), false);
  assert.equal(paper.annotations.some((mark) => mark.id === draft.id), false);

  // 画笔/形状写入防抖：保存函数先改内存，settings 延后一次写入
  let saves = 0;
  plugin.saveSettings = async () => { saves += 1; };
  assert.equal(await plugin.savePdfInkStroke(paper, {
    page: 1,
    pdfPath,
    color: "blue",
    width: 3,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]
  }), true);
  assert.equal(saves, 0, "a new ink stroke must not rewrite settings immediately");
  assert.equal(workspace.inkStrokes.length, 1);
  await plugin.flushPdfOverlayPersists();
  assert.ok(saves >= 1, "flushing must persist the pending overlay data");

  console.log("PDF undo/redo tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
