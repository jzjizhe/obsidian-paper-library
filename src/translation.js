import { requestUrl } from "obsidian";
import { TRANSLATION_PROVIDERS, TRANSLATION_TARGETS } from "./constants.js";
import { decodeEntities } from "./text-utils.js";

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const BAIDU_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";
const DEEPL_PRO_ENDPOINT = "https://api.deepl.com/v2/translate";

function md5Hex(input) {
  const bytes = new TextEncoder().encode(String(input));
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 0x100000000), true);

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0);
  const rotateLeft = (value, count) => ((value << count) | (value >>> (32 - count))) | 0;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Int32Array(16);
    for (let index = 0; index < 16; index += 1) words[index] = view.getInt32(offset + index * 4, true);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    for (let index = 0; index < 64; index += 1) {
      let f;
      let g;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      const nextD = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + constants[index] + words[g]) | 0, shifts[index])) | 0;
      a = nextD;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
  }

  const wordHex = (value) => [0, 8, 16, 24]
    .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, "0"))
    .join("");
  return `${wordHex(h0)}${wordHex(h1)}${wordHex(h2)}${wordHex(h3)}`.toLowerCase();
}

function textByteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function chunkText(text, maxBytes = 450) {
  const source = String(text || "").trim();
  if (!source) return [];
  if (textByteLength(source) <= maxBytes) return [source];
  const parts = source.split(/(?<=[.!?。！？])\s+|\n+/).filter((part) => part.trim());
  const chunks = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const part of parts) {
    const candidate = current ? `${current} ${part}` : part;
    if (textByteLength(candidate) <= maxBytes) {
      current = candidate;
      continue;
    }
    push();
    if (textByteLength(part) <= maxBytes) {
      current = part;
      continue;
    }
    let buffer = "";
    Array.from(part).forEach((char) => {
      if (textByteLength(buffer + char) > maxBytes && buffer) {
        chunks.push(buffer);
        buffer = char;
      } else {
        buffer += char;
      }
    });
    current = buffer;
  }
  push();
  return chunks;
}

function getProvider(plugin) {
  const id = String(plugin?.settings?.translationProvider || "mymemory");
  return TRANSLATION_PROVIDERS.find((provider) => provider.id === id) || TRANSLATION_PROVIDERS[0];
}

function getTarget(plugin) {
  const id = String(plugin?.settings?.translationTargetLanguage || "zh-CN");
  return TRANSLATION_TARGETS.find((target) => target.id === id) || TRANSLATION_TARGETS[0];
}

function translationProviderLabel(plugin) {
  return getProvider(plugin).label;
}

function translationTargetLabel(plugin) {
  return getTarget(plugin).label;
}

async function requestJson(options) {
  const response = await requestUrl({ ...options, throw: false });
  const json = response?.json || (response?.text ? JSON.parse(response.text) : {});
  if (response.status >= 400) {
    const detail = json?.message || json?.error?.message || response.text || "";
    throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ""}`);
  }
  return json;
}

async function translateMyMemory(text, targetId) {
  const chunks = chunkText(text, 450);
  if (chunks.length > 20) {
    throw new Error("选区太长，MyMemory 免费接口额度有限；请缩短选区，或在设置中改用百度/DeepL");
  }
  const results = [];
  for (const chunk of chunks) {
    const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(`autodetect|${targetId}`)}`;
    const json = await requestJson({ url, method: "GET" });
    if (json?.quotaFinished) throw new Error("MyMemory 今日免费额度已用完，请改用百度/DeepL");
    const translated = json?.responseData?.translatedText;
    if (!translated) {
      throw new Error(json?.responseDetails || "MyMemory 没有返回译文");
    }
    results.push(decodeEntities(translated));
  }
  return results.join("\n");
}

async function translateBaidu(plugin, text, targetId) {
  const appid = String(plugin?.settings?.baiduTranslateAppId || "").trim();
  const key = String(plugin?.settings?.baiduTranslateKey || "").trim();
  if (!appid || !key) throw new Error("请先在设置 → 翻译 中填写百度翻译 APP ID 和密钥");
  const targetCode = { "zh-CN": "zh", en: "en", ja: "jp", ko: "kor" }[targetId] || "zh";
  const chunks = chunkText(text, 1800);
  const results = [];
  for (const chunk of chunks) {
    const salt = String(Date.now());
    const sign = md5Hex(appid + chunk + salt + key);
    const body = new URLSearchParams({
      q: chunk,
      from: "auto",
      to: targetCode,
      appid,
      salt,
      sign
    }).toString();
    const json = await requestJson({
      url: BAIDU_ENDPOINT,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (json?.error_code) {
      throw new Error(`百度翻译错误 ${json.error_code}：${json.error_msg || "请检查 APP ID/密钥"}`);
    }
    const translated = (json?.trans_result || []).map((item) => item.dst).join("\n").trim();
    if (!translated) throw new Error("百度翻译没有返回译文");
    results.push(translated);
  }
  return results.join("\n");
}

async function translateDeepL(plugin, text, targetId) {
  const key = String(plugin?.settings?.deeplTranslateApiKey || "").trim();
  if (!key) throw new Error("请先在设置 → 翻译 中填写 DeepL API Key");
  const endpoint = key.endsWith(":fx") ? DEEPL_FREE_ENDPOINT : DEEPL_PRO_ENDPOINT;
  const targetCode = { "zh-CN": "ZH-HANS", en: "EN", ja: "JA", ko: "KO" }[targetId] || "ZH-HANS";
  const body = new URLSearchParams({ text: String(text), target_lang: targetCode }).toString();
  const json = await requestJson({
    url: endpoint,
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const translated = (json?.translations || []).map((item) => item.text).join("\n").trim();
  if (!translated) throw new Error("DeepL 没有返回译文");
  return translated;
}

async function translateText(plugin, text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("没有可翻译的文字");
  const provider = getProvider(plugin);
  const target = getTarget(plugin);
  if (provider.id === "baidu") return translateBaidu(plugin, source, target.id);
  if (provider.id === "deepl") return translateDeepL(plugin, source, target.id);
  return translateMyMemory(source, target.id);
}

export {
  chunkText,
  md5Hex,
  translateText,
  translationProviderLabel,
  translationTargetLabel
};
