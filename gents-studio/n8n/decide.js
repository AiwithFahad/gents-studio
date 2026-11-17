// NODE: "Decide Action" (Code, run once for all items)
// Pure business logic. Reads the whole DB snapshot (one Sheets batchGet), validates
// the request, enforces auth/ownership, and emits a PLAN:
//   calendarOp: 'final' | 'create' | 'update' | 'delete' | 'none'
//   calendar:   { eventId, start, end, summary, description }
//   stripe:     { kind: 'create'|'retrieve'|'none', ... }
//   writes:     { updates: [{range, values}], appends: [{sheet, values}] }
//   emails:     [{ to, subject, html }]
//   ok:         { status, body }   -> response if every side effect succeeds
// Nothing is written here; downstream nodes execute the plan in a safe order.
const crypto = require('crypto');
const input = $('Config & Parse Request').first().json;
const cfg = input.cfg, req = input.req, B = req.body || {};
const load = $input.first().json;

const respond = (status, body) => [{ json: { calendarOp: 'final', status, body } }];
const fail = (status, code, message, extra) => respond(status, Object.assign({ success: false, code, message }, extra || {}));
const okNow = (data, message, status) => respond(status || 200, { success: true, message: message || 'OK', data });

if (req.parseError) return fail(400, 'BAD_REQUEST', req.parseError);
if (!load || Number(load.statusCode) !== 200 || !load.body || !Array.isArray(load.body.valueRanges)) {
  return fail(503, 'DB_UNAVAILABLE', 'The booking database is temporarily unavailable. Please try again in a moment.');
}

/* ---------- Load tables ---------- */
const TABS = ['Appointments', 'Services', 'Barbers', 'Customers', 'Admins', 'Sessions', 'ActivityLogs', 'Settings'];
const T = {};
load.body.valueRanges.forEach((vr, i) => {
  const name = TABS[i];
  const values = vr.values || [];
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = values.slice(1).map((r, idx) => {
    const o = { _row: idx + 2 };
    headers.forEach((h, c) => { o[h] = r[c] === undefined ? '' : r[c]; });
    return o;
  }).filter(o => headers.some(h => String(o[h]).trim() !== ''));
  T[name] = { headers, rows };
});
for (const n of TABS) if (!T[n] || !T[n].headers.length) return fail(500, 'DB_SCHEMA', 'Database tab "' + n + '" is missing or has no header row.');

