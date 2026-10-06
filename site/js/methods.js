import { RULES } from "./network.js";
import { el, fmtInt, reducedMotion } from "./util.js";

export const METHOD_NAMES = {
  kmeans: "k-средних",
  gmm: "Гауссова смесь",
  ward: "Иерархическая Уорда",
  spectral: "Спектральная по сети",
  leiden: "Leiden",
  attributed_spectral: "Спектральная: признаки + сеть",
  sefnac: "SEFNAC",
  dmon: "DMoN",
};

const INDICES = [
  ["SW", "Силуэт", true],
  ["CH", "Калински — Харабаш", true],
  ["S_Dbw", "S_Dbw", false],
  ["AVI", "Изолированность AVI", true],
  ["AVU", "Связанность AVU", false],
  ["MQ", "Модулярность MQ", true],
];

const AGG = { kemeny: ["kemeny_rank", "Кемени"], borda: ["borda_rank", "Борда"], copeland: ["copeland_rank", "Коупленд"] };
const fmt = (v, key) => (key === "CH" ? fmtInt(v) : v.toFixed(3).replace(".", ","));

export function createMethods({ root, meta, tip }) {
  const grid = meta.grid;
  const ks = [...new Set(grid.map((g) => g.k))].sort((a, b) => a - b);
  const methods = Object.keys(METHOD_NAMES).filter((m) => grid.some((g) => g.method === m));
  const stab = new Map(meta.stability.map((s) => [s.key, s]));
  let agg = "kemeny", picked = meta.model.key;

  const svgEl = root.querySelector("svg.mx");
  const detail = root.querySelector(".mx-detail");
  const toggle = root.querySelector(".mx-agg");

  const best = (m, k) => {
    const col = AGG[agg][0];
    const cand = grid.filter((g) => g.method === m && g.k === k && g[col] !== null);
    return cand.length ? cand.reduce((a, b) => (a[col] <= b[col] ? a : b)) : null;
  };

  const cw = 58, ch = 34, left = 250, top = 34;
  const W = left + ks.length * cw + 8, H = top + methods.length * ch + 10;
  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("*").remove();
  svg.append("g").selectAll("text").data(ks).join("text").attr("class", "mx-col")
    .attr("x", (k, i) => left + i * cw + cw / 2).attr("y", 20).text((k) => `k = ${k}`);
  const rowsG = svg.append("g").selectAll("g").data(methods).join("g").attr("transform", (m, i) => `translate(0,${top + i * ch})`);
  rowsG.append("text").attr("class", "mx-row").attr("x", left - 12).attr("y", ch / 2).attr("dy", "0.35em").text((m) => METHOD_NAMES[m]);
  rowsG.append("line").attr("class", "mx-sep").attr("x1", 0).attr("x2", W).attr("y1", 0).attr("y2", 0)
    .attr("opacity", (m, i) => (i && grid.find((g) => g.method === m).family !== grid.find((g) => g.method === methods[i - 1]).family ? 1 : 0));
  const shade = d3.scaleSequential([12, 1], d3.interpolateRgb("#efe8d8", "#1d1b17")).clamp(true);

  function draw() {
    const cells = methods.flatMap((m, i) => ks.map((k, j) => ({ m, k, i, j, g: best(m, k) })));
    const col = AGG[agg][0];
    const sel = svg.selectAll("g.cell").data(cells, (c) => `${c.m}|${c.k}`).join((enter) => {
      const g = enter.append("g").attr("class", "cell").attr("transform", (c) => `translate(${left + c.j * cw},${top + c.i * ch})`);
      g.append("rect").attr("x", 2).attr("y", 3).attr("width", cw - 4).attr("height", ch - 6);
      g.append("text").attr("x", cw / 2).attr("y", ch / 2).attr("dy", "0.35em");
      return g;
    });
    sel.classed("na", (c) => !c.g).classed("win", (c) => c.g && c.g[col] === 1).classed("final", (c) => c.g && c.g.key === meta.model.key)
      .classed("picked", (c) => c.g && c.g.key === picked);
    sel.select("rect").transition().duration(reducedMotion ? 0 : 450).delay((c) => (reducedMotion ? 0 : c.j * 25 + c.i * 12))
      .attr("fill", (c) => (c.g ? shade(c.g[col]) : "url(#mx-na)"));
    sel.select("text").text((c) => (c.g ? c.g[col] : "")).attr("fill", (c) => (c.g && c.g[col] <= 5 ? "#f8f5ee" : "#1d1b17"));
    sel.on("mousemove", (ev, c) => {
      if (!c.g) { tip.show(ev, `<b>${METHOD_NAMES[c.m]}, k = ${c.k}</b><br>нет допустимого разбиения: кластер меньше 1% МО или нет независимой сети для оценки`); return; }
      tip.show(ev, `<b>${METHOD_NAMES[c.m]}, k = ${c.k}</b><br>лучшая сеть: ${c.g.rule === "-" ? "не нужна" : RULES[c.g.rule].name}<br>место по правилу ${AGG[agg][1]}: ${c.g[col]}`);
    }).on("mouseleave", () => tip.hide()).on("click", (ev, c) => { if (c.g) { picked = c.g.key; draw(); showDetail(); } });
  }

  function strip(key, higher, g) {
    const peers = grid.filter((x) => x.k === g.k && x[AGG[agg][0]] !== null && x[key] !== null);
    const w = 260, h = 26;
    const x = d3.scaleLinear(d3.extent(peers, (p) => p[key]), higher ? [8, w - 8] : [w - 8, 8]);
    const s = d3.create("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("class", "strip");
    s.append("line").attr("x1", 8).attr("x2", w - 8).attr("y1", h / 2).attr("y2", h / 2).attr("class", "strip-axis");
    s.append("g").selectAll("line").data(peers).join("line").attr("class", "strip-peer")
      .attr("x1", (p) => x(p[key])).attr("x2", (p) => x(p[key])).attr("y1", 7).attr("y2", h - 7);
    s.append("circle").attr("class", "strip-me").attr("cx", x(g[key])).attr("cy", h / 2).attr("r", 6);
    return s.node();
  }

  function showDetail() {
    const g = grid.find((x) => x.key === picked);
    const st = stab.get(g.key);
    detail.replaceChildren(
      el("div", { class: "kicker" }, g.key === meta.model.key ? "Итоговая модель" : "Кандидат"),
      el("h3", {}, `${METHOD_NAMES[g.method]}, k = ${g.k}`),
      el("p", { class: "mx-sub" }, g.rule === "-" ? "Только признаки, сеть не используется" : `Сеть: ${RULES[g.rule].name}`),
      el("p", { class: "mx-ranks" }, ...Object.entries(AGG).map(([a, [col, name]]) => el("span", { class: a === agg ? "on" : "" }, `${name}: `, el("b", {}, g[col] ?? "—")))),
      el("div", { class: "mx-strips" }, INDICES.map(([key, name, hib]) => el("div", { class: "mx-strip" },
        el("span", {}, name, el("small", {}, hib ? " больше — лучше" : " меньше — лучше")), el("b", {}, fmt(g[key], key)), strip(key, hib, g)))),
      el("p", { class: "note" }, "Штрихи — все допустимые разбиения с тем же k, кружок — выбранное; справа лучшие значения. Графовые индексы усреднены по сетям, построенным из других данных, чем использовал метод."),
      st ? el("p", { class: "mx-stab" }, "Устойчивость: ARI с исходным разбиением на подвыборках 80% — ", el("b", {}, st.ari_boot_mean.toFixed(2).replace(".", ",")),
        ", при другом seed — ", el("b", {}, st.ari_seed_mean.toFixed(2).replace(".", ","))) : null,
    );
  }

  toggle.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    agg = b.dataset.agg;
    toggle.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    draw(); showDetail();
  });

  const defs = svg.append("defs").append("pattern").attr("id", "mx-na").attr("width", 6).attr("height", 6)
    .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)");
  defs.append("rect").attr("width", 6).attr("height", 6).attr("fill", "#f8f5ee");
  defs.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", "#cfc6b2").attr("stroke-width", 2);

  draw();
  showDetail();
  drawConcordance(root.querySelector("svg.mx-w"), meta);
}

