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

const plugin = Object.create(PaperLibraryPlugin.prototype);
plugin.settings = { papers: [] };
plugin.nativePdfStates = new Map();
plugin.nativePdfBindings = new Map();

// PDF 视图还在创建 .pdf-toolbar：必须安排重试，而不是静默放弃
let retries = 0;
plugin.scheduleNativePdfMountRetry = () => { retries += 1; };
plugin.app = {
  workspace: {
    getLeavesOfType: () => [{
      view: { file: { path: "Papers/test.pdf" }, containerEl: { isConnected: true, querySelector: () => null } }
    }]
  }
};
plugin.mountNativePdfToolbars();
assert.equal(retries, 1, "a PDF view without a toolbar must schedule a mount retry");

// 没有 PDF 视图时清空重试计数和定时器
plugin.scheduleNativePdfMountRetry = () => { throw new Error("must not retry without PDF leaves"); };
plugin.nativePdfMountRetryCount = 5;
plugin.nativePdfMountRetryTimer = setTimeout(() => {}, 10000);
plugin.app.workspace.getLeavesOfType = () => [];
plugin.mountNativePdfToolbars();
assert.equal(plugin.nativePdfMountRetryCount, 0);
assert.equal(plugin.nativePdfMountRetryTimer, null);

console.log("PDF toolbar mount retry tests passed.");
