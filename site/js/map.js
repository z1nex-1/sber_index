import { definePatterns, rose } from "./glyphs.js";
import { fmtInt, fmtRub, monthName, monthShort, plural, reducedMotion } from "./util.js";

const W = 1000;
const FRAME = 7;
const INSET = 18;

function checkerFrame(g, width, height) {
  g.append("rect").attr("x", 0.75).attr("y", 0.75).attr("width", width - 1.5).attr("height", height - 1.5)
    .attr("fill", "none").attr("stroke", "#1d1b17").attr("stroke-width", 1.5);
  g.append("rect").attr("x", FRAME).attr("y", FRAME).attr("width", width - 2 * FRAME).attr("height", height - 2 * FRAME)
    .attr("fill", "none").attr("stroke", "#1d1b17").attr("stroke-width", 0.8);
  const seg = 50;
  const cells = [];
  for (let x = FRAME, i = 0; x < width - FRAME; x += seg, i++) {
    const w = Math.min(seg, width - FRAME - x);
    if (i % 2 === 0) cells.push([x, 0.75, w, FRAME - 0.75], [x, height - FRAME, w, FRAME - 0.75]);
  }
  for (let y = FRAME, i = 0; y < height - FRAME; y += seg, i++) {
    const h = Math.min(seg, height - FRAME - y);
    if (i % 2 === 1) cells.push([0.75, y, FRAME - 0.75, h], [width - FRAME, y, FRAME - 0.75, h]);
  }
  g.selectAll("rect.ck").data(cells).join("rect").attr("class", "ck")
    .attr("x", (d) => d[0]).attr("y", (d) => d[1]).attr("width", (d) => d[2]).attr("height", (d) => d[3]).attr("fill", "#1d1b17");
}

function scaleBar(g, projection, height) {
  const lat = 60, lon = 100, km = 1000;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const a = projection([lon, lat]), b = projection([lon + dLon, lat]);
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bar = g.append("g").attr("transform", `translate(${INSET + 20},${height - INSET - 24})`);
  [0, 1, 2, 3].forEach((i) => bar.append("rect").attr("x", (i * px) / 4).attr("y", 0).attr("width", px / 4).attr("height", 5)
    .attr("fill", i % 2 ? "#f8f5ee" : "#1d1b17").attr("stroke", "#1d1b17").attr("stroke-width", 0.8));
  [0, 500, 1000].forEach((v) => bar.append("text").attr("x", (v / km) * px).attr("y", 17).attr("text-anchor", "middle")
    .attr("class", "maplbl").text(v));
  bar.append("text").attr("x", px + 8).attr("y", 5).attr("class", "maplbl").text("км");
  bar.append("text").attr("x", 0).attr("y", -7).attr("class", "mapnote").text("Равновеликая коническая проекция, масштаб по 60° с. ш.");
}

