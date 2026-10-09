import { rose, swatch } from "./glyphs.js";
import { CATEGORY_SHORT, MO_KINDS, el, fmtPct, fmtPct1, fmtRub, fmtSigned, monthName, monthShort, reducedMotion } from "./util.js";

const EXAMPLES = ["Воркута", "Балашиха", "Кашинский", "Анадырь", "Урус-Мартановский", "Сочи"];

function trajectory(r, meta, app) {
  const months = meta.snapshot_months;
  const w = 340, h = 44, cw = w / months.length;
  const svg = d3.create("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", "100%");
  svg.append("g").selectAll("rect").data(months).join("rect")
    .attr("x", (m, i) => i * cw + 0.5).attr("y", 6).attr("width", reducedMotion ? cw - 1 : 0).attr("height", 18)
    .attr("fill", (m, i) => meta.types[+r.tm[i]].color).style("cursor", "pointer")
    .on("click", (ev, m) => app.setMonth(months.indexOf(m)))
    .call((s) => s.append("title").text((m, i) => `${monthName(m)}: ${meta.types[+r.tm[i]].name}`))
    .transition().delay((m, i) => i * 18).duration(160).attr("width", cw - 1);
  svg.append("rect").attr("class", "traj-cur").attr("x", app.state.month * cw).attr("y", 3).attr("width", cw).attr("height", 24)
    .attr("fill", "none").attr("stroke", "#1d1b17").attr("stroke-width", 1.6);
  svg.append("g").selectAll("text").data(months).join("text")
    .attr("x", (m, i) => (i === 0 ? 0 : i === months.length - 1 ? w : i * cw + cw / 2)).attr("y", 39)
    .attr("text-anchor", (m, i) => (i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"))
    .attr("class", "traj-lbl")
    .text((m, i) => (i === 0 || i === months.length - 1 || m.endsWith("-12") ? monthShort(m) : ""));
  return svg.node();
}

function spending(r, other, meta) {
  const w = 340, h = 150, m = { t: 12, r: 20, b: 22, l: 50 };
  const months = meta.months;
  const x = d3.scalePoint().domain(months).range([m.l, w - m.r]);
  const series = [{ v: meta.national.s, cls: "ln-nat", label: "медиана по России" }];
  if (other) series.push({ v: other.s, cls: "ln-cmp", label: other.n });
  series.push({ v: r.s, cls: "ln-main", label: r.n });
  const y = d3.scaleLinear().domain([0, d3.max(series.flatMap((s) => s.v)) * 1.1]).nice().range([h - m.b, m.t]);
  const svg = d3.create("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", "100%");
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat((v) => `${v / 1000}\u00a0тыс`))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick line").attr("stroke", "#e0d8c6"));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).tickValues(["2023-01", "2023-07", "2024-01", "2024-07"]).tickFormat(monthShort).tickSize(3));
  const line = d3.line().x((v, i) => x(months[i])).y((v) => y(v)).curve(d3.curveMonotoneX);
  const last = months.length - 1;
  const ends = [];
  for (const s of series) {
    const p = svg.append("path").attr("d", line(s.v)).attr("class", s.cls);
    if (!reducedMotion && s.cls !== "ln-nat") {
      p.attr("pathLength", 1).attr("stroke-dasharray", "1 1").attr("stroke-dashoffset", 1)
        .transition().duration(900).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
        .on("end", function () { d3.select(this).attr("stroke-dasharray", null).attr("pathLength", null); });
    }
    ends.push({ y: y(s.v[last]), s });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 12);
  for (const e of ends) {
    svg.append("text").attr("x", x(months[last]) - 2).attr("y", e.y - 5).attr("text-anchor", "end")
      .attr("class", `ln-lbl ${e.s.cls}-lbl`).text(e.s.label);
  }

  const hover = svg.append("g").style("display", "none");
  hover.append("line").attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "#1d1b17").attr("stroke-width", 0.6);
  const lab = hover.append("text").attr("class", "ln-hover").attr("y", m.t + 2);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", w - m.l - m.r).attr("height", h - m.t - m.b).attr("fill", "transparent")
    .on("mousemove", (ev) => {
      const [mx] = d3.pointer(ev);
      const i = Math.max(0, Math.min(last, Math.round((mx - m.l) / x.step())));
      hover.style("display", null).attr("transform", `translate(${x(months[i])},0)`);
      lab.attr("text-anchor", i > last / 2 ? "end" : "start").attr("dx", i > last / 2 ? -4 : 4)
        .text(`${monthShort(months[i])}: ${fmtRub(r.s[i])}${other ? ` / ${fmtRub(other.s[i])}` : ""}`);
    })
    .on("mouseleave", () => hover.style("display", "none"));
  return svg.node();
}

