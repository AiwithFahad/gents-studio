# GENT'S STUDIO — The Three n8n Workflows in Detail

The backend is three n8n workflows. This document describes each one's job, inputs and outputs, as designed by the project author.

## 1. GENT'S STUDIO — DB Setup

**Purpose:** one-time initialization of the database.

Run once on a fresh deployment. It creates the Google Sheets workbook structure the other two workflows depend on:

| Sheet | Purpose |
|---|---|
| `Appointments` | All booking records |
| `Services` | Grooming menu with prices and durations |
| `Barbers` | Barber profiles |
| `Customers` | Customer records |
| `Admins` | Administrator accounts |
| `Sessions` | Admin session tokens |
| `ActivityLogs` | Audit trail |
| `Settings` | Platform settings |
| `SalonInfo` | Salon identity and contact details |

**When to re-run:** only for a fresh database. Re-running setup against a live database is not part of normal operation.

## 2. GENT'S STUDIO — Booking API

**Purpose:** the centralized API and the single source of business rules for the whole platform.

**Callers:** the website (booking flow, booking management, admin dashboard) and the AI Chat Assistant — both over HTTP webhooks.

**Responsibilities:**

- **Booking creation and management** — create, update and cancel appointments.
- **Availability checking** — real-time slot availability against existing appointments and Google Calendar.
- **Admin authentication and permissions** — login, hashed session tokens, expiry, logout, and permission checks for admin operations.
- **Google Calendar synchronization** — one event per appointment, kept in step with booking changes.
- **Stripe test-mode payments** — checkout for bookings that require payment, in test mode.
- **Google Sheets database operations** — appointments, customers, services, barbers, sessions and settings.
- **Customer records and activity logs** — every significant action is written to `ActivityLogs`.
- **Email confirmations and notifications** — Gmail messages for created, updated and cancelled bookings.
- **Error handling and rollback** — if a save fails after a calendar event exists, the workflow attempts to remove the event to prevent inconsistent records.

**Booking pipeline:** Understand → Calendar → Payment → Save → Notify → Reply (see [ARCHITECTURE.md](ARCHITECTURE.md)).

## 3. GENT'S STUDIO — AI Chat Assistant

**Purpose:** an AI-powered chatbot (OpenAI) embedded in the website.

**What it can do:**

- Answer salon-related questions (services, prices, durations, barbers, hours).
- Retrieve live services and barber information.
- Check appointment availability.
- Look up a customer's existing bookings (after identity verification).
- Create, update (reschedule) and cancel bookings.

**How it works:**

- It uses conversation memory so follow-up requests ("move it to Friday instead") keep context.
- For anything involving bookings, it calls the **Booking API** with HTTP Request tools — it does not access the Sheets database directly, so business rules stay centralized.
- It **requests customer confirmation before making changes**: the assistant summarizes what will change and only proceeds after the customer agrees.

## Data flow summary

```
Website ──HTTP──► Booking API ──► Sheets / Calendar / Gmail / Stripe
Chat UI ──► AI Chat Assistant ──HTTP──► Booking API ──► (same as above)
DB Setup ──(once)──► creates the Sheets database both others rely on
```
