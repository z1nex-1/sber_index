import { rose, swatch } from "./glyphs.js";
import { el, fmtPct, fmtRub, fmtSigned, monthName, monthShort, plural } from "./util.js";

const EXAMPLES = ["Воркута", "Балашиха", "Кашинский", "Анадырь", "Урус-Мартановский", "Сочи"];

function trajectory(r, meta, state, onMonth) {
  const months = meta.snapshot_months;
  const w = 340, h = 44, cw = w / months.length;
  const svg = d3.create("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", "100%");
  svg.append("g").selectAll("rect").data(months).join("rect")
    .attr("x", (m, i) => i * cw + 0.5).attr("y", 6).attr("width", cw - 1).attr("height", 18)
    .attr("fill", (m, i) => meta.types[+r.tm[i]].color).style("cursor", "pointer")
    .on("click", (ev, m) => onMonth(months.indexOf(m)))
    .append("title").text((m, i) => `${monthName(m)}: ${meta.types[+r.tm[i]].name}`);
  svg.append("rect").attr("x", state.month * cw).attr("y", 3).attr("width", cw).attr("height", 24)
    .attr("fill", "none").attr("stroke", "#1d1b17").attr("stroke-width", 1.6);
  svg.append("g").selectAll("text").data(months).join("text")
    .attr("x", (m, i) => (i === 0 ? 0 : i === months.length - 1 ? w : i * cw + cw / 2)).attr("y", 39)
    .attr("text-anchor", (m, i) => (i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"))
    .style("font", "9.5px 'PT Mono', monospace").attr("fill", "#8a8374")
    .text((m, i) => (i === 0 || i === months.length - 1 || m.endsWith("-12") ? monthShort(m) : ""));
  return svg.node();
}

function spending(r, meta) {
  const w = 340, h = 150, m = { t: 12, r: 20, b: 22, l: 50 };
  const months = meta.months;
  const x = d3.scalePoint().domain(months).range([m.l, w - m.r]);
  const all = r.s.concat(meta.national.s);
  const y = d3.scaleLinear().domain([0, d3.max(all) * 1.08]).nice().range([h - m.b, m.t]);
  const svg = d3.create("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", "100%");
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat((v) => (v / 1000) + " тыс."))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick line").attr("stroke", "#e0d8c6"));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).tickValues(["2023-01", "2023-07", "2024-01", "2024-07", "2024-12"]).tickFormat(monthShort).tickSize(3));
  const line = d3.line().x((v, i) => x(months[i])).y((v) => y(v)).curve(d3.curveMonotoneX);
  svg.append("path").attr("d", line(meta.national.s)).attr("fill", "none").attr("stroke", "#8a8374").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3");
  svg.append("path").attr("d", line(r.s)).attr("fill", "none").attr("stroke", "#1d1b17").attr("stroke-width", 2);
  const last = months.length - 1;
  svg.append("text").attr("x", x(months[last]) - 2).attr("y", y(r.s[last]) - 7).attr("text-anchor", "end")
    .style("font", "700 11px 'PT Sans'").text(r.n);
  svg.append("text").attr("x", x(months[last]) - 2).attr("y", y(meta.national.s[last]) + 14).attr("text-anchor", "end")
    .style("font", "11px 'PT Sans'").attr("fill", "#57524a").text("медиана по России");

  const hover = svg.append("g").style("display", "none");
  hover.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "#1d1b17").attr("stroke-width", 0.6);
  const lab = hover.append("text").style("font", "10.5px 'PT Mono'").attr("y", m.t + 2);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", w - m.l - m.r).attr("height", h - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", (ev) => {
      const [mx] = d3.pointer(ev);
      const i = Math.max(0, Math.min(last, Math.round((mx - m.l) / x.step())));
      hover.style("display", null).attr("transform", `translate(${x(months[i])},0)`);
      lab.attr("text-anchor", i > last / 2 ? "end" : "start").attr("dx", i > last / 2 ? -4 : 4)
        .text(`${monthShort(months[i])}: ${fmtRub(r.s[i])}`);
    })
    .on("mouseleave", () => hover.style("display", "none"));
  return svg.node();
}

