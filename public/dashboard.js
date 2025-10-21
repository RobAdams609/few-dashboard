/* =====================================================================
   THE FEW — dashboard.js  (FULL PRODUCTION REWRITE)
   Domain: https://few-dashboard-live.netlify.app
   Boards: Lead Vendors • Agent of the Week • YTD Leaders • Weekly Activity
   Data: Netlify Functions → Ringy Public API → Local overrides (fail-safe)
   Rule of the Day: exactly ONE, rotates ONCE PER DAY
   Updated: 2025-10-21
   ===================================================================== */

/* ------------------ CONSTANTS & CONFIG ------------------ */
const DOMAIN = "https://few-dashboard-live.netlify.app";

// Prefer server proxies to avoid CORS & keep keys off client
const FN = {
  sold:       `${DOMAIN}/.netlify/functions/ringy-sold-products`,      // ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  recordings: `${DOMAIN}/.netlify/functions/ringy-recordings`,          // ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  leads:      `${DOMAIN}/.netlify/functions/ringy-leads`                // ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (optional)
};

// Fallback Ringy public (only used if functions fail)
const RINGY = {
  sold:       "https://app.ringy.com/api/public/external/get-lead-sold-products",
  recordings: "https://app.ringy.com/api/public/external/get-recordings",
  leads:      "https://app.ringy.com/api/public/external/get-leads"
};
// If your functions are solid, you can delete keys below safely.
const KEY = {
  SOLD:  "RGYiqo808w4kv7of0t7rxgn45g8xl11n",
  CALL:  "RGY60brwg9qq24bfrqfj0x11rbnlpap",
  LEADS: "RGYt9bght8w0rd5qfn65v9ud0g2oam8e"
};

// Live assets
const ROSTER_URL = `${DOMAIN}/headshots/roster.json`;
const HEADSHOT = (f) => `${DOMAIN}/headshots/${encodeURIComponent(f || "default.png")}`;

// Permanent 17 vendors (display order)
const VENDORS = [
  "$7.50","George Region Shared","Red Media","Blast/Bulk","Exclusive JUMBO","ABC",
  "Shared Jumbo","VS Default","RKA Website","Redrip/Give up Purchased","Lamy Dynasty Specials",
  "JUMBO Splits","Exclusive 30s","Positive Intent/Argos","HotLine Bling","Referral","CG Exclusive"
];
// Normalize Ringy vendor strings to permanent list
const VENDOR_ALIAS = {
  "george region":"George Region Shared","george region shared":"George Region Shared",
  "red media":"Red Media","blast":"Blast/Bulk","bulk":"Blast/Bulk","exclusive jumbo":"Exclusive JUMBO",
  "shared jumbo":"Shared Jumbo","vs default":"VS Default","rka website":"RKA Website",
  "redrip":"Redrip/Give up Purchased","give up purchased":"Redrip/Give up Purchased",
  "lamy dynasty specials":"Lamy Dynasty Specials","jumbo splits":"JUMBO Splits",
  "exclusive 30s":"Exclusive 30s","positive intent":"Positive Intent/Argos","argos":"Positive Intent/Argos",
  "hotline bling":"HotLine Bling","cg exclusive":"CG Exclusive","$7.50":"$7.50","abc":"ABC"
};

// Single Rule of the Day (rotates once/day)
const PRINCIPLES = [
  "Own the outcome. Excuses don’t pay.","Speed to lead wins. Seconds matter.",
  "Control the frame: questions > monologues.","Help first. Value before price.",
  "Consistency beats intensity.","Track, measure, improve. Daily.",
  "Coachability is a superpower.","High standards, zero drama.",
  "Work the process. Trust the math.","Lead by example. Always.",
  "Objections = interest; isolate and resolve."
];
const RULE_PREFIX = "THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT";

// Rotation
const BOARD_ROTATE_MS = 30_000; // rotate visible board every 30s

// OE countdown target (midnight ET ≈ 05:00 UTC)
const OE_TARGET = new Date("2025-11-01T05:00:00Z");

/* ------------------ DATE HELPERS ------------------ */
const now = () => new Date();
const iso = (d) => d.toISOString().slice(0,10);
const minusDays = (n) => { const d = new Date(); d.setDate(d.getDate()-n); return d; };

