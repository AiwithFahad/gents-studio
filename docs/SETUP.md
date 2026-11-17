# GENT'S STUDIO — Installation & Configuration

How to stand up your own copy of the platform. **No real credentials appear in this repository** — every secret lives in n8n's credential store or your hosting environment.

## Prerequisites

- An **n8n** instance (self-hosted or n8n Cloud)
- A **Google account** for Sheets, Calendar and Gmail
- A **Stripe** account (test mode is enough)
- An **OpenAI** API account
- A **Netlify** account (or any static host) for the website

## Step 1 — Create the database

1. Import the **GENT'S STUDIO — DB Setup** workflow into n8n.
2. Connect your Google credentials (Sheets).
3. Run the workflow once. It creates the workbook with the `Appointments`, `Services`, `Barbers`, `Customers`, `Admins`, `Sessions`, `ActivityLogs`, `Settings` and `SalonInfo` sheets.
4. Note the spreadsheet ID — the other workflows need it.

## Step 2 — Configure credentials in n8n

Create these credentials inside n8n (never in code or in Git):

| Credential | Used by | Notes |
|---|---|---|
| Google Sheets / Calendar / Gmail (OAuth or service account) | All three workflows | One Google connection can serve Sheets, Calendar and Gmail |
| Stripe (test) secret key | Booking API | Test-mode keys only (`sk_test_…`) |
| Stripe webhook secret (test) | Booking API | For payment confirmation events |
| OpenAI API key | AI Chat Assistant | Header-auth credential in n8n |

## Step 3 — Activate the Booking API

1. Import the **GENT'S STUDIO — Booking API** workflow.
2. Point its Sheets nodes at the spreadsheet from Step 1 and select the credentials from Step 2.
3. Activate the workflow and copy its production webhook URL(s).
4. Create the first administrator in the `Admins` sheet (password stored as a PBKDF2 hash — use the project's admin-seeding step, never a plain-text password).

## Step 4 — Activate the AI Chat Assistant

1. Import the **GENT'S STUDIO — AI Chat Assistant** workflow.
2. Set its OpenAI credential and point its HTTP Request tools at the Booking API webhook URL from Step 3.
3. Activate it and copy the chat webhook URL for the website.

## Step 5 — Deploy the website

1. Deploy the static site (HTML/CSS/JavaScript) to Netlify.
2. Configure the site with:
   - the **Booking API webhook URL** (booking, availability, admin), and
   - the **AI Chat Assistant webhook URL** (chat widget).
3. Open the live site and run an end-to-end test booking.

## Configuration reference (names only)

| Value | Where it lives |
|---|---|
| Google Sheets spreadsheet ID | n8n workflow configuration |
| Google credentials | n8n credential store |
| Stripe secret + publishable keys (test) | n8n credential store / site config (publishable only) |
| Stripe webhook secret (test) | n8n credential store |
| OpenAI API key | n8n credential store |
| Booking API webhook URL | Website configuration |
| Chat Assistant webhook URL | Website configuration |
| Admin seed credentials | Set by the owner in n8n / Sheets — never committed |

## Verification checklist

- [ ] DB Setup ran once and all nine sheets exist
- [ ] A test booking appears in `Appointments`, creates a Calendar event, and triggers a confirmation email
- [ ] Reschedule and cancel update both Sheets and Calendar
- [ ] The chatbot can quote a real price and complete a booking after confirmation
- [ ] Admin login works and sessions expire
- [ ] Stripe test checkout completes with a test card (e.g. 4242…) — test mode only
