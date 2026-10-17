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

function scrollerAt(top, scrollTop = 0) {
  return {
    scrollTop,
    getBoundingClientRect: () => ({ top })
  };
}
function pageAt(top) {
  return { getBoundingClientRect: () => ({ top }) };
}

// Obsidian restores to page N: page 1 sits above the viewport. The pin must
// scroll upward, which the old one-direction check never did.
{
  const scroller = scrollerAt(0, 2000);
  const changed = plugin.alignNativePdfFirstPage(pageAt(-1000), scroller);
  assert.equal(changed, true, "an above-viewport page must be corrected");
  assert.equal(scroller.scrollTop, 1000, "scrollTop must move upward by the delta");
}

// Page 1 below the viewport still scrolls downward.
{
  const scroller = scrollerAt(0, 0);
  const changed = plugin.alignNativePdfFirstPage(pageAt(600), scroller);
  assert.equal(changed, true);
  assert.equal(scroller.scrollTop, 600);
}

// Already aligned: no scroll.
{
  const scroller = scrollerAt(0, 123);
  const changed = plugin.alignNativePdfFirstPage(pageAt(2), scroller);
  assert.equal(changed, false);
  assert.equal(scroller.scrollTop, 123);
}

// No scroller: fall back to scrollIntoView on the page.
{
  let called = 0;
  const page = {
    getBoundingClientRect: () => ({ top: 500 }),
    scrollIntoView: () => { called += 1; }
  };
  assert.equal(plugin.alignNativePdfFirstPage(page, null), true);
  assert.equal(called, 1);
}

console.log("PDF reading position tests passed.");
