// Daybloom end-to-end tests, using only Node's built-in test runner (node --test).
// Boots the real server on a random port with a temp data dir and exercises the
// API the same way the phone does. No dependencies, no mocks of our own code.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = "http://127.0.0.1:" + PORT;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daybloom-test-"));
const PASSCODE = "test-pass";
const INGEST_TOKEN = "test-ingest-token";

let server;
let cookie = "";

function api(method, p, body, headers) {
  const h = Object.assign({ "content-type": "application/json" }, headers || {});
  if (cookie) h.cookie = cookie;
  return fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
}

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR,
      DAYBLOOM_PASSCODE: PASSCODE, DAYBLOOM_SECRET: "test-secret",
      DAYBLOOM_INGEST_TOKEN: INGEST_TOKEN, ANTHROPIC_API_KEY: ""
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  // wait for it to listen
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + "/login"); return; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("server never came up");
});

after(() => {
  if (server) server.kill("SIGKILL");
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
});

test("serves the app shell and PWA assets", async () => {
  for (const [p, type] of [
    ["/login", "text/html"],
    ["/manifest.webmanifest", "application/manifest+json"],
    ["/sw.js", "text/javascript"],
    ["/icons/icon-192.png", "image/png"]
  ]) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p + " status");
    assert.ok(r.headers.get("content-type").startsWith(type), p + " content-type");
  }
});

test("app page includes the four tabs and no removed ones", async () => {
  const html = await (await fetch(BASE + "/")).text();
  for (const tab of ["today", "sleep", "nutrition", "plan"]) {
    assert.ok(html.includes('data-tab="' + tab + '"'), "has tab " + tab);
  }
  assert.ok(!html.includes("tab-goals") && !html.includes("tab-journal"), "goals/journal tabs removed");
});

test("rejects a wrong passcode, accepts the right one", async () => {
  const bad = await api("POST", "/api/login", { passcode: "nope" });
  assert.equal(bad.status, 401);
  const good = await api("POST", "/api/login", { passcode: PASSCODE });
  assert.equal(good.status, 200);
  const setCookie = good.headers.get("set-cookie");
  assert.ok(setCookie && setCookie.includes("daybloom_session="), "sets session cookie");
  assert.ok(setCookie.includes("HttpOnly"), "cookie is HttpOnly");
  cookie = setCookie.split(";")[0];
});

test("state is protected, saves, and round-trips", async () => {
  const anon = await fetch(BASE + "/api/state");
  assert.equal(anon.status, 401, "state requires login");
  const saved = await api("POST", "/api/state", { state: { logs: [{ id: "a1", cat: "sleep", val: "Slept 7h", date: "2026-07-20" }], today: {}, habits: [] } });
  assert.equal(saved.status, 200);
  const got = await (await api("GET", "/api/state")).json();
  assert.equal(got.state.logs.length, 1);
  assert.equal(got.state.logs[0].val, "Slept 7h");
});

test("health ingest: auth, upsert without duplicates, preserved across client saves", async () => {
  const noAuth = await api("POST", "/api/ingest/health", { samples: [] }, { authorization: "Bearer wrong" });
  assert.equal(noAuth.status, 401, "wrong token rejected");

  const auth = { authorization: "Bearer " + INGEST_TOKEN };
  const first = await (await api("POST", "/api/ingest/health", { samples: [
    { date: "2026-07-19", metric: "Sleep", value: 7.3, unit: "h" },
    { date: "2026-07-20", metric: "Steps", value: 8432, unit: "count" }
  ] }, auth)).json();
  assert.equal(first.count, 2);

  // Same day+metric again → overwrite, not duplicate
  await api("POST", "/api/ingest/health", { samples: [{ date: "2026-07-19", metric: "Sleep", value: 6.9, unit: "h" }] }, auth);
  let state = (await (await api("GET", "/api/state")).json()).state;
  assert.equal(state.healthLogs.length, 2, "no duplicate for re-sent day");
  assert.equal(state.healthLogs.find((l) => l.metric === "Sleep").num, 6.9, "value updated");

  // Client saving its own state must not wipe server-owned health logs
  await api("POST", "/api/state", { state: { logs: [], today: {}, habits: [] } });
  state = (await (await api("GET", "/api/state")).json()).state;
  assert.equal(state.healthLogs.length, 2, "healthLogs preserved after client save");

  // Garbage samples are ignored, not stored
  const junk = await (await api("POST", "/api/ingest/health", { samples: [{ date: "bad", metric: "", value: "x" }] }, auth)).json();
  assert.equal(junk.count, 0);
});

test("claude endpoints degrade gracefully without an API key", async () => {
  const parse = await (await api("POST", "/api/parse", { text: "slept 6h", habits: [] })).json();
  assert.equal(parse.configured, false);
  const review = await (await api("POST", "/api/review", { period: "week", days: [] })).json();
  assert.equal(review.configured, false);
});

test("calendar endpoint validates input and never errors", async () => {
  const bad = await api("GET", "/api/calendar?from=zzz&to=2026-07-20");
  assert.equal(bad.status, 400);
  const ok = await api("GET", "/api/calendar?from=2026-07-19&to=2026-07-20");
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(Array.isArray(body.events), "events is an array (empty in CI)");
});

test("blocks path traversal and protects uploads", async () => {
  const trav = await fetch(BASE + "/..%2f..%2fbackend%2fserver.js");
  assert.notEqual(trav.status, 200, "no path traversal");
  const up = await fetch(BASE + "/uploads/anything.jpg");
  assert.equal(up.status, 401, "uploads require login");
});

test("daily backup is created on write", async () => {
  const backups = fs.readdirSync(path.join(DATA_DIR, "backups"));
  assert.ok(backups.some((f) => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)), "dated backup exists");
});

test("refuses to start on a network address with default credentials", async () => {
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT + 1), HOST: "0.0.0.0", DATA_DIR
      // deliberately NO DAYBLOOM_PASSCODE / DAYBLOOM_SECRET → defaults
    }),
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  proc.stderr.on("data", (c) => { stderr += c; });
  const code = await new Promise((resolve) => proc.on("exit", resolve));
  assert.equal(code, 1, "exits non-zero");
  assert.match(stderr, /REFUSING to start/, "explains why");
});

test("starts on a network address once a real passcode + secret are set", async () => {
  const p2 = PORT + 2;
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, {
      PORT: String(p2), HOST: "0.0.0.0", DATA_DIR,
      DAYBLOOM_PASSCODE: "real-pass", DAYBLOOM_SECRET: "real-secret"
    }),
    stdio: ["ignore", "ignore", "ignore"]
  });
  try {
    let up = false;
    for (let i = 0; i < 40; i++) {
      try { await fetch("http://127.0.0.1:" + p2 + "/login"); up = true; break; }
      catch (e) { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, "server came up on 0.0.0.0 with real credentials");
  } finally { proc.kill("SIGKILL"); }
});
