/* GENT'S STUDIO — admin dashboard controller.
 * All data comes from authenticated n8n webhooks (Bearer token on every call).
 * Preview mode (no backend configured + explicit opt-in on the login page) reads
 * clearly labelled sample data from js/dev-sample.js and refuses every write.
 */
document.addEventListener("DOMContentLoaded", async () => {
  if (!Auth.requireAdmin()) return;

  const $ = Utils.$, $$ = Utils.$$, esc = Utils.escape;
  const PREVIEW = Auth.isPreview();
  const charts = {};
  const cache = { appointments: [], customers: [], services: [], barbers: [], apptLoaded: false };
  const STATUSES = ["pending", "confirmed", "completed", "cancelled", "no-show"];
  const PAGE_SIZE = 12;
  let apptPage = 1;

  /* Single entry point for admin data. */
  function call(key, body = {}) {
    if (PREVIEW) return DevSample.handle(key, body);
    return API.request(key, { body, auth: true });
  }

  /* ---------- Shell ---------- */
  const session = Auth.getSession();
  const who = (session.admin && (session.admin.name || session.admin.email)) || "Administrator";
  $("#admin-name").textContent = who;
  $("#admin-avatar").textContent = who.charAt(0).toUpperCase();
  $("#today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const devZone = $("#admin-dev");
  if (PREVIEW) {
    devZone.innerHTML = `<div class="dev-banner dev-banner--sample" role="status"><strong>Sample data · Preview mode</strong>
      <span>Everything below is generated sample data for demonstration. Nothing is saved. Connect n8n in js/config.js and sign in for live data.</span>
      <button type="button" class="btn btn--ghost btn--sm" id="exit-preview">Exit preview</button></div>`;
    $("#exit-preview").addEventListener("click", () => Auth.logout("loggedout"));
  } else {
    Utils.devBanner(devZone, "No backend is connected yet. Set API_URL in js/config.js and every view below will load live data from Google Sheets via n8n.");
  }

  /* Mobile sidebar */
  const sidebar = $(".sidebar");
  const backdrop = $("#sidebar-backdrop");
  const toggleBtn = $("#sidebar-toggle");
  const setSidebar = open => {
    sidebar.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", String(open));
  };
  toggleBtn.addEventListener("click", () => setSidebar(!sidebar.classList.contains("is-open")));
  backdrop.addEventListener("click", () => setSidebar(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && sidebar.classList.contains("is-open")) setSidebar(false); });

  $("#logout-btn").addEventListener("click", async () => {
    if (await Modal.confirm({ title: "Sign out?", message: "You will need to log in again to access the dashboard.", confirmLabel: "Sign out", danger: false })) Auth.logout();
  });

  /* Server-side session check before showing any data */
  if (!(await Auth.verifyWithServer())) return;

  const loaders = {
    dashboard: loadDashboard, appointments: loadAppointments, customers: loadCustomers,
    services: loadServices, barbers: loadBarbers, analytics: loadAnalytics, settings: loadSettings
  };
  const loaded = new Set();
  let currentView = null;

  function show(view, force = false) {
    if (!loaders[view]) view = "dashboard";
    currentView = view;
    $$(".sidebar__link[data-view]").forEach(l => {
      const on = l.dataset.view === view;
      l.classList.toggle("is-active", on);
      if (on) l.setAttribute("aria-current", "page"); else l.removeAttribute("aria-current");
    });
    $$(".view").forEach(v => v.hidden = v.id !== `view-${view}`);
    $("#view-title").textContent = $(`.sidebar__link[data-view="${view}"] span`).textContent;
    document.title = `${$("#view-title").textContent} — GENT'S STUDIO Admin`;
    setSidebar(false);
    if (force || !loaded.has(view)) { loaded.add(view); loaders[view](); }
  }
  $$(".sidebar__link[data-view]").forEach(l => l.addEventListener("click", e => {
    e.preventDefault();
    if (location.hash !== `#${l.dataset.view}`) history.pushState(null, "", `#${l.dataset.view}`);
    show(l.dataset.view);
  }));
  window.addEventListener("hashchange", () => show(location.hash.slice(1) || "dashboard"));
  window.addEventListener("popstate", () => show(location.hash.slice(1) || "dashboard"));

  const refreshBtn = $("#refresh-btn");
  refreshBtn.addEventListener("click", async () => {
    Utils.setLoading(refreshBtn, true, "Refreshing…");
    // Drop cached lookups so every view reloads from the source
    cache.services = []; cache.barbers = []; cache.apptLoaded = false;
    loaded.clear();
    try { await loaders[currentView](); } finally { loaded.add(currentView); Utils.setLoading(refreshBtn, false); }
  });

  /* Central error handler: auth errors redirect, others render an error state with Retry. */
  function handleErr(err, container, cols, retry) {
    if (err.code === "UNAUTHORIZED" || err.code === "NO_SESSION") {
      Toast.show("Your session has expired. Redirecting to login…", "warn");
      Auth.clear();
      setTimeout(() => location.replace("login.html?expired=1"), 1200);
      return;
    }
    const msg = err.code === "DEV_MODE" && !PREVIEW ? "Development mode — connect n8n to load data." : err.message;
    if (container) Utils.errorState(container, msg, err.code === "DEV_MODE" ? null : retry, cols);
    if (err.code !== "DEV_MODE" || PREVIEW) Toast.error(err);
  }

  /* ---------- Charts ---------- */
  const hasChart = typeof window.Chart !== "undefined";
  if (hasChart) {
    Chart.defaults.color = "#A3A3A3";
    Chart.defaults.borderColor = "rgba(255,255,255,0.06)";
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  }
  function drawChart(id, type, labels, data, opts = {}) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const box = canvas.closest(".chart-box");
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    if (!hasChart) { box.dataset.empty = "Chart library failed to load — check your connection"; return; }
    if (!labels.length || !data.some(v => Number(v) > 0)) { box.dataset.empty = "No data for this period yet"; return; }
    delete box.dataset.empty;
    const gold = "#D5B58A";
    const palette = ["#D5B58A", "#E8D5BB", "#9C8462", "#6E5E48", "#C9A46E", "#F5F0E8"];
    charts[id] = new Chart(canvas, {
      type,
      data: {
        labels,
        datasets: [{
          label: opts.label || "",
          data,
          backgroundColor: type === "doughnut" ? palette : type === "line" ? "rgba(213,181,138,0.12)" : gold,
          borderColor: type === "doughnut" ? "#242424" : gold,
          borderWidth: type === "doughnut" ? 3 : 2,
          borderRadius: type === "bar" ? 6 : 0,
          fill: type === "line", tension: 0.35, pointRadius: type === "line" ? 3 : 0, pointBackgroundColor: gold
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: type === "doughnut", position: "bottom", labels: { boxWidth: 10, padding: 14 } },
          tooltip: { callbacks: opts.money ? { label: c => " " + Utils.money(c.parsed.y ?? c.parsed) } : {} }
        },
        scales: type === "doughnut" ? {} : {
          y: { beginAtZero: true, ticks: { callback: v => opts.money ? Utils.money(v) : v, precision: 0 } },
          x: { grid: { display: false } }
        },
        cutout: type === "doughnut" ? "68%" : undefined
      }
    });
  }
  function chartsEmpty(ids, msg) {
    ids.forEach(id => {
      const c = document.getElementById(id); if (!c) return;
      if (charts[id]) { charts[id].destroy(); delete charts[id]; }
      c.closest(".chart-box").dataset.empty = msg;
    });
  }
  const series = arr => (Array.isArray(arr) ? arr : []);

  /* ---------- Dashboard ---------- */
  const STAT_KEYS = [
    ["totalAppointments", "Total appointments"], ["todayAppointments", "Today"], ["pending", "Pending"], ["confirmed", "Confirmed"],
    ["completed", "Completed"], ["cancelled", "Cancelled"], ["totalCustomers", "Customers"], ["monthlyRevenue", "Revenue this month", true]
  ];
  function renderStats(stats, loading) {
    $("#stats-grid").innerHTML = STAT_KEYS.map(([k, label, money]) => `
      <div class="stat-card ${loading ? "is-loading" : ""}"><span class="stat-card__label">${label}</span>
      <strong class="stat-card__value">${stats ? (money ? Utils.money(stats[k]) : (Number(stats[k]) || 0).toLocaleString()) : "—"}</strong></div>`).join("");
  }
  async function loadDashboard() {
    renderStats(null, true);
    $("#recent-body").innerHTML = Utils.emptyRow(6, "Loading…");
    try {
      let d = await call("adminStats");
      // If the backend only returns raw appointments, compute the numbers here.
      if (Array.isArray(d)) d = Analytics.dashboard(d);
      renderStats(d.stats || d);
      const w = series(d.weeklyBookings), m = series(d.monthlyRevenue), p = series(d.popularServices);
      drawChart("chart-weekly", "bar", w.map(x => x.label), w.map(x => x.value), { label: "Bookings" });
      drawChart("chart-revenue", "line", m.map(x => x.label), m.map(x => x.value), { label: "Revenue", money: true });
      drawChart("chart-popular", "doughnut", p.map(x => x.label), p.map(x => x.value));
      const recent = series(d.recentAppointments);
      const tb = $("#recent-body");
      tb.innerHTML = recent.length ? recent.map(a => `
        <tr><td class="mono">${esc(a.appointmentId)}</td><td>${esc(a.customerName)}</td><td>${esc(a.serviceName)}</td>
        <td>${esc(a.barberName || "—")}</td><td>${Utils.formatDate(a.date)} · ${Utils.formatTime(a.time)}</td><td>${Utils.statusBadge(a.status)}</td></tr>`).join("")
        : Utils.emptyRow(6, "No appointments yet. New bookings will appear here.");
      Utils.labelTable(tb);
    } catch (err) {
      renderStats(null);
      handleErr(err, $("#recent-body"), 6, loadDashboard);
      chartsEmpty(["chart-weekly", "chart-revenue", "chart-popular"], err.code === "DEV_MODE" ? "Connect n8n to see chart data" : "Chart data unavailable");
    }
  }

  /* ---------- Appointments ---------- */
  const apptFilters = { q: $("#appt-search"), date: $("#appt-date"), barber: $("#appt-barber"), status: $("#appt-status") };
  $("#appt-status").innerHTML = `<option value="">All statuses</option>` + STATUSES.map(s => `<option value="${s}">${s}</option>`).join("");
  const refilter = () => { apptPage = 1; renderAppointments(); };
  apptFilters.q.addEventListener("input", Utils.debounce(refilter, 200));
  [apptFilters.date, apptFilters.barber, apptFilters.status].forEach(el => el.addEventListener("change", refilter));
  $("#appt-clear").addEventListener("click", () => { Object.values(apptFilters).forEach(el => el.value = ""); refilter(); });
  $("#appt-new").addEventListener("click", () => apptForm());

  async function ensureLookups() {
    if (cache.services.length && cache.barbers.length) return;
    const [s, b] = await Promise.all([call("adminServices"), call("adminBarbers")]);
    cache.services = series(s); cache.barbers = series(b);
    const prev = apptFilters.barber.value;
    apptFilters.barber.innerHTML = `<option value="">All barbers</option>` + cache.barbers.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    apptFilters.barber.value = prev;
  }

  async function fetchAppointments() {
    cache.appointments = series(await call("adminAppointments"));
    cache.apptLoaded = true;
  }

  async function loadAppointments() {
    $("#appt-body").innerHTML = Utils.emptyRow(8, "Loading appointments…");
    $("#appt-pager").innerHTML = "";
    $("#appt-count").textContent = "";
    try {
      await ensureLookups();
      await fetchAppointments();
      renderAppointments();
    } catch (err) { handleErr(err, $("#appt-body"), 8, loadAppointments); }
  }

  function filteredAppointments() {
    const q = apptFilters.q.value.trim().toLowerCase();
    return cache.appointments.filter(a =>
      String(a.status).toLowerCase() !== "deleted" &&
      (!q || [a.appointmentId, a.customerName, a.email, a.phone, a.serviceName, a.barberName].some(v => String(v || "").toLowerCase().includes(q))) &&
      (!apptFilters.date.value || a.date === apptFilters.date.value) &&
      (!apptFilters.barber.value || a.barberId === apptFilters.barber.value) &&
      (!apptFilters.status.value || String(a.status).toLowerCase() === apptFilters.status.value)
    ).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time));
  }

  function renderAppointments() {
    const rows = filteredAppointments();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    apptPage = Math.min(Math.max(1, apptPage), pages);
    const slice = rows.slice((apptPage - 1) * PAGE_SIZE, apptPage * PAGE_SIZE);
    $("#appt-count").textContent = `${rows.length} appointment${rows.length === 1 ? "" : "s"}`;
    const tb = $("#appt-body");
    tb.innerHTML = slice.length ? slice.map(a => {
      const st = String(a.status).toLowerCase();
      return `
      <tr>
        <td class="mono">${esc(a.appointmentId)}</td>
        <td><strong>${esc(a.customerName)}</strong><small>${esc(a.email)}</small></td>
        <td>${esc(a.serviceName)}</td><td>${esc(a.barberName || "—")}</td>
        <td class="nowrap">${Utils.formatDate(a.date)}<small>${Utils.formatTime(a.time)}</small></td>
        <td>${Utils.money(a.price)}</td><td>${Utils.statusBadge(a.status)}</td>
        <td class="actions">
          <button class="icon-btn" data-a="view" data-id="${esc(a.appointmentId)}" aria-label="View ${esc(a.appointmentId)}">View</button>
          <button class="icon-btn" data-a="edit" data-id="${esc(a.appointmentId)}" aria-label="Edit ${esc(a.appointmentId)}">Edit</button>
          <button class="icon-btn icon-btn--warn" data-a="cancel" data-id="${esc(a.appointmentId)}" ${["cancelled", "completed", "no-show"].includes(st) ? "disabled" : ""}>Cancel</button>
          <button class="icon-btn icon-btn--danger" data-a="delete" data-id="${esc(a.appointmentId)}">Delete</button>
        </td>
      </tr>`;
    }).join("") : Utils.emptyRow(8, cache.appointments.length ? "No appointments match these filters." : "No appointments yet. Use “New appointment” to add one.");
    Utils.labelTable(tb);
    renderPager(rows.length, pages);
  }

  function renderPager(total, pages) {
    const pager = $("#appt-pager");
    if (pages <= 1) { pager.innerHTML = ""; return; }
    const from = (apptPage - 1) * PAGE_SIZE + 1, to = Math.min(apptPage * PAGE_SIZE, total);
    const nums = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - apptPage) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== "…") nums.push("…");
    }
    pager.innerHTML = `<span class="pager__info">${from}–${to} of ${total}</span>
      <div class="pager__btns">
        <button class="icon-btn" data-p="${apptPage - 1}" ${apptPage === 1 ? "disabled" : ""} aria-label="Previous page">‹ Prev</button>
        ${nums.map(n => n === "…" ? `<span class="pager__gap">…</span>` : `<button class="icon-btn ${n === apptPage ? "is-current" : ""}" data-p="${n}" ${n === apptPage ? 'aria-current="page"' : ""}>${n}</button>`).join("")}
        <button class="icon-btn" data-p="${apptPage + 1}" ${apptPage === pages ? "disabled" : ""} aria-label="Next page">Next ›</button>
      </div>`;
  }
  $("#appt-pager").addEventListener("click", e => {
    const b = e.target.closest("button[data-p]"); if (!b || b.disabled) return;
    apptPage = Number(b.dataset.p); renderAppointments();
    $("#view-appointments .panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#appt-body").addEventListener("click", async e => {
    const b = e.target.closest("button[data-a]"); if (!b || b.disabled) return;
    const a = cache.appointments.find(x => x.appointmentId === b.dataset.id); if (!a) return;
    if (b.dataset.a === "view") return viewAppointment(a);
    if (b.dataset.a === "edit") return apptForm(a);
    if (b.dataset.a === "cancel") {
      if (!await Modal.confirm({ title: "Cancel appointment?", message: `Cancel ${a.appointmentId} for ${a.customerName} on ${Utils.formatDate(a.date)}? The customer will be notified.`, confirmLabel: "Cancel appointment" })) return;
      return setStatus(a, "cancelled", b);
    }
    if (b.dataset.a === "delete") {
      if (!await Modal.confirm({ title: "Delete appointment?", message: `${a.appointmentId} will be soft-deleted: it stays in Google Sheets marked "deleted" for audit, but is hidden here.`, confirmLabel: "Delete" })) return;
      return setStatus(a, "deleted", b);
    }
  });

  /* Status changes only update the UI after the backend confirms. */
  async function setStatus(a, status, btn) {
    Utils.setLoading(btn, true, "");
    try {
      const res = await call("adminApptStatus", { appointmentId: a.appointmentId, status });
      if (res && res.appointment) Object.assign(a, res.appointment); else a.status = status;
      renderAppointments();
      Toast.show(`${a.appointmentId} ${status === "deleted" ? "deleted" : "marked " + status}.`, "success");
      loaded.delete("dashboard"); loaded.delete("analytics"); loaded.delete("customers");
    } catch (err) { handleErr(err); if (document.body.contains(btn)) Utils.setLoading(btn, false); }
  }

  function viewAppointment(a) {
    Modal.open({
      title: `Appointment ${a.appointmentId}`, size: "md",
      body: `<dl class="detail-list">
        ${[["Status", Utils.statusBadge(a.status)], ["Customer", esc(a.customerName)], ["Email", esc(a.email)], ["Phone", esc(a.phone)],
          ["Service", esc(a.serviceName)], ["Duration", Utils.duration(a.duration)], ["Barber", esc(a.barberName || "—")],
          ["Date", Utils.formatDate(a.date)], ["Time", Utils.formatTime(a.time)], ["Price", Utils.money(a.price)],
          ["Payment", esc(a.paymentStatus === "paid" ? "Paid (Stripe test)" : a.paymentStatus === "unpaid" ? "Unpaid" : "—")],
          ["Source", esc(a.source || "—")], ["Created", esc(a.createdAt ? new Date(a.createdAt).toLocaleString() : "—")]]
          .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
        <div class="detail-list__full"><dt>Notes</dt><dd>${esc(a.notes || "—")}</dd></div></dl>
        <div class="status-row"><label for="quick-status">Update status</label>
          <select id="quick-status">${STATUSES.map(s => `<option value="${s}" ${s === String(a.status).toLowerCase() ? "selected" : ""}>${s}</option>`).join("")}</select></div>`,
      actions: [
        { label: "Edit details", variant: "ghost", onClick: () => apptForm(a) },
        { label: "Close", variant: "ghost" },
        { label: "Save status", variant: "gold", onClick: async (btn, o) => {
          const s = o.querySelector("#quick-status").value;
          if (s === String(a.status).toLowerCase()) return Modal.close();
          Utils.setLoading(btn, true, "Saving…");
          try {
            const res = await call("adminApptStatus", { appointmentId: a.appointmentId, status: s });
            if (res && res.appointment) Object.assign(a, res.appointment); else a.status = s;
            renderAppointments(); Modal.close(); Toast.show("Status updated.", "success");
            loaded.delete("dashboard"); loaded.delete("analytics");
          } catch (err) { handleErr(err); Utils.setLoading(btn, false); }
        } }
      ]
    });
  }

  async function apptForm(a = null) {
    try { await ensureLookups(); } catch (err) { return handleErr(err); }
    if (!cache.services.length || !cache.barbers.length) return Toast.show("Add at least one service and one barber first.", "warn");
    const f = document.createElement("form");
    f.className = "form-grid"; f.noValidate = true;
    const v = k => esc(a ? a[k] ?? "" : "");
    const svcOpts = cache.services.filter(s => String(s.active) !== "false" || (a && s.id === a.serviceId));
    const brbOpts = cache.barbers.filter(b => String(b.active) !== "false" || (a && b.id === a.barberId));
    f.innerHTML = `
      <div class="field"><label for="af-name">Customer name</label><input id="af-name" name="customerName" value="${v("customerName")}" required></div>
      <div class="field"><label for="af-email">Email</label><input id="af-email" name="email" type="email" value="${v("email")}" required></div>
      <div class="field"><label for="af-phone">Phone</label><input id="af-phone" name="phone" type="tel" value="${v("phone")}" required></div>
      <div class="field"><label for="af-status">Status</label><select id="af-status" name="status">${STATUSES.map(s => `<option value="${s}" ${(a ? String(a.status).toLowerCase() === s : s === "confirmed") ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field"><label for="af-svc">Service</label><select id="af-svc" name="serviceId">${svcOpts.map(s => `<option value="${esc(s.id)}" ${a && a.serviceId === s.id ? "selected" : ""}>${esc(s.name)} — ${Utils.money(s.price)}</option>`).join("")}</select></div>
      <div class="field"><label for="af-brb">Barber</label><select id="af-brb" name="barberId">${brbOpts.map(b => `<option value="${esc(b.id)}" ${a && a.barberId === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="af-date">Date</label><input id="af-date" name="date" type="date" value="${v("date")}" ${a ? "" : `min="${Utils.todayISO()}"`} required></div>
      <div class="field"><label for="af-time">Time</label><input id="af-time" name="time" type="time" step="900" value="${v("time")}" required></div>
      <p class="field--full muted small" id="af-price"></p>
      <div class="field field--full"><label for="af-notes">Notes</label><textarea id="af-notes" name="notes" rows="2">${v("notes")}</textarea></div>`;
    const priceLine = () => {
      const s = cache.services.find(x => x.id === f.elements.serviceId.value);
      f.querySelector("#af-price").textContent = s ? `Price ${Utils.money(s.price)} · Duration ${Utils.duration(s.duration)}` : "";
    };
    f.elements.serviceId.addEventListener("change", priceLine); priceLine();
    f.addEventListener("input", e => Utils.fieldError(e.target, ""));

    const submit = async btn => {
      if (btn.disabled) return;
      Utils.clearErrors(f);
      const el = f.elements; let ok = true;
      const chk = (input, cond, msg) => { if (!cond) { Utils.fieldError(input, msg); ok = false; } };
      chk(el.customerName, el.customerName.value.trim().length >= 2, "Enter the customer's name.");
      chk(el.email, Utils.isEmail(el.email.value), "Enter a valid email.");
      chk(el.phone, Utils.isPhone(el.phone.value), "Enter a valid phone number.");
      chk(el.date, !!el.date.value && (a || el.date.value >= Utils.todayISO()), a ? "Choose a date." : "New appointments can't be in the past.");
      chk(el.time, !!el.time.value, "Choose a time.");
      if (!ok) return;
      const svc = cache.services.find(s => s.id === el.serviceId.value);
      const brb = cache.barbers.find(b => b.id === el.barberId.value);
      const payload = {
        appointmentId: a ? a.appointmentId : undefined,
        customerName: el.customerName.value.trim(), email: el.email.value.trim().toLowerCase(), phone: el.phone.value.trim(),
        serviceId: svc.id, serviceName: svc.name, price: Number(svc.price), duration: Number(svc.duration),
        barberId: brb.id, barberName: brb.name, date: el.date.value, time: el.time.value, status: el.status.value,
        notes: el.notes.value.trim(), source: "admin"
      };
      Utils.setLoading(btn, true, "Saving…");
      try {
        const res = await call("adminAppointment", payload);
        Modal.close();
        Toast.show(a ? "Appointment updated." : `Appointment ${res && res.appointmentId ? res.appointmentId + " " : ""}created.`, "success");
        loaded.delete("dashboard"); loaded.delete("customers"); loaded.delete("analytics");
        loadAppointments();
      } catch (err) {
        Utils.setLoading(btn, false);
        if (err.status === 409) Toast.show("That barber is already booked at this time. Pick another time.", "error");
        else handleErr(err);
      }
    };
    const o = Modal.open({
      title: a ? `Edit ${a.appointmentId}` : "New appointment", size: "lg", body: f,
      actions: [{ label: "Cancel", variant: "ghost" }, { label: a ? "Save changes" : "Create appointment", variant: "gold", onClick: submit }]
    });
    f.addEventListener("submit", e => { e.preventDefault(); submit(o.querySelector(".modal__foot .btn--gold")); });
  }

  /* ---------- Customers ---------- */
  $("#cust-search").addEventListener("input", Utils.debounce(renderCustomers, 200));
  async function loadCustomers() {
    $("#cust-body").innerHTML = Utils.emptyRow(6, "Loading customers…");
    try {
      cache.customers = series(await call("adminCustomers"));
      renderCustomers();
    } catch (err) { handleErr(err, $("#cust-body"), 6, loadCustomers); }
  }
  function renderCustomers() {
    const q = $("#cust-search").value.trim().toLowerCase();
    const rows = cache.customers.filter(c => !q || [c.name, c.email, c.phone].some(v => String(v || "").toLowerCase().includes(q)));
    const tb = $("#cust-body");
    tb.innerHTML = rows.length ? rows.map(c => `
      <tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td>
      <td>${Number(c.totalBookings) || 0}</td><td>${Utils.money(c.totalSpent)}</td>
      <td class="actions"><button class="icon-btn" data-email="${esc(c.email)}">View</button></td></tr>`).join("")
      : Utils.emptyRow(6, cache.customers.length ? "No customers match your search." : "No customers yet. They're added automatically when someone books.");
    Utils.labelTable(tb);
  }
  $("#cust-body").addEventListener("click", async e => {
    const b = e.target.closest("button[data-email]"); if (!b) return;
    const c = cache.customers.find(x => x.email === b.dataset.email); if (!c) return;
    const m = Modal.open({
      title: c.name, size: "lg",
      body: `<dl class="detail-list detail-list--row">
        <div><dt>Email</dt><dd>${esc(c.email)}</dd></div><div><dt>Phone</dt><dd>${esc(c.phone)}</dd></div>
        <div><dt>Bookings</dt><dd>${Number(c.totalBookings) || 0}</dd></div><div><dt>Total spent</dt><dd>${Utils.money(c.totalSpent)}</dd></div>
        <div><dt>First visit</dt><dd>${Utils.formatDate(c.firstVisit)}</dd></div><div><dt>Last visit</dt><dd>${Utils.formatDate(c.lastVisit)}</dd></div></dl>
        <h4 class="modal__sub">Booking history</h4>
        <div class="table-wrap"><table class="table table--compact table--stack"><thead><tr><th>ID</th><th>Service</th><th>Barber</th><th>Date</th><th>Status</th></tr></thead>
        <tbody id="cust-hist">${Utils.emptyRow(5, "Loading history…")}</tbody></table></div>`
    });
    const tb = m.querySelector("#cust-hist");
    const renderHist = () => {
      const hist = cache.appointments.filter(a => String(a.email).toLowerCase() === String(c.email).toLowerCase() && String(a.status).toLowerCase() !== "deleted")
        .sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time));
      tb.innerHTML = hist.length ? hist.map(a => `<tr><td class="mono">${esc(a.appointmentId)}</td><td>${esc(a.serviceName)}</td><td>${esc(a.barberName || "—")}</td><td>${Utils.formatDate(a.date)}</td><td>${Utils.statusBadge(a.status)}</td></tr>`).join("") : Utils.emptyRow(5, "No bookings found.");
      Utils.labelTable(tb);
    };
    const loadHist = async () => {
      try { if (!cache.apptLoaded) await fetchAppointments(); renderHist(); }
      catch (err) { Utils.errorState(tb, err.message, err.code === "DEV_MODE" ? null : loadHist, 5); }
    };
    loadHist();
  });

  /* ---------- Services ---------- */
  $("#svc-new").addEventListener("click", () => serviceForm());
  async function loadServices() {
    $("#svc-grid").innerHTML = `<div class="panel-empty"><span class="spinner"></span> Loading services…</div>`;
    try {
      cache.services = series(await call("adminServices"));
      renderServices();
    } catch (err) { handleErr(err, $("#svc-grid"), null, loadServices); }
  }
  function renderServices() {
    $("#svc-grid").innerHTML = cache.services.length ? cache.services.map(s => {
      const active = String(s.active) !== "false";
      return `<article class="admin-card ${active ? "" : "is-inactive"}">
        <div class="admin-card__top"><span class="chip">${esc(s.category || "Service")}</span>
          <label class="switch" title="${active ? "Deactivate" : "Activate"} ${esc(s.name)}"><input type="checkbox" data-svc-toggle="${esc(s.id)}" ${active ? "checked" : ""} aria-label="${esc(s.name)} active"><span></span></label></div>
        <h3>${esc(s.name)}</h3><p class="muted">${esc(s.description || "")}</p>
        <div class="admin-card__meta"><strong>${Utils.money(s.price)}</strong><span>${Utils.duration(s.duration)}</span></div>
        <button class="btn btn--outline btn--sm" data-svc-edit="${esc(s.id)}">Edit service</button></article>`;
    }).join("") : `<div class="panel-empty">No services yet. Use “Add service” to create your menu.</div>`;
  }
  $("#svc-grid").addEventListener("click", e => {
    const b = e.target.closest("[data-svc-edit]"); if (b) serviceForm(cache.services.find(s => s.id === b.dataset.svcEdit));
  });
  $("#svc-grid").addEventListener("change", async e => {
    const t = e.target.closest("[data-svc-toggle]"); if (!t) return;
    const s = cache.services.find(x => x.id === t.dataset.svcToggle);
    const want = t.checked;
    if (!want && !await Modal.confirm({ title: "Deactivate service?", message: `${s.name} will be hidden from the booking form. Existing appointments are not affected.`, confirmLabel: "Deactivate", danger: false })) { t.checked = true; return; }
    t.disabled = true;
    try {
      await call("adminServiceSave", { ...s, active: want });
      s.active = want; renderServices(); Toast.show(`${s.name} ${want ? "activated" : "deactivated"}.`, "success");
    } catch (err) { t.checked = !want; t.disabled = false; handleErr(err); }
  });
  function serviceForm(s = null) {
    const f = document.createElement("form"); f.className = "form-grid"; f.noValidate = true;
    const v = k => esc(s ? s[k] ?? "" : "");
    f.innerHTML = `
      <div class="field field--full"><label for="sf-name">Service name</label><input id="sf-name" name="name" value="${v("name")}"></div>
      <div class="field"><label for="sf-price">Price (${CONFIG.CURRENCY_SYMBOL})</label><input id="sf-price" name="price" type="number" min="0" step="0.5" value="${v("price")}"></div>
      <div class="field"><label for="sf-dur">Duration (minutes)</label><input id="sf-dur" name="duration" type="number" min="5" step="5" value="${v("duration")}"></div>
      <div class="field"><label for="sf-cat">Category</label><input id="sf-cat" name="category" value="${v("category")}" placeholder="Hair, Beard, Shave, Combo"></div>
      <div class="field"><label for="sf-act">Status</label><select id="sf-act" name="active"><option value="true">Active</option><option value="false" ${s && String(s.active) === "false" ? "selected" : ""}>Inactive</option></select></div>
      <div class="field field--full"><label for="sf-desc">Description</label><textarea id="sf-desc" name="description" rows="3">${v("description")}</textarea></div>`;
    f.addEventListener("input", e => Utils.fieldError(e.target, ""));
    const submit = async btn => {
      if (btn.disabled) return;
      Utils.clearErrors(f); const el = f.elements; let ok = true;
      if (el.name.value.trim().length < 2) { Utils.fieldError(el.name, "Name is required."); ok = false; }
      if (el.price.value === "" || !(Number(el.price.value) >= 0)) { Utils.fieldError(el.price, "Enter a valid price."); ok = false; }
      if (!(Number(el.duration.value) >= 5)) { Utils.fieldError(el.duration, "Minimum 5 minutes."); ok = false; }
      const dup = cache.services.find(x => x.name.trim().toLowerCase() === el.name.value.trim().toLowerCase() && (!s || x.id !== s.id));
      if (dup) { Utils.fieldError(el.name, "A service with this name already exists."); ok = false; }
      if (!ok) return;
      Utils.setLoading(btn, true, "Saving…");
      try {
        await call("adminServiceSave", { id: s ? s.id : undefined, name: el.name.value.trim(), price: Number(el.price.value), duration: Number(el.duration.value), category: el.category.value.trim(), description: el.description.value.trim(), active: el.active.value === "true" });
        Modal.close(); Toast.show(s ? "Service updated." : "Service added.", "success"); loadServices();
      } catch (err) { Utils.setLoading(btn, false); handleErr(err); }
    };
    const o = Modal.open({ title: s ? "Edit service" : "Add service", size: "md", body: f, actions: [
      { label: "Cancel", variant: "ghost" }, { label: "Save service", variant: "gold", onClick: submit }] });
    f.addEventListener("submit", e => { e.preventDefault(); submit(o.querySelector(".modal__foot .btn--gold")); });
  }

  /* ---------- Barbers ---------- */
  $("#brb-new").addEventListener("click", () => barberForm());
  async function loadBarbers() {
    $("#brb-grid").innerHTML = `<div class="panel-empty"><span class="spinner"></span> Loading barbers…</div>`;
    try {
      cache.barbers = series(await call("adminBarbers"));
      renderBarbers();
    } catch (err) { handleErr(err, $("#brb-grid"), null, loadBarbers); }
  }
  const specs = b => Array.isArray(b.specialties) ? b.specialties : String(b.specialties || "").split(",").map(s => s.trim()).filter(Boolean);
  function renderBarbers() {
    $("#brb-grid").innerHTML = cache.barbers.length ? cache.barbers.map(b => {
      const active = String(b.active) !== "false";
      const initials = String(b.name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
      return `<article class="admin-card admin-card--barber ${active ? "" : "is-inactive"}">
        <div class="admin-card__top"><div class="avatar">${esc(initials)}</div>
          <label class="switch" title="${active ? "Deactivate" : "Activate"} ${esc(b.name)}"><input type="checkbox" data-brb-toggle="${esc(b.id)}" ${active ? "checked" : ""} aria-label="${esc(b.name)} active"><span></span></label></div>
        <h3>${esc(b.name)}</h3><p class="muted">${esc(b.title || "Barber")}${b.years ? ` · ${esc(b.years)} yrs` : ""}</p>
        <ul class="chips">${specs(b).map(s => `<li>${esc(s)}</li>`).join("") || `<li class="muted">No specialties yet</li>`}</ul>
        <button class="btn btn--outline btn--sm" data-brb-edit="${esc(b.id)}">Edit barber</button></article>`;
    }).join("") : `<div class="panel-empty">No barbers yet. Use “Add barber” to add your team.</div>`;
  }
  $("#brb-grid").addEventListener("click", e => {
    const b = e.target.closest("[data-brb-edit]"); if (b) barberForm(cache.barbers.find(x => x.id === b.dataset.brbEdit));
  });
  $("#brb-grid").addEventListener("change", async e => {
    const t = e.target.closest("[data-brb-toggle]"); if (!t) return;
    const b = cache.barbers.find(x => x.id === t.dataset.brbToggle);
    const want = t.checked;
    if (!want && !await Modal.confirm({ title: "Deactivate barber?", message: `${b.name} will no longer be bookable. Their existing appointments stay as they are — reassign them if needed.`, confirmLabel: "Deactivate", danger: false })) { t.checked = true; return; }
    t.disabled = true;
    try {
      await call("adminBarberSave", { ...b, specialties: specs(b), active: want });
      b.active = want; renderBarbers(); Toast.show(`${b.name} ${want ? "activated" : "deactivated"}.`, "success");
    } catch (err) { t.checked = !want; t.disabled = false; handleErr(err); }
  });
  function barberForm(b = null) {
    const f = document.createElement("form"); f.className = "form-grid"; f.noValidate = true;
    const v = k => esc(b ? b[k] ?? "" : "");
    const list = b ? [...specs(b)] : [];
    f.innerHTML = `
      <div class="field"><label for="bf-name">Full name</label><input id="bf-name" name="name" value="${v("name")}"></div>
      <div class="field"><label for="bf-title">Title</label><input id="bf-title" name="title" value="${v("title")}" placeholder="Master Barber"></div>
      <div class="field"><label for="bf-email">Email</label><input id="bf-email" name="email" type="email" value="${v("email")}"></div>
      <div class="field"><label for="bf-years">Years of experience</label><input id="bf-years" name="years" type="number" min="0" max="60" value="${v("years")}"></div>
      <div class="field field--full"><label for="spec-input">Specialties</label>
        <div class="tag-input"><ul class="chips chips--removable" id="spec-list"></ul>
        <input id="spec-input" placeholder="Type a specialty and press Enter"></div></div>
      <div class="field"><label for="bf-act">Status</label><select id="bf-act" name="active"><option value="true">Active</option><option value="false" ${b && String(b.active) === "false" ? "selected" : ""}>Inactive</option></select></div>`;
    const renderSpecs = () => { f.querySelector("#spec-list").innerHTML = list.map((s, i) => `<li>${esc(s)}<button type="button" data-i="${i}" aria-label="Remove ${esc(s)}">&times;</button></li>`).join(""); };
    renderSpecs();
    f.querySelector("#spec-input").addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== ",") return;
      e.preventDefault(); const val = e.target.value.trim().replace(/,$/, "");
      if (val && !list.some(x => x.toLowerCase() === val.toLowerCase())) { list.push(val); renderSpecs(); } e.target.value = "";
    });
    f.querySelector("#spec-list").addEventListener("click", e => { const x = e.target.closest("button[data-i]"); if (x) { list.splice(+x.dataset.i, 1); renderSpecs(); } });
    f.addEventListener("input", e => Utils.fieldError(e.target, ""));
    const submit = async btn => {
      if (btn.disabled) return;
      Utils.clearErrors(f); const el = f.elements; let ok = true;
      if (el.name.value.trim().length < 2) { Utils.fieldError(el.name, "Name is required."); ok = false; }
      if (el.email.value && !Utils.isEmail(el.email.value)) { Utils.fieldError(el.email, "Invalid email."); ok = false; }
      if (el.years.value && (Number(el.years.value) < 0 || Number(el.years.value) > 60)) { Utils.fieldError(el.years, "Enter 0–60."); ok = false; }
      if (!ok) return;
      const pending = f.querySelector("#spec-input").value.trim(); if (pending && !list.includes(pending)) list.push(pending);
      Utils.setLoading(btn, true, "Saving…");
      try {
        await call("adminBarberSave", { id: b ? b.id : undefined, name: el.name.value.trim(), title: el.title.value.trim(), email: el.email.value.trim(), years: Number(el.years.value) || 0, specialties: list, active: el.active.value === "true" });
        Modal.close(); Toast.show(b ? "Barber updated." : "Barber added.", "success"); loadBarbers();
      } catch (err) { Utils.setLoading(btn, false); handleErr(err); }
    };
    Modal.open({ title: b ? "Edit barber" : "Add barber", size: "md", body: f, actions: [
      { label: "Cancel", variant: "ghost" }, { label: "Save barber", variant: "gold", onClick: submit }] });
    // Enter inside the specialty field adds a tag; Enter elsewhere submits.
    f.addEventListener("submit", e => { e.preventDefault(); submit(Modal.current.querySelector(".modal__foot .btn--gold")); });
  }

  /* ---------- Analytics ---------- */
  $("#an-range").addEventListener("change", loadAnalytics);
  async function loadAnalytics() {
    const kpi = $("#an-kpis");
    const labels = ["Total bookings", "Completed", "Cancellation rate", "Revenue"];
    kpi.innerHTML = labels.map(l => `<div class="stat-card is-loading"><span class="stat-card__label">${l}</span><strong class="stat-card__value">—</strong></div>`).join("");
    $("#an-top").innerHTML = Utils.emptyRow(4, "Loading…");
    try {
      let d = await call("adminAnalytics", { range: $("#an-range").value });
      if (Array.isArray(d)) d = Analytics.report(d, $("#an-range").value);
      const total = Number(d.totalBookings) || 0, cancelled = Number(d.cancelled) || 0;
      const rate = d.cancellationRate != null ? Number(d.cancellationRate) : (total ? cancelled / total * 100 : 0);
      kpi.innerHTML = [[labels[0], total.toLocaleString()], [labels[1], (Number(d.completed) || 0).toLocaleString()], [labels[2], rate.toFixed(1) + "%"], [labels[3], Utils.money(d.revenue)]]
        .map(([l, v]) => `<div class="stat-card"><span class="stat-card__label">${l}</span><strong class="stat-card__value">${v}</strong></div>`).join("");
      const trend = series(d.bookingsTrend), rev = series(d.revenueTrend), top = series(d.popularServices), byBarber = series(d.barberPerformance);
      drawChart("an-bookings", "line", trend.map(x => x.label), trend.map(x => x.value), { label: "Bookings" });
      drawChart("an-revenue", "bar", rev.map(x => x.label), rev.map(x => x.value), { label: "Revenue", money: true });
      drawChart("an-services", "doughnut", top.map(x => x.label), top.map(x => x.value));
      drawChart("an-barbers", "bar", byBarber.map(x => x.label), byBarber.map(x => x.value), { label: "Appointments" });
      const tb = $("#an-top");
      tb.innerHTML = top.length ? top.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.label)}</td><td>${Number(s.value) || 0}</td><td>${Utils.money(s.revenue)}</td></tr>`).join("") : Utils.emptyRow(4, "No data for this period.");
      Utils.labelTable(tb);
    } catch (err) {
      kpi.innerHTML = labels.map(l => `<div class="stat-card"><span class="stat-card__label">${l}</span><strong class="stat-card__value">—</strong></div>`).join("");
      handleErr(err, $("#an-top"), 4, loadAnalytics);
      chartsEmpty(["an-bookings", "an-revenue", "an-services", "an-barbers"], err.code === "DEV_MODE" ? "Connect n8n to see chart data" : "Chart data unavailable");
    }
  }

  /* ---------- Settings ---------- */
  const sf = $("#settings-form");
  async function loadSettings() {
    const ep = $("#set-endpoint");
    ep.textContent = CONFIG.API_URL || (PREVIEW ? "Not configured (preview with sample data)" : "Not configured (development mode)");
    ep.classList.toggle("text-warn", !CONFIG.API_URL);
    const btn = sf.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const s = await call("adminSettings", { action: "get" });
      Object.entries(s || {}).forEach(([k, v]) => { if (sf.elements[k]) sf.elements[k].value = v; });
      btn.disabled = false;
    } catch (err) {
      handleErr(err);
      btn.disabled = err.code === "DEV_MODE" && !PREVIEW;
      if (err.code !== "DEV_MODE") btn.disabled = false;
    }
  }
  sf.addEventListener("input", e => Utils.fieldError(e.target, ""));
  sf.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = sf.querySelector("button[type=submit]");
    if (btn.disabled) return;
    Utils.clearErrors(sf);
    const el = sf.elements; let ok = true;
    if (el.contactEmail.value && !Utils.isEmail(el.contactEmail.value)) { Utils.fieldError(el.contactEmail, "Invalid email."); ok = false; }
    if (el.phone.value && !Utils.isPhone(el.phone.value)) { Utils.fieldError(el.phone, "Invalid phone."); ok = false; }
    if (el.openTime.value && el.closeTime.value && el.openTime.value >= el.closeTime.value) { Utils.fieldError(el.closeTime, "Closing time must be after opening time."); ok = false; }
    if (Number(el.bufferMinutes.value) < 0) { Utils.fieldError(el.bufferMinutes, "Can't be negative."); ok = false; }
    if (!ok) return;
    const body = Object.fromEntries(new FormData(sf).entries());
    Utils.setLoading(btn, true, "Saving…");
    try { await call("adminSettings", { action: "save", ...body }); Toast.show("Settings saved.", "success"); }
    catch (err) { handleErr(err); }
    finally { Utils.setLoading(btn, false); }
  });

  show(location.hash.slice(1) || "dashboard");
});
