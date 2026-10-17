/* 收藏夹路径工具：层级路径的归一化、包含判断与展开。纯函数，不依赖 Obsidian。 */

import { safeFileName } from "./paper-utils.js";

function normalizeCollectionPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function collectionPathContains(parent, candidate) {
  const normalizedParent = normalizeCollectionPath(parent);
  const normalizedCandidate = normalizeCollectionPath(candidate);
  return Boolean(normalizedParent && normalizedCandidate
    && (normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`)));
}

function collectionParentPath(value) {
  const parts = normalizeCollectionPath(value).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function collectionBaseName(value) {
  return normalizeCollectionPath(value).split("/").filter(Boolean).pop() || "";
}

function expandCollectionPaths(values) {
  const paths = new Set();
  (values || []).forEach((value) => {
    const parts = normalizeCollectionPath(value).split("/").filter(Boolean);
    parts.forEach((_part, index) => paths.add(parts.slice(0, index + 1).join("/")));
  });
  return [...paths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function safeCollectionPath(value) {
  return normalizeCollectionPath(value)
    .split("/")
    .map((segment) => safeFileName(segment))
    .filter(Boolean)
    .join("/");
}

export {
  collectionBaseName,
  collectionParentPath,
  collectionPathContains,
  expandCollectionPaths,
  normalizeCollectionPath,
  safeCollectionPath
};
