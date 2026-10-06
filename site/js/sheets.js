import { rose, swatch } from "./glyphs.js";
import { el, fmtInt, fmtPct, fmtRub, monthShort, plural, reducedMotion } from "./util.js";

export function renderImprint(node, meta) {
  const rows = [
    ["Муниципалитетов", meta.n_mo],
    ["Период", `${meta.months[0].split("-").reverse().join(".")} – ${meta.months.at(-1).split("-").reverse().join(".")}`],
    ["Месячных срезов", meta.snapshot_months.length],
    ["Категорий трат", meta.categories.length],
    ["Типов экономик", meta.types.length],
    ["Связей в сети", meta.graph.rules[meta.graph.default].edges],
  ];
  node.replaceChildren(...rows.map(([k, v]) => {
    const b = el("b", {}, typeof v === "number" ? "0" : v);
    if (typeof v === "number") {
      d3.select(b).transition().duration(reducedMotion ? 0 : 700).ease(d3.easeCubicOut)
        .tween("text", () => { const i = d3.interpolateRound(0, v); return (t) => { b.textContent = fmtInt(i(t)); }; });
    }
    return el("div", {}, el("span", {}, k), b);
  }));
}

export function renderLegend(node, meta, app) {
  const state = app.state;
  node.replaceChildren(...meta.types.map((t) => el("li", {
    class: state.focusType === t.id ? "on" : state.focusType !== null ? "off" : "",
    onclick: () => app.setFocus(state.focusType === t.id ? null : t.id),
    title: "Показать только этот тип",
  }, swatch(t, 34, "lg"), el("span", { class: "tname" }, t.name), el("span", { class: "tcount" }, fmtInt(t.n)))));
}

function typical(meta, records, t, n = 3) {
  const med = meta.types[t].sh;
  return records.filter((r) => r.t === t)
    .map((r) => ({ r, d: d3.sum(r.sh, (v, i) => Math.abs(v - med[i])) }))
    .sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.r);
}

export function renderPortraits(node, meta, records, app) {
  const n24 = d3.mean(meta.national.s.slice(-12));
  node.replaceChildren(...meta.types.map((t) => {
    const s24 = d3.mean(t.s.slice(-12));
    const ex = typical(meta, records, t.id);
    return el("div", { class: "portrait", onclick: () => app.setFocus(t.id, { scroll: true }) },
      el("div", { class: "pno" }, `Тип ${t.id + 1}`),
      el("h4", {}, t.name),
      el("p", { class: "desc" }, t.desc),
      el("div", { class: "prose" }, rose(t.sh, meta.national.sh, meta.categories, { size: 170, color: t.color, animate: true })),
      el("div", { class: "facts" },
        el("b", {}, fmtInt(t.n)), ` ${plural(t.n, "муниципалитет", "муниципалитета", "муниципалитетов")}`, el("br"),
        "расходы ", el("b", {}, fmtRub(s24)), ` на жителя (${s24 > n24 ? "+" : "−"}${fmtPct(Math.abs(s24 / n24 - 1))} к России)`, el("br"),
        "в своём типе ", el("b", {}, fmtPct(t.stay)), " месяцев"),
      t.fca.attrs.length ? el("div", { class: "fca" }, el("span", { class: "fca-h" }, "Формальное понятие"),
        el("ul", {}, t.fca.attrs.map((a) => el("li", {}, a))),
        el("small", {}, `${fmtInt(t.fca.extent)} МО обладают всеми признаками, из них ${fmtPct(t.fca.precision)} — этого типа; охват типа ${fmtPct(t.fca.recall)}`)) : null,
      el("div", { class: "ex" }, "Типичные: ", ex.flatMap((r, i) => [i ? ", " : "",
        el("a", { href: "#", onclick: (e) => { e.preventDefault(); e.stopPropagation(); app.select(r.id, { fly: true, scroll: true }); } }, r.n)])),
      el("div", { class: "more" }, "Показать на карте →"),
    );
  }));
}

