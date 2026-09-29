import { el, fmtInt, fmtPct, reducedMotion } from "./util.js";

export const RULES = {
  cosine: { name: "Сходство профилей", text: "Косинусное сходство векторов признаков: доли трат, уровень расходов, доступность рынков. Связывает похожие экономики независимо от расстояния — поэтому связи тянутся через всю страну." },
  residual_corr: { name: "Синхронность колебаний", text: "Корреляция помесячных отклонений трат от медианы по стране за последние 12 месяцев по всем категориям. Связывает территории, которые одинаково реагируют на шоки." },
  lagged_corr: { name: "Опережение с лагом", text: "Максимум корреляции со сдвигом до двух месяцев: одна территория повторяет динамику другой с опозданием. Направление опережения сохраняется для анализа." },
  road: { name: "Соседство по дорогам", text: "Близость по расстоянию по автодорогам между центрами МО. Чисто пространственная сеть: хорошо держит регионы, но сама по себе ничего не говорит об экономике." },
  hybrid: { name: "Гибрид (итоговое правило)", text: "Сходство профилей, взвешенное близостью по дорогам: 70% — экономика, 30% — география. Связи остаются короткими, но соединяют экономически похожие территории." },
};

const COLS = [
  ["edges", "Связей", (v) => fmtInt(v)],
  ["components", "Компонент", (v) => fmtInt(v)],
  ["same_region", "Внутри региона", (v) => fmtPct(v)],
  ["cross_type", "Между типами", (v) => fmtPct(v)],
  ["median_km", "Медиана, км", (v) => fmtInt(v)],
  ["MQ", "MQ", (v) => v.toFixed(2).replace(".", ",")],
  ["AVI", "AVI", (v) => v.toFixed(2).replace(".", ",")],
  ["AVU", "AVU", (v) => v.toFixed(2).replace(".", ",")],
];

