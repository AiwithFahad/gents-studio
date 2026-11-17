// NODE: "Apply Payment Result" (Code, run once for all items)
// Enforces TEST MODE: any Stripe object with livemode !== false is rejected and never used.
const plan = JSON.parse(JSON.stringify($('Apply Calendar Result').first().json));
const kind = plan.stripeKind;
let stripeRes = null;
if (kind === 'create' && $('Stripe: Create Checkout Session (Test)').isExecuted) stripeRes = $('Stripe: Create Checkout Session (Test)').first().json;
if (kind === 'retrieve' && $('Stripe: Retrieve Checkout Session (Test)').isExecuted) stripeRes = $('Stripe: Retrieve Checkout Session (Test)').first().json;
const body = stripeRes && stripeRes.body !== undefined ? stripeRes.body : stripeRes;
const status = stripeRes && stripeRes.statusCode !== undefined ? Number(stripeRes.statusCode) : (stripeRes && stripeRes.error ? 500 : 200);
const okStripe = !!body && status >= 200 && status < 300 && !stripeRes.error;
const testMode = okStripe && body.livemode === false;
const halt = (st, code, message) => [{ json: { halt: true, status: st, body: { success: false, code, message } } }];
let sessionId = '', checkoutUrl = null, paymentNote = null;

if (kind === 'create') {
  if (okStripe && testMode && body.url && body.id) { sessionId = body.id; checkoutUrl = body.url; }
  else if (okStripe && !testMode) {
    paymentNote = 'Online payment is disabled: the Stripe key is not a TEST key.';
    if (plan.stripe.required) return halt(503, 'LIVE_MODE_BLOCKED', 'Payments are only enabled in Stripe test mode. Please contact the studio.');
  } else {
    paymentNote = 'Online payment is temporarily unavailable. You can pay at the studio.';
    if (plan.stripe.required) return halt(502, 'PAYMENT_FAILED', 'We could not start the payment. Please try again in a moment.');
  }
}
if (kind === 'retrieve') {
  if (!okStripe) return halt(502, 'PAYMENT_CHECK_FAILED', 'We could not confirm the payment with Stripe yet. Please refresh in a moment.');
  if (!testMode) return halt(403, 'LIVE_MODE_BLOCKED', 'Only Stripe test-mode payments are accepted.');
  const meta = body.metadata || {};
  if (meta.appointment_id !== plan.stripe.appointmentId) return halt(409, 'PAYMENT_MISMATCH', 'This payment does not belong to this booking.');
  if (body.payment_status !== 'paid') return halt(402, 'NOT_PAID', 'Payment has not been completed yet.');
  if (Number(body.amount_total) !== Number(plan.stripe.expectAmount)) return halt(409, 'AMOUNT_MISMATCH', 'Payment amount does not match the booking price. Please contact the studio.');
}

plan.writes = JSON.parse(JSON.stringify(plan.writes).split('__STRIPE_SESSION_ID__').join(sessionId));
const payBtn = checkoutUrl ? '<p style="margin:22px 0"><a href="' + checkoutUrl + '" style="background:#D5B58A;color:#17130D;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Pay now (Stripe test mode)</a></p>' : '';
plan.emails = (plan.emails || []).map(e => Object.assign({}, e, { html: String(e.html).split('__PAY_LINK__').join(payBtn) }));
if (plan.ok && plan.ok.body && plan.ok.body.data && kind === 'create') {
  plan.ok.body.data.checkoutUrl = checkoutUrl;
  plan.ok.body.data.paymentMode = checkoutUrl ? 'test' : null;
  if (paymentNote) plan.ok.body.data.paymentNote = paymentNote;
}
// Split the planned writes: critical rows go to one Sheets API call each (HTTP),
// activity-log and customer rows go to native Google Sheets "Append row" nodes.
const COLS = {
  ActivityLogs: ['log_id', 'timestamp', 'actor', 'action', 'entity', 'entity_id', 'details'],
  Customers: ['customer_id', 'name', 'email', 'phone', 'created_at', 'updated_at']
};
const toObjects = (sheet) => {
  const g = plan.writes.appends.find(a => a.sheet === sheet);
  return g ? g.values.map(v => Object.fromEntries(COLS[sheet].map((c, i) => [c, v[i] === undefined ? '' : v[i]]))) : [];
};
plan.logRows = toObjects('ActivityLogs');
plan.customerRows = toObjects('Customers');
const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + $('Config & Parse Request').first().json.cfg.spreadsheetId;
plan.requests = [];
if (plan.writes.updates.length) plan.requests.push({ url: base + '/values:batchUpdate', body: { valueInputOption: 'RAW', data: plan.writes.updates } });
plan.writes.appends.filter(a => !COLS[a.sheet]).forEach(a => plan.requests.push({ url: base + '/values/' + encodeURIComponent(a.sheet + '!A1') + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', body: { values: a.values } }));
return [{ json: plan }];
