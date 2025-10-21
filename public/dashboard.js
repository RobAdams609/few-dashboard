/* ===========================================
   THE FEW — dashboard.js (full production)
   Domain-locked, resilient, metric-accurate
   Updated: 2025-10-20
   =========================================== */

/* ---------- CONSTANTS ---------- */
const DOMAIN = "https://few-dashboard-live.netlify.app"; // absolute only
const ROSTER_URL = `${DOMAIN}/headshots/roster.json`;
const HEADSHOT_URL = (f) => `${DOMAIN}/headshots/${encodeURIComponent(f || "default.png")}`;

// Permanent 17-vendor list (exact)
const VENDORS = [
  "$7.50", "George Region Shared", "Red Media", "Blast/Bulk", "Exclusive JUMBO", "ABC",
  "Shared Jumbo", "VS Default", "RKA Website", "Redrip/Give up Purchased",
  "Lamy Dynasty Specials", "JUMBO Splits", "Exclusive 30s", "Positive Intent/Argos",
  "HotLine Bling", "Referral", "CG Exclusive"
];

// Ringy public endpoints (client-side per user direction)
const RINGY = {
  soldProducts: "https://app.ringy.com/api/public/external/get-lead-sold-products",
  recordings:   "https://app.ringy.com/api/public/external/get-recordings"
};
// LIVE keys (user-provided previously)
const KEYS = {
  SOLD:  "RGYiqo808w4kv7of0t7rxgn45g8xl11n", // sold leads
  CALL:  "RGY60brwg9qq24bfrqfj0x11rbnlpap",  // recordings/calls
  LEADS: "RGYt9bght8w0rd5qfn65v9ud0g2oam8e"   // (reserved)
};

// Rotations
const VIEW_ROTATE_MS = 30_000;        // 30s view rotation
const PRINCIPLE_ROTATE_MS = 3 * 60 * 60 * 1000; // 3 hours

// Principles (11). Banner prefix permanent.
const PRINCIPLE_PREFIX = "THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT";
const PRINCIPLES = [
  "Own the outcome. Excuses don’t pay.",
  "Speed to lead wins. Seconds matter.",
  "Control the frame: questions > monologues.",
  "Help first. Value before price.",
  "Consistency beats intensity.",
  "Track, measure, improve. Daily.",
  "Coachability is a superpower.",
  "High standards, zero drama.",
  "Work the process. Trust the math.",
  "Lead by example. Always.",
  "Objections = interest; isolate and resolve."
];

// OE countdown target (Open Enrollment start)
const OE_TARGET = new Date("2025-11-01T05:00:00Z"); // 12:00 AM ET ≈ 05:00 UTC

/* ---------- DATE HELPERS ---------- */
const now = () => new Date();
const iso = (d) => d.toISOString().slice(0,10);
const daysAgo = (n) => { const d = now(); d.setDate(d.getDate() - n); return d; };

// Windows
const RANGE = {
  // Sales week = Fri → Thu per user; for simplicity, we’ll show *current week* + last 45 days vendors
  salesStartISO: iso(daysAgo(6)),    // 7-day window for totals/leaderboards (live/rolling)
  salesEndISO:   iso(now()),
  vendorStartISO: iso(daysAgo(44)),  // last 45 days inclusive
  vendorEndISO:   iso(now()),
  callsStartISO:  iso(daysAgo(6)),
  callsEndISO:    iso(now())
};

/* ---------- DOM HOOKS ---------- */
// Single banner rule: exactly one
const els = {
  principleBanner: document.querySelector("#principleBanner"),
  viewTitle: document.querySelector("#viewTitle"),
  dataTableBody: document.querySelector("#dataTable tbody"),
  vendorCanvas: document.querySelector("#vendorChart"),
  vendorFallback: document.querySelector("#vendorChartFallback"),
  salesTicker: document.querySelector("#salesTicker"),
  totalAV: document.querySelector("#totalAV"),
  totalSales: document.querySelector("#totalDeals"),
  totalCalls: document.querySelector("#totalCalls"),
  totalTalk: document.querySelector("#totalTalk"),
  lastUpdated: document.querySelector("#lastUpdated"),
  oeCountdown: document.querySelector("#oeCountdown")
};

/* ---------- UI COLORS (applied inline to ensure dark / gold / white) ---------- */
document.documentElement.style.setProperty("--gold", "#FFD700");
document.documentElement.style.setProperty("--fg", "#FFFFFF");
document.documentElement.style.setProperty("--bg", "#0E0F12");

