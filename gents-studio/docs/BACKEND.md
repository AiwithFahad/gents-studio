# GENT'S STUDIO — n8n backend architecture

Two workflows are deployed in your n8n instance:

| Workflow | Purpose |
|---|---|
| **GENT'S STUDIO — DB Setup (run once)** (`hiFKFIrw1VYRB1Ob`) | Already run. Created `GENTS_STUDIO_DB` with all tabs, headers, seed data and the demo admin's PBKDF2 hash. Don't run it again unless you want a second, fresh spreadsheet. |
| **GENT'S STUDIO — Booking API** (`CE9kdohMOub2Zv9I`), **published** | The single API endpoint `POST /webhook/gents-studio-api`. |

To get an importable JSON copy, open the workflow in n8n and choose **⋯ → Download**. The Code-node sources are also in `/n8n` in this project, and `node n8n/unit-tests.js` runs their tests.

## Design: "decide, then act"

Every request runs the same pipeline:

1. **Read** the whole database in **one** Google Sheets `values:batchGet` call (≈0.5 s instead of 8 separate reads).
2. **Decide** in one pure Code node. It handles all validation, authentication, ownership checks, working hours, overlap detection, ID generation and email content. It writes nothing; it emits a *plan*.
3. **Act** on the plan in a fixed, safe order: **Calendar → Stripe (test) → Sheets → Gmail → Respond**.

So nothing is ever reported as successful unless the backend confirmed it:

* If the **Calendar** call fails, the request stops with `502 CALENDAR_FAILED` and nothing is written.
* If **Stripe** fails during a booking, the booking still succeeds; the customer simply pays at the studio. A `paymentNote` says so. Stripe failure on an explicit "Pay online" request returns an error.
* If a critical **Sheets** write fails after its automatic retries (3 tries, 1 s apart), the calendar event just created is **deleted**, a compensating rollback, and the API returns `503 DB_WRITE_FAILED`. Activity-log and customer rows are written only after the critical save succeeds, using Google Sheets Append nodes.
* **Gmail** is best effort. A failed email never undoes a saved booking; the response carries `emailSent:false` and an `emailWarning`.

## Node sequence

