const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

let pdfJsMock;
const notices = [];
const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class { constructor(message) { notices.push(message); } },
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
  plugin.settings = { enableFigureRecognition: false, papers: [] };
  plugin.isMobileApp = () => false;
  plugin.getPortablePdfFigurePayload = () => null;
  plugin.getPdfInkStrokes = () => [];
  return plugin;
}

function eventTarget(target = {}) {
  const handlers = new Map();
  const capture = (options) => typeof options === "boolean" ? options : Boolean(options?.capture);
  target.listeners = new Map();
  target.listenerEntries = handlers;
  target.addEventListener = (type, handler, options) => {
    if (!handlers.has(type)) {
      handlers.set(type, new Set());
      target.listeners.set(type, (event = {}) => {
        let result;
        for (const entry of [...handlers.get(type) || []]) {
          if (!handlers.get(type)?.has(entry)) continue;
          if (entry.once) target.removeEventListener(type, entry.handler, entry.capture);
          result = entry.handler(event);
        }
        return result;
      });
    }
    if (![...handlers.get(type)].some((entry) => entry.handler === handler && entry.capture === capture(options))) {
      handlers.get(type).add({ handler, capture: capture(options), once: Boolean(options?.once) });
    }
  };
  target.removeEventListener = (type, handler, options) => {
    const entries = handlers.get(type);
    if (!entries) return;
    for (const entry of entries) {
      if (entry.handler === handler && entry.capture === capture(options)) entries.delete(entry);
    }
    if (!entries.size) { handlers.delete(type); target.listeners.delete(type); }
  };
  return target;
}