/* ---------- Helpers ---------- */
const nowIso = new Date().toISOString();
const S = {}; T.Settings.rows.forEach(r => { S[String(r.key)] = String(r.value); });
const TZ = S.timezone || cfg.timezone;
const bool = v => v === true || /^(true|yes|1)$/i.test(String(v).trim());
const str = v => String(v === undefined || v === null ? '' : v).trim();
const num = v => { const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const pad = n => String(n).padStart(2, '0');
const normTime = v => { const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? pad(+m[1]) + ':' + m[2] : ''; };
const normDate = v => { const s = String(v || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(s); return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const toMin = t => { const m = normTime(t).split(':'); return m.length === 2 ? (+m[0]) * 60 + (+m[1]) : NaN; };
const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str(v));
const digits = v => String(v || '').replace(/\D/g, '');
const isPhone = v => /^[+()\-\s\d]{7,20}$/.test(str(v)) && digits(v).length >= 7;
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = n => crypto.randomBytes(n).toString('hex');
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + num(n).toFixed(num(n) % 1 ? 2 : 0);
function localNow() {
  const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, min: (+p.hour) * 60 + (+p.minute) };
}
const NOW = localNow();
function offsetFor(date, time) {
  const utc = new Date(date + 'T' + time + ':00Z');
  const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(utc).forEach(x => { p[x.type] = x.value; });
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const off = Math.round((asLocal - utc.getTime()) / 60000);
  const sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}
const isoLocal = (date, time) => date + 'T' + time + ':00' + offsetFor(date, time);
const weekday = date => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
const prettyDate = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const prettyTime = t => { const m = toMin(t); const h = Math.floor(m / 60); return ((h + 11) % 12 + 1) + ':' + pad(m % 60) + ' ' + (h >= 12 ? 'PM' : 'AM'); };
const newId = (prefix, table, col) => {
  for (let i = 0; i < 20; i++) {
    const id = prefix + '-' + rand(3).toUpperCase();
    if (!table || !T[table].rows.some(r => str(r[col]) === id)) return id;
  }
  return prefix + '-' + rand(6).toUpperCase();
};
const INACTIVE = ['cancelled', 'deleted', 'no-show'];
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show', 'deleted'];

/* ---------- Row <-> sheet ---------- */
const rowArray = (tab, obj) => T[tab].headers.map(h => obj[h] === undefined || obj[h] === null ? '' : obj[h]);
const writes = { updates: [], appends: [] };
const updateRow = (tab, rowObj) => writes.updates.push({ range: tab + '!A' + rowObj._row, values: [rowArray(tab, rowObj)] });
const appendRow = (tab, obj) => { let g = writes.appends.find(a => a.sheet === tab); if (!g) { g = { sheet: tab, values: [] }; writes.appends.push(g); } g.values.push(rowArray(tab, obj)); };
const log = (actor, action, entity, entityId, details) => appendRow('ActivityLogs', { log_id: newId('LOG', 'ActivityLogs', 'log_id'), timestamp: nowIso, actor, action, entity, entity_id: entityId, details: typeof details === 'string' ? details : JSON.stringify(details || {}) });

/* ---------- Domain mapping ---------- */
const services = T.Services.rows.map(r => ({ _r: r, id: str(r.service_id), name: str(r.name), description: str(r.description), category: str(r.category), price: num(r.price), duration: num(r.duration), active: bool(r.active) }));
const barbers = T.Barbers.rows.map(r => ({ _r: r, id: str(r.barber_id), name: str(r.name), title: str(r.title), email: str(r.email), years: num(r.years),
  specialties: str(r.specialties).split(',').map(s => s.trim()).filter(Boolean), workingDays: str(r.working_days || 'Mon,Tue,Wed,Thu,Fri,Sat').split(',').map(s => s.trim().slice(0, 3)),
  startTime: normTime(r.start_time) || normTime(S.openTime) || '09:00', endTime: normTime(r.end_time) || normTime(S.closeTime) || '20:00', active: bool(r.active) }));
const pubService = s => ({ id: s.id, name: s.name, description: s.description, category: s.category, price: s.price, duration: s.duration, active: s.active });
const pubBarber = b => ({ id: b.id, name: b.name, title: b.title, email: b.email, years: b.years, specialties: b.specialties, workingDays: b.workingDays, startTime: b.startTime, endTime: b.endTime, active: b.active });
const appts = T.Appointments.rows;
const apptOut = r => ({
  appointmentId: str(r.appointment_id), appointment_id: str(r.appointment_id), customerId: str(r.customer_id), customerName: str(r.customer_name), email: str(r.email), phone: str(r.phone),
  serviceId: str(r.service_id), serviceName: str(r.service_name), barberId: str(r.barber_id), barberName: str(r.barber_name),
  date: normDate(r.appointment_date), time: normTime(r.start_time), endTime: normTime(r.end_time), duration: num(r.duration), price: num(r.price),
  status: str(r.status).toLowerCase() || 'pending', paymentStatus: str(r.payment_status) || 'n/a', notes: str(r.notes), source: str(r.source),
  createdAt: str(r.created_at), updatedAt: str(r.updated_at)
});
const historyFor = id => T.ActivityLogs.rows.filter(l => str(l.entity_id) === id && str(l.entity) === 'appointment')
  .map(l => { let d = {}; try { d = JSON.parse(l.details || '{}'); } catch (e) { d = { note: str(l.details) }; } return { action: str(l.action).replace(/_/g, ' '), details: d.summary || d.note || '', timestamp: str(l.timestamp) }; })
  .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
const findAppt = id => appts.find(r => str(r.appointment_id).toUpperCase() === str(id).toUpperCase());

/* ---------- Auth ---------- */
let admin = null, session = null;
if (req.token && /^[a-f0-9]{64}$/i.test(req.token)) {
  const th = sha256(req.token);
  session = T.Sessions.rows.find(s => str(s.token_hash) === th && !str(s.revoked_at) && Date.parse(s.expires_at) > Date.now()) || null;
  if (session) admin = T.Admins.rows.find(a => str(a.admin_id) === str(session.admin_id) && bool(a.active)) || null;
  if (!admin) session = null;
}
const requireAdmin = () => admin ? null : fail(401, 'UNAUTHORIZED', req.token ? 'Your session has expired. Please log in again.' : 'Admin login required.');
const identityMatches = (r, identity) => {
  const id = str(identity).toLowerCase();
  if (!id) return false;
  if (id.includes('@')) return str(r.email).toLowerCase() === id;
  const d = digits(id);
  return d.length >= 7 && digits(r.phone) === d;
};
/* Resolve an appointment for the caller: admin, or customer proving identity. Generic 404 avoids leaking existence. */
function ownAppt(allowDeleted) {
  const r = findAppt(B.appointmentId);
  const notFound = fail(404, 'NOT_FOUND', "We couldn't find a booking matching those details.");
  if (!str(B.appointmentId)) return { err: fail(400, 'VALIDATION', 'appointmentId is required.') };
  if (!r) return { err: notFound };
  if (admin) return { r, actor: 'admin:' + admin.email };
  if (!identityMatches(r, B.identity)) return { err: notFound };
  if (!allowDeleted && (str(r.status).toLowerCase() === 'deleted' || str(r.deleted_at))) return { err: notFound };
  return { r, actor: 'customer:' + str(r.email).toLowerCase() };
}

/* ---------- Availability ---------- */
const BUFFER = num(S.bufferMinutes);
const STEP = Math.max(5, num(S.slotInterval) || 30);
function busyFor(barberId, date, excludeId) {
  return appts.filter(a => str(a.barber_id) === barberId && normDate(a.appointment_date) === date && !INACTIVE.includes(str(a.status).toLowerCase())
    && !str(a.deleted_at) && str(a.appointment_id) !== str(excludeId))
    .map(a => [toMin(a.start_time), toMin(a.end_time) || toMin(a.start_time) + num(a.duration)]);
}
function fits(barber, date, startMin, duration, excludeId) {
  if (!barber || !barber.active) return 'BARBER_UNAVAILABLE';
  if (!barber.workingDays.includes(weekday(date))) return 'BARBER_OFF';
  if (startMin < toMin(barber.startTime) || startMin + duration > toMin(barber.endTime)) return 'OUTSIDE_HOURS';
  const clash = busyFor(barber.id, date, excludeId).some(([s, e]) => startMin < e + BUFFER && startMin + duration + BUFFER > s);
  return clash ? 'SLOT_UNAVAILABLE' : null;
}
function slotsFor(barber, date, duration, excludeId) {
  if (!barber.active || !barber.workingDays.includes(weekday(date))) return [];
  const out = [];
  for (let t = toMin(barber.startTime); t + duration <= toMin(barber.endTime); t += STEP) {
    let available = !fits(barber, date, t, duration, excludeId);
    if (date === NOW.date && t <= NOW.min + 15) available = false;
    out.push({ time: fromMin(t), available });
  }
  return out;
}
const dateErr = (date, allowPast) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return 'Date must be in YYYY-MM-DD format.';
  if (!allowPast && date < NOW.date) return 'Past dates cannot be booked.';
  const max = new Date(NOW.date + 'T00:00:00Z'); max.setUTCDate(max.getUTCDate() + 120);
  if (date > max.toISOString().slice(0, 10)) return 'Bookings can be made up to 120 days ahead.';
  return null;
};
const CODE_MSG = { BARBER_UNAVAILABLE: 'That barber is not available for booking.', BARBER_OFF: "The barber doesn't work on that day.", OUTSIDE_HOURS: "That time is outside the barber's working hours.", SLOT_UNAVAILABLE: 'Selected time slot is unavailable' };

