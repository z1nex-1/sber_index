import { renderCard, updateCardMonth } from "./card.js";
import { createMap, createTimescale } from "./map.js";
import { createMethods, renderWhy } from "./methods.js";
import { createNetwork } from "./network.js";
import { renderFlows, renderImprint, renderLegend, renderMovers, renderNull, renderPortraits, renderSteps } from "./sheets.js";
import { createSpace } from "./space.js";
import { loadAll, reducedMotion } from "./util.js";

const tipEl = document.getElementById("tip");
const tipText = tipEl.querySelector(".tip-text");
const tipArt = tipEl.querySelector(".tip-art");
// на сенсорных экранах подсказка после касания не исчезает и закрывает карточку — там её нет
const noHover = window.matchMedia("(hover: none)").matches;
const tip = {
  show(ev, html, art = null) {
    if (noHover) return;
    tipText.innerHTML = html;
    if (art) tipArt.replaceChildren(art); else tipArt.replaceChildren();
    tipEl.classList.toggle("with-art", !!art);
    tipEl.classList.add("on");
    const pad = 16, r = tipEl.getBoundingClientRect();
    const x = ev.clientX + pad + r.width > innerWidth ? ev.clientX - r.width - pad : ev.clientX + pad;
    const y = ev.clientY + pad + r.height > innerHeight ? ev.clientY - r.height - pad : ev.clientY + pad;
    tipEl.style.transform = `translate(${x}px,${y}px)`;
  },
  hide() { tipEl.classList.remove("on"); },
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

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { mo: +p.get("mo") || null, m: p.has("m") ? +p.get("m") : null, cmp: +p.get("cmp") || null };
}

const scrollTo = (id) => document.getElementById(id).scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });

