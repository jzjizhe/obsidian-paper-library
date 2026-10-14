const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

class Menu {
  constructor() { this.items = []; Menu.last = this; }
  addItem(build) {
    const item = {
      setTitle(title) { this.title = title; return this; },
      setIcon() { return this; },
      onClick(callback) { this.callback = callback; return this; }
    };
    build(item);
    this.items.push(item);
  }
  addSeparator() {}
  showAtMouseEvent(event) { this.event = event; }
}
const obsidianMock = {
  ItemView: class {}, Menu, Modal: class {}, Notice: class {}, Plugin: class {},
  PluginSettingTab: class {}, Setting: class {}, loadPdfJs: async () => ({}),
  normalizePath: (value) => String(value), requestUrl: async () => ({}), setIcon: () => {}
};
const filename = path.resolve(__dirname, "../main.js");
const pluginModule = new Module(filename, module);
pluginModule.filename = filename;
pluginModule.paths = Module._nodeModulePaths(path.dirname(filename));
pluginModule.require = (name) => name === "obsidian" ? obsidianMock : module.require(name);
pluginModule._compile(
  `${fs.readFileSync(filename, "utf8")}\nmodule.exports.LibraryView = PaperLibraryView;`,
  filename
);
const { LibraryView } = pluginModule.exports;

class Element {
  constructor(tag, options = {}) {
    this.tag = tag;
    this.classes = new Set(String(options.cls || "").split(/\s+/).filter(Boolean));
    this.text = options.text || "";
    this.children = [];
    this.listeners = new Map();
  }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  toggleClass(name, enabled) { if (enabled) this.classes.add(name); else this.classes.delete(name); }
  empty() { this.children = []; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.classes.has(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
}
function event(extra = {}) {
  return { preventDefault() {}, stopPropagation() {}, ...extra };
}
function createView({ mobile = false, appearance = "standard", pdfPath = "Papers/test.pdf" } = {}) {
  const paper = { id: "paper-test", title: "Test paper", pdfPath };
  const calls = [];
  const plugin = {
    uiState: { selectedId: null, scope: "all" },
    settings: { papers: [paper] },
    app: { workspace: { activeLeaf: { id: "source" } } },
    isMobileApp: () => mobile,
    getLibraryAppearanceBase: () => appearance,
    isPaperImportActive: () => false,
    refreshSelectedPaperViews: () => {},
    saveSettings: async () => {},
    openPaperPdf: async (value, options) => calls.push({ type: "pdf", paper: value, options }),
    openResearchWorkspace: async (value, leaf, reveal) => calls.push({ type: "research", paper: value, leaf, reveal })
  };
  const view = new LibraryView({}, plugin);
  view.app = plugin.app;
  view.tableHost = new Element("div");
  view.captureTableScroll = () => {};
  view.closeFavoriteColorPicker = () => {};
  view.getFilteredPapers = () => plugin.settings.papers;
  view.getTableColumnWidths = () => ({});
  view.getTableColumnOrder = () => [];
  view.applyTableColumnWidths = () => {};
  view.renderPaperglassRowCells = (row) => row.createSpan({ text: paper.title });
  view.restoreTableScroll = () => {};
  view.syncSelectedPaperRows = () => {};
  view.scheduleSelectedPaperDetailRefresh = () => {};
  view.renderBatchBar = () => {};
  view.getDailyReadingPriority = () => ({ id: "normal", label: "Normal", minutesPerPage: 2, fallbackMinutes: 10 });
  view.getDailyReadingProgress = () => ({ percent: 0, pageCount: 0 });
  return { view, plugin, paper, calls };
}

async function run() {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let timerId = 0;
  globalThis.window = {
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  try {
    for (const appearance of ["standard", "paperglass"]) {
      const { view, plugin, paper, calls } = createView({ appearance });
      view.renderTable();
      const row = view.tableHost.querySelectorAll(".paperlib-paper-row")[0];
      await row.listeners.get("click")(event());
      assert.equal(calls.length, 0, "single click must select without opening a reader");
      assert.equal(plugin.uiState.selectedId, paper.id);
      await row.listeners.get("dblclick")(event());
      assert.deepEqual(calls, [{ type: "pdf", paper, options: { native: true } }]);
      assert.ok(paper.lastOpened);
      calls.length = 0;
      view.selectionMode = true;
      await row.listeners.get("dblclick")(event());
      assert.equal(calls.length, 0, "double click must preserve multi-select behavior");
      view.selectionMode = false;
      row.listeners.get("contextmenu")(event());
      const native = Menu.last.items.filter((item) => item.title === "用原生 PDF 阅读器打开");
      const research = Menu.last.items.filter((item) => item.title === "用 Research Workspace 打开");
      assert.equal(native.length, 1);
      assert.equal(research.length, 1);
      assert.equal(Menu.last.items.some((item) => item.title === "在研究画布中打开 PDF" || item.title === "打开研究画布"), false);
      await native[0].callback();
      await research[0].callback();
      assert.deepEqual(calls, [
        { type: "pdf", paper, options: { native: true } },
        { type: "research", paper, leaf: plugin.app.workspace.activeLeaf, reveal: true }
      ]);
    }

    const mobile = createView({ mobile: true });
    mobile.view.renderTable();
    const mobileRow = mobile.view.tableHost.querySelectorAll(".paperlib-paper-row")[0];
    await mobileRow.listeners.get("click")(event());
    await mobileRow.listeners.get("click")(event());
    assert.deepEqual(mobile.calls, [{ type: "pdf", paper: mobile.paper, options: { native: true } }]);
    await mobileRow.listeners.get("dblclick")(event());
    assert.equal(mobile.calls.length, 1, "synthetic mobile double-click must avoid opening twice");

    for (const isMobile of [false, true]) {
      const daily = createView({ mobile: isMobile });
      const parent = new Element("div");
      daily.view.renderDailyPaperCard(parent, daily.paper);
      const card = parent.querySelectorAll(".paperlib-daily-paper")[0];
      await card.listeners.get("click")(event());
      assert.equal(daily.calls.length, 0);
      await card.listeners.get("dblclick")(event());
      assert.deepEqual(daily.calls, [{ type: "pdf", paper: daily.paper, options: { native: true } }]);
    }

    const missing = createView({ pdfPath: "" });
    missing.view.showPaperContextMenu(event(), missing.paper);
    assert.equal(Menu.last.items.some((item) => item.title === "用原生 PDF 阅读器打开"), false);
    const research = Menu.last.items.find((item) => item.title === "用 Research Workspace 打开");
    await research.callback();
    assert.equal(missing.calls[0].type, "research", "papers without a PDF must retain access to their research notes");

    const batch = createView();
    batch.view.checkedPaperIds.add(batch.paper.id);
    batch.view.showPaperContextMenu(event(), batch.paper);
    assert.equal(Menu.last.items.some((item) => /用.*打开/.test(item.title)), false);
    assert.ok(Menu.last.items.some((item) => item.title === "退出多选"));

    const empty = createView();
    empty.plugin.settings.papers = [];
    empty.view.renderTable();
    assert.equal(empty.view.tableHost.querySelectorAll(".paperlib-empty").length, 1);
  } finally {
    globalThis.window = originalWindow;
  }
}

run().then(() => console.log("PDF opening interaction tests passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
