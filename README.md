# ✂️ GENT'S STUDIO — AI-Powered Men's Grooming Platform

![GENT'S STUDIO](banner.jpg)

A modern men's grooming salon platform combining **online appointment booking, AI-powered customer assistance, automated business workflows, and centralized salon management.**

🌐 **Live Website: https://gents-studio.netlify.app/**

![Status](https://img.shields.io/badge/status-live-brightgreen) ![Frontend](https://img.shields.io/badge/frontend-HTML%20%2F%20CSS%20%2F%20JavaScript-orange) ![Backend](https://img.shields.io/badge/backend-n8n-FF6D5A) ![AI](https://img.shields.io/badge/AI-OpenAI-412991) ![Payments](https://img.shields.io/badge/Stripe-test%20mode-635BFF) ![Hosting](https://img.shields.io/badge/hosting-Netlify-00C7B7)

## 🚀 Project Overview

GENT'S STUDIO is a full-stack salon management and appointment booking platform designed to simplify the customer booking experience and automate salon operations.

Customers can explore grooming services, choose their preferred barber, check available time slots, book appointments, and manage existing reservations through an intuitive website. The platform also features an AI-powered chatbot that assists customers with salon information and appointment management.

Its backend is powered by **three interconnected n8n workflows**, with a centralized Booking API responsible for enforcing business rules and coordinating external services — Google Sheets, Google Calendar, Gmail, Stripe (test mode), and OpenAI.

## 📸 Screenshots & Live Demo

The fastest way to see the platform is the live site: **https://gents-studio.netlify.app/**

| View | What you see |
|---|---|
| **Home** | The studio story — "Sharp cuts. Quiet confidence." — services menu, the barber team, opening hours and testimonials |
| **Services & Pricing** | The full grooming menu with live prices and durations |
| **Barbers** | The team of four specialist barbers |
| **Booking** | Pick a service, barber and available time slot; confirmation lands in your inbox |
| **AI Chat** | The website chatbot — ask about services, check availability, manage a booking |
| **Admin** | Secure admin login and dashboard for appointments and services |

## ✨ Key Features

- Modern, responsive salon website
- Online appointment booking and management
- Live services, barber profiles, and pricing
- Real-time appointment availability checking
- Booking creation, updating, and cancellation
- AI-powered website chatbot
- Automated booking confirmation and notification emails
- Google Calendar appointment synchronization
- Google Sheets database management
- Stripe checkout integration (test mode)
- Secure administrator authentication and admin dashboard
- Booking validation and duplicate-request protection
- Automated activity logging and rollback handling

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| HTML, CSS, JavaScript | Frontend website |
| n8n | Automation backend — all business logic and integrations |
| OpenAI | AI chat assistant |
| Google Sheets | Database (appointments, services, barbers, customers, admins, sessions, logs, settings) |
| Google Calendar | Appointment synchronization |
| Gmail | Booking confirmations and notifications |
| Stripe | Checkout — **test mode only** |
| Netlify | Website hosting |

## 🏗️ System Architecture

The system runs on three n8n workflows:

| # | Workflow | Responsibility |
|---|---|---|
| 1 | **GENT'S STUDIO — DB Setup** | Creates and initializes the Google Sheets database |
| 2 | **GENT'S STUDIO — Booking API** | Centralized API: bookings, availability, admin auth, calendar, payments, email |
| 3 | **GENT'S STUDIO — AI Chat Assistant** | AI chatbot for customer support and booking assistance |

**Architecture principle: one centralized Booking API, one source of business rules.**

The AI chatbot communicates with the Booking API over HTTP instead of independently managing bookings or modifying appointment records. Validation, availability, permissions, and booking operations stay consistent across the website and the chatbot.

```
Customer Website ──┐
                   ├──► Booking API (n8n) ──► Google Sheets (database)
AI Chat Assistant ─┘          │
                              ├──► Google Calendar (sync)
                              ├──► Gmail (confirmations)
                              └──► Stripe (test-mode checkout)
```

📐 **Detail:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · **Workflows in depth:** [docs/WORKFLOWS.md](docs/WORKFLOWS.md) · **Setup guide:** [docs/SETUP.md](docs/SETUP.md)

### 1. DB Setup workflow

Creates and initializes the Google Sheets database, including these sheets:

`Appointments` · `Services` · `Barbers` · `Customers` · `Admins` · `Sessions` · `ActivityLogs` · `Settings` · `SalonInfo`

### 2. Booking API workflow

The centralized API responsible for:

- Booking creation and management
- Availability checking
- Admin authentication and permissions
- Google Calendar synchronization
- Stripe test-mode payments
- Google Sheets database operations
- Customer records and activity logs
- Email confirmations and notifications
- Error handling and rollback

### 3. AI Chat Assistant workflow

The AI chatbot that answers salon questions and performs booking operations **through the Booking API** — see the chatbot section below.

## 🔄 Booking Lifecycle

The Booking API follows this process:

**Understand → Calendar → Payment → Save → Notify → Reply**

1. **Understand** — parse and validate the request (service, barber, slot, customer identity).
2. **Calendar** — check real-time availability and reserve the slot in Google Calendar.
3. **Payment** — where a payment applies, run Stripe checkout in test mode.
4. **Save** — write the booking, customer record and activity log to Google Sheets.
5. **Notify** — send the confirmation email via Gmail.
6. **Reply** — return the final result to the website or chatbot.

**Rollback:** if a database save fails after a calendar event has been created, the workflow attempts to remove that event, so the calendar and the database don't drift apart.

## 🤖 AI Chat Assistant

The AI chatbot helps customers:

- Discover salon services, prices and durations
- Explore available barbers
- Check appointment availability
- Look up existing bookings
- Create new appointments
- Reschedule appointments
- Cancel appointments

It uses conversation memory and connected tools to retrieve information and perform booking operations through the centralized Booking API, and it **requests customer confirmation before making changes** — no silent edits to anyone's booking.

## 🔐 Security & Validation

- PBKDF2 password hashing for admin accounts
- Hashed administrator session tokens, with session expiration and logout handling
- Customer identity verification for booking lookups and changes
- Booking validation and duplicate-request protection
- Explicit customer confirmation before AI booking changes
- **No API keys, passwords, tokens, or customer data are stored in this repository** — credentials live in n8n and environment configuration only (see [docs/SETUP.md](docs/SETUP.md))

## 🧪 Testing

The reported backend integration tests passed for the tested booking, calendar, email, payment, chatbot, and admin scenarios. Testing covered:

- Appointment creation, updating, and cancellation
- Booking validation and duplicate prevention
- Customer identity verification
- Calendar event synchronization
- Email notifications
- Admin authentication and service management
- AI chatbot booking operations
- Error handling and rollback

**Known limitations**

- The latest delivered local website build was tested against the live backend; the deployed website's exact JavaScript implementation was not independently verified against that build.
- Stripe was tested in **test mode only** — no live payments.
- Google Sheets is the database: practical and transparent for a single salon, but not a substitute for a transactional database at multi-branch scale.

## ⚙️ Installation & Configuration

Full step-by-step instructions are in **[docs/SETUP.md](docs/SETUP.md)**. In short:

1. Deploy the static website (Netlify) and point it at your Booking API webhook URLs.
2. In n8n, run the **DB Setup** workflow once to create the Google Sheets database.
3. Configure credentials in n8n for Google Sheets, Google Calendar, Gmail, Stripe (test mode), and OpenAI.
4. Import and activate the **Booking API** and **AI Chat Assistant** workflows.
5. Create the first admin account and verify a test booking end to end.

**Configuration values you will need** (names only — never commit real values):

| Variable / Credential | Used for |
|---|---|
| Google Sheets spreadsheet ID | The salon database created by DB Setup |
| Google service / OAuth credentials | Sheets + Calendar + Gmail access from n8n |
| Stripe secret + publishable keys (test) | Test-mode checkout |
| Stripe webhook secret (test) | Payment confirmation handling |
| OpenAI API key | AI Chat Assistant |
| Admin seed credentials | First admin login (set in n8n / Sheets, never in code) |
| Booking API webhook URL | Website + chatbot → Booking API |

## 🔮 Future Improvements

- Production-ready payment processing
- Enhanced analytics and reporting
- Advanced appointment management
- Improved chatbot capabilities
- Additional customer engagement features

## 📌 Project Purpose

This project demonstrates practical integration of frontend development, AI agents, workflow automation, API architecture, database management, appointment scheduling, and third-party services in a real-world business application — built to be shared with recruiters, developers, and potential clients.

## 👤 Author

**Fahad Ahmed Shanawar** — AI Engineer · Agentic AI & Automation
🔗 LinkedIn: https://www.linkedin.com/in/fahad-ahmed-shanawar-107a5535a/
💻 GitHub: https://github.com/AiwithFahad

## 📄 License

Released under the [MIT License](LICENSE).
