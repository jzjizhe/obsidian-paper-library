/* 浏览器扩展 worker 回归测试：在隔离 VM 中执行真实 worker，模拟 Chrome 与 fetch。
   运行：node test/extension-worker.test.js */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const filename = path.resolve(__dirname, "../browser-extension/service-worker.js");
const source = fs.readFileSync(filename, "utf8");
const COLLECTION = "Research/Optics";
const COLLECTIONS = ["Research", COLLECTION, "Empty"];
const PDF_BYTES = Buffer.from("%PDF-1.7 worker regression fixture\n%%EOF\n");
const PDF_URL = "https://publisher.example/paper.pdf";
const OA_URL = "https://open.example/accepted.pdf";
const BRIDGE = "http://127.0.0.1:24568";
const INFO = {
  title: "Optical Computing", authors: ["Ada Lovelace"], year: 2025,
  venue: "Nature", doi: "10.1/optics", site: "Publisher", pdfUrl: PDF_URL
};

function jsonResponse(data, status = 200) {
  return { status, ok: status < 400, json: async () => data };
}

function pdfResponse(status = 200) {
  return {
    status, ok: status < 400,
    arrayBuffer: async () => Uint8Array.from(PDF_BYTES).buffer,
    headers: { get: () => "application/pdf" }
  };
}

function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args))
  };
}

function makeWorker(options = {}) {
  const calls = { fetch: [], page: [], downloads: [], searches: [], tabs: [], removedTabs: [] };
  const unexpected = [];
  const onChanged = event();
  const onUpdated = event();
  const timers = new Map();
  let timerId = 0;
  let listener;
  const pingData = options.pingData || { ok: true, papers: 7, collections: COLLECTIONS };
  const chrome = {
    storage: { local: { get: async () => ({
      paperlibToken: options.token === undefined ? " test-token " : options.token,
      paperlibPort: 24568
    }) } },
    runtime: { onMessage: { addListener: (handler) => { listener = handler; } } },
    tabs: {
      onUpdated,
      sendMessage: async (tabId, message) => {
        calls.page.push({ tabId, message: { ...message } });
        return options.page || { ok: false, reason: "unavailable" };
      },
      create: async (details) => {
        calls.tabs.push({ ...details });
        return { id: 88 };
      },
      remove: async (id) => { calls.removedTabs.push(id); }
    },
    downloads: {
      onChanged,
      download: (details, callback) => {
        calls.downloads.push({ ...details });
        if (options.download === "complete" || options.download === "interrupted") {
          callback(99);
          queueMicrotask(() => onChanged.emit({
            id: 99, state: { current: options.download }, error: { current: "NETWORK_FAILED" }
          }));
        } else {
          chrome.runtime.lastError = { message: "Mock browser download unavailable" };
          try { callback(undefined); }
          finally { delete chrome.runtime.lastError; }
        }
      },
      search: (query, callback) => {
        calls.searches.push({ ...query });
        callback([{ filename: "/mock/Downloads/browser-copy.pdf" }]);
      }
    }
  };
  const addUpdatedListener = onUpdated.addListener;
  onUpdated.addListener = (handler) => {
    addUpdatedListener(handler);
    queueMicrotask(() => onUpdated.emit(88, { status: "complete" }));
  };
  const context = vm.createContext({
    chrome, URL, URLSearchParams, TextEncoder, TextDecoder, Blob, atob,
    setTimeout: (callback, milliseconds) => {
      const id = ++timerId;
      timers.set(id, callback);
      // Advance only the IEEE settling delay; watchdogs remain virtual.
      if (milliseconds <= 900) queueMicrotask(() => {
        if (!timers.has(id)) return;
        timers.delete(id);
        callback();
      });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, init = {}) => {
      calls.fetch.push({ url, init: { ...init, ...(init.headers ? { headers: { ...init.headers } } : {}) } });
      if (url === `${BRIDGE}/api/ping`) {
        if (options.pingError) throw new Error(options.pingError);
        return jsonResponse(pingData, options.pingStatus || 200);
      }
      if (url === `${BRIDGE}/api/import` || url === `${BRIDGE}/api/import-pdf`) {
        if (options.importError) throw new Error(options.importError);
        return jsonResponse(options.importData || { ok: true, title: INFO.title }, options.importStatus || 200);
      }
      if (url === PDF_URL || url === OA_URL || url.startsWith("https://ieeexplore.ieee.org/stampPDF/")) {
        return options.pdfFetch ? options.pdfFetch(url, init, calls) : pdfResponse(404);
      }
      if (url.startsWith("https://api.semanticscholar.org/graph/v1/")) {
        return options.oa ? jsonResponse({ openAccessPdf: { url: options.oa } }) : jsonResponse({}, 404);
      }
      if (url.startsWith("https://export.arxiv.org/api/query?")) return jsonResponse({}, 404);
      unexpected.push(url);
      throw new Error(`Unexpected fetch: ${url}`);
    }
  });
  vm.runInContext(source, context, { filename });
  assert.equal(typeof listener, "function");
  return {
    calls,
    imports: () => calls.fetch.filter(({ url }) => /\/api\/import(?:-pdf)?$/.test(url)),
    async message(message) {
      let timeout;
      try {
        return await new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`Worker did not reply: ${message.type}`)), 1000);
          assert.equal(listener(message, {}, (reply) => resolve(JSON.parse(JSON.stringify(reply)))), true);
        });
      } finally {
        clearTimeout(timeout);
        timers.clear();
        assert.deepEqual(unexpected, [], "all fetches must use known mocks");
        assert.equal(onChanged.listeners.size, 0, "download listeners must be removed");
        assert.equal(onUpdated.listeners.size, 0, "navigation listeners must be removed");
      }
    }
  };
}

