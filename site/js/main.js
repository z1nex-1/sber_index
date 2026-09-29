import { renderCard } from "./card.js";
import { createMap, createTimescale } from "./map.js";
import { renderFlows, renderImprint, renderLegend, renderMovers, renderNetwork, renderPortraits, renderSteps } from "./sheets.js";

const tipEl = document.getElementById("tip");
const tip = {
  show(ev, html) {
    tipEl.innerHTML = html;
    tipEl.style.opacity = 1;
    const pad = 14, r = tipEl.getBoundingClientRect();
    const x = ev.clientX + pad + r.width > innerWidth ? ev.clientX - r.width - pad : ev.clientX + pad;
    const y = ev.clientY + pad + r.height > innerHeight ? ev.clientY - r.height - pad : ev.clientY + pad;
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  },
  hide() { tipEl.style.opacity = 0; },
};

// d3-geo reads polygons on the sphere: a ring wound the "wrong" way covers
// everything except the territory, so such rings are reversed.
function rewind(f) {
  const g = f.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const rings of polys) {
    if (d3.geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI) rings.forEach((ring) => ring.reverse());
  }
}

const readHash = () => {
  const m = location.hash.match(/mo=(\d+)/);
  return m ? +m[1] : null;
};

async function main() {
  const [meta, records, topo, edges] = await Promise.all(
    ["meta.json", "mo.json", "mo.topojson", "edges.json"].map((f) => d3.json(`data/${f}`)),
  );
  const geo = topojson.feature(topo, topo.objects.mo);
  geo.features.forEach(rewind);
  const regions = topojson.mesh(topo, topo.objects.mo, (a, b) => a !== b && a.properties.rc !== b.properties.rc);
  const outline = topojson.mesh(topo, topo.objects.mo, (a, b) => a === b);
  const coast = { type: "MultiLineString", coordinates: outline.coordinates.filter((c) => d3.geoLength({ type: "LineString", coordinates: c }) > 0.004) };
  const byId = new Map(records.map((r) => [r.id, r]));
  const state = {
    month: meta.snapshot_months.length - 1,
    mode: "month",
    hatch: true,
    focusType: null,
    selected: byId.has(readHash()) ? readHash() : null,
  };

  const card = document.getElementById("card");
  const legend = document.getElementById("legend");

  const select = (id) => {
    state.selected = id;
    history.replaceState(null, "", id ? `#mo=${id}` : location.pathname);
    map.drawSelection();
    drawCard();
    if (id && document.getElementById("map").getBoundingClientRect().top < -200) {
      document.getElementById("map").scrollIntoView({ behavior: "smooth" });
    }
  };
  const setMonth = (i) => { state.month = i; map.paint(); time.draw(); drawCard(); };
  const focus = (t) => { state.focusType = t; map.paint(); renderLegend(legend, meta, state, focus); };
  const drawCard = () => renderCard(card, { r: byId.get(state.selected), meta, byId, state, onSelect: select, onMonth: setMonth });

  const map = createMap({ svgEl: document.getElementById("mapsvg"), geo, regions, coast, state, meta, byId, onSelect: select, tip });
  const time = createTimescale({ svgEl: document.getElementById("timesvg"), meta, state, onChange: setMonth });

  renderImprint(document.getElementById("imprint"), meta);
  renderLegend(legend, meta, state, focus);
  map.paint();
  map.drawSelection();
  time.draw();
  drawCard();

  renderPortraits(document.getElementById("portraits"), meta, records, (t) => {
    focus(t);
    document.getElementById("map").scrollIntoView({ behavior: "smooth" });
  });
  renderFlows(document.getElementById("flowsvg"), meta, records, tip);
  renderMovers(document.getElementById("movers"), meta, records, select);
  renderSteps(document.getElementById("steps"), meta);
  const drawNet = () => renderNetwork(document.getElementById("netcanvas"), { meta, records, byId, edges, projection: map.projection, geo, regions, coast, H: map.H });
  drawNet();
  window.addEventListener("resize", drawNet);

  document.getElementById("mode").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.mode = b.dataset.mode;
    e.currentTarget.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    map.paint();
  });
  document.getElementById("hatch").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.hatch = b.dataset.h === "1";
    e.currentTarget.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    map.paint();
  });

  const views = {
    eu: [[27, 42], [60, 68]],
    mo: [[35.2, 54.8], [40.2, 56.9]],
    msk: [[37.3, 55.55], [37.95, 55.92]],
    spb: [[29.4, 59.6], [30.8, 60.2]],
  };
  document.getElementById("zoombar").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.z === "ru") map.reset(); else map.zoomTo(views[b.dataset.z]);
  });

  let timer = null;
  const play = document.getElementById("play");
  play.addEventListener("click", () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = "▶"; return; }
    if (state.mode === "static") document.querySelector('#mode button[data-mode="month"]').click();
    play.textContent = "❚❚";
    if (state.month === meta.snapshot_months.length - 1) setMonth(0);
    timer = setInterval(() => {
      if (state.month >= meta.snapshot_months.length - 1) { clearInterval(timer); timer = null; play.textContent = "▶"; return; }
      setMonth(state.month + 1);
    }, 650);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft" && state.month > 0) setMonth(state.month - 1);
    if (e.key === "ArrowRight" && state.month < meta.snapshot_months.length - 1) setMonth(state.month + 1);
    if (e.key === "Escape") { select(null); focus(null); }
  });

  setupSearch(records, select);
  setupNav();
}

function setupSearch(records, select) {
  const input = document.getElementById("q");
  const list = document.getElementById("qres");
  const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
  const index = records.map((r) => ({ r, key: norm(`${r.n} ${r.f} ${r.c}`) }));
  let items = [], active = 0;
  const close = () => { list.hidden = true; };
  const choose = (r) => { input.value = r.n; close(); select(r.id); };
  const render = () => {
    list.replaceChildren(...items.map((r, i) => {
      const li = document.createElement("li");
      li.className = i === active ? "on" : "";
      li.innerHTML = `${r.n}<small>${r.r}</small>`;
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(r); });
      return li;
    }));
    list.hidden = items.length === 0;
  };
  input.addEventListener("input", () => {
    const q = norm(input.value.trim());
    if (q.length < 2) { items = []; close(); return; }
    items = index.filter((x) => x.key.includes(q))
      .sort((a, b) => a.key.indexOf(q) - b.key.indexOf(q) || a.r.n.length - b.r.n.length)
      .slice(0, 12).map((x) => x.r);
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    if (e.key === "Enter" && items[active]) choose(items[active]);
    if (e.key === "Escape") close();
  });
  input.addEventListener("blur", close);
}

function setupNav() {
  const links = [...document.querySelectorAll("#nav a")];
  const sections = links.map((a) => document.querySelector(a.getAttribute("href")));
  const obs = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === `#${en.target.id}`));
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach((s) => obs.observe(s));
}

main().catch((err) => {
  document.getElementById("app").innerHTML = `<p class="loading">Не удалось загрузить данные атласа: ${err.message}</p>`;
});
