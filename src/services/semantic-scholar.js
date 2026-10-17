/* Semantic Scholar 元数据服务：请求、重试、缓存（别名索引 + 容量上限）、
   字段映射与兜底合并。方法体从插件主类搬出，this 改为首个参数 plugin。 */

import { requestUrl } from "obsidian";
import { stripMarkup } from "../text-utils.js";
import { arxivIdFromDoi, isPlausiblePaperYear, normalizeArxivId, normalizeDoiInput, normalizePaperTags, yearFromArxivId } from "../paper-utils.js";
import {
  TITLE_MATCH_THRESHOLD,
  authorListSimilarity,
  displayPublicationType,
  hasFormalPublicationVenue,
  isTitleSufficientForLookup,
  normalizeTitleForMatch,
  publicationTypeContext,
  titleSimilarity
} from "../metadata-match.js";
import { findVenueRankingRule, isRepositoryVenue } from "../venue-rankings.js";

const SEMANTIC_SCHOLAR_PAPER_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const SEMANTIC_SCHOLAR_PAPER_CACHE_MAX_ENTRIES = 250;

export function mergeSemanticScholarFallback(plugin, local, primary, semantic) {
  if (!semantic) return primary;
  const base = plugin.mergePaperMetadata(local, primary);
  const baseAuthors = Array.isArray(base.authors) ? base.authors.filter(Boolean) : [];
  const authorsIncomplete = !baseAuthors.length
    || baseAuthors.some((author) => /…|\.\.\.$/.test(String(author).trim()));
  const baseYear = Number(base.year) || 0;
  const semanticVenueIsFormal = hasFormalPublicationVenue({ venue: semantic.venue });
  const baseVenueIsFormal = hasFormalPublicationVenue(base);
  return {
    ...base,
    source: primary?.source ? `${primary.source} + Semantic Scholar` : "Semantic Scholar",
    title: isTitleSufficientForLookup(base.title || "") ? base.title : (semantic.title || base.title),
    authors: authorsIncomplete && (semantic.authors || []).length ? semantic.authors : baseAuthors,
    year: isPlausiblePaperYear(baseYear, base.arxiv || semantic.arxiv)
      ? baseYear
      : (Number(semantic.year) || yearFromArxivId(base.arxiv || semantic.arxiv) || baseYear),
    venue: baseVenueIsFormal
      ? base.venue
      : (semanticVenueIsFormal ? semantic.venue : (base.venue || semantic.venue || "")),
    abstract: semantic.abstract || base.abstract || "",
    tags: normalizePaperTags([...(base.tags || []), ...(semantic.tags || [])]).slice(0, 12),
    doi: normalizeDoiInput(base.doi || semantic.doi || ""),
    arxiv: base.arxiv || semantic.arxiv || "",
    publicationType: primary?.publicationType || semantic.publicationType || "",
    paperId: semantic.paperId || primary?.paperId || ""
  };
}

export function useSemanticScholar(plugin) {
  return plugin.settings.metadataSource === "semantic-scholar" || plugin.useSerpApiAsPrimary();
}

