const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const PDF_BYTES = Buffer.from("%PDF-1.7 test PDF\n%%EOF\n");
let testHome;
const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Plugin: class {},
  PluginSettingTab: class {}, Setting: class {},
  Notice: class { setMessage() {} hide() {} },
  normalizePath: (value) => String(value).replace(/\\/g, "/"), setIcon: () => {},
  requestUrl: async () => ({ status: 200, arrayBuffer: Uint8Array.from(PDF_BYTES).buffer })
};
const filename = path.resolve(__dirname, "../main.js");
const pluginModule = new Module(filename, module);
pluginModule.filename = filename;
pluginModule.paths = Module._nodeModulePaths(path.dirname(filename));
pluginModule.require = (name) => name === "obsidian" ? obsidianMock
  : name === "node:os" ? { ...os, homedir: () => testHome || os.homedir() } : module.require(name);
pluginModule._compile(`${fs.readFileSync(filename, "utf8")}\nmodule.exports.LibraryView = PaperLibraryView;`, filename);
const PaperLibraryPlugin = pluginModule.exports;

function createPlugin() {
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.settings = {
    papers: [], tags: [], collections: ["AI/Agents", "Empty", "Reading"],
    libraryFolder: "Papers", extensionToken: "collection-test-token", extensionServerPort: 0,
    onlineMetadataLookup: false
  };
  plugin.uiState = { scope: "all" };
  plugin.files = new Map();
  plugin.snapshots = [];
  plugin.app = { vault: {
    getAbstractFileByPath: (name) => plugin.files.has(name) ? { path: name, extension: name.split(".").pop() } : null,
    createBinary: async (name, bytes) => plugin.files.set(name, bytes),
    readBinary: async (file) => plugin.files.get(file.path)
  } };
  plugin.saveSettings = async () => plugin.snapshots.push(structuredClone(plugin.settings.papers));
  plugin.refreshViews = () => {};
  plugin.refreshPaperPresentation = () => {};
  plugin.scheduleBatchImportRefresh = () => {};
  plugin.flushBatchImportRefresh = () => {};
  plugin.ensureVaultFolder = async () => {};
  plugin.isMobileApp = () => false;
  plugin.isDocLayoutRuntimeInstalled = () => false;
  plugin.extractLocalPdfMetadata = async () => ({ year: 2025, collections: ["Ignore parsed collections"] });
  plugin.enrichPaperVenueRanks = async () => {};
  plugin.organizePaperFiles = async () => {};
  plugin.ensurePaperNote = async (paper) => ({ path: paper.notePath });
  return plugin;
}