class Element {
  constructor(tag, options = {}, ownerDocument = globalThis.document) {
    this.tag = tag;
    this.nodeType = tag === "#document-fragment" ? 11 : 1;
    this.ownerDocument = ownerDocument;
    this.className = options.cls || "";
    this.text = options.text || "";
    this.children = [];
    this.parentNode = null;
    this.style = { setProperty(name, value) { this[name] = String(value); } };
    this.dataset = {};
    this.attributes = new Map();
    eventTarget(this);
    for (const [name, value] of Object.entries(options.attr || {})) this.setAttribute(name, value);
    this.scrollLeft = this.scrollTop = this.clientLeft = this.clientTop = 0;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force = !this.classList.contains(name)) => {
        if (force) this.classList.add(name);
        else this.classList.remove(name);
        return force;
      }
    };
  }
  get cls() { return this.className; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { return this === this.ownerDocument?.body || Boolean(this.parentNode?.isConnected); }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(text) { this.empty(); this.text = String(text); }
  createEl(tag, options) { return this.appendChild(new Element(tag, options, this.ownerDocument)); }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  appendChild(child) {
    if (child.nodeType === 11) {
      for (const node of [...child.children]) this.appendChild(node);
      return child;
    }
    child.remove();
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    let next = this.nextElementSibling;
    while (next && nodes.includes(next)) next = next.nextElementSibling;
    this.remove();
    for (const node of nodes) {
      const added = node.nodeType === 11 ? [...node.children] : [node];
      for (const child of added) {
        parent.appendChild(child);
        if (next) {
          parent.children.pop();
          parent.children.splice(parent.children.indexOf(next), 0, child);
        }
      }
    }
  }
  get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  replaceChildren(...nodes) { this.empty(); nodes.forEach((node) => this.appendChild(node)); }
  empty() { [...this.children].forEach((child) => child.remove()); this.text = ""; }
  setText(text) { this.textContent = text; }
  addClass(name) { this.classList.add(name); }
  toggleClass(name, force) { this.classList.toggle(name, force); }
  setAttribute(name, value) {
    if (name === "class") this.className = String(value);
    this.attributes.set(name, String(value));
  }
  getAttribute(name) { return name === "class" ? this.className : this.attributes.get(name) ?? null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    const match = /^([\w-]+)?((?:\.[\w-]+)*)(?:\[data-([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);
    if (!match) throw new Error(`Unsupported test selector: ${selector}`);
    const [, tag, classes, attribute, value] = match;
    const key = attribute?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return (!tag || this.tag === tag) && classes.split(".").filter(Boolean).every((name) => this.classList.contains(name))
      && (!attribute || (key in this.dataset && (value === undefined || this.dataset[key] === value)));
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getContext() {
    return { measureText: () => ({ width: 100 }), fillRect: () => {} };
  }
  toBlob(callback) { callback(new Blob(["PNG"], { type: "image/png" })); }
  find(cls) { return this.querySelectorAll(`.${cls}`); }
}

function createDocument() {
  const document = eventTarget({
    createElement: (tag) => new Element(tag, {}, document),
    createDocumentFragment: () => new Element("#document-fragment", {}, document)
  });
  document.body = document.createElement("body");
  return document;
}

function testWorkspaceHighlightGesture() {
  const document = createDocument();
  const listeners = new Map();
  let selection;
  let caretCalls = 0;
  let repaired;
  const window = {
    addEventListener: (type, handler, options) => {
      if (type === "blur") assert.notEqual(options, true, "element blur must not cancel highlighting");
      listeners.set(type, handler);
    },
    removeEventListener: (type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    getSelection: () => selection,
    getComputedStyle: () => ({ direction: "ltr" })
  };
  document.defaultView = window;
  const layer = document.body.createDiv();
  const first = layer.createSpan({ cls: "paperlib-pdf-text-item", text: "Alpha beta" });
  first.dataset.textIndex = "2";
  first.getBoundingClientRect = () => ({ left: 10, right: 100, top: 10, bottom: 30, width: 90, height: 20 });
  const second = layer.createSpan({ cls: "paperlib-pdf-text-item", text: "A longer second line" });
  second.dataset.textIndex = "4";
  second.getBoundingClientRect = () => ({ left: 10, right: 220, top: 40, bottom: 60, width: 210, height: 20 });
  const node = { nodeType: 3, parentElement: first, data: first.textContent };
  selection = {
    rangeCount: 1, isCollapsed: false, anchorNode: node, anchorOffset: 0,
    focusNode: document.body,
    setBaseAndExtent: (...args) => { repaired = args; }
  };
  document.caretPositionFromPoint = (x, y) => {
    caretCalls += 1;
    assert.ok(y >= 10 && y <= 30, "edge repair must stay on the original visual line");
    return { offsetNode: node, offset: x > 50 ? node.data.length : 0 };
  };
  const view = new ResearchView({}, createPlugin(async () => bytes));
  view.repairWorkspacePdfSelectionEnd(layer, { clientX: 300, clientY: 20 });
  assert.deepEqual(repaired, [node, 0, node, node.data.length]);
  selection.anchorOffset = node.data.length;
  view.repairWorkspacePdfSelectionEnd(layer, { clientX: -30, clientY: 20 });
  assert.deepEqual(repaired, [node, node.data.length, node, 0]);
  selection.focusNode = node;
  view.repairWorkspacePdfSelectionEnd(layer, { clientX: 300, clientY: 20 });
  assert.equal(caretCalls, 2, "valid native text endpoints must stay unchanged");

  let saves = 0;
  view.handlePdfHighlight = () => { saves += 1; };
  view.beginWorkspacePdfHighlight({ button: 0, pointerId: 7 }, layer, {}, 1);
  assert.deepEqual([...listeners.keys()].sort(), ["blur", "pointercancel", "pointerup"]);
  listeners.get("pointerup")({ pointerId: 8 });
  assert.equal(saves, 0, "unrelated pointers must not complete a highlight");
  listeners.get("pointerup")({ pointerId: 7, target: document.body });
  assert.equal(saves, 1, "release outside the layer must complete the gesture");
  assert.equal(listeners.size, 0);
  assert.equal(view.pdfHighlightGestureCleanup, null);
  for (const type of ["pointercancel", "blur"]) {
    view.beginWorkspacePdfHighlight({ button: 0 }, layer, {}, 1);
    listeners.get(type)();
    assert.equal(listeners.size, 0);
    assert.equal(saves, 1, "cancelled gestures must not save highlights");
  }
  view.beginWorkspacePdfHighlight({ button: 0 }, layer, {}, 1);
  view.disposeWorkspacePdfView();
  assert.equal(listeners.size, 0, "closing the PDF must remove gesture listeners");
}

function selectionPopupFixture() {
  const document = createDocument();
  const timers = new Map();
  const window = eventTarget({
    document, innerWidth: 800, innerHeight: 600,
    setTimeout: (callback) => { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id)
  });
  document.defaultView = window;
  const createDiv = document.body.createDiv.bind(document.body);
  document.body.createDiv = (options) => {
    const element = createDiv(options);
    if (element.classList.contains("paperlib-pdf-selection-toolbar")) {
      element.getBoundingClientRect = () => ({ width: 188, height: 36 });
    }
    return element;
  };
  const paper = { id: "selection-popup", pdfPath: file.path };
  const workspace = { zoom: 1, highlights: [] };
  const plugin = createPlugin(async () => bytes);
  plugin.ensureResearchWorkspace = (value) => { assert.equal(value, paper); return workspace; };
  plugin.persistResearchWorkspace = async () => {};
  const view = new ResearchView({}, plugin);
  view.app = plugin.app;
  view.contentEl = view.containerEl = document.body.createDiv();
  const textLayer = view.contentEl.createDiv({ cls: "paperlib-pdf-text-layer" });
  const range = { cloneRange: () => ({}), compareBoundaryPoints: () => 0 };
  const selection = {
    rangeCount: 1, isCollapsed: false, getRangeAt: () => range,
    removeAllRanges() { this.rangeCount = 0; this.isCollapsed = true; }
  };
  window.getSelection = () => selection;
  const context = {
    paper, text: "Selected text", page: 3, pdfPath: paper.pdfPath, sourceLeaf: {},
    selectionSource: "workspace", rectCoordinateSpace: "pdf",
    range: { beginIndex: 2, beginOffset: 1, endIndex: 4, endOffset: 5 },
    pdfRects: [{ rect: [10, 20, 100, 40], quad: [10, 40, 100, 40, 10, 20, 100, 20] }],
    dragSourceRect: { left: 250, right: 350, top: 200, bottom: 220, width: 100, height: 20 }
  };
  const calls = { snapshots: 0, repaired: [], painted: [], saved: [], toolbars: 0, refreshed: [] };
  view.getCanvasSelection = (...args) => {
    assert.deepEqual(args, [textLayer, textLayer, paper, 3, false]);
    calls.snapshots += 1;
    return context;
  };
  view.repairWorkspacePdfSelectionEnd = (...args) => calls.repaired.push(args);
  view.paintPdfHighlight = (...args) => calls.painted.push(args);
  view.renderCanvasToolbar = () => { calls.toolbars += 1; };
  view.refreshPdfHighlights = (...args) => calls.refreshed.push(args);
  plugin.saveCanvasHighlight = async (...args) => { calls.saved.push(args); };
  const emit = (target, type, event = {}) => target.listeners.get(type)?.(event);
  const flush = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  };
  const popup = () => document.body.querySelector(".paperlib-pdf-selection-toolbar");
  const begin = (event = {}) => view.beginWorkspacePdfTextSelection(
    { button: 0, pointerId: 7, ...event }, textLayer, paper, 3
  );
  const show = () => view.showWorkspacePdfSelectionToolbar(textLayer, paper, 3);
  const click = (button) => emit(button, "click", { preventDefault() {}, stopPropagation() {} });
  return { document, window, timers, view, plugin, paper, workspace, textLayer, range,
    selection, context, calls, emit, flush, popup, begin, show, click };
}

async function testWorkspaceSelectionPopup() {
  const noticesBefore = notices.length;
  for (const [color, swatch, label] of [
    ["yellow", "#ffd65a", "黄色"], ["orange", "#ff9f43", "橙色"],
    ["green", "#7bd88f", "绿色"], ["blue", "#6ab7ff", "蓝色"], ["pink", "#ff86b7", "粉色"]
  ]) {
    const f = selectionPopupFixture();
    f.begin();
    assert.ok([...f.window.listenerEntries.get("blur")].every((entry) => !entry.capture),
      "a focused link losing focus must not cancel the selection gesture");
    assert.equal(f.popup(), null, "pointerdown must not interrupt native selection");
    assert.equal(f.calls.snapshots, 0);
    const end = { pointerId: 7, clientX: 350, clientY: 220 };
    f.emit(f.window, "pointerup", end);
    assert.equal(f.popup(), null, "pointerup must defer until native selection has settled");
    assert.equal(f.timers.size, 1);
    f.flush();
    assert.deepEqual(f.calls.repaired, [[f.textLayer, end]]);
    const toolbar = f.popup();
    assert.ok(toolbar);
    assert.equal(toolbar.parentNode, f.document.body, "popup must escape the scaled workspace");
    assert.equal(toolbar.getAttribute("role"), "toolbar");
    const buttons = toolbar.querySelectorAll("button");
    assert.deepEqual(buttons.map((button) => button.dataset.color), ["yellow", "orange", "green", "blue", "pink"]);
    const button = buttons.find((item) => item.dataset.color === color);
    assert.equal(button.style["--swatch-color"], swatch);
    assert.equal(button.getAttribute("aria-label"), `用${label}高亮`);
    let prevented = 0;
    let stopped = 0;
    f.emit(f.document, "pointerdown", { target: button });
    f.emit(toolbar, "pointerdown", {
      preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; }
    });
    assert.equal(prevented, 1, "toolbar pointerdown must prevent native selection collapse");
    assert.equal(stopped, 1);
    assert.equal(f.selection.rangeCount, 1);
    assert.equal(f.popup(), toolbar);
    f.emit(f.document, "selectionchange");
    assert.equal(f.popup(), toolbar, "unchanged selection must keep the popup open");
    let finishSave;
    f.plugin.saveCanvasHighlight = (...args) => {
      f.calls.saved.push(args);
      return new Promise((resolve) => { finishSave = resolve; });
    };
    f.view.getCanvasSelection = () => assert.fail("click must save the captured snapshot, not reread selection");
    const saving = f.click(button);
    assert.equal(f.popup(), null);
    assert.equal(f.view.highlightColor, color);
    assert.deepEqual(f.calls.painted, [[f.textLayer, f.context, color]]);
    assert.equal(f.selection.rangeCount, 0);
    assert.equal(f.calls.toolbars, 1);
    assert.equal(f.calls.saved[0][0], f.context);
    assert.equal(f.calls.saved[0][1], color);
    assert.deepEqual(f.calls.refreshed, [], "authoritative highlights refresh only after persistence");
    finishSave();
    await saving;
    assert.deepEqual(f.calls.refreshed, [[f.paper]]);
    assert.equal(f.document.listeners.size + f.window.listeners.size, 0, "applying must remove popup listeners");
  }

  const f = selectionPopupFixture();
  for (let index = 0; index < 2; index += 1) {
    f.selection.rangeCount = 1;
    f.selection.isCollapsed = false;
    const snapshot = { ...f.context, text: `Selection ${index + 1}` };
    f.view.getCanvasSelection = () => { f.calls.snapshots += 1; return snapshot; };
    f.begin();
    f.emit(f.window, "pointerup", { pointerId: 7 });
    f.flush();
    assert.ok(f.popup(), "applying a color must not disable subsequent selections");
    await f.click(f.popup().querySelectorAll("button")[index]);
  }
  assert.deepEqual(f.calls.saved.map(([context, color]) => [context.text, color]),
    [["Selection 1", "yellow"], ["Selection 2", "orange"]]);
  assert.equal(f.calls.snapshots, 2);
  assert.equal(notices.length, noticesBefore, "successful highlighting must not show an error Notice");

  const failure = selectionPopupFixture();
  const error = new Error("PDF is read-only");
  failure.plugin.saveCanvasHighlight = async () => { throw error; };
  const previousError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    failure.show();
    await failure.click(failure.popup().querySelector("button"));
    assert.deepEqual(errors, [["Paper Library: failed to highlight PDF selection", error]]);
    assert.deepEqual(notices.slice(noticesBefore), ["高亮失败：PDF is read-only"]);
    assert.deepEqual(failure.calls.refreshed, [[failure.paper]], "failed optimistic paint must reconcile with saved highlights");
    assert.equal(failure.popup(), null);
    assert.equal(failure.document.listeners.size + failure.window.listeners.size, 0);
  } finally {
    console.error = previousError;
    notices.splice(noticesBefore);
  }
}

function testWorkspaceSelectionPopupLifecycle() {
  for (const [target, type, event] of [
    ["document", "pointerdown", {}], ["document", "keydown", { key: "Escape" }],
    ["window", "scroll"], ["window", "resize"], ["window", "blur"],
    ["visualViewport", "scroll"], ["visualViewport", "resize"],
    ["document", "selectionchange"]
  ]) {
    const f = selectionPopupFixture();
    f.window.visualViewport = eventTarget({ width: 320, height: 200 });
    f.show();
    f.emit(f.document, "keydown", { key: "Enter" });
    assert.ok(f.popup(), "non-Escape keys must not dismiss the popup");
    if (type === "selectionchange") f.selection.isCollapsed = true;
    f.emit(target === "visualViewport" ? f.window.visualViewport : f[target], type, event);
    assert.equal(f.popup(), null, `${target} ${type} must dismiss the popup`);
    assert.equal(f.view.pdfSelectionToolbarCleanup, null);
    assert.equal(f.document.listeners.size + f.window.listeners.size + f.window.visualViewport.listeners.size, 0);
    assert.deepEqual(f.calls.saved, []);
  }
  for (const invalidate of [
    (f) => { f.selection.rangeCount = 0; },
    (f) => { f.range.compareBoundaryPoints = (boundary) => boundary === 0 ? 1 : 0; },
    (f) => { f.range.compareBoundaryPoints = (boundary) => boundary === 2 ? 1 : 0; }
  ]) {
    const f = selectionPopupFixture();
    f.show();
    invalidate(f);
    f.emit(f.document, "selectionchange");
    assert.equal(f.popup(), null, "cleared or changed selection must dismiss the popup");
  }

  for (const action of ["dispose", "rerender", "tool", "zoom"]) {
    for (const phase of ["gesture", "deferred", "open"]) {
      const f = selectionPopupFixture();
      const previousWindow = globalThis.window;
      globalThis.window = f.window;
      try {
        f.begin();
        if (phase !== "gesture") f.emit(f.window, "pointerup", { pointerId: 7 });
        if (phase === "open") f.flush();
        if (action === "dispose") f.view.disposeWorkspacePdfView();
        if (action === "rerender") f.view.render();
        if (action === "tool") {
          f.view.toolMode = "ink";
          f.view.refreshCanvasToolbar(f.view.contentEl, f.paper, f.workspace);
        }
        if (action === "zoom") {
          const viewport = f.document.body.createDiv();
          viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 200 });
          const stage = viewport.createDiv();
          f.view.installCanvasZoom(viewport, stage, stage.createDiv(), f.paper, f.workspace, 1000, 1000);
          f.view.refreshWorkspacePdfResolution = () => {};
          f.view.setZoom(f.paper, 1.5);
        }
        assert.equal(f.view.pdfSelectionGestureCleanup, null);
        assert.equal(f.view.pdfSelectionToolbarTimer, null);
        f.emit(f.window, "pointerup", { pointerId: 7 });
        f.flush();
        assert.equal(f.popup(), null, `${action} must cancel the ${phase} selection UI`);
        assert.equal(f.document.listeners.size + f.window.listeners.size, 0);
        assert.deepEqual(f.calls.saved, []);
      } finally {
        globalThis.window = previousWindow;
      }
    }
  }

  for (const button of [1, 2]) {
    const f = selectionPopupFixture();
    f.begin({ button });
    assert.equal(f.window.listeners.size, 0, "non-primary buttons must not start text selection");
  }
  for (const cancel of ["pointercancel", "blur"]) {
    const f = selectionPopupFixture();
    f.begin();
    f.emit(f.window, "pointerup", { pointerId: 8 });
    assert.equal(f.timers.size, 0, "unrelated pointer release must not finish selection");
    assert.equal(typeof f.view.pdfSelectionGestureCleanup, "function");
    f.emit(f.window, cancel, { pointerId: 7 });
    f.emit(f.window, "pointerup", { pointerId: 7 });
    f.flush();
    assert.equal(f.popup(), null);
    assert.equal(f.window.listeners.size, 0);
  }
  for (const phase of ["release", "deferred"]) {
    const f = selectionPopupFixture();
    f.begin();
    if (phase === "release") f.view.excerptDrag = {};
    f.emit(f.window, "pointerup", { pointerId: 7 });
    f.view.excerptDrag = {};
    f.flush();
    assert.equal(f.popup(), null, "excerpt dragging must never open the selection popup");
  }
  for (const mode of ["highlight", "ink", "ai-region"]) {
    const f = selectionPopupFixture();
    f.view.toolMode = mode;
    f.begin();
    f.show();
    assert.equal(f.popup(), null);
    assert.equal(f.window.listeners.size, 0);
    if (mode === "highlight") {
      let highlighted = 0;
      f.view.handlePdfHighlight = () => { highlighted += 1; };
      f.view.beginWorkspacePdfHighlight({ button: 0, pointerId: 7 }, f.textLayer, f.paper, 3);
      f.emit(f.window, "pointerup", { pointerId: 7 });
      f.flush();
      assert.equal(highlighted, 1, "direct highlighter mode must retain its existing save path");
      assert.equal(f.popup(), null);
    }
  }
  for (const invalidate of [
    (f) => { f.view.pdfRenderToken += 1; },
    (f) => f.textLayer.remove(),
    (f) => { f.view.toolMode = "highlight"; }
  ]) {
    const f = selectionPopupFixture();
    f.begin();
    f.emit(f.window, "pointerup", { pointerId: 7 });
    invalidate(f);
    f.flush();
    assert.equal(f.popup(), null, "a stale deferred callback must not open the popup");
  }
  for (const context of [null, { text: "" }, { text: "Text", pdfRects: [] }, { text: "Text", pdfRects: [{}] }]) {
    const f = selectionPopupFixture();
    f.view.getCanvasSelection = () => context;
    f.show();
    assert.equal(f.popup(), null, "incomplete selection snapshots must not open the popup");
  }
}

