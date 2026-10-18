/* 插件自更新的纯逻辑：版本号比较、Release 资源选择、zip 条目安全检查。
   不依赖 Obsidian，可在 Node 中直接 import 进行单元测试。
   网络请求与安装流程在插件主类中（后续 services/self-update.js 拆分）。 */

const PAPER_LIBRARY_RELEASES_API = "https://api.github.com/repos/jzjizhe/obsidian-paper-library/releases/latest";
const PAPER_LIBRARY_UPDATE_FILES = new Set([
  "main.js",
  "manifest.json",
  "styles.css",
  "versions.json",
  "doclayout_extract.py",
  "DOCLAYOUT_NOTICE.md",
  "LICENSE"
]);
const PAPER_LIBRARY_UPDATE_REQUIRED_FILES = [
  "main.js",
  "manifest.json",
  "styles.css",
  "vendor/claudian.bundle.js",
  "vendor/claudian.css",
  "vendor/paper-composer-cli-providers.cjs",
  "pipeline/worker.cjs",
  "pipeline/models.json"
];

function normalizePaperLibraryReleaseVersion(value) {
  return String(value || "").trim().replace(/^v/i, "").split("+")[0];
}

function comparePaperLibraryVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ""] = normalizePaperLibraryReleaseVersion(value).split("-", 2);
    return { numbers: core.split(".").map((part) => Number(part) || 0), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] || 0) - (b.numbers[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function selectPaperLibraryReleaseAsset(release, version) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const exact = `paper-library-${normalizePaperLibraryReleaseVersion(version)}.zip`;
  return assets.find((asset) => asset?.name === exact)
    || assets.find((asset) => /^paper-library-(?!web-importer).*\.zip$/i.test(String(asset?.name || "")))
    || null;
}

function isSafePaperLibraryZipEntry(value) {
  const entry = String(value || "").replace(/\\/g, "/");
  if (!entry || entry.includes("\0") || entry.startsWith("/") || /^[a-z]:\//i.test(entry)) return false;
  return !entry.split("/").some((part) => part === "..");
}

function isPaperLibraryReleaseFile(value) {
  const relativePath = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return PAPER_LIBRARY_UPDATE_FILES.has(relativePath)
    || relativePath.startsWith("vendor/")
    || relativePath.startsWith("pipeline/");
}

/* PAPER_LIBRARY_UPDATE_FILES 仅供 isPaperLibraryReleaseFile 内部使用。 */
export {
  PAPER_LIBRARY_RELEASES_API,
  PAPER_LIBRARY_UPDATE_REQUIRED_FILES,
  comparePaperLibraryVersions,
  isPaperLibraryReleaseFile,
  isSafePaperLibraryZipEntry,
  normalizePaperLibraryReleaseVersion,
  selectPaperLibraryReleaseAsset
};