function importMessage(extra = {}) {
  return { type: "paperlib:import", info: { ...INFO }, includePdf: true, tabId: 42, collection: COLLECTION, ...extra };
}

function assertNoImportWork(worker) {
  assert.deepEqual(worker.calls.fetch.map(({ url }) => url), [`${BRIDGE}/api/ping`]);
  assert.equal(worker.imports().length, 0);
  assert.deepEqual(worker.calls.page, []);
  assert.deepEqual(worker.calls.downloads, []);
  assert.deepEqual(worker.calls.tabs, []);
}

function assertRequest(request, api, contentType) {
  assert.equal(request.url, `${BRIDGE}${api}`);
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(request.init.headers["Content-Type"], contentType);
}

function assertPayload(payload, collection = COLLECTION) {
  assert.equal(payload.collection, collection, "destination must be top-level");
  assert.equal(payload.metadata.title, INFO.title);
  assert.deepEqual(payload.metadata.authors, INFO.authors);
  assert.equal(payload.metadata.doi, INFO.doi);
  assert.equal(payload.metadata.source, "浏览器扩展（Publisher）");
  assert.equal(Object.hasOwn(payload.metadata, "collection"), false);
  assert.equal(Object.hasOwn(payload.metadata, "collections"), false);
}

function assertJsonImport(worker, collection = COLLECTION, index = 0) {
  const request = worker.imports()[index];
  assert.ok(request, "worker must send an import request");
  assertRequest(request, "/api/import", "application/json");
  const payload = JSON.parse(request.init.body);
  assertPayload(payload, collection);
  return payload;
}

