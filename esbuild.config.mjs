import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Obsidian 桌面端（Electron）在运行时提供这些模块，不能打进包里
const external = [
  "obsidian",
  "electron",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
];

const context = await esbuild.context({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "browser",
  external,
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  footer: {
    // 保持 Obsidian 社区插件的入口约定：require(main.js) 直接得到插件类。
    // src/main.js 内部使用 ESM 的 export default，这里转回 module.exports。
    js: "module.exports = module.exports.default || module.exports;"
  }
});

if (watch) {
  await context.watch();
  console.log("esbuild: watching src/ for changes…");
} else {
  await context.rebuild();
  await context.dispose();
}
