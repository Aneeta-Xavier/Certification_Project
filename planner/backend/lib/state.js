// Reads/writes the single JSON state blob and keeps daily backups.
// One user, small data → a file is simpler and safer than a database.

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = process.env.DATA_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "Daybloom");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch (e) { return null; }
}

// Once per calendar day, snapshot the current file before overwriting it.
// Keeps the most recent 30 snapshots.
function backupOncePerDay() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const day = new Date().toISOString().slice(0, 10);
    const dest = path.join(BACKUP_DIR, "state-" + day + ".json");
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(STATE_FILE, dest);
      const old = fs.readdirSync(BACKUP_DIR)
        .filter((f) => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      while (old.length > 30) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, old.shift())); } catch (e) {}
      }
    }
  } catch (e) { /* backups are best-effort */ }
}

function writeState(state) {
  backupOncePerDay();
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE); // atomic replace
}

module.exports = { DATA_DIR, STATE_FILE, UPLOAD_DIR, BACKUP_DIR, readState, writeState };
