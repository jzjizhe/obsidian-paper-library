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

function createNode(tag) {
  return {
    tag,
    attrs: {},
    dataset: {},
    children: [],
    setAttribute(key, value) { this.attrs[key] = String(value); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren() { this.children = []; }
  };
}

const plugin = Object.create(PaperLibraryPlugin.prototype);
const pageRect = { width: 600, height: 800 };
const shape = (type, start, end, width = 2.5) => ({ type, start, end, width });

function hit(testShape, x, y) {
  return plugin.pdfShapeHitTest(testShape, { x, y }, pageRect);
}

// 矩形只有描边可命中，内部空白不再抢占右键/橡皮
const rect = shape("rect", { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.6 });
assert.equal(hit(rect, 0.2, 0.4), true, "left edge must be hit");
assert.equal(hit(rect, 0.8, 0.4), true, "right edge must be hit");
assert.equal(hit(rect, 0.5, 0.4), false, "rect interior must not be hit");
assert.equal(hit(rect, 0.2 - 4 / 600, 0.4), true, "edge tolerance must apply");
assert.equal(hit(rect, 0.05, 0.4), false, "far outside must not be hit");

// 椭圆/圆同理，中心不命中，边界命中
const ellipse = shape("ellipse", { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 });
assert.equal(hit(ellipse, 0.75, 0.5), true, "ellipse boundary must be hit");
assert.equal(hit(ellipse, 0.5, 0.5), false, "ellipse interior must not be hit");
assert.equal(hit(ellipse, 0.75 - 4 / 600, 0.5), true, "ellipse edge tolerance must apply");

// 直线/箭头沿用线段距离
const line = shape("line", { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.6 });
assert.equal(hit(line, 0.5, 0.4), true, "line segment must be hit");
assert.equal(hit(line, 0.9, 0.9), false, "far from line must not be hit");

// 圆工具始终按等宽高等像素绘制，Shift 对矩形做同样约束
const circleEnd = plugin.constrainPdfShapeEnd(
  { x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }, pageRect, "circle", false
);
assert.ok(Math.abs(circleEnd.y - 0.675) < 1e-9, "circle must force equal pixel extents");
assert.deepEqual(
  plugin.constrainPdfShapeEnd({ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }, pageRect, "rect", false),
  { x: 0.7, y: 0.6 },
  "rect must keep the raw end without Shift"
);

// 箭头线段止于箭头底部，箭尖正好落在拖拽终点
global.document = { createElementNS: (_namespace, tag) => createNode(tag) };
const svg = createNode("svg");
plugin.appendNativePdfShape(
  svg,
  shape("arrow", { x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }, 4),
  { getBoundingClientRect: () => pageRect }
);
const [arrowLine, arrowHead] = svg.children[0].children;
const tip = arrowHead.attrs.points.split(" ")[0].split(",").map(Number);
assert.ok(Number(arrowLine.attrs.x2) < tip[0], "arrow line must stop before the tip");
assert.ok(Number(arrowLine.attrs.y2) < tip[1], "arrow line must stop before the tip");
assert.equal(tip[0], 700);
assert.equal(tip[1], 600);

console.log("PDF shape geometry and hit-testing tests passed.");