function drawConcordance(svgEl, meta) {
  const data = Object.entries(meta.concordance).map(([k, w]) => ({ k: +k, w }));
  const w = 360, h = 150, m = { l: 34, r: 10, t: 12, b: 26 };
  const x = d3.scalePoint(data.map((d) => d.k), [m.l, w - m.r]);
  const y = d3.scaleLinear([0, 1], [h - m.b, m.t]);
  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat((v) => String(v).replace(".", ",")));
  svg.append("path").datum(data).attr("class", "w-line").attr("d", d3.line((d) => x(d.k), (d) => y(d.w)));
  svg.append("g").selectAll("circle").data(data).join("circle").attr("class", "w-dot").attr("cx", (d) => x(d.k)).attr("cy", (d) => y(d.w)).attr("r", 4);
}

export function renderWhy(node, meta) {
  const fin = meta.model;
  const f2 = (x) => x.toFixed(2).replace(".", ",");
  const wins = meta.grid.filter((g) => g.method === fin.method && g.rule === fin.rule && g.kemeny_rank === 1).map((g) => g.k);
  const ks = [...new Set(meta.grid.map((g) => g.k))];
  const abl = Object.fromEntries(meta.ablation.map((a) => [a.variant, a]));
  const at = (k) => meta.stability.find((s) => s.key === `${fin.method}|${fin.rule}|${k}`);
  const kmeans = meta.stability.find((s) => s.key === `kmeans|-|${fin.k}`);
  node.replaceChildren(
    el("h3", {}, "Почему эта модель"),
    el("ol", { class: "why" },
      el("li", {}, `Спектральная кластеризация на признаках и гибридной сети первая по правилу Кемени при ${wins.length} значениях k из ${ks.length}: ${wins.join(", ")}.`),
      el("li", {}, `При k = ${fin.k} разбиение устойчиво: ARI на подвыборках ${f2(fin.stability.ari_boot_mean)}, при смене seed — ${f2(fin.stability.ari_seed_mean)}.`
        + (kmeans ? ` У k-средних с тем же k — ${f2(kmeans.ari_boot_mean)} и ${f2(kmeans.ari_seed_mean)}.` : "")),
      at(fin.k + 1) ? el("li", {}, `k = ${fin.k} — самое большое число типов, которое держится: при k = ${fin.k + 1} устойчивость падает до ${f2(at(fin.k + 1).ari_boot_mean)}. «Ядро» — половина страны — начинает делиться, но на разных подвыборках по-разному: различия внутри него плавные.`) : null,
      abl["структура"] ? el("li", {}, `Без уровня трат разбиение почти другое (ARI ${f2(abl["структура"].ari_to_final)}), без ритма — близкое (ARI ${f2(abl["структура + уровень"].ari_to_final)}); отказ от сглаживания почти ничего не меняет (ARI ${f2(abl["без сглаживания"].ari_to_final)}).`) : null,
      el("li", {}, "Индекс доступности рынков в модель не включён: он пригодился для независимой проверки, и сеть уже учитывает географию через дороги."),
    ),
  );
}
