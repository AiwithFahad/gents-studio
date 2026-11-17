/* GENT'S STUDIO — API layer + shared UI utilities (toast, modal, helpers).
 * Every backend call goes through API.request(). There are NO mocked responses.
 */
class ApiError extends Error {
  constructor(message, { status = 0, code = "API_ERROR", details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const API = {
  isConfigured() {
    return typeof CONFIG !== "undefined" && !!CONFIG.API_URL;
  },

  devModeMessage: "Development mode: the n8n backend is not connected yet. Set API_URL in js/config.js to enable this action.",

  /* Every call is a POST to the single n8n endpoint with { action, ...body }. */
  async request(endpointKey, { body = null, auth = false } = {}) {
    if (!this.isConfigured()) {
      throw new ApiError(this.devModeMessage, { code: "DEV_MODE" });
    }
    const map = CONFIG.ACTIONS[endpointKey];
    if (!map) throw new ApiError("Unknown endpoint: " + endpointKey, { code: "BAD_ENDPOINT" });
    let action = map, payload = Object.assign({}, body || {});
    if (typeof map === "function") { const r = map(payload); action = r[0]; payload = r[1]; }

    let token = null;
    if (auth) {
      token = Auth.getToken();
      if (!token) throw new ApiError("Your session has expired. Please log in again.", { status: 401, code: "NO_SESSION" });
    }
    const json = Object.assign({}, payload, { action });

    const send = async simple => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
      try {
        // "simple" mode avoids a CORS preflight: text/plain body, token inside the body.
        const headers = simple ? { "Content-Type": "text/plain;charset=UTF-8" } : { "Content-Type": "application/json" };
        const bodyObj = Object.assign({}, json);
        if (token) { if (simple) bodyObj.token = token; else headers.Authorization = "Bearer " + token; }
        return await fetch(CONFIG.API_URL, { method: "POST", headers, body: JSON.stringify(bodyObj), signal: controller.signal, credentials: "omit" });
      } finally { clearTimeout(timer); }
    };

    let res;
    try {
      res = await send(false);
    } catch (err) {
      if (err.name === "AbortError") throw new ApiError("The server took too long to respond. Please try again.", { code: "TIMEOUT" });
      // A TypeError here is usually a blocked CORS preflight; retry once as a simple request.
      try { res = await send(true); }
      catch (err2) {
        if (err2.name === "AbortError") throw new ApiError("The server took too long to respond. Please try again.", { code: "TIMEOUT" });
        throw new ApiError("Could not reach the server. Check your connection and try again.", { code: "NETWORK" });
      }
    }

    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (res.status === 401 && auth) {
      Auth.clear();
      throw new ApiError((data && data.message) || "Your session has expired. Please log in again.", { status: 401, code: "UNAUTHORIZED" });
    }
    if (res.status === 403 && auth) {
      throw new ApiError("You don't have permission to do that.", { status: 403, code: "FORBIDDEN" });
    }
    if (res.status >= 500 && !(data && data.message)) {
      throw new ApiError("The server ran into a problem. Please try again in a moment.", { status: res.status, code: "SERVER_ERROR", details: data });
    }
    if (!res.ok || !data || data.success === false) {
      const msg = (data && (data.message || data.error)) || "Request failed (" + res.status + ").";
      throw new ApiError(msg, { status: res.status, code: (data && data.code) || (res.status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED"), details: data });
    }
    return Object.prototype.hasOwnProperty.call(data, "data") ? data.data : data;
  },

  get(key, opts = {})  { return this.request(key, { ...opts, body: opts.body || {} }); },
  post(key, body, opts = {}) { return this.request(key, { ...opts, body }); }
};

/* ---------- Shared helpers ---------- */
const Utils = {
  $(sel, root = document) { return root.querySelector(sel); },
  $$(sel, root = document) { return [...root.querySelectorAll(sel)]; },

  escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },
  money(n) {
    const v = Number(n) || 0;
    return CONFIG.CURRENCY_SYMBOL + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  },
  duration(min) {
    const m = Number(min) || 0;
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} hr ${r} min` : `${h} hr`;
  },
  todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  },
  formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    if (isNaN(d)) return Utils.escape(iso);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  },
  formatTime(t) {
    if (!t) return "—";
    const [h, m] = String(t).split(":").map(Number);
    if (isNaN(h)) return Utils.escape(t);
    const ampm = h >= 12 ? "PM" : "AM";
    return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${ampm}`;
  },
  statusBadge(status) {
    const s = String(status || "pending").toLowerCase();
    return `<span class="badge badge--${Utils.escape(s)}">${Utils.escape(s)}</span>`;
  },
  isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()); },
  isPhone(v) { return /^[+()\-\s\d]{7,20}$/.test(String(v).trim()) && String(v).replace(/\D/g, "").length >= 7; },
  debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },

