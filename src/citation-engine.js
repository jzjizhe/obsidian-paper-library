/* 引用模板引擎：把论文元数据渲染成各期刊格式的引文。
   模板语法见 renderCitationTemplate 上方注释；输出已与 Scholar Sidekick 在线 API 逐条比对校准。
   本模块不依赖 Obsidian，可在 Node 中直接 import 进行单元测试。 */

// 引用样式 = 模板（占位符 + 字面符号 + 可选段）+ 作者规则。
// 模板语法见 renderCitationTemplate 上方注释；输出已与 Scholar Sidekick 在线 API 逐条比对校准。
const CITATION_STYLE_AUTHOR_DEFAULTS = {
  order: "family",          // family（姓在前）| given（名在前）| first-family（仅首作者姓在前）
  initials: "spaced-dot",   // spaced-dot: F. P. | compact-dot: F.P. | plain: FP | full: 不缩写
  familyComma: true,        // 姓与名缩写之间是否加逗号（"Aspelmeyer, M." vs "Aspelmeyer M"）
  delimiter: ", ",          // 作者之间的分隔符
  lastDelimiter: "",        // 最后一位作者前的连接（空 = 用 delimiter）
  etAlMin: 0,               // 作者数 >= etAlMin 时启用省略（0 = 不省略）
  etAlShow: 1,              // 省略时保留前几位
  etAlTerm: "et al.",
  etAlLast: false,          // APA 风格：前 N 位 … 最后一位
  etAlDelimiter: ""         // 与 et al. 之间的分隔（空 = show==1 用空格，否则用 delimiter）
};

const CITATION_STYLES = [
  {
    id: "apa-7", label: "APA 7th edition",
    template: "{authors} ({year}). {title:sentence}.[ *{venue}*, {volume}][({issue})][, {pages}].[ https://doi.org/{doi}]",
    authors: { order: "family", initials: "spaced-dot", familyComma: true, delimiter: ", ", lastDelimiter: ", & ", etAlMin: 21, etAlShow: 19, etAlTerm: "…", etAlLast: true }
  },
  {
    id: "ieee", label: "IEEE",
    template: "{authors}, \"{title}\"[, {venue:abbr}][, vol. {volume}][, no. {issue}][, pp. {pages}][, {year}][. doi: {doi}].",
    authors: { order: "given", initials: "spaced-dot", delimiter: ", ", etAlMin: 2, etAlShow: 1, etAlTerm: "et al.", etAlDelimiter: ", " }
  },
  {
    id: "vancouver", label: "Vancouver",
    template: "{authors}. {title}.[ {venue:abbr}.][ {year}][;{volume}][({issue})][:{pages:raw}].[ doi:{doi}].",
    authors: { order: "family", initials: "plain", familyComma: false, delimiter: ", ", etAlMin: 7, etAlShow: 6, etAlTerm: "et al.", etAlDelimiter: ", " }
  },
  {
    id: "ama", label: "AMA 11th edition",
    template: "{authors}. {title}.[ {venue:abbr}.][ {year}][;{volume}][({issue})][:{pages:raw}].[ doi:{doi}].",
    authors: { order: "family", initials: "plain", familyComma: false, delimiter: ", ", etAlMin: 4, etAlShow: 3, etAlTerm: "et al.", etAlDelimiter: ", " }
  },
  {
    id: "nature", label: "Nature",
    template: "[{number}. ]{authors}. {title}.[ *{venue:abbr}*][ **{volume}**][, {pages}][!volume,pages: {url}][ ({year})].",
    authors: { order: "family", initials: "spaced-dot", familyComma: true, delimiter: ", ", lastDelimiter: " & ", etAlMin: 6, etAlShow: 1, etAlTerm: "et al.", etAlDelimiter: " " }
  },
  {
    id: "science", label: "Science",
    template: "[{number}. ]{authors}, [!venue:“{title}” ({year}); {url}][+venue:{title}.[ *{venue:abbr}* {volume}][, {pages}][ ({year})]].",
    authors: { order: "given", initials: "spaced-dot", delimiter: ", " }
  },
  {
    id: "cell", label: "Cell",
    template: "[{number}. ]{authors}[ ({year})]. {title}.[ *{venue:abbr}* {volume}][, {pages}][+venue:. {url}].",
    authors: { order: "family", initials: "compact-dot", familyComma: true, delimiter: ", ", lastDelimiter: ", and ", etAlMin: 11, etAlShow: 10, etAlTerm: "et al.", etAlDelimiter: ", " }
  },
  {
    id: "american-chemical-society", label: "ACS",
    template: "[({number}) ]{authors}. {title:title}[!venue:; {year}].[+venue: {venue:abbr} {year}][, **{volume}**][ ({issue})][, {pages}][. {url}].",
    authors: { order: "family", initials: "spaced-dot", familyComma: true, delimiter: "; " }
  },
  {
    id: "chicago-author-date", label: "Chicago author-date",
    template: "{authors}. {year}. [+venue:“{title:title}.”][!venue:{title}.][ *{venue}* {volume}][ ({issue})][: {pages:short}][. {url}].",
    authors: { order: "first-family", initials: "full", familyComma: true, delimiter: ", ", lastDelimiter: ", and ", etAlMin: 4, etAlShow: 3, etAlTerm: "et al.", etAlDelimiter: ", " }
  },
  {
    id: "mla-9", label: "MLA 9th edition",
    template: "{authors}. [+venue:“{title:title}.”][!venue:{title:title}.][ *{venue}*[, vol. {volume}][, no. {issue}]][+venue:, {year}][!venue: {year}][+venue:, pp. {pages:short}][, {url}].",
    authors: { order: "first-family", initials: "full", familyComma: true, delimiter: ", ", etAlMin: 3, etAlShow: 1, etAlTerm: "et al.", etAlDelimiter: ", " }
  },
  {
    id: "harvard", label: "Harvard (Cite Them Right)",
    template: "{authors} ({year}) [+venue:“{title},”][!venue:{title}.][ *{venue}*[, {volume}][({issue})][, pp. {pages}]].[ Available at: {url}].",
    authors: { order: "family", initials: "spaced-dot", familyComma: true, delimiter: ", ", lastDelimiter: " and ", etAlMin: 4, etAlShow: 1, etAlTerm: "et al.", etAlDelimiter: " " }
  }
];

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line = "") {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else value += character;
  }
  cells.push(value);
  return cells;
}