export function createNetwork({ root, meta, records, byId, projection, geo, regions, coast, H, app, tip }) {
  const W = 1000;
  const base = root.querySelector("canvas.net-base");
  const edgesA = root.querySelector("canvas.net-edges");
  const hover = root.querySelector("canvas.net-hover");
  const table = root.querySelector(".net-table");
  const desc = root.querySelector(".net-desc");
  const cache = new Map();
  const pts = records.map((r) => projection([r.lon, r.lat]));
  const index = d3.Delaunay.from(pts);
  let rule = meta.graph.default;
  let adj = null, scale = 1;

  const setup = (c) => {
    const ratio = window.devicePixelRatio || 1;
    const cssW = c.parentElement.clientWidth;
    scale = cssW / W;
    c.width = cssW * ratio; c.height = H * scale * ratio;
    c.style.height = `${H * scale}px`;
    const ctx = c.getContext("2d");
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
    return ctx;
  };

  function drawBase() {
    const ctx = setup(base);
    ctx.fillStyle = "#f8f5ee"; ctx.fillRect(0, 0, W, H);
    const path = d3.geoPath(projection, ctx);
    ctx.globalAlpha = 0.18;
    for (const f of geo.features) {
      const r = byId.get(f.properties.id);
      ctx.beginPath(); path(f);
      ctx.fillStyle = r ? meta.types[r.t].color : "#e6dfcf"; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); path(regions); ctx.strokeStyle = "rgba(29,27,23,0.3)"; ctx.lineWidth = 0.4; ctx.stroke();
    ctx.beginPath(); path(coast); ctx.strokeStyle = "rgba(29,27,23,0.7)"; ctx.lineWidth = 0.7; ctx.stroke();
  }

  function drawEdges(flat) {
    const ctx = setup(edgesA);
    const segs = [];
    for (let e = 0; e < flat.length; e += 2) {
      const i = flat[e], j = flat[e + 1];
      segs.push({ i, j, len: Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]), cross: records[i].t !== records[j].t });
    }
    segs.sort((a, b) => b.len - a.len);
    ctx.lineCap = "round";
    for (const s of segs) {
      const fade = Math.min(1, 40 / Math.max(s.len, 1));
      ctx.beginPath(); ctx.moveTo(pts[s.i][0], pts[s.i][1]); ctx.lineTo(pts[s.j][0], pts[s.j][1]);
      ctx.strokeStyle = s.cross ? `rgba(179,38,30,${0.75 * fade})` : `rgba(29,27,23,${0.45 * fade})`;
      ctx.lineWidth = s.cross ? 0.7 : 0.5;
      ctx.stroke();
    }
    records.forEach((r, i) => {
      ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = meta.types[r.t].color; ctx.fill();
      ctx.lineWidth = 0.3; ctx.strokeStyle = "#1d1b17"; ctx.stroke();
    });
  }

  function drawHover(i) {
    const ctx = setup(hover);
    ctx.clearRect(0, 0, W, H);
    if (i < 0 || !adj) return;
    const nb = adj[i];
    ctx.lineWidth = 1.4;
    for (const j of nb) {
      ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.strokeStyle = records[i].t === records[j].t ? "#1d1b17" : "#b3261e"; ctx.stroke();
    }
    for (const j of nb) {
      ctx.beginPath(); ctx.arc(pts[j][0], pts[j][1], 3, 0, 2 * Math.PI);
      ctx.fillStyle = meta.types[records[j].t].color; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = "#1d1b17"; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], 5, 0, 2 * Math.PI);
    ctx.fillStyle = "#1d1b17"; ctx.fill();
  }

  async function load(name) {
    if (!cache.has(name)) cache.set(name, await d3.json(`data/edges-${name}.json`));
    return cache.get(name);
  }

  async function setRule(name) {
    rule = name;
    renderTable();
    desc.replaceChildren(el("b", {}, RULES[name].name), " — ", RULES[name].text);
    edgesA.classList.add("fade");
    const flat = await load(name);
    if (rule !== name) return;
    adj = records.map(() => []);
    for (let e = 0; e < flat.length; e += 2) { adj[flat[e]].push(flat[e + 1]); adj[flat[e + 1]].push(flat[e]); }
    setTimeout(() => { drawEdges(flat); edgesA.classList.remove("fade"); }, reducedMotion ? 0 : 180);
  }

  function renderTable() {
    const stats = meta.graph.rules;
    const names = Object.keys(RULES).filter((n) => stats[n]);
    const max = Object.fromEntries(COLS.map(([k]) => [k, d3.max(names, (n) => stats[n][k])]));
    table.replaceChildren(el("table", { class: "rules" },
      el("thead", {}, el("tr", {}, el("th", {}, "Правило ребра"), COLS.map(([, h]) => el("th", {}, h)))),
      el("tbody", {}, names.map((n) => el("tr", { class: n === rule ? "on" : "", onclick: () => setRule(n) },
        el("td", {}, RULES[n].name),
        COLS.map(([k, , f]) => el("td", {}, el("span", { class: "tbar", style: `width:${(stats[n][k] / max[k]) * 100}%` }), el("span", { class: "num" }, f(stats[n][k])))),
      ))),
    ));
  }

  hover.addEventListener("mousemove", (ev) => {
    const rect = hover.getBoundingClientRect();
    const mx = (ev.clientX - rect.left) / scale, my = (ev.clientY - rect.top) / scale;
    const i = index.find(mx, my);
    if (Math.hypot(pts[i][0] - mx, pts[i][1] - my) > 12) { drawHover(-1); tip.hide(); return; }
    drawHover(i);
    const r = records[i];
    const n = adj ? adj[i].length : 0;
    const cross = adj ? adj[i].filter((j) => records[j].t !== r.t).length : 0;
    tip.show(ev, `<b>${r.n}</b><br><span class="t">${r.r}</span><br>${fmtInt(n)} связей, из них ${fmtInt(cross)} с другими типами`);
  });
  hover.addEventListener("mouseleave", () => { drawHover(-1); tip.hide(); });
  hover.addEventListener("click", (ev) => {
    const rect = hover.getBoundingClientRect();
    const i = index.find((ev.clientX - rect.left) / scale, (ev.clientY - rect.top) / scale);
    app.select(records[i].id, { fly: true, scroll: true });
  });

  drawBase();
  setRule(rule);
  window.addEventListener("resize", () => { drawBase(); load(rule).then(drawEdges); drawHover(-1); });
}