async function run() {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperlib-collection-test-"));
  fs.mkdirSync(path.join(testHome, "Downloads"));
  const plugin = createPlugin();
  plugin.startExtensionServer();
  const server = plugin.extensionServer;
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(route, payload, options = {}) {
    const response = await fetch(base + route, {
      method: payload === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${options.token || plugin.settings.extensionToken}`,
        "Content-Type": options.binary ? "application/x-paperlib-import" : "application/json" },
      body: payload === undefined ? undefined : options.binary ? payload : JSON.stringify(payload)
    });
    return { status: response.status, data: await response.json() };
  }
  const metadata = (title, extra = {}) => ({ title, year: 2025, ...extra });
  try {
    let result = await api("/api/ping", undefined, { token: "wrong-token" });
    assert.equal(result.status, 401);
    result = await api("/api/ping");
    assert.deepEqual(result.data.collections, ["AI", "AI/Agents", "Empty", "Reading"]);

    const before = plugin.settings.papers.length;
    for (const collection of ["Deleted", "../AI", " AI", ["AI"], null, 42]) {
      result = await api("/api/import", { metadata: metadata("Invalid category"), collection });
      assert.equal(result.status, 400);
      assert.equal(result.data.code, "collection-not-found");
      assert.equal(plugin.settings.papers.length, before);
      assert.equal(plugin.files.size, 0);
    }

    result = await api("/api/import", { metadata: metadata("Categorized metadata"), collection: "Empty" });
    assert.equal(result.data.metadataOnly, true);
    assert.deepEqual(plugin.settings.papers[0].collections, ["Empty"]);

    result = await api("/api/import", {
      metadata: metadata("Categorized PDF", { doi: "10.1/categorized" }),
      collection: "AI/Agents", pdfBase64: PDF_BYTES.toString("base64")
    });
    assert.equal(result.data.ok, true);
    const imported = plugin.settings.papers.find((paper) => paper.doi === "10.1/categorized");
    assert.deepEqual(imported.collections, ["AI/Agents"]);
    assert.match(imported.pdfPath, /^Papers\/AI\/Agents\/2025\//);
    assert.ok(plugin.files.has(imported.pdfPath));
    assert.equal(imported.importStatus, undefined);
    const initial = plugin.snapshots.find((papers) => papers.some((paper) => paper.id === imported.id));
    assert.deepEqual(initial.find((paper) => paper.id === imported.id).collections, ["AI/Agents"],
      "category must be persisted before the first PDF save");

    const envelope = Buffer.from(JSON.stringify({ metadata: metadata("Binary PDF"), fileName: "binary.pdf", collection: "Reading" }));
    const length = Buffer.alloc(4); length.writeUInt32BE(envelope.length);
    result = await api("/api/import-pdf", Buffer.concat([length, envelope, PDF_BYTES]), { binary: true });
    assert.equal(result.data.ok, true);
    assert.deepEqual(plugin.settings.papers[0].collections, ["Reading"]);
    assert.match(plugin.settings.papers[0].pdfPath, /^Papers\/Reading\/2025\//);

    result = await api("/api/import", { metadata: metadata("Uncategorized PDF"), pdfBase64: PDF_BYTES.toString("base64") });
    assert.equal(result.data.ok, true);
    assert.deepEqual(plugin.settings.papers[0].collections, []);
    assert.match(plugin.settings.papers[0].pdfPath, /^Papers\/Uncategorized\/2025\//);

    const downloaded = path.join(testHome, "Downloads", "downloaded.pdf");
    fs.writeFileSync(downloaded, PDF_BYTES);
    result = await api("/api/import", { metadata: metadata("Downloaded PDF"), collection: "Empty", filePath: downloaded, cleanup: true });
    assert.equal(result.data.ok, true);
    assert.deepEqual(plugin.settings.papers[0].collections, ["Empty"]);
    assert.equal(fs.existsSync(downloaded), false);
    result = await api("/api/import", { metadata: metadata("Outside downloads"), collection: "AI", filePath: "/etc/hosts" });
    assert.equal(result.status, 400);

    result = await api("/api/import", { metadata: metadata("URL PDF"), collection: "AI", pdfUrl: "https://example.test/paper.pdf" });
    assert.equal(result.data.ok, true);
    assert.match(plugin.settings.papers[0].pdfPath, /^Papers\/AI\/2025\//);

    const count = plugin.settings.papers.length;
    const originalPath = imported.pdfPath;
    result = await api("/api/import", { metadata: metadata("Categorized PDF", { doi: imported.doi }), collection: "Reading" });
    assert.equal(result.data.duplicate, true);
    assert.equal(plugin.settings.papers.length, count);
    assert.deepEqual(imported.collections, ["AI/Agents", "Reading"]);
    assert.equal(imported.pdfPath, originalPath, "adding a category must preserve the primary category's file placement");
    const library = new PaperLibraryPlugin.LibraryView({}, plugin);
    for (const scope of ["all", "collection:AI", "collection:AI/Agents", "collection:Reading"]) {
      plugin.uiState.scope = scope;
      assert.ok(library.getFilteredPapers().includes(imported), `imported paper must appear in ${scope}`);
    }
    plugin.uiState.scope = "collection:Empty";
    assert.equal(library.getFilteredPapers().includes(imported), false);
    result = await api("/api/lookup", { metadata: { doi: imported.doi } });
    assert.deepEqual(result.data.paper.collections, ["AI/Agents", "Reading"]);
    result = await api("/api/import", { metadata: metadata("Categorized PDF", { doi: imported.doi }), collection: "AI" });
    assert.deepEqual(imported.collections, ["AI/Agents", "Reading"], "an existing child category already covers its parent");
    result = await api("/api/import", {
      metadata: metadata("Categorized PDF", { doi: imported.doi }), collection: "Empty",
      pdfBase64: Buffer.from("<html>login</html>").toString("base64")
    });
    assert.equal(result.data.needsLogin, true);
    assert.deepEqual(imported.collections, ["AI/Agents", "Reading"], "failed PDF imports must preserve category memberships");

    result = await api("/api/import", { metadata: metadata("Awaiting full text", { doi: "10.1/no-pdf" }) });
    const awaiting = plugin.settings.papers[0];
    result = await api("/api/import", {
      metadata: metadata("Awaiting full text", { doi: awaiting.doi }), collection: "Empty",
      pdfBase64: PDF_BYTES.toString("base64")
    });
    assert.equal(result.data.attachedPdf, true);
    assert.deepEqual(awaiting.collections, ["Empty"]);
    assert.match(awaiting.pdfPath, /^Papers\/Empty\/2025\//);

    plugin.settings.collections.push("Temporary");
    plugin.settings.collections = plugin.settings.collections.filter((collection) => collection !== "Temporary");
    const snapshot = JSON.stringify(plugin.settings.papers);
    result = await api("/api/import", { metadata: metadata("Stale choice"), collection: "Temporary" });
    assert.equal(result.data.code, "collection-not-found");
    assert.equal(JSON.stringify(plugin.settings.papers), snapshot);
    console.log("Extension category API and real import pipeline tests passed");
  } finally {
    server.closeAllConnections();
    const closed = new Promise((resolve) => server.once("close", resolve));
    plugin.stopExtensionServer();
    await closed;
    fs.rmSync(testHome, { recursive: true, force: true });
    testHome = undefined;
  }
}

module.exports = { createPlugin, PDF_BYTES };
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
