/* GENT'S STUDIO — My Bookings (customer self-service).
 * Lookup requires BOTH the appointment ID and the email/phone used to book.
 * The backend must verify the pair and return only that customer's data.
 */
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("lookup-form");
  if (!form) return;

  const result = document.getElementById("lookup-result");
  const btn = form.querySelector("button[type=submit]");
  const alertBox = document.getElementById("lookup-alert");
  Utils.devBanner(document.getElementById("dev-zone"), "Looking up, changing or cancelling bookings needs the n8n backend. Set API_URL in js/config.js.");

  let current = null;
  let pendingNotice = null;   // message to keep visible after an automatic lookup       // { appointment, history, identity }
  let catalog = { services: CONFIG.CATALOG.services, barbers: CONFIG.CATALOG.barbers };

  const qs = new URLSearchParams(location.search);
  const idParam = qs.get("id");
  if (idParam) form.elements.appointmentId.value = idParam;

  /* Returning from Stripe Checkout (test mode) */
  if (qs.get("paid") === "0") {
    alertBox.className = "form-alert form-alert--warn";
    alertBox.textContent = "Payment was cancelled. Your booking is still reserved — you can pay online later or at the studio.";
  }
  const sessionId = qs.get("session_id");
  if (qs.get("paid") === "1" && sessionId && idParam) {
    alertBox.className = "form-alert form-alert--warn";
    alertBox.textContent = "Confirming your payment with Stripe…";
    const confirmPayment = async (attempt = 1) => {
      try {
        await API.post("verifyPayment", { appointmentId: idParam, sessionId });
        alertBox.className = "form-alert form-alert--ok";
        alertBox.textContent = "Payment received (Stripe test mode). Thank you! A receipt has been emailed to you.";
        pendingNotice = { cls: alertBox.className, text: alertBox.textContent };
        const saved = sessionStorage.getItem("gs_pay_identity");
        if (saved) { form.elements.identity.value = saved; sessionStorage.removeItem("gs_pay_identity"); form.requestSubmit(); }
        history.replaceState(null, "", location.pathname + "?id=" + encodeURIComponent(idParam));
      } catch (err) {
        if (err.code === "NOT_PAID" && attempt < 4) { setTimeout(() => confirmPayment(attempt + 1), 2500); return; }
        alertBox.className = "form-alert form-alert--error";
        alertBox.textContent = err.code === "NOT_PAID" ? "Stripe hasn't confirmed the payment yet. Refresh this page in a minute." : err.message;
      }
    };
    confirmPayment();
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (btn.disabled) return;
    Utils.clearErrors(form);
    alertBox.className = "form-alert"; alertBox.textContent = "";
    const id = form.elements.appointmentId.value.trim().toUpperCase();
    const identity = form.elements.identity.value.trim();
    let ok = true;
    if (!/^[A-Z0-9-]{4,30}$/.test(id)) { Utils.fieldError(form.elements.appointmentId, "Enter the appointment ID from your confirmation."); ok = false; }
    if (!Utils.isEmail(identity) && !Utils.isPhone(identity)) { Utils.fieldError(form.elements.identity, "Enter the email or phone you booked with."); ok = false; }
    if (!ok) return;

    Utils.setLoading(btn, true, "Searching…");
    result.innerHTML = "";
    try {
      const data = await API.post("lookupBooking", { appointmentId: id, identity: identity.toLowerCase() });
      if (!data || !data.appointment) throw new ApiError("We couldn't find a booking matching those details.", { status: 404 });
      current = { appointment: data.appointment, history: data.history || [], identity: identity.toLowerCase() };
      render();
      if (pendingNotice) { alertBox.className = pendingNotice.cls; alertBox.textContent = pendingNotice.text; pendingNotice = null; }
    } catch (err) {
      alertBox.className = `form-alert ${err.code === "DEV_MODE" ? "form-alert--warn" : "form-alert--error"}`;
      alertBox.textContent = err.status === 404 || err.status === 403
        ? "We couldn't find a booking matching that ID and contact. Please check both and try again."
        : err.status === 429 ? "Too many attempts. Please wait a few minutes before trying again." : err.message;
      if (["NETWORK", "TIMEOUT", "SERVER_ERROR"].includes(err.code)) {
        const r = document.createElement("button");
        r.type = "button"; r.className = "btn btn--ghost btn--sm"; r.style.marginLeft = "8px"; r.textContent = "↻ Retry";
        r.addEventListener("click", () => form.requestSubmit(), { once: true });
        alertBox.appendChild(r);
      }
    } finally {
      Utils.setLoading(btn, false);
    }
  });

  function render() {
    const a = current.appointment;
    const status = String(a.status || "pending").toLowerCase();
    const editable = !["cancelled", "completed", "deleted", "no-show"].includes(status);
    result.innerHTML = `
      <article class="appt-card reveal is-in">
        <header class="appt-card__head">
          <div><p class="eyebrow">Appointment</p><h2>${Utils.escape(a.appointmentId)}</h2></div>
          ${Utils.statusBadge(status)}
        </header>
        <div class="appt-card__grid">
          <div><span>Customer</span><strong>${Utils.escape(a.customerName)}</strong></div>
          <div><span>Service</span><strong>${Utils.escape(a.serviceName)}</strong></div>
          <div><span>Barber</span><strong>${Utils.escape(a.barberName || "First available")}</strong></div>
          <div><span>Date</span><strong>${Utils.formatDate(a.date)}</strong></div>
          <div><span>Time</span><strong>${Utils.formatTime(a.time)}</strong></div>
          <div><span>Price</span><strong>${Utils.money(a.price)}</strong></div>
          <div><span>Payment</span><strong class="pay-status pay-status--${Utils.escape(a.paymentStatus || "n/a")}">${a.paymentStatus === "paid" ? "Paid" : a.paymentStatus === "unpaid" ? "Unpaid (pay at studio or online)" : "—"}</strong></div>
        </div>
        ${a.notes ? `<p class="appt-card__notes"><span>Notes</span>${Utils.escape(a.notes)}</p>` : ""}
        <div class="appt-card__actions">
          ${editable && a.paymentStatus === "unpaid" && Number(a.price) > 0 ? `<button class="btn btn--gold" data-act="pay">Pay ${Utils.money(a.price)} online (test mode)</button>` : ""}
          ${editable ? `
            <button class="btn ${a.paymentStatus === "unpaid" ? "btn--outline" : "btn--gold"}" data-act="edit">Change booking</button>
            <button class="btn btn--outline" data-act="cancel">Cancel appointment</button>` : ""}
          ${status !== "deleted" ? `<button class="btn btn--ghost btn--danger-text" data-act="delete">Remove from my bookings</button>` : ""}
        </div>
      </article>
      <section class="history">
        <h3>Appointment history</h3>
        ${current.history.length ? `<ol class="timeline">${current.history.map(h => `
          <li><span class="timeline__dot"></span>
            <div><strong>${Utils.escape(h.action || h.status)}</strong>
            <p>${Utils.escape(h.details || "")}</p>
            <time>${Utils.escape(h.timestamp ? new Date(h.timestamp).toLocaleString() : "")}</time></div></li>`).join("")}</ol>`
          : `<p class="muted">No changes recorded yet.</p>`}
      </section>`;
  }

  result.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]");
    if (!b || !current) return;
    const act = b.dataset.act;
    const a = current.appointment;
    if (act === "edit") return openEdit();
    if (act === "pay") {
      Utils.setLoading(b, true, "Opening secure checkout…");
      try {
        const data = await API.post("createPayment", { appointmentId: a.appointmentId, identity: current.identity, returnUrl: location.href.split("#")[0].split("?")[0] });
        if (!data || !data.checkoutUrl) throw new ApiError((data && data.paymentNote) || "Online payment is not available right now.", { code: "NO_CHECKOUT" });
        sessionStorage.setItem("gs_pay_identity", current.identity);
        location.href = data.checkoutUrl;
      } catch (err) { Toast.error(err); Utils.setLoading(b, false); }
      return;
    }

    if (act === "cancel") {
      const yes = await Modal.confirm({ title: "Cancel this appointment?", message: `Your ${a.serviceName} on ${Utils.formatDate(a.date)} at ${Utils.formatTime(a.time)} will be cancelled. This cannot be undone.`, confirmLabel: "Yes, cancel it" });
      if (!yes) return;
      await mutate(b, "cancelBooking", {}, "Appointment cancelled.");
    }
    if (act === "delete") {
      const yes = await Modal.confirm({ title: "Remove this booking?", message: "It will be hidden from your bookings. If it's still upcoming, it will also be cancelled.", confirmLabel: "Remove" });
      if (!yes) return;
      await mutate(b, "deleteBooking", {}, "Booking removed.", true);
    }
  });

  async function mutate(button, endpoint, extra, okMsg, clearAfter = false) {
    Utils.setLoading(button, true, "Working…");
    try {
      const data = await API.post(endpoint, { appointmentId: current.appointment.appointmentId, identity: current.identity, ...extra });
      Toast.show(okMsg, "success");
      if (clearAfter) { result.innerHTML = `<p class="muted center">This booking has been removed.</p>`; current = null; return; }
      if (data && data.appointment) { current.appointment = data.appointment; current.history = data.history || current.history; }
      render();
    } catch (err) {
      Toast.error(err);
    } finally {
      if (document.body.contains(button)) Utils.setLoading(button, false);
    }
  }

  async function openEdit() {
    try {
      const [services, barbers] = await Promise.all([API.get("services"), API.get("barbers")]);
      catalog = { services: services.filter(s => String(s.active) !== "false"), barbers: barbers.filter(b => String(b.active) !== "false") };
    } catch (err) {
      if (err.code === "DEV_MODE") return Toast.error(err);
      Toast.show("Couldn't load the latest services — showing our published menu.", "warn");
    }
    const a = current.appointment;
    const body = document.createElement("form");
    body.className = "form-grid";
    body.noValidate = true;
    body.innerHTML = `
      <div class="field"><label>Service</label><select name="service">${catalog.services.map(s => `<option value="${Utils.escape(s.id)}" ${s.id === a.serviceId ? "selected" : ""}>${Utils.escape(s.name)} — ${Utils.money(s.price)}</option>`).join("")}</select></div>
      <div class="field"><label>Barber</label><select name="barber"><option value="any">First available</option>${catalog.barbers.map(b => `<option value="${Utils.escape(b.id)}" ${b.id === a.barberId ? "selected" : ""}>${Utils.escape(b.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Date</label><input type="date" name="date" min="${Utils.todayISO()}" value="${Utils.escape(a.date)}"></div>
      <div class="field"><label>Time</label><select name="time"><option value="${Utils.escape(a.time)}">${Utils.formatTime(a.time)} (current)</option></select></div>
      <p class="field--full muted" id="edit-hint">Change service, barber or date to reload available times.</p>`;

    const reload = async () => {
      const svc = catalog.services.find(s => s.id === body.elements.service.value);
      const hint = body.querySelector("#edit-hint");
      if (!body.elements.date.value || body.elements.date.value < Utils.todayISO()) { hint.textContent = "Please choose today or a future date."; return; }
      hint.textContent = "Checking availability…";
      try {
        const data = await API.post("slots", { serviceId: svc.id, barberId: body.elements.barber.value, date: body.elements.date.value, duration: Number(svc.duration), excludeAppointmentId: a.appointmentId });
        const slots = (Array.isArray(data) ? data : data.slots || []).map(t => typeof t === "string" ? { time: t, available: true } : t).filter(t => t.available !== false);
        body.elements.time.innerHTML = slots.length ? slots.map(t => `<option value="${t.time}">${Utils.formatTime(t.time)}</option>`).join("") : `<option value="">No times available</option>`;
        hint.textContent = slots.length ? `${slots.length} times available.` : "No times on this date — try another.";
      } catch (err) {
        hint.innerHTML = `<span class="text-error">${Utils.escape(err.message)}</span> <button type="button" class="btn btn--ghost btn--sm">↻ Retry</button>`;
        hint.querySelector("button").addEventListener("click", reload, { once: true });
      }
    };
    ["service", "barber", "date"].forEach(n => body.elements[n].addEventListener("change", reload));
    if (!catalog.services.some(s => s.id === a.serviceId)) body.querySelector("#edit-hint").textContent = "Your current service is no longer offered — please choose another.";

    Modal.open({
      title: "Change booking", size: "md", body,
      actions: [
        { label: "Keep as is", variant: "ghost" },
        { label: "Save changes", variant: "gold", onClick: async btn => {
          const svc = catalog.services.find(s => s.id === body.elements.service.value);
          if (!body.elements.time.value) return Toast.show("Please choose an available time.", "warn");
          if (body.elements.date.value < Utils.todayISO()) return Toast.show("Please choose a future date.", "warn");
          Utils.setLoading(btn, true, "Saving…");
          try {
            const data = await API.post("updateBooking", {
              appointmentId: a.appointmentId, identity: current.identity,
              serviceId: svc.id, serviceName: svc.name, price: Number(svc.price), duration: Number(svc.duration),
              barberId: body.elements.barber.value, date: body.elements.date.value, time: body.elements.time.value
            });
            if (data && data.appointment) { current.appointment = data.appointment; current.history = data.history || current.history; }
            Modal.close(); render(); Toast.show("Your booking has been updated.", "success");
          } catch (err) {
            Toast.error(err.status === 409 ? new Error("That time was just taken. Please pick another.") : err);
          } finally { Utils.setLoading(btn, false); }
        } }
      ]
    });
  }
});
