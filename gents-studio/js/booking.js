/* GENT'S STUDIO — booking page controller */
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("booking-form");
  if (!form) return;

  const els = {
    name: form.elements.name,
    email: form.elements.email,
    phone: form.elements.phone,
    service: form.elements.service,
    barber: form.elements.barber,
    date: form.elements.date,
    time: form.elements.time,
    notes: form.elements.notes,
    submit: form.querySelector("button[type=submit]"),
    slots: document.getElementById("slot-grid"),
    slotHint: document.getElementById("slot-hint"),
    summary: document.getElementById("booking-summary"),
    alert: document.getElementById("booking-alert"),
    dev: document.getElementById("dev-zone")
  };

  const state = { services: [], barbers: [], usingCatalog: false, submitting: false, slotReq: 0 };
  const params = new URLSearchParams(location.search);

  els.date.min = Utils.todayISO();
  Utils.devBanner(els.dev, "The booking form shows our published menu, but bookings and live availability need the n8n backend. Set API_URL in js/config.js.");

  /* ---- Load services & barbers ---- */
  async function loadCatalog() {
    try {
      const [services, barbers] = await Promise.all([API.get("services"), API.get("barbers")]);
      state.services = (services || []).filter(s => s.active !== false && String(s.active).toLowerCase() !== "false");
      state.barbers = (barbers || []).filter(b => b.active !== false && String(b.active).toLowerCase() !== "false");
    } catch (err) {
      state.usingCatalog = true;
      state.services = CONFIG.CATALOG.services;
      state.barbers = CONFIG.CATALOG.barbers;
      if (err.code !== "DEV_MODE") Toast.show("Live services couldn't be loaded — showing our published menu.", "warn");
    }
    renderOptions();
  }

  function renderOptions() {
    els.service.innerHTML = `<option value="">Select a service</option>` + state.services.map(s =>
      `<option value="${Utils.escape(s.id)}">${Utils.escape(s.name)} — ${Utils.money(s.price)}</option>`).join("");
    els.barber.innerHTML = `<option value="">Select a barber</option><option value="any">No preference (first available)</option>` +
      state.barbers.map(b => `<option value="${Utils.escape(b.id)}">${Utils.escape(b.name)}${b.title ? " · " + Utils.escape(b.title) : ""}</option>`).join("");

    if (params.get("service")) els.service.value = params.get("service");
    if (params.get("barber")) els.barber.value = params.get("barber");
    updateSummary();
  }

  const selectedService = () => state.services.find(s => s.id === els.service.value);
  const selectedBarber = () => state.barbers.find(b => b.id === els.barber.value);

  function updateSummary() {
    const s = selectedService();
    const b = selectedBarber();
    const rows = [
      ["Service", s ? Utils.escape(s.name) : "—"],
      ["Duration", s ? Utils.duration(s.duration) : "—"],
      ["Barber", els.barber.value === "any" ? "First available" : b ? Utils.escape(b.name) : "—"],
      ["Date", els.date.value ? Utils.formatDate(els.date.value) : "—"],
      ["Time", els.time.value ? Utils.formatTime(els.time.value) : "—"]
    ];
    els.summary.innerHTML = `
      <dl class="summary-list">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      <div class="summary-total"><span>Total</span><strong>${s ? Utils.money(s.price) : Utils.money(0)}</strong></div>
      <p class="summary-note">Pay in studio. Free cancellation up to 2 hours before.</p>`;
  }

  /* ---- Time slots ---- */
  async function loadSlots() {
    els.time.value = "";
    updateSummary();
    const s = selectedService();
    if (!s || !els.barber.value || !els.date.value) {
      els.slots.innerHTML = "";
      els.slotHint.textContent = "Choose a service, barber and date to see available times.";
      return;
    }
    if (els.date.value < Utils.todayISO()) {
      els.slots.innerHTML = "";
      els.slotHint.textContent = "Please choose today or a future date.";
      return;
    }
    const reqId = ++state.slotReq;
    els.slotHint.textContent = "";
    els.slots.innerHTML = `<div class="slot-loading"><span class="spinner"></span> Checking availability…</div>`;
    try {
      const data = await API.post("slots", { serviceId: s.id, barberId: els.barber.value, date: els.date.value, duration: Number(s.duration) });
      if (reqId !== state.slotReq) return;
      const slots = Array.isArray(data) ? data : (data && data.slots) || [];
      const now = new Date();
      const isToday = els.date.value === Utils.todayISO();
      const usable = slots.filter(t => {
        const time = typeof t === "string" ? t : t.time;
        if (!isToday) return true;
        const [h, m] = time.split(":").map(Number);
        return h * 60 + m > now.getHours() * 60 + now.getMinutes() + 15;
      });
      if (!usable.length) {
        els.slots.innerHTML = "";
        els.slotHint.textContent = "No times available on this date. Please try another day or barber.";
        return;
      }
      els.slots.innerHTML = usable.map(t => {
        const time = typeof t === "string" ? t : t.time;
        const available = typeof t === "string" ? true : t.available !== false;
        return `<button type="button" class="slot" data-time="${Utils.escape(time)}" ${available ? "" : "disabled"}>${Utils.formatTime(time)}</button>`;
      }).join("");
    } catch (err) {
      if (reqId !== state.slotReq) return;
      els.slots.innerHTML = "";
      if (err.code === "DEV_MODE") {
        els.slotHint.innerHTML = `<span class="text-warn">Development mode: live availability requires the n8n backend.</span>`;
      } else {
        els.slotHint.innerHTML = `<span class="text-error">${Utils.escape(err.message)}</span> <button type="button" class="btn btn--ghost btn--sm" id="slot-retry">↻ Retry</button>`;
        document.getElementById("slot-retry").addEventListener("click", loadSlots, { once: true });
      }
    }
  }

  els.slots.addEventListener("click", e => {
    const b = e.target.closest(".slot");
    if (!b || b.disabled) return;
    Utils.$$(".slot", els.slots).forEach(x => x.classList.remove("is-selected"));
    b.classList.add("is-selected");
    els.time.value = b.dataset.time;
    Utils.fieldError(els.time, "");
    updateSummary();
  });

  [els.service, els.barber, els.date].forEach(el => el.addEventListener("change", loadSlots));
  els.date.addEventListener("change", () => {
    if (els.date.value && els.date.value < Utils.todayISO()) Utils.fieldError(els.date, "Past dates can't be booked.");
  });

  /* ---- Validation ---- */
  function validate() {
    Utils.clearErrors(form);
    const errs = [];
    const req = (el, ok, msg) => { if (!ok) { Utils.fieldError(el, msg); errs.push(el); } };
    req(els.name, els.name.value.trim().length >= 2, "Please enter your full name.");
    req(els.email, Utils.isEmail(els.email.value), "Enter a valid email address.");
    req(els.phone, Utils.isPhone(els.phone.value), "Enter a valid phone number.");
    req(els.service, !!selectedService(), "Please choose a service.");
    req(els.barber, !!els.barber.value, "Please choose a barber.");
    req(els.date, !!els.date.value && els.date.value >= Utils.todayISO(), "Choose today or a future date.");
    req(els.time, !!els.time.value, "Please pick an available time.");
    if (errs.length) {
      const first = errs[0];
      if (first.type === "hidden") els.slots.closest(".field").scrollIntoView({ behavior: "smooth", block: "center" });
      else first.focus();
    }
    return !errs.length;
  }

  ["input", "change"].forEach(evt => form.addEventListener(evt, e => {
    if (e.target.closest(".field.has-error")) Utils.fieldError(e.target, "");
  }));

  /* ---- Submit ---- */
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (state.submitting) return;
    els.alert.className = "form-alert";
    els.alert.textContent = "";
    if (!validate()) return;

    const s = selectedService();
    const payload = {
      customerName: els.name.value.trim(),
      email: els.email.value.trim().toLowerCase(),
      phone: els.phone.value.trim(),
      serviceId: s.id,
      serviceName: s.name,
      price: Number(s.price),
      duration: Number(s.duration),
      barberId: els.barber.value,
      date: els.date.value,
      time: els.time.value,
      notes: els.notes.value.trim(),
      source: "website",
      returnUrl: location.href.split("#")[0].split("?")[0],
      clientRequestId: state.requestId || (state.requestId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()))
    };

    state.submitting = true;
    Utils.setLoading(els.submit, true, "Booking…");
    try {
      const res = await API.post("createBooking", payload);
      if (!res || !res.appointmentId) throw new ApiError("The server did not confirm your booking. Please contact the studio.", { code: "NO_ID" });
      state.requestId = null;
      showConfirmation(res, payload);
      els.alert.className = "form-alert form-alert--ok";
      els.alert.innerHTML = `Booked! Your appointment ID is <strong>${Utils.escape(res.appointmentId)}</strong>. <a href="my-bookings.html?id=${encodeURIComponent(res.appointmentId)}">Manage it</a>`;
      form.reset();
      els.slots.innerHTML = "";
      els.slotHint.textContent = "Choose a service, barber and date to see available times.";
      updateSummary();
    } catch (err) {
      els.alert.className = `form-alert ${err.code === "DEV_MODE" ? "form-alert--warn" : "form-alert--error"}`;
      els.alert.textContent = err.status === 409 ? "That time was just taken. Please choose another slot." : err.message;
      const fieldErrs = err.details && err.details.errors;
      if (fieldErrs) {
        const map = { customerName: els.name, email: els.email, phone: els.phone, serviceId: els.service, barberId: els.barber, date: els.date, time: els.time };
        Object.keys(fieldErrs).forEach(k => { if (map[k]) Utils.fieldError(map[k], fieldErrs[k]); });
      }
      if (err.status === 409) loadSlots();
      els.alert.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      state.submitting = false;
      Utils.setLoading(els.submit, false);
    }
  });

  function showConfirmation(res, p) {
    const barberName = res.barberName || (selectedBarber() && selectedBarber().name) || "First available";
    Modal.open({
      title: "Booking confirmed",
      size: "md",
      body: `
        <div class="confirm">
          <div class="confirm__check" aria-hidden="true">✓</div>
          <p class="confirm__lead">Thank you, ${Utils.escape(p.customerName.split(" ")[0])}. Your chair is reserved.</p>
          <div class="confirm__id"><span>Appointment ID</span><strong>${Utils.escape(res.appointmentId)}</strong>
            <button type="button" class="btn btn--ghost btn--sm" id="copy-id">Copy</button></div>
          <dl class="summary-list">
            <div><dt>Service</dt><dd>${Utils.escape(p.serviceName)}</dd></div>
            <div><dt>Barber</dt><dd>${Utils.escape(barberName)}</dd></div>
            <div><dt>When</dt><dd>${Utils.formatDate(p.date)} · ${Utils.formatTime(p.time)}</dd></div>
            <div><dt>Total</dt><dd>${Utils.money(p.price)}</dd></div>
          </dl>
          ${res.checkoutUrl ? `
          <div class="pay-box">
            <div><strong>Pay online now</strong><span>Secure checkout by Stripe · <em>TEST MODE</em> — no real charge. Use card 4242 4242 4242 4242, any future date and CVC.</span></div>
            <a class="btn btn--gold" href="${Utils.escape(res.checkoutUrl)}" rel="noopener">Pay ${Utils.money(p.price)}</a>
          </div>` : (res.paymentNote ? `<p class="summary-note">${Utils.escape(res.paymentNote)}</p>` : "")}
          <p class="summary-note">${res.emailSent === false ? "We couldn't send the confirmation email, so please note your appointment ID." : "A confirmation has been sent to " + Utils.escape(p.email) + "."} Keep your appointment ID to manage this booking.</p>
        </div>`,
      actions: [
        { label: "Manage booking", variant: "ghost", onClick: () => { location.href = `my-bookings.html?id=${encodeURIComponent(res.appointmentId)}`; } },
        { label: res.checkoutUrl ? "Pay later at the studio" : "Done", variant: res.checkoutUrl ? "ghost" : "gold" }
      ],
      onOpen: o => o.querySelector("#copy-id").addEventListener("click", async e => {
        try { await navigator.clipboard.writeText(res.appointmentId); e.target.textContent = "Copied"; } catch { e.target.textContent = "Copy failed"; }
      })
    });
  }

  loadCatalog();
});