function normalizeVenueLookup(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/^\s*(?:19|20)\d{2}\s+/u, "")
    .replace(/&/g, " and ")
    .replace(/\bthe\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function normalizeConferenceVenueLookup(value = "") {
  const tokens = normalizeVenueLookup(value).split(/\s+/).filter(Boolean);
  const noise = new Set([
    "proceedings", "proceeding", "annual",
    "acm", "ieee", "usenix", "association",
    "the", "of"
  ]);
  return tokens
    .filter((token) => !noise.has(token))
    .filter((token) => !/^\d+(?:st|nd|rd|th)?$/i.test(token))
    .join(" ")
    .trim();
}

function citationFamilyName(name) {
  const value = String(name || "").trim();
  if (!value) return "anonymous";
  if (value.includes(",")) return value.split(",")[0].trim();
  return value.split(/\s+/).pop() || value;
}

function citationInitials(value) {
  return String(value || "").split(/[\s-]+/).filter(Boolean).map((part) => `${part[0]?.toLocaleUpperCase() || ""}.`).join(" ");
}

function formatApaAuthor(name) {
  const value = String(name || "").trim();
  if (!value) return "";
  if (isLikelyChinesePersonalName(value)) return value;
  if (value.includes(",")) {
    const [family, ...given] = value.split(",");
    return `${family.trim()}, ${citationInitials(given.join(" ").trim())}`.trim();
  }
  const parts = value.split(/\s+/);
  const family = parts.pop() || value;
  return `${family}, ${citationInitials(parts.join(" "))}`.trim();
}

function joinCitationAuthors(authors, style = "apa-7") {
  const values = (authors || []).filter(Boolean);
  if (!values.length) return "Anonymous";
  if (style === "ieee" || style === "vancouver") {
    return values.map((name) => {
      const family = citationFamilyName(name);
      const given = String(name).includes(",") ? String(name).split(",").slice(1).join(" ") : String(name).split(/\s+/).slice(0, -1).join(" ");
      return `${citationInitials(given).replace(/\s/g, "")} ${family}`.trim();
    }).join(", ");
  }
  const formatted = values.map(formatApaAuthor);
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, & ${formatted.at(-1)}`;
}

/* ==================== 引用样式模板引擎 ====================
   模板 DSL：
     {token} {token:modifier}
       token:    authors year title venue volume issue pages doi url number
       modifier: title → title（标题式大写）/ sentence（句式大写）
                 venue → abbr（期刊缩写，缺省回退全名）
                 pages → raw（原样连字符）/ short（芝加哥式短页码 610–18）
     斜体 *...*、粗体 **...**（纯文本输出时自动去除标记）
     [ ... ]        可选段：内部至少一个 token 非空才输出，可嵌套
     [+a,b: ... ]   条件段：a 和 b 全都非空才输出
     [!a,b: ... ]   条件段：a 和 b 全都为空才输出（用于 arXiv 等回退分支）
     \[ \] \{ \}    转义字面符号
*/

const CITATION_TITLE_SMALL_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "as", "at", "by", "in", "of", "on", "per", "to", "up", "via", "vs", "with", "from", "into", "onto", "over"
]);

const CITATION_TEMPLATE_TOKENS = ["authors", "year", "title", "venue", "volume", "issue", "pages", "doi", "url", "number"];

function citationTitleCase(value) {
  const words = String(value || "").split(" ");
  const lastIndex = words.length - 1;
  return words.map((word, index) => {
    if (!word) return word;
    if (index !== 0 && index !== lastIndex && CITATION_TITLE_SMALL_WORDS.has(word.toLocaleLowerCase())) {
      return word.toLocaleLowerCase();
    }
    return word.split("-").map((part) => (part ? part[0].toLocaleUpperCase() + part.slice(1) : part)).join("-");
  }).join(" ");
}

function citationSentenceCase(value) {
  const text = String(value || "").trim();
  if (!text) return text;
  const lower = text.toLocaleLowerCase();
  return lower[0].toLocaleUpperCase() + lower.slice(1);
}

function citationPageRange(value, mode = "dash") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (mode === "raw") return text;
  const match = text.match(/^(.+?)[-–—](.+)$/);
  if (!match) return text;
  const first = match[1].trim();
  let last = match[2].trim();
  if (mode === "short" && /^\d+$/.test(first) && /^\d+$/.test(last)
    && first.length >= 3 && last.length === first.length && !/0{2}$/.test(first)) {
    const prefixLength = first.length - 2;
    if (first.slice(0, prefixLength) === last.slice(0, prefixLength)) last = last.slice(prefixLength);
  }
  return `${first}–${last}`;
}

function normalizeCitationAuthorRules(partial) {
  return { ...CITATION_STYLE_AUTHOR_DEFAULTS, ...(partial || {}) };
}

function isLikelyChinesePersonalName(value) {
  const name = String(value || "").replace(/[\s\d*＊†‡¹²³⁴⁵⁶⁷⁸⁹⁰]+/gu, "").trim();
  return /^[\p{Script=Han}·•]{2,10}$/u.test(name)
    && !/(?:大学|学院|学校|医院|研究院|研究所|实验室|中心|公司|学报|编辑部)/u.test(name);
}

function parseCitationName(name) {
  const value = String(name || "").trim();
  if (!value) return null;
  if (isLikelyChinesePersonalName(value)) return { literal: value };
  if (value.includes(",")) {
    const [family, ...rest] = value.split(",");
    return { family: family.trim(), given: rest.join(",").trim() };
  }
  const parts = value.split(/\s+/);
  const family = parts.pop() || value;
  return { family, given: parts.join(" ") };
}

function citationGivenName(given, mode) {
  const text = String(given || "").trim();
  if (!text) return "";
  if (mode === "full") return text;
  const words = text.split(/\s+/).filter(Boolean).map((word) => (
    word.split("-").map((part) => (part ? part[0].toLocaleUpperCase() : "")).join("-")
  ));
  if (mode === "plain") return words.join("");
  if (mode === "compact-dot") return words.map((word) => `${word}.`).join("");
  return words.map((word) => `${word}.`).join(" ");
}

function formatCitationName(parsed, rules, isFirst) {
  if (parsed.literal) return parsed.literal;
  const family = parsed.family || "";
  const given = citationGivenName(parsed.given, rules.initials);
  const order = rules.order === "first-family" ? (isFirst ? "family" : "given") : rules.order;
  if (order === "given") return `${given} ${family}`.trim();
  if (!given) return family;
  return `${family}${rules.familyComma ? ", " : " "}${given}`.trim();
}

function formatCitationAuthors(authors, rulesPartial) {
  const rules = normalizeCitationAuthorRules(rulesPartial);
  const parsed = (authors || []).map(parseCitationName).filter(Boolean);
  if (!parsed.length) return "Anonymous";
  const useEtAl = rules.etAlMin > 0 && parsed.length >= rules.etAlMin;
  if (useEtAl && rules.etAlLast) {
    const head = parsed.slice(0, rules.etAlShow).map((person, index) => formatCitationName(person, rules, index === 0));
    const last = formatCitationName(parsed.at(-1), rules, false);
    return `${head.join(rules.delimiter)}${rules.delimiter}${rules.etAlTerm}${rules.delimiter}${last}`;
  }
  const shown = useEtAl ? parsed.slice(0, rules.etAlShow) : parsed;
  const formatted = shown.map((person, index) => formatCitationName(person, rules, index === 0));
  let output;
  if (formatted.length === 1) output = formatted[0];
  else if (useEtAl) output = formatted.join(rules.delimiter);
  else {
    const joiner = rules.lastDelimiter || rules.delimiter;
    output = `${formatted.slice(0, -1).join(rules.delimiter)}${joiner}${formatted.at(-1)}`;
  }
  if (useEtAl) {
    const separator = rules.etAlDelimiter || (rules.etAlShow === 1 ? " " : rules.delimiter);
    output += `${separator}${rules.etAlTerm}`;
  }
  return output;
}

function parseCitationTemplate(template) {
  const source = String(template || "");
  let index = 0;
  const parseUntil = (closing) => {
    const nodes = [];
    let buffer = "";
    const flush = () => {
      if (buffer) nodes.push({ t: "text", v: buffer });
      buffer = "";
    };
    while (index < source.length) {
      const char = source[index];
      if (char === "\\" && "{}[]".includes(source[index + 1] || "")) {
        buffer += source[index + 1];
        index += 2;
        continue;
      }
      if (char === "{") {
        const end = source.indexOf("}", index);
        if (end === -1) { buffer += char; index += 1; continue; }
        const inner = source.slice(index + 1, end).trim();
        const match = inner.match(/^([a-zA-Z]+)(?::([a-z-]+))?$/);
        if (match) {
          flush();
          nodes.push({ t: "token", name: match[1].toLocaleLowerCase(), mod: match[2] || "" });
        } else buffer += source.slice(index, end + 1);
        index = end + 1;
        continue;
      }
      if (char === "[") {
        flush();
        index += 1;
        const header = source.slice(index).match(/^([!+])\s*([a-zA-Z]+(?:\s*,\s*[a-zA-Z]+)*)\s*:/);
        let mode = "any";
        let conds = [];
        if (header) {
          mode = header[1] === "+" ? "all" : "none";
          conds = header[2].split(",").map((item) => item.trim().toLocaleLowerCase());
          index += header[0].length;
        }
        nodes.push({ t: "group", mode, conds, children: parseUntil("]") });
        continue;
      }
      if (char === "]" && closing === "]") {
        flush();
        index += 1;
        return nodes;
      }
      buffer += char;
      index += 1;
    }
    flush();
    return nodes;
  };
  return parseUntil("");
}

function resolveCitationToken(name, mod, bag, rules) {
  switch (name) {
    case "authors": return formatCitationAuthors(bag.authors, rules);
    case "year": return bag.year;
    case "title":
      if (mod === "title") return citationTitleCase(bag.title);
      if (mod === "sentence") return citationSentenceCase(bag.title);
      return bag.title;
    case "venue": return mod === "abbr" ? (bag.venueAbbr || bag.venue) : bag.venue;
    case "volume": return bag.volume;
    case "issue": return bag.issue;
    case "pages": return citationPageRange(bag.pages, mod === "raw" ? "raw" : mod === "short" ? "short" : "dash");
    case "doi": return bag.doi;
    case "url": return bag.url;
    case "number": return bag.number;
    default: return "";
  }
}

function renderCitationNodes(nodes, bag, rules) {
  let text = "";
  let hasValue = false;
  for (const node of nodes) {
    if (node.t === "text") text += node.v;
    else if (node.t === "token") {
      const value = resolveCitationToken(node.name, node.mod, bag, rules);
      text += value;
      if (value) hasValue = true;
    } else if (node.t === "group") {
      const inner = renderCitationNodes(node.children, bag, rules);
      let include;
      if (node.mode === "all") include = node.conds.every((name) => resolveCitationToken(name, "", bag, rules));
      else if (node.mode === "none") include = node.conds.every((name) => !resolveCitationToken(name, "", bag, rules));
      else include = inner.hasValue;
      if (include) {
        text += inner.text;
        if (inner.hasValue) hasValue = true;
      }
    }
  }
  return { text, hasValue };
}

function citationStripEmphasis(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function citationEmphasisToHtml(text) {
  return xmlEscape(String(text || ""))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function cleanupCitationText(text) {
  return String(text || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?\)\]])/g, "$1")
    .replace(/([\(\[])[ \t]+/g, "$1")
    .replace(/\.\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+\n/g, "\n")
    .replace(/^[\s.,;:]+/, "")
    .trim();
}

function renderCitationTemplate(style, bag, options = {}) {
  const rules = normalizeCitationAuthorRules(style?.authors);
  const nodes = parseCitationTemplate(style?.template || "");
  const rendered = renderCitationNodes(nodes, bag, rules).text;
  const withMarkup = options.mode === "html" ? citationEmphasisToHtml(rendered) : citationStripEmphasis(rendered);
  return cleanupCitationText(withMarkup);
}

function citationFieldBag(paper) {
  // 引用中的 DOI 保留原始大小写（如 10.1056/NEJMoa2033700），仅去掉前缀
  const doi = String(paper?.doi || "").trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
  return {
    authors: [...(paper?.authors || [])],
    year: paper?.year ? String(paper.year) : "n.d.",
    title: String(paper?.title || "Untitled paper").replace(/\s+/g, " ").trim(),
    venue: String(paper?.venue || "").trim(),
    venueAbbr: String(paper?.journalAbbreviation || "").trim(),
    volume: String(paper?.volume || "").trim(),
    issue: String(paper?.issue || "").trim(),
    pages: String(paper?.pages || "").trim(),
    doi,
    url: doi ? `https://doi.org/${doi}` : (paper?.arxiv ? `https://arxiv.org/abs/${paper.arxiv}` : ""),
    number: String(paper?.citationNumber || "")
  };
}