function salesWeekWindow() { // Fri → Thu
  const d = new Date();
  const dow = d.getDay(); // 0..6 (Sun..Sat)
  const back = (dow >= 5) ? (dow - 5) : (7 - (5 - dow));
  const start = new Date(d); start.setDate(d.getDate() - back);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start: iso(start), end: iso(end) };
}
const RANGE = {
  week: salesWeekWindow(),
  last45: { start: iso(minusDays(44)), end: iso(now()) }
};

/* ------------------ DOM ------------------ */
const $ = (s) => document.querySelector(s);
const $html = (el, h) => { if (el) el.innerHTML = h; };
const $txt  = (el, t) => { if (el) el.textContent = t; };

const el = {
  // header & counters
  rule: $("#principleBanner"),
  oe: $("#oeCountdown"),
  lastUpdated: $("#lastUpdated"),
  totalCalls: $("#totalCalls"),
  totalAV:    $("#totalAV"),
  totalDeals: $("#totalDeals"),

  // boards (visibility controlled)
  boards: [
    $("#boardLeadVendors"),
    $("#boardAgentOfWeek"),
    $("#boardYTD"),
    $("#boardWeekly")
  ],

  // Vendor board
  vendorCanvas: $("#vendorChart"),
  vendorFallback: $("#vendorChartFallback"),

  // Agent of the Week
  aowName: $("#aowName"),
  aowHead: $("#aowHeadshot"),
  aowWeekAV: $("#aowWeeklyAV"),
  aowYTDAV: $("#aowYTDAV"),
  aowDeals: $("#aowDeals"),

  // YTD
  ytdBody: $("#ytdTable tbody"),

  // Weekly Activity
  actBody: $("#activityTable tbody"),

  // Ticker
  ticker: $("#salesTicker")
};

// Dark / Gold / White (enforce)
document.documentElement.style.setProperty("--bg", "#0E0F12");
document.documentElement.style.setProperty("--fg", "#FFFFFF");
document.documentElement.style.setProperty("--gold", "#FFD700");

/* ------------------ UTILS ------------------ */
const fmt$   = (n) => Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
const fmtInt = (n) => Number(n||0).toLocaleString("en-US");
const fmtHMS = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec||0)));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), r = s%60;
  return `${h}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
};
const byDesc = (k) => (a,b)=> Number(b[k]||0) - Number(a[k]||0);

async function fetchJSON(url, opts) {
  try {
    const r = await fetch(url, { cache:"no-store", ...opts });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { console.error("fetch fail", url, e); return null; }
}

/* ------------------ ROSTER / HEADSHOTS ------------------ */
let ROSTER = new Map(); // normalized name -> filename
const AGENT_ALIAS = {
  "ajani senior":"Ajani",
  "fabricio navarrete cervantes":"Fabricio","fabricio":"Fabricio",
  "philip baxter":"Baxter","baxter":"Baxter",
  "marie saint cyr":"Marie","marie":"Marie",
  "robert adams":"Robert Adams",
  "fraitzline gustave":"Fraitzline",
  "michelle landis":"Michelle Landis"
};
const norm = (s) => (s||"").toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z\s]/g,"").replace(/\s+/g," ").trim();
function buildRosterIndex(data){
  const idx=new Map();
  if (Array.isArray(data)) data.forEach(r=>{
    const name=r?.name||r?.displayName||r?.alias;
    const f=r?.headshot||r?.image||r?.file;
    if (name && f) idx.set(norm(name), f);
  });
  else if (data && typeof data==="object") Object.entries(data).forEach(([k,v])=> idx.set(norm(k), v));
  return idx;
}
function headshotFor(name) {
  const n = norm(name);
  const alias = AGENT_ALIAS[n] ? norm(AGENT_ALIAS[n]) : null;
  const file = ROSTER.get(n) || (alias && ROSTER.get(alias));
  return HEADSHOT(file);
}

/* ------------------ DATA FETCHERS (with layered fallbacks) ------------------ */
async function getSold(start, end) {
  // Try Netlify Function
  let j = await fetchJSON(`${FN.sold}?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
  if (!j) {
    // Try Ringy public
    const body = new URLSearchParams({ apiKey: KEY.SOLD, startDate:start, endDate:end, limit:"5000" });
    j = await fetchJSON(RINGY.sold, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  }
  if (Array.isArray(j)) return j; // function returns array
  if (!j || !Array.isArray(j.data)) return [];
  return j.data.map(x=>({
    agent: x.user_name || x.userName || x.agent || "Unknown",
    vendor: (x.vendor || x.source || "").trim(),
    monthly: Number(x.premium_amount || x.premium || x.amount || 0),
    av: Number(x.premium_amount || x.premium || x.amount || 0) * 12,
    soldAt: x.created_at || x.sold_at || x.date || null
  }));
}

