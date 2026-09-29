import { definePatterns } from "./glyphs.js";
import { fmtRub, monthName, monthShort } from "./util.js";

const W = 1000;
const FRAME = 7;
const INSET = 18;

export function russiaProjection(geo, width, height) {
  return d3.geoConicEqualArea().parallels([52, 64]).rotate([-100, 0]).center([0, 62])
    .fitExtent([[INSET + 6, INSET + 6], [width - INSET - 6, height - INSET - 6]], geo);
}

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
  const lat = 60, lon = 100;
  const km = 1000;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const a = projection([lon, lat]), b = projection([lon + dLon, lat]);
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const x0 = INSET + 20, y0 = height - INSET - 24;
  const bar = g.append("g").attr("transform", `translate(${x0},${y0})`);
  [0, 1, 2, 3].forEach((i) => bar.append("rect").attr("x", (i * px) / 4).attr("y", 0).attr("width", px / 4).attr("height", 5)
    .attr("fill", i % 2 ? "#f8f5ee" : "#1d1b17").attr("stroke", "#1d1b17").attr("stroke-width", 0.8));
  [0, 500, 1000].forEach((v) => bar.append("text").attr("x", (v / km) * px).attr("y", 17).attr("text-anchor", "middle")
    .style("font", "10px 'PT Mono', monospace").attr("fill", "#57524a").text(v));
  bar.append("text").attr("x", px + 8).attr("y", 5).style("font", "10px 'PT Mono', monospace").attr("fill", "#57524a").text("км");
  bar.append("text").attr("x", 0).attr("y", -7).style("font", "10px 'PT Sans', sans-serif").attr("fill", "#8a8374")
    .text("Равновеликая коническая проекция, масштаб по 60° с. ш.");
}

export function createMap({ svgEl, geo, regions, coast, state, meta, byId, onSelect, tip }) {
  const svg = d3.select(svgEl);
  const probe = d3.geoConicEqualArea().parallels([52, 64]).rotate([-100, 0]).fitWidth(W - 2 * INSET, geo);
  const [[x0, y0], [x1, y1]] = d3.geoPath(probe).bounds(geo);
  const H = Math.round((y1 - y0) + 2 * INSET + 36);
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  const projection = russiaProjection(geo, W, H - 30);
  const path = d3.geoPath(projection);

  const types = meta.types;
  definePatterns(svg, types, "h", 3.2);
  const solid = svg.select("defs");
  types.forEach((t) => solid.append("pattern").attr("id", `s${t.id}`).attr("patternUnits", "userSpaceOnUse")
    .attr("width", 4).attr("height", 4).append("rect").attr("width", 4).attr("height", 4).attr("fill", t.color));

  svg.select("defs").append("clipPath").attr("id", "mapclip").append("rect")
    .attr("x", FRAME + 1).attr("y", FRAME + 1).attr("width", W - 2 * FRAME - 2).attr("height", H - 2 * FRAME - 2);
  const viewport = svg.append("g").attr("clip-path", "url(#mapclip)");
  const root = viewport.append("g");
  root.append("path").attr("class", "graticule").attr("d", path(d3.geoGraticule().step([10, 10]).extent([[15, 38], [195, 82]])()));

  const mo = root.append("g").selectAll("path").data(geo.features).join("path")
    .attr("class", (f) => (f.properties.d ? "mo" : "mo nodata"))
    .attr("d", path);

  root.append("path").attr("class", "region").attr("d", path(regions));
  root.append("path").attr("class", "coast").attr("d", path(coast));
  const overlay = root.append("g");
  checkerFrame(svg.append("g"), W, H);
  const bar = svg.append("g");
  scaleBar(bar, projection, H);
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

  function zoomTo([[lon0, lat0], [lon1, lat1]]) {
    const pts = [[lon0, lat0], [lon1, lat0], [lon0, lat1], [lon1, lat1], [(lon0 + lon1) / 2, lat0], [(lon0 + lon1) / 2, lat1]].map(projection);
    const [x0, x1] = d3.extent(pts, (p) => p[0]), [y0, y1] = d3.extent(pts, (p) => p[1]);
    const s = Math.min(60, 0.92 / Math.max((x1 - x0) / W, (y1 - y0) / H));
    const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(900).call(zoom.transform, t);
  }
  const reset = () => svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity);

  const centroid = new Map();
  for (const f of geo.features) {
    const r = byId.get(f.properties.id);
    centroid.set(f.properties.id, r ? projection([r.lon, r.lat]) : path.centroid(f));
  }

  function typeOf(r) {
    return state.mode === "static" ? r.t : +r.tm[state.month];
  }

  function paint() {
    const pref = state.hatch ? "h" : "s";
    mo.attr("fill", (f) => {
      const r = byId.get(f.properties.id);
      if (!r) return "url(#hnd)";
      return `url(#${pref}${typeOf(r)})`;
    });
    const focus = state.focusType;
    svg.classed("dim", focus !== null);
    mo.classed("lit", (f) => { const r = byId.get(f.properties.id); return !!r && focus !== null && typeOf(r) === focus; });
  }

  function drawSelection() {
    overlay.selectAll("*").remove();
    const r = byId.get(state.selected);
    if (!r) return;
    const feats = new Map(geo.features.map((f) => [f.properties.id, f]));
    const src = centroid.get(r.id);
    r.tw.forEach((id, i) => {
      const dst = centroid.get(id);
      if (!dst || !src) return;
      const mx = (src[0] + dst[0]) / 2, my = (src[1] + dst[1]) / 2;
      const d = Math.hypot(dst[0] - src[0], dst[1] - src[1]);
      const cx = mx, cy = my - Math.min(120, d * 0.35);
      overlay.append("path").attr("class", "twin-arc").attr("d", `M${src[0]},${src[1]} Q${cx},${cy} ${dst[0]},${dst[1]}`)
        .attr("stroke-dasharray", "1000").attr("stroke-dashoffset", "1000")
        .transition().duration(700).delay(i * 60).attr("stroke-dashoffset", 0);
      if (feats.get(id)) overlay.append("path").attr("class", "twin-outline").attr("d", path(feats.get(id)));
      const g = overlay.append("g").attr("class", "nz").attr("data-x", dst[0]).attr("data-y", dst[1])
        .attr("transform", `translate(${dst[0]},${dst[1]}) scale(${1 / k})`);
      g.append("circle").attr("class", "twin-dot").attr("r", 7);
      g.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").style("font", "700 9px 'PT Mono', monospace").text(i + 1);
    });
    if (feats.get(r.id)) overlay.append("path").attr("class", "selected-outline").attr("d", path(feats.get(r.id)));
    const home = overlay.append("g").attr("class", "nz").attr("data-x", src[0]).attr("data-y", src[1])
      .attr("transform", `translate(${src[0]},${src[1]}) scale(${1 / k})`);
    home.append("circle").attr("r", 3.5).attr("fill", "#1d1b17");
    const label = home.append("text").attr("x", 8).attr("y", -8)
      .style("font", "700 14px 'PT Serif', serif").attr("paint-order", "stroke").attr("stroke", "#f8f5ee").attr("stroke-width", 4)
      .text(r.n);
    label.clone(true).attr("stroke", null);
  }

  mo.on("mousemove", (ev, f) => {
    const r = byId.get(f.properties.id);
    if (!r) { tip.show(ev, "<b>Нет оценки расходов</b><br><span class='t'>данных недостаточно для оценки</span>"); return; }
    const t = types[typeOf(r)];
    const month = state.mode === "static" ? "за весь период" : monthName(meta.snapshot_months[state.month]);
    tip.show(ev, `<b>${r.n}</b><br><span class="t">${r.r}</span><br>${t.name}<br><span class="t">${month} · ${fmtRub(r.s[r.s.length - 1])} на жителя в дек. 2024</span>`);
  }).on("mouseleave", () => tip.hide())
    .on("click", (ev, f) => { if (byId.get(f.properties.id)) onSelect(f.properties.id); });

  return { paint, drawSelection, projection, H, zoomTo, reset };
}

