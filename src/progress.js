/**
 * Progress: top weight per exercise over time, and its chart.
 */

import {
  bestValueIn, esc, findExercise, formatValue, metricOf, myWorkouts, shortDate, unitFor
} from "./core.js";

/* ----------------------------- progress ----------------------------- */

var selectedExerciseId = null;
export function setSelectedExerciseId(v) { selectedExerciseId = v; return v; }

function buildProgressSeries() {
  var mine = myWorkouts().slice()
    .sort(function (a, b) { return new Date(a.performedAt) - new Date(b.performedAt); });
  var byExercise = {};
  mine.forEach(function (wk) {
    wk.exercises.forEach(function (we) {
      var metric = metricOf(we);
      var best = bestValueIn(we.sets, metric);
      if (best == null) return;
      var exObj = findExercise(we.exerciseId);
      if (!exObj) return;
      var key = we.exerciseId + "|" + metric; // a lift re-measured is a new series
      if (!byExercise[key]) {
        byExercise[key] = {
          name: exObj.name, metric: metric,
          unit: metric === "time" ? "" : unitFor(we.sets, metric),
          points: []
        };
      }
      byExercise[key].points.push({ date: wk.performedAt, weight: best });
    });
  });
  return byExercise;
}

var progressQuery = "";

export function renderProgress() {
  var series = buildProgressSeries();
  var ids = Object.keys(series).sort(function (a, b) { return series[b].points.length - series[a].points.length; });
  var resultsEl = document.getElementById("progress-results");
  var bodyEl = document.getElementById("progress-body");

  if (!ids.length) {
    resultsEl.innerHTML = "";
    bodyEl.innerHTML = '<div class="empty-state">Log a workout with weights to start seeing progress here.</div>';
    return;
  }
  if (!selectedExerciseId || !series[selectedExerciseId]) selectedExerciseId = ids[0];

  /* Nothing typed shows the exercise you train most, not a wall of chips.
     The box is for getting to any of the others. */
  var q = progressQuery.trim().toLowerCase();
  if (!q) {
    resultsEl.innerHTML = "";
  } else {
    var hits = ids.filter(function (id) {
      return series[id].name.toLowerCase().indexOf(q) !== -1;
    });
    resultsEl.innerHTML = hits.length
      ? hits.map(function (id) {
          var n = series[id].points.length;
          return '<button class="picker-row' + (id === selectedExerciseId ? " is-current" : "") +
            '" data-ex-pick="' + id + '">' + esc(series[id].name) +
            '<span class="picker-sub">' + n + (n === 1 ? " session" : " sessions") +
            ' &middot; best ' + esc(formatValue(
              Math.max.apply(null, series[id].points.map(function (p) { return p.weight; })),
              series[id].metric, series[id].unit)) + '</span></button>';
        }).join("")
      : '<div class="empty-state" style="padding:14px 2px;">Nothing logged matches &ldquo;' +
          esc(progressQuery.trim()) + '&rdquo;.</div>';
    resultsEl.querySelectorAll("[data-ex-pick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectedExerciseId = btn.getAttribute("data-ex-pick");
        progressQuery = "";
        document.getElementById("progress-search").value = "";
        renderProgress();
      });
    });
  }

  var s = series[selectedExerciseId];
  var best = Math.max.apply(null, s.points.map(function (p) { return p.weight; }));
  var latest = s.points[s.points.length - 1];
  var isPR = latest.weight === best;

  var html = '<div class="card progress-card">' +
    '<div class="stat-row"><h2>' + esc(s.name) + '</h2>' + (isPR ? '<span class="pr-badge">New PR</span>' : '') + '</div>' +
    '<div class="best-stat">Best logged: <span class="num">' + esc(formatValue(best, s.metric, s.unit)) + '</span></div>';

  if (s.points.length > 1) {
    html += '<div class="chart-wrap"><svg id="progress-svg" viewBox="0 0 320 170" style="width:100%;height:auto;overflow:visible"></svg><div id="chart-tooltip" hidden></div></div>';
  } else {
    html += '<div class="empty-state" style="padding:20px 4px;">Log this exercise once more to see a trend line.</div>';
  }

  html += '<div class="history-list">' + s.points.slice().reverse().slice(0, 6).map(function (p) {
    return '<div class="history-row"><span>' + shortDate(p.date) + '</span><span class="num">' +
      esc(formatValue(p.weight, s.metric, s.unit)) + '</span></div>';
  }).join("") + '</div></div>';

  bodyEl.innerHTML = html;
  if (s.points.length > 1) drawChart(s.points, s.unit, s.metric);
}

