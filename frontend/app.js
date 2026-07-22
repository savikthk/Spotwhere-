const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

const USER_ID =
  (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || 1;

// Открыть внешнюю ссылку (карты) правильно из Telegram Mini App.
function openExternal(url) {
  if (tg && tg.openLink) tg.openLink(url);
  else window.open(url, "_blank");
}

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

    const addr = venue.address ? `<p class="addr">📍 ${venue.address}</p>` : "";
    card.innerHTML = `
      <h3>${venue.name}</h3>
      <p>${venue.description}</p>
      ${addr}
      <p class="bill">Средний счёт: ~${venue.avg_bill} ₽</p>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    const onMap = document.createElement("button");
    onMap.className = "link";
    onMap.textContent = "📍 На карте";
    onMap.addEventListener("click", () => openExternal(venue.maps_url));

    const route = document.createElement("button");
    route.className = "link";
    route.textContent = "🧭 Маршрут";
    route.addEventListener("click", () =>
      openExternal(`https://yandex.ru/maps/?rtext=~${venue.lat},${venue.lon}`)
    );

    actions.appendChild(onMap);
    actions.appendChild(route);

    if (withLike) {
      const like_ = document.createElement("button");
      like_.className = "like";
      like_.textContent = "👍 Нравится";
      like_.addEventListener("click", () => like(venue.id, like_));
      actions.appendChild(like_);
    }

    card.appendChild(actions);
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
