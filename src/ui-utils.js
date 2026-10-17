/* UI 辅助：图标封装（别名回退 + 文字符号兜底）、图标按钮、ItemView 根元素获取。
   依赖 Obsidian 的 DOM 扩展（createEl/createSpan）与 setIcon，不能在纯 Node 中运行。 */

import { Platform, setIcon as obsidianSetIcon } from "obsidian";

function itemViewContentRoot(view) {
  return view?.contentEl
    || view?.containerEl?.querySelector?.(":scope > .view-content")
    || view?.containerEl?.querySelector?.(".view-content")
    || view?.containerEl?.children?.[1]
    || null;
}

const PAPERLIB_ICON_ALIASES = {
  "bar-chart-2": ["bar-chart"],
  "book-open-check": ["book-open", "book"],
  "calendar-days": ["calendar"],
  "chart-no-axes-column-increasing": ["bar-chart-2", "bar-chart"],
  "circle-alert": ["alert-circle"],
  "circle-plus": ["plus-circle", "plus"],
  "database-zap": ["database", "alert-circle"],
  "file-check-2": ["file-check", "check"],
  "file-plus-2": ["file-plus", "plus-square", "plus"],
  "file-warning": ["file", "alert-triangle"],
  files: ["copy", "file-text"],
  folders: ["folder", "library"],
  highlighter: ["edit-3", "pencil"],
  "image-off": ["image", "file-x"],
  images: ["image", "layout-grid"],
  library: ["book-open", "folder"],
  "list-plus": ["list", "plus"],
  "loader-circle": ["loader"],
  "message-square-text": ["message-square", "edit-3"],
  "messages-square": ["message-square", "message-circle"],
  network: ["share-2", "git-branch"],
  "mouse-pointer-2": ["mouse-pointer"],
  "mouse-pointer-click": ["mouse-pointer"],
  "move-right": ["arrow-right"],
  "notebook-pen": ["edit-3", "pencil", "file-text"],
  orbit: ["circle", "move"],
  "paper-composer": ["sparkles", "file-text"],
  palette: ["paintbrush", "edit-3", "settings"],
  "panel-left-open": ["panel-left", "sidebar", "menu"],
  "panels-top-left": ["layout", "grid"],
  "search-x": ["search", "x"],
  scan: ["focus", "maximize-2"],
  sparkles: ["star", "wand-2"],
  "square-pen": ["edit-3", "pencil"],
  "sticky-note": ["file-text"],
  "text-quote": ["quote", "file-text"],
  waypoints: ["share-2", "git-branch", "link-2"]
};

const PAPERLIB_ICON_SYMBOLS = {
  "bar-chart-2": "▥", "chart-no-axes-column-increasing": "▥",
  "arrow-up": "↑", check: "✓", circle: "○",
  "chevron-down": "⌄", "chevron-left": "‹", "chevron-right": "›", "chevron-up": "⌃",
  "circle-alert": "!", "circle-plus": "+", "cloud-off": "☁", copy: "⧉", download: "↓",
  "database-zap": "!", "edit-3": "✎", "external-link": "↗", "file-down": "⇩", "file-plus-2": "+",
  "file-question": "?", "file-text": "▤", "file-warning": "!", files: "▤", flag: "⚑",
  folder: "▱", "folder-plus": "+", folders: "▱", highlighter: "✎", "image-off": "▧", images: "▧",
  info: "ⓘ", "layout-grid": "▦", "layout-template": "▦", "link-2": "↗",
  "list-plus": "+", "loader-circle": "◌", "maximize-2": "↗", "message-square-text": "□", "messages-square": "□",
  minus: "−", "mouse-pointer-2": "↖", "mouse-pointer-click": "↖", "move-right": "→",
  "notebook-pen": "✎", orbit: "◎", "panel-left-open": "☰", "paper-composer": "✦", paperclip: "⌕", pencil: "✎", scan: "⌗", sparkles: "✦",
  plus: "+", "refresh-cw": "↻", search: "⌕", "search-x": "⌕", star: "☆", "sticky-note": "▤",
  tags: "◇", "text-quote": "❞", "trash-2": "⌫", upload: "⇧", waypoints: "⌘", x: "×"
};

function setPaperlibIcon(element, icon) {
  if (!element) return false;
  const candidates = [icon, ...(PAPERLIB_ICON_ALIASES[icon] || [])].filter(Boolean);
  for (const candidate of candidates) {
    element.querySelectorAll?.(":scope > svg, :scope > .paperlib-icon-fallback")?.forEach((node) => node.remove());
    try { obsidianSetIcon(element, candidate); } catch (_) {}
    if (element.querySelector?.("svg")) return true;
  }
  element.querySelectorAll?.(":scope > svg, :scope > .paperlib-icon-fallback")?.forEach((node) => node.remove());
  element.createSpan?.({
    cls: "paperlib-icon-fallback",
    text: PAPERLIB_ICON_SYMBOLS[icon] || "•"
  });
  return false;
}

function iconButton(parent, icon, label, onClick, className = "") {
  const button = parent.createEl("button", {
    cls: `paperlib-icon-button ${className}`.trim(),
    attr: { "aria-label": label, title: label }
  });
  setPaperlibIcon(button, icon);
  button.addEventListener("click", onClick);
  return button;
}

const STAR_FEEDBACK_DELAY = 220;

function isPaperLibraryMobile() {
  const bodyIsMobile = typeof document !== "undefined"
    && document.body?.classList?.contains("is-mobile");
  return Boolean(
    Platform?.isMobile
    || Platform?.isMobileApp
    || bodyIsMobile
  );
}

function highlighterCursor(color) {
  const encoded = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
    <g transform="rotate(38 11 11)">
      <path d="M7.5 2.5h7A1.5 1.5 0 0 1 16 4v10H6V4a1.5 1.5 0 0 1 1.5-1.5Z" fill="#f8fafb" stroke="#263842" stroke-width="1.15"/>
      <path d="M6 13.5h10l-1.8 4H7.8l-1.8-4Z" fill="${color}" stroke="#263842" stroke-width="1.15" stroke-linejoin="round"/>
      <path d="M8 18.5h6" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    </g>
  </svg>`);
  return `url("data:image/svg+xml,${encoded}") 6 18`;
}

/* PAPERLIB_ICON_ALIASES、PAPERLIB_ICON_SYMBOLS 是 setPaperlibIcon 的内部表，不导出。 */
export { STAR_FEEDBACK_DELAY, highlighterCursor, iconButton, isPaperLibraryMobile, itemViewContentRoot, setPaperlibIcon };
