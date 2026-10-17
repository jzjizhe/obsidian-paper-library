/* 插件自更新：从 GitHub Releases 检查新版本、下载 zip、校验并安装。
   方法体从插件主类搬出，this 改为首个参数 plugin；主类保留委托壳，
   所有调用点（设置页按钮等）不受影响。 */

import { Notice, requestUrl } from "obsidian";
import {
  PAPER_LIBRARY_RELEASES_API,
  PAPER_LIBRARY_UPDATE_REQUIRED_FILES,
  comparePaperLibraryVersions,
  isPaperLibraryReleaseFile,
  isSafePaperLibraryZipEntry,
  normalizePaperLibraryReleaseVersion,
  selectPaperLibraryReleaseAsset
} from "../update-checker.js";

export async function checkForPaperLibraryUpdate(plugin) {
  if (plugin.isMobileApp()) throw new Error("自动更新仅支持桌面端 Obsidian");
  const response = await requestUrl({
    url: PAPER_LIBRARY_RELEASES_API,
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    throw: false
  });
  if (response.status >= 400) throw new Error(`GitHub 请求失败（HTTP ${response.status}）`);
  const release = response?.json || (response?.text ? JSON.parse(response.text) : {});
  const version = normalizePaperLibraryReleaseVersion(release?.tag_name);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("最新版本号无效");
  const asset = selectPaperLibraryReleaseAsset(release, version);
  if (!asset?.browser_download_url) throw new Error(`版本 ${version} 缺少完整安装包`);
  return {
    version,
    available: comparePaperLibraryVersions(version, plugin.manifest?.version) > 0,
    assetUrl: asset.browser_download_url,
    assetName: asset.name,
    digest: String(asset.digest || ""),
    releaseUrl: String(release?.html_url || "")
  };
}

export async function listPaperLibraryZipEntries(plugin, zipPath) {
  if (process.platform === "win32") {
    const script = "[IO.Compression.ZipFile]::OpenRead($args[0]).Entries | ForEach-Object { $_.FullName }";
    const result = await plugin.runDesktopProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, zipPath], { timeout: 60 * 1000 });
    return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  }
  const result = await plugin.runDesktopProcess("unzip", ["-Z1", zipPath], { timeout: 60 * 1000 });
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

export async function extractPaperLibraryUpdate(plugin, zipPath, destination) {
  if (process.platform === "win32") {
    const script = "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force";
    await plugin.runDesktopProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, zipPath, destination], { timeout: 2 * 60 * 1000 });
    return;
  }
  await plugin.runDesktopProcess("unzip", ["-q", zipPath, "-d", destination], { timeout: 2 * 60 * 1000 });
}

export async function collectPaperLibraryUpdateFiles(plugin, root) {
  const fs = require("node:fs");
  const nodePath = require("node:path");
  const files = [];
  const walk = async (directory, relativeDirectory = "") => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("安装包包含不允许的符号链接");
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = nodePath.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath, relativePath);
      else if (entry.isFile() && isPaperLibraryReleaseFile(relativePath)) files.push(relativePath);
    }
  };
  await walk(root);
  return files;
}

