# GENT'S STUDIO — System Architecture

How the platform fits together, as designed and documented by the project author. The live deployment is at https://gents-studio.netlify.app/.

## Overview

```
Customer Website ──┐
                   ├──► Booking API (n8n) ──► Google Sheets (database)
AI Chat Assistant ─┘          │
                              ├──► Google Calendar (appointment sync)
                              ├──► Gmail (confirmations & notifications)
                              └──► Stripe (test-mode checkout)
```

Three n8n workflows run the entire backend. The website is a static HTML/CSS/JavaScript frontend hosted on Netlify; it holds no business logic of its own beyond presentation — every booking rule lives in the Booking API.

## The one-API principle

There is exactly **one centralized Booking API**, and it is the single source of business rules:

- The **website** calls the Booking API for availability, booking creation, updates and cancellation.
- The **AI Chat Assistant** calls the same Booking API over HTTP for the same operations. It never reads or writes the booking database directly.

This keeps validation, availability, permissions and booking operations consistent no matter which surface the customer uses.

## Components

| Component | Role |
|---|---|
| Website (Netlify) | Services, barbers, booking flow, booking management, chat widget, admin login + dashboard |
| Booking API (n8n) | All booking operations, availability, admin auth, calendar sync, payments, email, logging, rollback |
| AI Chat Assistant (n8n + OpenAI) | Conversational front-end to the Booking API |
| DB Setup (n8n) | One-time initialization of the Google Sheets database |
| Google Sheets | Database — see schema below |
| Google Calendar | One calendar event per appointment; source for availability conflicts |
| Gmail | Booking confirmations and notifications |
| Stripe | Checkout in test mode |

## Database schema (Google Sheets)

Created by the DB Setup workflow:

| Sheet | Holds |
|---|---|
| `Appointments` | Booking records: customer, service, barber, slot, status, payment state |
| `Services` | The grooming menu: names, prices, durations, active state |
| `Barbers` | Barber profiles and availability basics |
| `Customers` | Customer records created/updated on booking |
| `Admins` | Administrator accounts (passwords stored as PBKDF2 hashes) |
| `Sessions` | Admin sessions (hashed tokens, expiry) |
| `ActivityLogs` | Audit trail of booking and admin activity |
| `Settings` | Platform configuration |
| `SalonInfo` | Salon name, contact and presentation details |

## Booking lifecycle

**Understand → Calendar → Payment → Save → Notify → Reply**

1. **Understand** — the API parses the request and validates it: known service and barber, a slot that fits salon hours, customer identity details, and a duplicate check so the same request isn't booked twice.
2. **Calendar** — availability is checked against Google Calendar and the appointment event is created.
3. **Payment** — where payment applies, a Stripe checkout runs in test mode.
4. **Save** — the appointment, customer record and activity-log entries are written to Google Sheets.
5. **Notify** — Gmail sends the customer confirmation (and any update/cancellation notice).
6. **Reply** — the API returns the final result to the website or the chatbot.

### Rollback

Steps can fail mid-flight. The dangerous case is a calendar event that exists without a database record (or the reverse). If the Sheets save fails after a calendar event has been created, the workflow attempts to delete that event, restoring consistency instead of leaving a phantom booking.

## Admin

- Secure administrator authentication against the `Admins` sheet (PBKDF2-hashed passwords).
- Sessions use hashed tokens with expiration and logout handling.
- The admin dashboard manages appointments and services, backed by the same Booking API and its permission checks.

## Security notes

- Customer identity verification is required before the chatbot or website reveals or changes an existing booking.
- The AI assistant asks for explicit customer confirmation before creating, rescheduling or cancelling a booking.
- No credentials are stored in this repository; Google, Stripe and OpenAI credentials live in n8n's credential store. See [SETUP.md](SETUP.md).
