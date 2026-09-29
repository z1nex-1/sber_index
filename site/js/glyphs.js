import { CATEGORY_SHORT } from "./util.js";

const HATCH_INK = "rgba(29,27,23,0.42)";

function hatchLines(p, kind, s) {
  const line = (x1, y1, x2, y2) => p.append("line").attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2)
    .attr("stroke", HATCH_INK).attr("stroke-width", 0.55);
  if (kind === "horizontal" || kind === "cross" || kind === "grid") line(0, s / 2, s, s / 2);
  if (kind === "vertical" || kind === "grid") line(s / 2, 0, s / 2, s);
  if (kind === "diagonal" || kind === "cross") { line(0, s, s, 0); line(-s / 2, s / 2, s / 2, -s / 2); line(s / 2, s * 1.5, s * 1.5, s / 2); }
  if (kind === "antidiagonal" || kind === "cross") { line(0, 0, s, s); line(-s / 2, s / 2, s / 2, s * 1.5); line(s / 2, -s / 2, s * 1.5, s / 2); }
  if (kind === "dots") p.append("circle").attr("cx", s / 2).attr("cy", s / 2).attr("r", 0.7).attr("fill", HATCH_INK);
}

export function definePatterns(svg, types, prefix, size = 4) {
  const defs = svg.append("defs");
  for (const t of types) {
    const p = defs.append("pattern").attr("id", `${prefix}${t.id}`).attr("patternUnits", "userSpaceOnUse")
      .attr("width", size).attr("height", size);
    p.append("rect").attr("width", size).attr("height", size).attr("fill", t.color);
    hatchLines(p, t.hatch, size);
  }
  const nd = defs.append("pattern").attr("id", `${prefix}nd`).attr("patternUnits", "userSpaceOnUse")
    .attr("width", size).attr("height", size);
  nd.append("rect").attr("width", size).attr("height", size).attr("fill", "#e6dfcf");
  nd.append("line").attr("x1", 0).attr("y1", size).attr("x2", size).attr("y2", 0).attr("stroke", "#a39a86").attr("stroke-width", 0.5);
  return defs;
}

export function swatch(type, size = 28, prefix = "sw") {
  const svg = d3.create("svg").attr("width", size).attr("height", size * 0.7).attr("viewBox", `0 0 ${size} ${size * 0.7}`);
  definePatterns(svg, [type], `${prefix}${type.id}-`, 5);
  svg.append("rect").attr("x", 0.5).attr("y", 0.5).attr("width", size - 1).attr("height", size * 0.7 - 1)
    .attr("fill", `url(#${prefix}${type.id}-${type.id})`).attr("stroke", "#1d1b17").attr("stroke-width", 1);
  return svg.node();
}

export function rose(shares, reference, categories, { size = 180, color = "#1d1b17", labels = true, compare = null } = {}) {
  const pad = labels ? 34 : 2;
  const R = size / 2 - pad;
  const ref = R * 0.66;
  const n = shares.length;
  const step = (2 * Math.PI) / n;
  const radius = (v, r) => Math.min(R + 8, ref * Math.max(v / r, 0.2));
  const svg = d3.create("svg").attr("width", size).attr("height", size).attr("viewBox", `${-size / 2} ${-size / 2} ${size} ${size}`).style("overflow", "visible");
  const petal = d3.arc().innerRadius(0).padAngle(0.05).cornerRadius(1.5);

  if (compare) {
    svg.append("g").selectAll("path").data(compare).join("path")
      .attr("d", (v, i) => petal({ outerRadius: radius(v, reference[i]), startAngle: i * step, endAngle: (i + 1) * step }))
      .attr("fill", "none").attr("stroke", "#8a8374").attr("stroke-width", 1).attr("stroke-dasharray", "2 2");
  }

  svg.append("g").selectAll("path").data(shares).join("path")
    .attr("d", (v, i) => petal({ outerRadius: radius(v, reference[i]), startAngle: i * step, endAngle: (i + 1) * step }))
    .attr("fill", color).attr("fill-opacity", 0.85).attr("stroke", "#1d1b17").attr("stroke-width", 0.6)
    .append("title").text((v, i) => `${categories[i]}: ${(v * 100).toFixed(1).replace(".", ",")}% трат (по России ${(reference[i] * 100).toFixed(1).replace(".", ",")}%)`);

  svg.append("circle").attr("r", ref).attr("fill", "none").attr("stroke", "#1d1b17").attr("stroke-width", 0.8).attr("stroke-dasharray", "3 2.5");
  svg.append("circle").attr("r", 1.6).attr("fill", "#1d1b17");

  if (labels) {
    svg.append("g").selectAll("text").data(categories).join("text")
      .attr("transform", (c, i) => {
        const a = (i + 0.5) * step - Math.PI / 2;
        return `translate(${Math.cos(a) * (R + 14)},${Math.sin(a) * (R + 14)})`;
      })
      .attr("text-anchor", (c, i) => {
        const x = Math.cos((i + 0.5) * step - Math.PI / 2);
        return x > 0.3 ? "start" : x < -0.3 ? "end" : "middle";
      })
      .attr("dy", "0.35em")
      .style("font", "11px 'PT Sans', sans-serif").attr("fill", "#57524a")
      .text((c) => CATEGORY_SHORT[c] || c);
  }
  return svg.node();
}
