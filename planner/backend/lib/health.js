// Apple Health ingest. An Apple Shortcut on the phone POSTs a simple batch:
//   { samples: [ { date: "2026-07-20", metric: "Sleep", value: 7.2, unit: "h" }, ... ] }
// We own the Shortcut, so we keep the shape simple. Samples land in a
// server-owned S.healthLogs array (the client renders them read-only), upserted
// by (date, metric) so re-sending the same day overwrites rather than duplicates.

const { readState, writeState } = require("./state");

// Friendly metric name → the log "cat" used for the timeline icon/colour.
const METRIC_CAT = {
  Sleep: "sleep", Weight: "weight", Steps: "metric", Movement: "move",
  Exercise: "move", Water: "water", "Resting HR": "metric", "Heart rate": "metric",
  Calories: "food", Energy: "metric"
};

function catFor(metric) { return METRIC_CAT[metric] || "metric"; }

function label(metric, value, unit) {
  const v = Math.round(value * 10) / 10;
  if (metric === "Sleep") return "Slept " + v + "h";
  if (metric === "Weight") return v + " " + (unit || "lb");
  if (metric === "Steps") return v.toLocaleString() + " steps";
  return metric + " " + v + (unit ? " " + unit : "");
}

// Returns { ok, count } — count of samples stored.
function ingest(body) {
  const samples = Array.isArray(body && body.samples) ? body.samples : [];
  if (!samples.length) return { ok: true, count: 0 };

  const state = readState() || {};
  const logs = Array.isArray(state.healthLogs) ? state.healthLogs : [];
  let count = 0;

  samples.forEach(function (s) {
    const date = String(s.date || "").slice(0, 10);
    const metric = String(s.metric || "").trim();
    const value = Number(s.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !metric || !isFinite(value)) return;
    const unit = s.unit ? String(s.unit) : null;
    const entry = {
      id: "h_" + date + "_" + metric.replace(/\s+/g, "_"),
      source: "health",
      date: date,
      cat: catFor(metric),
      metric: metric,
      num: value,
      unit: unit,
      val: label(metric, value, unit),
      ts: Date.parse(date + "T12:00:00") || Date.now()
    };
    const i = logs.findIndex(function (l) { return l.date === date && l.metric === metric; });
    if (i > -1) logs[i] = entry; else logs.push(entry);
    count++;
  });

  state.healthLogs = logs;
  writeState(state);
  return { ok: true, count: count };
}

module.exports = { ingest };