function testWorkspaceSelectionPopupPosition() {
  for (const visual of [false, true]) {
    for (const rect of [
      { left: -100, right: -20, top: 10, bottom: 30 },
      { left: 500, right: 600, top: 210, bottom: 230 },
      { left: 100, right: 200, top: 140, bottom: 160 }
    ]) {
      const f = selectionPopupFixture();
      Object.assign(f.window, { innerWidth: 320, innerHeight: 200 });
      const bounds = { offsetLeft: visual ? 30 : 0, offsetTop: visual ? 40 : 0, width: 320, height: 200 };
      if (visual) f.window.visualViewport = eventTarget(bounds);
      f.context.dragSourceRect = rect;
      f.show();
      const x = parseFloat(f.popup().style.left);
      const y = parseFloat(f.popup().style.top);
      assert.ok(x >= bounds.offsetLeft + 8 && x + 188 <= bounds.offsetLeft + bounds.width - 8,
        "popup must remain inside the compact viewport horizontally");
      assert.ok(y >= bounds.offsetTop + 8 && y + 36 <= bounds.offsetTop + bounds.height - 8,
        "popup must remain inside the compact viewport vertically");
      if (!visual && rect.top === 10) assert.equal(y, rect.bottom + 8, "popup must flip below a selection near the top");
      if (!visual && rect.top === 140) assert.equal(y, rect.top - 36 - 8, "popup should prefer above the selection");
      f.view.dismissWorkspacePdfSelectionToolbar();
    }
  }
}

