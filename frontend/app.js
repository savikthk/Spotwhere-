const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.requestFullscreen) try { tg.requestFullscreen(); } catch (e) {}
  if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
}

const USER_ID =
  (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || 1;

function openExternal(url) {
  if (tg && tg.openLink) tg.openLink(url);
  else window.open(url, "_blank");
}

const form = document.getElementById("search-form");
const queryEl = document.getElementById("query");
const stackEl = document.getElementById("stack");
const nearEl = document.getElementById("near");
const contextEl = document.getElementById("context");

let point = null;

function formatDistance(meters) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1).replace(/\.0$/, "")} km`;
}

function placeLine(place) {
  if (!place) return "Across the whole city";
  const within = place.radius_m ? ` · within ${formatDistance(place.radius_m)}` : "";
  switch (place.kind) {
    case "metro": return `Near metro «${place.name}»${within}`;
    case "district": return `In ${place.name}`;
    case "user": return `Near you${within}`;
    default: return `Near «${place.name}»${within}`;
  }
}

function noteLine(note) {
  switch (note.code) {
    case "radius_expanded": return `Nothing closer, so the search widened to ${formatDistance(note.radius_m)}`;
    case "area_expanded": return `Nothing inside, so the search took ${formatDistance(note.buffer_m)} around`;
    case "filters_relaxed": return "No exact matches nearby, showing other places";
    case "place_not_found": return `Couldn't find «${note.text}» on the map, searching the whole city`;
    case "outside_city": return "You're outside Moscow, searching the whole city";
    case "location_needed": return "Tap «Near me» to search around you";
    default: return "";
  }
}

function showContext(lines) {
  contextEl.replaceChildren();
  lines.filter(Boolean).forEach((line, index) => {
    const p = document.createElement("p");
    if (index === 0) p.className = "where";
    p.textContent = line;
    contextEl.appendChild(p);
  });
  contextEl.hidden = contextEl.childElementCount === 0;
}

function locate() {
  const manager = tg && tg.LocationManager;
  if (manager) {
    return new Promise((resolve) => {
      const read = () => {
        if (!manager.isLocationAvailable) return resolve(null);
        manager.getLocation((data) => resolve(data ? { lat: data.latitude, lon: data.longitude } : null));
      };
      if (manager.isInited) read();
      else manager.init(read);
    });
  }
  if (navigator.geolocation) {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
      );
    });
  }
  return Promise.resolve(null);
}

nearEl.addEventListener("click", async () => {
  if (point) {
    point = null;
    nearEl.setAttribute("aria-pressed", "false");
    showContext([]);
    return;
  }
  nearEl.disabled = true;
  nearEl.textContent = "Locating…";
  point = await locate();
  nearEl.disabled = false;
  nearEl.textContent = "Near me";
  nearEl.setAttribute("aria-pressed", point ? "true" : "false");
  showContext([point ? "Searching around you" : "Couldn't get your location. Allow it in Telegram settings"]);
  if (point && queryEl.value.trim()) form.requestSubmit();
});

document.getElementById("clear").addEventListener("click", () => {
  queryEl.value = "";
  stackEl.replaceChildren();
  showContext([]);
  queryEl.focus();
});

function message(text) {
  const p = document.createElement("p");
  p.className = "msg";
  p.textContent = text;
  stackEl.replaceChildren(p);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = queryEl.value.trim();
  if (!text) return;
  message("Searching…");

  try {
    const res = await fetch("/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, user_id: USER_ID, ...(point || {}) }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showContext([placeLine(data.place), ...data.notes.map(noteLine)]);
    startDeck(data.results || []);
  } catch (error) {
    message("Something went wrong. Try again in a moment.");
  }
});

let deck = [];
let pos = 0;

function startDeck(list) {
  deck = list;
  pos = 0;
  renderTop();
}