/* ---------- UTILS ---------- */
const $safe = (el, txt) => { if (el) el.textContent = txt; };
const $html = (el, html) => { if (el) el.innerHTML = html; };
const fmtMoney0 = (n) => Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
const fmtInt = (n) => Number(n||0).toLocaleString("en-US");
const fmtHMS = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec||0)));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), r=s%60;
  return `${h}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
};
const byDesc = (k) => (a,b) => (Number(b[k]||0) - Number(a[k]||0));

async function fetchJSON(url, opts) {
  try {
    const r = await fetch(url, {...opts, cache:"no-store"});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch(e) {
    console.error("fetchJSON fail", url, e);
    return null;
  }
}

/* ---------- ROSTER ---------- */
let ROSTER_IDX = new Map(); // name -> headshot filename
function normalizeName(s=""){ return s.toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z\s]/g,"").replace(/\s+/g," ").trim(); }
function buildRosterIndex(roster) {
  const idx = new Map();
  if (Array.isArray(roster)) {
    for (const r of roster) {
      if (!r) continue;
      const name = r.name || r.displayName || r.alias;
      const file = r.headshot || r.image || r.file;
      if (name && file) idx.set(normalizeName(name), file);
    }
  } else if (roster && typeof roster === "object") {
    for (const [name, file] of Object.entries(roster)) {
      idx.set(normalizeName(name), file);
    }
  }
  return idx;
}
function headshotFor(name) {
  const f = ROSTER_IDX.get(normalizeName(name||""));
  return HEADSHOT_URL(f);
}

/* ---------- RINGY FETCHERS + FALLBACKS ---------- */
async function fetchSold(startDate, endDate) {
  const body = new URLSearchParams({ apiKey: KEYS.SOLD, startDate, endDate, limit: "5000" });
  const json = await fetchJSON(RINGY.soldProducts, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  if (!json || !Array.isArray(json.data)) return [];
  return json.data.map(x => ({
    user_name: x.user_name || x.userName || x.agent || "Unknown",
    vendor: (x.vendor || x.source || "").trim(),
    amountMonthly: Number(x.premium_amount || x.premium || x.amount || 0),
    av: Number(x.premium_amount || x.premium || x.amount || 0) * 12,
    sold_at: x.created_at || x.sold_at || x.date || null,
    client: x.client_name || x.customer_name || null
  }));
}
async function fetchRecordings(startDate, endDate) {
  const body = new URLSearchParams({ apiKey: KEYS.CALL, startDate, endDate, limit: "5000" });
  const json = await fetchJSON(RINGY.recordings, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  if (!json || !Array.isArray(json.data)) return [];
  return json.data.map(x => ({
    user_name: x.user_name || x.userName || x.agent || "Unknown",
    talk_seconds: Number(x.talk_time_seconds || x.duration || 0),
    created_at: x.created_at || x.date || null
  }));
}

// Overrides (fail-safe)
async function fetchOverride(path) {
  return await fetchJSON(`${DOMAIN}${path}`);
}

/* ---------- AGGREGATION ---------- */
function aggregateAVByUser(sales=[]) {
  const m = new Map();
  for (const s of sales) {
    const k = s.user_name || "Unknown";
    const cur = m.get(k) || { user_name:k, av:0, deals:0 };
    cur.av += Number(s.av||0);
    cur.deals += 1;
    m.set(k, cur);
  }
  return [...m.values()];
}
function aggregateCallsByUser(recs=[]) {
  const m = new Map();
  for (const r of recs) {
    const k = r.user_name || "Unknown";
    const cur = m.get(k) || { user_name:k, calls:0, talk_seconds:0 };
    cur.calls += 1;
    cur.talk_seconds += Number(r.talk_seconds||0);
    m.set(k, cur);
  }
  return [...m.values()];
}
function joinMetrics(avRows, callRows) {
  const m = new Map();
  for (const a of avRows) m.set(a.user_name, { user_name:a.user_name, av:a.av, deals:a.deals, calls:0, talk_seconds:0 });
  for (const c of callRows) {
    const row = m.get(c.user_name) || { user_name:c.user_name, av:0, deals:0, calls:0, talk_seconds:0 };
    row.calls += c.calls;
    row.talk_seconds += c.talk_seconds;
    m.set(c.user_name, row);
  }
  return [...m.values()];
}
function vendorCounts(sales=[], vendors=VENDORS) {
  const counts = Object.fromEntries(vendors.map(v => [v, 0]));
  for (const s of sales) {
    if (counts.hasOwnProperty(s.vendor)) counts[s.vendor] += 1;
  }
  return counts;
}

/* ---------- RENDERERS ---------- */
function renderTeamTotals(rows=[]) {
  const totalAV = rows.reduce((a,x)=>a+Number(x.av||0),0);
  const totalDeals = rows.reduce((a,x)=>a+Number(x.deals||0),0);
  const totalCalls = rows.reduce((a,x)=>a+Number(x.calls||0),0);
  const totalTalk  = rows.reduce((a,x)=>a+Number(x.talk_seconds||0),0);

  $safe(els.totalAV, fmtMoney0(totalAV));
  $safe(els.totalSales, fmtInt(totalDeals));
  $safe(els.totalCalls, fmtInt(totalCalls));
  $safe(els.totalTalk, fmtHMS(totalTalk));
}

function rowEmojiLowPerf(r) {
  // Low-performer gag: 0 deals + (calls < 20 OR talk < 600s)
  if ((r.deals||0) === 0 && ((r.calls||0) < 20 || (r.talk_seconds||0) < 600)) return " 💩";
  return "";
}

function renderTable(view, rows) {
  // view: "AV" | "Sales" | "Calls" | "Talk"
  $safe(els.viewTitle, view);

  const sorted = {
    "AV":    [...rows].sort(byDesc("av")),
    "Sales": [...rows].sort(byDesc("deals")),
    "Calls": [...rows].sort(byDesc("calls")),
    "Talk":  [...rows].sort(byDesc("talk_seconds"))
  }[view];

  const top3 = new Set(sorted.slice(0,3).map(r=>r.user_name));

  const html = sorted.map(r => {
    const img = headshotFor(r.user_name);
    const klass = top3.has(r.user_name) ? 'class="top3"' : "";
    const emoji = rowEmojiLowPerf(r);

    const cells = {
      "AV":    `<td>${fmtMoney0(r.av)}</td><td>${fmtInt(r.deals)}</td><td>${fmtInt(r.calls)}</td><td>${fmtHMS(r.talk_seconds)}</td>`,
      "Sales": `<td>${fmtInt(r.deals)}</td><td>${fmtMoney0(r.av)}</td><td>${fmtInt(r.calls)}</td><td>${fmtHMS(r.talk_seconds)}</td>`,
      "Calls": `<td>${fmtInt(r.calls)}</td><td>${fmtHMS(r.talk_seconds)}</td><td>${fmtMoney0(r.av)}</td><td>${fmtInt(r.deals)}</td>`,
      "Talk":  `<td>${fmtHMS(r.talk_seconds)}</td><td>${fmtInt(r.calls)}</td><td>${fmtMoney0(r.av)}</td><td>${fmtInt(r.deals)}</td>`
    }[view];

    return `
      <tr ${klass}>
        <td class="agent">
          <img src="${img}" alt="${r.user_name}" class="h-8 w-8 rounded-full object-cover" onerror="this.src='${HEADSHOT_URL("default.png")}'">
          <span>${r.user_name}${emoji}</span>
        </td>
        ${cells}
      </tr>`;
  }).join("");

  $html(els.dataTableBody, html || `<tr><td colspan="5">Loading…</td></tr>`);
}

function renderTicker(sales=[]) {
  if (!els.salesTicker) return;
  const items = sales
    .slice()
    .sort((a,b)=> new Date(b.sold_at||0) - new Date(a.sold_at||0))
    .slice(0, 60)
    .map(s => `<span class="mr-8"><strong>${s.user_name}</strong> • ${fmtMoney0(s.av)} • <em>${s.vendor || "—"}</em></span>`);
  $html(els.salesTicker, items.join(""));
}

function renderVendorChart(counts) {
  const labels = VENDORS;
  const data = labels.map(l => counts[l] || 0);
  if (els.vendorCanvas && window.Chart) {
    if (els.vendorCanvas._chart) els.vendorCanvas._chart.destroy();
    els.vendorCanvas._chart = new Chart(els.vendorCanvas.getContext("2d"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Deals (Last 45 Days)", data }] },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: "y",
        plugins: { legend:{display:false}, tooltip:{enabled:true} },
        scales: { x:{beginAtZero:true, ticks:{precision:0}}, y:{ticks:{autoSkip:false}} }
      }
    });
    if (els.vendorFallback) $html(els.vendorFallback, "");
  } else if (els.vendorFallback) {
    const rows = labels.map((l,i)=>`<tr><td>${l}</td><td>${data[i]}</td></tr>`).join("");
    $html(els.vendorFallback, `<table class="text-sm">${rows}</table>`);
  }
}

function startPrincipleBanner() {
  if (!els.principleBanner) return;
  let idx = Math.floor(now().getTime()/PRINCIPLE_ROTATE_MS) % PRINCIPLES.length;
  const set = () => $safe(els.principleBanner, `${PRINCIPLE_PREFIX} • ${PRINCIPLES[idx]}`);
  set();
  setInterval(()=>{ idx = (idx+1) % PRINCIPLES.length; set(); }, PRINCIPLE_ROTATE_MS);
}

function startOeCountdown() {
  if (!els.oeCountdown) return;
  const tick = () => {
    const dms = OE_TARGET - new Date();
    if (dms <= 0) { $safe(els.oeCountdown, "OPEN ENROLLMENT IS LIVE"); return; }
    const d = Math.floor(dms / (24*3600e3));
    const h = Math.floor((dms % (24*3600e3))/3600e3);
    const m = Math.floor((dms % 3600e3)/60e3);
    const s = Math.floor((dms % 60e3)/1e3);
    $safe(els.oeCountdown, `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`);
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- ROTATION ENGINE ---------- */
const VIEWS = ["Calls","Talk","Sales","AV"];
let viewIdx = 0;
function startViewRotation(rows) {
  const renderCurrent = () => renderTable(VIEWS[viewIdx], rows);
  renderCurrent();
  setInterval(() => { viewIdx = (viewIdx+1)%VIEWS.length; renderCurrent(); }, VIEW_ROTATE_MS);
}

/* ---------- MAIN LOAD ---------- */
async function loadAll() {
  // Roster
  const rosterRaw = await fetchJSON(ROSTER_URL) || [];
  ROSTER_IDX = buildRosterIndex(rosterRaw);

  // Live pulls with fail-safe overrides
  let [sold, recs] = await Promise.all([
    fetchSold(RANGE.salesStartISO, RANGE.salesEndISO),
    fetchRecordings(RANGE.callsStartISO, RANGE.callsEndISO)
  ]);

  // Fallbacks if API failed
  if (!Array.isArray(sold) || !sold.length) {
    const ov = await fetchOverride("/av_week_override.json");
    sold = Array.isArray(ov) ? ov : [];
  }
  if (!Array.isArray(recs) || !recs.length) {
    const ov = await fetchOverride("/calls_week_override.json");
    recs = Array.isArray(ov) ? ov : [];
  }

  // Compute week metrics
  const avRows = aggregateAVByUser(sold);
  const callRows = aggregateCallsByUser(recs);
  const rows = joinMetrics(avRows, callRows);

  // Team totals (no $0 placeholders — calculated)
  renderTeamTotals(rows);

  // Start rotating table views
  startViewRotation(rows);

  // Vendor 45-day chart (filtered sales within last 45 days only)
  const sales45 = sold.filter(s => {
    if (!s.sold_at) return false;
    const t = new Date(s.sold_at);
    return t >= new Date(RANGE.vendorStartISO) && t <= new Date(RANGE.vendorEndISO);
  });
  // Ensure only permanent vendors counted
  const clean45 = sales45.map(s => ({...s, vendor: VENDORS.includes(s.vendor) ? s.vendor : s.vendor }));
  const counts = vendorCounts(clean45, VENDORS);
  renderVendorChart(counts);

  // Live ticker
  renderTicker(sold);

  // Single rule banner + OE countdown
  startPrincipleBanner();
  startOeCountdown();

  // Stamp time
  $safe(els.lastUpdated, new Date().toLocaleString("en-US",{hour12:true}));
}

/* ---------- BOOT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  // Enforce single principle banner in DOM
  const banners = Array.from(document.querySelectorAll("#principleBanner"));
  if (banners.length > 1) banners.slice(1).forEach(b => b.remove());

  // Minimal “Loading…” placeholders
  if (els.dataTableBody) $html(els.dataTableBody, `<tr><td colspan="5">Loading…</td></tr>`);
  if (els.vendorFallback) $html(els.vendorFallback, `<div>Loading…</div>`);
  if (els.salesTicker) $html(els.salesTicker, `<span>Loading…</span>`);

  loadAll().catch(err => {
    console.error("Dashboard load error", err);
    if (els.dataTableBody) $html(els.dataTableBody, `<tr><td colspan="5">Data unavailable.</td></tr>`);
  });
});