function testWorkspaceZoomDefaults() {
  const plugin = createPlugin(async () => bytes);
  const view = new ResearchView({}, plugin);
  const paper = { id: "default-zoom" };
  const workspace = plugin.ensureResearchWorkspace(paper);
  assert.equal(workspace.zoom, 1.4, "new desktop workspaces should default to 140%");
  assert.equal(view.getWorkspaceZoom(workspace), 1.4);
  assert.equal(view.getWorkspaceZoom({}), 1.4, "missing desktop zoom should use the default");
  assert.equal(view.assignWorkspaceZoom({}, undefined), 1.4);
  const missingZoom = { researchWorkspace: { version: 4 } };
  assert.equal(plugin.ensureResearchWorkspace(missingZoom).zoom, 1.4);
  for (const zoom of [0.8, 1, 1.25, 1.6, 2]) {
    const saved = { researchWorkspace: { version: 4, zoom } };
    assert.equal(plugin.ensureResearchWorkspace(saved).zoom, zoom, "saved zoom should be preserved");
    assert.equal(view.getWorkspaceZoom(saved.researchWorkspace), zoom);
  }
  assert.equal(view.assignWorkspaceZoom(workspace, 3), 2);
  assert.equal(view.assignWorkspaceZoom(workspace, 0.1), 0.4);
  view.assignWorkspaceZoom(workspace, 1.4);
  plugin.isMobileApp = () => true;
  assert.equal(view.getWorkspaceZoom(workspace), 1);
  assert.equal(view.assignWorkspaceZoom({}, undefined), 1);
  view.prepareMobileWorkspaceFit({ clientWidth: 390, clientHeight: 700 }, paper, workspace);
  assert.ok(workspace.mobileZoom > 0 && workspace.mobileZoom < 1, "mobile should retain automatic fit");
  assert.equal(workspace.zoom, 1.4, "mobile fit should preserve the desktop zoom");
}