export function createMap({ svgEl, geo, regions, coast, meta, byId, app, tip }) {
  const state = app.state;
  const types = meta.types;
  const svg = d3.select(svgEl);
  const probe = d3.geoConicEqualArea().parallels([52, 64]).rotate([-100, 0]).fitWidth(W - 2 * INSET, geo);
  const [[, y0], [, y1]] = d3.geoPath(probe).bounds(geo);
  const H = Math.round(y1 - y0 + 2 * INSET + 36);
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  const projection = d3.geoConicEqualArea().parallels([52, 64]).rotate([-100, 0])
    .fitExtent([[INSET + 6, INSET + 40], [W - INSET - 6, H - INSET - 20]], geo);
  const path = d3.geoPath(projection);

  definePatterns(svg, types, "h", 3.2);
  const defs = svg.select("defs");
  defs.append("clipPath").attr("id", "mapclip").append("rect")
    .attr("x", FRAME + 1).attr("y", FRAME + 1).attr("width", W - 2 * FRAME - 2).attr("height", H - 2 * FRAME - 2);

  const viewport = svg.append("g").attr("clip-path", "url(#mapclip)");
  const root = viewport.append("g");
  root.append("path").attr("class", "graticule").attr("d", path(d3.geoGraticule().step([10, 10]).extent([[15, 38], [195, 82]])()));

  const shapes = new Map();
  const mo = root.append("g").selectAll("path").data(geo.features).join("path")
    .attr("class", (f) => (f.properties.d ? "mo" : "mo nodata"))
    .attr("d", (f) => { const d = path(f); shapes.set(f.properties.id, d); return d; });

  root.append("path").attr("class", "region").attr("d", path(regions));
  root.append("path").attr("class", "coast").attr("d", path(coast));
  const pulses = root.append("g");
  const overlay = root.append("g");
  const peekLayer = root.append("g");

  checkerFrame(svg.append("g"), W, H);
  const bar = svg.append("g");
  scaleBar(bar, projection, H);

  const plate = svg.append("g").attr("class", "plate-title").attr("transform", `translate(${INSET + 14},${INSET + 22})`);
  const plateMonth = plate.append("text").attr("class", "pt-month");
  const plateNote = plate.append("text").attr("class", "pt-note").attr("y", 18);

  const centroid = new Map();
  for (const f of geo.features) {
    const r = byId.get(f.properties.id);
    centroid.set(f.properties.id, r ? projection([r.lon, r.lat]) : path.centroid(f));
  }

  let k = 1;
  const patterns = svg.selectAll("pattern");
  const zoom = d3.zoom().scaleExtent([1, 60]).translateExtent([[0, 0], [W, H]])
    .filter((ev) => (ev.type === "wheel" ? ev.ctrlKey || ev.metaKey : !ev.button))
    .on("zoom", (ev) => {
      k = ev.transform.k;
      root.attr("transform", ev.transform);
      patterns.attr("patternTransform", `scale(${1 / k})`);
      bar.style("display", k > 1.05 ? "none" : null);
      overlay.selectAll(".nz").attr("transform", function () { return `translate(${this.dataset.x},${this.dataset.y}) scale(${1 / k})`; });
    });
  svg.call(zoom).on("dblclick.zoom", null);

  const fly = (t, ms = 900) => svg.transition().duration(reducedMotion ? 0 : ms).ease(d3.easeCubicInOut).call(zoom.transform, t);
  function zoomTo([[lon0, lat0], [lon1, lat1]]) {
    const pts = [[lon0, lat0], [lon1, lat0], [lon0, lat1], [lon1, lat1], [(lon0 + lon1) / 2, lat0], [(lon0 + lon1) / 2, lat1]].map(projection);
    const [x0, x1] = d3.extent(pts, (p) => p[0]), [ya, yb] = d3.extent(pts, (p) => p[1]);
    const s = Math.min(60, 0.92 / Math.max((x1 - x0) / W, (yb - ya) / H));
    fly(d3.zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-(x0 + x1) / 2, -(ya + yb) / 2));
  }
  function flyToMo(ids) {
    const fs = geo.features.filter((x) => ids.includes(x.properties.id));
    if (!fs.length) return;
    const [[x0, ya], [x1, yb]] = path.bounds({ type: "FeatureCollection", features: fs });
    const share = fs.length > 1 ? 0.7 : 0.2;
    const s = Math.max(1, Math.min(8, share / Math.max((x1 - x0) / W, (yb - ya) / H)));
    fly(d3.zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-(x0 + x1) / 2, -(ya + yb) / 2), 1100);
  }
  const reset = () => fly(d3.zoomIdentity, 700);

  const typeOf = (r) => (state.mode === "static" ? r.t : +r.tm[state.month]);

  function paint({ animate = false } = {}) {
    if (state.hatch) {
      mo.interrupt().attr("fill", (f) => { const r = byId.get(f.properties.id); return r ? `url(#h${typeOf(r)})` : "url(#hnd)"; });
    } else {
      const sel = animate && !reducedMotion ? mo.transition().duration(420).ease(d3.easeCubicOut) : mo.interrupt();
      sel.attr("fill", (f) => { const r = byId.get(f.properties.id); return r ? types[typeOf(r)].color : "#e6dfcf"; });
    }
    applyDim();
    const label = state.mode === "static" ? "Тип за весь период" : monthName(meta.snapshot_months[state.month]);
    plateMonth.text(label[0].toUpperCase() + label.slice(1));
  }

  function applyDim() {
    const hl = state.highlight;
    const on = !!hl || state.focusType !== null;
    svg.classed("dim", on);
    if (!on) return;
    mo.classed("lit", (f) => {
      const r = byId.get(f.properties.id);
      if (!r) return false;
      return hl ? hl.ids.has(r.id) : typeOf(r) === state.focusType;
    });
  }

  function pulse(prev) {
    pulses.selectAll("*").remove();
    if (state.mode === "static" || prev === state.month) { plateNote.text(""); return; }
    const changed = [];
    for (const r of byId.values()) if (r.tm[prev] !== r.tm[state.month]) changed.push(r.id);
    plateNote.text(changed.length ? `сменили тип: ${fmtInt(changed.length)} ${plural(changed.length, "муниципалитет", "муниципалитета", "муниципалитетов")}` : "");
    if (reducedMotion) return;
    pulses.selectAll("path").data(changed).join("path").attr("class", "pulse").attr("d", (id) => shapes.get(id));
  }

  function drawSelection() {
    overlay.selectAll("*").remove();
    const r = byId.get(state.selected);
    if (!r) return;
    const src = centroid.get(r.id);
    const ids = state.compare && state.compare !== r.id ? [state.compare] : r.tw;
    ids.forEach((id, i) => {
      const dst = centroid.get(id);
      if (!dst || !src) return;
      const d = Math.hypot(dst[0] - src[0], dst[1] - src[1]);
      const cx = (src[0] + dst[0]) / 2, cy = (src[1] + dst[1]) / 2 - Math.min(120, d * 0.35);
      const arc = overlay.append("path").attr("class", "twin-arc").attr("d", `M${src[0]},${src[1]} Q${cx},${cy} ${dst[0]},${dst[1]}`);
      if (!reducedMotion) {
        const len = arc.node().getTotalLength();
        arc.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
          .transition().duration(750).delay(i * 70).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0);
      }
      if (shapes.get(id)) overlay.append("path").attr("class", "twin-outline").attr("d", shapes.get(id));
      const g = overlay.append("g").attr("class", "nz").attr("data-x", dst[0]).attr("data-y", dst[1])
        .attr("transform", `translate(${dst[0]},${dst[1]}) scale(${1 / k})`);
      g.append("circle").attr("class", "twin-dot").attr("r", 7);
      g.append("text").attr("class", "twin-no").attr("text-anchor", "middle").attr("dy", "0.35em").text(state.compare ? "⇄" : i + 1);
    });
    if (shapes.get(r.id)) overlay.append("path").attr("class", "selected-outline").attr("d", shapes.get(r.id));
    const home = overlay.append("g").attr("class", "nz").attr("data-x", src[0]).attr("data-y", src[1])
      .attr("transform", `translate(${src[0]},${src[1]}) scale(${1 / k})`);
    home.append("circle").attr("r", 3.5).attr("fill", "#1d1b17");
    const label = home.append("text").attr("x", 8).attr("y", -8).attr("class", "sel-label").text(r.n);
    label.clone(true).attr("class", "sel-label ink");
  }

  let hoverId = null;
  let hoverRose = null;
  mo.on("mousemove", (ev, f) => {
    const r = byId.get(f.properties.id);
    if (!r) { tip.show(ev, "<b>Нет оценки расходов</b><br><span class='t'>данных недостаточно для оценки</span>"); return; }
    const t = types[typeOf(r)];
    if (hoverId !== r.id) {
      hoverId = r.id;
      hoverRose = rose(r.sh, meta.national.sh, meta.categories, { size: 64, labels: false, color: t.color });
    }
    const when = state.mode === "static" ? "за весь период" : monthShort(meta.snapshot_months[state.month]);
    tip.show(ev, `<b>${r.n}</b><br><span class="t">${r.r}</span><br>${t.name} <span class="t">· ${when}</span><br><span class="t">${fmtRub(d3.mean(r.s.slice(-12)))} на жителя в 2024</span>`, hoverRose);
  }).on("mouseleave", () => { hoverId = null; tip.hide(); })
    .on("click", (ev, f) => { if (byId.get(f.properties.id)) app.select(f.properties.id); });

  function peek(id) {
    peekLayer.selectAll("*").remove();
    if (id && shapes.get(id)) peekLayer.append("path").attr("class", "peek-outline").attr("d", shapes.get(id));
  }

  return { paint, pulse, drawSelection, applyDim, peek, projection, H, zoomTo, flyToMo, reset };
}

