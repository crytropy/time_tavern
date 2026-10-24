/*
 * Nocturne Library — time_tavern 前端主題輔助腳本
 * 版本：0.2.0
 *
 * 做兩件事，都只動畫面、不動資料：
 * 1. 對白標記：把 AI 正文裡的「…」『…』“…” 包成 <span class="nl-dialogue">，讓 CSS 分開排版。
 *    app.js 每次重畫都會整塊換掉正文（innerHTML），所以用 MutationObserver 重新標記。
 *    「複製文字」「編輯訊息」讀的是資料，不受影響。
 * 2. 側欄收合：頂部列加一顆按鈕，桌機版可以收起左側欄，狀態記在這個瀏覽器。
 *
 * 移除：刪掉 index.html 載入這支檔案的那一行。
 */
(() => {
  "use strict";

  const root = document.documentElement;
  const STORAGE_KEY_SIDEBAR = "nocturne-library:sidebar-collapsed";

  // ───────────── 1. 對白標記 ─────────────

  const QUOTE_PAIRS = { "「": "」", "『": "』", "“": "”" };
  const CLOSERS = new Set(Object.values(QUOTE_PAIRS));
  const SKIP_TAGS = new Set(["CODE", "PRE", "A", "SCRIPT", "STYLE", "TEXTAREA", "SVG"]);
  const BLOCK_SELECTOR = "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dd, dt, figcaption, summary, div, section, article, aside, .markdown-body";
  const TARGET_SELECTOR = [
    "#messages .discord-message.assistant .discord-message-content > .markdown-body",
    "#sessionPreviewMessages .session-preview-message.assistant .session-preview-message-body"
  ].join(", ");

  function shouldSkip(node, body) {
    for (let el = node.parentElement; el && el !== body; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName) || el.classList.contains("nl-dialogue")) return true;
    }
    return false;
  }

  function createMark(char) {
    const mark = document.createElement("span");
    mark.className = "nl-quote-mark";
    mark.textContent = char;
    return mark;
  }

  // 一個段落裡的引號可能被 <em> 等標籤切成好幾段文字，所以以「段落」為單位記住目前是否在引號裡。
  function markBody(body) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue && !shouldSkip(node, body)) textNodes.push(node);
    }

    let currentBlock = null;
    let stack = [];

    textNodes.forEach((node) => {
      const block = node.parentElement?.closest(BLOCK_SELECTOR) || body;
      if (block !== currentBlock) {
        currentBlock = block;
        stack = [];
      }

      const text = node.nodeValue;
      if (!stack.length && !/[「『“」』”]/u.test(text)) return;

      const fragment = document.createDocumentFragment();
      let buffer = "";
      let span = stack.length ? document.createElement("span") : null;
      if (span) span.className = "nl-dialogue";

      const flushText = () => {
        if (!buffer) return;
        (span || fragment).appendChild(document.createTextNode(buffer));
        buffer = "";
      };

      for (const char of text) {
        if (QUOTE_PAIRS[char]) {
          flushText();
          if (!span) {
            span = document.createElement("span");
            span.className = "nl-dialogue";
          }
          span.appendChild(createMark(char));
          stack.push(QUOTE_PAIRS[char]);
        } else if (CLOSERS.has(char) && stack.length && stack[stack.length - 1] === char) {
          flushText();
          span.appendChild(createMark(char));
          stack.pop();
          if (!stack.length) {
            fragment.appendChild(span);
            span = null;
          }
        } else {
          buffer += char;
        }
      }
      flushText();
      if (span) fragment.appendChild(span);
      node.replaceWith(fragment);
    });
  }

  function markAll() {
    document.querySelectorAll(TARGET_SELECTOR).forEach((body) => {
      if (body.querySelector(".nl-dialogue, .nl-quote-mark")) return;
      markBody(body);
    });
  }

  let observer = null;

  // MutationObserver 的回呼本身就會把同一輪的變動合併成一次，直接處理即可，
  // 不等下一幀：畫面不會先閃一下未標記的版本，分頁在背景時也照常運作。
  // 處理期間先停止監聽，避免自己加的 <span> 又觸發自己。
  function runMarking() {
    observer?.disconnect();
    try {
      markAll();
    } catch (error) {
      console.warn("[Nocturne Library] 對白標記失敗：", error);
    }
    observe();
  }

  function observe() {
    if (!observer) observer = new MutationObserver(runMarking);
    ["messages", "sessionPreviewMessages"].forEach((id) => {
      const target = document.getElementById(id);
      if (target) observer.observe(target, { childList: true, subtree: true });
    });
  }

  // ───────────── 2. 側欄收合 ─────────────

  function readStoredFlag(key) {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function storeFlag(key, value) {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // 私密瀏覽等情況存不了，只影響下次開頁的預設值。
    }
  }

  function setupSidebarToggle() {
    const hero = document.querySelector(".hero");
    const sidebar = document.querySelector(".layout > .sidebar");
    if (!hero || !sidebar) return;

    sidebar.id ||= "nl-sidebar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nl-sidebar-toggle";
    button.setAttribute("aria-controls", sidebar.id);

    const apply = (collapsed) => {
      root.classList.toggle("nl-sidebar-collapsed", collapsed);
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", collapsed ? "展開側欄" : "收合側欄");
      button.title = collapsed ? "展開側欄" : "收合側欄";
      button.textContent = collapsed ? "☰" : "⟨";
    };

    button.addEventListener("click", () => {
      const collapsed = !root.classList.contains("nl-sidebar-collapsed");
      apply(collapsed);
      storeFlag(STORAGE_KEY_SIDEBAR, collapsed);
    });

    apply(readStoredFlag(STORAGE_KEY_SIDEBAR));
    hero.prepend(button);
  }

  // ───────────── 啟動 ─────────────

  function start() {
    root.classList.add("nl-js");
    setupSidebarToggle();
    runMarking();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