async function testWorkspaceRendering() {
  const previousWindow = globalThis.window;
  const document = createDocument();
  const timers = new Map();
  const openedUrls = [];
  let selection = null;
  const window = eventTarget({
    document, devicePixelRatio: 2,
    getSelection: () => selection,
    open: (...args) => openedUrls.push(args),
    setTimeout: (callback) => { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id)
  });
  document.defaultView = window;
  globalThis.window = window;
  try {
    for (const mobile of [false, true]) {
      const plugin = createPlugin(async () => bytes);
      const paper = { id: `lazy-${mobile}`, pdfPath: file.path };
      const workspace = { zoom: 1, mobileZoom: 1, highlights: [], inkStrokes: [] };
      plugin.settings.papers = [paper];
      plugin.isMobileApp = () => mobile;
      plugin.ensureResearchWorkspace = (value) => { assert.equal(value, paper); return workspace; };
      const pageRequests = [];
      const textRequests = [];
      const renders = [];
      const annotations = new Map();
      const gates = [];
      let holdRenders = false;
      let cancelledTextLayers = 0;
      const pdf = {
        numPages: 6,
        getPage: async (pageNumber) => {
          pageRequests.push(pageNumber);
          return {
            getViewport: ({ scale }) => ({
              width: 600 * scale, height: 800 * scale, scale, viewBox: [0, 0, 600, 800],
              convertToViewportPoint: (x, y) => [x * scale, (800 - y) * scale],
              convertToPdfPoint: (x, y) => [x / scale, 800 - y / scale],
              convertToViewportRectangle: ([x1, y1, x2, y2]) => [x1 * scale, (800 - y1) * scale, x2 * scale, (800 - y2) * scale]
            }),
            getTextContent: async () => {
              textRequests.push(pageNumber);
              return { items: [{ type: "beginMarkedContent" }, { str: `Page ${pageNumber}` }] };
            },
            getAnnotations: async () => annotations.get(pageNumber) || [],
            render: (options) => {
              renders.push({ pageNumber, options });
              const promise = holdRenders ? new Promise((resolve) => gates.push(resolve)) : Promise.resolve();
              return { promise, cancel: () => {} };
            }
          };
        },
        getDestination: async (name) => {
          assert.equal(name, "chapter");
          return [{ num: 7, gen: 0 }, { name: "XYZ" }, 20, 750, 9];
        },
        getPageIndex: async (ref) => { assert.deepEqual(ref, { num: 7, gen: 0 }); return 2; }
      };
      pdfJsMock = {
        getDocument: () => ({ promise: Promise.resolve(pdf) }),
        TextLayer: class {
          constructor({ textContentSource, container }) {
            this.items = textContentSource.items;
            this.container = container;
            this.textDivs = [];
          }
          async render() {
            for (const item of this.items) {
              if (item.str === undefined) continue;
              this.textDivs.push(this.container.createSpan({ text: item.str }));
            }
            this.container.createDiv({ cls: "endOfContent" });
          }
          cancel() { cancelledTextLayers += 1; }
          update() {}
        }
      };
      const view = new ResearchView({}, plugin);
      view.app = plugin.app;
      view.paperId = paper.id;
      view.createPdfInkLayer = (parent) => parent.createDiv({ cls: "ink" });
      view.applyPdfMarkings = () => {};
      // Visibility is advanced explicitly, without wall-clock timers.
      view.scheduleWorkspacePdfVisibility = () => {};
      const host = document.body.createDiv();
      await view.renderPdfDocument(host, paper, workspace);
      const flush = () => new Promise((resolve) => setImmediate(resolve));
      await flush();
      assert.deepEqual([...view.pdfCache.pages.keys()].sort(), [1, 2]);
      assert.ok(pageRequests.every((pageNumber) => pageNumber <= 2), "offscreen placeholders must not fetch pages");
      assert.equal(host.find("paperlib-selectable-pdf-page").length, 6);
      assert.equal(host.find("paperlib-pdf-page-placeholder").length, 4);
      const first = view.pdfCache.pageViews.get(1);
      const textLayer = first.element.querySelector(".paperlib-pdf-text-layer");
      assert.deepEqual(view.getCanvasSelectionItemSpans(textLayer).map((span) => span.dataset.textIndex), ["1"],
        "TextLayer spans must retain original item indices, excluding unmapped DOM");
      assert.equal(textLayer.textContent, "Page 1");

      holdRenders = true;
      for (const pageNumber of [3, 4, 5]) view.pdfCache.pageViews.get(pageNumber).near = true;
      const third = view.ensureWorkspacePdfPage(3);
      assert.equal(view.ensureWorkspacePdfPage(3), third, "duplicate requests must share their in-flight render");
      const pending = [third, view.ensureWorkspacePdfPage(4), view.ensureWorkspacePdfPage(5)];
      await flush();
      const maximum = mobile ? 1 : 2;
      assert.equal(gates.length, maximum, "render concurrency must respect the platform limit");
      assert.equal(view.pdfActiveRenders, maximum);
      while (gates.length) {
        gates.shift()();
        await flush();
        assert.ok(view.pdfActiveRenders <= maximum);
      }
      await Promise.all(pending);
      holdRenders = false;
      assert.equal(view.pdfCache.pages.size, 5);
      assert.equal(textRequests.filter((pageNumber) => pageNumber === 3).length, 1);

      const originalCanvas = first.pageData.canvas;
      const originalData = first.pageData;
      view.assignWorkspaceZoom(workspace, 2);
      await view.ensureWorkspacePdfPage(1);
      await flush();
      assert.equal(first.pageData, originalData);
      assert.equal(first.element.querySelector(".paperlib-pdf-text-layer"), textLayer,
        "zoom must preserve selectable text DOM");
      assert.notEqual(first.pageData.canvas, originalCanvas);
      assert.equal(originalCanvas.width, 0, "replaced bitmap storage must be released");
      const zoomedRatio = view.workspacePdfRenderRatio(first.pageData.viewport, first.element);
      assert.ok(zoomedRatio > 4, "zoomed pages should retain extra detail within the pixel budget");
      assert.equal(first.pageData.ratio, zoomedRatio);
      assert.equal(first.pageData.canvas.width, Math.ceil(first.pageData.viewport.width * zoomedRatio));
      assert.equal(textRequests.filter((pageNumber) => pageNumber === 1).length, 1);
      assert.deepEqual(renders.at(-1).options.transform, [zoomedRatio, 0, 0, zoomedRatio, 0, 0]);
      const selectedCanvas = first.pageData.canvas;
      selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ intersectsNode: (node) => node === first.element }) };
      view.assignWorkspaceZoom(workspace, 0.5);
      view.pdfSelectionGestureCleanup = () => {};
      await view.ensureWorkspacePdfPage(1);
      assert.equal(first.pageData.canvas, selectedCanvas, "active gestures must retain their bitmap");
      view.pdfSelectionGestureCleanup = null;
      await view.ensureWorkspacePdfPage(1);
      await flush();
      assert.notEqual(first.pageData.canvas, selectedCanvas,
        "a completed text selection must not prevent resolution updates");
      assert.equal(first.element.querySelector(".paperlib-pdf-text-layer"), textLayer,
        "resolution updates must preserve the selected text DOM");
      assert.equal(selection.isCollapsed, false);
      assert.equal(first.pageData.ratio, 2);
      const selectedLowResolutionCanvas = first.pageData.canvas;
      view.assignWorkspaceZoom(workspace, 1);
      await view.ensureWorkspacePdfPage(1);
      await flush();
      assert.notEqual(first.pageData.canvas, selectedLowResolutionCanvas,
        "zooming in on selected text must refresh its bitmap resolution");
      assert.equal(first.pageData.ratio, 4);
      assert.equal(first.element.querySelector(".paperlib-pdf-text-layer"), textLayer);
      assert.equal(selection.isCollapsed, false);
      selection = null;
      const small = { width: 100, height: 150 };
      for (const dpr of [1, 1.25, 2, 3]) {
        window.devicePixelRatio = dpr;
        for (const zoom of [0.5, 1, 1.25, 2]) {
          view.assignWorkspaceZoom(workspace, zoom);
          assert.equal(view.workspacePdfRenderRatio(small), Math.max(1, 2 * dpr * zoom),
            "fractional zoom and screen density should retain two samples per screen pixel");
        }
      }
      window.devicePixelRatio = 2;
      view.assignWorkspaceZoom(workspace, 1);
      const displayedPage = {
        offsetWidth: 100, offsetHeight: 150,
        getBoundingClientRect: () => ({ width: 125, height: 187.5 })
      };
      assert.equal(view.workspacePdfRenderRatio(small, displayedPage), 5,
        "the displayed page scale should take precedence over stored zoom");
      displayedPage.offsetWidth = displayedPage.offsetHeight = 0;
      assert.equal(view.workspacePdfRenderRatio(small, displayedPage), 4,
        "unmeasurable pages should fall back to stored zoom");
      const large = { width: 10000, height: 10000 };
      const ratio = view.workspacePdfRenderRatio(large);
      assert.ok(ratio * ratio * large.width * large.height <= (mobile ? 6 : 12) * 1024 * 1024 + 0.001);
      assert.ok(ratio * large.width <= 8192);

      view.assignWorkspaceZoom(workspace, 1);
      view.containerEl = view.contentEl = host;
      view.render = () => assert.fail("zoom must not rebuild the workspace");
      let toolbarRefreshes = 0;
      let resolutionRefreshes = 0;
      const persisted = [];
      plugin.persistResearchWorkspace = (...args) => { persisted.push(args); };
      view.refreshCanvasToolbar = (root) => { assert.equal(root, host); toolbarRefreshes += 1; };
      const refreshResolution = view.refreshWorkspacePdfResolution;
      view.refreshWorkspacePdfResolution = () => { resolutionRefreshes += 1; };
      const viewport = document.body.createDiv();
      viewport.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
      viewport.scrollLeft = 40;
      viewport.scrollTop = 60;
      const stage = viewport.createDiv();
      const board = stage.createDiv();
      view.installCanvasZoom(viewport, stage, board, paper, workspace, 2600, 1800);
      view.setZoom(paper, 1.5);
      assert.equal(viewport.scrollLeft, 260);
      assert.equal(viewport.scrollTop, 240);
      view.setZoom(paper, 2);
      assert.equal(board.style.transform, "scale(2)");
      assert.equal(stage.style.width, "5200px");
      assert.equal(stage.style.height, "3600px");
      assert.equal(toolbarRefreshes, 2);
      assert.equal(persisted.length, 0);
      assert.equal(timers.size, 1, "zoom persistence must be debounced");
      const saveZoom = [...timers.values()][0];
      timers.clear();
      saveZoom();
      assert.deepEqual(persisted, [[paper, false]]);
      assert.equal(resolutionRefreshes, 1);
      view.refreshWorkspacePdfResolution = refreshResolution;

      annotations.set(1, [
        { subtype: "Link", rect: [-10, 10, 80, 40], url: "https://example.com/paper", titleObj: { str: "Paper" } },
        { subtype: "Link", rect: [10, 10, 30, 30], url: "mailto:reader@example.com" },
        { subtype: "Link", rect: [10, 10, 30, 30], dest: "chapter" },
        { subtype: "Link", rect: [10, 10, 30, 30], action: "NextPage" },
        ...["javascript:alert(1)", "file:///tmp/paper.pdf", "data:text/html,unsafe", "https://example.com/\nunsafe"].map((url) => ({ subtype: "Link", rect: [10, 10, 30, 30], url })),
        { subtype: "Link", rect: [10, 10, 30, 30], url: "https://example.com", noView: true },
        { subtype: "Link", rect: [700, 10, 800, 30], url: "https://example.com" },
        { subtype: "Link", rect: [NaN, 10, 30, 30], dest: "chapter" },
        { subtype: "Text", rect: [10, 10, 30, 30], url: "https://example.com" }
      ]);
      await view.renderWorkspacePdfLinks(first.pageData.page, first.pageData, first.element);
      const links = first.element.querySelectorAll("a.paperlib-pdf-link");
      assert.equal(links.length, 4, "only safe, visible link annotations must become anchors");
      assert.equal(links[0].getAttribute("aria-label"), "Paper");
      assert.equal(links[0].style.left, "0px");
      assert.equal(parseFloat(links[0].style.width), first.pageData.viewport.scale * 80);
      assert.equal(links[0].rel, "noopener noreferrer");
      assert.equal(links[0].tabIndex, 0);
      const click = host.listeners.get("click");
      view.installWorkspacePdfLinkEvents(host);
      assert.equal(host.listeners.get("click"), click, "host delegation must be installed only once");
      let prevented = 0;
      let stopped = 0;
      const event = { type: "click", button: 0, target: links[0].createSpan(),
        preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } };
      const openedInitially = openedUrls.length;
      click(event);
      assert.equal(openedUrls.length, openedInitially + 1);
      assert.deepEqual(openedUrls.at(-1), ["https://example.com/paper", "_blank", "noopener,noreferrer"]);
      assert.equal(prevented, 1);
      assert.equal(stopped, 1);
      const openedBefore = openedUrls.length;
      view.toolMode = "highlight";
      click(event);
      assert.equal(openedUrls.length, openedBefore, "drawing tools must not activate links");
      await view.renderWorkspacePdfLinks(first.pageData.page, first.pageData, first.element);
      assert.ok(first.element.querySelectorAll("a.paperlib-pdf-link").every((anchor) => anchor.tabIndex === -1));
      view.toolMode = "select";
      event.target = first.element.querySelector("a.paperlib-pdf-link").createSpan();
      view.pdfRenderToken += 1;
      click(event);
      assert.equal(openedUrls.length, openedBefore, "stale document links must not activate");
      assert.equal(stopped, 2, "stale clicks must still be isolated from canvas handlers");
      view.pdfRenderToken -= 1;

      host.offsetWidth = 700;
      host.offsetHeight = 600;
      host.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1400, height: 1200, bottom: 1220 });
      host.querySelector(".paperlib-canvas-pdf-meta").offsetHeight = 30;
      const target = view.pdfCache.pageViews.get(3);
      target.element.getBoundingClientRect = () => ({ left: 210, top: 2020,
        width: target.pageData.viewport.width * 2, height: target.pageData.viewport.height * 2 });
      assert.equal(await view.followWorkspacePdfLink(links[2].__paperlibPdfLink), true);
      const scale = target.pageData.viewport.scale;
      assert.ok(Math.abs(host.scrollLeft - (100 + 20 * scale)) < 0.001);
      assert.ok(Math.abs(host.scrollTop - (1000 + 50 * scale - 30)) < 0.001);
      assert.equal(view.getWorkspaceZoom(workspace), 2, "PDF destination zoom must not alter board zoom");
      assert.equal(await view.followWorkspacePdfLink({ ...links[2].__paperlibPdfLink, destination: [99] }), false);
      const coldTarget = view.pdfCache.pageViews.get(6);
      assert.equal(coldTarget.pageData, null);
      assert.equal(coldTarget.near, false);
      const scrollDestination = view.scrollWorkspacePdfDestination;
      view.scrollWorkspacePdfDestination = (scrollHost, record, destination) => {
        assert.equal(scrollHost, host);
        assert.equal(record, coldTarget);
        assert.equal(record.pinned, 1, "offscreen destinations must be pinned until navigation finishes");
        assert.ok(host.contains(record.element));
        assert.deepEqual(destination, [5, { name: "Fit" }]);
        return true;
      };
      assert.equal(await view.followWorkspacePdfLink({ ...links[2].__paperlibPdfLink, destination: [5, { name: "Fit" }] }), true);
      await flush();
      assert.equal(coldTarget.pinned, 0);
      assert.ok(coldTarget.pageData, "internal links must load previously unrendered destinations");
      view.scrollWorkspacePdfDestination = scrollDestination;
      const previousLinks = first.element.querySelectorAll("a.paperlib-pdf-link");
      const getAnnotations = first.pageData.page.getAnnotations;
      let resolveAnnotations;
      first.pageData.page.getAnnotations = () => new Promise((resolve) => { resolveAnnotations = resolve; });
      const staleLinks = view.renderWorkspacePdfLinks(first.pageData.page, first.pageData, first.element);
      view.pdfRenderToken += 1;
      resolveAnnotations([]);
      await staleLinks;
      assert.deepEqual(first.element.querySelectorAll("a.paperlib-pdf-link"), previousLinks,
        "late annotations from an obsolete render must not replace current links");
      view.pdfRenderToken -= 1;
      first.pageData.page.getAnnotations = getAnnotations;

      host.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 });
      for (const record of view.pdfCache.pageViews.values()) {
        record.element.getBoundingClientRect = () => record.pageNumber === 3
          ? { top: 100, bottom: 500 } : { top: 3000, bottom: 3800 };
      }
      const second = view.pdfCache.pageViews.get(2);
      second.pinned = true;
      selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ intersectsNode: (node) => node === first.element }) };
      const fourth = view.pdfCache.pageViews.get(4);
      const evictedCanvas = fourth.pageData.canvas;
      const evictedElement = fourth.element;
      view.updateWorkspacePdfVisibility();
      await flush();
      assert.equal(first.pageData, originalData, "selected offscreen pages must be retained");
      assert.ok(second.pageData, "pinned link destinations must be retained");
      assert.equal(fourth.pageData, null);
      assert.equal(evictedCanvas.width, 0);
      assert.equal(evictedElement.isConnected, false);
      assert.equal(host.contains(evictedElement), false);
      assert.ok(fourth.element.classList.contains("paperlib-pdf-page-placeholder"));
      assert.deepEqual(host.find("paperlib-selectable-pdf-page").map((element) => element.dataset.page), ["1", "2", "3", "4", "5", "6"]);
      assert.ok(cancelledTextLayers >= 2);
      selection = null;
      fourth.near = true;
      await view.ensureWorkspacePdfPage(4);
      await flush();
      assert.equal(textRequests.filter((pageNumber) => pageNumber === 4).length, 2,
        "an evicted page must rebuild its text when requested again");
      assert.notEqual(fourth.element, evictedElement);
      assert.equal(fourth.element.ownerDocument, document);
      assert.equal(fourth.element.parentElement, view.pdfPagesHost);
      const canvases = [...view.pdfCache.pages.values()].map((data) => data.canvas);
      view.disposeWorkspacePdfView();
      assert.equal(view.pdfCache.pages.size, 0);
      assert.equal(view.pdfCache.pageViews.size, 0);
      assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
      assert.equal(view.pdfHost, null);
    }
  } finally {
    globalThis.window = previousWindow;
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
            getTextContent: async () => ({ items: [{ str: `Page ${pageNumber}`, width: 100, transform: [12, 0, 0, 12, 10, 20] }] }),
            getAnnotations: async () => []
          })
        };
        documents.push(document);
        return { promise: Promise.resolve(document) };
      }
    };
    globalThis.document = createDocument();
    globalThis.window = eventTarget({ document: globalThis.document, devicePixelRatio: 2 });
    globalThis.document.defaultView = globalThis.window;
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
      const host = globalThis.document.body.createDiv();
      await view.renderPdfDocument(host, paper, workspace);
      assert.equal(host.find("paperlib-selectable-pdf-page").length, 2);
      assert.equal(host.find("paperlib-pdf-text-item")[1].text, "Page 2");
      assert.equal(host.find("paperlib-canvas-pdf-pages").length, 1);
      assert.equal(host.find("paperlib-pdf-loading").length, 0);
      const textLayer = host.find("paperlib-pdf-text-layer")[0];
      let selected = false;
      view.scheduleExcerptDrag = () => {
        assert.equal(typeof view.pdfSelectionGestureCleanup, "function",
          "text selection must begin before scheduling an excerpt drag");
        selected = true;
      };
      textLayer.listeners.get("pointerdown")({ button: 0 });
      assert.equal(selected, true, "the rendered text layer must retain selection handlers");
      const readsBefore = readCalls;
      await view.renderPdfDocument(globalThis.document.body.createDiv(), paper, workspace);
      assert.equal(readCalls, readsBefore, "reopening the same PDF must reuse its cache");
      const cached = view.pdfCache.document;
      view.pdfCache.path = "Papers/old.pdf";
      await view.renderPdfDocument(globalThis.document.body.createDiv(), paper, workspace);
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
    const failedHost = globalThis.document.body.createDiv();
    globalThis.fetch = async () => ({ ok: false, status: 403 });
    await failingView.renderPdfDocument(failedHost, paper, workspace);
    assert.match(failedHost.find("paperlib-pdf-loading")[0].children.at(-1).text, /EPERM.*HTTP 403/);
    assert.equal(failedHost.find("paperlib-canvas-pdf-pages").length, 0);
    const missingHost = globalThis.document.body.createDiv();
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
    testWorkspaceZoomDefaults();
    await testWorkspaceRendering();
    testWorkspaceHighlightGesture();
    await testWorkspaceSelectionPopup();
    testWorkspaceSelectionPopupLifecycle();
    testWorkspaceSelectionPopupPosition();
    assert.equal(loggedErrors.length, 2, "workspace rendering must not introduce unexpected errors");
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
