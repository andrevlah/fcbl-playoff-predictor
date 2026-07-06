// D3 charts: the odds-over-time line chart and the Lowell odds-by-record
// curve. D3 v7 is vendored (docs/vendor/) and loaded as a classic script by
// app.js before these functions run, so `d3` is a global here.

import { TEAMS, logoURL } from "./teams.js";

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
// Odds over time — one line per team, logos as end labels.
// ---------------------------------------------------------------------------
export function renderHistoryChart(el, history, metric) {
  el.innerHTML = "";
  if (!history.length) return;

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
    .attr("stroke", "#e0e0e0");

  svg.append("g")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((d) => d * 100 + "%").tickSize(0))
    .call((g) => g.select(".domain").remove())
    .selectAll("text").attr("fill", "#999").style("font-size", "11px");

  const nDays = (x.domain()[1] - x.domain()[0]) / 86400_000;
  svg.append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.min(8, Math.max(2, Math.round(nDays))))
      .tickFormat(d3.timeFormat("%b %-d")).tickSize(0).tickPadding(8))
    .call((g) => g.select(".domain").attr("stroke", "#222"))
    .selectAll("text").attr("fill", "#666").style("font-size", "11px");

  const line = d3.line()
    .x((d) => x(parseTs(d.timestamp)))
    .y((d) => y(d.teams[line.abbr]?.[metric] ?? 0))
    .curve(d3.curveMonotoneX);

  const single = history.length === 1;

  for (const abbr of abbrs) {
    line.abbr = abbr;
    const color = TEAMS[abbr].chart;
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
    .attr("stroke", "#222").attr("stroke-dasharray", "3,3")
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
          `<div class="tt-row"><span class="tt-name" style="color:${TEAMS[a].chart}">${TEAMS[a].name}</span><span>${fmtPct(v)}</span></div>`)
        .join("");
      showTip(`<div><b>${d3.timeFormat("%B %-d")(parseTs(entry.timestamp))}</b> · ${entry.gamesCompleted} games</div>${rows}`, ev.clientX, ev.clientY);
    })
    .on("mouseleave", () => { cursor.style("display", "none"); hideTip(); });

  el.appendChild(svg.node());
}

// ---------------------------------------------------------------------------
// Lowell: playoff odds by final win total.
// ---------------------------------------------------------------------------
export function renderLowellCurve(el, oddsByFinalWins, currentWins) {
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
    .attr("stroke", "#e0e0e0");

  svg.append("g")
    .attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat((d) => d * 100 + "%").tickSize(0))
    .call((g) => g.select(".domain").remove())
    .selectAll("text").attr("fill", "#999").style("font-size", "10.5px");

  const every = Math.ceil(bins.length / 12);
  svg.append("g")
    .attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % every === 0)).tickSize(0).tickPadding(6))
    .call((g) => g.select(".domain").attr("stroke", "#222"))
    .selectAll("text").attr("fill", "#666").style("font-size", "10.5px");

  svg.append("text")
    .attr("x", (m.left + width - m.right) / 2).attr("y", height - 4)
    .attr("text-anchor", "middle").attr("fill", "#999").style("font-size", "11px")
    .text(`Lowell final wins (currently ${currentWins})`);

  svg.append("g").selectAll("rect").data(bins).join("rect")
    .attr("x", (b) => x(b.w))
    .attr("width", x.bandwidth())
    .attr("y", (b) => y(b.pct))
    .attr("height", (b) => y(0) - y(b.pct))
    .attr("rx", 2)
    .attr("fill", "#C8102E")
    .attr("opacity", (b) => (b.lowConfidence ? 0.28 : 0.9))
    .on("mousemove", (ev, b) => {
      showTip(
        `<b>Finish with ${b.w} wins</b><br>${fmtPct(b.pct)} playoff odds` +
        `<br><span style="color:#999">${b.sims.toLocaleString()} simulated seasons${b.lowConfidence ? " — low confidence" : ""}</span>`,
        ev.clientX, ev.clientY);
    })
    .on("mouseleave", hideTip);

  el.appendChild(svg.node());
}
