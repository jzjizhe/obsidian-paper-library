const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

let requestHandler = async () => ({ status: 200, json: {} });
const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  loadPdfJs: async () => ({}),
  normalizePath: (value) => String(value).replace(/\\/g, "/"),
  requestUrl: (...args) => requestHandler(...args),
  setIcon: () => {}
};
const filename = path.resolve(__dirname, "../main.js");
const pluginModule = new Module(filename, module);
pluginModule.filename = filename;
pluginModule.paths = Module._nodeModulePaths(path.dirname(filename));
pluginModule.require = (name) => name === "obsidian" ? obsidianMock : module.require(name);
pluginModule._compile(fs.readFileSync(filename, "utf8"), filename);
const PaperLibraryPlugin = pluginModule.exports;
const { chunkText, md5Hex, translateText } = PaperLibraryPlugin.translationInternals;

const plugin = Object.create(PaperLibraryPlugin.prototype);
plugin.settings = { translationProvider: "mymemory", translationTargetLanguage: "zh-CN" };

async function run() {
  // MD5 与 Node crypto 对齐，Baidu 签名依赖它
  for (const sample of ["abc", "你好", "Hello world!"]) {
    assert.equal(
      md5Hex(sample),
      crypto.createHash("md5").update(sample, "utf8").digest("hex"),
      `MD5 mismatch for ${sample}`
    );
  }

  // MyMemory 免费接口：不经过 AI
  let captured = null;
  requestHandler = async (options) => {
    captured = options;
    return { status: 200, json: { responseData: { translatedText: "你好" } } };
  };
  assert.equal(await translateText(plugin, "hello"), "你好");
  assert.match(captured.url, /api\.mymemory\.translated\.net/);
  assert.match(captured.url, /langpair=autodetect%7Czh-CN/);

  // 长文本分块后每段不超过字节上限
  const longText = `${"A sentence with words. ".repeat(80)}`;
  const chunks = chunkText(longText, 450);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(new TextEncoder().encode(chunk).length <= 450, "chunk exceeds MyMemory limit");
  }

  // 百度：from=auto、sign 为 32 位 MD5
  plugin.settings = {
    translationProvider: "baidu",
    translationTargetLanguage: "zh-CN",
    baiduTranslateAppId: "app-id",
    baiduTranslateKey: "secret-key"
  };
  requestHandler = async (options) => {
    captured = options;
    return { status: 200, json: { trans_result: [{ dst: "你好" }] } };
  };
  assert.equal(await translateText(plugin, "hello"), "你好");
  assert.match(captured.body, /from=auto/);
  assert.match(captured.body, /sign=[0-9a-f]{32}/);

  // DeepL：免费版 Key 使用 api-free 端点，target 使用 ZH-HANS
  plugin.settings = {
    translationProvider: "deepl",
    translationTargetLanguage: "zh-CN",
    deeplTranslateApiKey: "key:fx"
  };
  requestHandler = async (options) => {
    captured = options;
    return { status: 200, json: { translations: [{ text: "你好" }] } };
  };
  assert.equal(await translateText(plugin, "hello"), "你好");
  assert.match(captured.url, /api-free\.deepl\.com/);
  assert.equal(captured.headers.Authorization, "DeepL-Auth-Key key:fx");
  assert.match(captured.body, /target_lang=ZH-HANS/);

  // 缺少密钥时给出可操作的错误
  plugin.settings = { translationProvider: "deepl", translationTargetLanguage: "zh-CN", deeplTranslateApiKey: "" };
  await assert.rejects(() => translateText(plugin, "hello"), /DeepL API Key/);

  console.log("Translation tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
