const ru = d3.formatLocale({ decimal: ",", thousands: "\u00a0", grouping: [3], currency: ["", "\u00a0₽"] });

export const fmtInt = ru.format(",d");
export const fmtRub = (v) => ru.format(",d")(Math.round(v)) + "\u00a0₽";
export const fmtPct = ru.format(".0%");
export const fmtPct1 = ru.format(".1%");
export const fmtSigned = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + ru.format(".0%")(Math.abs(v));

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const parts = (ym) => ym.split("-").map(Number);
export const monthName = (ym) => { const [y, m] = parts(ym); return `${MONTHS[m - 1]} ${y}`; };
export const monthShort = (ym) => { const [y, m] = parts(ym); return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`; };
export const monthGen = (ym) => { const [y, m] = parts(ym); return `${MONTHS_GEN[m - 1]} ${y}`; };

export const CATEGORY_SHORT = {
  "Продовольствие": "Продукты",
  "Здоровье": "Здоровье",
  "Маркетплейсы": "Маркетплейсы",
  "Общественное питание": "Общепит",
  "Транспорт": "Транспорт",
  "Прочее": "Прочее",
};

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const MO_KINDS = { "го": "городской округ", "мр": "муниципальный район", "мо": "муниципальный округ", "вт": "внутригородская территория" };

export async function loadAll(files, onProgress) {
  let done = 0;
  return Promise.all(files.map((f) => d3.json(f).then((v) => { onProgress(++done, files.length); return v; })));
}

export function scatterIndex(points) {
  return d3.Delaunay.from(points, (p) => p[0], (p) => p[1]);
}
