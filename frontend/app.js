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

document.getElementById("clear").addEventListener("click", () => {
  queryEl.value = "";
  stackEl.innerHTML = "";
  queryEl.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = queryEl.value.trim();
  if (!text) return;
  stackEl.innerHTML = '<p class="msg">Searching…</p>';

  const res = await fetch("/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, user_id: USER_ID }),
  });
  const data = await res.json();
  startDeck(data.results || []);
});

let deck = [];
let pos = 0;

function startDeck(list) {
  deck = list;
  pos = 0;
  renderTop();
}

function renderTop() {
  stackEl.innerHTML = "";
  if (pos >= deck.length) {
    stackEl.innerHTML = '<p class="msg">That\'s all 🙌 Refine your request or search again.</p>';
    return;
  }

  const v = deck[pos];
  const card = document.createElement("div");
  card.className = "swipe-card";
  card.innerHTML = `
    <div class="badge like">LIKE</div>
    <div class="badge nope">NOPE</div>
    <div class="map" id="map-${v.id}"></div>
    <div class="row">
      <span class="name">${v.name}</span>
      <span class="price">~${v.avg_bill} ₽</span>
    </div>
    <div class="type">${v.description}${v.address ? " · " + v.address : ""}</div>
    <div class="links">
      <button class="link" data-act="map">On the map</button>
      <button class="link" data-act="route">Route</button>
    </div>
    <button class="round no" aria-label="dislike"><svg viewBox="0 0 24 24"><path d="M7 7 L17 17 M17 7 L7 17" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg></button>
    <button class="round yes" aria-label="like">♥</button>
  `;
  card.querySelector('[data-act="map"]').addEventListener("click", () => openExternal(v.maps_url));
  card.querySelector('[data-act="route"]').addEventListener("click", () =>
    openExternal(`https://yandex.ru/maps/?rtext=~${v.lat},${v.lon}`)
  );
  card.querySelector(".round.no").addEventListener("click", () => swipe("dislike"));
  card.querySelector(".round.yes").addEventListener("click", () => swipe("like"));

  attachDrag(card);

  card.style.transform = "scale(.96)";
  card.style.opacity = "0";
  stackEl.appendChild(card);
  requestAnimationFrame(() => { card.style.transform = ""; card.style.opacity = "1"; });

  initMap(`map-${v.id}`, v.lat, v.lon);
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