/* ---------- Email template ---------- */
function emailHtml(title, intro, a, extra) {
  const rows = [['Appointment ID', a.appointment_id], ['Service', a.service_name], ['Barber', a.barber_name], ['Date', prettyDate(normDate(a.appointment_date))], ['Time', prettyTime(a.start_time) + ' – ' + prettyTime(a.end_time)], ['Price', money(a.price)]];
  return '<div style="background:#111;padding:32px 0;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;background:#1B1B1B;border:1px solid #333;border-radius:12px;overflow:hidden">'
    + '<div style="padding:24px 28px;border-bottom:1px solid #333"><span style="color:#D5B58A;letter-spacing:4px;font-weight:bold">GENT\'S STUDIO</span></div>'
    + '<div style="padding:28px;color:#F5F0E8"><h2 style="margin:0 0 12px;font-family:Georgia,serif;color:#F5F0E8">' + esc(title) + '</h2><p style="color:#A3A3A3;line-height:1.6">' + intro + '</p>'
    + '<table style="width:100%;border-collapse:collapse;margin:18px 0">' + rows.map(r => '<tr><td style="padding:8px 0;color:#A3A3A3;border-bottom:1px solid #2a2a2a">' + r[0] + '</td><td style="padding:8px 0;text-align:right;color:#F5F0E8;border-bottom:1px solid #2a2a2a">' + esc(r[1]) + '</td></tr>').join('') + '</table>'
    + (extra || '') + '<p style="color:#A3A3A3;font-size:13px">' + esc(S.address || '') + ' · ' + esc(S.phone || '') + '</p></div></div></div>';
}
const firstName = n => esc(str(n).split(' ')[0] || 'there');

/* ---------- Plan builders ---------- */
function mutation(p) {
  return [{ json: Object.assign({ calendarOp: 'none', calendar: {}, stripe: { kind: 'none' }, emails: [], writes, halt: false }, p) }];
}
function calendarFields(a) {
  return {
    start: isoLocal(normDate(a.appointment_date), normTime(a.start_time)),
    end: isoLocal(normDate(a.appointment_date), normTime(a.end_time)),
    summary: a.service_name + ' — ' + a.customer_name + ' (' + a.barber_name + ')',
    description: 'Appointment ' + a.appointment_id + '\nCustomer: ' + a.customer_name + '\nPhone: ' + a.phone + '\nEmail: ' + a.email + '\nService: ' + a.service_name + ' (' + a.duration + ' min, ' + money(a.price) + ')\nBarber: ' + a.barber_name + (a.notes ? '\nNotes: ' + a.notes : ''),
    location: S.address || ''
  };
}
// n8n's Code sandbox has no global URL object, so the origin is parsed with a regex.
function originAllowed(url) {
  const m = String(url || '').match(/^(https?:\/\/[^\/?#\s]+)(\/[^?#\s]*)?/i);
  if (!m) return false;
  if (cfg.frontendOrigins === '*') return true;
  return cfg.frontendOrigins.split(',').map(s => s.trim().toLowerCase()).includes(m[1].toLowerCase());
}
function checkoutPlan(a, returnUrl) {
  if (!bool(S.paymentsEnabled === undefined ? 'true' : S.paymentsEnabled) || num(a.price) <= 0 || !returnUrl || !originAllowed(returnUrl)) return { kind: 'none' };
  const base = returnUrl.split('#')[0].split('?')[0];
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  const success = dir + 'my-bookings.html?id=' + encodeURIComponent(a.appointment_id) + '&paid=1&session_id={CHECKOUT_SESSION_ID}';
  const cancel = dir + 'my-bookings.html?id=' + encodeURIComponent(a.appointment_id) + '&paid=0';
  const f = {
    mode: 'payment', success_url: success, cancel_url: cancel, customer_email: a.email, client_reference_id: a.appointment_id,
    'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': (S.currency || 'usd').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Math.round(num(a.price) * 100)),
    'line_items[0][price_data][product_data][name]': a.service_name + ' — ' + (S.studioName || "GENT'S STUDIO"),
    'line_items[0][price_data][product_data][description]': 'Appointment ' + a.appointment_id + ' with ' + a.barber_name + ' on ' + normDate(a.appointment_date) + ' at ' + normTime(a.start_time),
    'metadata[appointment_id]': a.appointment_id, 'payment_intent_data[metadata][appointment_id]': a.appointment_id
  };
  return { kind: 'create', body: Object.keys(f).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(f[k])).join('&'), idempotencyKey: 'checkout-' + a.appointment_id + '-' + rand(4), appointmentId: a.appointment_id };
}

/* ---------- Dashboard ---------- */
function dashboard() {
  const list = appts.filter(a => str(a.status).toLowerCase() !== 'deleted' && !str(a.deleted_at)).map(apptOut);
  const cnt = s => list.filter(a => a.status === s).length;
  const rev = arr => arr.filter(a => a.status === 'completed').reduce((t, a) => t + a.price, 0);
  const month = NOW.date.slice(0, 7);
  const dayIso = off => { const d = new Date(NOW.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
  const weekly = []; for (let i = 6; i >= 0; i--) { const k = dayIso(-i); weekly.push({ label: weekday(k), value: list.filter(a => a.date === k && a.status !== 'cancelled').length }); }
  const monthly = []; for (let i = 5; i >= 0; i--) { const d = new Date(NOW.date.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); const k = d.toISOString().slice(0, 7);
    monthly.push({ label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), value: rev(list.filter(a => a.date.startsWith(k))) }); }
  const pop = {}; list.filter(a => a.status !== 'cancelled').forEach(a => { pop[a.serviceName] = (pop[a.serviceName] || 0) + 1; });
  return {
    stats: { totalAppointments: list.length, todayAppointments: list.filter(a => a.date === NOW.date && a.status !== 'cancelled').length, pending: cnt('pending'), confirmed: cnt('confirmed'),
      completed: cnt('completed'), cancelled: cnt('cancelled'), totalCustomers: T.Customers.rows.length, monthlyRevenue: rev(list.filter(a => a.date.startsWith(month))) },
    weeklyBookings: weekly, monthlyRevenue: monthly,
    popularServices: Object.keys(pop).map(k => ({ label: k, value: pop[k] })).sort((a, b) => b.value - a.value).slice(0, 5),
    recentAppointments: list.slice().sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date)).slice(0, 8),
    revenueBasis: 'completed appointments only'
  };
}

