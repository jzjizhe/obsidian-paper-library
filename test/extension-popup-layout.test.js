const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../browser-extension/popup.css"), "utf8");
for (const selector of ["html", "body"]) {
  const rule = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]+)\\}`));
  assert.ok(rule, `${selector} must have an explicit popup sizing rule`);
  assert.match(rule[1], /(?:^|[;\n])\s*width:\s*392px\s*;/);
  assert.match(rule[1], /(?:^|[;\n])\s*min-width:\s*392px\s*;/);
  assert.doesNotMatch(rule[1], /max-width:\s*(?:100%|[^;]*vw)/,
    "popup size must be independent of Chrome's provisional viewport");
  assert.doesNotMatch(rule[1], /overflow-x:\s*hidden/,
    "popup width regressions must remain detectable");
}
assert.match(css, /\.metric-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
assert.match(css, /\.metric-skeletons\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/);
assert.match(css, /\.actions\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr/);
assert.equal((css.match(/\.metric-grid\s*\{/g) || []).length, 1,
  "metric columns must retain the original four-column layout");

console.log("Extension popup sizing regression tests passed");
