/* 元数据匹配：标题/作者相似度（Dice 系数 + CJK 处理）、Crossref venue 提取、
   发表类型推断、DOI/arXiv 归一化。纯函数，不依赖 Obsidian。 */

import { stripMarkup } from "./text-utils.js";
import { isLikelyChinesePersonalName } from "./citation-engine.js";
import { findVenueRankingRule, isRepositoryVenue } from "./venue-rankings.js";

function isPreprintLikeType(value) {
  return ["posted-content", "posted_content", "posted content", "preprint"].includes(
    String(value || "").toLocaleLowerCase()
  );
}

function isPreprintLikeCrossref(item) {
  return isPreprintLikeType(item?.type);
}

function hasFormalPublicationVenue(paper) {
  const venue = String(paper?.venue || "").trim();
  return Boolean(venue) && !isRepositoryVenue(venue);
}

function publicationTypeContext(paper, providerVenue = "") {
  const localVenue = String(paper?.venue || "").trim();
  const resolvedVenue = hasFormalPublicationVenue(paper)
    ? localVenue
    : (stripMarkup(providerVenue) || localVenue);
  return { ...(paper || {}), venue: resolvedVenue };
}

function displayPublicationType(paper, remoteType) {
  const normalizedType = String(remoteType || "").replace(/[-_]+/g, " ").trim();
  const venue = String(paper.venue || "");
  const venueRule = findVenueRankingRule(venue);
  const isKnownConference = venueRule?.kind === "conference"
    || paper?.venueRankingKind === "conference"
    || /conference|proceedings|symposium|workshop/i.test(venue);
  const isKnownJournal = venueRule?.kind === "journal"
    || (paper?.venueRanks || []).some((rank) => /^(?:JCR|中科院)$/i.test(String(rank?.system || "")));
  // A recognized venue is more reliable than broad publication types returned by
  // metadata providers. Semantic Scholar, for example, labels some MLSys and HPCA
  // records as JournalArticle even though their venue is an explicit conference.
  if (isKnownConference) return "conference paper";
  if (isKnownJournal) return "journal article";
  if (paper?.arxiv && isRepositoryVenue(venue)) return "preprint";
  if (!normalizedType) {
    if (hasFormalPublicationVenue(paper)) return "published paper";
    return paper?.arxiv ? "preprint" : "paper";
  }
  if (!isPreprintLikeType(remoteType) || !hasFormalPublicationVenue(paper)) return normalizedType;
  return "published paper";
}

function crossrefVenue(item) {
  const containerTitle = stripMarkup(item?.["container-title"]?.[0] || "");
  if (containerTitle) return containerTitle;
  // Crossref's publisher is the DOI registrant for posted content, not a journal
  // or conference. Showing it as the venue turns repository records into fake venues.
  return isPreprintLikeCrossref(item) ? "" : stripMarkup(item?.publisher || "");
}

function normalizeTitleForMatch(value) {
  return stripMarkup(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCjkText(value) {
  return /\p{Script=Han}/u.test(String(value || ""));
}

function compactTitleForCharacterMatch(value) {
  return normalizeTitleForMatch(value).replace(/\s+/g, "");
}

function sequenceDice(left, right, size = 2) {
  const createCounts = (value) => {
    const units = Array.from(value);
    const counts = new Map();
    if (units.length < size) return new Map([[value, 1]]);
    for (let index = 0; index <= units.length - size; index += 1) {
      const part = units.slice(index, index + size).join("");
      counts.set(part, (counts.get(part) || 0) + 1);
    }
    return counts;
  };
  const leftCounts = createCounts(left);
  const rightCounts = createCounts(right);
  const leftSize = [...leftCounts.values()].reduce((sum, count) => sum + count, 0);
  const rightSize = [...rightCounts.values()].reduce((sum, count) => sum + count, 0);
  if (!leftSize || !rightSize) return 0;
  let overlap = 0;
  leftCounts.forEach((count, part) => { overlap += Math.min(count, rightCounts.get(part) || 0); });
  return (2 * overlap) / (leftSize + rightSize);
}

function sequenceOrderScore(leftSequence, rightSequence) {
  const rows = Array.from({ length: leftSequence.length + 1 }, () => Array(rightSequence.length + 1).fill(0));
  for (let leftIndex = 1; leftIndex <= leftSequence.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= rightSequence.length; rightIndex += 1) {
      rows[leftIndex][rightIndex] = leftSequence[leftIndex - 1] === rightSequence[rightIndex - 1]
        ? rows[leftIndex - 1][rightIndex - 1] + 1
        : Math.max(rows[leftIndex - 1][rightIndex], rows[leftIndex][rightIndex - 1]);
    }
  }
  return rows[leftSequence.length][rightSequence.length] / Math.max(leftSequence.length, rightSequence.length, 1);
}

function titleSimilarity(left, right) {
  const normalizedLeft = normalizeTitleForMatch(left);
  const normalizedRight = normalizeTitleForMatch(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const usesCjk = hasCjkText(normalizedLeft) || hasCjkText(normalizedRight);
  let characterScore = 0;
  if (usesCjk) {
    const compactLeft = compactTitleForCharacterMatch(normalizedLeft);
    const compactRight = compactTitleForCharacterMatch(normalizedRight);
    if (compactLeft === compactRight) return 1;
    const characterOrder = sequenceOrderScore(Array.from(compactLeft), Array.from(compactRight));
    const bigramScore = sequenceDice(compactLeft, compactRight, 2);
    const shorter = Math.min(compactLeft.length, compactRight.length);
    const longer = Math.max(compactLeft.length, compactRight.length);
    const containment = shorter / Math.max(1, longer) >= 0.78
      && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))
      ? 0.82 + 0.18 * (shorter / longer)
      : 0;
    characterScore = Math.max(bigramScore, characterOrder * 0.98, containment);
  }
  const leftSequence = normalizedLeft.split(" ").filter((token) => token.length > 1);
  const rightSequence = normalizedRight.split(" ").filter((token) => token.length > 1);
  if (!leftSequence.length || !rightSequence.length) return 0;
  const leftTokens = new Set(leftSequence);
  const rightTokens = new Set(rightSequence);
  const common = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const tokenScore = (2 * common) / (leftTokens.size + rightTokens.size);
  const orderScore = sequenceOrderScore(leftSequence, rightSequence);
  const tokenSimilarity = tokenScore === 1 ? orderScore : orderScore * 0.75 + tokenScore * 0.25;
  return usesCjk ? Math.max(characterScore, tokenSimilarity) : tokenSimilarity;
}