/* ---------- Booking helpers shared by create/update ---------- */
function resolveSlot(serviceId, barberId, date, time, excludeId, allowPast) {
  const svc = services.find(s => s.id === str(serviceId));
  if (!svc || (!svc.active && !admin)) return { err: fail(422, 'INVALID_SERVICE', 'Please choose a valid service.') };
  const de = dateErr(date, allowPast); if (de) return { err: fail(422, 'INVALID_DATE', de) };
  const t = normTime(time); if (!t || !/^\d{2}:\d{2}$/.test(str(time))) return { err: fail(422, 'INVALID_TIME', 'Time must be in HH:MM format.') };
  const start = toMin(t);
  if (!allowPast && date === NOW.date && start <= NOW.min) return { err: fail(422, 'INVALID_TIME', 'That time has already passed.') };
  let barber, why = null;
  if (str(barberId) === 'any') {
    barber = barbers.find(b => b.active && !fits(b, date, start, svc.duration, excludeId));
    if (!barber) return { err: fail(409, 'SLOT_UNAVAILABLE', 'No barber is free at that time. Please choose another time.') };
  } else {
    barber = barbers.find(b => b.id === str(barberId));
    if (!barber) return { err: fail(422, 'INVALID_BARBER', 'Please choose a valid barber.') };
    why = fits(barber, date, start, svc.duration, excludeId);
    if (why) return { err: fail(why === 'SLOT_UNAVAILABLE' ? 409 : 422, why, CODE_MSG[why]) };
  }
  return { svc, barber, start: t, end: fromMin(start + svc.duration) };
}

/* ======================= ACTIONS ======================= */
const A = req.action;

if (A === 'get_services') {
  if (B.all) { const e = requireAdmin(); if (e) return e; return okNow(services.map(pubService)); }
  return okNow(services.filter(s => s.active).map(pubService));
}

if (A === 'get_barbers') {
  if (B.all) { const e = requireAdmin(); if (e) return e; return okNow(barbers.map(pubBarber)); }
  return okNow(barbers.filter(b => b.active).map(b => { const p = pubBarber(b); delete p.email; return p; }));
}

if (A === 'get_availability') {
  const svc = services.find(s => s.id === str(B.serviceId) && s.active);
  if (!svc) return fail(422, 'INVALID_SERVICE', 'Please choose a valid service.');
  const date = str(B.date); const de = dateErr(date, false); if (de) return fail(422, 'INVALID_DATE', de);
  const exclude = str(B.excludeAppointmentId);
  if (str(B.barberId) === 'any') {
    const merged = {};
    barbers.filter(b => b.active).forEach(b => slotsFor(b, date, svc.duration, exclude).forEach(s => { merged[s.time] = merged[s.time] || s.available; }));
    return okNow(Object.keys(merged).sort().map(t => ({ time: t, available: merged[t] })));
  }
  const b = barbers.find(x => x.id === str(B.barberId) && x.active);
  if (!b) return fail(422, 'INVALID_BARBER', 'Please choose a valid barber.');
  return okNow(slotsFor(b, date, svc.duration, exclude));
}