function comparison(r, o, meta) {
  const rows = meta.categories.map((c, i) => ({ c, a: r.sh[i], b: o.sh[i] }));
  const max = d3.max(rows, (d) => Math.max(d.a, d.b));
  return el("table", { class: "cmp" },
    el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, r.n), el("th", {}, o.n))),
    el("tbody", {}, rows.map((d) => el("tr", {},
      el("td", {}, CATEGORY_SHORT[d.c]),
      el("td", {}, el("span", { class: "cbar", style: `width:${(d.a / max) * 100}%` }), el("span", { class: "num" }, fmtPct1(d.a))),
      el("td", {}, el("span", { class: "cbar alt", style: `width:${(d.b / max) * 100}%` }), el("span", { class: "num" }, fmtPct1(d.b))),
    ))),
  );
}

export function renderCard(container, { meta, byId, app }) {
  const state = app.state;
  const r = byId.get(state.selected);
  container.replaceChildren();
  container.classList.remove("enter");
  void container.offsetWidth;
  container.classList.add("enter");

  if (!r) {
    const ex = EXAMPLES.map((n) => [...byId.values()].find((x) => x.n === n)).filter(Boolean);
    container.append(
      el("h3", {}, "Карточка муниципалитета"),
      el("p", { class: "empty" }, "Выберите территорию на карте или найдите её по названию. Например: ",
        ex.flatMap((x, i) => [i ? ", " : "", el("a", { href: "#", onclick: (e) => { e.preventDefault(); app.select(x.id, { fly: true }); } }, x.n)]), "."),
      el("p", { class: "hint" }, "Клавиши: ← и → листают месяцы, / открывает поиск, Esc сбрасывает выбор."),
    );
    return;
  }

  const other = state.compare && state.compare !== r.id ? byId.get(state.compare) : null;
  const t = meta.types[r.t];
  const tNow = meta.types[+r.tm[state.month]];
  const cats = meta.categories;
  const s24 = d3.mean(r.s.slice(-12));
  const n24 = d3.mean(meta.national.s.slice(-12));
  const stay = [...r.tm].filter((c) => +c === r.t).length / r.tm.length;

  const actions = el("div", { class: "card-actions" },
    other
      ? el("button", { onclick: () => app.setCompare(null) }, "Убрать сравнение")
      : el("button", { onclick: () => app.setCompare(r.id), title: "Выберите второй муниципалитет, чтобы сравнить" }, "Сравнить с другим"),
    el("button", { onclick: (e) => { navigator.clipboard?.writeText(location.href); e.target.textContent = "Ссылка скопирована"; } }, "Скопировать ссылку"),
    el("button", { onclick: () => app.select(null), "aria-label": "Закрыть карточку" }, "×"),
  );

  const head = el("div", {},
    el("h3", { class: "card-title" }, other ? "Сравнение" : "Карточка муниципалитета", el("span", { class: "no" }, "№\u00a0" + String(r.id).padStart(4, "0"))),
    el("h4", {}, r.n),
    el("div", { class: "sub" }, `${MO_KINDS[r.k] || ""}, ${r.r}`),
    el("div", { class: "typebadge" }, swatch(t, 26, "cb"), t.name),
    other ? el("div", { class: "vs" }, "и ", el("a", { href: "#", onclick: (e) => { e.preventDefault(); app.select(other.id); } }, other.n),
      el("span", { class: "sub" }, ` · ${other.r} · ${meta.types[other.t].short}`)) : null,
    state.compare === r.id ? el("div", { class: "pick-hint" }, "Теперь выберите на карте второй муниципалитет") : null,
  );

  const note = el("div", { class: "sub note-month" }, monthNote(r, meta, state));

  const roseBox = el("div", { class: "rosebox" },
    rose(r.sh, meta.national.sh, cats, { size: 210, color: t.color, animate: true, compare: other ? other.sh : null }));
  const legendNote = other ? el("p", { class: "sub", style: "margin:0;text-align:center" }, "Пунктирный контур: ", other.n) : null;

  const dev = cats.map((c, i) => ({ c, d: r.sh[i] / meta.national.sh[i] - 1 })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2);
  const why = el("p", { class: "sub", style: "margin:10px 0 0" }, "Сильнее всего от средней по России отличаются доли: ",
    dev.map((x, i) => `${i ? " и " : ""}${x.c.toLowerCase()} (${fmtSigned(x.d)})`).join(""), ".");

  const facts = el("div", { class: "kv" },
    el("span", {}, "Расходы на жителя в 2024 году"), el("span", { class: "num" }, fmtRub(s24) + " в месяц"),
    el("span", {}, "К медиане по России"), el("span", { class: "num" }, fmtSigned(s24 / n24 - 1)),
    el("span", {}, "Месяцев в своём типе"), el("span", { class: "num" }, fmtPct(stay)),
    el("span", {}, "Индекс доступности рынков"), el("span", { class: "num" }, r.ma === null ? "н/д" : String(r.ma).replace(".", ",")),
    r.c ? el("span", {}, "Административный центр") : null, r.c ? el("span", {}, r.c) : null,
  );

  const twins = el("ol", { class: "twins" }, r.tw.map((id, i) => {
    const x = byId.get(id);
    return el("li", { onclick: () => app.select(id, { fly: true }), onmouseenter: () => app.peek(id), onmouseleave: () => app.peek(null) },
      el("span", { class: "num tn" }, i + 1),
      el("span", {}, el("span", { class: "nm" }, x.n), el("small", {}, `${x.r} · ${meta.types[x.t].short}`)),
      el("span", { class: "sim" }, el("i", { style: `width:${Math.round(r.tws[i] * 40)}px` }), `${(r.tws[i] * 100).toFixed(0)}%`),
    );
  }));

  const nbs = r.nb.map((id) => byId.get(id)).filter(Boolean);
  const neighbours = el("p", { class: "sub", style: "margin:0" }, nbs.flatMap((x, i) => [
    i ? ", " : "", el("a", { href: "#", onclick: (e) => { e.preventDefault(); app.select(x.id); } }, x.n),
  ]));

  container.append(
    actions,
    ...[head, note].filter(Boolean),
    el("div", { class: "row" }, el("h3", {}, "Структура трат к средней по России"), roseBox, legendNote, why,
      other ? el("div", { style: "margin-top:14px" }, comparison(r, other, meta)) : el("div", { style: "margin-top:14px" }, facts)),
    el("div", { class: "row" }, el("h3", {}, "Траектория типа по месяцам"), trajectory(r, meta, app),
      other ? trajectory(other, meta, app) : null,
      r.bd !== null && r.bd !== undefined ? el("p", { class: "sub bd" }, `Пограничная территория: по помесячной модели её месяцы ближе к типу «${meta.types[r.bd].name}», но соседи по сети держат её в своём типе.`) : null,
      r.ch ? el("p", { class: "sub bd" }, "Устойчиво сменила тип: новый тип держится не меньше полугода до конца периода.") : null),
    el("div", { class: "row" }, el("h3", {}, "Расходы на жителя, ₽ в месяц"), spending(r, other, meta)),
    other ? null : el("div", { class: "row" }, el("h3", {}, "Двойники по структуре трат"), twins),
    other ? null : el("div", { class: "row" }, el("h3", {}, "Соседи по сети близости"), neighbours),
  );
}

function monthNote(r, meta, state) {
  const now = +r.tm[state.month];
  return now === r.t ? "" : `${monthName(meta.snapshot_months[state.month])}: ближе к типу «${meta.types[now].name}»`;
}

export function updateCardMonth(container, meta, byId, app) {
  const r = byId.get(app.state.selected);
  const note = container.querySelector(".note-month");
  if (r && note) note.textContent = monthNote(r, meta, app.state);
  const cur = container.querySelectorAll(".traj-cur");
  const cw = 340 / meta.snapshot_months.length;
  cur.forEach((n) => d3.select(n).transition().duration(reducedMotion ? 0 : 200).attr("x", app.state.month * cw));
}