function isTitleSufficientForLookup(value) {
  const normalized = normalizeTitleForMatch(value);
  if (!normalized) return false;
  const cjkCount = (normalized.match(/\p{Script=Han}/gu) || []).length;
  return cjkCount >= 5 || normalized.split(" ").length >= 4 || normalized.length >= 18;
}

function splitMetadataAuthors(value) {
  const source = stripMarkup(value).replace(/^\s*(?:作者|authors?)\s*[:：]\s*/i, "").trim();
  if (!source) return [];
  if (!hasCjkText(source)) {
    return source.split(/\s*;\s*|\s+\band\b\s+|\n+/i).map((name) => name.trim()).filter(Boolean);
  }
  const pieces = source
    .split(/\s*(?:[,，、;；]|\band\b|和|与)\s*|\n+/i)
    .flatMap((piece) => {
      const spaced = piece.trim().split(/\s+/).filter(Boolean);
      return spaced.length > 1 && spaced.every(isLikelyChinesePersonalName) ? spaced : [piece];
    })
    .map((name) => name
      .replace(/[（(][^()（）]{0,24}[)）]/g, "")
      .replace(/^[\s\d*＊†‡¹²³⁴⁵⁶⁷⁸⁹⁰]+|[\s\d*＊†‡¹²³⁴⁵⁶⁷⁸⁹⁰]+$/gu, "")
      .trim())
    .filter(isLikelyChinesePersonalName);
  return [...new Set(pieces)];
}

function formatCrossrefAuthor(author = {}) {
  const family = stripMarkup(author.family || "");
  const given = stripMarkup(author.given || "");
  if (family && given && hasCjkText(family) && hasCjkText(given)) return `${family}${given}`;
  return [family, given].filter(Boolean).join(", ") || stripMarkup(author.name || "");
}

function chooseMetadataAuthors(localAuthors = [], remoteAuthors = [], title = "") {
  const local = Array.isArray(localAuthors) ? localAuthors.filter(Boolean) : [];
  const remote = Array.isArray(remoteAuthors) ? remoteAuthors.filter(Boolean) : [];
  if (!hasCjkText(title)) return remote.length ? remote : local;
  const remoteHasChineseNames = remote.some(hasCjkText);
  const localHasChineseNames = local.some(hasCjkText);
  if (remoteHasChineseNames) return remote;
  if (localHasChineseNames) return local;
  return remote.length ? remote : local;
}

function authorListSimilarity(leftAuthors = [], rightAuthors = []) {
  const left = (Array.isArray(leftAuthors) ? leftAuthors : []).map((name) => String(name || "").trim()).filter(Boolean);
  const right = (Array.isArray(rightAuthors) ? rightAuthors : []).map((name) => String(name || "").trim()).filter(Boolean);
  if (!left.length || !right.length) return 0;
  const matches = left.map((name) => Math.max(...right.map((candidate) => titleSimilarity(name, candidate))));
  return matches.reduce((sum, score) => sum + score, 0) / matches.length;
}

function fileNameToTitle(fileName) {
  return String(fileName || "")
    .replace(/\.pdf$/i, "")
    .replace(/^\s*\d+[\s._-]+/, "")
    .replace(/(?:arxiv)?[_-]?\d{4}[._]\d{4,5}(?:v\d+)?/ig, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* compactTitleForCharacterMatch、sequenceDice、sequenceOrderScore 是
   titleSimilarity 的内部构件，不导出。 */
export {
  authorListSimilarity,
  chooseMetadataAuthors,
  crossrefVenue,
  displayPublicationType,
  fileNameToTitle,
  formatCrossrefAuthor,
  hasCjkText,
  hasFormalPublicationVenue,
  isPreprintLikeCrossref,
  isPreprintLikeType,
  isTitleSufficientForLookup,
  normalizeTitleForMatch,
  publicationTypeContext,
  splitMetadataAuthors,
  titleSimilarity
};
