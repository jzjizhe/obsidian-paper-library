/* 外观预设：内置主题定义（LIBRARY_APPEARANCES）与设置归一化函数。
   纯数据与纯函数，不依赖 Obsidian；应用外观到 DOM 的逻辑在插件主类中。 */

const APPEARANCE_PROTOCOL_VERSION = 3;
const LIBRARY_APPEARANCES = Object.freeze({
  standard: Object.freeze({
    id: "standard", name: "标准视图", base: "standard", scheme: "adaptive", motion: "subtle",
    density: "comfortable", geometry: "native", navigation: "list", detail: "pane",
    sidebarEyebrow: "PAPER LIBRARY // INDEX", mastheadEyebrow: "PAPER LIBRARY // COLLECTION",
    mastheadMotto: "A focused index for reading, evidence and ideas.", mastheadMark: "PL"
  }),
  gallery: Object.freeze({
    id: "gallery", name: "画廊视图", base: "gallery", scheme: "light", motion: "subtle",
    density: "comfortable", geometry: "archival", navigation: "index", detail: "folio",
    sidebarEyebrow: "PAPER GALLERY // INDEX", mastheadEyebrow: "PAPER REFINEMENT DEPARTMENT // GALLERY INDEX",
    mastheadMotto: "A structured gallery for mysterious and important work.", mastheadMark: "PG"
  }),
  paperglass: Object.freeze({
    id: "paperglass", name: "纸境视图", base: "paperglass", scheme: "light", motion: "ambient",
    density: "comfortable", geometry: "fluid", navigation: "glass", detail: "cards",
    sidebarEyebrow: "PAPERGLASS // INDEX", mastheadEyebrow: "PAPERGLASS // RESEARCH COLLECTION",
    mastheadMotto: "Research suspended in light, glass and quiet motion.", mastheadMark: "PG"
  }),
  blueprint: Object.freeze({
    id: "blueprint", name: "蓝图视图", base: "blueprint", scheme: "light", motion: "precise",
    density: "compact", geometry: "technical", navigation: "rail", detail: "dossier",
    sidebarEyebrow: "RESEARCH BLUEPRINT // INDEX", mastheadEyebrow: "RESEARCH CONTROL // BLUEPRINT",
    mastheadMotto: "Trace evidence, structure ideas, build the next question.", mastheadMark: "RB"
  }),
  custom: Object.freeze({
    id: "custom", name: "自定义外观", base: "standard", scheme: "adaptive", motion: "custom",
    density: "comfortable", geometry: "custom", navigation: "custom", detail: "custom"
  })
});

function normalizeLibraryAppearance(value, legacyValue = "") {
  const id = String(value || "").trim().toLowerCase();
  if (Object.hasOwn(LIBRARY_APPEARANCES, id)) return id;
  return legacyValue === "severance" ? "gallery" : "standard";
}

function normalizeAppearanceBase(value) {
  return ["gallery", "paperglass", "blueprint"].includes(value) ? value : "standard";
}

function normalizeCustomAppearanceId(value, fallback = "blueprint") {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || fallback;
}

function normalizeCustomAppearanceProfiles(profiles, legacy = {}) {
  const source = Array.isArray(profiles) ? profiles : [];
  const seen = new Set();
  const normalized = source.flatMap((profile, index) => {
    if (!profile || typeof profile !== "object") return [];
    let id = normalizeCustomAppearanceId(profile.id, `appearance-${index + 1}`);
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return [{
      id,
      name: String(profile.name || "未命名外观").trim() || "未命名外观",
      base: normalizeAppearanceBase(profile.base),
      css: String(profile.css || ""),
      builtin: id === "blueprint" || Boolean(profile.builtin)
    }];
  });
  const blueprint = normalized.find((profile) => profile.id === "blueprint");
  if (blueprint) {
    blueprint.name = "蓝图";
    blueprint.base = "blueprint";
    blueprint.builtin = true;
  } else {
    normalized.unshift({ id: "blueprint", name: "蓝图", base: "blueprint", css: "", builtin: true });
    seen.add("blueprint");
  }
  const legacyName = String(legacy.name || "我的外观").trim() || "我的外观";
  const legacyBase = normalizeAppearanceBase(legacy.base);
  const legacyCss = String(legacy.css || "");
  if (!source.length && (legacyCss || legacyName !== "我的外观" || !["standard", "blueprint"].includes(legacyBase))) {
    normalized.push({ id: "legacy", name: legacyName, base: legacyBase, css: legacyCss, builtin: false });
  }
  return normalized;
}

function normalizeAppearanceColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#2563c9";
}

function appearanceContrastColor(value) {
  const color = normalizeAppearanceColor(value).slice(1);
  const channels = [0, 2, 4].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  return luminance > 0.43 ? "#172435" : "#ffffff";
}

export {
  APPEARANCE_PROTOCOL_VERSION,
  LIBRARY_APPEARANCES,
  appearanceContrastColor,
  normalizeAppearanceBase,
  normalizeAppearanceColor,
  normalizeCustomAppearanceId,
  normalizeCustomAppearanceProfiles,
  normalizeLibraryAppearance
};
