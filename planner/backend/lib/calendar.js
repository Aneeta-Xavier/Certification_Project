// Reads Apple Calendar events by shelling out to osascript (JXA). Calendar
// queries are slow, so results are cached ~5 minutes per date range. Only works
// when the server runs on the Mac (not on a cloud host) and Calendar access has
// been granted to the node process. Failures return [] so the UI degrades quietly.

const { execFile } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "calendar.jxa.js");
const cache = new Map(); // key "from|to" → { at, events }
const TTL = 5 * 60 * 1000;

function read(from, to) {
  return new Promise(function (resolve) {
    const key = from + "|" + to;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return resolve(hit.events);
    execFile("osascript", ["-l", "JavaScript", SCRIPT, from, to], { timeout: 15000, maxBuffer: 4e6 },
      function (err, stdout, stderr) {
        if (err) {
          console.warn("[daybloom] calendar read failed:", (stderr || err.message || "").slice(0, 200));
          return resolve(hit ? hit.events : []); // fall back to any stale cache
        }
        let events = [];
        try { events = JSON.parse(String(stdout).trim() || "[]"); } catch (e) { events = []; }
        cache.set(key, { at: Date.now(), events: events });
        resolve(events);
      });
  });
}

module.exports = { read };