  setLoading(btn, loading, label) {
    if (!btn) return;
    if (loading) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label || "Please wait…"}`;
    } else {
      btn.disabled = false;
      btn.classList.remove("is-loading");
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  },

  fieldError(input, message) {
    const wrap = input.closest(".field");
    if (!wrap) return;
    let el = wrap.querySelector(".field__error");
    if (!el) { el = document.createElement("p"); el.className = "field__error"; wrap.appendChild(el); }
    el.textContent = message || "";
    wrap.classList.toggle("has-error", !!message);
    input.setAttribute("aria-invalid", message ? "true" : "false");
  },
  clearErrors(form) {
    Utils.$$(".field", form).forEach(f => {
      f.classList.remove("has-error");
      const e = f.querySelector(".field__error"); if (e) e.textContent = "";
    });
  },

  devBanner(container, text) {
    if (!container || API.isConfigured()) return;
    container.innerHTML = `<div class="dev-banner" role="status"><strong>Development mode</strong><span>${Utils.escape(text || API.devModeMessage)}</span></div>`;
  },

  emptyRow(cols, text) {
    return `<tr class="row-empty"><td colspan="${cols}" class="table__empty">${Utils.escape(text)}</td></tr>`;
  },

  /* Error state with an optional Retry button. Works for <tbody> (cols given) or any block container. */
  errorState(container, message, retry, cols) {
    if (!container) return;
    const btn = retry ? `<button type="button" class="btn btn--outline btn--sm retry-btn">↻ Retry</button>` : "";
    const inner = `<div class="error-state"><p>${Utils.escape(message)}</p>${btn}</div>`;
    container.innerHTML = cols ? `<tr class="row-empty"><td colspan="${cols}" class="table__empty">${inner}</td></tr>` : `<div class="panel-empty">${inner}</div>`;
    const b = container.querySelector(".retry-btn");
    if (b) b.addEventListener("click", retry, { once: true });
  },

  /* Copies <th> labels onto each <td> so tables can stack into cards on mobile. */
  labelTable(tbody) {
    const table = tbody && tbody.closest("table");
    if (!table) return;
    const heads = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
    tbody.querySelectorAll("tr:not(.row-empty)").forEach(tr => {
      [...tr.children].forEach((td, i) => { if (heads[i]) td.setAttribute("data-label", heads[i]); });
    });
  }
};

/* ---------- Analytics helpers ----------
 * Pure functions that turn an appointment list into dashboard numbers.
 * Used by the admin dashboard when the backend sends raw appointments only,
 * and by the labelled development sample data.
 */
const Analytics = {
  REVENUE_STATUSES: ["completed"],
  _iso(d) { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); },
  _live(list) { return list.filter(a => String(a.status).toLowerCase() !== "deleted"); },
  _count(list, s) { return list.filter(a => String(a.status).toLowerCase() === s).length; },
  _revenue(list) { return list.filter(a => this.REVENUE_STATUSES.includes(String(a.status).toLowerCase())).reduce((t, a) => t + (Number(a.price) || 0), 0); },

  dashboard(all, customerCount) {
    const list = this._live(all);
    const today = this._iso(new Date());
    const month = today.slice(0, 7);
    const stats = {
      totalAppointments: list.length,
      todayAppointments: list.filter(a => a.date === today && String(a.status).toLowerCase() !== "cancelled").length,
      pending: this._count(list, "pending"),
      confirmed: this._count(list, "confirmed"),
      completed: this._count(list, "completed"),
      cancelled: this._count(list, "cancelled"),
      totalCustomers: customerCount ?? new Set(list.map(a => String(a.email).toLowerCase())).size,
      monthlyRevenue: this._revenue(list.filter(a => String(a.date).startsWith(month)))
    };
    const weeklyBookings = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = this._iso(d);
      weeklyBookings.push({ label: d.toLocaleDateString(undefined, { weekday: "short" }), value: list.filter(a => a.date === key && String(a.status).toLowerCase() !== "cancelled").length });
    }
    const monthlyRevenue = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      const key = this._iso(d).slice(0, 7);
      monthlyRevenue.push({ label: d.toLocaleDateString(undefined, { month: "short" }), value: this._revenue(list.filter(a => String(a.date).startsWith(key))) });
    }
    const recentAppointments = [...list].sort((x, y) => String(y.createdAt || y.date).localeCompare(String(x.createdAt || x.date))).slice(0, 8);
    return { stats, weeklyBookings, monthlyRevenue, popularServices: this._popular(list).slice(0, 5), recentAppointments };
  },

  _popular(list) {
    const m = new Map();
    list.filter(a => String(a.status).toLowerCase() !== "cancelled").forEach(a => {
      const e = m.get(a.serviceName) || { label: a.serviceName, value: 0, revenue: 0 };
      e.value++;
      if (this.REVENUE_STATUSES.includes(String(a.status).toLowerCase())) e.revenue += Number(a.price) || 0;
      m.set(a.serviceName, e);
    });
    return [...m.values()].sort((a, b) => b.value - a.value);
  },

  report(all, range = "30d") {
    const days = { "30d": 30, "90d": 90, "12m": 365 }[range];
    const today = this._iso(new Date());
    let list = this._live(all).filter(a => a.date <= today);
    if (days) { const from = new Date(); from.setDate(from.getDate() - days); const f = this._iso(from); list = list.filter(a => a.date >= f); }
    const total = list.length, cancelled = this._count(list, "cancelled");
    const byMonth = days && days <= 90;
    const bucket = a => byMonth ? this._weekStart(a.date) : String(a.date).slice(0, 7);
    const keys = [...new Set(list.map(bucket))].sort();
    const fmt = k => byMonth ? new Date(k + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }) : new Date(k + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    const barberMap = new Map();
    list.forEach(a => barberMap.set(a.barberName || "Unassigned", (barberMap.get(a.barberName || "Unassigned") || 0) + 1));
    return {
      totalBookings: total, completed: this._count(list, "completed"), cancelled,
      cancellationRate: total ? cancelled / total * 100 : 0, revenue: this._revenue(list),
      bookingsTrend: keys.map(k => ({ label: fmt(k), value: list.filter(a => bucket(a) === k).length })),
      revenueTrend: keys.map(k => ({ label: fmt(k), value: this._revenue(list.filter(a => bucket(a) === k)) })),
      popularServices: this._popular(list),
      barberPerformance: [...barberMap].map(([label, value]) => ({ label, value }))
    };
  },
  _weekStart(iso) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return this._iso(d); }
};

/* ---------- Toasts ---------- */
const Toast = {
  root: null,
  show(message, type = "info", ms = 4500) {
    if (!this.root) {
      this.root = document.createElement("div");
      this.root.className = "toast-stack";
      this.root.setAttribute("aria-live", "polite");
      document.body.appendChild(this.root);
    }
    const t = document.createElement("div");
    t.className = `toast toast--${type}`;
    t.innerHTML = `<span>${Utils.escape(message)}</span><button class="toast__close" aria-label="Dismiss">&times;</button>`;
    t.querySelector("button").addEventListener("click", () => t.remove());
    this.root.appendChild(t);
    requestAnimationFrame(() => t.classList.add("is-visible"));
    setTimeout(() => { t.classList.remove("is-visible"); setTimeout(() => t.remove(), 300); }, ms);
  },
  error(err) {
    const msg = err instanceof Error ? err.message : String(err);
    this.show(msg, err && err.code === "DEV_MODE" ? "warn" : "error", 6500);
  }
};

/* ---------- Reusable modal ---------- */
const Modal = {
  open({ title, body, actions = [], size = "md", onOpen } = {}) {
    this.close();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal modal--${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal__head">
          <h3 id="modal-title">${Utils.escape(title || "")}</h3>
          <button class="modal__close" aria-label="Close">&times;</button>
        </header>
        <div class="modal__body"></div>
        <footer class="modal__foot"></footer>
      </div>`;
    const bodyEl = overlay.querySelector(".modal__body");
    if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);

    const foot = overlay.querySelector(".modal__foot");
    if (!actions.length) foot.remove();
    actions.forEach(a => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `btn ${a.variant ? "btn--" + a.variant : "btn--ghost"}`;
      b.textContent = a.label;
      b.addEventListener("click", () => a.onClick ? a.onClick(b, overlay) : Modal.close());
      foot.appendChild(b);
    });

    overlay.addEventListener("click", e => { if (e.target === overlay) Modal.close(); });
    overlay.querySelector(".modal__close").addEventListener("click", () => Modal.close());
    this._esc = e => { if (e.key === "Escape") Modal.close(); };
    document.addEventListener("keydown", this._esc);
    document.body.appendChild(overlay);
    document.body.classList.add("no-scroll");
    requestAnimationFrame(() => overlay.classList.add("is-open"));
    const focusable = overlay.querySelector("input, select, textarea, button:not(.modal__close)");
    if (focusable) setTimeout(() => focusable.focus(), 50);
    if (onOpen) onOpen(overlay);
    this.current = overlay;
    return overlay;
  },
  close() {
    if (!this.current) return;
    const o = this.current;
    this.current = null;
    o.classList.remove("is-open");
    document.removeEventListener("keydown", this._esc);
    document.body.classList.remove("no-scroll");
    setTimeout(() => o.remove(), 200);
  },
  confirm({ title = "Are you sure?", message, confirmLabel = "Confirm", danger = true } = {}) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const o = Modal.open({
        title, size: "sm",
        body: `<p class="modal__text">${Utils.escape(message)}</p>`,
        actions: [
          { label: "Go back", variant: "ghost", onClick: () => { finish(false); Modal.close(); } },
          { label: confirmLabel, variant: danger ? "danger" : "gold", onClick: () => { finish(true); Modal.close(); } }
        ]
      });
      const obs = new MutationObserver(() => { if (!document.body.contains(o)) { finish(false); obs.disconnect(); } });
      obs.observe(document.body, { childList: true });
    });
  }
};
