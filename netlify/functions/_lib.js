
// Shared helpers for Netlify Functions

const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

function cors(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || "";
  const ok = allowed.length === 0 || allowed.includes(origin);
  const headers = {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
  if (!ok) {
    return { ok: false, headers, statusCode: 403, body: JSON.stringify({ error: "CORS blocked" }) };
  }
  return { ok: true, headers };
}

// Simple in-memory cache (per function instance)
const cache = {};
function memo(key, ttlMs, producer) {
  const now = Date.now();
  const hit = cache[key];
  if (hit && (now - hit.t) < ttlMs) return Promise.resolve(hit.v);
  return producer().then(v => (cache[key] = { t: now, v }) && v);
}

// Timezone helpers (America/New_York) → UTC strings
function easternOffsetMinutes(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(parts.year, Number(parts.month)-1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

function dayWindowET_Now() {
  const now = new Date();
  const off = easternOffsetMinutes(now);
  const nowEtMs = now.getTime() + off*60000;
  const nowEt = new Date(nowEtMs);
  const y = nowEt.getUTCFullYear(), m = nowEt.getUTCMonth(), d = nowEt.getUTCDate();
  const startEtMs = Date.UTC(y, m, d, 0, 0, 0);
  const startUtcMs = startEtMs - off*60000;
  const endUtcMs = nowEtMs - off*60000; // now ET → UTC
  return { startUtc: new Date(startUtcMs), endUtc: new Date(endUtcMs) };
}

function fridayWindowET_Now() {
  // Friday 00:00:00 ET through Thursday 23:59:59 ET
  const now = new Date();
  const off = easternOffsetMinutes(now);
  const nowEtMs = now.getTime() + off*60000;
  const nowEt = new Date(nowEtMs);
  const dayEt = nowEt.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceFri = (dayEt - 5 + 7) % 7;
  const lastFriEtMs = nowEtMs - daysSinceFri*86400000;
  const lastFriEt = new Date(lastFriEtMs);
  const y = lastFriEt.getUTCFullYear(), m = lastFriEt.getUTCMonth(), d = lastFriEt.getUTCDate();
  const startEtMidnightMs = Date.UTC(y, m, d, 0, 0, 0);
  const startUtcMs = startEtMidnightMs - off*60000;
  const endUtcMs = startUtcMs + 7*86400000 - 1000;
  return { startUtc: new Date(startUtcMs), endUtc: new Date(endUtcMs) };
}

function fmtUtcSQL(dt) {
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())} ` +
         `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

// Display-name mapping and headshot helper
const NAME_MAP = {
  "Ajani": "A S",
  "Anna": "Anna",
  "Eli": "Eli",
  "Fabricio": "F C",
  "Fraitzline": "Fraitzline",
  "Joseph": "Joseph",
  "Marie Saint Cyr": "Marie",
  "Philip Baxter": "Baxter",
  "Robert Adams": "Robert Adams",
  "Michelle Landis": "Michelle Landis"
};

function headshotFor(name) {
  const key = (name || "").toLowerCase().replace(/\s+/g, "-");
  return `/headshots/${key}.jpg`;
}

module.exports = {
  cors, memo,
  easternOffsetMinutes, dayWindowET_Now, fridayWindowET_Now, fmtUtcSQL,
  NAME_MAP, headshotFor
};
