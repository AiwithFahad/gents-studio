# GENT'S STUDIO — Backend API reference

**Endpoint (live):** `POST https://balancedorangutanmgrq1.app.n8n.cloud/webhook/gents-studio-api`
**n8n workflow:** "GENT'S STUDIO — Booking API" (id `CE9kdohMOub2Zv9I`), published.
**Database:** Google Sheet `GENTS_STUDIO_DB` (id `1rPysBCDjubghoHJ1NCKtTowPCEaAbZpf6svxm5UKnAQ`).

Every request is `POST` with a JSON body `{ "action": "...", ...fields }`.
Admin actions need `Authorization: Bearer <token>` (or `"token"` in the body).

```
Success: { "success": true,  "message": "Booking created successfully", "data": { ... } }
Error:   { "success": false, "message": "Selected time slot is unavailable", "code": "SLOT_UNAVAILABLE" }
```

| HTTP | Meaning | Example codes |
|---|---|---|
| 200 / 201 | OK / created | |
| 400 | Malformed request | `BAD_REQUEST`, `UNKNOWN_ACTION` |
| 401 | Not signed in / session expired / wrong password | `UNAUTHORIZED`, `INVALID_CREDENTIALS` |
| 402 | Payment not completed | `NOT_PAID` |
| 404 | Not found **or** identity mismatch (never reveals which) | `NOT_FOUND` |
| 409 | Conflict | `SLOT_UNAVAILABLE`, `NOT_EDITABLE`, `TOO_LATE`, `DUPLICATE`, `ALREADY_PAID` |
| 422 | Validation failed (`errors` object per field) | `VALIDATION`, `INVALID_DATE`, `OUTSIDE_HOURS`, `BARBER_OFF` |
| 429 | Too many failed logins (5 per 15 min) | `TOO_MANY_ATTEMPTS` |
| 502 / 503 | Calendar / Stripe / Sheets failure, nothing half-saved | `CALENDAR_FAILED`, `DB_UNAVAILABLE`, `DB_WRITE_FAILED` |

Set `URL=https://balancedorangutanmgrq1.app.n8n.cloud/webhook/gents-studio-api` for the examples.

## Public (customer) actions

```bash
# Services / barbers (active only)
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"get_services"}'
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"get_barbers"}'

# Availability (barberId may be "any"; excludeAppointmentId when rescheduling)
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"get_availability","serviceId":"SRV-001","barberId":"BRB-001","date":"2026-11-20"}'
# -> data: [{"time":"09:00","available":true}, ...]

# Create booking (returnUrl enables the Stripe TEST checkout link)
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{
  "action":"create_booking","customerName":"James Walker","email":"james@example.com","phone":"+1 555 201 1001",
  "serviceId":"SRV-001","barberId":"BRB-001","date":"2026-11-20","time":"10:00","notes":"Short on the sides",
  "clientRequestId":"b7d1c2e0-uuid","returnUrl":"https://your-site.com/booking.html"}'
# -> 201 data: { appointment_id, appointmentId, status:"confirmed", checkoutUrl:"https://checkout.stripe.com/...", paymentMode:"test", ... }

# Read one booking (ID + email or phone used to book)
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"get_booking","appointmentId":"GS-20261120-AB12","identity":"james@example.com"}'

# A customer's bookings (email AND phone required)
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"get_bookings","email":"james@example.com","phone":"+1 555 201 1001"}'

# Update / reschedule
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"update_booking","appointmentId":"GS-20261120-AB12","identity":"james@example.com","serviceId":"SRV-002","barberId":"BRB-002","date":"2026-11-21","time":"14:00"}'

# Cancel (status=cancelled, calendar event removed, email sent)
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"cancel_booking","appointmentId":"GS-20261120-AB12","identity":"james@example.com"}'

# Soft delete (status=deleted + deleted_at, row retained, calendar event removed)
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"delete_booking","appointmentId":"GS-20261120-AB12","identity":"james@example.com"}'

# Stripe TEST payments
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"create_payment","appointmentId":"GS-20261120-AB12","identity":"james@example.com","returnUrl":"https://your-site.com/my-bookings.html"}'
curl -s -X POST $URL -H 'Content-Type: application/json' -d '{"action":"verify_payment","appointmentId":"GS-20261120-AB12","sessionId":"cs_test_..."}'
```

## Admin actions

```bash
TOKEN=$(curl -s -X POST $URL -H 'Content-Type: application/json' \
  -d '{"action":"admin_login","email":"admin321@example.com","password":"Admin 321"}' | jq -r .data.token)
A="Authorization: Bearer $TOKEN"

curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"verify_session"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"get_dashboard"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"get_bookings"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"get_booking","appointmentId":"GS-20261120-AB12"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"update_status","appointmentId":"GS-20261120-AB12","status":"completed"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"create_booking","customerName":"Walk In","email":"w@example.com","phone":"+15550001111","serviceId":"SRV-003","barberId":"BRB-001","date":"2026-11-20","time":"16:00","status":"confirmed"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"get_customers"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"get_analytics"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"get_services","all":true}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"manage_service","name":"Kids Cut","price":20,"duration":30,"category":"Hair"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"manage_service","id":"SRV-002","price":45}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"manage_service","id":"SRV-002","active":false}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"manage_barber","name":"Zed Cooper","title":"Barber","specialties":["Fades"],"workingDays":"Mon,Tue,Wed","startTime":"10:00","endTime":"18:00"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"manage_barber","id":"BRB-004","active":false}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"get_settings"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"save_settings","slotInterval":"15","bufferMinutes":"5"}'
curl -s -X POST $URL -H "$A" -H 'Content-Type: application/json' -d '{"action":"admin_logout"}'
```

## Google Sheets schema (`GENTS_STUDIO_DB`)

IDs are generated strings (`GS-YYYYMMDD-XXXX`, `CUS-…`, `SRV-…`, `BRB-…`, `SES-…`, `LOG-…`); row numbers are only used transiently inside one request.

| Tab | Columns |
|---|---|
| Appointments | appointment_id, customer_id, customer_name, email, phone, service_id, service_name, barber_id, barber_name, appointment_date, start_time, end_time, duration, price, status, payment_status, stripe_session_id, notes, source, client_request_id, calendar_event_id, created_at, updated_at, deleted_at |
| Services | service_id, name, description, category, price, duration, active, created_at, updated_at |
| Barbers | barber_id, name, title, email, years, specialties, working_days, start_time, end_time, active, created_at, updated_at |
| Customers | customer_id, name, email, phone, created_at, updated_at |
| Admins | admin_id, name, email, password_hash (`pbkdf2$120000$salt$hash`), role, active, created_at, last_login_at |
| Sessions | session_id, token_hash (SHA-256 of the token; raw token never stored), admin_id, email, created_at, expires_at, revoked_at |
| ActivityLogs | log_id, timestamp, actor, action, entity, entity_id, details (JSON) |
| Settings | key, value, updated_at |

Status values: `pending, confirmed, completed, cancelled, no-show, deleted`. Payment: `unpaid, paid, n/a`.
