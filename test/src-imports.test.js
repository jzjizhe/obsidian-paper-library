/* 跨模块导入完整性检查：src/ 下任何模块若以裸标识符（非属性访问）引用了
   其他模块导出的符号，就必须显式 import。esbuild 不会对未定义标识符报错
   （它们变成运行时全局查找，直到执行到才 ReferenceError），此测试把这个
   盲区变成构建期失败。
   运行：node test/src-imports.test.js */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
})(SRC);

// 汇总所有模块的导出符号
const exportedBy = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const names = new Set();
  for (const block of text.matchAll(/export \{([^}]+)\}/gs)) {
    for (const part of block[1].split(",")) {
      const name = part.trim().split(" as ").pop().trim();
      if (name) names.add(name);
    }
  }
  for (const match of text.matchAll(/^export (?:async )?function (\w+)/gm)) names.add(match[1]);
  for (const match of text.matchAll(/^export (?:const|class) (\w+)/gm)) names.add(match[1]);
  for (const name of names) {
    if (!exportedBy.has(name)) exportedBy.set(name, file);
  }
}

const problems = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const imported = new Set();
  for (const match of text.matchAll(/import \{([^}]+)\} from/gs)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(" as ").pop().trim();
      if (name) imported.add(name);
    }
  }
  const local = new Set();
  for (const match of text.matchAll(/^(?:export )?(?:async )?(?:function|class) (\w+)/gm)) local.add(match[1]);
  for (const match of text.matchAll(/^(?:export )?(?:const|let|var) (\w+)/gm)) local.add(match[1]);
  for (const [name, owner] of exportedBy) {
    if (owner === file || imported.has(name) || local.has(name)) continue;
    // 只检查裸引用：前面不是 . 或标识符字符的才算（排除 this.plugin.xxx 这类属性访问）
    const bare = new RegExp(`(?<![.\\w$])${name.replace(/[$]/g, "\\$&")}\\b`);
    if (bare.test(text)) {
      problems.push(`${path.relative(SRC, file)}: 裸引用了 ${path.relative(SRC, owner)} 导出的 ${name} 但未导入`);
    }
  }
}

assert.deepEqual(problems, [], problems.join("\n"));
console.log(`跨模块导入完整性检查通过（${files.length} 个源文件）`);
