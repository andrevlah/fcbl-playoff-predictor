// D3 charts: the odds-over-time line chart and the Lowell odds-by-record
// curve. D3 v7 is vendored (docs/vendor/) and loaded as a classic script by
// app.js before these functions run, so `d3` is a global here.

import { TEAMS, logoURL, chartColor } from "./teams.js?v=12";

// grayscale palette read from the live CSS variables so charts follow the
// active theme; called at render time, and charts re-render on theme toggle
function pal() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
  return {
    grid: v("--grid", "#e0e0e0"),
    faint: v("--ink-faint", "#999999"),
    soft: v("--ink-soft", "#666666"),
    ink: v("--ink", "#222222"),
  };
}

const tooltip = () => document.getElementById("tooltip");

function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14;
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(x + pad, window.innerWidth - w - 8) + "px";
  t.style.top = Math.max(8, Math.min(y + pad, window.innerHeight - h - 8)) + "px";
}
export function hideTip() { tooltip().hidden = true; }

const fmtPct = (p) => (p * 100).toFixed(1) + "%";
const parseTs = (s) => new Date(s);

// ---------------------------------------------------------------------------
// Odds over time: one line per team, logos as end labels.
// ---------------------------------------------------------------------------
export function renderHistoryChart(el, history, metric) {
  const P = pal();
  el.innerHTML = "";
  if (!history.length) return;

  // A time-series with one point is not a chart. Until a second update lands,
  // show today's odds as a clean sorted dot plot instead.
  if (history.length < 2) {
    renderStartingOdds(el, history[0], metric);
    return;
  }

  const width = Math.max(el.clientWidth || 900, 320);
  const height = Math.min(440, Math.max(300, width * 0.42));
  const m = { top: 16, right: 56, bottom: 28, left: 40 };

  const svg = d3.create("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Playoff odds over time");

  const abbrs = Object.keys(TEAMS);
  const x = d3.scaleTime()
    .domain(d3.extent(history, (d) => parseTs(d.timestamp)))
    .range([m.left, width - m.right]);
  const y = d3.scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);

  // gridlines
  svg.append("g")
    .selectAll("line")
    .data(y.ticks(5))
    .join("line")
    .attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d))
    .attr("stroke", P.grid);

  svg.append("g")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((d) => d * 100 + "%").tickSize(0))
    .call((g) => g.select(".domain").remove())
    .selectAll("text").attr("fill", P.faint).style("font-size", "11px");

  const nDays = (x.domain()[1] - x.domain()[0]) / 86400_000;
  svg.append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.min(8, Math.max(2, Math.round(nDays))))
      .tickFormat(d3.timeFormat("%b %-d")).tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").attr("stroke", P.ink))
    .selectAll("text").attr("fill", P.soft).style("font-size", "11px");

  const line = d3.line()
    .x((d) => x(parseTs(d.timestamp)))
    .y((d) => y(d.teams[line.abbr]?.[metric] ?? 0))
    .curve(d3.curveMonotoneX);

  const single = history.length === 1;

  for (const abbr of abbrs) {
    line.abbr = abbr;
    const color = chartColor(abbr);
    if (!single) {
      svg.append("path")
        .datum(history)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", abbr === "LOW" ? 3 : 2)
        .attr("d", line);
    }
    // change-point dots
    svg.append("g")
      .selectAll("circle")
      .data(history)
      .join("circle")
      .attr("cx", (d) => x(parseTs(d.timestamp)))
      .attr("cy", (d) => y(d.teams[abbr]?.[metric] ?? 0))
      .attr("r", single ? 4 : 2.5)
      .attr("fill", color);
    // logo end label
    const last = history[history.length - 1];
    svg.append("image")
      .attr("href", logoURL(abbr))
      .attr("x", x(parseTs(last.timestamp)) + 6)
      .attr("y", y(last.teams[abbr]?.[metric] ?? 0) - 11)
      .attr("width", 22).attr("height", 22)
      .on("error", function () {
        d3.select(this).remove();
      });
  }

  // hover: nearest date, all teams
  const bisect = d3.bisector((d) => parseTs(d.timestamp)).center;
  const cursor = svg.append("line")
    .attr("stroke", P.ink).attr("stroke-dasharray", "3,3")
    .attr("y1", m.top).attr("y2", height - m.bottom)
    .style("display", "none");

  svg.append("rect")
    .attr("x", m.left).attr("y", m.top)
    .attr("width", width - m.left - m.right)
    .attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (ev) => {
      const [mx] = d3.pointer(ev);
      const entry = history[bisect(history, x.invert(mx))];
      if (!entry) return;
      cursor.style("display", null)
        .attr("x1", x(parseTs(entry.timestamp)))
        .attr("x2", x(parseTs(entry.timestamp)));
      const rows = Object.keys(TEAMS)
        .map((a) => ({ a, v: entry.teams[a]?.[metric] ?? 0 }))
        .sort((p, q) => q.v - p.v)
        .map(({ a, v }) =>
          `<div class="tt-row"><span class="tt-name" style="color:${chartColor(a)}">${TEAMS[a].name}</span><span>${fmtPct(v)}</span></div>`)
        .join("");
      showTip(`<div><b>${d3.timeFormat("%B %-d")(parseTs(entry.timestamp))}</b> · ${entry.gamesCompleted} games</div>${rows}`, ev.clientX, ev.clientY);
    })
    .on("mouseleave", () => { cursor.style("display", "none"); hideTip(); });

  el.appendChild(svg.node());
}

