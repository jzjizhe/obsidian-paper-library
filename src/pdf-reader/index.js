import { writebackMethods } from "./writeback.js";
import { overlaysMethods } from "./overlays.js";
import { textboxMethods } from "./textbox.js";
import { marksMethods } from "./marks.js";
import { inkshapesMethods } from "./ink-shapes.js";
import { undoMethods } from "./undo.js";
import { readingpositionMethods } from "./reading-position.js";
import { toolbarMethods } from "./toolbar.js";

const pdfReaderMethods = {
  ...writebackMethods,
  ...overlaysMethods,
  ...textboxMethods,
  ...marksMethods,
  ...inkshapesMethods,
  ...undoMethods,
  ...readingpositionMethods,
  ...toolbarMethods
};

const seen = new Set();
for (const name of Object.keys(pdfReaderMethods)) {
  if (seen.has(name)) throw new Error(`Duplicate PDF reader method: ${name}`);
  seen.add(name);
}

function installPdfReaderMethods(PluginClass) {
  for (const [name, method] of Object.entries(pdfReaderMethods)) {
    Object.defineProperty(PluginClass.prototype, name, {
      value: method,
      configurable: true,
      writable: true,
      enumerable: false
    });
  }
}

export { installPdfReaderMethods, pdfReaderMethods };
