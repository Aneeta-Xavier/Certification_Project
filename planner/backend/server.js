// Daybloom — tiny zero-dependency server (only Node's built-in modules).
// Serves the app, gates data behind a passcode, saves to a JSON file, and talks
// to Claude. Integrations (Apple Health ingest, Apple Calendar) live in lib/.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const auth = require("./lib/auth");
const store = require("./lib/state");
const claude = require("./lib/claude");
const health = require("./lib/health");
const calendar = require("./lib/calendar");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1"; // Tailscale/loopback only; not 0.0.0.0
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const UPLOAD_DIR = store.UPLOAD_DIR;

function readBody(req) {
  return new Promise(function (resolve) {
    let data = "";
    req.on("data", function (c) { data += c; if (data.length > 8e6) req.destroy(); });
    req.on("end", function () { try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"
};
function serveFile(res, file) {
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  // --- auth API ---
  if (p === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    if (auth.checkPasscode(body.passcode)) {
      res.setHeader("Set-Cookie", auth.loginCookie(req));
      return json(res, 200, { ok: true });
    }
    return json(res, 401, { ok: false, error: "Wrong passcode" });
  }
  if (p === "/api/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", auth.logoutCookie());
    return json(res, 200, { ok: true });
  }

  // --- Apple Health ingest (bearer token, not the cookie — phones can't cookie) ---
  if (p === "/api/ingest/health" && req.method === "POST") {
    if (!auth.checkIngestToken(req.headers["authorization"])) return json(res, 401, { error: "Bad token" });
    const body = await readBody(req);
    try { return json(res, 200, health.ingest(body)); }
    catch (e) { console.warn("[daybloom] health ingest failed:", e.message); return json(res, 500, { error: "ingest failed" }); }
  }

  // --- data API (protected) ---
  if (p === "/api/state") {
    if (!auth.isAuthed(req)) return json(res, 401, { error: "Not signed in" });
    if (req.method === "GET") return json(res, 200, { state: store.readState() });
    if (req.method === "POST") {
      const body = await readBody(req);
      if (body && body.state) {
        // Preserve server-owned health logs; the client never writes them.
        try {
          const prev = store.readState() || {};
          const next = body.state;
          if (prev.healthLogs && !("healthLogs" in next)) next.healthLogs = prev.healthLogs;
          else if (prev.healthLogs) next.healthLogs = prev.healthLogs;
          store.writeState(next);
        } catch (e) { return json(res, 500, { error: "Save failed" }); }
      }
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "Method not allowed" });
  }

  // --- Apple Calendar (read) ---
  if (p === "/api/calendar" && req.method === "GET") {
    if (!auth.isAuthed(req)) return json(res, 401, { error: "Not signed in" });
    const from = (url.searchParams.get("from") || "").slice(0, 10);
    const to = (url.searchParams.get("to") || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json(res, 400, { error: "from/to required" });
    try { return json(res, 200, { events: await calendar.read(from, to) }); }
    catch (e) { return json(res, 200, { events: [] }); }
  }

  // --- Claude: free text → structured items ---
  if (p === "/api/parse" && req.method === "POST") {
    if (!auth.isAuthed(req)) return json(res, 401, { error: "Not signed in" });
    const body = await readBody(req);
    const text = String(body.text || "").slice(0, 2000);
    const habits = Array.isArray(body.habits) ? body.habits.slice(0, 20) : [];
    if (!claude.hasKey() || !text) return json(res, 200, { configured: false });
    try { return json(res, 200, await claude.parseText(text, habits)); }
    catch (e) { console.warn("[daybloom] parse failed:", e.message); return json(res, 200, { configured: false, error: String(e.message || e) }); }
  }

  // --- Claude: one short insight ---
  if (p === "/api/insight" && req.method === "POST") {
    if (!auth.isAuthed(req)) return json(res, 401, { error: "Not signed in" });
    const body = await readBody(req);
    if (!claude.hasKey()) return json(res, 200, { configured: false });
    try { return json(res, 200, await claude.insight(body.state || {})); }
    catch (e) { console.warn("[daybloom] insight failed:", e.message); return json(res, 200, { configured: false, error: String(e.message || e) }); }
  }

  // --- Claude: a written review of a day / week / month ---
  if (p === "/api/review" && req.method === "POST") {
    if (!auth.isAuthed(req)) return json(res, 401, { error: "Not signed in" });
    const body = await readBody(req);
    if (!claude.hasKey()) return json(res, 200, { configured: false });
    try { return json(res, 200, await claude.review(body)); }
    catch (e) { console.warn("[daybloom] review failed:", e.message); return json(res, 200, { configured: false, error: String(e.message || e) }); }
  }

  // --- Claude vision: read a screenshot into items ---
  if (p === "/api/parse-image" && req.method === "POST") {
    if (!auth.isAuthed(req)) return json(res, 401, { error: "Not signed in" });
    const body = await readBody(req);
    const m = String(body.image || "").match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (!m) return json(res, 400, { error: "Expected a base64 image data URL" });
    const media = m[1], b64 = m[2];
    const ext = (media.split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^\w]/g, "");
    const fname = crypto.randomBytes(8).toString("hex") + "." + ext;
    try { fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(b64, "base64")); }
    catch (e) { return json(res, 500, { error: "Could not save image" }); }
    const imageUrl = "/uploads/" + fname;
    if (!claude.hasKey()) return json(res, 200, { configured: false, image_url: imageUrl });
    const habits = Array.isArray(body.habits) ? body.habits.slice(0, 20) : [];
    try {
      const out = await claude.parseImage(media, b64, habits);
      return json(res, 200, Object.assign({ image_url: imageUrl }, out));
    } catch (e) {
      console.warn("[daybloom] parse-image failed:", e.message);
      return json(res, 200, { configured: false, image_url: imageUrl, error: String(e.message || e) });
    }
  }

  // --- uploaded images (private) ---
  if (p.indexOf("/uploads/") === 0) {
    if (!auth.isAuthed(req)) { res.writeHead(401); res.end("Not signed in"); return; }
    const uf = path.join(UPLOAD_DIR, path.basename(p));
    if (uf.startsWith(UPLOAD_DIR) && fs.existsSync(uf) && fs.statSync(uf).isFile()) return serveFile(res, uf);
    res.writeHead(404); res.end("Not found"); return;
  }

  // --- pages ---
  if (p === "/" || p === "/index.html") return serveFile(res, path.join(FRONTEND_DIR, "index.html"));
  if (p === "/login") return serveFile(res, path.join(FRONTEND_DIR, "login.html"));

  // --- static files (no path traversal) ---
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(FRONTEND_DIR, safe);
  if (file.startsWith(FRONTEND_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);

  res.writeHead(404); res.end("Not found");
});

// Fail closed: never expose the app on a network-facing address while still
// using the built-in default passcode/secret (anyone could log in or forge a
// session). Loopback-only stays convenient for quick local dev.
var isLoopback = HOST === "127.0.0.1" || HOST === "::1" || HOST === "localhost";
if (!isLoopback && auth.usingDefaultSecrets) {
  console.error("[daybloom] REFUSING to start on " + HOST + " with default credentials.");
  console.error("[daybloom] Set DAYBLOOM_PASSCODE and DAYBLOOM_SECRET, or bind HOST=127.0.0.1 for local-only use.");
  process.exit(1);
}

server.listen(PORT, HOST, function () { console.log("[daybloom] running on http://" + HOST + ":" + PORT); });
