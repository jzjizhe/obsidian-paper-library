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
pluginModule._compile(
  `${fs.readFileSync(filename, "utf8")}\nmodule.exports.pdfLibForTest = PaperLibraryPlugin.pdfLibForTest;`,
  filename
);
const PaperLibraryPlugin = pluginModule.exports;

async function run() {
  const { PDFDocument, PDFName, PDFArray } = PaperLibraryPlugin.pdfLibForTest;
  const source = await PDFDocument.create();
  source.addPage([504, 720]);
  const sourceBytes = await source.save();
  let current = Buffer.from(sourceBytes);
  const paper = {
    id: "paper-ink",
    pdfPath: "Papers/ink.pdf",
    annotations: [],
    researchWorkspace: { highlights: [], inkStrokes: [], pdfShapes: [], nodes: [], links: [] }
  };
  const file = { path: paper.pdfPath, basename: "ink", name: "ink.pdf", extension: "pdf" };
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.settings = { papers: [paper], pdfAnnotationWriteback: "on-leave" };
  plugin.pdfMutationQueues = new Map();
  plugin.pendingPdfAnnotationSyncs = new Map();
  plugin.pdfAnnotationSyncFailures = new Set();
  plugin.nativePdfEmbeddedMarkIdsCache = new Map();
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => file,
      readBinary: async () => current.buffer.slice(current.byteOffset, current.byteOffset + current.length),
      modifyBinary: async (_file, output) => { current = Buffer.from(output); },
      adapter: { stat: async () => ({ mtime: 1, size: current.length }) }
    }
  };

  const mark = {
    id: "ink-writeback",
    type: "ink",
    pdfSubtype: "Ink",
    pdfPath: paper.pdfPath,
    page: 1,
    color: "blue",
    width: 4,
    points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.35 }, { x: 0.6, y: 0.25 }]
  };
  paper.researchWorkspace.inkStrokes.push(mark);

  await plugin.syncLocalPdfAnnotation(mark);
  assert.equal(plugin.pendingPdfAnnotationSyncs.size, 1, "on-leave mode must queue the ink annotation");
  await plugin.flushPdfAnnotationSyncs();
  assert.equal(plugin.pendingPdfAnnotationSyncs.size, 0, "flush must drain the queue");

  let saved = await PDFDocument.load(current, { updateMetadata: false });
  let annots = saved.getPages()[0].node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(annots.size(), 1, "flush must write one ink annotation");
  const dict = saved.context.lookup(annots.get(0));
  assert.equal(dict.get(PDFName.of("Subtype")).toString(), "/Ink");
  assert.equal(
    saved.context.lookupMaybe(dict.get(PDFName.of("NM")), PaperLibraryPlugin.pdfLibForTest.PDFString, PaperLibraryPlugin.pdfLibForTest.PDFHexString).decodeText(),
    `paperlib:${mark.id}`
  );

  // 写回后能识别为内嵌，覆盖层据此隐藏
  const embedded = await plugin.getNativePdfEmbeddedMarkIds(file);
  assert.ok(embedded.has(`paperlib:${mark.id}`), "written ink must be detected as embedded");
  assert.equal(plugin.isNativePdfMarkEmbedded(file, mark, embedded), true);

  // 已有的形状会在打开 PDF 时自动补写到待写队列，离开时批量写入
  const shape = {
    id: "shape-writeback",
    type: "rect",
    pdfSubtype: "Ink",
    pdfPath: paper.pdfPath,
    page: 1,
    color: "green",
    width: 2.5,
    start: { x: 0.1, y: 0.6 },
    end: { x: 0.3, y: 0.8 }
  };
  paper.researchWorkspace.pdfShapes.push(shape);
  assert.equal(await plugin.backfillPdfInkAnnotations(paper, file), 1);
  assert.equal(plugin.pendingPdfAnnotationSyncs.size, 1);
  await plugin.flushPdfAnnotationSyncs();
  saved = await PDFDocument.load(current, { updateMetadata: false });
  annots = saved.getPages()[0].node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(annots.size(), 2, "the backfilled shape must be written with the ink mark");

  await plugin.removeLocalPdfAnnotations([mark, shape]);
  saved = await PDFDocument.load(current, { updateMetadata: false });
  annots = saved.getPages()[0].node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(annots?.size?.() || 0, 0, "removing the marks must remove their PDF annotations");

  console.log("PDF ink writeback tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
