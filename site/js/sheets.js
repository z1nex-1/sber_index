import { rose, swatch } from "./glyphs.js";
import { el, fmtInt, fmtPct, fmtRub, monthName, monthShort, plural } from "./util.js";

export function renderImprint(node, meta) {
  const rows = [
    ["Муниципалитетов", fmtInt(meta.n_mo)],
    ["Период", `${meta.months[0].split("-").reverse().join(".")} – ${meta.months.at(-1).split("-").reverse().join(".")}`],
    ["Месячных срезов", meta.snapshot_months.length],
    ["Категорий трат", meta.categories.length],
    ["Типов экономик", meta.types.length],
    ["Связей в сети", fmtInt(meta.graph.edges)],
  ];
  node.replaceChildren(...rows.map(([k, v]) => el("div", {}, el("span", {}, k), el("b", {}, String(v)))));
}

export function renderLegend(node, meta, state, onFocus) {
  node.replaceChildren(...meta.types.map((t) => el("li", {
    class: state.focusType === t.id ? "on" : state.focusType !== null ? "off" : "",
    onclick: () => onFocus(state.focusType === t.id ? null : t.id),
    title: "Показать только этот тип",
  }, swatch(t, 34, "lg"), el("span", { class: "tname" }, t.name), el("span", { class: "tcount" }, fmtInt(t.n)))));
}

function typical(meta, records, t, n = 3) {
  const med = meta.types[t].sh;
  return records.filter((r) => r.t === t)
    .map((r) => ({ r, d: d3.sum(r.sh, (v, i) => Math.abs(v - med[i])) }))
    .sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.r);
}

export function renderPortraits(node, meta, records, onPick) {
  const n24 = d3.mean(meta.national.s.slice(-12));
  node.replaceChildren(...meta.types.map((t) => {
    const s24 = d3.mean(t.s.slice(-12));
    const ex = typical(meta, records, t.id);
    return el("div", { class: "portrait", onclick: () => onPick(t.id) },
      el("div", { class: "pno" }, `Тип ${t.id + 1}`),
      el("h4", {}, t.name),
      el("p", { class: "desc" }, t.desc),
      el("div", { style: "display:flex;justify-content:center;padding:14px 0 20px" }, rose(t.sh, meta.national.sh, meta.categories, { size: 170, color: t.color })),
      el("div", { class: "facts" },
        el("b", {}, fmtInt(t.n)), ` ${plural(t.n, "муниципалитет", "муниципалитета", "муниципалитетов")}`, el("br"),
        "расходы ", el("b", {}, fmtRub(s24)), ` на жителя (${s24 > n24 ? "+" : "−"}${fmtPct(Math.abs(s24 / n24 - 1))} к России)`, el("br"),
        "в своём типе ", el("b", {}, fmtPct(t.stay)), " месяцев"),
      el("div", { class: "ex" }, "Типичные: " + ex.map((r) => r.n).join(", ")),
    );
  }));
}