export function renderFlows(svgEl, meta, records, app, tip) {
  const months = meta.snapshot_months;
  const cols = months.map((m, i) => i).filter((i) => /-(03|06|09|12)$/.test(months[i]));
  const K = meta.types.length;
  const w = 900, h = 560, top = 26, bottom = 10, nodeW = 12, gap = 6;
  const x = d3.scalePoint().domain(cols).range([196, w - 236]);
  const ky = (h - top - bottom - gap * (K - 1)) / records.length;

  const nodes = cols.map((c, k) => {
    const counts = d3.range(K).map((t) => records.filter((r) => +r.tm[c] === t).length);
    let y = top;
    return counts.map((n, t) => { const node = { k, t, n, y0: y, y1: y + n * ky }; y += n * ky + gap; return node; });
  });

  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  const links = [];
  for (let k = 0; k < cols.length - 1; k++) {
    const a = cols[k], b = cols[k + 1];
    const outOff = nodes[k].map((n) => n.y0), inOff = nodes[k + 1].map((n) => n.y0);
    for (let s = 0; s < K; s++) for (let t = 0; t < K; t++) {
      const ids = records.filter((r) => +r.tm[a] === s && +r.tm[b] === t).map((r) => r.id);
      if (!ids.length) continue;
      const hgt = ids.length * ky;
      links.push({ k, s, t, n: ids.length, ids, sy: outOff[s], ty: inOff[t], hgt, from: months[a], to: months[b], toIdx: b });
      outOff[s] += hgt; inOff[t] += hgt;
    }
  }
  const band = (l) => {
    const x0 = x(cols[l.k]) + nodeW / 2, x1 = x(cols[l.k + 1]) - nodeW / 2, xm = (x0 + x1) / 2;
    return `M${x0},${l.sy} C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty} L${x1},${l.ty + l.hgt} C${xm},${l.ty + l.hgt} ${xm},${l.sy + l.hgt} ${x0},${l.sy + l.hgt} Z`;
  };
  const linkSel = svg.append("g").selectAll("path").data(links).join("path").attr("class", "flow").attr("d", band)
    .attr("fill", (l) => meta.types[l.s].color).classed("stay", (l) => l.s === l.t)
    .on("mousemove", (ev, l) => tip.show(ev, l.s === l.t
      ? `<b>${meta.types[l.s].name}</b><br>остались в типе: ${fmtInt(l.n)}<br><span class="t">${monthShort(l.from)} → ${monthShort(l.to)}</span>`
      : `<b>${fmtInt(l.n)} ${plural(l.n, "муниципалитет", "муниципалитета", "муниципалитетов")}</b><br>${meta.types[l.s].short} → ${meta.types[l.t].short}<br><span class="t">${monthShort(l.from)} → ${monthShort(l.to)} · нажмите, чтобы показать на карте</span>`))
    .on("mouseleave", () => tip.hide())
    .on("click", (ev, l) => app.setHighlight(new Set(l.ids),
      l.s === l.t ? `${meta.types[l.s].short}: остались в типе, ${monthShort(l.from)} → ${monthShort(l.to)}` : `${meta.types[l.s].short} → ${meta.types[l.t].short}, ${monthShort(l.from)} → ${monthShort(l.to)}`,
      { month: l.toIdx, scroll: true }));

  if (!reducedMotion) {
    linkSel.style("opacity", 0).transition().delay((l) => 150 + l.k * 110).duration(500).style("opacity", null);
  }

  const focusType = (t) => {
    linkSel.classed("faded", (l) => t !== null && l.s !== t && l.t !== t);
    nodeSel.classed("faded", (n) => t !== null && n.t !== t);
  };
  const nodeSel = svg.append("g").selectAll("rect").data(nodes.flat()).join("rect").attr("class", "flow-node")
    .attr("x", (n) => x(cols[n.k]) - nodeW / 2).attr("y", (n) => n.y0)
    .attr("width", nodeW).attr("height", (n) => Math.max(0.5, n.y1 - n.y0)).attr("fill", (n) => meta.types[n.t].color)
    .on("mouseenter", (ev, n) => focusType(n.t))
    .on("mousemove", (ev, n) => tip.show(ev, `<b>${meta.types[n.t].name}</b><br>${monthShort(months[cols[n.k]])}: ${fmtInt(n.n)} МО`))
    .on("mouseleave", () => { focusType(null); tip.hide(); });
  cols.forEach((c, k) => svg.append("text").attr("class", "flow-col").attr("x", x(c)).attr("y", 14).text(monthShort(months[c])));
  const first = nodes[0], last = nodes.at(-1);
  svg.append("g").selectAll("text").data(first).join("text").attr("class", "flow-label").attr("text-anchor", "end")
    .attr("x", x(cols[0]) - 12).attr("y", (n) => (n.y0 + n.y1) / 2).attr("dy", "0.35em").text((n) => meta.types[n.t].short)
    .on("mouseenter", (ev, n) => focusType(n.t)).on("mouseleave", () => focusType(null));
  const lg = svg.append("g").selectAll("g").data(last).join("g").attr("transform", (n) => `translate(${x(cols.at(-1)) + 12},${(n.y0 + n.y1) / 2})`)
    .on("mouseenter", (ev, n) => focusType(n.t)).on("mouseleave", () => focusType(null));
  lg.append("text").attr("class", "flow-label").attr("dy", "0.35em").text((n) => meta.types[n.t].short);
  lg.append("text").attr("class", "flow-count").attr("dy", "0.35em").attr("x", 204).attr("text-anchor", "end").text((n) => fmtInt(n.n));
}