if (A === 'create_booking') {
  if (req.token && !admin) return fail(401, 'UNAUTHORIZED', 'Your session has expired. Please log in again.');
  const name = str(B.customerName), email = str(B.email).toLowerCase(), phone = str(B.phone), notes = str(B.notes).slice(0, 500);
  const errs = {};
  if (name.length < 2 || name.length > 80) errs.customerName = 'Please enter your full name.';
  if (!isEmail(email)) errs.email = 'Enter a valid email address.';
  if (!isPhone(phone)) errs.phone = 'Enter a valid phone number.';
  ['serviceId', 'barberId', 'date', 'time'].forEach(k => { if (!str(B[k])) errs[k] = k + ' is required.'; });
  if (Object.keys(errs).length) return fail(422, 'VALIDATION', 'Please check the highlighted fields.', { errors: errs });
  const crid = str(B.clientRequestId).slice(0, 64);
  if (crid) {
    const dup = appts.find(a => str(a.client_request_id) === crid);
    if (dup) return okNow({ appointment_id: str(dup.appointment_id), appointmentId: str(dup.appointment_id), status: str(dup.status), barberName: str(dup.barber_name), duplicate: true }, 'Booking already created');
  }
  const slot = resolveSlot(B.serviceId, B.barberId, str(B.date), str(B.time), '', !!admin);
  if (slot.err) return slot.err;
  let cust = T.Customers.rows.find(c => str(c.email).toLowerCase() === email);
  if (!cust) { cust = { customer_id: newId('CUS', 'Customers', 'customer_id'), name, email, phone, created_at: nowIso, updated_at: nowIso }; appendRow('Customers', cust); }
  const status = admin && STATUSES.includes(str(B.status)) && str(B.status) !== 'deleted' ? str(B.status) : 'confirmed';
  let id = 'GS-' + str(B.date).replace(/-/g, '') + '-' + rand(2).toUpperCase();
  while (findAppt(id)) id = 'GS-' + str(B.date).replace(/-/g, '') + '-' + rand(3).toUpperCase();
  const a = {
    appointment_id: id, customer_id: cust.customer_id, customer_name: name, email, phone,
    service_id: slot.svc.id, service_name: slot.svc.name, barber_id: slot.barber.id, barber_name: slot.barber.name,
    appointment_date: str(B.date), start_time: slot.start, end_time: slot.end, duration: slot.svc.duration, price: slot.svc.price,
    status, payment_status: slot.svc.price > 0 ? 'unpaid' : 'n/a', stripe_session_id: '__STRIPE_SESSION_ID__', notes, source: admin ? 'admin' : 'website',
    client_request_id: crid, calendar_event_id: '__EVENT_ID__', created_at: nowIso, updated_at: nowIso, deleted_at: ''
  };
  appendRow('Appointments', a);
  log(admin ? 'admin:' + admin.email : 'customer:' + email, 'created', 'appointment', a.appointment_id, { summary: slot.svc.name + ' with ' + slot.barber.name + ' on ' + a.appointment_date + ' at ' + a.start_time });
  const out = apptOut(a);
  return mutation({
    calendarOp: 'create', calendar: calendarFields(a),
    stripe: admin ? { kind: 'none' } : checkoutPlan(a, str(B.returnUrl)),
    emails: [{ to: email, subject: 'Booking confirmed — ' + a.appointment_id, html: emailHtml('Your chair is reserved', 'Hi ' + firstName(name) + ', thanks for booking with us. Here are your appointment details. Keep your appointment ID to change or cancel online.', a, '__PAY_LINK__') }],
    ok: { status: 201, body: { success: true, message: 'Booking created successfully', data: Object.assign(out, { appointment_id: a.appointment_id, appointmentId: a.appointment_id, status, barberName: slot.barber.name }) } }
  });
}

if (A === 'get_bookings') {
  if (admin) return okNow(appts.filter(a => str(a.status).toLowerCase() !== 'deleted' && !str(a.deleted_at)).map(apptOut));
  if (req.token) return fail(401, 'UNAUTHORIZED', 'Your session has expired. Please log in again.');
  const email = str(B.email).toLowerCase(), phone = digits(B.phone);
  if (!isEmail(email) || phone.length < 7) return fail(422, 'VALIDATION', 'Provide both the email and phone used for booking.');
  return okNow(appts.filter(a => str(a.email).toLowerCase() === email && digits(a.phone) === phone && str(a.status).toLowerCase() !== 'deleted' && !str(a.deleted_at)).map(apptOut));
}

if (A === 'get_booking') {
  const o = ownAppt(!!admin); if (o.err) return o.err;
  return okNow({ appointment: apptOut(o.r), history: historyFor(str(o.r.appointment_id)) });
}

if (A === 'update_booking') {
  const o = ownAppt(false); if (o.err) return o.err;
  const r = o.r, cur = str(r.status).toLowerCase();
  if (!admin && ['cancelled', 'completed', 'deleted', 'no-show'].includes(cur)) return fail(409, 'NOT_EDITABLE', 'This appointment can no longer be changed.');
  if (!admin && (normDate(r.appointment_date) < NOW.date || (normDate(r.appointment_date) === NOW.date && toMin(r.start_time) <= NOW.min + 60)))
    return fail(409, 'TOO_LATE', 'Appointments can be changed online up to 1 hour before the start time. Please call the studio.');
  const date = str(B.date || normDate(r.appointment_date)), time = str(B.time || normTime(r.start_time));
  const slot = resolveSlot(B.serviceId || r.service_id, B.barberId || r.barber_id, date, time, str(r.appointment_id), !!admin);
  if (slot.err) return slot.err;
  const before = apptOut(r);
  const u = Object.assign({}, r, {
    service_id: slot.svc.id, service_name: slot.svc.name, barber_id: slot.barber.id, barber_name: slot.barber.name, appointment_date: date,
    start_time: slot.start, end_time: slot.end, duration: slot.svc.duration, price: slot.svc.price, updated_at: nowIso
  });
  if (admin) {
    if (B.customerName !== undefined) { if (str(B.customerName).length < 2) return fail(422, 'VALIDATION', 'Customer name is required.'); u.customer_name = str(B.customerName); }
    if (B.email !== undefined) { if (!isEmail(B.email)) return fail(422, 'VALIDATION', 'Invalid email.'); u.email = str(B.email).toLowerCase(); }
    if (B.phone !== undefined) { if (!isPhone(B.phone)) return fail(422, 'VALIDATION', 'Invalid phone.'); u.phone = str(B.phone); }
    if (B.notes !== undefined) u.notes = str(B.notes).slice(0, 500);
    if (B.status !== undefined && STATUSES.includes(str(B.status)) && !['deleted', 'cancelled'].includes(str(B.status))) u.status = str(B.status);
  }
  if (str(r.payment_status) === 'paid' && num(u.price) !== num(r.price)) u.notes = (u.notes ? u.notes + ' | ' : '') + 'Price changed after payment (' + money(r.price) + ' paid).';
  const changed = ['service_name', 'barber_name', 'appointment_date', 'start_time'].filter(k => str(u[k]) !== str(r[k]));
  const hasEvent = !!str(r.calendar_event_id);
  u.calendar_event_id = hasEvent ? str(r.calendar_event_id) : '__EVENT_ID__';
  updateRow('Appointments', u);
  log(o.actor, changed.length ? 'rescheduled' : 'updated', 'appointment', str(r.appointment_id), { summary: changed.length ? 'Changed: ' + changed.map(k => k.replace('_', ' ')).join(', ') + ' → ' + u.service_name + ' with ' + u.barber_name + ' on ' + u.appointment_date + ' at ' + u.start_time : 'Details updated', before: { service: before.serviceName, barber: before.barberName, date: before.date, time: before.time } });
  return mutation({
    calendarOp: hasEvent ? 'update' : 'create', calendar: Object.assign(calendarFields(u), { eventId: str(r.calendar_event_id) }),
    emails: changed.length ? [{ to: u.email, subject: 'Appointment rescheduled — ' + u.appointment_id, html: emailHtml('Your appointment has been updated', 'Hi ' + firstName(u.customer_name) + ', your booking has been changed. Your new details are below.', u) }] : [],
    ok: { status: 200, body: { success: true, message: 'Booking updated successfully', data: { appointment: apptOut(u), history: [{ action: changed.length ? 'rescheduled' : 'updated', details: 'Just now', timestamp: nowIso }].concat(historyFor(str(r.appointment_id))) } } }
  });
}