**Node mix:** 4 Code nodes (business logic and safety checks only), 4 HTTP Request nodes (only where a native node can't do the job), 2 Google Sheets nodes, plus native Switch / IF / Split Out / Edit Fields / Calendar / Gmail nodes.

| # | Node (type) | Purpose / key configuration |
|---|---|---|
| 1 | **API Webhook** (Webhook) | POST `gents-studio-api`, respond via *Respond to Webhook* |
| 2 | **Config & Parse Request** (Code) | Config (spreadsheet ID, timezone, session hours, allowed origins); parses JSON or text bodies; reads the Bearer token |
| 3 | **Load Database (Sheets batchGet)** (HTTP Request · *essential*) | One Sheets API call returns all 8 tabs (≈0.5 s, one consistent snapshot). With Google Sheets nodes this would be 8 sequential reads |
| 4 | **Decide Action** (Code) | All rules for the 22 actions: validation, auth, ownership, slots, overlap, IDs, emails. Emits a plan and writes nothing |
| 5 | **Route by Calendar Step** (Switch) | final → Respond; create / update / delete → Calendar nodes; none → 9 |
| 6–8 | **Calendar: Create / Update / Delete Event** (Google Calendar) | On error → continue, so the result is checked in 9 |
| 9 | **Apply Calendar Result** (Code) | Halts if the calendar failed; inserts the new event ID |
| 10 | **Continue After Calendar?** (IF) | false → Respond |
| 11 | **Stripe Step** (Switch) | create / retrieve / no payment |
| 12–13 | **Stripe: Create / Retrieve Checkout Session (Test)** (HTTP Request · *essential*) | n8n's Stripe node has no Checkout Session operation |
| 14 | **Apply Payment Result** (Code) | **Rejects anything not in Stripe test mode**; verifies paid + amount + booking; splits writes into `requests` (critical), `logRows`, `customerRows` |
| 15 | **Continue After Payment?** (IF) | false → Respond |
| 16 | **Has Sheet Writes?** (IF) | any critical rows? (a failed login only writes a log) |
| 17 | **Split Sheet Requests** (Split Out) | one item per write request |
| 18 | **Write to Sheets** (HTTP Request · *essential*) | Sheets API `batchUpdate` (rows found by ID) / atomic `append` for Appointments, Sessions, Services, Barbers, Settings; retry 3× |
| 19 | **Writes OK?** (IF, run once) | `!$('Write to Sheets').isExecuted \|\| every write has no error` → true: notify; false: rollback |
| 20 | **Prepare Notifications** (Edit Fields) | pulls `emails`, `logRows`, `customerRows` from the plan |
| 21–22 | **Split Activity Logs → Log Activity (Google Sheets)** | Google Sheets **Append row** to `ActivityLogs` (auto-map columns, RAW) |
| 23–24 | **Split New Customers → Save Customer (Google Sheets)** | Google Sheets **Append row** to `Customers` |
| 25–27 | **Has Email? → Split Emails → Send Email (Gmail)** | HTML emails; on error continue (best effort) |
| 28 | **Success Response** (Edit Fields) | `status` + `body` (+ `emailSent`) → Respond |
| 29–31 | **Rollback Needed? → Rollback: Delete Calendar Event → Write-Failure Response** (IF / Calendar / Edit Fields) | Undo the new calendar event and return 503 |
| 32 | **Respond to Webhook** | JSON body, HTTP status from `$json.status`, `Cache-Control: no-store` |

Workflow settings: timezone Asia/Karachi. **Successful production executions are not stored** (so customer data and tokens aren't kept in n8n logs); failed executions are kept for debugging.

## Security

* **Admin passwords**: PBKDF2-SHA256, 120,000 iterations, random 16-byte salt per admin, compared with `timingSafeEqual`. No plaintext anywhere; the frontend has no credentials.
* **Sessions**: a 32-byte random token is returned once. Only its SHA-256 hash is stored, with an 8-hour expiry. Every admin action re-checks the hash, expiry, revocation and that the admin is still active. Logout revokes it server-side.
* **Brute force**: after 5 failed logins per email in 15 minutes, logins are blocked with `429`.
* **Customer ownership**: every read or change of a booking needs the appointment ID **and** the exact email or phone on the booking. A mismatch gets the same `404` as a missing ID, so IDs can't be probed. Customer IDs sent by clients are never trusted.
* **Stripe**: test mode is enforced in code (`livemode === false`). Amounts come from the Services sheet, never from the browser. The amount and the booking metadata are re-verified server-side before a booking is marked paid.
* **CORS**: the webhook allows `*` so you can test from anywhere. Before launch, set *Allowed Origins* on the webhook node **and** `frontendOrigins` in the Config node to your real domain (e.g. `https://gentsstudio.com`). The latter also blocks open-redirect abuse of the Stripe return URLs.
* Credentials stay in n8n's credential store; workflow nodes reference them by ID.

## Concurrency (Google Sheets is not transactional)

What's already in place:

* New rows use Sheets **`values:append`**, which is atomic per call, so two simultaneous bookings never overwrite each other's rows. Updates target the row located by **ID** in the same request.
* **Idempotency**: the website sends a `clientRequestId` per booking attempt. A retried or double-clicked submission returns the original booking instead of creating a second one. Stripe calls use an `Idempotency-Key`.
* Overlap is checked against the snapshot read at the start of the request.

Remaining risk: two requests for the **same barber and slot** arriving within roughly the same second can both pass the check. For a single small studio this is rare. To remove it:

1. **Self-hosted n8n**: run the API in queue mode with `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` (or a dedicated worker with concurrency 1). Requests are then processed one at a time, which fully serializes booking creation.
2. **Cheap safety net** (any plan): add a "re-check" step after *Write to Sheets* for `create_booking`. Re-read Appointments; if another active booking overlaps and was created first, soft-delete the new row, delete its calendar event and return `409`.
3. **Production grade**: move the data to Postgres/Supabase with a unique/exclusion constraint on `(barber_id, tstzrange(start,end))`. The database then rejects overlaps atomically, and the n8n flow stays the same apart from the read/write nodes.

## Adding another admin

Generate a hash locally and add a row to **Admins**:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log('pbkdf2\$120000\$'+s+'\$'+c.pbkdf2Sync(process.argv[1],s,120000,32,'sha256').toString('hex'))" 'NewStrongPassword!'
```

Columns: `ADM-002 | Name | email | <hash> | manager | TRUE | <ISO date> |`.

## Going live with Stripe

The integration is locked to test mode. Moving to live payments requires changing the n8n Stripe credential to a live key **and** deliberately editing *Apply Payment Result*. That is intentional, so live charges can never be switched on by accident.
