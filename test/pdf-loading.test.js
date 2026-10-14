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
  `${fs.readFileSync(filename, "utf8")}\nmodule.exports.ResearchView = PaperResearchWorkspaceView;\nmodule.exports.pdfLibForTest = { PDFDocument, PDFName, PDFArray, PDFDict };`,
  filename
);
const PaperLibraryPlugin = pluginModule.exports;
const { ResearchView } = PaperLibraryPlugin;
const file = { path: "Papers/with spaces & 中文.pdf", extension: "pdf" };
const bytes = new TextEncoder().encode("%PDF-1.7 test document").buffer;
const resourceUrl = "app://vault/with%20spaces%20%26%20%E4%B8%AD%E6%96%87.pdf?mtime=123";

// A minimal but structurally valid single-page PDF that pdf-lib can parse,
// used to exercise the annotation write path end to end.
function buildMinimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf).buffer;
}

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

    // Native-reader annotations mutate the PDF file; the write path must fall
    // back to the resource URL exactly like the rendering path.
    {
      const denied = new Error("EPERM: operation not permitted");
      const previousFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        assert.equal(url, resourceUrl);
        return { ok: true, arrayBuffer: async () => buildMinimalPdf() };
      };
      let written;
      const mutationPlugin = createPlugin(async () => { throw denied; });
      mutationPlugin.pdfMutationQueues = new Map();
      mutationPlugin.app.vault.modifyBinary = async (value, output) => {
        assert.equal(value, file);
        written = output;
      };
      mutationPlugin.settings.pdfAnnotations = [];
      try {
        const changed = await mutationPlugin.mutateLocalPdf(file.path, async () => true);
        assert.equal(changed, true);
        assert.equal(Buffer.from(written).subarray(0, 5).toString(), "%PDF-");
        assert.ok(Buffer.byteLength(written) > 100);
        const unchanged = await mutationPlugin.mutateLocalPdf(file.path, async () => false);
        assert.equal(unchanged, false, "a no-op mutation must not rewrite the file");
        const signed = Buffer.from("%PDF-1.4 fake /ByteRange [0 1 2 3]");
        mutationPlugin.app.vault.readBinary = async () => Uint8Array.from(signed).buffer;
        await assert.rejects(mutationPlugin.mutateLocalPdf(file.path, async () => true),
          /数字签名/, "signed PDFs must keep refusing file mutation");
        // The queue must drain so later mutations are not chained forever.
        assert.equal(mutationPlugin.pdfMutationQueues.size, 0);
      } finally {
        globalThis.fetch = previousFetch;
      }
    }

    {
      const { PDFDocument, PDFName, PDFArray, PDFDict } = PaperLibraryPlugin.pdfLibForTest;
      const nativePaper = { id: "native", pdfPath: file.path };
      let source = buildMinimalPdf();
      let reads = 0;
      let writes = 0;
      let destroyed = 0;
      let pageError = null;
      const nativePlugin = createPlugin(async () => {
        reads += 1;
        throw new Error("EPERM: operation not permitted");
      });
      nativePlugin.settings.papers = [nativePaper];
      nativePlugin.pdfMutationQueues = new Map();
      nativePlugin.persistResearchWorkspace = async () => {};
      nativePlugin.refreshResearchPdfHighlights = () => {};
      nativePlugin.app.vault.modifyBinary = async (_file, output) => { source = output; writes += 1; };
      globalThis.fetch = async (url) => {
        assert.equal(url, resourceUrl);
        return { ok: true, arrayBuffer: async () => source };
      };
      pdfJsMock = {
        getDocument: ({ data }) => {
          assert.deepEqual([...data], [...new Uint8Array(source)]);
          return { promise: Promise.resolve({
            destroy: async () => { destroyed += 1; },
            getPage: async () => {
              if (pageError) throw pageError;
              return {
                getTextContent: async () => ({ items: [{ str: "Selected text", width: 30, transform: [10, 0, 0, 10, 10, 160] }] }),
                getViewport: ({ scale }) => ({ width: 200 * scale, convertToPdfPoint: (x, y) => [x / scale, 200 - y / scale] }),
                getAnnotations: async () => [{ id: "annotation-1", titleObj: { str: "Paper Library" } }]
              };
            }
          }) };
        }
      };
      const span = { querySelector: () => null, textContent: "Selected text", closest: () => span };
      let selectionCleared = false;
      const selection = {
        rangeCount: 1, toString: () => "Selected text",
        anchorNode: span, focusNode: span, anchorOffset: 0, focusOffset: 13,
        getRangeAt: () => ({ getClientRects: () => [{ left: 15, right: 25, top: 20, bottom: 30, width: 10, height: 10 }] }),
        removeAllRanges: () => { selectionCleared = true; }
      };
      const textLayer = {
        ownerDocument: { defaultView: { getSelection: () => selection } },
        querySelectorAll: () => [span], contains: () => true,
        closest: () => ({ dataset: { pageNumber: "1" } }),
        getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 100 })
      };
      const state = { mode: "highlight", highlightColor: "yellow" };
      await nativePlugin.handleNativePdfPointerUp(
        { target: { closest: () => textLayer } }, { view: { file } }, { contains: () => true }, state
      );
      assert.equal(writes, 1, "selection geometry and annotation saving must both survive EPERM");
      assert.equal(reads, 2);
      assert.equal(state.busy, false);
      assert.equal(selectionCleared, true);
      assert.equal(destroyed, 1);
      const mark = nativePaper.researchWorkspace.highlights[0];
      assert.equal(mark.selectionSource, "native");
      assert.deepEqual(mark.pdfRects[0].rect, [10, 160, 30, 180]);
      const saved = await PDFDocument.load(source);
      const annotations = saved.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
      assert.equal(annotations.size(), 1);
      const annotation = saved.context.lookup(annotations.get(0), PDFDict);
      assert.equal(annotation.get(PDFName.of("Subtype")).toString(), "/Highlight");
      assert.equal(annotation.get(PDFName.of("NM")).decodeText(), `paperlib:${mark.id}`);
      assert.equal(loggedErrors.length, 2, "native highlight creation must not report a new error");

      assert.equal((await nativePlugin.getNativePdfAnnotationData(file, 1, { dataset: { annotationId: "annotation-1" } })).id, "annotation-1");
      assert.equal(await nativePlugin.getNativePdfAnnotationData(file, 1, { dataset: { annotationId: "missing" } }), null);
      assert.equal(destroyed, 3, "annotation lookup must release PDF.js documents");
      const readsBeforeEmptySelection = reads;
      assert.deepEqual(await nativePlugin.getNativePdfSelectionData(file, 1, textLayer, []), { pdfRects: [], textItems: [] });
      assert.equal(reads, readsBeforeEmptySelection);
      pageError = new Error("Page unavailable");
      await assert.rejects(nativePlugin.getNativePdfAnnotationData(file, 1, { dataset: { annotationId: "annotation-1" } }), /Page unavailable/);
      assert.equal(destroyed, 4, "lookup errors must still release the document");
      await assert.rejects(nativePlugin.getNativePdfSelectionData(file, 1, textLayer, [{ left: 1, right: 2, top: 1, bottom: 2 }]), /Page unavailable/);
      assert.equal(destroyed, 5, "selection errors must still release the document");
      nativePlugin.app.vault.readBinary = async () => { throw new Error("ENOENT: missing PDF"); };
      globalThis.fetch = async () => { throw new Error("unrelated read errors must avoid fetch"); };
      await assert.rejects(nativePlugin.getNativePdfAnnotationData(file, 1, { dataset: { annotationId: "annotation-1" } }), /ENOENT/);
    }
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