export function movers(records) {
  return records.filter((r) => r.ch).map((r) => ({ r, a: +r.tm[0], b: +r.tm.at(-1) }));
}

export function renderNull(svgEl, note, meta) {
  const d = meta.dynamics;
  const w = 320, h = 110, m = { l: 8, r: 8, t: 10, b: 22 };
  const bins = d3.bin().thresholds(12)(d.null_samples);
  const x = d3.scaleLinear([0, Math.max(d.persistent, d3.max(d.null_samples)) * 1.1], [m.l, w - m.r]);
  const y = d3.scaleLinear([0, d3.max(bins, (b) => b.length)], [h - m.b, m.t]);
  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  svg.append("g").selectAll("rect").data(bins).join("rect").attr("class", "null-bar")
    .attr("x", (b) => x(b.x0) + 1).attr("width", (b) => Math.max(1, x(b.x1) - x(b.x0) - 2)).attr("y", (b) => y(b.length)).attr("height", (b) => y(0) - y(b.length));
  svg.append("line").attr("class", "null-obs").attr("x1", x(d.persistent)).attr("x2", x(d.persistent)).attr("y1", m.t - 4).attr("y2", h - m.b);
  svg.append("text").attr("class", "null-lbl").attr("x", x(d.persistent) - 4).attr("y", m.t + 6).attr("text-anchor", "end").text(`${d.persistent} на деле`);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(5).tickSize(3));
  note.textContent = `Столбцы — сколько «устойчивых смен типа» получается, если перемешать месяцы блоками по три: ${d.null_mean.toFixed(1).replace(".", ",")} ± ${d.null_sd.toFixed(1).replace(".", ",")} в ${d.null_samples.length} перестановках. На деле — ${d.persistent}: смены не объясняются шумом.`;
}

export function renderMovers(root, meta, records, app) {
  const all = movers(records);
  const list = root.querySelector("#movers");
  const filter = root.querySelector("#moverfilter");
  const head = root.querySelector("#movershead");
  const pairs = d3.rollups(all, (v) => v.length, (x) => `${x.a}>${x.b}`).sort((p, q) => q[1] - p[1]);
  filter.replaceChildren(
    el("option", { value: "" }, `Все переходы (${fmtInt(all.length)})`),
    ...pairs.map(([k, n]) => { const [a, b] = k.split(">").map(Number); return el("option", { value: k }, `${meta.types[a].short} → ${meta.types[b].short} (${n})`); }),
  );
  const draw = () => {
    const f = filter.value;
    const shown = all.filter((x) => !f || `${x.a}>${x.b}` === f)
      .sort((p, q) => p.r.r.localeCompare(q.r.r, "ru") || p.r.n.localeCompare(q.r.n, "ru"));
    head.textContent = `Устойчиво сменили тип — ${fmtInt(shown.length)}`;
    list.replaceChildren(...shown.map(({ r, a, b }) => el("li", { onclick: () => app.select(r.id, { fly: true, scroll: true }) },
      el("span", {}, el("span", { class: "nm" }, r.n), el("small", {}, `${r.r} · ${meta.types[a].short} → ${meta.types[b].short}`)),
      el("span", { class: "path" }, el("i", { style: `background:${meta.types[a].color}` }), "→", el("i", { style: `background:${meta.types[b].color}` })),
    )));
    root.querySelector("#showmovers").onclick = () => app.setHighlight(new Set(shown.map((x) => x.r.id)), head.textContent, { scroll: true });
  };
  filter.onchange = draw;
  draw();
}

