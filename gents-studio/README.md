# GENT'S STUDIO

**AI-powered men's salon booking & management system.** Pure HTML, CSS and vanilla JavaScript on the front end, with n8n, Google Sheets, Gmail and Google Calendar behind it.

> **Stage 3 complete.** The website is connected to a live n8n backend (Google Sheets database, Google Calendar, Gmail) with **Stripe payments in TEST mode only**.

---

## Folder structure

```
gents-studio/
├── index.html          Public homepage (hero, services, barbers, why us, testimonials, hours, contact)
├── booking.html        Booking form with live slots, price/duration summary, confirmation modal
├── my-bookings.html    Customer self-service: lookup (ID + email/phone), edit, cancel, remove, history
├── login.html          Admin sign-in (backend-verified, show/hide password)
├── admin.html          Admin dashboard (7 views, sidebar, Chart.js)
├── css/
│   ├── style.css       Design tokens, typography, buttons, forms, modal, toast, chatbot, homepage
│   ├── booking.css     Booking + My Bookings pages
│   ├── admin.css       Login + dashboard shell, stats, tables, cards, switches
│   └── responsive.css  Breakpoints at 1100 / 960 / 640px (loaded last)
├── js/
│   ├── config.js       Backend URL, endpoint map, public catalogue, hours, contact
│   ├── api.js          fetch wrapper (timeout, auth header, errors) + Utils, Toast, Modal
│   ├── auth.js         Admin session (token only) + login page controller
│   ├── main.js         Nav, scroll effects, homepage rendering, testimonial slider
│   ├── booking.js      Booking page controller
│   ├── appointments.js My Bookings controller
│   ├── admin.js        Dashboard controller (all admin views)
│   └── chatbot.js      Floating AI concierge (n8n /chat)
└── README.md
```

## Run it locally

Use any static server; opening the files with `file://` also works for browsing.

```bash
cd gents-studio
python3 -m http.server 5500
# open http://localhost:5500
```

## Backend (live)

| | |
|---|---|
| API endpoint | `POST https://balancedorangutanmgrq1.app.n8n.cloud/webhook/gents-studio-api` (set in `js/config.js` → `API_URL`) |
| n8n workflow | **GENT'S STUDIO — Booking API** (published) + **DB Setup (run once)** |
| Database | Google Sheet **GENTS_STUDIO_DB** (Appointments, Services, Barbers, Customers, Admins, Sessions, ActivityLogs, Settings) |
| Calendar | Primary Google Calendar of the connected account |
| Email | Gmail (confirmation, reschedule, cancellation, payment receipt) |
| Payments | Stripe Checkout, **test mode enforced** — test card `4242 4242 4242 4242`, any future date, any CVC |

* **docs/API.md** — every action with request examples, error codes and the sheet schema.
* **docs/BACKEND.md** — node-by-node workflow map, failure/rollback strategy, security model, concurrency notes.
* **docs/CHATBOT.md** — AI assistant: nodes, connections, agent config, tools, memory, tests, error handling.
* **n8n/** — source of every Code node + `node n8n/unit-tests.js`.

Admin demo login: `admin321@example.com` / `Admin 321` (verified server-side against a PBKDF2 hash).

### Development mode
Set `API_URL: ""` in `js/config.js` to work offline: pages show clear "development mode" notices, nothing is faked, and the admin login offers a read-only, clearly labelled sample-data preview.

## Security notes

- All rendered data is HTML-escaped (`Utils.escape`).
- Customers can only see a booking when the appointment ID **and** the contact detail match. The backend must enforce this; the frontend only asks.
- Destructive actions (cancel, delete, sign out, booking edits) all ask for confirmation first.
- The submit button locks while a request is in flight, and `clientRequestId` lets n8n reject duplicate submissions.

## Next stages

2. ✅ Functional frontend
3. ✅ n8n backend: Sheets, Calendar, Gmail, Stripe (test)
4. ✅ AI chat assistant: n8n Chat Trigger + AI Agent + tools that call the Booking API (see docs/CHATBOT.md)
5. Testing, deployment and the sales package