function cancelPlan(o, newStatus) {
  const r = o.r, cur = str(r.status).toLowerCase();
  const isDelete = newStatus === 'deleted';
  if (!isDelete && cur === 'cancelled') return okNow({ appointment: apptOut(r), history: historyFor(str(r.appointment_id)) }, 'Appointment already cancelled');
  if (!admin && !isDelete && ['completed', 'no-show'].includes(cur)) return fail(409, 'NOT_CANCELLABLE', 'This appointment has already taken place.');
  if (cur === 'deleted') return fail(404, 'NOT_FOUND', "We couldn't find a booking matching those details.");
  const upcoming = !INACTIVE.includes(cur) && cur !== 'completed' && normDate(r.appointment_date) >= NOW.date;
  const u = Object.assign({}, r, { status: newStatus, updated_at: nowIso });
  if (isDelete) u.deleted_at = nowIso;
  updateRow('Appointments', u);
  log(o.actor, isDelete ? 'deleted' : 'cancelled', 'appointment', str(r.appointment_id), { summary: isDelete ? 'Soft-deleted (record retained)' + (upcoming ? '; upcoming slot released' : '') : 'Cancelled; slot released', previousStatus: cur });
  const needsCal = !!str(r.calendar_event_id) && !INACTIVE.includes(cur);
  return mutation({
    calendarOp: needsCal ? 'delete' : 'none', calendar: { eventId: str(r.calendar_event_id) },
    emails: upcoming ? [{ to: str(r.email), subject: 'Appointment cancelled — ' + str(r.appointment_id), html: emailHtml('Your appointment has been cancelled', 'Hi ' + firstName(r.customer_name) + ', your booking below has been cancelled' + (o.actor.startsWith('admin') ? ' by the studio' : '') + '. We hope to see you again soon.' + (str(r.payment_status) === 'paid' ? ' Your payment will be refunded by the studio.' : ''), r) }] : [],
    ok: { status: 200, body: { success: true, message: isDelete ? 'Booking removed' : 'Booking cancelled', data: { appointment: apptOut(u), history: historyFor(str(r.appointment_id)) } } }
  });
}

if (A === 'cancel_booking') { const o = ownAppt(false); if (o.err) return o.err; return cancelPlan(o, 'cancelled'); }
if (A === 'delete_booking') { const o = ownAppt(false); if (o.err) return o.err; return cancelPlan(o, 'deleted'); }

if (A === 'update_status') {
  const e = requireAdmin(); if (e) return e;
  const st = str(B.status).toLowerCase();
  if (!STATUSES.includes(st)) return fail(422, 'VALIDATION', 'Invalid status.');
  const o = ownAppt(true); if (o.err) return o.err;
  if (st === 'cancelled' || st === 'deleted') return cancelPlan(o, st);
  const r = o.r; const cur = str(r.status).toLowerCase();
  if (cur === 'deleted') return fail(409, 'NOT_EDITABLE', 'Deleted appointments cannot be changed.');
  const u = Object.assign({}, r, { status: st, updated_at: nowIso });
  updateRow('Appointments', u);
  log(o.actor, 'status_' + st, 'appointment', str(r.appointment_id), { summary: 'Status changed from ' + cur + ' to ' + st });
  // Re-activating a cancelled booking needs a fresh calendar event and a slot check
  if (INACTIVE.includes(cur)) {
    const why = fits(barbers.find(b => b.id === str(r.barber_id)), normDate(r.appointment_date), toMin(r.start_time), num(r.duration), str(r.appointment_id));
    if (why) return fail(409, why, 'Cannot reactivate: ' + CODE_MSG[why]);
    u.calendar_event_id = '__EVENT_ID__'; writes.updates.length = 0; updateRow('Appointments', u);
    return mutation({ calendarOp: 'create', calendar: calendarFields(u), ok: { status: 200, body: { success: true, message: 'Status updated', data: { appointment: apptOut(u) } } } });
  }
  return mutation({ ok: { status: 200, body: { success: true, message: 'Status updated', data: { appointment: apptOut(u) } } } });
}

