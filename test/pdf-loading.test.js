const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

let pdfJsMock;
const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  loadPdfJs: async () => pdfJsMock,
  normalizePath: (value) => String(value).replace(/\\/g, "/"),
  requestUrl: async () => ({}), setIcon: () => {}
};
const filename = path.resolve(__dirname, "../main.js");
const pluginModule = new Module(filename, module);
pluginModule.filename = filename;
pluginModule.paths = Module._nodeModulePaths(path.dirname(filename));
pluginModule.require = (name) => name === "obsidian" ? obsidianMock : module.require(name);
pluginModule._compile(
  `${fs.readFileSync(filename, "utf8")}\nmodule.exports.ResearchView = PaperResearchWorkspaceView;`,
  filename
);
const PaperLibraryPlugin = pluginModule.exports;
const { ResearchView } = PaperLibraryPlugin;
const file = { path: "Papers/with spaces & 中文.pdf", extension: "pdf" };
const bytes = new TextEncoder().encode("%PDF-1.7 test document").buffer;
const resourceUrl = "app://vault/with%20spaces%20%26%20%E4%B8%AD%E6%96%87.pdf?mtime=123";

function createPlugin(readBinary) {
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.app = {
    vault: {
      readBinary,
      getResourcePath: (value) => { assert.equal(value, file); return resourceUrl; },
      getAbstractFileByPath: (value) => value === file.path ? file : null
    }
  };
  plugin.settings = { enableFigureRecognition: false };
  plugin.isMobileApp = () => false;
  plugin.getPortablePdfFigurePayload = () => null;
  plugin.getPdfInkStrokes = () => [];
  return plugin;
}