function drawChart(points, unit, metric) {
  var svg = document.getElementById("progress-svg");
  var W = 320, H = 170, padL = 8, padR = 8, padT = 22, padB = 24;
  var weights = points.map(function (p) { return p.weight; });
  var min = Math.min.apply(null, weights), max = Math.max.apply(null, weights);
  if (min === max) { min -= 5; max += 5; }
  var span = max - min;
  min -= span * 0.15; max += span * 0.15;

  function x(i) { return padL + (i / (points.length - 1)) * (W - padL - padR); }
  function y(v) { return padT + (1 - (v - min) / (max - min)) * (H - padT - padB); }

  var ns = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    var n = document.createElementNS(ns, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  svg.innerHTML = "";

  // gridlines (recessive)
  [0, 0.5, 1].forEach(function (t) {
    var gy = padT + t * (H - padT - padB);
    svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: "var(--border)", "stroke-width": 1 }));
  });

  // area fill
  var gradId = "grad" + Math.random().toString(36).slice(2, 8);
  var defs = el("defs", {});
  var grad = el("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.appendChild(el("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": "0.32" }));
  grad.appendChild(el("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": "0" }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  var linePts = points.map(function (p, i) { return x(i) + "," + y(p.weight); }).join(" ");
  var areaPts = linePts + " " + x(points.length - 1) + "," + y(min) + " " + x(0) + "," + y(min);
  svg.appendChild(el("polygon", { points: areaPts, fill: "url(#" + gradId + ")" }));
  svg.appendChild(el("polyline", { points: linePts, fill: "none", stroke: "var(--accent)", "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));

  points.forEach(function (p, i) {
    var isLast = i === points.length - 1;
    svg.appendChild(el("circle", { cx: x(i), cy: y(p.weight), r: isLast ? 5 : 3.5, fill: isLast ? "var(--accent)" : "var(--bg)", stroke: "var(--accent)", "stroke-width": 2 }));
    if (i === 0 || isLast) {
      var t = el("text", { x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : "end", fill: "var(--text-faint)", "font-size": "9", "font-family": "Roboto Mono, monospace" });
      t.textContent = shortDate(p.date);
      svg.appendChild(t);
    }
  });

  // direct label on the last point
  var lastLabel = el("text", { x: x(points.length - 1), y: y(points[points.length - 1].weight) - 11, "text-anchor": "end", fill: "var(--text)", "font-size": "11", "font-weight": "600", "font-family": "Roboto Mono, monospace" });
  lastLabel.textContent = formatValue(points[points.length - 1].weight, metric, unit);
  svg.appendChild(lastLabel);

  // touch/hover layer
  var tooltip = document.getElementById("chart-tooltip");
  var overlay = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
  svg.appendChild(overlay);

  function showAt(clientX) {
    var rect = svg.getBoundingClientRect();
    var relX = ((clientX - rect.left) / rect.width) * W;
    var idx = Math.round(((relX - padL) / (W - padL - padR)) * (points.length - 1));
    idx = Math.max(0, Math.min(points.length - 1, idx));
    var p = points[idx];
    var px = ((x(idx)) / W) * rect.width;
    var py = (y(p.weight) / H) * rect.height;
    tooltip.style.left = px + "px";
    tooltip.style.top = py + "px";
    tooltip.innerHTML = shortDate(p.date) + " &middot; <span class=\"num\">" + formatValue(p.weight, metric, unit) + "</span>";
    tooltip.hidden = false;
  }
  overlay.addEventListener("pointermove", function (e) { showAt(e.clientX); });
  overlay.addEventListener("pointerdown", function (e) { showAt(e.clientX); });
  overlay.addEventListener("pointerleave", function () { tooltip.hidden = true; });
}

/* ----------------------------- startup -----------------------------
   What this file does once, when the app opens: wire up its buttons and
   set its starting values. app.js calls this in a fixed order. */

export function startProgress() {
  document.getElementById("progress-search").addEventListener("input", function (e) {
    progressQuery = e.target.value;
    renderProgress();
  });
}
