/* GENT'S STUDIO — AI Assistant chat widget.
 * Talks to the n8n Chat Trigger (embedded / webhook mode) of the workflow
 * "GENT'S STUDIO — AI Chat Assistant".
 *   POST CONFIG.CHAT_URL   { action: "sendMessage", sessionId, chatInput }
 *   ← 200 { output: "assistant reply" }
 * The sessionId keys the agent's conversation memory, so it is kept for the
 * browser tab (sessionStorage) and survives navigating between pages.
 * Nothing about bookings is decided here: the agent uses the Booking API tools.
 */
(function () {
  "use strict";

  const STORE = "gs_chat_v2";
  const MAX_LEN = 500;
  const TIMEOUT_MS = 90000;           // agent may call several tools
  const ASSISTANT = "GENT'S STUDIO AI ASSISTANT";
  const WELCOME = "Welcome to GENT'S STUDIO ✂️ I can tell you about our services, prices, barbers and opening hours, check availability, and book, reschedule or cancel appointments. How can I help?";
  const QUICK = [
    { label: "Services & prices", text: "What services do you offer and how much are they?" },
    { label: "Opening hours", text: "What are your opening hours?" },
    { label: "Book an appointment", text: "I'd like to book an appointment." },
    { label: "Manage my booking", text: "I want to change or cancel my existing appointment." }
  ];

  const chatUrl = () => (typeof CONFIG !== "undefined" && CONFIG.CHAT_URL) || "";
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* ---------- State (persisted per tab) ---------- */
  let state = load();
  function load() {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) || "null");
      if (s && s.sessionId && Array.isArray(s.messages)) return s;
    } catch (e) { /* ignore */ }
    return { sessionId: uuid(), messages: [], open: false, unread: 0 };
  }
  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ ...state, messages: state.messages.slice(-60) })); } catch (e) { /* storage full / private mode */ }
  }

  /* ---------- Safe mini-markdown: escape first, then format ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\b(GS-\d{8}-[A-Z0-9]{3,8})\b/g, '<span class="cb-id">$1</span>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function render(text) {
    const lines = esc(text).split(/\r?\n/);
    let html = "", list = null;
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    lines.forEach(raw => {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^\s*[-•*]\s+(.*)$/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
      else if (!line.trim()) { close(); }
      else if ((m = line.match(/^#{1,4}\s+(.*)$/))) { close(); html += `<p><strong>${inline(m[1])}</strong></p>`; }
      else { close(); html += `<p>${inline(line)}</p>`; }
    });
    close();
    return html || "<p></p>";
  }
  const timeLabel = ts => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  /* ---------- DOM ---------- */
  function build() {
    if (document.querySelector(".cb")) return;
    const root = document.createElement("div");
    root.className = "cb";
    root.innerHTML = `
      <button class="cb-fab" type="button" aria-label="Open chat with ${esc(ASSISTANT)}" aria-expanded="false" aria-controls="cb-panel">
        <svg class="cb-fab__chat" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.4L4 21.5V6a2 2 0 0 1 2-2Zm3 6.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"/></svg>
        <svg class="cb-fab__close" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z"/></svg>
        <span class="cb-badge" hidden>1</span>
      </button>
      <section class="cb-panel" id="cb-panel" role="dialog" aria-modal="false" aria-labelledby="cb-title" hidden>
        <header class="cb-head">
          <div class="cb-avatar" aria-hidden="true">GS</div>
          <div class="cb-head__text">
            <strong id="cb-title">${esc(ASSISTANT)}</strong>
            <span class="cb-status"><i></i><em>Online · usually replies in seconds</em></span>
          </div>
          <button class="cb-icon" type="button" data-cb="reset" title="Start a new conversation" aria-label="Start a new conversation">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z"/></svg>
          </button>
          <button class="cb-icon" type="button" data-cb="close" aria-label="Close chat">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z"/></svg>
          </button>
        </header>
        <div class="cb-log" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <div class="cb-quick" role="group" aria-label="Suggested questions"></div>
        <form class="cb-form" novalidate>
          <label class="cb-sr" for="cb-input">Message</label>
          <textarea id="cb-input" rows="1" maxlength="${MAX_LEN}" placeholder="Ask about services, times, bookings…" autocomplete="off"></textarea>
          <button class="cb-send" type="submit" aria-label="Send message" disabled>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>
          </button>
        </form>
        <p class="cb-foot">AI assistant · may make mistakes. Bookings are confirmed only with an appointment ID.</p>
      </section>`;
    document.body.appendChild(root);
    return root;
  }

  function init() {
    const root = build();
    if (!root) return;
    const $ = s => root.querySelector(s);
    const fab = $(".cb-fab"), panel = $(".cb-panel"), log = $(".cb-log"), quick = $(".cb-quick");
    const form = $(".cb-form"), input = $("#cb-input"), send = $(".cb-send"), badge = $(".cb-badge"), status = $(".cb-status em");
    let busy = false, controller = null, lastFailed = null;

    /* Render messages */
    function bubble(m, animate) {
      const el = document.createElement("div");
      el.className = `cb-msg cb-msg--${m.role}${m.error ? " cb-msg--error" : ""}${animate ? " is-new" : ""}`;
      el.innerHTML = `<div class="cb-bubble">${m.role === "user" ? `<p>${esc(m.text).replace(/\n/g, "<br>")}</p>` : render(m.text)}</div>
        <time datetime="${new Date(m.ts).toISOString()}">${m.role === "assistant" ? "Assistant · " : ""}${timeLabel(m.ts)}</time>`;
      if (m.error) {
        const retry = document.createElement("button");
        retry.type = "button"; retry.className = "cb-retry"; retry.textContent = "↻ Try again";
        retry.addEventListener("click", () => { if (lastFailed && !busy) { removeErrors(); sendMessage(lastFailed, true); } });
        el.querySelector(".cb-bubble").appendChild(retry);
      }
      log.appendChild(el);
      return el;
    }
    function renderAll() {
      log.innerHTML = "";
      if (!state.messages.length) state.messages.push({ role: "assistant", text: WELCOME, ts: Date.now() });
      state.messages.forEach(m => bubble(m, false));
      renderQuick();
      scroll(true);
    }
    function renderQuick() {
      const onlyWelcome = state.messages.filter(m => m.role === "user").length === 0;
      quick.innerHTML = onlyWelcome ? QUICK.map((q, i) => `<button type="button" data-q="${i}">${esc(q.label)}</button>`).join("") : "";
      quick.hidden = !onlyWelcome;
    }
    function scroll(instant) { log.scrollTo({ top: log.scrollHeight, behavior: instant ? "auto" : "smooth" }); }
    function removeErrors() {
      state.messages = state.messages.filter(m => !m.error);
      log.querySelectorAll(".cb-msg--error").forEach(n => n.remove());
      save();
    }
    function add(role, text, extra) {
      const m = Object.assign({ role, text, ts: Date.now() }, extra || {});
      if (!m.error) state.messages.push(m);
      save();
      bubble(m, true);
      scroll();
      if (role === "assistant" && panel.hidden) { state.unread = (state.unread || 0) + 1; save(); updateBadge(); }
      return m;
    }
    function updateBadge() {
      badge.hidden = !state.unread;
      badge.textContent = state.unread > 9 ? "9+" : String(state.unread || "");
    }

    /* Typing indicator */
    let typingEl = null, slowTimer = null;
    function typing(on) {
      if (on && !typingEl) {
        typingEl = document.createElement("div");
        typingEl.className = "cb-msg cb-msg--assistant cb-typing";
        typingEl.setAttribute("aria-label", "Assistant is typing");
        typingEl.innerHTML = `<div class="cb-bubble"><span></span><span></span><span></span><small hidden>Checking live availability…</small></div>`;
        log.appendChild(typingEl); scroll();
        slowTimer = setTimeout(() => { const s = typingEl && typingEl.querySelector("small"); if (s) s.hidden = false; scroll(); }, 6000);
        status.textContent = "Typing…";
      } else if (!on && typingEl) {
        clearTimeout(slowTimer); typingEl.remove(); typingEl = null;
        status.textContent = "Online · usually replies in seconds";
      }
    }

    /* Open / close */
    function setOpen(open) {
      state.open = open; if (open) state.unread = 0; save(); updateBadge();
      panel.hidden = !open;
      root.classList.toggle("is-open", open);
      fab.setAttribute("aria-expanded", String(open));
      fab.setAttribute("aria-label", open ? "Close chat" : `Open chat with ${ASSISTANT}`);
      document.body.classList.toggle("cb-lock", open && window.matchMedia("(max-width: 640px)").matches);
      if (open) { renderAll(); setTimeout(() => input.focus(), 60); } else fab.focus({ preventScroll: true });
    }
    fab.addEventListener("click", () => setOpen(panel.hidden));
    root.querySelector('[data-cb="close"]').addEventListener("click", () => setOpen(false));
    root.querySelector('[data-cb="reset"]').addEventListener("click", () => {
      if (busy) return;
      if (state.messages.some(m => m.role === "user") && !window.confirm("Start a new conversation? The assistant will forget this chat.")) return;
      state = { sessionId: uuid(), messages: [], open: true, unread: 0 }; save(); renderAll(); input.focus();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) setOpen(false); });
    quick.addEventListener("click", e => { const b = e.target.closest("button[data-q]"); if (b) sendMessage(QUICK[+b.dataset.q].text); });

    /* Input behaviour: auto-grow, Enter to send, Shift+Enter for newline */
    const syncInput = () => {
      input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px";
      send.disabled = busy || !input.value.trim();
    };
    input.addEventListener("input", syncInput);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", e => { e.preventDefault(); sendMessage(input.value); });

    /* Network */
    async function sendMessage(raw, isRetry) {
      const text = String(raw || "").trim().slice(0, MAX_LEN);
      if (!text || busy) return;
      if (!isRetry) { input.value = ""; syncInput(); add("user", text); renderQuick(); }
      if (!chatUrl()) {
        add("assistant", "The assistant isn't connected yet (development mode). You can still book on the Booking page or call the studio.", { error: true });
        lastFailed = text; return;
      }
      busy = true; syncInput(); input.setAttribute("aria-busy", "true"); typing(true);
      controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(chatUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sendMessage", sessionId: state.sessionId, chatInput: text }),
          signal: controller.signal
        });
        const raw = await res.text();
        let data = null; try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
        if (Array.isArray(data)) data = data[0];
        const reply = data && (data.output || data.text || data.message);
        if (!res.ok || !reply) {
          throw new Error(res.status === 404 ? "The assistant is offline right now." : res.status === 429 ? "Too many messages, please wait a moment." : "The assistant couldn't answer that.");
        }
        typing(false);
        add("assistant", String(reply));
        lastFailed = null;
      } catch (err) {
        typing(false);
        lastFailed = text;
        const msg = err.name === "AbortError" ? "That took too long, so I stopped waiting. If you were booking, nothing is confirmed until you receive an appointment ID." :
          (err instanceof TypeError ? "I can't reach the studio right now. Please check your connection." : err.message);
        add("assistant", msg + " You can try again, or call the studio.", { error: true });
      } finally {
        clearTimeout(timer); busy = false; controller = null;
        input.removeAttribute("aria-busy"); syncInput();
        if (!panel.hidden) input.focus({ preventScroll: true });
      }
    }

    updateBadge();
    if (state.open && !window.matchMedia("(max-width: 640px)").matches) setOpen(true);

    // Public hook so other pages can open the assistant with a prompt, e.g. GSChat.open("I want to reschedule")
    window.GSChat = { open: (prefill) => { setOpen(true); if (prefill) { input.value = prefill; syncInput(); } }, send: t => { setOpen(true); sendMessage(t); } };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