async function main() {
  const status = document.getElementById("ldstatus");
  const [meta, records, topo] = await loadAll(["data/meta.json", "data/mo.json", "data/mo.topo.json"],
    (done, total) => { status.textContent = `Загружено ${done} из ${total}`; });
  status.textContent = "Рисуем карту…";
  await new Promise(requestAnimationFrame);

  const geo = topojson.feature(topo, topo.objects.mo);
  geo.features.forEach(rewind);
  const regions = topojson.mesh(topo, topo.objects.mo, (a, b) => a !== b && a.properties.rc !== b.properties.rc);
  const outline = topojson.mesh(topo, topo.objects.mo, (a, b) => a === b);
  const coast = { type: "MultiLineString", coordinates: outline.coordinates.filter((c) => d3.geoLength({ type: "LineString", coordinates: c }) > 0.004) };
  const byId = new Map(records.map((r) => [r.id, r]));

  const h = readHash();
  const last = meta.snapshot_months.length - 1;
  const state = {
    month: h.m !== null && h.m >= 0 && h.m <= last ? h.m : last,
    mode: "month",
    hatch: true,
    focusType: null,
    highlight: null,
    selected: byId.has(h.mo) ? h.mo : null,
    compare: byId.has(h.cmp) ? h.cmp : null,
  };

  const card = document.getElementById("card");
  const legend = document.getElementById("legend");
  const chip = document.getElementById("chip");
  let map, time, space = null;

  let hashTimer = null;
  const writeHash = () => {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const p = new URLSearchParams();
      if (state.selected) p.set("mo", state.selected);
      if (state.compare) p.set("cmp", state.compare);
      if (state.month !== last) p.set("m", state.month);
      const s = p.toString();
      history.replaceState(null, "", s ? `#${s}` : location.pathname);
    }, 150);
  };

  const app = {
    state,
    select(id, { fly = false, scroll = false } = {}) {
      state.selected = id;
      if (!id) state.compare = null;
      map.drawSelection();
      drawCard();
      space?.redraw();
      writeHash();
      if (scroll) scrollTo("map");
      if (fly && id) map.flyToMo(state.compare && state.compare !== id ? [id, state.compare] : [id]);
    },
    setMonth(i) {
      const prev = state.month;
      state.month = i;
      map.paint({ animate: true });
      map.pulse(prev);
      time.draw();
      updateCardMonth(card, meta, byId, app);
      writeHash();
    },
    setFocus(t, { scroll = false } = {}) {
      state.focusType = t;
      if (t !== null) state.highlight = null;
      map.paint();
      renderLegend(legend, meta, app);
      drawChip();
      if (scroll) scrollTo("map");
    },
    setHighlight(ids, label, { month = null, scroll = false } = {}) {
      state.highlight = ids ? { ids, label } : null;
      if (ids) state.focusType = null;
      renderLegend(legend, meta, app);
      if (month !== null) {
        if (state.mode !== "month") setMode("month");
        app.setMonth(month);
      } else map.paint();
      drawChip();
      if (scroll) scrollTo("map");
    },
    setCompare(id) {
      state.compare = id;
      map.drawSelection();
      drawCard();
      writeHash();
    },
    peek(id) { map.peek(id); },
  };

  const drawCard = () => renderCard(card, { meta, byId, app });
  const drawChip = () => {
    chip.hidden = !state.highlight;
    if (state.highlight) chip.querySelector("span").textContent = state.highlight.label;
  };
  chip.querySelector("button").addEventListener("click", () => app.setHighlight(null));

  map = createMap({ svgEl: document.getElementById("mapsvg"), geo, regions, coast, meta, byId, app, tip });
  time = createTimescale({ svgEl: document.getElementById("timesvg"), meta, app });

  renderImprint(document.getElementById("imprint"), meta);
  renderLegend(legend, meta, app);
  map.paint();
  map.drawSelection();
  drawCard();
  document.body.classList.remove("loading");

  const setMode = (mode) => {
    state.mode = mode;
    document.querySelectorAll("#mode button").forEach((x) => x.classList.toggle("on", x.dataset.mode === mode));
    map.paint({ animate: true });
    map.pulse(state.month);
  };
  document.getElementById("mode").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setMode(b.dataset.mode);
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

  const play = document.getElementById("play");
  const icon = (paused) => { play.querySelector("path").setAttribute("d", paused ? "M4 2 L13 8 L4 14 Z" : "M3 2 H7 V14 H3 Z M9 2 H13 V14 H9 Z"); };
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; icon(true); };
  play.addEventListener("click", () => {
    if (timer) { stop(); return; }
    if (state.mode === "static") setMode("month");
    icon(false);
    if (state.month === last) app.setMonth(0);
    timer = setInterval(() => {
      if (state.month >= last) { stop(); return; }
      app.setMonth(state.month + 1);
    }, 900);
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === "ArrowLeft" && state.month > 0) { app.setMonth(state.month - 1); e.preventDefault(); }
    if (e.key === "ArrowRight" && state.month < last) { app.setMonth(state.month + 1); e.preventDefault(); }
    if (e.key === "/") { e.preventDefault(); document.getElementById("q").focus(); }
    if (e.key === "Escape") { app.select(null); app.setFocus(null); app.setHighlight(null); }
  });

  setupSearch(records, app);
  setupNav();

  const lazy = {
    space: () => { space = createSpace({ root: document.getElementById("space"), meta, records, projection: map.projection, coast, app, tip }); space.show(); },
    types: () => renderPortraits(document.getElementById("portraits"), meta, records, app),
    drift: () => {
      renderFlows(document.getElementById("flowsvg"), meta, records, app, tip);
      renderMovers(document.getElementById("drift"), meta, records, app);
      renderNull(document.getElementById("nullsvg"), document.getElementById("nullnote"), meta);
    },
    network: () => createNetwork({ root: document.getElementById("network"), meta, records, byId, projection: map.projection, geo, regions, coast, H: map.H, app, tip }),
    methods: () => { createMethods({ root: document.getElementById("methods"), meta, tip }); renderWhy(document.getElementById("mxwhy"), meta); },
    method: () => renderSteps(document.getElementById("steps"), meta),
  };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add("in");
      const fn = lazy[en.target.id];
      if (fn) { delete lazy[en.target.id]; fn(); }
      io.unobserve(en.target);
    }
  }, { rootMargin: "0px 0px -12% 0px" });
  document.querySelectorAll("section.sheet").forEach((s) => io.observe(s));
}

function setupSearch(records, app) {
  const input = document.getElementById("q");
  const list = document.getElementById("qres");
  const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
  const index = records.map((r) => ({ r, key: norm(`${r.n} ${r.c} ${r.r}`) }));
  let items = [], active = 0;
  const close = () => { list.hidden = true; };
  const choose = (r) => { input.value = r.n; close(); input.blur(); app.select(r.id, { fly: true }); };
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
    if (e.key === "Escape") { close(); input.blur(); return; }
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    if (e.key === "Enter" && items[active]) choose(items[active]);
  });
  input.addEventListener("blur", close);
}

function setupNav() {
  const links = [...document.querySelectorAll("#nav a")];
  const sections = links.map((a) => document.querySelector(a.getAttribute("href")));
  const progress = document.getElementById("progress");
  const obs = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === `#${en.target.id}`));
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach((s) => obs.observe(s));
  links.forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); scrollTo(a.getAttribute("href").slice(1)); }));
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

main().catch((err) => {
  document.body.classList.remove("loading");
  document.getElementById("app").innerHTML = `<p class="failed">Не удалось загрузить данные атласа: ${err.message}</p>`;
});