export function renderSteps(node, meta) {
  const v = Object.fromEntries(meta.validation.map((x) => [`${x.variable}|${x.measure}`, x.value]));
  const f2 = (x) => x.toFixed(2).replace(".", ",");
  const st = meta.model.stability;
  const steps = [
    ["Данные", `Оценки безналичных расходов на жителя по ${meta.categories.length - 1} категориям и в целом, ${meta.months.length} месяцев, ${fmtInt(meta.n_mo)} МО с полными рядами. Индекс доступности рынков, расстояния по дорогам и границы — из наборов СберИндекса; численность населения, Крайний Север и моногорода — из бюллетеня Росстата, только для проверки.`],
    ["Признаки", "Доли категорий переведены в логарифмы отношений (CLR) и взяты относительно медианы страны в том же месяце — общий для всех рост маркетплейсов не переводит территории в другой тип. К структуре добавлены уровень трат к медиане и ритм: сезонная амплитуда, летний пик, волатильность. Окно сглаживания — 3 месяца."],
    ["Сеть", `Узел — муниципалитет, ребро — экономическая близость, k = ${meta.graph.k} ближайших соседей. Семь правил: сходство профилей, синхронность колебаний, опережение с лагом, DTW, дороги, гибрид и мультиплекс. Итоговое — гибрид: 70% сходства профилей и 30% дорожной близости.`],
    ["Методы", "Восемь методов в трёх семействах: по признакам (k-средних, гауссова смесь, Уорд), по сети (спектральная, Leiden) и по признакам вместе с сетью (спектральная на смешанном ядре, SEFNAC, графовая нейросеть DMoN). Каждый — при k от 4 до 12 и на каждой подходящей сети."],
    ["Индексы", `SW, CH и S_Dbw по признакам, AVI, AVU и MQ по сети. Графовые индексы считаются только на сетях из других данных, чем использовал метод, иначе метод выигрывает на собственной сети. Места сведены правилами Кемени, Борда и Коупленда внутри каждого k. Итоговая модель — спектральная на признаках и гибридной сети, k = ${meta.model.k}: устойчивость на подвыборках ${f2(st.ari_boot_mean)}.`],
    ["Динамика", `Помесячный тип — путь скрытой марковской модели: признаки месяца плюс доля соседей каждого типа, вероятность сменить тип за месяц ${String(meta.dynamics.p_switch_sensitivity[1].p_switch).replace(".", ",")}. Устойчиво сменили тип ${meta.dynamics.persistent} МО против ${f2(meta.dynamics.null_mean)} в перестановочном нуле. Для сравнения — мультислойный Leiden и события кластеров по Грину.`],
    ["Проверка", `Типы связаны с тем, что в модель не входило: Крайний Север — V Крамера ${f2(v["Крайний Север|V Крамера"])}, численность населения — η² ${f2(v["численность населения, log|η²"])}, доступность рынков — η² ${f2(v["индекс доступности рынков, log|η²"])}. С регионами совпадение умеренное (NMI ${f2(v["регион|NMI"])}): в ${meta.within_region.multi_type} регионах из ${meta.within_region.regions} встречается больше одного типа.`],
  ];
  node.replaceChildren(...steps.map(([h, p], i) => el("div", { class: "step" },
    el("div", { class: "sn" }, i + 1), el("h4", {}, h), el("p", {}, p))));
}