export async function installPaperLibraryUpdate(plugin, update, onProgress = () => {}) {
  if (plugin.isMobileApp()) throw new Error("自动更新仅支持桌面端 Obsidian");
  if (plugin.paperLibraryUpdatePromise) return plugin.paperLibraryUpdatePromise;
  plugin.paperLibraryUpdatePromise = (async () => {
    const fs = require("node:fs");
    const nodePath = require("node:path");
    const os = require("node:os");
    const crypto = require("node:crypto");
    const currentVersion = plugin.manifest?.version || "0.0.0";
    if (!update?.assetUrl || comparePaperLibraryVersions(update.version, currentVersion) <= 0) {
      throw new Error("没有可安装的新版本");
    }
    onProgress(`正在下载 ${update.version}…`);
    const response = await requestUrl({
      url: update.assetUrl,
      method: "GET",
      headers: { Accept: "application/octet-stream" },
      throw: false
    });
    if (response.status >= 400 || !response.arrayBuffer) throw new Error(`安装包下载失败（HTTP ${response.status || "未知"}）`);
    const archive = Buffer.from(response.arrayBuffer);
    if (update.digest?.startsWith("sha256:")) {
      const digest = `sha256:${crypto.createHash("sha256").update(archive).digest("hex")}`;
      if (digest !== update.digest.toLocaleLowerCase()) throw new Error("安装包完整性校验失败");
    }
    const temporaryRoot = await fs.promises.mkdtemp(nodePath.join(os.tmpdir(), "paper-library-update-"));
    const archivePath = nodePath.join(temporaryRoot, update.assetName || "paper-library.zip");
    const extractionPath = nodePath.join(temporaryRoot, "extracted");
    const backupPath = nodePath.join(temporaryRoot, "backup");
    const applied = [];
    try {
      await fs.promises.writeFile(archivePath, archive);
      const entries = await plugin.listPaperLibraryZipEntries(archivePath);
      if (!entries.length || entries.some((entry) => !isSafePaperLibraryZipEntry(entry))) {
        throw new Error("安装包路径校验失败");
      }
      const manifests = entries.filter((entry) => /(^|\/)manifest\.json$/.test(entry));
      if (manifests.length !== 1) throw new Error("安装包目录结构无效");
      await fs.promises.mkdir(extractionPath, { recursive: true });
      await plugin.extractPaperLibraryUpdate(archivePath, extractionPath);
      const packageDirectory = nodePath.join(extractionPath, nodePath.dirname(manifests[0]));
      const manifest = JSON.parse(await fs.promises.readFile(nodePath.join(packageDirectory, "manifest.json"), "utf8"));
      if (manifest.id !== plugin.manifest.id) throw new Error("安装包不属于 Paper Library");
      if (normalizePaperLibraryReleaseVersion(manifest.version) !== normalizePaperLibraryReleaseVersion(update.version)) {
        throw new Error("安装包版本与发布版本不一致");
      }
      const files = await plugin.collectPaperLibraryUpdateFiles(packageDirectory);
      const missing = PAPER_LIBRARY_UPDATE_REQUIRED_FILES.filter((file) => !files.includes(file));
      if (missing.length) throw new Error(`安装包缺少运行文件：${missing.join("、")}`);
      const pluginDirectory = plugin.getDesktopPluginPath();
      await fs.promises.mkdir(backupPath, { recursive: true });
      onProgress(`正在安装 ${update.version}…`);
      const orderedFiles = files.sort((left, right) => {
        const priority = (file) => file === "manifest.json" ? 3 : file === "main.js" ? 2 : file === "styles.css" ? 1 : 0;
        return priority(left) - priority(right) || left.localeCompare(right);
      });
      for (const relativePath of orderedFiles) {
        const source = nodePath.join(packageDirectory, relativePath);
        const destination = nodePath.join(pluginDirectory, relativePath);
        const backup = nodePath.join(backupPath, relativePath);
        const existed = fs.existsSync(destination);
        if (existed) {
          const stat = await fs.promises.lstat(destination);
          if (!stat.isFile()) throw new Error(`无法替换非文件路径：${relativePath}`);
          await fs.promises.mkdir(nodePath.dirname(backup), { recursive: true });
          await fs.promises.copyFile(destination, backup);
        }
        await fs.promises.mkdir(nodePath.dirname(destination), { recursive: true });
        const pending = `${destination}.paper-library-update`;
        await fs.promises.copyFile(source, pending);
        try {
          await fs.promises.rename(pending, destination);
        } catch (error) {
          if (!existed || !["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
          await fs.promises.copyFile(pending, destination);
          await fs.promises.rm(pending, { force: true });
        }
        applied.push({ relativePath, destination, backup, existed });
      }
      onProgress(`已更新到 ${update.version}，正在重新加载插件…`);
    } catch (error) {
      for (const file of applied.reverse()) {
        try {
          if (file.existed) await fs.promises.copyFile(file.backup, file.destination);
          else await fs.promises.rm(file.destination, { force: true });
        } catch (_) {}
      }
      throw error;
    } finally {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    }
    const app = plugin.app;
    const pluginId = plugin.manifest.id;
    new Notice(`Paper Library 已更新到 ${update.version}`);
    window.setTimeout(async () => {
      try {
        await app.plugins.disablePlugin(pluginId);
        await app.plugins.enablePlugin(pluginId);
        new Notice("Paper Library 已重新加载");
      } catch (error) {
        console.error("Paper Library: automatic reload failed", error);
        new Notice("更新已安装，请重启 Obsidian 以载入新版本", 8000);
      }
    }, 400);
  })();
  try {
    return await plugin.paperLibraryUpdatePromise;
  } finally {
    plugin.paperLibraryUpdatePromise = null;
  }
}