if (A === 'admin_login') {
  const email = str(B.email).toLowerCase(), pw = String(B.password || '');
  if (!isEmail(email) || !pw) return fail(422, 'VALIDATION', 'Email and password are required.');
  const recentFails = T.ActivityLogs.rows.filter(l => str(l.action) === 'login_failed' && str(l.entity_id) === email && Date.now() - Date.parse(l.timestamp) < 15 * 60000).length;
  if (recentFails >= 5) return fail(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Please wait 15 minutes and try again.');
  const ad = T.Admins.rows.find(a => str(a.email).toLowerCase() === email && bool(a.active));
  let valid = false;
  const parts = str(ad ? ad.password_hash : 'pbkdf2$120000$00$00').split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    const calc = crypto.pbkdf2Sync(pw, parts[2], Number(parts[1]), 32, 'sha256');
    const stored = Buffer.from(parts[3], 'hex');
    valid = !!ad && stored.length === calc.length && crypto.timingSafeEqual(stored, calc);
  }
  if (!valid) {
    log('anonymous', 'login_failed', 'admin', email, { summary: 'Failed admin login' });
    return mutation({ ok: { status: 401, body: { success: false, code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' } } });
  }
  const token = rand(32);
  const expiresAt = new Date(Date.now() + cfg.sessionHours * 3600000).toISOString();
  appendRow('Sessions', { session_id: newId('SES', 'Sessions', 'session_id'), token_hash: sha256(token), admin_id: ad.admin_id, email, created_at: nowIso, expires_at: expiresAt, revoked_at: '' });
  updateRow('Admins', Object.assign({}, ad, { last_login_at: nowIso }));
  log('admin:' + email, 'login', 'admin', str(ad.admin_id), { summary: 'Admin signed in' });
  return mutation({ ok: { status: 200, body: { success: true, message: 'Signed in', data: { token, expiresAt, admin: { name: str(ad.name), email, role: str(ad.role) } } } } });
}

if (A === 'admin_logout') {
  if (!session) return okNow({}, 'Signed out');
  updateRow('Sessions', Object.assign({}, session, { revoked_at: nowIso }));
  log('admin:' + admin.email, 'logout', 'admin', str(admin.admin_id), { summary: 'Admin signed out' });
  return mutation({ ok: { status: 200, body: { success: true, message: 'Signed out', data: {} } } });
}

if (A === 'verify_session') {
  const e = requireAdmin(); if (e) return e;
  return okNow({ valid: true, expiresAt: str(session.expires_at), admin: { name: str(admin.name), email: str(admin.email), role: str(admin.role) } });
}

if (A === 'get_dashboard') { const e = requireAdmin(); if (e) return e; return okNow(dashboard()); }

if (A === 'get_analytics') {
  const e = requireAdmin(); if (e) return e;
  return okNow(appts.filter(a => str(a.status).toLowerCase() !== 'deleted' && !str(a.deleted_at)).map(apptOut));
}

if (A === 'get_customers') {
  const e = requireAdmin(); if (e) return e;
  return okNow(T.Customers.rows.map(c => {
    const mine = appts.filter(a => str(a.email).toLowerCase() === str(c.email).toLowerCase() && str(a.status).toLowerCase() !== 'deleted' && !str(a.deleted_at));
    const dates = mine.map(a => normDate(a.appointment_date)).sort();
    return { id: str(c.customer_id), name: str(c.name), email: str(c.email), phone: str(c.phone), totalBookings: mine.length,
      totalSpent: mine.filter(a => str(a.status).toLowerCase() === 'completed').reduce((t, a) => t + num(a.price), 0), firstVisit: dates[0] || '', lastVisit: dates[dates.length - 1] || '' };
  }).sort((a, b) => b.lastVisit.localeCompare(a.lastVisit)));
}

if (A === 'manage_service') {
  const e = requireAdmin(); if (e) return e;
  const existing = str(B.id) ? services.find(s => s.id === str(B.id)) : null;
  if (str(B.id) && !existing) return fail(404, 'NOT_FOUND', 'Service not found.');
  const name = B.name !== undefined ? str(B.name) : existing.name;
  const price = B.price !== undefined ? Number(B.price) : existing.price;
  const duration = B.duration !== undefined ? Number(B.duration) : existing.duration;
  if (name.length < 2) return fail(422, 'VALIDATION', 'Service name is required.');
  if (!isFinite(price) || price < 0) return fail(422, 'VALIDATION', 'Price must be 0 or more.');
  if (!isFinite(duration) || duration < 5 || duration > 480) return fail(422, 'VALIDATION', 'Duration must be 5–480 minutes.');
  if (services.some(s => s.name.toLowerCase() === name.toLowerCase() && (!existing || s.id !== existing.id))) return fail(409, 'DUPLICATE', 'A service with this name already exists.');
  const row = existing ? Object.assign({}, existing._r) : { service_id: newId('SRV', 'Services', 'service_id'), created_at: nowIso };
  Object.assign(row, { name, price, duration, description: B.description !== undefined ? str(B.description).slice(0, 300) : str(row.description), category: B.category !== undefined ? str(B.category) : str(row.category),
    active: B.active !== undefined ? bool(B.active) : (existing ? existing.active : true), updated_at: nowIso });
  if (existing) updateRow('Services', row); else appendRow('Services', row);
  log('admin:' + admin.email, existing ? (existing.active && !row.active ? 'deactivated' : 'updated') : 'created', 'service', row.service_id, { summary: name + ' ' + money(price) + ' ' + duration + 'min' });
  return mutation({ ok: { status: existing ? 200 : 201, body: { success: true, message: existing ? 'Service updated' : 'Service created', data: { id: row.service_id, name, price, duration, category: row.category, description: row.description, active: row.active } } } });
}

if (A === 'manage_barber') {
  const e = requireAdmin(); if (e) return e;
  const existing = str(B.id) ? barbers.find(b => b.id === str(B.id)) : null;
  if (str(B.id) && !existing) return fail(404, 'NOT_FOUND', 'Barber not found.');
  const name = B.name !== undefined ? str(B.name) : existing.name;
  if (name.length < 2) return fail(422, 'VALIDATION', 'Barber name is required.');
  if (B.email && !isEmail(B.email)) return fail(422, 'VALIDATION', 'Invalid email.');
  const specs = Array.isArray(B.specialties) ? B.specialties.map(str).filter(Boolean) : (B.specialties !== undefined ? str(B.specialties).split(',').map(s => s.trim()).filter(Boolean) : (existing ? existing.specialties : []));
  const row = existing ? Object.assign({}, existing._r) : { barber_id: newId('BRB', 'Barbers', 'barber_id'), created_at: nowIso, working_days: 'Mon,Tue,Wed,Thu,Fri,Sat', start_time: S.openTime || '09:00', end_time: S.closeTime || '20:00' };
  Object.assign(row, { name, title: B.title !== undefined ? str(B.title) : str(row.title), email: B.email !== undefined ? str(B.email) : str(row.email), years: B.years !== undefined ? Math.max(0, num(B.years)) : num(row.years),
    specialties: specs.join(', '), active: B.active !== undefined ? bool(B.active) : (existing ? existing.active : true), updated_at: nowIso });
  if (B.workingDays) row.working_days = (Array.isArray(B.workingDays) ? B.workingDays : str(B.workingDays).split(',')).map(s => str(s).slice(0, 3)).join(',');
  if (B.startTime && normTime(B.startTime)) row.start_time = normTime(B.startTime);
  if (B.endTime && normTime(B.endTime)) row.end_time = normTime(B.endTime);
  if (toMin(row.start_time) >= toMin(row.end_time)) return fail(422, 'VALIDATION', 'End time must be after start time.');
  if (existing) updateRow('Barbers', row); else appendRow('Barbers', row);
  log('admin:' + admin.email, existing ? (existing.active && !bool(row.active) ? 'deactivated' : 'updated') : 'created', 'barber', row.barber_id, { summary: name });
  return mutation({ ok: { status: existing ? 200 : 201, body: { success: true, message: existing ? 'Barber updated' : 'Barber created', data: { id: row.barber_id, name, title: row.title, email: row.email, years: row.years, specialties: specs, active: bool(row.active) } } } });
}

if (A === 'get_settings') {
  const e = requireAdmin(); if (e) return e;
  return okNow(Object.assign({}, S));
}

if (A === 'save_settings') {
  const e = requireAdmin(); if (e) return e;
  const KEYS = ['studioName', 'contactEmail', 'phone', 'address', 'timezone', 'openTime', 'closeTime', 'slotInterval', 'bufferMinutes', 'currency', 'paymentsEnabled'];
  if (B.contactEmail && !isEmail(B.contactEmail)) return fail(422, 'VALIDATION', 'Invalid contact email.');
  if (B.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: str(B.timezone) }); } catch (x) { return fail(422, 'VALIDATION', 'Unknown time zone.'); } }
  if (B.openTime && B.closeTime && toMin(B.openTime) >= toMin(B.closeTime)) return fail(422, 'VALIDATION', 'Closing time must be after opening time.');
  const changed = [];
  KEYS.forEach(k => {
    if (B[k] === undefined) return;
    const v = str(B[k]).slice(0, 200);
    const row = T.Settings.rows.find(r => str(r.key) === k);
    if (row) { if (str(row.value) !== v) { updateRow('Settings', Object.assign({}, row, { value: v, updated_at: nowIso })); changed.push(k); } }
    else { appendRow('Settings', { key: k, value: v, updated_at: nowIso }); changed.push(k); }
  });
  if (!changed.length) return okNow(S, 'No changes');
  log('admin:' + admin.email, 'settings_updated', 'settings', 'settings', { summary: changed.join(', ') });
  return mutation({ ok: { status: 200, body: { success: true, message: 'Settings saved', data: { changed } } } });
}

if (A === 'create_payment') {
  const o = ownAppt(false); if (o.err) return o.err;
  const r = o.r;
  if (INACTIVE.includes(str(r.status).toLowerCase()) || str(r.status).toLowerCase() === 'completed') return fail(409, 'NOT_PAYABLE', 'This appointment cannot be paid online.');
  if (str(r.payment_status) === 'paid') return fail(409, 'ALREADY_PAID', 'This appointment is already paid.');
  const plan = checkoutPlan(r, str(B.returnUrl));
  if (plan.kind === 'none') return fail(422, 'PAYMENT_UNAVAILABLE', 'Online payment is not available for this booking.');
  updateRow('Appointments', Object.assign({}, r, { stripe_session_id: '__STRIPE_SESSION_ID__', updated_at: nowIso }));
  log(o.actor, 'payment_started', 'appointment', str(r.appointment_id), { summary: 'Stripe test checkout started' });
  return mutation({ stripe: Object.assign(plan, { required: true }), ok: { status: 200, body: { success: true, message: 'Checkout created', data: { appointmentId: str(r.appointment_id) } } } });
}

if (A === 'verify_payment') {
  const sid = str(B.sessionId);
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return fail(422, 'VALIDATION', 'Invalid payment session.');
  const r = findAppt(B.appointmentId);
  if (!r || str(r.stripe_session_id) !== sid) return fail(404, 'NOT_FOUND', 'Payment session not found for this booking.');
  if (str(r.payment_status) === 'paid') return okNow({ paymentStatus: 'paid', appointmentId: str(r.appointment_id) }, 'Payment already confirmed');
  const u = Object.assign({}, r, { payment_status: 'paid', updated_at: nowIso });
  updateRow('Appointments', u);
  log('stripe', 'paid', 'appointment', str(r.appointment_id), { summary: 'Paid ' + money(r.price) + ' via Stripe (test mode)', session: sid });
  return mutation({
    stripe: { kind: 'retrieve', sessionId: sid, expectAmount: Math.round(num(r.price) * 100), appointmentId: str(r.appointment_id) },
    emails: [{ to: str(r.email), subject: 'Payment received — ' + str(r.appointment_id), html: emailHtml('Payment received', 'Hi ' + firstName(r.customer_name) + ', we have received your payment of ' + money(r.price) + ' (Stripe test mode). See you soon!', r) }],
    ok: { status: 200, body: { success: true, message: 'Payment confirmed', data: { paymentStatus: 'paid', appointmentId: str(r.appointment_id) } } }
  });
}

if (A === 'chat') return fail(501, 'NOT_IMPLEMENTED', 'The AI assistant will be connected in the next stage. Meanwhile you can book online or call the studio.');

return fail(400, 'UNKNOWN_ACTION', 'Unknown action "' + A + '".');
