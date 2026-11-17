/* GENT'S STUDIO — global configuration
 * API_URL is the single n8n webhook endpoint (POST, body { action, ...fields }).
 * While it is empty the app runs in DEVELOPMENT MODE: no request is faked,
 * every action that needs the backend shows a clear development-mode notice.
 */
const CONFIG = {
  APP_NAME: "GENT'S STUDIO",
  /* Single n8n webhook endpoint (workflow "GENT'S STUDIO — Booking API").
   * Leave empty ("") to run in development mode with no backend. */
  API_URL: "https://balancedorangutanmgrq1.app.n8n.cloud/webhook/gents-studio-api",
  /* n8n Chat Trigger (workflow "GENT'S STUDIO — AI Chat Assistant"), embedded mode. */
  CHAT_URL: "https://balancedorangutanmgrq1.app.n8n.cloud/webhook/95eb8f13-39dc-4a37-8800-ef81e8550605/chat",
  REQUEST_TIMEOUT_MS: 25000,
  CURRENCY: "USD",
  CURRENCY_SYMBOL: "$",
  PAYMENTS_TEST_MODE: true,   // Stripe runs in TEST mode only (backend enforces livemode === false)

  /* Maps each frontend call to the backend "action". A function receives the
   * request body and returns [action, body] when the mapping depends on input. */
  ACTIONS: {
    services:          "get_services",
    barbers:           "get_barbers",
    slots:             "get_availability",
    createBooking:     "create_booking",
    lookupBooking:     "get_booking",
    updateBooking:     "update_booking",
    cancelBooking:     "cancel_booking",
    deleteBooking:     "delete_booking",
    createPayment:     "create_payment",
    verifyPayment:     "verify_payment",
    login:             "admin_login",
    logout:            "admin_logout",
    verify:            "verify_session",
    adminStats:        "get_dashboard",
    adminAppointments: "get_bookings",
    adminAppointment:  body => [body.appointmentId ? "update_booking" : "create_booking", body],
    adminApptStatus:   "update_status",
    adminCustomers:    "get_customers",
    adminServices:     body => ["get_services", Object.assign({}, body, { all: true })],
    adminServiceSave:  "manage_service",
    adminBarbers:      body => ["get_barbers", Object.assign({}, body, { all: true })],
    adminBarberSave:   "manage_barber",
    adminAnalytics:    "get_analytics",
    adminSettings:     body => {
      const rest = Object.assign({}, body); const op = rest.action; delete rest.action;
      return [op === "save" ? "save_settings" : "get_settings", rest];
    }
  },

  /* Public marketing catalogue — shown on the homepage and used as the
   * booking-form catalogue only when the backend is unreachable (clearly labelled).
   * The live source of truth is the Services / Barbers sheets in Stage 2. */
  CATALOG: {
    services: [
      { id: "SRV-001", name: "Signature Haircut", price: 35, duration: 45, category: "Hair", description: "Consultation, precision cut, wash and styled finish." },
      { id: "SRV-002", name: "Skin Fade",         price: 40, duration: 50, category: "Hair", description: "Seamless zero-to-length fade with razor detailing." },
      { id: "SRV-003", name: "Beard Sculpt",      price: 25, duration: 30, category: "Beard", description: "Shape, line-up and conditioning oil treatment." },
      { id: "SRV-004", name: "Hot Towel Shave",   price: 30, duration: 40, category: "Shave", description: "Traditional straight-razor shave with hot towels." },
      { id: "SRV-005", name: "Cut & Beard",       price: 55, duration: 75, category: "Combo", description: "Our signature haircut paired with a full beard sculpt." },
      { id: "SRV-006", name: "The Gentleman",     price: 85, duration: 105, category: "Combo", description: "Cut, shave, facial and scalp massage. The full ritual." }
    ],
    barbers: [
      { id: "BRB-001", name: "Marcus Hale",   title: "Master Barber",   years: 12, specialties: ["Classic cuts", "Hot towel shave"], initials: "MH" },
      { id: "BRB-002", name: "Omar Siddiqui", title: "Fade Specialist", years: 8,  specialties: ["Skin fades", "Designs"],         initials: "OS" },
      { id: "BRB-003", name: "Leo Carter",    title: "Beard Artisan",   years: 6,  specialties: ["Beard sculpting", "Line-ups"],   initials: "LC" },
      { id: "BRB-004", name: "Daniel Reyes",  title: "Senior Stylist",  years: 10, specialties: ["Textured crops", "Long hair"],   initials: "DR" }
    ]
  },

  HOURS: [
    { day: "Monday – Friday", time: "9:00 AM – 8:00 PM" },
    { day: "Saturday",        time: "9:00 AM – 6:00 PM" },
    { day: "Sunday",          time: "11:00 AM – 4:00 PM" }
  ],
  CONTACT: { address: "24 Mercer Street, Downtown", phone: "+1 (555) 014-2290", email: "hello@gentsstudio.com" }
};

Object.freeze(CONFIG);
