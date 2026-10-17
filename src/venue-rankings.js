/* 期刊/会议排名：内置排名规则表（CCF/CORE/TH-CPL 等）、外部数据源地址，
   以及从自由文本推断正式发表 venue 的启发式逻辑。纯数据与纯函数，不依赖 Obsidian。 */

import { stripMarkup } from "./text-utils.js";

const SHOW_JCR = {
  year: 2025,
  url: "https://raw.githubusercontent.com/hitfyd/ShowJCR/refs/heads/master/%E4%B8%AD%E7%A7%91%E9%99%A2%E5%88%86%E5%8C%BA%E8%A1%A8%E5%8F%8AJCR%E5%8E%9F%E5%A7%8B%E6%95%B0%E6%8D%AE%E6%96%87%E4%BB%B6/JCR2025-UTF8.csv"
};
const CCFDDL_ACCEPTANCE_BASE_URL = "https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/accept_rates";
const CCFDDL_CONFERENCE_DATABASE_URL = "https://ccfddl.github.io/conference/allconf.yml";
const CS_CONF_STATS_URL = "https://raw.githubusercontent.com/Xovee/cs-conf-stats/main/data/conf.json";
const CONFERENCE_RATE_DATABASE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const CONFERENCE_RANKING_DATABASE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const VENUE_RANKING_RULES = [
  {
    kind: "conference", shortName: "OSDI", fullName: "USENIX Symposium on Operating Systems Design and Implementation",
    acceptancePath: "SE/osdi.yml",
    patterns: [/\bosdi(?:\s*[’'-]?\s*\d{2,4})?\b/i, /operating systems design and implementation/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "EuroSys", fullName: "European Conference on Computer Systems",
    acceptancePath: "DS/eurosys.yml", acceptanceSeries: "EuroSys",
    patterns: [
      /\beurosys(?:\s*[’'-]?\s*\d{2,4})?\b/i,
      /european conference on computer systems/i
    ],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "HPCA", fullName: "IEEE International Symposium on High Performance Computer Architecture",
    acceptancePath: "DS/hpca.yml",
    patterns: [/\bhpca\b/i, /high performance computer architecture/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "ASPLOS", fullName: "International Conference on Architectural Support for Programming Languages and Operating Systems",
    acceptancePath: "DS/asplos.yml",
    patterns: [/\basplos\b/i, /architectural support for programming languages and operating systems/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "ISCA", fullName: "International Symposium on Computer Architecture",
    acceptancePath: "DS/isca.yml",
    patterns: [/\bisca\b/i, /international symposium on computer architecture/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "MICRO", fullName: "IEEE/ACM International Symposium on Microarchitecture",
    acceptancePath: "DS/micro.yml",
    patterns: [/\bmicro\b/i, /international symposium on microarchitecture/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "PPoPP", fullName: "ACM SIGPLAN Symposium on Principles and Practice of Parallel Programming",
    acceptancePath: "DS/ppopp.yml",
    patterns: [/\bppopp\b/i, /principles (?:and|&) practice of parallel programming/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "B" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "DAC", fullName: "ACM/IEEE Design Automation Conference",
    acceptanceSeries: "DAC",
    patterns: [/\bdac(?:\s*[’'-]?\s*\d{2,4})?\b/i, /design automation conference/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "NeurIPS", fullName: "Conference on Neural Information Processing Systems",
    acceptancePath: "AI/nips.yml",
    patterns: [/\bneurips\b/i, /\bnips\b/i, /neural information processing systems/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "AAAI", fullName: "AAAI Conference on Artificial Intelligence",
    acceptancePath: "AI/aaai.yml",
    patterns: [/\baaai\b/i, /aaai conference on artificial intelligence/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "CVPR", fullName: "IEEE/CVF Conference on Computer Vision and Pattern Recognition",
    acceptancePath: "AI/cvpr.yml",
    patterns: [/\bcvpr\b/i, /computer vision and pattern recognition/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "ICCV", fullName: "IEEE International Conference on Computer Vision",
    acceptancePath: "AI/iccv.yml",
    patterns: [/\biccv\b/i, /international conference on computer vision/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "ICML", fullName: "International Conference on Machine Learning",
    acceptancePath: "AI/icml.yml",
    patterns: [/\bicml\b/i, /international conference on machine learning/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "ICLR", fullName: "International Conference on Learning Representations",
    acceptancePath: "AI/iclr.yml",
    patterns: [/\biclr\b/i, /international conference on learning representations/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "MLSys", fullName: "Conference on Machine Learning and Systems",
    patterns: [/\bmlsys\b/i, /(?:conference on |proceedings of )?machine learning and systems/i],
    ranks: [
      { system: "CCF", rank: "N" },
      { system: "CORE", rank: "N" },
      { system: "TH-CPL", rank: "N" }
    ]
  },
  {
    kind: "conference", shortName: "IJCAI", fullName: "International Joint Conference on Artificial Intelligence",
    acceptancePath: "AI/ijcai.yml",
    patterns: [/\bijcai\b/i, /international joint conference on artificial intelligence/i],
    ranks: [
      { system: "CCF", rank: "B" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "B" }
    ]
  },
  {
    kind: "conference", shortName: "ACL", fullName: "Annual Meeting of the Association for Computational Linguistics",
    acceptancePath: "AI/acl.yml",
    patterns: [/\bacl\b/i, /annual meeting of the association for computational linguistics/i],
    ranks: [
      { system: "CCF", rank: "A" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "ECCV", fullName: "European Conference on Computer Vision",
    acceptancePath: "AI/eccv.yml",
    patterns: [/\beccv\b/i, /european conference on computer vision/i],
    ranks: [
      { system: "CCF", rank: "B" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "EMNLP", fullName: "Conference on Empirical Methods in Natural Language Processing",
    acceptancePath: "AI/emnlp.yml",
    patterns: [/\bemnlp\b/i, /empirical methods in natural language processing/i],
    ranks: [
      { system: "CCF", rank: "B" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "conference", shortName: "ICRA", fullName: "IEEE International Conference on Robotics and Automation",
    acceptancePath: "AI/icra.yml",
    patterns: [/\bicra\b/i, /international conference on robotics and automation/i],
    ranks: [
      { system: "CCF", rank: "B" },
      { system: "CORE", rank: "A*" },
      { system: "TH-CPL", rank: "A" }
    ]
  },
  {
    kind: "journal", shortName: "TPAMI", fullName: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
    patterns: [/\btpami\b/i, /transactions on pattern analysis and machine intelligence/i],
    ranks: [{ system: "CCF", rank: "A" }]
  },
  {
    kind: "journal", shortName: "IJCV", fullName: "International Journal of Computer Vision",
    patterns: [/\bijcv\b/i, /international journal of computer vision/i],
    ranks: [{ system: "CCF", rank: "A" }]
  },
  {
    kind: "journal", shortName: "JMLR", fullName: "Journal of Machine Learning Research",
    patterns: [/\bjmlr\b/i, /journal of machine learning research/i],
    ranks: [{ system: "CCF", rank: "A" }]
  }
];

// CCFDDL renamed the former USENIX ATC series to SIGOPS ATC in 2026. Keep
// historical publisher/acronym forms searchable so older papers still match
// the current online ranking record. Additional variants are derived from the
// online title, description, DBLP slug and conference IDs.
const CONFERENCE_RANKING_HISTORICAL_ALIASES = {
  "SIGOPS ATC": [
    "ATC",
    "USENIX ATC",
    "USENIX Annual Technical Conference",
    "USENIX Association Annual Technical Conference"
  ]
};

function findVenueRankingRule(value = "") {
  const text = stripMarkup(value);
  if (!text) return null;
  const normalizedPunctuation = text.replace(/[\u2010-\u2015-]+/g, " ").replace(/\s+/g, " ");
  return VENUE_RANKING_RULES.find((item) => item.patterns.some((pattern) => (
    pattern.test(text) || (normalizedPunctuation !== text && pattern.test(normalizedPunctuation))
  ))) || null;
}

function inferFormalVenueFromText(value = "") {
  const text = stripMarkup(value);
  if (!text) return { venue: "", year: 0, publicationType: "" };
  const rule = findVenueRankingRule(text);
  if (!rule) return { venue: "", year: 0, publicationType: "" };
  const fullYear = text.match(/\b((?:19|20)\d{2})\b/)?.[1];
  const shortYear = text.match(/[’'](\d{2})\b/)?.[1];
  const year = Number(fullYear || (shortYear ? `20${shortYear}` : 0)) || 0;
  return {
    venue: rule.shortName,
    year,
    publicationType: rule.kind === "conference" ? "conference-paper" : "journal-article"
  };
}

function inferScholarPublication(summary = "", link = "") {
  const source = stripMarkup(`${summary} ${link}`);
  const known = inferFormalVenueFromText(source);
  if (known.venue) return known;
  const parts = stripMarkup(summary).split(/\s+-\s+/).map((value) => value.trim()).filter(Boolean);
  let venue = parts.length >= 2 ? parts[1] : "";
  const year = Number(source.match(/\b((?:19|20)\d{2})\b/)?.[1]) || 0;
  venue = venue
    .replace(/^\s*(?:19|20)\d{2}\s+/, "")
    .replace(/\s*,?\s*(?:vol\.?\s*\d+[^,]*,?\s*)?(?:19|20)\d{2}\b.*$/i, "")
    .replace(/\s*,?\s*\d+\s*\([^)]*\)\s*[:,]?\s*\d+(?:\s*[–-]\s*\d+)?\s*$/i, "")
    .trim();
  if (!venue || venue.length < 3 || venue.length > 180 || isRepositoryVenue(venue)) {
    return { venue: "", year, publicationType: "" };
  }
  return {
    venue,
    year,
    publicationType: /\b(?:conference|proceedings|symposium|workshop)\b/i.test(venue)
      ? "conference-paper"
      : "journal-article"
  };
}

function isRepositoryVenue(value) {
  const venue = String(value || "").trim();
  return !venue
    || /^arxiv\b/i.test(venue)
    || /^corr\b/i.test(venue)
    || /^(?:bio|med|chem)rxiv\b/i.test(venue)
    || /^shenzhen medical academy of research and translation$/i.test(venue);
}

/* 对外接口：排名规则匹配、venue 推断与数据源常量；VENUE_RANKING_RULES 与
   inferFormalVenueFromText 仅供本模块内部使用。 */
export {
  CCFDDL_ACCEPTANCE_BASE_URL,
  CCFDDL_CONFERENCE_DATABASE_URL,
  CONFERENCE_RANKING_DATABASE_MAX_AGE,
  CONFERENCE_RANKING_HISTORICAL_ALIASES,
  CONFERENCE_RATE_DATABASE_MAX_AGE,
  CS_CONF_STATS_URL,
  SHOW_JCR,
  findVenueRankingRule,
  inferScholarPublication,
  isRepositoryVenue
};