function validateCitationTemplate(template) {
  const problems = [];
  const nodes = parseCitationTemplate(template);
  const visit = (list) => {
    list.forEach((node) => {
      if (node.t === "token" && !CITATION_TEMPLATE_TOKENS.includes(node.name)) {
        problems.push(`未知占位符 {${node.name}}`);
      } else if (node.t === "group") {
        node.conds.forEach((name) => {
          if (!CITATION_TEMPLATE_TOKENS.includes(name)) problems.push(`未知条件字段 ${name}`);
        });
        visit(node.children);
      }
    });
  };
  visit(nodes);
  let depth = 0;
  for (const char of String(template || "")) {
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (depth < 0) { problems.push("括号不匹配：多余的 ]"); break; }
  }
  if (depth > 0) problems.push("括号不匹配：缺少 ]");
  return problems;
}

/* ---------- CSL XML → 本地模板（在线导入用，按 article-journal 路径近似） ---------- */

function parseXmlDocument(xml) {
  const source = String(xml || "")
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");
  let index = 0;
  const decode = (value) => value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const parseAttrs = (text) => {
    const attrs = {};
    const pattern = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = pattern.exec(text))) attrs[match[1]] = decode(match[2]);
    return attrs;
  };
  const parseNodes = () => {
    const nodes = [];
    let buffer = "";
    while (index < source.length) {
      if (source[index] === "<") {
        if (source.startsWith("</", index)) {
          const end = source.indexOf(">", index);
          if (buffer.trim()) nodes.push({ tag: "#text", text: decode(buffer) });
          const closing = source.slice(index + 2, end).trim();
          index = end + 1;
          return { nodes, closing };
        }
        const end = source.indexOf(">", index);
        if (end === -1) break;
        const raw = source.slice(index + 1, end);
        const selfClosing = raw.endsWith("/");
        const tagName = raw.match(/^([\w:-]+)/)?.[1] || "";
        if (buffer.trim()) nodes.push({ tag: "#text", text: decode(buffer) });
        buffer = "";
        const node = { tag: tagName, attrs: parseAttrs(raw), children: [] };
        index = end + 1;
        if (!selfClosing) {
          const result = parseNodes();
          node.children = result.nodes;
        }
        nodes.push(node);
        continue;
      }
      buffer += source[index];
      index += 1;
    }
    if (buffer.trim()) nodes.push({ tag: "#text", text: decode(buffer) });
    return { nodes, closing: "" };
  };
  return parseNodes().nodes;
}