async function assertPdfImport(worker, collection = COLLECTION) {
  assert.equal(worker.imports().length, 1);
  const request = worker.imports()[0];
  assertRequest(request, "/api/import-pdf", "application/x-paperlib-import");
  assert.ok(request.init.body instanceof Blob);
  const bytes = Buffer.from(await request.init.body.arrayBuffer());
  const length = bytes.readUInt32BE(0);
  assert.ok(length >= 2 && length < bytes.length - 4);
  const envelope = JSON.parse(bytes.subarray(4, 4 + length).toString("utf8"));
  assertPayload(envelope, collection);
  assert.deepEqual(bytes.subarray(4 + length), PDF_BYTES, "envelope must preserve original PDF bytes");
  return envelope;
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("ping exposes current, empty, and legacy collection lists", async () => {
  for (const collections of [COLLECTIONS, [], undefined, null]) {
    const pingData = { ok: true, papers: 7 };
    if (collections !== undefined) pingData.collections = collections;
    const worker = makeWorker({ pingData });
    assert.deepEqual(await worker.message({ type: "paperlib:ping" }), {
      ok: true, papers: 7, collections: Array.isArray(collections) ? collections : null
    });
    assert.equal(worker.calls.fetch[0].init.headers.Authorization, "Bearer test-token");
  }
});

test("metadata JSON carries the explicit destination without trusting page classification", async () => {
  const worker = makeWorker({ importData: { ok: true, metadataOnly: true, title: INFO.title } });
  const reply = await worker.message(importMessage({
    includePdf: false, info: { ...INFO, collection: "Injected", collections: ["Injected"] }
  }));
  assert.deepEqual(reply, { ok: true, duplicate: false, attachedPdf: false, metadataOnly: true, title: INFO.title });
  assert.equal(worker.imports().length, 1);
  const payload = assertJsonImport(worker);
  assert.deepEqual(Object.keys(payload).sort(), ["collection", "metadata"]);
  assert.deepEqual(worker.calls.page, []);
  assert.deepEqual(worker.calls.downloads, []);
});

test("page-fetched PDF uses the binary envelope", async () => {
  const worker = makeWorker({ page: { ok: true, base64: PDF_BYTES.toString("base64") } });
  assert.equal((await worker.message(importMessage())).ok, true);
  assert.equal((await assertPdfImport(worker)).fileName, "paper.pdf");
  assert.deepEqual(worker.calls.page, [{ tabId: 42, message: { type: "paperlib:fetch-pdf", url: PDF_URL } }]);
  assert.deepEqual(worker.calls.fetch.map(({ url }) => url), [`${BRIDGE}/api/ping`, `${BRIDGE}/api/import-pdf`]);
  assert.deepEqual(worker.calls.downloads, []);
});

test("worker-fetched PDF uses authenticated publisher fetch and the binary envelope", async () => {
  const worker = makeWorker({ pdfFetch: () => pdfResponse() });
  assert.equal((await worker.message(importMessage())).ok, true);
  assert.equal((await assertPdfImport(worker)).fileName, "paper.pdf");
  assert.deepEqual(worker.calls.fetch.find(({ url }) => url === PDF_URL).init, {
    credentials: "include", redirect: "follow"
  });
  assert.deepEqual(worker.calls.downloads, []);
});

test("browser-download filePath JSON retains destination and cleanup", async () => {
  const worker = makeWorker({ download: "complete" });
  assert.equal((await worker.message(importMessage())).ok, true);
  assert.equal(worker.imports().length, 1);
  const payload = assertJsonImport(worker);
  assert.equal(payload.filePath, "/mock/Downloads/browser-copy.pdf");
  assert.equal(payload.fileName, "browser-copy.pdf");
  assert.equal(payload.cleanup, true);
  assert.equal(Object.hasOwn(payload, "pdfUrl"), false);
  assert.deepEqual(worker.calls.downloads, [{ url: PDF_URL, saveAs: false, conflictAction: "uniquify" }]);
  assert.deepEqual(worker.calls.searches, [{ id: 99 }]);
});

test("final pdfUrl JSON fallback retains destination", async () => {
  const worker = makeWorker();
  assert.equal((await worker.message(importMessage())).ok, true);
  assert.equal(worker.imports().length, 1);
  const payload = assertJsonImport(worker);
  assert.equal(payload.pdfUrl, PDF_URL);
  assert.equal(payload.fileName, "paper.pdf");
  assert.equal(Object.hasOwn(payload, "filePath"), false);
  assert.equal(worker.calls.downloads.length, 1);
});

test("interrupted browser downloads still reach the destination-aware URL fallback", async () => {
  const worker = makeWorker({ download: "interrupted" });
  assert.equal((await worker.message(importMessage())).ok, true);
  assert.equal(assertJsonImport(worker).pdfUrl, PDF_URL);
  assert.deepEqual(worker.calls.searches, []);
});

test("warmed IEEE retry retains destination and closes its navigation tab", async () => {
  let attempts = 0;
  const worker = makeWorker({ pdfFetch: () => pdfResponse(++attempts === 1 ? 403 : 200) });
  const info = { ...INFO, url: "https://ieeexplore.ieee.org/document/12345", pdfUrl: "https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=12345" };
  assert.equal((await worker.message(importMessage({ info }))).ok, true);
  const envelope = await assertPdfImport(worker);
  assert.equal(envelope.fileName, `${INFO.title}.pdf`);
  const url = "https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=12345&ref=";
  assert.deepEqual(worker.calls.tabs, [{ url, active: false }]);
  assert.deepEqual(worker.calls.removedTabs, [88]);
  assert.equal(attempts, 2);
  assert.deepEqual(worker.calls.downloads, []);
});

test("open-access PDF retry retains destination", async () => {
  const worker = makeWorker({ oa: OA_URL, pdfFetch: (url) => pdfResponse(url === OA_URL ? 200 : 403) });
  assert.equal((await worker.message(importMessage())).ok, true);
  assert.equal((await assertPdfImport(worker)).fileName, "accepted.pdf");
  assert.equal(worker.calls.downloads.length, 1);
  assert.ok(worker.calls.fetch.some(({ url }) => url.includes("/paper/DOI%3A10.1%2Foptics")));
  assert.ok(worker.calls.fetch.some(({ url }) => url === OA_URL));
});

test("initial open-access discovery retains destination", async () => {
  const worker = makeWorker({ oa: OA_URL, pdfFetch: () => pdfResponse() });
  assert.equal((await worker.message(importMessage({ info: { ...INFO, pdfUrl: "" } }))).ok, true);
  assert.equal((await assertPdfImport(worker)).fileName, "accepted.pdf");
  assert.equal(worker.calls.page[0].message.url, OA_URL);
  assert.deepEqual(worker.calls.downloads, []);
});

test("selected category requires a modern plugin before any download or import", async () => {
  for (const collections of [undefined, null]) {
    for (const includePdf of [true, false]) {
      const pingData = { ok: true, papers: 7 };
      if (collections !== undefined) pingData.collections = collections;
      const worker = makeWorker({ pingData });
      const reply = await worker.message(importMessage({ includePdf }));
      assert.equal(reply.ok, false);
      assert.equal(reply.code, "upgrade-plugin");
      assertNoImportWork(worker);
    }
  }
});

test("stale or malformed selection rejects before download, discovery, or import", async () => {
  for (const collection of ["Deleted", `${COLLECTION} `, 17, false, [], {}]) {
    for (const includePdf of [true, false]) {
      const worker = makeWorker();
      const reply = await worker.message(importMessage({ collection, includePdf, info: { ...INFO, pdfUrl: "" } }));
      assert.equal(reply.ok, false);
      assert.equal(reply.code, "collection-not-found");
      assertNoImportWork(worker);
    }
  }
  const worker = makeWorker({ pingData: { ok: true, papers: 0, collections: [] } });
  assert.equal((await worker.message(importMessage())).code, "collection-not-found");
  assertNoImportWork(worker);
});

test("no selection remains compatible with modern and legacy plugins for JSON and binary", async () => {
  for (const pingData of [{ ok: true, papers: 7, collections: COLLECTIONS }, { ok: true, papers: 7 }]) {
    for (const collection of [undefined, "", null]) {
      for (const includePdf of [false, true]) {
        const worker = makeWorker({ pingData, pdfFetch: () => pdfResponse() });
        const message = importMessage({ collection, includePdf });
        if (collection === undefined) delete message.collection;
        assert.equal((await worker.message(message)).ok, true);
        if (includePdf) await assertPdfImport(worker, "");
        else assertJsonImport(worker, "");
      }
    }
  }
});

test("missing token, bridge auth errors, and offline errors stop before downloads", async () => {
  for (const [options, code] of [
    [{ token: " " }, "no-token"],
    [{ pingStatus: 401, pingData: { ok: false } }, "bad-token"],
    [{ pingError: "Connection refused" }, "offline"],
    [{ pingData: { ok: false, error: "Bridge disabled" }, pingStatus: 503 }, "offline"]
  ]) {
    for (const type of ["paperlib:import", "paperlib:ping"]) {
      const worker = makeWorker(options);
      const reply = await worker.message({ ...importMessage(), type });
      assert.equal(reply.ok, false);
      assert.equal(reply.code, code);
      assert.ok(reply.error);
      assert.equal(worker.imports().length, 0);
      assert.deepEqual(worker.calls.page, []);
      assert.deepEqual(worker.calls.downloads, []);
      assert.equal(worker.calls.fetch.length, code === "no-token" ? 0 : 1);
      if (options.pingData?.error) assert.equal(reply.error, options.pingData.error);
    }
  }
});

test("JSON and binary imports propagate auth, category, login, and server errors", async () => {
  for (const includePdf of [false, true]) {
    for (const [status, data, code] of [
      [401, { ok: false, error: "Token expired" }, "bad-token"],
      [400, { ok: false, code: "collection-not-found", error: "Category renamed" }, "collection-not-found"],
      [400, { ok: false, needsLogin: true, error: "Publisher login required" }, "needs-login"],
      [500, { ok: false, error: "Vault write failed" }, "server"]
    ]) {
      const worker = makeWorker({ pdfFetch: () => pdfResponse(), importStatus: status, importData: data });
      const reply = await worker.message(importMessage({ includePdf }));
      assert.deepEqual(reply, { ok: false, code, error: data.error });
      assert.equal(worker.imports().length, 1);
      if (includePdf) await assertPdfImport(worker);
      else assertJsonImport(worker);
      assert.deepEqual(worker.calls.downloads, []);
    }
  }
});

test("thrown import errors reach the runtime response", async () => {
  const worker = makeWorker({ importError: "Mock transport failure" });
  assert.deepEqual(await worker.message(importMessage({ includePdf: false })), {
    ok: false, code: "error", error: "Mock transport failure"
  });
  assertJsonImport(worker);
});

test("duplicate PDF attachment flags survive worker normalization", async () => {
  const worker = makeWorker({
    pdfFetch: () => pdfResponse(),
    importData: { ok: true, duplicate: true, attachedPdf: true, title: INFO.title }
  });
  assert.deepEqual(await worker.message(importMessage()), {
    ok: true, duplicate: true, attachedPdf: true, metadataOnly: false, title: INFO.title
  });
  await assertPdfImport(worker);
});

test("publisher login failure is preserved after destination-aware URL fallback", async () => {
  const worker = makeWorker({
    page: { ok: false, reason: "needs-login", status: 403 },
    pdfFetch: () => pdfResponse(403),
    importStatus: 400, importData: { ok: false, needsLogin: true, error: "HTML login page" }
  });
  const reply = await worker.message(importMessage());
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "needs-login");
  assert.ok(reply.error);
  assert.equal(assertJsonImport(worker).pdfUrl, PDF_URL);
});

async function run() {
  for (const { name, run: check } of tests) {
    try { await check(); }
    catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  }
  console.log(`Extension worker tests passed (${tests.length}/${tests.length})`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
