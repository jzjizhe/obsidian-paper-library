/* 论文实体工具：id 生成、文件名安全化、标签归一化、DOI/arXiv 标识符解析。
   纯函数，不依赖 Obsidian。 */

import { stripMarkup } from "./text-utils.js";

function uniqueId() {
  return `paper-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function workspaceId(prefix = "node") {
  return `paperlib-${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeFileName(value) {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizePaperTag(value) {
  let tag = stripMarkup(value || "").normalize("NFKC").trim().replace(/^#+/, "");
  if (!tag) return "";
  tag = tag
    .replace(/[\s\u00a0]+/g, "-")
    .replace(/[^\p{L}\p{N}_/-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "");
  if (!tag || /^\d+(?:[-/]\d+)*$/.test(tag)) return "";
  return tag.slice(0, 100).replace(/[-/]+$/g, "");
}

function normalizePaperTags(values = []) {
  const source = Array.isArray(values) ? values : String(values || "").split(/[;,]/);
  const result = [];
  const seen = new Set();
  source.forEach((value) => {
    const tag = normalizePaperTag(value);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return;
    seen.add(key);
    result.push(tag);
  });
  return result;
}

function normalizeDoiInput(value) {
  return String(value || "")
    .trim()
    .replace(/^doi\s*:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[\s)>\].,;:]+$/g, "")
    .toLocaleLowerCase();
}

function arxivIdFromDoi(value) {
  return normalizeDoiInput(value).match(/^10\.48550\/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?$/i)?.[1] || "";
}

function normalizeArxivId(value) {
  const raw = String(value || "").trim().replace(/^arxiv\s*:\s*/i, "").replace(/v\d+$/i, "");
  const modern = raw.match(/^(\d{2})(\d{2})\.(\d{4,5})$/);
  if (modern) {
    const year = Number(modern[1]);
    const month = Number(modern[2]);
    const currentYear = new Date().getFullYear() % 100;
    return year >= 7 && year <= currentYear + 1 && month >= 1 && month <= 12 ? raw : "";
  }
  return /^[a-z][a-z0-9.-]*\/\d{7}$/i.test(raw) ? raw : "";
}

function yearFromArxivId(value) {
  const id = normalizeArxivId(value);
  const match = id.match(/^(\d{2})(\d{2})\./);
  if (!match) return 0;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? year : 0;
}

function isPlausiblePaperYear(value, arxiv = "") {
  const year = Number(value) || 0;
  if (year < 1800 || year > new Date().getFullYear() + 2) return false;
  const arxivYear = yearFromArxivId(arxiv);
  return !arxivYear || Math.abs(year - arxivYear) <= 10;
}

function isArxivDoi(value) {
  return Boolean(arxivIdFromDoi(value));
}

export {
  arxivIdFromDoi,
  isArxivDoi,
  isPlausiblePaperYear,
  normalizeArxivId,
  normalizeDoiInput,
  normalizePaperTag,
  normalizePaperTags,
  safeFileName,
  uniqueId,
  workspaceId,
  yearFromArxivId
};
