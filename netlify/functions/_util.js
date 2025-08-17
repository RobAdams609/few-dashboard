// netlify/functions/_util.js

const fs = require("fs");
const path = require("path");

// --- Timestamps Ringy expects (UTC "YYYY-MM-DD HH:mm:ss")
function pad(n){ return String(n).padStart(2,'0'); }
function toUtcStamp(d){
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Inclusive UTC range for the last N days ending today
function rangeForDays(days = 7){
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23,59,59));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - Number(days || 7) + 1);
  start.setUTCHours(0,0,0,0);
  return { startDate: toUtcStamp(start), endDate: toUtcStamp(end) };
}

// Phone normalizer: digits only, strip leading "1"
function normalizePhone(raw){
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

// Load roster from repo (bundled via netlify.toml included_files)
function loadRoster(){
  try {
    const p1 = path.join(process.cwd(), "public", "headshots", "roster.json");
    const p2 = path.join(process.cwd(), "public", "roster.json"); // fallback
    let txt = null;
    try { txt = fs.readFileSync(p1, "utf8"); } catch { txt = fs.readFileSync(p2, "utf8"); }
    const raw = JSON.parse(txt);
    const list = Array.isArray(raw) ? raw : (raw.agents || []);
    const agents = list.map(a => ({
      name: a.name || "Unknown",
      email: String(a.email || "").toLowerCase(),
      phones: Array.isArray(a.phones) ? a.phones.map(normalizePhone).filter(Boolean) : []
    }));

    const phoneToAgent = new Map();
    const emailToAgent = new Map();
    for (const a of agents){
      emailToAgent.set(a.email, a);
      for (const ph of a.phones) phoneToAgent.set(ph, a);
    }
    return { agents, phoneToAgent, emailToAgent };
  } catch (e){
    return { agents: [], phoneToAgent: new Map(), emailToAgent: new Map() };
  }
}

module.exports = { toUtcStamp, rangeForDays, normalizePhone, loadRoster };