export function renderFlows(svgEl, meta, records, tip) {
  const months = meta.snapshot_months;
  const cols = months.map((m, i) => i).filter((i) => months[i].endsWith("-03") || months[i].endsWith("-06") || months[i].endsWith("-09") || months[i].endsWith("-12"));
  const K = meta.types.length;
  const w = 900, h = 560, top = 26, bottom = 10, nodeW = 12, gap = 6;
  const x = d3.scalePoint().domain(cols).range([110, w - 150]);
  const total = records.length;
  const ky = (h - top - bottom - gap * (K - 1)) / total;

  const nodes = cols.map((c) => {
    const counts = d3.range(K).map((t) => records.filter((r) => +r.tm[c] === t).length);
    let y = top;
    return counts.map((n, t) => { const node = { t, n, y0: y, y1: y + n * ky }; y += n * ky + gap; return node; });
  });

  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  const links = [];
  for (let k = 0; k < cols.length - 1; k++) {
    const a = cols[k], b = cols[k + 1];
    const outOff = nodes[k].map((n) => n.y0), inOff = nodes[k + 1].map((n) => n.y0);
    for (let s = 0; s < K; s++) for (let t = 0; t < K; t++) {
      const n = records.filter((r) => +r.tm[a] === s && +r.tm[b] === t).length;
      if (!n) continue;
      const hgt = n * ky;
      links.push({ k, s, t, n, sy: outOff[s], ty: inOff[t], hgt, from: months[a], to: months[b] });
      outOff[s] += hgt; inOff[t] += hgt;
    }
  }
  const band = (l) => {
    const x0 = x(cols[l.k]) + nodeW / 2, x1 = x(cols[l.k + 1]) - nodeW / 2, xm = (x0 + x1) / 2;
    return `M${x0},${l.sy} C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty} L${x1},${l.ty + l.hgt} C${xm},${l.ty + l.hgt} ${xm},${l.sy + l.hgt} ${x0},${l.sy + l.hgt} Z`;
  };
  svg.append("g").selectAll("path").data(links).join("path").attr("d", band)
    .attr("fill", (l) => meta.types[l.s].color).attr("fill-opacity", (l) => (l.s === l.t ? 0.28 : 0.75))
    .attr("stroke", (l) => (l.s === l.t ? "none" : "#1d1b17")).attr("stroke-width", 0.3)
    .on("mousemove", (ev, l) => tip.show(ev, l.s === l.t
      ? `<b>${meta.types[l.s].name}</b><br>остались в типе: ${fmtInt(l.n)}<br><span class="t">${monthShort(l.from)} → ${monthShort(l.to)}</span>`
      : `<b>${fmtInt(l.n)} ${plural(l.n, "муниципалитет", "муниципалитета", "муниципалитетов")}</b><br>${meta.types[l.s].short} → ${meta.types[l.t].short}<br><span class="t">${monthShort(l.from)} → ${monthShort(l.to)}</span>`))
    .on("mouseleave", () => tip.hide());

  nodes.forEach((col, k) => {
    const g = svg.append("g");
    g.selectAll("rect").data(col).join("rect").attr("x", x(cols[k]) - nodeW / 2).attr("y", (n) => n.y0)
      .attr("width", nodeW).attr("height", (n) => Math.max(0.5, n.y1 - n.y0)).attr("fill", (n) => meta.types[n.t].color)
      .attr("stroke", "#1d1b17").attr("stroke-width", 0.8);
    svg.append("text").attr("class", "flow-col").attr("x", x(cols[k])).attr("y", 14).text(monthShort(months[cols[k]]));
  });
  const first = nodes[0], last = nodes.at(-1);
  svg.append("g").selectAll("text").data(first).join("text").attr("class", "flow-label").attr("text-anchor", "end")
    .attr("x", x(cols[0]) - 12).attr("y", (n) => (n.y0 + n.y1) / 2).attr("dy", "0.35em").text((n) => meta.types[n.t].short);
  const lg = svg.append("g").selectAll("g").data(last).join("g").attr("transform", (n) => `translate(${x(cols.at(-1)) + 12},${(n.y0 + n.y1) / 2})`);
  lg.append("text").attr("class", "flow-label").attr("dy", "0.35em").text((n) => meta.types[n.t].short);
  lg.append("text").attr("class", "flow-count").attr("dy", "0.35em").attr("x", 96).text((n) => fmtInt(n.n));
}

export function movers(records, len = 6) {
  const mode = (s) => { const c = d3.rollup([...s], (v) => v.length, (d) => d); return +d3.greatest(c, (d) => d[1])[0]; };
  return records.map((r) => {
    const a = mode(r.tm.slice(0, len)), b = mode(r.tm.slice(-len));
    const stable = [...r.tm.slice(-len)].every((c) => +c === b);
    return { r, a, b, stable };
  }).filter((x) => x.a !== x.b && x.stable);
}

export function renderMovers(node, meta, records, onSelect) {
  const list = movers(records).sort((p, q) => p.r.r.localeCompare(q.r.r, "ru") || p.r.n.localeCompare(q.r.n, "ru"));
  node.previousElementSibling.textContent = `Сменили тип и удержались — ${fmtInt(list.length)}`;
  node.replaceChildren(...list.map(({ r, a, b }) => el("li", { onclick: () => onSelect(r.id) },
    el("span", {}, el("span", { class: "nm" }, r.n), el("small", {}, `${r.r} · ${meta.types[a].short} → ${meta.types[b].short}`)),
    el("span", { class: "path" },
      el("i", { style: `background:${meta.types[a].color}` }), "→", el("i", { style: `background:${meta.types[b].color}` })),
  )));
}