class Element {
  constructor(tag, options = {}) {
    this.tag = tag;
    this.cls = options.cls || "";
    this.text = options.text || "";
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this.isConnected = true;
  }
  createEl(tag, options) { return this.appendChild(new Element(tag, options)); }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  appendChild(child) {
    child.remove();
    child.parent = this;
    this.children.push(child);
    child.isConnected = this.isConnected;
    return child;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
    this.isConnected = false;
  }
  empty() { this.children.forEach((child) => child.remove()); this.children = []; }
  setText(text) { this.text = text; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  getContext() {
    return { measureText: () => ({ width: 100 }), fillRect: () => {} };
  }
  toBlob(callback) { callback(new Blob(["PNG"], { type: "image/png" })); }
  find(cls) {
    return this.children.flatMap((child) => [
      ...(child.cls === cls ? [child] : []), ...child.find(cls)
    ]);
  }
}

async function run() {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);
  try {
    let fetchCalls = 0;
    globalThis.fetch = async (url) => {
      fetchCalls += 1;
      assert.equal(url, resourceUrl);
      return { ok: true, arrayBuffer: async () => bytes };
    };
    const direct = createPlugin(async (value) => { assert.equal(value, file); return bytes; });
    assert.equal(await direct.readPdfBinary(file), bytes);
    assert.equal(fetchCalls, 0, "successful direct reads must avoid fetch");

    for (const error of [
      Object.assign(new Error("denied"), { code: "EPERM" }),
      Object.assign(new Error("denied"), { code: "EACCES" }),
      new Error("EPERM: operation not permitted, open 'file.pdf'"),
      new Error("EACCES: permission denied, open 'file.pdf'")
    ]) {
      const plugin = createPlugin(async () => { throw error; });
      assert.equal(await plugin.readPdfBinary(file), bytes);
    }
    assert.equal(fetchCalls, 4);

    for (const error of [
      Object.assign(new Error("missing"), { code: "ENOENT" }),
      Object.assign(new Error("I/O error"), { code: "EIO" }),
      new Error("invalid PDF")
    ]) {
      await assert.rejects(createPlugin(async () => { throw error; }).readPdfBinary(file),
        (value) => value === error);
    }
    assert.equal(fetchCalls, 4, "unrelated errors must propagate without fetch");

    const denied = new Error("EPERM: operation not permitted");
    const protectedPlugin = createPlugin(async () => { throw denied; });
    delete protectedPlugin.app.vault.getResourcePath;
    await assert.rejects(protectedPlugin.readPdfBinary(file), (error) => error === denied);
    protectedPlugin.app.vault.getResourcePath = () => resourceUrl;
    globalThis.fetch = undefined;
    await assert.rejects(protectedPlugin.readPdfBinary(file), (error) => error === denied);

    for (const [fetch, expected] of [
      [async () => ({ ok: false, status: 403 }), /HTTP 403/],
      [async () => { throw new Error("network failure"); }, /network failure/],
      [async () => ({ ok: true, arrayBuffer: async () => { throw new Error("body failure"); } }), /body failure/]
    ]) {
      globalThis.fetch = fetch;
      await assert.rejects(protectedPlugin.readPdfBinary(file), (error) => {
        assert.equal(error.cause, denied);
        assert.match(error.message, /EPERM/);
        assert.match(error.message, expected);
        return true;
      });
    }
    protectedPlugin.app.vault.getResourcePath = () => "";
    await assert.rejects(protectedPlugin.readPdfBinary(file), /PDF 资源地址为空/);
    protectedPlugin.app.vault.getResourcePath = () => resourceUrl;

    const documents = [];
    const renderedPages = [];
    pdfJsMock = {
      Util: { transform: (_viewport, transform) => transform },
      getDocument: ({ data }) => {
        assert.deepEqual([...data], [...new Uint8Array(bytes)]);
        assert.notEqual(data.buffer, bytes, "PDF.js must receive a copy of the source buffer");
        const document = {
          numPages: 2,
          destroyed: false,
          destroy: async () => { document.destroyed = true; },
          getPage: async (pageNumber) => ({
            getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale, transform: [1, 0, 0, 1, 0, 0] }),
            render: () => { renderedPages.push(pageNumber); return { promise: Promise.resolve() }; },
            getTextContent: async () => ({ items: [{ str: `Page ${pageNumber}`, width: 100, transform: [12, 0, 0, 12, 10, 20] }] })
          })
        };
        documents.push(document);
        return { promise: Promise.resolve(document) };
      }
    };
    globalThis.document = { createElement: (tag) => new Element(tag) };
    globalThis.window = { document: globalThis.document, devicePixelRatio: 2 };
    let readCalls = 0;
    globalThis.fetch = async (url) => {
      assert.equal(url, resourceUrl);
      fetchCalls += 1;
      return { ok: true, arrayBuffer: async () => bytes };
    };
    protectedPlugin.app.vault.readBinary = async () => { readCalls += 1; throw denied; };
    const paper = { id: "protected", pdfPath: file.path };
    const workspace = { highlights: [], inkStrokes: [] };

    for (const mobile of [false, true]) {
      protectedPlugin.isMobileApp = () => mobile;
      const view = new ResearchView({}, protectedPlugin);
      view.app = protectedPlugin.app;
      view.createPdfInkLayer = (parent) => parent.createDiv({ cls: "ink" });
      view.applyPdfMarkings = () => {};
      const host = new Element("div");
      await view.renderPdfDocument(host, paper, workspace);
      assert.equal(host.find("paperlib-selectable-pdf-page").length, 2);
      assert.equal(host.find("paperlib-pdf-text-item")[1].text, "Page 2");
      assert.equal(host.find("paperlib-canvas-pdf-pages").length, 1);
      assert.equal(host.find("paperlib-pdf-loading").length, 0);
      const textLayer = host.find("paperlib-pdf-text-layer")[0];
      let selected = false;
      view.scheduleExcerptDrag = () => { selected = true; };
      textLayer.listeners.get("pointerdown")({ button: 0 });
      assert.equal(selected, true, "the rendered text layer must retain selection handlers");
      const readsBefore = readCalls;
      await view.renderPdfDocument(new Element("div"), paper, workspace);
      assert.equal(readCalls, readsBefore, "reopening the same PDF must reuse its cache");
      const cached = view.pdfCache.document;
      view.pdfCache.path = "Papers/old.pdf";
      await view.renderPdfDocument(new Element("div"), paper, workspace);
      assert.equal(cached.destroyed, true, "switching PDFs must release the previous document");
    }

    const figureDocument = await protectedPlugin.loadPdfFigureDocument(file.path);
    assert.equal(figureDocument.numPages, 2);
    const exported = await protectedPlugin.exportPdfFigureHighResolution(file.path, {
      pageNumber: 1, pageWidth: 600, pageHeight: 800, x: 0, y: 0, width: 100, height: 100
    });
    assert.equal(exported.blob.type, "image/png");
    assert.ok(exported.width > 0 && exported.height > 0);
    assert.equal(documents.at(-1).destroyed, true, "figure export must release its document");
    assert.ok(renderedPages.length >= 9);

    const failingView = new ResearchView({}, protectedPlugin);
    failingView.app = protectedPlugin.app;
    const failedHost = new Element("div");
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    await failingView.renderPdfDocument(failedHost, paper, workspace);
    assert.match(failedHost.find("paperlib-pdf-loading")[0].children.at(-1).text, /EPERM.*HTTP 403/);
    assert.equal(failedHost.find("paperlib-canvas-pdf-pages").length, 0);
    const missingHost = new Element("div");
    await failingView.renderPdfDocument(missingHost, { pdfPath: "Papers/missing.pdf" }, workspace);
    assert.match(missingHost.find("paperlib-pdf-loading")[0].children.at(-1).text, /找不到 PDF 文件/);
    assert.equal(loggedErrors.length, 2);

    let opened;
    protectedPlugin.app.workspace = {
      getLeavesOfType: () => [],
      getLeaf: () => ({ openFile: async (value) => { opened = value; } }),
      revealLeaf: () => {}
    };
    await protectedPlugin.openResearchSource(paper);
    assert.equal(opened, file, "the native reader entry must still open the same vault file");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    console.error = originalConsoleError;
  }
}

run().then(() => console.log("PDF loading fallback tests passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
