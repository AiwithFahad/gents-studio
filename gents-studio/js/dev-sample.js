/* GENT'S STUDIO — DEVELOPMENT SAMPLE DATA (admin preview only)
 * ---------------------------------------------------------------
 * Used ONLY when the n8n backend is NOT configured AND the admin chose
 * "Preview with sample data" on the login page. Every screen using it shows a
 * "SAMPLE DATA" banner. It is read-only: any create/update/delete is refused
 * with a development-mode error, so nothing pretends to be saved.
 * Remove this file (and its <script> tag) once the backend is live if you wish.
 */
const DevSample = (() => {
  // Deterministic pseudo-random generator so the preview looks the same each load
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  const services = CONFIG.CATALOG.services.map(s => ({ ...s, active: true }));
  const barbers = CONFIG.CATALOG.barbers.map(b => ({ ...b, active: true, email: b.name.split(" ")[0].toLowerCase() + "@gentsstudio.com" }));
  const people = [
    ["James Walker", "james.w@example.com", "+1 555 201 1001"], ["Arjun Patel", "arjun.p@example.com", "+1 555 201 1002"],
    ["Michael Ross", "m.ross@example.com", "+1 555 201 1003"], ["Daniel Kim", "dkim@example.com", "+1 555 201 1004"],
    ["Hassan Ali", "hassan.ali@example.com", "+1 555 201 1005"], ["Lucas Brown", "lucas.b@example.com", "+1 555 201 1006"],
    ["Ethan Clarke", "ethan.c@example.com", "+1 555 201 1007"], ["Noah Wilson", "noah.w@example.com", "+1 555 201 1008"],
    ["Ali Raza", "ali.raza@example.com", "+1 555 201 1009"], ["Oliver Grant", "o.grant@example.com", "+1 555 201 1010"],
    ["Samuel Ortiz", "sam.ortiz@example.com", "+1 555 201 1011"], ["Ryan Murphy", "ryan.m@example.com", "+1 555 201 1012"]
  ];
  const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };

  const appointments = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 140; i++) {
    const offset = Math.floor(rnd() * 190) - 170;            // ~6 months back, 3 weeks ahead
    const d = new Date(today); d.setDate(d.getDate() + offset);
    const s = pick(services), b = pick(barbers), p = pick(people);
    const hour = 9 + Math.floor(rnd() * 10), min = rnd() > .5 ? "30" : "00";
    let status;
    if (offset < 0) status = rnd() < .8 ? "completed" : rnd() < .7 ? "cancelled" : "no-show";
    else if (offset === 0) status = rnd() < .6 ? "confirmed" : "pending";
    else status = rnd() < .55 ? "confirmed" : rnd() < .85 ? "pending" : "cancelled";
    const date = iso(d);
    appointments.push({
      appointmentId: `GS-${date.replace(/-/g, "")}-${String(1000 + i)}`,
      customerName: p[0], email: p[1], phone: p[2],
      serviceId: s.id, serviceName: s.name, price: s.price, duration: s.duration,
      barberId: b.id, barberName: b.name, date, time: `${String(hour).padStart(2, "0")}:${min}`,
      status, notes: rnd() < .15 ? "Prefers scissors over clippers on top." : "", source: rnd() < .8 ? "website" : "admin",
      createdAt: new Date(d.getTime() - 86400000 * (1 + Math.floor(rnd() * 6))).toISOString()
    });
  }

  function customers() {
    const map = new Map();
    appointments.forEach(a => {
      const k = a.email.toLowerCase();
      const c = map.get(k) || { name: a.customerName, email: a.email, phone: a.phone, totalBookings: 0, totalSpent: 0, firstVisit: a.date, lastVisit: a.date };
      c.totalBookings++;
      if (a.status === "completed") c.totalSpent += Number(a.price);
      if (a.date < c.firstVisit) c.firstVisit = a.date;
      if (a.date > c.lastVisit) c.lastVisit = a.date;
      map.set(k, c);
    });
    return [...map.values()].sort((x, y) => y.lastVisit.localeCompare(x.lastVisit));
  }

  const readOnly = () => { throw new ApiError("Preview mode: this is sample data, so changes are not saved. Connect the n8n backend (js/config.js) to make real changes.", { code: "DEV_MODE" }); };

  async function handle(key, body = {}) {
    await new Promise(r => setTimeout(r, 250));               // mimic network latency so loaders are visible
    const copy = x => JSON.parse(JSON.stringify(x));
    switch (key) {
      case "verify": return { valid: true };
      case "adminAppointments": return copy(appointments);
      case "adminCustomers": return customers();
      case "adminServices": return copy(services);
      case "adminBarbers": return copy(barbers);
      case "adminStats": return Analytics.dashboard(appointments, customers().length);
      case "adminAnalytics": return Analytics.report(appointments, body.range);
      case "adminSettings":
        if (body.action === "save") return readOnly();
        return { studioName: CONFIG.APP_NAME, contactEmail: CONFIG.CONTACT.email, phone: CONFIG.CONTACT.phone, address: CONFIG.CONTACT.address, timezone: "Asia/Karachi", openTime: "09:00", closeTime: "20:00", slotInterval: "30", bufferMinutes: "0" };
      default: return readOnly();
    }
  }
  return { handle };
})();
