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
  `${fs.readFileSync(filename, "utf8")}\nmodule.exports.pdfLibForTest = { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString };`,
  filename
);
const PaperLibraryPlugin = pluginModule.exports;

async function run() {
  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } = PaperLibraryPlugin.pdfLibForTest;
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.settings = {};

  const document = await PDFDocument.create();
  document.addPage([504, 720]);
  const mark = {
    id: "paperlib-textbox-test",
    pdfAnnotationId: "paperlib-textbox-test",
    pdfPath: "Papers/test.pdf",
    page: 1,
    pdfSubtype: "FreeText",
    comment: "你哈哈哈",
    fontSize: 18,
    textColor: "pink",
    color: "yellow",
    box: { x: 0.25, y: 0.1, width: 0.07 }
  };
  assert.equal(plugin.writeLocalPdfAnnotation(document, mark), true);

  const annots = document.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(annots.size(), 1, "one FreeText annotation must be written");
  const dictionary = document.context.lookup(annots.get(0));
  const readString = (name) => {
    const value = document.context.lookupMaybe(dictionary.get(PDFName.of(name)), PDFString, PDFHexString);
    return value?.decodeText?.() || value?.asString?.() || "";
  };

  assert.equal(readString("NM"), "paperlib:paperlib-textbox-test");
  assert.equal(readString("Contents"), "你哈哈哈");
  assert.equal(readString("T"), "Paper Library");
  assert.match(readString("DA"), /^\/Helvetica 18 Tf /);
  const rect = document.context.lookupMaybe(dictionary.get(PDFName.of("Rect")), PDFArray).asArray()
    .map((value) => value.asNumber());
  assert.ok(rect[2] - rect[0] >= 80, "the rect must be wide enough for four CJK glyphs");
  assert.ok(rect[3] - rect[1] >= 30, "the rect must be tall enough for an 18pt line");

  // 再次写入同一标注：旧的同名注解必须被替换，而不是累积
  assert.equal(plugin.writeLocalPdfAnnotation(document, mark), true);
  const updated = document.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(updated.size(), 1, "rewriting the same mark must replace the old annotation");
  assert.match(document.context.lookup(updated.get(0)).toString(), /\/Subtype \/FreeText/);

  // 空文本框不写入 PDF，避免阅读器显示 “Paper Library annotation” 兜底文字
  const emptyDocument = await PDFDocument.create();
  emptyDocument.addPage([504, 720]);
  assert.equal(
    plugin.writeLocalPdfAnnotation(emptyDocument, { ...mark, comment: "" }),
    false,
    "an empty text box must not be written to the PDF"
  );
  assert.equal(
    emptyDocument.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray),
    undefined,
    "an empty text box must not create an annotation"
  );

  // 画笔/形状写成 Ink 注解：InkList 路径、NM、BS 宽度必须正确
  const inkDocument = await PDFDocument.create();
  inkDocument.addPage([504, 720]);
  const inkMark = {
    id: "ink-test",
    type: "ink",
    pdfSubtype: "Ink",
    pdfPath: "Papers/test.pdf",
    page: 1,
    color: "blue",
    width: 4,
    points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.35 }, { x: 0.6, y: 0.25 }]
  };
  assert.equal(plugin.writeLocalPdfAnnotation(inkDocument, inkMark), true);
  assert.equal(plugin.writeLocalPdfAnnotation(inkDocument, inkMark), true);
  const inkAnnots = inkDocument.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(inkAnnots.size(), 1, "rewriting an ink mark must replace the old annotation");
  const inkDict = inkDocument.context.lookup(inkAnnots.get(0));
  assert.equal(inkDict.get(PDFName.of("Subtype")).toString(), "/Ink");
  assert.equal(
    inkDocument.context.lookupMaybe(inkDict.get(PDFName.of("NM")), PDFString, PDFHexString).decodeText(),
    "paperlib:ink-test"
  );
  const inkList = inkDocument.context.lookupMaybe(inkDict.get(PDFName.of("InkList")), PDFArray);
  assert.equal(inkList.size(), 1);
  assert.equal(inkList.get(0).size(), 6, "three points must produce six coordinates");
  const inkBorder = inkDocument.context.lookupMaybe(inkDict.get(PDFName.of("BS")), PDFDict);
  assert.equal(inkBorder.get(PDFName.of("W")).asNumber(), 4);

  // 箭头形状写成三条 Ink 路径
  const arrowMark = {
    id: "arrow-test", type: "arrow", pdfSubtype: "Ink", pdfPath: "Papers/test.pdf",
    page: 1, color: "red", width: 3,
    start: { x: 0.1, y: 0.2 }, end: { x: 0.6, y: 0.4 }
  };
  assert.equal(plugin.writeLocalPdfAnnotation(inkDocument, arrowMark), true);
  const arrowAnnots = inkDocument.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.equal(arrowAnnots.size(), 2);
  const arrowDict = inkDocument.context.lookup(arrowAnnots.get(1));
  const arrowList = inkDocument.context.lookupMaybe(arrowDict.get(PDFName.of("InkList")), PDFArray);
  assert.equal(arrowList.size(), 3, "an arrow must have one shaft and two head strokes");

  // 内嵌判断：有写回记录且不在待写队列时才隐藏覆盖层
  plugin.settings.pdfAnnotationWriteback = "on-leave";
  plugin.pendingPdfAnnotationSyncs = new Map();
  const embedded = new Set(["paperlib:ink-test"]);
  const file = { path: "Papers/test.pdf" };
  assert.equal(plugin.isNativePdfMarkEmbedded(file, inkMark, embedded), true);
  plugin.pendingPdfAnnotationSyncs.set("Papers/test.pdf|ink-test", inkMark);
  assert.equal(plugin.isNativePdfMarkEmbedded(file, inkMark, embedded), false);

  console.log("PDF annotation writeback tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