export function renderCard(container, { r, meta, byId, state, onSelect, onMonth }) {
  container.replaceChildren();
  if (!r) {
    const ex = EXAMPLES.map((n) => [...byId.values()].find((x) => x.n === n)).filter(Boolean);
    container.append(
      el("h3", {}, "Карточка муниципалитета"),
      el("p", { class: "empty" }, "Выберите территорию на карте или найдите её по названию. Например: ",
        ex.flatMap((x, i) => [i ? ", " : "", el("a", { href: "#", onclick: (e) => { e.preventDefault(); onSelect(x.id); } }, x.n)]), "."),
    );
    return;
  }
  const t = meta.types[r.t];
  const tNow = meta.types[+r.tm[state.month]];
  const cats = meta.categories;
  const s24 = d3.mean(r.s.slice(-12));
  const n24 = d3.mean(meta.national.s.slice(-12));
  const stay = [...r.tm].filter((c) => +c === r.t).length / r.tm.length;

  const head = el("div", {},
    el("span", { class: "no" }, "№ " + String(r.id).padStart(4, "0")),
    el("h3", {}, "Карточка муниципалитета"),
    el("h4", {}, r.n),
    el("div", { class: "sub" }, `${r.k}, ${r.r}`),
    el("div", { class: "typebadge" }, swatch(t, 26, "cb"), t.name),
  );

  const note = tNow.id !== t.id
    ? el("div", { class: "sub", style: "margin-top:8px" }, `${monthName(meta.snapshot_months[state.month])}: ближе к типу «${tNow.name}»`)
    : null;

  const roseBox = el("div", { style: "display:flex;justify-content:center;padding:26px 0 22px" },
    rose(r.sh, meta.national.sh, cats, { size: 210, color: t.color }));
  const facts = el("div", { class: "kv" },
    el("span", {}, "Расходы на жителя в 2024 году"), el("span", { class: "num" }, fmtRub(s24) + " в месяц"),
    el("span", {}, "К медиане по России"), el("span", { class: "num" }, fmtSigned(s24 / n24 - 1)),
    el("span", {}, "Месяцев в своём типе"), el("span", { class: "num" }, fmtPct(stay)),
    el("span", {}, "Индекс доступности рынков"), el("span", { class: "num" }, r.ma === null ? "—" : String(r.ma).replace(".", ",")),
    r.c ? el("span", {}, "Административный центр") : null, r.c ? el("span", {}, r.c) : null,
  );

  const dev = cats.map((c, i) => ({ c, d: r.sh[i] / meta.national.sh[i] - 1 })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2);
  const why = el("p", { class: "sub", style: "margin:10px 0 0" }, "Сильнее всего от средней по России отличаются доли: ",
    dev.map((x, i) => `${i ? " и " : ""}${x.c.toLowerCase()} (${fmtSigned(x.d)})`).join(""), ".");

  const twins = el("ol", { class: "twins" }, r.tw.map((id, i) => {
    const x = byId.get(id);
    return el("li", { onclick: () => onSelect(id) },
      el("span", { class: "num", style: "font-size:12px;color:#8a8374" }, i + 1),
      el("span", {}, el("span", { class: "nm" }, x.n), el("small", {}, `${x.r} · ${meta.types[x.t].short}`)),
      el("span", { class: "sim" }, (r.tws[i] * 100).toFixed(0) + "%"),
    );
  }));

  const nbs = r.nb.map((id) => byId.get(id)).filter(Boolean);
  const neighbours = el("p", { class: "sub", style: "margin:0" }, nbs.flatMap((x, i) => [
    i ? ", " : "", el("a", { href: "#", onclick: (e) => { e.preventDefault(); onSelect(x.id); } }, x.n),
  ]));

  container.append(
    ...[head, note].filter(Boolean),
    el("div", { class: "row" }, el("h3", {}, "Структура трат к средней по России"), roseBox, why, el("div", { style: "margin-top:14px" }, facts)),
    el("div", { class: "row" }, el("h3", {}, "Траектория типа по месяцам"), trajectory(r, meta, state, onMonth)),
    el("div", { class: "row" }, el("h3", {}, "Расходы на жителя, ₽ в месяц"), spending(r, meta)),
    el("div", { class: "row" }, el("h3", {}, `Двойники — ${r.tw.length} ${plural(r.tw.length, "самый похожий", "самых похожих", "самых похожих")}`), twins),
    el("div", { class: "row" }, el("h3", {}, "Соседи по сети близости"), neighbours),
  );
}