const CARD = `
  <div class="badge like">LIKE</div>
  <div class="badge nope">NOPE</div>
  <div class="map"></div>
  <div class="row">
    <span class="name"></span>
    <span class="price"></span>
  </div>
  <div class="type"><span class="distance"></span><span class="about"></span></div>
  <div class="links">
    <button class="link" data-act="map">On the map</button>
    <button class="link" data-act="route">Route</button>
  </div>
  <button class="round no" aria-label="dislike"><svg viewBox="0 0 24 24"><path d="M7 7 L17 17 M17 7 L7 17" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg></button>
  <button class="round yes" aria-label="like">♥</button>
`;

function renderTop() {
  if (pos >= deck.length) {
    message(deck.length ? "That's all 🙌 Refine your request or search again." : "Nothing found. Try other words or another place.");
    return;
  }

  const v = deck[pos];
  const card = document.createElement("div");
  card.className = "swipe-card";
  card.innerHTML = CARD;
  card.querySelector(".name").textContent = v.name;
  card.querySelector(".price").textContent = `~${v.avg_bill} ₽`;
  card.querySelector(".distance").textContent = v.distance_m === null ? "" : `${formatDistance(v.distance_m)} · `;
  card.querySelector(".about").textContent = v.description + (v.address ? ` · ${v.address}` : "");
  const map = card.querySelector(".map");
  map.id = `map-${v.id}`;

  card.querySelector('[data-act="map"]').addEventListener("click", () => openExternal(v.maps_url));
  card.querySelector('[data-act="route"]').addEventListener("click", () =>
    openExternal(`https://yandex.ru/maps/?rtext=~${v.lat},${v.lon}`)
  );
  card.querySelector(".round.no").addEventListener("click", () => swipe("dislike"));
  card.querySelector(".round.yes").addEventListener("click", () => swipe("like"));

  attachDrag(card);

  card.style.transform = "scale(.96)";
  card.style.opacity = "0";
  stackEl.replaceChildren(card);
  requestAnimationFrame(() => { card.style.transform = ""; card.style.opacity = "1"; });

  initMap(map.id, v.lat, v.lon);
}

function attachDrag(card) {
  let startX = 0, dx = 0, dragging = false;
  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || e.target.closest(".map")) return;
    dragging = true; startX = e.clientX; card.style.transition = "none";
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
    card.querySelector(".badge.like").style.opacity = dx > 0 ? Math.min(dx / 120, 1) : 0;
    card.querySelector(".badge.nope").style.opacity = dx < 0 ? Math.min(-dx / 120, 1) : 0;
  });
  card.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (dx > 110) swipe("like");
    else if (dx < -110) swipe("dislike");
    else {
      card.style.transition = "transform .2s ease";
      card.style.transform = "";
      card.querySelectorAll(".badge").forEach((b) => (b.style.opacity = 0));
    }
    dx = 0;
  });
}

function swipe(action) {
  const card = stackEl.querySelector(".swipe-card");
  const dir = action === "like" ? 1 : -1;

  const v = deck[pos];
  if (v) {
    fetch(`/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, venue_id: v.id }),
    });
  }
  if (card) {
    card.style.transition = "transform .3s ease, opacity .3s ease";
    card.style.transform = `translateX(${dir * 650}px) rotate(${dir * 25}deg)`;
    card.style.opacity = "0";
    const badge = card.querySelector(dir > 0 ? ".badge.like" : ".badge.nope");
    if (badge) badge.style.opacity = "1";
  }
  pos++;
  setTimeout(renderTop, 280);
}

function initMap(elId, lat, lon) {
  if (!window.ymaps) return;
  ymaps.ready(() => {
    const el = document.getElementById(elId);
    if (!el) return;
    const map = new ymaps.Map(el, { center: [lat, lon], zoom: 15, controls: [] });
    map.geoObjects.add(new ymaps.Placemark([lat, lon]));
    map.behaviors.disable("scrollZoom");
  });
}
