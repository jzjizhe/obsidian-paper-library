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

  console.log("PDF annotation writeback tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
