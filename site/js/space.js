import { el, fmtInt, plural, reducedMotion } from "./util.js";

const PAD = 28;

function fit(points, w, h) {
  const [x0, x1] = d3.extent(points, (p) => p[0]);
  const [y0, y1] = d3.extent(points, (p) => p[1]);
  const s = Math.min((w - 2 * PAD) / (x1 - x0), (h - 2 * PAD) / (y1 - y0));
  const ox = (w - s * (x1 - x0)) / 2, oy = (h - s * (y1 - y0)) / 2;
  return { f: (p) => [ox + (p[0] - x0) * s, oy + (p[1] - y0) * s], s, ox, oy, x0, y0 };
}

export function createSpace({ root, meta, records, projection, coast, app, tip }) {
  const types = meta.types;
  const canvas = root.querySelector("canvas.space");
  const svg = d3.select(root.querySelector("svg.space-brush"));
  const panel = root.querySelector(".space-panel");
  const mini = root.querySelector("canvas.space-mini");
  const ctx = canvas.getContext("2d");
  const geoRaw = records.map((r) => projection([r.lon, r.lat]));
  const spaceRaw = records.map((r) => [r.xy[0], 1 - r.xy[1]]);
  const delay = records.map((r) => r.xy[0] * 0.55 + (r.t / types.length) * 0.15);

  let w = 0, h = 0, geoPos, spacePos, geoFit, pos, index = null;
  let t = 0, target = 0, timer = null;
  let brushed = null, hoverI = -1;

  const ease = d3.easeCubicInOut;
  const mix = (i, tt) => {
    const k = ease(Math.max(0, Math.min(1, (tt * 1.7) - delay[i])));
    const a = geoPos[i], b = spacePos[i];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };

  function layout() {
    const ratio = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    h = Math.round(Math.min(680, Math.max(420, w * 0.6)));
    canvas.width = w * ratio; canvas.height = h * ratio; canvas.style.height = `${h}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    svg.attr("viewBox", `0 0 ${w} ${h}`).style("height", `${h}px`);
    geoFit = fit(geoRaw, w, h);
    geoPos = geoRaw.map(geoFit.f);
    const sf = fit(spaceRaw, w, h);
    spacePos = spaceRaw.map(sf.f);
    pos = records.map((r, i) => mix(i, t));
    index = d3.Delaunay.from(pos);
    brush.extent([[0, 0], [w, h]]);
    svg.call(brush);
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    if (t < 1) {
      ctx.save();
      ctx.globalAlpha = 0.55 * (1 - t);
      ctx.translate(geoFit.ox - geoFit.x0 * geoFit.s, geoFit.oy - geoFit.y0 * geoFit.s);
      ctx.scale(geoFit.s, geoFit.s);
      ctx.beginPath(); d3.geoPath(projection, ctx)(coast);
      ctx.strokeStyle = "#1d1b17"; ctx.lineWidth = 0.8 / geoFit.s; ctx.stroke();
      ctx.restore();
    }
    const sel = app.state.selected;
    for (let i = 0; i < records.length; i++) {
      const r = records[i], p = pos[i];
      const on = !brushed || brushed.has(r.id);
      ctx.globalAlpha = on ? 0.92 : 0.12;
      ctx.beginPath(); ctx.arc(p[0], p[1], on && brushed ? 3.2 : 2.6, 0, 2 * Math.PI);
      ctx.fillStyle = types[r.t].color; ctx.fill();
      if (on && brushed) { ctx.lineWidth = 0.6; ctx.strokeStyle = "#1d1b17"; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    if (t > 0.6) {
      ctx.globalAlpha = (t - 0.6) / 0.4;
      ctx.font = "700 13px 'PT Serif', serif";
      ctx.textAlign = "center";
      for (const ty of types) {
        const pts = pos.filter((p, i) => records[i].t === ty.id);
        const cx = d3.median(pts, (p) => p[0]), cy = d3.median(pts, (p) => p[1]);
        ctx.lineWidth = 4; ctx.strokeStyle = "rgba(248,245,238,0.92)"; ctx.strokeText(ty.short, cx, cy);
        ctx.fillStyle = "#1d1b17"; ctx.fillText(ty.short, cx, cy);
      }
      ctx.globalAlpha = 1;
    }
    const mark = (i, r0) => {
      if (i < 0) return;
      const p = pos[i];
      ctx.beginPath(); ctx.arc(p[0], p[1], r0, 0, 2 * Math.PI);
      ctx.lineWidth = 1.6; ctx.strokeStyle = "#1d1b17"; ctx.stroke();
    };
    mark(records.findIndex((r) => r.id === sel), 7);
    mark(hoverI, 5);
  }

  function animateTo(to) {
    target = to;
    root.querySelectorAll(".space-mode button").forEach((b) => b.classList.toggle("on", +b.dataset.t === to));
    if (timer) timer.stop();
    if (reducedMotion) { t = to; pos = records.map((r, i) => mix(i, t)); index = d3.Delaunay.from(pos); draw(); return; }
    const from = t, dur = 1700 * Math.abs(to - from) + 200;
    index = null;
    timer = d3.timer((el) => {
      const k = Math.min(1, el / dur);
      t = from + (to - from) * k;
      pos = records.map((r, i) => mix(i, t));
      draw();
      if (k >= 1) { timer.stop(); timer = null; index = d3.Delaunay.from(pos); }
    });
  }

  const brush = d3.brush().on("end", (ev) => {
    if (!ev.selection) { brushed = null; summary(); draw(); return; }
    const [[x0, y0], [x1, y1]] = ev.selection;
    brushed = new Set(records.filter((r, i) => pos[i][0] >= x0 && pos[i][0] <= x1 && pos[i][1] >= y0 && pos[i][1] <= y1).map((r) => r.id));
    if (!brushed.size) brushed = null;
    summary(); draw();
  });

  svg.on("mousemove", (ev) => {
    if (!index) return;
    const [mx, my] = d3.pointer(ev);
    const i = index.find(mx, my);
    const p = pos[i];
    if (Math.hypot(p[0] - mx, p[1] - my) > 14) { if (hoverI !== -1) { hoverI = -1; tip.hide(); draw(); } return; }
    if (i !== hoverI) { hoverI = i; draw(); }
    const r = records[i];
    tip.show(ev, `<b>${r.n}</b><br><span class="t">${r.r}</span><br>${types[r.t].name}<br><span class="t">нажмите, чтобы открыть карточку</span>`);
  }).on("mouseleave", () => { hoverI = -1; tip.hide(); draw(); })
    .on("click", (ev) => {
      if (hoverI < 0) return;
      app.select(records[hoverI].id, { fly: true, scroll: true });
    });

  function miniMap(ids) {
    const ratio = window.devicePixelRatio || 1;
    const mw = mini.clientWidth || 300, mh = Math.round(mw * 0.52);
    mini.width = mw * ratio; mini.height = mh * ratio; mini.style.height = `${mh}px`;
    const c = mini.getContext("2d");
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    const mf = fit(geoRaw, mw, mh);
    const pts = geoRaw.map(mf.f);
    c.fillStyle = "#f8f5ee"; c.fillRect(0, 0, mw, mh);
    records.forEach((r, i) => {
      const on = ids.has(r.id);
      c.globalAlpha = on ? 1 : 0.25;
      c.beginPath(); c.arc(pts[i][0], pts[i][1], on ? 2 : 1, 0, 2 * Math.PI);
      c.fillStyle = on ? types[r.t].color : "#a39a86"; c.fill();
    });
    c.globalAlpha = 1;
  }

  function summary() {
    const box = panel.querySelector(".space-sel");
    box.replaceChildren();
    mini.style.display = brushed ? "block" : "none";
    if (!brushed) {
      box.append(el("p", { class: "sub" }, "Обведите рамкой группу точек — справа появится её состав и мини-карта. Выделение сохраняется при переключении режимов: выделите область на карте и посмотрите, куда её муниципалитеты попадут в пространстве сходства."));
      return;
    }
    const sel = records.filter((r) => brushed.has(r.id));
    const byType = d3.rollups(sel, (v) => v.length, (r) => r.t).sort((a, b) => b[1] - a[1]);
    const byRegion = d3.rollups(sel, (v) => v.length, (r) => r.r).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const bar = el("div", { class: "stackbar" }, byType.map(([ty, n]) => el("i", {
      style: `flex:${n};background:${types[ty].color}`, title: `${types[ty].name}: ${n}`,
    })));
    box.append(
      el("div", { class: "sel-count" }, el("b", { class: "num" }, fmtInt(sel.length)), ` ${plural(sel.length, "муниципалитет", "муниципалитета", "муниципалитетов")}`),
      bar,
      el("ul", { class: "mini-list" }, byType.slice(0, 4).map(([ty, n]) => el("li", {}, el("i", { style: `background:${types[ty].color}` }), types[ty].name, el("span", { class: "num" }, fmtInt(n))))),
      el("h3", { style: "margin-top:14px" }, "Регионы"),
      el("ul", { class: "mini-list" }, byRegion.map(([reg, n]) => el("li", {}, reg, el("span", { class: "num" }, fmtInt(n))))),
      el("div", { class: "card-actions", style: "margin-top:12px" },
        el("button", { onclick: () => app.setHighlight(new Set(brushed), `Группа из пространства: ${fmtInt(sel.length)} МО`, { scroll: true }) }, "Показать на карте"),
        el("button", { onclick: () => { svg.call(brush.move, null); } }, "Сбросить"),
      ),
    );
    miniMap(brushed);
  }

  root.querySelector(".space-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) animateTo(+b.dataset.t);
  });

  layout();
  summary();
  window.addEventListener("resize", layout);
  return { redraw: draw, show: () => { if (t === 0 && target === 0) setTimeout(() => animateTo(1), 500); } };
}
