// NODE: "Config & Parse Request" (Code, run once for all items)
// Central configuration + request normalisation. Edit CONFIG values here.
const CONFIG = {
  spreadsheetId: '1rPysBCDjubghoHJ1NCKtTowPCEaAbZpf6svxm5UKnAQ',
  calendarId: 'primary',
  timezone: 'Asia/Karachi',
  sessionHours: 8,
  // Comma-separated list of allowed frontend origins for Stripe return URLs. '*' = any http(s) origin (dev only).
  frontendOrigins: '*',
  stripeMode: 'test' // payments are refused unless Stripe confirms livemode === false
};
const w = $input.first().json;
const headers = w.headers || {};
let body = w.body;
let parseError = null;
if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { parseError = 'Request body must be valid JSON.'; body = {}; } }
if (!body || typeof body !== 'object' || Array.isArray(body)) { body = {}; if (!parseError) parseError = 'Request body must be a JSON object.'; }
const auth = String(headers.authorization || headers.Authorization || '');
const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : String(body.token || '').trim();
const action = String(body.action || '').trim().toLowerCase();
if (!parseError && !action) parseError = 'Missing "action".';
const clean = Object.assign({}, body);
delete clean.token;
return [{ json: { cfg: CONFIG, req: { action, body: clean, token, origin: String(headers.origin || ''), parseError } } }];
