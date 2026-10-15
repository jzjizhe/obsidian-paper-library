const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const sdk = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
  PluginSettingTab: class {}, Setting: class {}, normalizePath: (p) => p, setIcon() {}
};
const filename = path.resolve(__dirname, "../main.js");
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled.require = (name) => name === "obsidian" ? sdk : module.require(name);
compiled._compile(`${fs.readFileSync(filename, "utf8")}\nmodule.exports.PDFDocumentForTest = PDFDocument;`, filename);
const Plugin = compiled.exports;

function fixture(options = {}) {
  let id = 0;
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const events = new Map();
  const file = { path: "Papers/test.pdf" };
  const window = {
    requestAnimationFrame: (callback) => { const key = ++id; frames.set(key, callback); return key; },
    cancelAnimationFrame: (key) => frames.delete(key),
    setTimeout: (callback) => { const key = ++id; timers.set(key, callback); return key; },
    clearTimeout: (key) => timers.delete(key)
  };
  const page = { renderingState: 0, canvas: { isConnected: true }, div: { offsetLeft: 0, offsetTop: 0 }, getPagePoint: () => [9, 11] };
  const hashes = [];
  const loads = [];
  const subpaths = [];
  const containerEl = {
    ownerDocument: { defaultView: window }, isConnected: true,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name)
  };
  const pdfViewer = {
    currentScale: options.scale || 1.25, currentScaleValue: options.scaleValue || "page-width",
    currentPageNumber: 3, pagesRotation: 90, scrollMode: 1, spreadMode: 2,
    getPageView: () => page, pagesPromise: Promise.resolve()
  };
  const application = {
    location: { pageNumber: 2, left: 0, top: 500 }, pdfDocument: { numPages: 5 }, isInitialViewSet: true,
    pdfViewer, dom: { viewerContainerEl: { scrollLeft: 0, scrollTop: 50, getBoundingClientRect: () => ({ width: 400, height: 600 }) } },
    pdfLinkService: { setHash: (hash) => { hashes.push(hash); pdfViewer.currentPageNumber = Number(hash.match(/page=(\d+)/)[1]); } },
    eventBus: { _on: (name, callback) => events.set(name, callback), _off: (name) => events.delete(name) }
  };
  const child = { pdfViewer: application, applySubpath(value) { subpaths.push(value); } };
  const returned = Promise.resolve();
  const original = function (...args) {
    assert.equal(this, viewer);
    loads.push(args);
    child.applySubpath(args[1]);
    return returned;
  };
  const viewer = Object.create({ loadFile: original });
  viewer.child = child;
  const originalSubpath = child.applySubpath;
  const leaf = { view: { file, viewer, containerEl } };
  const plugin = Object.create(Plugin.prototype);
  plugin.app = { workspace: { getLeavesOfType: () => [leaf] } };
  const snapshots = [];
  plugin.createNativePdfReloadSnapshot = () => {
    const snapshot = { removed: false, remove() { this.removed = true; } };
    snapshots.push(snapshot);
    return snapshot;
  };
  const frame = async () => {
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback();
    await Promise.resolve();
  };
  const loaded = () => {
    application.pdfDocument = { numPages: 5 }; application.isInitialViewSet = true;
    Object.assign(pdfViewer, { currentPageNumber: 1, currentScaleValue: "1", pagesRotation: 0, scrollMode: 0, spreadMode: 0 });
  };
  const clean = () => {
    assert.equal(viewer.loadFile, original);
    assert.equal(Object.hasOwn(viewer, "loadFile"), false);
    assert.equal(child.applySubpath, originalSubpath);
    assert.equal(plugin.nativePdfReloadGuards.size, 0);
    assert.equal(frames.size + timers.size + listeners.size + events.size, 0);
    assert.ok(snapshots.every((snapshot) => snapshot.removed));
  };
  return { plugin, leaf, file, viewer, child, application, pdfViewer, page, hashes, loads, returned,
    listeners, events, timers, snapshots, frame, loaded, clean };
}