export function renderNetwork(canvas, { meta, records, byId, edges, projection, geo, regions, coast, H }) {
  const W = 1000;
  const ratio = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 1000;
  const scale = cssW / W;
  canvas.width = cssW * ratio;
  canvas.height = H * scale * ratio;
  canvas.style.height = `${H * scale}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
  ctx.fillStyle = "#f8f5ee";
  ctx.fillRect(0, 0, W, H);
  const path = d3.geoPath(projection, ctx);

  ctx.globalAlpha = 0.2;
  for (const f of geo.features) {
    const r = byId.get(f.properties.id);
    ctx.beginPath(); path(f);
    ctx.fillStyle = r ? meta.types[r.t].color : "#e6dfcf";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath(); path(regions); ctx.strokeStyle = "rgba(29,27,23,0.3)"; ctx.lineWidth = 0.4; ctx.stroke();
  ctx.beginPath(); path(coast); ctx.strokeStyle = "rgba(29,27,23,0.7)"; ctx.lineWidth = 0.7; ctx.stroke();

  const pts = records.map((r) => projection([r.lon, r.lat]));
  const segs = edges.map(([i, j]) => ({ i, j, len: Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]), cross: records[i].t !== records[j].t }))
    .sort((a, b) => b.len - a.len);
  ctx.lineCap = "round";
  for (const e of segs) {
    const fade = Math.min(1, 40 / Math.max(e.len, 1));
    ctx.beginPath(); ctx.moveTo(pts[e.i][0], pts[e.i][1]); ctx.lineTo(pts[e.j][0], pts[e.j][1]);
    ctx.strokeStyle = e.cross ? `rgba(179,38,30,${0.75 * fade})` : `rgba(29,27,23,${0.45 * fade})`;
    ctx.lineWidth = e.cross ? 0.7 : 0.5;
    ctx.stroke();
  }
  records.forEach((r, i) => {
    ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = meta.types[r.t].color; ctx.fill();
    ctx.lineWidth = 0.3; ctx.strokeStyle = "#1d1b17"; ctx.stroke();
  });
  const cross = segs.filter((e) => e.cross).length;
  ctx.fillStyle = "#57524a";
  ctx.font = "11px 'PT Sans', sans-serif";
  ctx.fillText(`${fmtInt(edges.length - cross)} связей внутри типа · ${fmtInt(cross)} между типами (${fmtPct(cross / edges.length)}). Чем длиннее связь, тем она бледнее.`, 24, H - 18);
}

export function renderSteps(node, meta) {
  const steps = [
    ["Данные", `Оценки безналичных расходов на жителя по ${meta.categories.length - 1} категориям и в целом, ${meta.months.length} месяцев. Индекс доступности рынков, расстояния по дорогам, границы МО — всё из открытых наборов СберИндекса.`],
    ["Признаки", "Доли категорий в тратах переведены в логарифмы отношений (CLR): для долей, которые в сумме дают единицу, обычное расстояние искажает сравнение. Уровень трат взят относительно медианы по стране в том же месяце — так уходят сезонность и инфляция."],
    ["Сеть", "Узел — муниципалитет, ребро — экономическая близость. Сравниваются несколько правил: сходство профилей, корреляция колебаний трат, опережение с лагом, близость по дорогам и их сочетание."],
    ["Типы", "Муниципалитеты разбиты на типы по усреднённому профилю, затем каждый месячный срез отнесён к ближайшему типу. Качество разбиения проверяется шестью внутренними индексами: SW, CH, S_Dbw, AVI, AVU, MQ."],
    ["Динамика", "Для каждого месяца известен тип каждого муниципалитета. Потоки между кварталами показывают устойчивость типов, а список сменивших тип — территории, где структура трат действительно изменилась."],
  ];
  node.replaceChildren(...steps.map(([h, p], i) => el("div", { class: "step" },
    el("div", { class: "sn" }, i + 1), el("h4", {}, h), el("p", {}, p))));
}