export function semanticScholarSearchQuery(plugin, value) {
  return stripMarkup(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function semanticScholarErrorStatus(plugin, error) {
  const explicit = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0) || 0;
  if (explicit) return explicit;
  const message = String(error?.message || error || "");
  return Number(message.match(/(?:request failed[,;:]?\s*)?status\s*[:=]?\s*(\d{3})/i)?.[1]
    || message.match(/\bHTTP\s+(\d{3})\b/i)?.[1]
    || 0);
}

export function semanticScholarRetryDelay(plugin, error, attempt) {
  const headers = error?.headers || error?.response?.headers || {};
  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(60_000, seconds * 1000 + 250);
  return Math.min(15_000, 2500 * (2 ** attempt));
}

export function semanticScholarDelay(plugin, milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function semanticScholarVenue(plugin, paper) {
  return stripMarkup(paper?.publicationVenue?.name || paper?.journal?.name || paper?.venue || "");
}

export function semanticScholarPaperAliasKeys(plugin, { paperId = "", doi = "", arxiv = "", title = "" } = {}) {
  const keys = [];
  const normalizedDoi = normalizeDoiInput(doi);
  const normalizedArxiv = normalizeArxivId(arxiv || arxivIdFromDoi(doi));
  const normalizedTitle = normalizeTitleForMatch(title);
  if (paperId) keys.push(`paper:${String(paperId).trim()}`);
  if (normalizedDoi) keys.push(`doi:${normalizedDoi}`);
  if (normalizedArxiv) keys.push(`arxiv:${normalizedArxiv.toLocaleLowerCase()}`);
  if (normalizedTitle) keys.push(`title:${normalizedTitle}`);
  return [...new Set(keys)];
}

export function getCachedSemanticScholarPaper(plugin, lookup = {}, allowStale = false) {
  const cache = plugin.settings.semanticScholarPaperCache || {};
  const papers = cache.papers || {};
  const aliases = cache.aliases || {};
  for (const key of plugin.semanticScholarPaperAliasKeys(lookup)) {
    const paperId = aliases[key] || (key.startsWith("paper:") ? key.slice(6) : "");
    const entry = paperId ? papers[paperId] : null;
    if (!entry?.paper) continue;
    const age = Date.now() - (Date.parse(entry.updatedAt || "") || 0);
    if (allowStale || age <= SEMANTIC_SCHOLAR_PAPER_CACHE_MAX_AGE) return entry.paper;
  }
  return null;
}

export function scheduleSemanticScholarCacheSave(plugin) {
  if (plugin.semanticScholarCacheSaveTimer) return;
  const schedule = typeof window !== "undefined" ? window.setTimeout.bind(window) : setTimeout;
  plugin.semanticScholarCacheSaveTimer = schedule(() => {
    plugin.semanticScholarCacheSaveTimer = null;
    void plugin.saveSettings();
  }, 750);
}

export function cacheSemanticScholarPaper(plugin, paper, lookup = {}) {
  const paperId = String(paper?.paperId || lookup.paperId || "").trim();
  if (!paperId || !paper?.title) return paper;
  plugin.settings.semanticScholarPaperCache ||= { papers: {}, aliases: {} };
  const cache = plugin.settings.semanticScholarPaperCache;
  cache.papers ||= {};
  cache.aliases ||= {};
  cache.papers[paperId] = { updatedAt: new Date().toISOString(), paper };
  const external = paper.externalIds || {};
  // Keep aliases for both the identifier used by the caller and the
  // identifiers returned by Semantic Scholar. A formally published paper
  // can be looked up with its publisher DOI while Semantic Scholar's record
  // is keyed by the arXiv DOI; dropping the caller DOI here caused the same
  // paper to be resolved repeatedly and made throttling much more likely.
  const aliasLookups = [
    {
      paperId,
      doi: external.DOI || "",
      arxiv: external.ArXiv || "",
      title: paper.title || ""
    },
    {
      paperId: lookup.paperId || "",
      doi: lookup.doi || "",
      arxiv: lookup.arxiv || "",
      title: lookup.title || ""
    },
    external.CorpusId ? { paperId: `CorpusId:${external.CorpusId}` } : null
  ].filter(Boolean);
  aliasLookups.flatMap((entry) => plugin.semanticScholarPaperAliasKeys(entry))
    .forEach((key) => { cache.aliases[key] = paperId; });
  const ordered = Object.entries(cache.papers)
    .sort((left, right) => Date.parse(right[1]?.updatedAt || "") - Date.parse(left[1]?.updatedAt || ""));
  const retainedIds = new Set(ordered.slice(0, SEMANTIC_SCHOLAR_PAPER_CACHE_MAX_ENTRIES).map(([id]) => id));
  ordered.slice(SEMANTIC_SCHOLAR_PAPER_CACHE_MAX_ENTRIES).forEach(([id]) => { delete cache.papers[id]; });
  Object.keys(cache.aliases).forEach((key) => {
    if (!retainedIds.has(cache.aliases[key])) delete cache.aliases[key];
  });
  plugin.scheduleSemanticScholarCacheSave();
  return paper;
}

export function mapSemanticScholarPaper(plugin, paper, fallback = {}) {
  if (!paper) return null;
  const external = paper.externalIds || {};
  const arxiv = String(external.ArXiv || fallback.arxiv || "");
  const venue = plugin.semanticScholarVenue(paper);
  const types = (Array.isArray(paper.publicationTypes) ? paper.publicationTypes : [])
    .map((value) => String(value || "").toLocaleLowerCase());
  const venueRule = findVenueRankingRule(venue);
  const isConferenceVenue = venueRule?.kind === "conference"
    || /conference|proceedings|symposium|workshop/i.test(venue);
  const isJournalVenue = venueRule?.kind === "journal";
  const isPreprint = (!venue || isRepositoryVenue(venue) || types.includes("preprint"))
    && !isConferenceVenue && !isJournalVenue;
  return {
    source: "Semantic Scholar",
    title: stripMarkup(paper.title || ""),
    authors: (paper.authors || []).map((author) => stripMarkup(author?.name || "")).filter(Boolean),
    year: Number(paper.year) || Number(fallback.year) || 0,
    venue: venue || (arxiv ? "arXiv" : ""),
    volume: String(paper.journal?.volume || ""),
    pages: String(paper.journal?.pages || ""),
    journalAbbreviation: "",
    abstract: stripMarkup(paper.abstract || fallback.abstract || ""),
    tags: normalizePaperTags(paper.fieldsOfStudy || []).slice(0, 10),
    doi: normalizeDoiInput(external.DOI || fallback.doi || ""),
    arxiv,
    publicationType: isPreprint
      ? "preprint"
      : isConferenceVenue || types.includes("conference")
        ? "conference-paper"
        : isJournalVenue || types.includes("journalarticle")
          ? "journal-article"
          : "published-paper",
    paperId: paper.paperId || ""
  };
}

export function createSemanticScholarMetrics(plugin, s2, paper) {
  const external = s2?.externalIds || {};
  const doi = normalizeDoiInput(external.DOI || "");
  const venue = plugin.semanticScholarVenue(s2);
  const useLocalPublication = (!venue || isRepositoryVenue(venue)) && hasFormalPublicationVenue(paper);
  const semanticTypes = (Array.isArray(s2?.publicationTypes) ? s2.publicationTypes : [])
    .map((value) => String(value || "").toLocaleLowerCase());
  const semanticType = semanticTypes.includes("conference")
    ? "conference-paper"
    : semanticTypes.includes("journalarticle")
      ? "journal-article"
      : semanticTypes.includes("book") || semanticTypes.includes("booksection")
        ? "book"
        : semanticTypes.includes("preprint")
          ? "preprint"
          : "";
  const remoteType = semanticType || (venue && !isRepositoryVenue(venue) ? "journal-article" : "preprint");
  return {
    status: "ready",
    citations: Number(s2?.citationCount ?? 0),
    references: Number(s2?.referenceCount ?? 0),
    publishedYear: useLocalPublication ? (paper.year || 0) : (Number(s2?.year) || paper.year || 0),
    type: displayPublicationType(
      publicationTypeContext(paper, useLocalPublication ? paper.venue : venue),
      useLocalPublication ? "" : remoteType
    ),
    publisher: useLocalPublication ? paper.venue : (venue || (paper.arxiv ? "arXiv" : "")),
    matchedTitle: stripMarkup(s2?.title || paper.title),
    indexedAt: "",
    source: "Semantic Scholar",
    sourceUrl: s2?.paperId ? `https://www.semanticscholar.org/paper/${s2.paperId}` : (doi ? `https://doi.org/${doi}` : ""),
    updatedAt: new Date().toISOString()
  };
}

export function mapSemanticScholarRelationItem(plugin, paper) {
  const external = paper?.externalIds || {};
  const doi = normalizeDoiInput(external.DOI || "");
  return {
    id: paper?.paperId || "",
    title: stripMarkup(paper?.title || ""),
    year: Number(paper?.year) || 0,
    authors: (paper?.authors || []).map((author) => stripMarkup(author?.name || "")).filter(Boolean),
    venue: plugin.semanticScholarVenue(paper),
    doi,
    url: doi ? `https://doi.org/${doi}` : (paper?.paperId ? `https://www.semanticscholar.org/paper/${paper.paperId}` : "")
  };
}

export function prefetchSemanticScholarRelationCache(plugin, paper, relationRoot) {
  if (!paper || !relationRoot || relationRoot.status !== "ready") return null;
  plugin.semanticRelationPrefetches ||= new Map();
  if (plugin.semanticRelationPrefetches.has(paper.id)) {
    return plugin.semanticRelationPrefetches.get(paper.id);
  }
  const semanticPaperId = relationRoot.semanticScholarPaperId || relationRoot.workId;
  if (!semanticPaperId) return null;
  const candidates = ["citedBy", "references"].filter((type) => {
    const relation = relationRoot[type];
    if (!relation || relation.allLoaded || relation.loadFailed || relation.unavailableReason) return false;
    if (relation.provider !== "semantic-scholar" && relationRoot.provider !== "semantic-scholar") return false;
    const target = Math.min(plugin.getPaperRelationDisplayCap(), plugin.paperRelationPaginationTotal(relation));
    return relation.items.length < target;
  });
  if (!candidates.length) return null;

  const task = Promise.resolve().then(async () => {
    for (const type of candidates) {
      const relation = relationRoot[type];
      const key = `${paper.id}:${type}`;
      if (!relation || relation.allLoaded || plugin.relationLoading.has(key)) continue;
      plugin.relationLoading.add(key);
      plugin.refreshDetailViews();
      try {
        const endpoint = type === "citedBy" ? "citations" : "references";
        const target = Math.min(plugin.getPaperRelationDisplayCap(), plugin.paperRelationPaginationTotal(relation));
        while (relation.items.length < target && !relation.allLoaded) {
          const offset = Number.isInteger(relation.nextOffset) ? relation.nextOffset : relation.items.length;
          const previousLength = relation.items.length;
          const page = await plugin.fetchSemanticScholarRelationPage(semanticPaperId, endpoint, offset, 100);
          plugin.updateRelationFromPage(relation, page);
          plugin.reconcilePaperRelationTotals(paper, relationRoot);
          relationRoot.updatedAt = new Date().toISOString();
          // Persist each completed page. If a later request is throttled, all
          // earlier pages remain available after an Obsidian restart.
          await plugin.persistPaperRelations(paper, relationRoot);
          if (relation.items.length === previousLength
            && (!Number.isInteger(page.nextOffset) || page.nextOffset === offset)) {
            relation.allLoaded = true;
          }
        }
      } catch (error) {
        console.warn(`Paper Library: Semantic Scholar ${type} cache prefetch unavailable`, error);
      } finally {
        plugin.relationLoading.delete(key);
        plugin.refreshDetailViews();
      }
    }
  }).finally(() => plugin.semanticRelationPrefetches.delete(paper.id));
  plugin.semanticRelationPrefetches.set(paper.id, task);
  return task;
}

export async function requestSemanticScholar(plugin, path, params = {}, options = {}) {
  const execute = async () => {
    const query = new URLSearchParams(params).toString();
    const apiKey = plugin.settings.semanticScholarApiKey?.trim();
    const headers = { Accept: "application/json", "User-Agent": "Obsidian-Paper-Library/0.29.6" };
    if (apiKey) headers["x-api-key"] = apiKey;
    let lastError = null;
    const maxAttempts = Math.max(1, Math.min(5, Number(options.maxAttempts) || 5));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const minimumInterval = apiKey ? 1500 : 1750;
      const elapsed = Date.now() - Number(plugin.semanticScholarLastRequestAt || 0);
      if (elapsed < minimumInterval) {
        await plugin.semanticScholarDelay(minimumInterval - elapsed);
      }
      plugin.semanticScholarLastRequestAt = Date.now();
      try {
        const response = await requestUrl({
          url: `https://api.semanticscholar.org/graph/v1${path}${query ? `?${query}` : ""}`,
          method: "GET",
          headers
        });
        return response.json;
      } catch (error) {
        lastError = error;
        const status = plugin.semanticScholarErrorStatus(error);
        const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (!retryable || attempt >= maxAttempts - 1) throw error;
        const backoff = status === 429
          ? plugin.semanticScholarRetryDelay(error, attempt)
          : Math.min(8000, 1000 * (attempt + 1));
        await plugin.semanticScholarDelay(backoff);
      }
    }
    throw lastError || new Error("Semantic Scholar request failed");
  };
  const previous = plugin.semanticScholarRequestQueue || Promise.resolve();
  const current = previous.catch(() => undefined).then(execute);
  plugin.semanticScholarRequestQueue = current.then(() => undefined, () => undefined);
  return current;
}

export async function resolveSemanticScholarPaper(plugin, lookup = {}) {
  const cached = lookup.force ? null : plugin.getCachedSemanticScholarPaper(lookup);
  if (cached && (!lookup.requireAbstract || String(cached.abstract || "").trim())) return cached;
  plugin.semanticScholarPaperLookups ||= new Map();
  const lookupKey = plugin.semanticScholarPaperAliasKeys(lookup)[0]
    || `search:${normalizeTitleForMatch(lookup.title || "")}`;
  if (plugin.semanticScholarPaperLookups.has(lookupKey)) return plugin.semanticScholarPaperLookups.get(lookupKey);
  const pending = plugin.resolveSemanticScholarPaperUncached(lookup).catch((error) => {
    const stale = plugin.getCachedSemanticScholarPaper(lookup, true);
    if (stale && plugin.semanticScholarErrorStatus(error) === 429
      && (!lookup.requireAbstract || String(stale.abstract || "").trim())) return stale;
    throw error;
  });
  plugin.semanticScholarPaperLookups.set(lookupKey, pending);
  try { return await pending; }
  finally { plugin.semanticScholarPaperLookups.delete(lookupKey); }
}

export async function resolveSemanticScholarPaperUncached(plugin, { paperId = "", doi = "", arxiv = "", title = "", year = 0, authors = [], requireAbstract = false, titleMatchOnly = false }) {
  const fields = "title,abstract,authors,year,venue,publicationVenue,journal,externalIds,citationCount,referenceCount,fieldsOfStudy,publicationTypes,publicationDate";
  const normalizedDoi = normalizeDoiInput(doi);
  const normalizedArxiv = normalizeArxivId(arxiv || arxivIdFromDoi(normalizedDoi));
  const identifiers = [];
  if (paperId) identifiers.push(String(paperId).trim());
  if (normalizedDoi) identifiers.push(`DOI:${normalizedDoi}`);
  if (normalizedArxiv) identifiers.push(`ARXIV:${normalizedArxiv}`);
  let identifierPaperWithoutAbstract = null;
  for (const identifier of [...new Set(identifiers)]) {
    try {
      const paper = await plugin.requestSemanticScholar(`/paper/${encodeURIComponent(identifier)}`, { fields });
      plugin.cacheSemanticScholarPaper(paper, { paperId, doi, arxiv, title });
      if (!requireAbstract || String(paper?.abstract || "").trim()) return paper;
      identifierPaperWithoutAbstract ||= paper;
    } catch (error) {
      if (error?.status !== 404 && error?.statusCode !== 404) throw error;
    }
  }
  if (!title) return identifierPaperWithoutAbstract;
  const searchQuery = plugin.semanticScholarSearchQuery(title);
  if (!searchQuery) return identifierPaperWithoutAbstract;

  // `/paper/search/match` is Semantic Scholar's single-paper title resolver.
  // The ordinary relevance search can return an empty result for an exact,
  // newly indexed title (while the paper is already visible on the website).
  // Prefer the match endpoint and still validate the returned title locally
  // before accepting it.
  try {
    const matchResponse = await plugin.requestSemanticScholar("/paper/search/match", {
      query: searchQuery,
      fields
    }, { maxAttempts: titleMatchOnly ? 1 : 5 });
    const candidates = Array.isArray(matchResponse?.data)
      ? matchResponse.data
      : (matchResponse?.paperId ? [matchResponse] : []);
    const matchedPaper = candidates[0] || null;
    if (matchedPaper) {
      const similarity = titleSimilarity(title, matchedPaper.title || "");
      const matchedAuthors = (matchedPaper.authors || [])
        .map((author) => author?.name || "")
        .filter(Boolean);
      const authorSimilarity = authorListSimilarity(authors, matchedAuthors);
      const yearDistance = year && matchedPaper.year
        ? Math.abs(Number(year) - Number(matchedPaper.year))
        : 0;
      const authorsCompatible = !authors?.length || !matchedAuthors.length || authorSimilarity >= 0.2;
      const yearCompatible = !year || !matchedPaper.year || yearDistance <= 2;
      if (similarity >= TITLE_MATCH_THRESHOLD && authorsCompatible && yearCompatible) {
        plugin.cacheSemanticScholarPaper(matchedPaper, { paperId, doi, arxiv, title });
        if (!requireAbstract || String(matchedPaper.abstract || "").trim()) return matchedPaper;
        identifierPaperWithoutAbstract ||= matchedPaper;
      }
    }
  } catch (error) {
    if (plugin.semanticScholarErrorStatus(error) !== 404) throw error;
  }

  // A title-only refresh should not immediately follow a failed exact match
  // with the heavily rate-limited relevance endpoint. SerpApi supplies the
  // validated fallback below; a later refresh probes the exact endpoint again.
  if (titleMatchOnly) return identifierPaperWithoutAbstract;

  // Keep relevance search as a compatibility fallback for older API
  // deployments and for cases where the match endpoint has no candidate.
  const response = await plugin.requestSemanticScholar("/paper/search", {
    query: searchQuery,
    limit: "10",
    fields
  });
  const match = (response?.data || [])
    .map((paper) => ({
      paper,
      similarity: titleSimilarity(title, paper.title || ""),
      authorSimilarity: authorListSimilarity(authors, (paper.authors || []).map((author) => author?.name || "").filter(Boolean)),
      yearDistance: year && paper.year ? Math.abs(Number(year) - Number(paper.year)) : 0,
      citations: Number(paper.citationCount) || 0
    }))
    .sort((left, right) => {
      if (Math.abs(left.similarity - right.similarity) > 0.025) return right.similarity - left.similarity;
      if (Math.abs(left.authorSimilarity - right.authorSimilarity) > 0.05) {
        return right.authorSimilarity - left.authorSimilarity;
      }
      return left.yearDistance - right.yearDistance || right.citations - left.citations;
    })[0];
  if (match?.similarity >= TITLE_MATCH_THRESHOLD) {
    plugin.cacheSemanticScholarPaper(match.paper, { paperId, doi, arxiv, title });
    if (!requireAbstract || String(match.paper?.abstract || "").trim()) return match.paper;
    identifierPaperWithoutAbstract ||= match.paper;
  }
  return identifierPaperWithoutAbstract;
}