function xmlChildren(node, tag) {
  return (node?.children || []).filter((child) => child.tag === tag);
}

function xmlChild(node, tag) {
  return xmlChildren(node, tag)[0] || null;
}

function xmlText(node) {
  return (node?.children || []).filter((child) => child.tag === "#text").map((child) => child.text).join("").trim();
}

const CSL_VARIABLE_TOKEN_MAP = {
  title: "title",
  "container-title": "venue",
  volume: "volume",
  issue: "issue",
  page: "pages",
  DOI: "doi",
  URL: "url",
  "citation-number": "number"
};

function cslTypeMatches(attrs, target) {
  const types = String(attrs?.type || "").split(/\s+/).filter(Boolean);
  if (!types.length) return null;
  return types.includes(target) || (target === "article-journal" && types.includes("article"));
}

function cslNodeToTemplate(node, macros, state, depth = 0) {
  if (!node || depth > 12) return "";
  if (node.tag === "#text") return "";
  const prefix = node.attrs?.prefix || "";
  const suffix = node.attrs?.suffix || "";
  const wrap = (content) => {
    if (!content) return "";
    let out = content;
    if (node.attrs?.["font-style"] === "italic") out = `*${out}*`;
    if (node.attrs?.["font-weight"] === "bold") out = `**${out}**`;
    return `${prefix}${out}${suffix}`;
  };
  if (node.tag === "text" && node.attrs?.macro) {
    const macro = macros[node.attrs.macro];
    if (!macro) return "";
    if (state.expanded.has(node.attrs.macro)) return "";
    state.expanded.add(node.attrs.macro);
    const inner = cslNodesToTemplate(macro.children, macros, state, depth + 1);
    state.expanded.delete(node.attrs.macro);
    return wrap(inner);
  }
  if (node.tag === "text" && node.attrs?.variable) {
    const variable = node.attrs.variable;
    let token = CSL_VARIABLE_TOKEN_MAP[variable];
    if (!token) {
      if (variable === "publisher" || variable === "publisher-place") return "";
      state.warnings.push(`未支持的字段 ${variable}，已忽略`);
      return "";
    }
    let mod = "";
    if (variable === "container-title" && node.attrs.form === "short") mod = "abbr";
    if (variable === "title" && node.attrs["text-case"] === "title") mod = "title";
    return wrap(`{${token}${mod ? `:${mod}` : ""}}`);
  }
  if (node.tag === "text" && node.attrs?.term) {
    // 词条（in / et-al 等）在 journal-article 路径中基本不出现；保守忽略
    return "";
  }
  if (node.tag === "text" && node.attrs?.value) {
    return wrap(node.attrs.value.replace(/[[\]{}\\]/g, (char) => `\\${char}`));
  }
  if (node.tag === "date") {
    // 只取年份；含月日的完整日期属于二期
    return wrap("{year}");
  }
  if (node.tag === "names") {
    const variable = node.attrs?.variable || "";
    const substituteHasAuthor = xmlChildren(node, "substitute")
      .some((sub) => xmlChildren(sub, "names").some((item) => item.attrs?.variable === "author"));
    if (variable !== "author" && !substituteHasAuthor) return "";
    const nameNode = xmlChild(node, "name");
    if (nameNode && !state.authorRules) state.authorRules = cslExtractAuthorRules(nameNode, state.bibliographyAttrs);
    return wrap("{authors}");
  }
  if (node.tag === "group") {
    const parts = (node.children || []).map((child) => cslNodeToTemplate(child, macros, state, depth + 1)).filter(Boolean);
    if (!parts.length) return "";
    const delimiter = node.attrs?.delimiter || "";
    const inner = `[${parts[0]}]${parts.slice(1).map((part) => `[${delimiter}${part}]`).join("")}`;
    return wrap(inner);
  }
  if (node.tag === "choose") {
    const branches = xmlChildren(node, "if").concat(xmlChildren(node, "else-if"));
    const elseBranch = xmlChild(node, "else");
    for (const branch of branches) {
      const matchNone = String(branch.attrs?.match || "") === "none";
      const hasTypeCondition = Boolean(branch.attrs?.type);
      const hasVariableCondition = Boolean(branch.attrs?.variable || branch.attrs?.["is-numeric"]);
      if (hasTypeCondition) {
        const typeMatch = cslTypeMatches(branch.attrs, "article-journal");
        // match="none" 时类型命中反而表示不适用
        const applies = matchNone ? typeMatch === false : typeMatch === true;
        if (!applies) continue;
        const inner = cslNodesToTemplate(branch.children, macros, state, depth + 1);
        if (hasVariableCondition) return inner ? `[${inner}]` : "";
        return inner;
      }
      if (hasVariableCondition) {
        // 纯变量条件：<if variable="DOI"> 近似为可选段。
        // match="none"：若条件涉及我们有的字段（volume/page 等）则无法表达、跳过；
        // 若只涉及我们没有的冷门字段（part-number 等），视为条件成立、直接输出。
        if (matchNone) {
          const vars = String(branch.attrs?.variable || "").split(/\s+/).filter(Boolean);
          if (vars.some((name) => CSL_VARIABLE_TOKEN_MAP[name])) continue;
          return cslNodesToTemplate(branch.children, macros, state, depth + 1);
        }
        const inner = cslNodesToTemplate(branch.children, macros, state, depth + 1);
        return inner ? `[${inner}]` : "";
      }
    }
    return elseBranch ? cslNodesToTemplate(elseBranch.children, macros, state, depth + 1) : "";
  }
  if (node.tag === "label") return "";
  return cslNodesToTemplate(node.children, macros, state, depth + 1);
}

