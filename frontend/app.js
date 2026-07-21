const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

// Real Telegram id inside Telegram; fallback 1 for browser testing.
const USER_ID =
  (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || 1;

const tabs = document.querySelectorAll(".tab");
tabs.forEach((tab) =>
  tab.addEventListener("click", () => showScreen(tab.dataset.screen))
);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.getElementById(`screen-${name}`).classList.add("active");
  document.querySelector(`.tab[data-screen="${name}"]`).classList.add("active");
  if (name === "places") loadPlaces();
}

const form = document.getElementById("search-form");
const resultsEl = document.getElementById("results");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = document.getElementById("query").value.trim();
  if (!text) return;
  resultsEl.textContent = "Ищу…";

  const res = await fetch("/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, user_id: USER_ID }),
  });
  const data = await res.json();
  renderCards(resultsEl, data.results, true);
});

async function loadPlaces() {
  const el = document.getElementById("places");
  el.textContent = "Загружаю…";
  const res = await fetch("/venues");
  renderCards(el, await res.json(), false);
}

function renderCards(container, venues, withLike) {
  container.innerHTML = "";
  if (!venues || venues.length === 0) {
    container.textContent = "Ничего не нашёл. Попробуй по-другому.";
    return;
  }
  for (const venue of venues) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${venue.name}</h3>
      <p>${venue.description}</p>
      <p class="bill">Средний счёт: ${venue.avg_bill} ₽</p>
    `;
    if (withLike) {
      const btn = document.createElement("button");
      btn.textContent = "👍 Нравится";
      btn.addEventListener("click", () => like(venue.id, btn));
      card.appendChild(btn);
    }
    container.appendChild(card);
  }
}

async function like(venueId, btn) {
  await fetch("/like", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: USER_ID, venue_id: venueId }),
  });
  btn.textContent = "✓ Запомнил";
  btn.disabled = true;
}