async function getRecordings(start, end) {
  let j = await fetchJSON(`${FN.recordings}?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
  if (!j) {
    const body = new URLSearchParams({ apiKey: KEY.CALL, startDate:start, endDate:end, limit:"5000" });
    j = await fetchJSON(RINGY.recordings, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  }
  if (Array.isArray(j)) return j;
  if (!j || !Array.isArray(j.data)) return [];
  return j.data.map(x=>({
    agent: x.user_name || x.userName || x.agent || "Unknown",
    talkSec: Number(x.talk_time_seconds || x.duration || 0),
    ts: x.created_at || x.date || null
  }));
}

async function getLeads(start, end) {
  let j = await fetchJSON(`${FN.leads}?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
  if (!j) {
    const body = new URLSearchParams({ apiKey: KEY.LEADS, startDate:start, endDate:end, limit:"5000" });
    j = await fetchJSON(RINGY.leads, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  }
  if (j && Array.isArray(j.data)) return j.data.map(x=>({ agent: x.user_name || x.owner || "Unknown", createdAt: x.created_at || x.date || null }));
  const ov = await fetchJSON(`${DOMAIN}/leads_week_override.json`);
  return Array.isArray(ov) ? ov.map(x=>({ agent:x.agent, createdAt:x.createdAt })) : [];
}

/* ------------------ AGGREGATION ------------------ */
function normalizeVendor(label="") {
  const k = label.toLowerCase().trim();
  if (VENDOR_ALIAS[k]) return VENDOR_ALIAS[k];
  const hit = VENDORS.find(v => v.toLowerCase() === k);
  return hit || label.trim();
}
function vendorCountsLast45(sales=[]) {
  const counts = Object.fromEntries(VENDORS.map(v=>[v,0]));
  for (const s of sales) {
    const v = normalizeVendor(s.vendor || "");
    if (counts.hasOwnProperty(v)) counts[v] += 1;
  }
  return counts;
}

function aggSoldByAgent(sales){
  const m=new Map();
  for(const s of sales){
    const k = s.agent || "Unknown";
    const r = m.get(k) || { agent:k, deals:0, weekAV:0 };
    r.deals += 1; r.weekAV += Number(s.av||0);
    m.set(k,r);
  }
  return [...m.values()];
}
function aggCallsByAgent(recs){
  const m=new Map();
  for(const r of recs){
    const k = r.agent || "Unknown";
    const t = r.ts ? new Date(r.ts).getTime() : null;
    const a = m.get(k) || { agent:k, calls:0, talkSec:0, first:null, last:null };
    a.calls += 1; a.talkSec += Number(r.talkSec||0);
    if (t){ a.first=(a.first==null||t<a.first)?t:a.first; a.last=(a.last==null||t>a.last)?t:a.last; }
    m.set(k,a);
  }
  return [...m.values()].map(x=>({ agent:x.agent, calls:x.calls, talkSec:x.talkSec, loggedSec: x.first&&x.last ? Math.max(0,(x.last-x.first)/1000) : 0 }));
}
function aggLeadsByAgent(leads){
  const m=new Map();
  for(const l of leads){
    const k = l.agent || "Unknown";
    m.set(k, (m.get(k)||0) + 1);
  }
  return [...m.entries()].map(([agent,leads])=>({ agent, leads }));
}
function joinWeekMetrics(soldAgg, callAgg, leadAgg){
  const m=new Map();
  for(const a of soldAgg) m.set(a.agent,{ agent:a.agent, deals:a.deals, weekAV:a.weekAV, calls:0, talkSec:0, loggedSec:0, leads:0 });
  for(const c of callAgg){
    const r = m.get(c.agent) || { agent:c.agent, deals:0, weekAV:0, calls:0, talkSec:0, loggedSec:0, leads:0 };
    r.calls += c.calls; r.talkSec += c.talkSec; r.loggedSec = Math.max(r.loggedSec, c.loggedSec);
    m.set(c.agent,r);
  }
  for(const l of leadAgg){
    const r = m.get(l.agent) || { agent:l.agent, deals:0, weekAV:0, calls:0, talkSec:0, loggedSec:0, leads:0 };
    r.leads += l.leads; m.set(l.agent,r);
  }
  return [...m.values()].map(r => ({ ...r, conv: r.leads ? (r.deals/r.leads) * 100 : 0 }));
}

/* ------------------ RENDERERS ------------------ */
function renderRuleOfDay(){
  if (!el.rule) return;
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  const idx = daysSinceEpoch % PRINCIPLES.length; // one rule per day, globally stable
  $txt(el.rule, `${RULE_PREFIX} • ${PRINCIPLES[idx]}`);
  // Update after midnight (check hourly)
  setInterval(renderRuleOfDay, 60*60*1000);
}

function renderCountdown(){
  if (!el.oe) return;
  const tick = ()=>{
    const d = OE_TARGET - new Date();
    if (d <= 0) return $txt(el.oe, "OPEN ENROLLMENT IS LIVE");
    const days=Math.floor(d/86400000), hrs=Math.floor((d%86400000)/3600000),
          mins=Math.floor((d%3600000)/60000), secs=Math.floor((d%60000)/1000);
    $txt(el.oe, `${days}d ${String(hrs).padStart(2,"0")}h ${String(mins).padStart(2,"0")}m ${String(secs).padStart(2,"0")}s`);
  };
  tick(); setInterval(tick, 1000);
}

function renderTiles(rows){
  const totalCalls = rows.reduce((a,x)=>a+Number(x.calls||0),0);
  const totalDeals = rows.reduce((a,x)=>a+Number(x.deals||0),0);
  const totalAV    = rows.reduce((a,x)=>a+Number(x.weekAV||0),0);
  $txt(el.totalCalls, fmtInt(totalCalls));
  $txt(el.totalDeals, fmtInt(totalDeals));
  $txt(el.totalAV,    fmt$(totalAV));
}

function renderVendorBoard(counts){
  const labels = VENDORS;
  const values = labels.map(l=>counts[l]||0);
  const total  = values.reduce((a,b)=>a+b,0) || 1;
  const pct    = values.map(v => Math.round((v/total)*1000)/10);

  if (el.vendorCanvas && window.Chart){
    if (el.vendorCanvas._chart) el.vendorCanvas._chart.destroy();
    el.vendorCanvas._chart = new Chart(el.vendorCanvas.getContext("2d"), {
      type: "doughnut",
      data: { labels, datasets: [{ data: values }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "60%",
        plugins: {
          legend: {
            position: "right",
            labels: { generateLabels(chart){
              return labels.map((l,i)=>({
                text: `${l}  ${pct[i]}%`,
                fillStyle: chart._metasets?.[0]?.controller?.getStyle(i)?.backgroundColor,
                strokeStyle: "transparent", lineWidth: 0, index: i
              }));
            }}
          },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} (${pct[ctx.dataIndex]}%)` } }
        }
      }
    });
    if (el.vendorFallback) $html(el.vendorFallback, "");
  } else if (el.vendorFallback){
    const rows = labels.map((l,i)=>`<tr><td>${l}</td><td>${values[i]}</td><td>${pct[i]}%</td></tr>`).join("");
    $html(el.vendorFallback, `<table class="text-sm"><thead><tr><th>Vendor</th><th>#</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
}

function renderAgentOfWeek(weekRows, ytdAgg){
  if (!el.aowName) return;
  const top = [...weekRows].sort(byDesc("weekAV"))[0];
  if (!top){ $txt(el.aowName,"—"); return; }
  const ytd = (ytdAgg||[]).find(x => (x.agent||x.name) === top.agent);
  $txt(el.aowName, top.agent);
  if (el.aowHead){ el.aowHead.src = headshotFor(top.agent); el.aowHead.onerror = ()=>{ el.aowHead.src = HEADSHOT("default.png"); }; }
  $txt(el.aowWeekAV, fmt$(top.weekAV));
  $txt(el.aowDeals,  fmtInt(top.deals));
  $txt(el.aowYTDAV,  fmt$(ytd?.av || ytd?.value || 0));
}

function renderYTDLeaders(ytdAgg){
  if (!el.ytdBody) return;
  const rows = [...ytdAgg].sort(byDesc("av")).map(r=>`
    <tr>
      <td class="agent">
        <img class="h-8 w-8 rounded-full mr-2" src="${headshotFor(r.agent||r.name)}" onerror="this.src='${HEADSHOT("default.png")}'" alt="${r.agent||r.name}">
        ${r.agent||r.name}
      </td>
      <td class="metric">${fmt$(r.av)}</td>
    </tr>`).join("");
  $html(el.ytdBody, rows || `<tr><td colspan="2">No data</td></tr>`);
}

function renderActivity(weekRows){
  if (!el.actBody) return;
  const rows = [...weekRows].sort(byDesc("weekAV")).map(r=>{
    const poop = (r.deals===0 && (r.calls<20 || r.talkSec<600)) ? " 💩" : "";
    return `<tr>
      <td class="agent">
        <img class="h-8 w-8 rounded-full mr-2" src="${headshotFor(r.agent)}" onerror="this.src='${HEADSHOT("default.png")}'" alt="${r.agent}">
        ${r.agent}${poop}
      </td>
      <td>${fmtInt(r.calls)}</td>
      <td>${fmtHMS(r.talkSec)}</td>
      <td>${fmtHMS(r.loggedSec)}</td>
      <td>${fmtInt(r.leads)}</td>
      <td>${fmtInt(r.deals)}</td>
      <td>${(r.conv||0).toFixed(1)}%</td>
      <td>${fmt$(r.weekAV)}</td>
    </tr>`;
  }).join("");
  $html(el.actBody, rows || `<tr><td colspan="8">No activity</td></tr>`);
}

function renderTicker(sold){
  if (!el.ticker) return;
  const items = sold.slice().sort((a,b)=>new Date(b.soldAt||0)-new Date(a.soldAt||0)).slice(0,60)
    .map(s=>`<span class="mr-8"><strong>${s.agent}</strong> • ${fmt$(s.av)} • <em>${normalizeVendor(s.vendor)||"—"}</em></span>`);
  $html(el.ticker, items.join(""));
}

/* ------------------ BOARD ROTATION ------------------ */
let boardIdx = 0;
function showBoard(i){
  el.boards.forEach((b,idx)=>{ if (!b) return; b.style.display = (idx===i) ? "block" : "none"; });
}
function startBoardRotation(){
  const liveBoards = el.boards.filter(Boolean);
  if (!liveBoards.length) return;
  showBoard(boardIdx);
  setInterval(()=>{ boardIdx = (boardIdx + 1) % liveBoards.length; showBoard(boardIdx); }, BOARD_ROTATE_MS);
}

/* ------------------ MAIN ------------------ */
async function boot(){
  // Rule of the day: ONE banner only
  const banners = [...document.querySelectorAll("#principleBanner")];
  if (banners.length > 1) banners.slice(1).forEach(n=>n.remove());
  renderRuleOfDay();
  renderCountdown();

  // Placeholders so UI never looks dead
  if (el.ytdBody) $html(el.ytdBody, `<tr><td colspan="2">Loading…</td></tr>`);
  if (el.actBody) $html(el.actBody, `<tr><td colspan="8">Loading…</td></tr>`);
  if (el.vendorFallback) $html(el.vendorFallback, "Loading…");
  if (el.ticker) $html(el.ticker, `<span>Loading…</span>`);

  // Roster for headshots
  const roster = await fetchJSON(ROSTER_URL) || [];
  ROSTER = buildRosterIndex(roster);

  // Pull data: week + last45 + YTD override
  const [soldWeek, recWeek, leadsWeek, sold45, ytdOverride] = await Promise.all([
    getSold(RANGE.week.start, RANGE.week.end),
    getRecordings(RANGE.week.start, RANGE.week.end),
    getLeads(RANGE.week.start, RANGE.week.end),
    getSold(RANGE.last45.start, RANGE.last45.end),
    fetchJSON(`${DOMAIN}/ytd_av.json`)
  ]);

  // Weekly aggregates & tiles
  const weekRows   = joinWeekMetrics(aggSoldByAgent(soldWeek), aggCallsByAgent(recWeek), aggLeadsByAgent(leadsWeek));
  renderTiles(weekRows);

  // Boards
  renderVendorBoard(vendorCountsLast45(sold45));

  const ytdAgg = Array.isArray(ytdOverride) ? ytdOverride.map(x=>({ agent:x.name, av:Number(x.av||0) })) : [];
  renderAgentOfWeek(weekRows, ytdAgg);
  renderYTDLeaders(ytdAgg);
  renderActivity(weekRows);

  // Ticker
  renderTicker(soldWeek);

  // Board rotation (every 30s)
  startBoardRotation();

  // Timestamp
  $txt(el.lastUpdated, new Date().toLocaleString("en-US",{hour12:true}));
}

/* ------------------ STARTUP ------------------ */
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