function cslNodesToTemplate(nodes, macros, state, depth = 0) {
  return (nodes || []).map((node) => cslNodeToTemplate(node, macros, state, depth)).join("");
}

function cslExtractAuthorRules(nameNode, bibliographyAttrs = {}) {
  const attrs = nameNode?.attrs || {};
  const rules = {};
  if (attrs["name-as-sort-order"] === "all") {
    rules.order = "family";
    rules.familyComma = (attrs["sort-separator"] || ",").includes(",");
  } else rules.order = "given";
  if (attrs["initialize-with"] === ". ") rules.initials = "spaced-dot";
  else if (attrs["initialize-with"] === ".") rules.initials = "compact-dot";
  else if (attrs["initialize-with"] === "") rules.initials = "plain";
  else if (attrs.initialize === "false") rules.initials = "full";
  else rules.initials = "spaced-dot"; // CSL 默认 initialize="true"
  if (attrs.delimiter) rules.delimiter = attrs.delimiter;
  if (attrs.and) {
    const term = attrs.and === "symbol" ? "&" : "and";
    rules.lastDelimiter = attrs["delimiter-precedes-last"] === "always"
      ? `${(rules.delimiter || ", ").trimEnd()} ${term} `
      : ` ${term} `;
  }
  const etAlMin = Number(bibliographyAttrs["et-al-min"] || attrs["et-al-min"] || 0);
  const etAlShow = Number(bibliographyAttrs["et-al-use-first"] || attrs["et-al-use-first"] || 1);
  if (etAlMin > 0) {
    rules.etAlMin = etAlMin;
    rules.etAlShow = etAlShow;
    rules.etAlTerm = "et al.";
  }
  return rules;
}