export function createTimescale({ svgEl, meta, app }) {
  const state = app.state;
  const svg = d3.select(svgEl);
  const months = meta.snapshot_months;
  let x, marker, box;
  const draw = (animate = true) => {
    const cx = x(state.month) + x.bandwidth() / 2;
    const d = animate && !reducedMotion ? 220 : 0;
    marker.transition().duration(d).attr("transform", `translate(${cx},0)`);
    box.transition().duration(d).attr("x", x(state.month));
  };
  const build = () => {
    const width = svgEl.clientWidth || 800;
    svg.attr("viewBox", `0 0 ${width} 46`).selectAll("*").remove();
    x = d3.scaleBand().domain(d3.range(months.length)).range([4, width - 4]);
    svg.append("g").selectAll("rect").data(months).join("rect").attr("class", "seg")
      .attr("x", (m, i) => x(i)).attr("y", 14).attr("width", x.bandwidth()).attr("height", 6)
      .attr("fill", (m, i) => (i % 2 ? "#f8f5ee" : "#1d1b17"));
    svg.append("g").selectAll("text").data(months).join("text").attr("class", "lbl")
      .attr("x", (m, i) => x(i) + x.bandwidth() / 2).attr("y", 36).attr("text-anchor", "middle")
      .text((m, i) => (i % 3 === 1 || i === months.length - 1 ? monthShort(m) : ""));
    marker = svg.append("path").attr("class", "cur").attr("d", "M-6,2 L6,2 L0,11 Z");
    box = svg.append("rect").attr("y", 13).attr("width", x.bandwidth()).attr("height", 8)
      .attr("fill", "none").attr("stroke", "#b3261e").attr("stroke-width", 2);
    let dragging = false;
    const pick = (ev) => {
      const [mx] = d3.pointer(ev, svgEl);
      const i = Math.max(0, Math.min(months.length - 1, Math.floor((mx - 4) / x.step())));
      if (i !== state.month) app.setMonth(i);
    };
    svg.on("pointerdown", (ev) => { dragging = true; svgEl.setPointerCapture(ev.pointerId); pick(ev); })
      .on("pointermove", (ev) => { if (dragging) pick(ev); })
      .on("pointerup pointercancel", () => { dragging = false; });
    draw(false);
  };
  build();
  window.addEventListener("resize", build);
  return { draw };
}
