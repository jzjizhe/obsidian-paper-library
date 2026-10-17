/* 通用文本工具：不依赖 Obsidian，可在 Node 中直接 import。 */

function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLocaleLowerCase() === "x";
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entities[entity.toLocaleLowerCase()] ?? match;
  });
}

function stripMarkup(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function markdownText(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function truncate(text, length = 58) {
  if (!text) return "—";
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function formatAIFileSize(bytes = 0) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function formatAIRemainingTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  if (seconds < 5) return "即将完成";
  if (seconds < 60) return `约 ${seconds} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `约 ${hours} 小时 ${remainder} 分钟` : `约 ${hours} 小时`;
}

export { decodeEntities, formatAIFileSize, formatAIRemainingTime, markdownText, stripMarkup, truncate };