function parseCslStyleToTemplate(xmlSource, styleId = "") {
  const roots = parseXmlDocument(xmlSource);
  const style = roots.find((node) => node.tag === "style");
  if (!style) throw new Error("不是有效的 CSL 样式文件");
  const info = xmlChild(style, "info");
  const title = xmlText(xmlChild(info, "title")) || styleId;
  const bibliography = xmlChild(style, "bibliography");
  if (!bibliography) {
    const link = xmlChildren(info, "link").find((item) => (
      item.attrs?.rel === "template" || item.attrs?.rel === "independent-parent"
    ));
    const parent = String(link?.attrs?.href || "")
      .match(/\/([^/?#]+?)(?:\.csl)?(?:[?#].*)?$/)?.[1] || "";
    return { dependent: true, parent, label: title };
  }
  const macros = {};
  xmlChildren(style, "macro").forEach((macro) => { macros[macro.attrs?.name || ""] = macro; });
  const layout = xmlChild(bibliography, "layout");
  if (!layout) throw new Error("CSL 样式缺少 bibliography/layout");
  const state = { warnings: [], expanded: new Set(), authorRules: null, bibliographyAttrs: bibliography.attrs || {} };
  let template = cslNodesToTemplate(layout.children, macros, state);
  template += layout.attrs?.suffix || "";
  if (!state.authorRules) {
    // author 宏可能藏在 choose 分支里，全局再找一次
    const findNames = (node) => {
      if (!node) return null;
      if (node.tag === "names" && node.attrs?.variable === "author") return node;
      for (const child of node.children || []) {
        const found = findNames(child);
        if (found) return found;
      }
      return null;
    };
    const names = findNames(bibliography) || Object.values(macros).map(findNames).find(Boolean);
    const nameNode = names ? xmlChild(names, "name") : null;
    if (nameNode) state.authorRules = cslExtractAuthorRules(nameNode, bibliography.attrs || {});
  }
  return {
    dependent: false,
    label: title,
    template,
    authors: state.authorRules || {},
    warnings: [...new Set(state.warnings)]
  };
}

/* 对外接口：CITATION_STYLES 驱动设置页与渲染入口；xmlEscape/csvEscape/parseCsvLine
   与 normalizeVenueLookup 系列同时服务于导出与会议排名匹配。 */
export {
  CITATION_STYLES,
  citationFieldBag,
  citationFamilyName,
  csvEscape,
  formatCitationAuthors,
  isLikelyChinesePersonalName,
  normalizeCitationAuthorRules,
  normalizeConferenceVenueLookup,
  normalizeVenueLookup,
  parseCslStyleToTemplate,
  parseCsvLine,
  renderCitationTemplate,
  validateCitationTemplate,
  xmlEscape
};
