/* GENT'S STUDIO — shared site behaviour + homepage rendering */
document.addEventListener("DOMContentLoaded", () => {
  /* Mobile navigation */
  const nav = document.querySelector(".nav");
  const burger = document.querySelector(".nav__burger");
  if (burger && nav) {
    burger.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("no-scroll", open);
    });
    Utils.$$(".nav__links a").forEach(a => a.addEventListener("click", () => {
      nav.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
      document.body.classList.remove("no-scroll");
    }));
  }

  /* Header shadow on scroll */
  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* Active nav link */
  const page = location.pathname.split("/").pop() || "index.html";
  Utils.$$(".nav__links a").forEach(a => {
    if (a.getAttribute("href") === page) a.classList.add("is-active");
  });

  /* Footer year */
  Utils.$$("[data-year]").forEach(el => (el.textContent = new Date().getFullYear()));

  /* Reveal on scroll */
  const io = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
  }, { threshold: 0.12 }) : null;
  const observeReveals = () => Utils.$$(".reveal:not(.is-in)").forEach(el => io ? io.observe(el) : el.classList.add("is-in"));

  /* Homepage sections */
  const servicesGrid = document.getElementById("services-grid");
  if (servicesGrid) {
    const serviceImages = [
      "photo-1621605815971-fbc98d665033",
      "photo-1622286342621-4bd786c2447c",
      "photo-1599351431202-1e0f0137899a",
      "photo-1503951914875-452162b0f3f1",
      "photo-1621605815971-fbc98d665033",
      "photo-1599351431202-1e0f0137899a"
    ];
    servicesGrid.innerHTML = CONFIG.CATALOG.services.map((s, i) => `
      <article class="service-card reveal" style="--d:${i * 60}ms">
        <div class="service-card__image">
          <img src="https://images.unsplash.com/${serviceImages[i % serviceImages.length]}?auto=format&amp;fit=crop&amp;w=900&amp;q=80" alt="" loading="lazy" decoding="async">
        </div>
        <div class="service-card__top">
          <span class="service-card__cat">${Utils.escape(s.category)}</span>
          <span class="service-card__dur">${Utils.duration(s.duration)}</span>
        </div>
        <h3 class="service-card__name">${Utils.escape(s.name)}</h3>
        <p class="service-card__desc">${Utils.escape(s.description)}</p>
        <div class="service-card__foot">
          <span class="service-card__price">${Utils.money(s.price)}</span>
          <a class="link-arrow" href="booking.html?service=${encodeURIComponent(s.id)}">Book <span aria-hidden="true">→</span></a>
        </div>
      </article>`).join("");
  }

  const barbersGrid = document.getElementById("barbers-grid");
  if (barbersGrid) {
    const barberImages = [
      "photo-1507003211169-0a1dd7228f2d",
      "photo-1500648767791-00dcc994a43e",
      "photo-1506794778202-cad84cf45f1d",
      "photo-1507591064344-4c6ce005b128"
    ];
    barbersGrid.innerHTML = CONFIG.CATALOG.barbers.map((b, i) => `
      <article class="barber-card reveal" style="--d:${i * 80}ms">
        <div class="barber-card__portrait">
          <img src="https://images.unsplash.com/${barberImages[i % barberImages.length]}?auto=format&amp;fit=crop&amp;crop=faces&amp;w=700&amp;h=800&amp;q=85" alt="" loading="lazy" decoding="async">
          <span>${Utils.escape(b.initials)}</span>
        </div>
        <div class="barber-card__body">
          <p class="eyebrow">${Utils.escape(b.title)}</p>
          <h3>${Utils.escape(b.name)}</h3>
          <p class="barber-card__years">${b.years} years behind the chair</p>
          <ul class="chips">${b.specialties.map(s => `<li>${Utils.escape(s)}</li>`).join("")}</ul>
          <a class="btn btn--outline btn--sm" href="booking.html?barber=${encodeURIComponent(b.id)}">Book with ${Utils.escape(b.name.split(" ")[0])}</a>
        </div>
      </article>`).join("");
  }

  const hoursList = document.getElementById("hours-list");
  if (hoursList) {
    hoursList.innerHTML = CONFIG.HOURS.map(h => `<li><span>${Utils.escape(h.day)}</span><span>${Utils.escape(h.time)}</span></li>`).join("");
  }
  Utils.$$("[data-contact]").forEach(el => { el.textContent = CONFIG.CONTACT[el.dataset.contact] || ""; });

  /* Testimonials slider */
  const track = document.getElementById("testimonial-track");
  if (track) {
    const slides = Utils.$$(".testimonial", track);
    const dots = document.getElementById("testimonial-dots");
    let idx = 0, timer;
    dots.innerHTML = slides.map((_, i) => `<button aria-label="Show testimonial ${i + 1}" data-i="${i}"></button>`).join("");
    const go = i => {
      idx = (i + slides.length) % slides.length;
      slides.forEach((s, j) => s.classList.toggle("is-active", j === idx));
      Utils.$$("button", dots).forEach((d, j) => d.classList.toggle("is-active", j === idx));
    };
    const auto = () => { clearInterval(timer); timer = setInterval(() => go(idx + 1), 6000); };
    dots.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { go(+b.dataset.i); auto(); } });
    go(0); auto();
  }

  observeReveals();
});