export function createTimescale({ svgEl, meta, state, onChange }) {
  const svg = d3.select(svgEl);
  const months = meta.snapshot_months;
  let width = svgEl.clientWidth || 800;
  const draw = () => {
    width = svgEl.clientWidth || 800;
    svg.attr("viewBox", `0 0 ${width} 46`).selectAll("*").remove();
    const x = d3.scaleBand().domain(d3.range(months.length)).range([4, width - 4]);
    svg.append("g").selectAll("rect").data(months).join("rect").attr("class", "seg")
      .attr("x", (m, i) => x(i)).attr("y", 14).attr("width", x.bandwidth()).attr("height", 6)
      .attr("fill", (m, i) => (i % 2 ? "#f8f5ee" : "#1d1b17"));
    svg.append("g").selectAll("text").data(months).join("text").attr("class", "lbl")
      .attr("x", (m, i) => x(i) + x.bandwidth() / 2).attr("y", 36).attr("text-anchor", "middle")
      .text((m, i) => (i % 3 === 1 || i === months.length - 1 ? monthShort(m) : ""));
    const cx = x(state.month) + x.bandwidth() / 2;
    svg.append("path").attr("class", "cur").attr("d", `M${cx - 6},2 L${cx + 6},2 L${cx},11 Z`);
    svg.append("rect").attr("x", x(state.month)).attr("y", 13).attr("width", x.bandwidth()).attr("height", 8)
      .attr("fill", "none").attr("stroke", "#b3261e").attr("stroke-width", 2);
    const pick = (ev) => {
      const [mx] = d3.pointer(ev, svgEl);
      const i = Math.max(0, Math.min(months.length - 1, Math.floor((mx - 4) / x.step())));
      if (i !== state.month) onChange(i);
    };
    svg.on("click", pick).on("mousemove", (ev) => { if (ev.buttons === 1) pick(ev); });
  };
  window.addEventListener("resize", draw);
  return { draw };
}
