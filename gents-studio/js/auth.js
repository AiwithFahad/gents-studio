/* GENT'S STUDIO — admin authentication.
 * Credentials are NEVER checked in the browser. The login form posts to the
 * n8n /auth/login webhook, which compares a salted hash stored in Google Sheets
 * and returns a signed session token. Only that token is kept (sessionStorage).
 * Every admin request sends the token; n8n must re-verify it on EVERY call.
 * The browser-side checks below only decide which screen to show, never access.
 */
const Auth = {
  KEY: "gs_admin_session",
  _timer: null,

  getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.KEY) || "null");
      if (!s) return null;
      if (s.preview) {
        // A sample-data preview session is only valid while no backend is configured.
        if (API.isConfigured()) { this.clear(); return null; }
        return s;
      }
      if (!s.token) return null;
      if (s.expiresAt && Date.now() > new Date(s.expiresAt).getTime()) { this.clear(); return null; }
      return s;
    } catch { return null; }
  },
  isPreview() { const s = this.getSession(); return !!(s && s.preview); },
  getToken() { const s = this.getSession(); return s && !s.preview ? s.token : null; },
  save(session) { sessionStorage.setItem(this.KEY, JSON.stringify(session)); },
  clear() { sessionStorage.removeItem(this.KEY); clearTimeout(this._timer); },

  async login(email, password) {
    const data = await API.post("login", { email: email.trim().toLowerCase(), password });
    if (!data || !data.token) throw new ApiError("Login failed: the server did not return a session.", { code: "NO_TOKEN" });
    this.save({ token: data.token, expiresAt: data.expiresAt || null, admin: data.admin || { email } });
    return data;
  },

  startPreview() {
    if (API.isConfigured()) return false;
    this.save({ preview: true, admin: { name: "Preview (sample data)", email: "preview" } });
    return true;
  },

  async logout(reason) {
    const wasPreview = this.isPreview();
    try { if (!wasPreview && this.getToken()) await API.request("logout", { body: {}, auth: true }); }
    catch { /* token is discarded locally regardless */ }
    this.clear();
    window.location.href = "login.html?" + (reason || "loggedout") + "=1";
  },

  /* Screen guard for admin.html. Real access control is enforced by n8n. */
  requireAdmin() {
    if (!this.getSession()) {
      window.location.replace("login.html?next=admin");
      return false;
    }
    return true;
  },

  /* Confirms the token with the backend, then schedules auto-logout at expiry. */
  async verifyWithServer() {
    const s = this.getSession();
    if (!s || s.preview) return true;
    try {
      const res = await API.request("verify", { body: {}, auth: true });
      if (res && res.valid === false) throw new ApiError("Session invalid", { status: 401, code: "UNAUTHORIZED" });
      if (res && res.expiresAt) { s.expiresAt = res.expiresAt; this.save(s); }
      if (res && res.admin) { s.admin = res.admin; this.save(s); }
    } catch (err) {
      if (err.status === 401 || err.code === "UNAUTHORIZED" || err.code === "NO_SESSION") {
        this.clear();
        window.location.replace("login.html?expired=1");
        return false;
      }
      // Network problems: stay on the page; each data call will surface its own error.
      Toast.show("Couldn't confirm your session with the server. Some data may fail to load.", "warn");
    }
    this.scheduleExpiry();
    return true;
  },

  scheduleExpiry() {
    clearTimeout(this._timer);
    const s = this.getSession();
    if (!s || !s.expiresAt) return;
    const ms = new Date(s.expiresAt).getTime() - Date.now();
    if (ms <= 0) { this.clear(); window.location.replace("login.html?expired=1"); return; }
    // setTimeout max is ~24.8 days; cap it.
    this._timer = setTimeout(() => { this.clear(); window.location.replace("login.html?expired=1"); }, Math.min(ms, 2147483000));
  }
};

/* ---------- Login page controller ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  if (!form) return;

  if (Auth.getSession()) { window.location.replace("admin.html"); return; }

  const email = form.elements.email;
  const password = form.elements.password;
  const btn = form.querySelector("button[type=submit]");
  const alertBox = document.getElementById("login-alert");
  const toggle = document.getElementById("toggle-password");
  const previewBox = document.getElementById("preview-box");
  const params = new URLSearchParams(location.search);

  const showAlert = (type, text) => { alertBox.className = `form-alert form-alert--${type}`; alertBox.textContent = text; };

  if (params.get("expired")) showAlert("warn", "Your session has expired. Please sign in again.");
  else if (params.get("loggedout")) showAlert("ok", "You have been signed out.");
  else if (params.get("next")) showAlert("warn", "Please sign in to access the dashboard.");

  if (!API.isConfigured()) {
    if (!params.get("expired") && !params.get("loggedout")) showAlert("warn", "Development mode: connect the n8n backend (js/config.js) to enable sign-in.");
    if (previewBox) {
      previewBox.hidden = false;
      previewBox.querySelector("button").addEventListener("click", () => { if (Auth.startPreview()) location.href = "admin.html"; });
    }
  }

  toggle.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.textContent = show ? "Hide" : "Show";
  });

  [email, password].forEach(i => i.addEventListener("input", () => Utils.fieldError(i, "")));

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (btn.disabled) return;
    Utils.clearErrors(form);
    alertBox.className = "form-alert";
    alertBox.textContent = "";

    let ok = true;
    if (!Utils.isEmail(email.value)) { Utils.fieldError(email, "Enter a valid email address."); ok = false; }
    if (!password.value) { Utils.fieldError(password, "Enter your password."); ok = false; }
    if (!ok) return;

    Utils.setLoading(btn, true, "Signing in…");
    try {
      await Auth.login(email.value, password.value);
      window.location.href = "admin.html";
    } catch (err) {
      showAlert(err.code === "DEV_MODE" ? "warn" : "error",
        err.status === 401 || err.status === 403 ? "Incorrect email or password." :
        err.status === 429 ? "Too many attempts. Please wait a few minutes and try again." : err.message);
      password.value = "";
      password.focus();
    } finally {
      Utils.setLoading(btn, false);
    }
  });
});
