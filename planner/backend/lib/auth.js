// Passcode login → stateless HMAC-signed session cookie, plus a separate
// bearer token for the Apple Health ingest endpoint (phones can't do cookies).

const crypto = require("crypto");

const SECRET = process.env.DAYBLOOM_SECRET || "dev-insecure-secret-change-me";
const PASSCODE = process.env.DAYBLOOM_PASSCODE || "daybloom";
const INGEST_TOKEN = process.env.DAYBLOOM_INGEST_TOKEN || "";
const COOKIE = "daybloom_session";
const SESSION_DAYS = 30;

if (!process.env.DAYBLOOM_PASSCODE) {
  console.warn("[daybloom] WARNING: using default passcode 'daybloom'. Set DAYBLOOM_PASSCODE before real use.");
}

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
}
function makeToken() {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = "v1." + exp;
  return payload + "." + sign(payload);
}
function validToken(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const payload = parts[0] + "." + parts[1];
  if (sign(payload) !== parts[2]) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp > Date.now();
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(function (c) {
    const i = c.indexOf("=");
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  return validToken(parseCookies(req)[COOKIE]);
}
function checkPasscode(passcode) {
  return String(passcode || "") === PASSCODE;
}
function loginCookie(req) {
  const secure = (req.headers["x-forwarded-proto"] === "https") ? " Secure;" : "";
  return COOKIE + "=" + makeToken() + "; HttpOnly; Path=/; SameSite=Lax;" + secure + " Max-Age=" + SESSION_DAYS * 86400;
}
function logoutCookie() {
  return COOKIE + "=; HttpOnly; Path=/; Max-Age=0";
}
// Constant-time compare so a wrong ingest token can't be timed out character by character.
function checkIngestToken(header) {
  if (!INGEST_TOKEN) return false;
  const given = String(header || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given), b = Buffer.from(INGEST_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isAuthed, checkPasscode, loginCookie, logoutCookie, checkIngestToken };