async function run() {
  {
    const f = fixture();
    const [guard] = f.plugin.prepareNativePdfReloads(f.file.path);
    assert.equal(f.viewer.loadFile(f.file), f.returned, "the original promise identity must be preserved");
    assert.deepEqual(f.loads[0], [f.file, "#page=2&offset=0,500,1.25"]);
    f.loaded();
    await f.frame();
    assert.equal(f.hashes.at(-1), "page=2&zoom=page-width,0,500");
    assert.equal(f.pdfViewer.pagesRotation, 90);
    assert.equal(f.pdfViewer.scrollMode, 1);
    assert.equal(f.pdfViewer.spreadMode, 2);
    assert.equal(f.snapshots[0].removed, false, "keep the old image until the target page finishes rendering");
    assert.equal(guard.canAnnotate(), false, "do not mark a transient page hidden behind the snapshot");
    await f.frame();
    f.page.renderingState = 3;
    await f.frame();
    await guard.ready;
    f.clean();
    await f.viewer.loadFile(f.file);
    assert.equal(f.loads.at(-1).length, 1, "later external reloads must remain untouched");
  }
  {
    const f = fixture({ scale: 1.75, scaleValue: "1.75" });
    f.plugin.prepareNativePdfReloads(f.file.path);
    f.viewer.loadFile(f.file);
    f.loaded(); await f.frame();
    assert.equal(f.hashes.at(-1), "page=2&zoom=175,0,500");
    assert.equal(f.plugin.prepareNativePdfReloads(f.file.path)[0], f.plugin.nativePdfReloadGuards.get(f.viewer),
      "rapid saves should reuse the existing snapshot and position");
    f.viewer.loadFile(f.file); f.loaded();
    f.page.renderingState = 3; await f.frame(); await f.frame();
    f.clean();
  }
  {
    const f = fixture();
    const [guard] = f.plugin.prepareNativePdfReloads(f.file.path);
    f.viewer.loadFile(f.file); f.loaded(); await f.frame();
    assert.equal(f.plugin.prepareNativePdfReloads(f.file.path)[0], guard);
    f.listeners.get("pointerdown")({ type: "pointerdown", target: { closest: () => ({}) } });
    f.plugin.nativePdfStates = new WeakMap([[f.leaf.view.containerEl, { mode: "highlight" }]]);
    f.listeners.get("pointerdown")({ type: "pointerdown", target: { closest: (selector) => selector === ".page" ? {} : null } });
    assert.equal(f.snapshots[0].removed, false, "annotation-tool clicks must not cancel stabilization");
    f.page.renderingState = 3; await f.frame();
    assert.equal(f.plugin.nativePdfReloadGuards.size, 1,
      "an earlier render must not consume a delayed later write notification");
    f.viewer.loadFile(f.file); f.loaded();
    await f.frame(); await f.frame();
    assert.equal(f.hashes.at(-1), "page=2&zoom=page-width,0,500");
    f.clean();
  }
  {
    const f = fixture({ scale: 1.65, scaleValue: "1.65" });
    const [guard] = f.plugin.prepareNativePdfReloads(f.file.path);
    assert.equal(f.plugin.prepareNativePdfReloads(f.file.path)[0], guard);
    f.viewer.loadFile(f.file); f.loaded(); f.page.renderingState = 3;
    await f.frame(); await f.frame();
    assert.equal(f.plugin.nativePdfReloadGuards.size, 1,
      "the first delayed notification must not claim two already-armed writes");
    f.viewer.loadFile(f.file); f.loaded();
    await f.frame(); await f.frame();
    assert.equal(f.hashes.at(-1), "page=2&zoom=165,0,500");
    f.clean();
  }
  {
    const f = fixture();
    let finishPages;
    f.pdfViewer.pagesPromise = new Promise((resolve) => { finishPages = resolve; });
    f.plugin.prepareNativePdfReloads(f.file.path);
    f.viewer.loadFile(f.file); f.loaded(); f.page.renderingState = 3;
    await f.frame();
    assert.equal(f.snapshots[0].removed, false);
    f.pdfViewer.currentPageNumber = 1;
    f.pdfViewer.currentScaleValue = "1";
    finishPages(); await Promise.resolve(); await f.frame();
    assert.equal(f.hashes.at(-1), "page=2&zoom=page-width,0,500",
      "restore again after mixed-size page initialization");
    f.clean();
  }
  for (const action of [
    (f) => f.viewer.loadFile({ path: "Other.pdf" }),
    (f) => f.viewer.loadFile(f.file, "#page=4"),
    (f) => { f.leaf.view.containerEl.isConnected = false; },
    (f) => { f.leaf.view.file = { path: "Other.pdf" }; },
    (f) => { f.viewer.child = null; },
    (f) => f.events.get("documenterror")(),
    (f) => [...f.timers.values()][0](),
    (f) => { f.plugin.nativePdfReloadStopped = true; f.plugin.nativePdfReloadGuards.get(f.viewer).cancel(); }
  ]) {
    const f = fixture();
    f.plugin.prepareNativePdfReloads(f.file.path);
    action(f); await f.frame(); f.clean();
    if (f.plugin.nativePdfReloadStopped) assert.deepEqual(f.plugin.prepareNativePdfReloads(f.file.path), []);
  }
  {
    const f = fixture(); f.plugin.prepareNativePdfReloads(f.file.path);
    f.listeners.get("wheel")();
    f.viewer.loadFile(f.file);
    assert.deepEqual(f.loads.at(-1), [f.file], "input before the reload must not inject the stale destination");
    f.clean();
  }
  for (const interact of [
    (f) => f.listeners.get("wheel")(),
    (f) => f.child.applySubpath("#page=4")
  ]) {
    const f = fixture(); f.plugin.prepareNativePdfReloads(f.file.path);
    f.viewer.loadFile(f.file); interact(f);
    assert.equal(f.snapshots[0].removed, true);
    f.loaded(); f.page.renderingState = 3; await f.frame(); await f.frame();
    assert.equal(f.hashes.length, 0, "explicit navigation and input must win over restoration");
    f.clean();
  }
  {
    const f = fixture();
    let rejectLoad;
    f.viewer.loadFile = () => new Promise((resolve, reject) => { rejectLoad = reject; });
    f.plugin.prepareNativePdfReloads(f.file.path);
    const loading = f.viewer.loadFile(f.file);
    f.plugin.prepareNativePdfReloads(f.file.path);
    rejectLoad(new Error("Earlier load failed"));
    await assert.rejects(loading, /Earlier load failed/);
    assert.equal(f.plugin.nativePdfReloadGuards.size, 1,
      "failure of an earlier reload must not discard the pending later write");
    f.plugin.nativePdfReloadGuards.get(f.viewer).cancel();
    assert.equal(f.plugin.nativePdfReloadGuards.size, 0);
  }
  {
    const f = fixture();
    f.viewer.loadFile = () => { throw new Error("Load failed"); };
    f.plugin.prepareNativePdfReloads(f.file.path);
    assert.throws(() => f.viewer.loadFile(f.file), /Load failed/);
    assert.equal(f.plugin.nativePdfReloadGuards.size, 0);
    assert.ok(f.snapshots[0].removed);
  }
  {
    const f = fixture(); f.plugin.prepareNativePdfReloads(f.file.path);
    const replacement = () => {};
    f.viewer.loadFile = replacement;
    f.plugin.nativePdfReloadGuards.get(f.viewer).cancel();
    assert.equal(f.viewer.loadFile, replacement, "cleanup must respect another plugin's wrapper");
  }
  {
    const f = fixture();
    const second = fixture({ scale: 2, scaleValue: "2" });
    const hidden = fixture();
    hidden.application.dom.viewerContainerEl.getBoundingClientRect = () => ({ width: 0, height: 0 });
    const unrelated = fixture(); unrelated.leaf.view.file.path = "Other.pdf";
    f.plugin.app.workspace.getLeavesOfType = () => [f.leaf, second.leaf, hidden.leaf, unrelated.leaf];
    const guards = f.plugin.prepareNativePdfReloads(f.file.path);
    assert.equal(guards.length, 2);
    f.viewer.loadFile(f.file); second.viewer.loadFile(second.file);
    f.loaded(); second.loaded();
    f.page.renderingState = second.page.renderingState = 3;
    await f.frame(); await second.frame(); await f.frame(); await second.frame();
    assert.equal(f.hashes.at(-1), "page=2&zoom=page-width,0,500");
    assert.equal(second.hashes.at(-1), "page=2&zoom=200,0,500");
    assert.equal(f.plugin.nativePdfReloadGuards.size, 0);
  }
  {
    const f = fixture();
    const document = await Plugin.PDFDocumentForTest.create(); document.addPage();
    const bytes = await document.save();
    f.plugin.pdfMutationQueues = new Map();
    let writes = 0;
    f.plugin.app.vault = {
      getAbstractFileByPath: () => f.file, readBinary: async () => bytes,
      modifyBinary: async () => { writes += 1; f.viewer.loadFile(f.file); }
    };
    assert.equal(await f.plugin.mutateLocalPdf(f.file.path, async () => true), true);
    assert.equal(writes, 1);
    assert.equal(f.page.renderingState, 0);
    assert.equal(f.plugin.nativePdfReloadGuards.size, 1, "file saving must not wait for rendering");
    f.plugin.nativePdfReloadGuards.get(f.viewer).cancel(); f.clean();
    f.plugin.app.vault.modifyBinary = async () => { throw new Error("Write denied"); };
    await assert.rejects(f.plugin.mutateLocalPdf(f.file.path, async () => true), /Write denied/);
    f.clean();
  }
  {
    const elements = [];
    const calls = [];
    const context = { scale: (...args) => calls.push(["scale", ...args]), fillRect() {}, drawImage: (...args) => calls.push(["draw", ...args]) };
    const document = {
      defaultView: { devicePixelRatio: 3, getComputedStyle: () => ({ backgroundColor: "white", filter: "none" }) },
      createElement: (tag) => {
        const element = { tag, style: {}, setAttribute() {}, appendChild() {}, getContext: () => context };
        elements.push(element); return element;
      }
    };
    const source = { width: 600, height: 800, getBoundingClientRect: () => ({ left: 30, top: 30, right: 130, bottom: 130, width: 100, height: 100 }) };
    const outside = { ...source, getBoundingClientRect: () => ({ left: 1000, top: 1000, right: 1100, bottom: 1100, width: 100, height: 100 }) };
    const containerEl = { ownerDocument: document, clientLeft: 2, clientTop: 2, scrollLeft: 0, scrollTop: 0,
      getBoundingClientRect: () => ({ left: 20, top: 20 }), appendChild() {} };
    const scroller = { clientLeft: 1, clientTop: 1, clientWidth: 180, clientHeight: 140,
      getBoundingClientRect: () => ({ left: 30, top: 40 }),
      querySelectorAll: (selector) => selector.includes("canvas") ? [source, outside] : [] };
    const plugin = Object.create(Plugin.prototype);
    const layer = plugin.createNativePdfReloadSnapshot({ view: { containerEl } }, scroller);
    assert.equal(layer.style.width, "180px", "snapshot must leave the native scrollbar exposed");
    assert.equal(layer.style.left, "9px");
    assert.equal(layer.style.top, "19px");
    assert.equal(elements[1].width, 360, "snapshot bitmap density is capped at 2x");
    assert.deepEqual(calls[0], ["scale", 2, 2]);
    assert.equal(calls.filter((call) => call[0] === "draw").length, 1, "copy only visible canvas pixels");
  }
  console.log("Native PDF reload stabilization tests passed");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