// Single-entry fallback for the history chart: a lollipop plot of the current
// odds, one row per team, sorted best-to-worst.
function renderStartingOdds(el, entry, metric) {
  const P = pal();
  const abbrs = Object.keys(TEAMS)
    .map((a) => ({ a, v: entry.teams[a]?.[metric] ?? 0 }))
    .sort((p, q) => q.v - p.v);

  const width = Math.max(el.clientWidth || 900, 320);
  const rowH = 40;
  const m = { top: 8, right: 70, bottom: 30, left: 150 };
  const height = m.top + rowH * abbrs.length + m.bottom;

  const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const x = d3.scaleLinear().domain([0, 1]).range([m.left, width - m.right]);
  const y = (i) => m.top + rowH * i + rowH / 2;

  // vertical gridlines + bottom axis
  svg.append("g").selectAll("line").data(x.ticks(5)).join("line")
    .attr("x1", (d) => x(d)).attr("x2", (d) => x(d))
    .attr("y1", m.top).attr("y2", height - m.bottom)
    .attr("stroke", P.grid);
  svg.append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat((d) => d * 100 + "%").tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").attr("stroke", P.ink))
    .selectAll("text").attr("fill", P.soft).style("font-size", "11px");

  abbrs.forEach(({ a, v }, i) => {
    const color = chartColor(a);
    svg.append("image")
      .attr("href", logoURL(a))
      .attr("x", 4).attr("y", y(i) - 12)
      .attr("width", 24).attr("height", 24);
    svg.append("text")
      .attr("x", 34).attr("y", y(i) + 4)
      .attr("fill", P.ink).style("font-size", "12.5px")
      .style("font-weight", a === "LOW" ? 800 : 600)
      .text(TEAMS[a].shortName);
    svg.append("line")
      .attr("x1", x(0)).attr("x2", x(v))
      .attr("y1", y(i)).attr("y2", y(i))
      .attr("stroke", color).attr("stroke-width", 3).attr("stroke-linecap", "round");
    svg.append("circle")
      .attr("cx", x(v)).attr("cy", y(i)).attr("r", 6).attr("fill", color);
    svg.append("text")
      .attr("x", x(v) + 12).attr("y", y(i) + 4)
      .attr("fill", P.ink).style("font-size", "12.5px")
      .style("font-family", "SF Mono, Menlo, monospace")
      .text(fmtPct(v));
  });

  el.appendChild(svg.node());

  const note = document.createElement("p");
  note.className = "mini-note";
  note.style.marginTop = "8px";
  note.textContent = "Odds tracking starts here. This becomes a line chart as soon as new games go final.";
  el.appendChild(note);
}

// ---------------------------------------------------------------------------
// Lowell: playoff odds by final win total.
// ---------------------------------------------------------------------------
export function renderLowellCurve(el, oddsByFinalWins, currentWins) {
  const P = pal();
  el.innerHTML = "";
  const bins = Object.entries(oddsByFinalWins)
    .map(([w, b]) => ({ w: +w, ...b }))
    .sort((a, b) => a.w - b.w);
  if (!bins.length) return;

  const width = Math.max(el.clientWidth || 460, 300);
  const height = 240;
  const m = { top: 14, right: 12, bottom: 34, left: 40 };

  const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const x = d3.scaleBand()
    .domain(bins.map((b) => b.w))
    .range([m.left, width - m.right]).padding(0.25);
  const y = d3.scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);

  svg.append("g").selectAll("line").data(y.ticks(4)).join("line")
    .attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d))
    .attr("stroke", P.grid);

  svg.append("g")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat((d) => d * 100 + "%").tickSize(0))
    .call((g) => g.select(".domain").remove())
    .selectAll("text").attr("fill", P.faint).style("font-size", "10.5px");

  const every = Math.ceil(bins.length / 12);
  svg.append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % every === 0)).tickSize(0).tickPadding(6))
    .call((g) => g.select(".domain").attr("stroke", P.ink))
    .selectAll("text").attr("fill", P.soft).style("font-size", "10.5px");

  svg.append("text")
    .attr("x", (m.left + width - m.right) / 2).attr("y", height - 4)
    .attr("text-anchor", "middle").attr("fill", P.faint).style("font-size", "11px")
    .text(`Lowell final wins (currently ${currentWins})`);

  svg.append("g").selectAll("rect").data(bins).join("rect")
    .attr("x", (b) => x(b.w))
    .attr("width", x.bandwidth())
    .attr("y", (b) => y(b.pct))
    .attr("height", (b) => y(0) - y(b.pct))
    .attr("rx", 2)
    .attr("fill", chartColor("LOW"))
    .attr("opacity", (b) => (b.lowConfidence ? 0.28 : 0.9))
    .on("mousemove", (ev, b) => {
      showTip(
        `<b>Finish with ${b.w} wins</b><br>${fmtPct(b.pct)} playoff odds` +
        `<br><span style="color:var(--ink-faint)">${b.sims.toLocaleString()} simulated seasons${b.lowConfidence ? ", low confidence" : ""}</span>`,
        ev.clientX, ev.clientY);
    })
    .on("mouseleave", hideTip);

  el.appendChild(svg.node());
}
