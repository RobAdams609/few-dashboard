<script>
/* ==================== FEW Dashboard — Single File Overwrite ==================== */
/* Last updated: 2025-10-22 */

/* ------------------------------- Config ------------------------------- */
"use strict";

const BASE          = ""; // same-origin
const ET_TZ         = "America/New_York";
const REFRESH_MS    = 30_000;     // refresh data every 30s
const ROTATE_MS     = 30_000;     // rotate views every 30s
const VIEWS         = ["weekly_av","agent_week","vendors_45d","activity"]; // 4 boards
const SPLASH_MS     = 60_000;     // flash a new sale for 60s
const RULES_PATH    = "/rules.json";
const ROSTER_PHOTOS = "/headshots/roster.json";
const TEAM_SOLD     = "/api/team_sold";        // sold & per-agent AV
const CALLS_AGENT   = "/api/calls_by_agent";   // calls/talk/logged/leads/sold
const YTD_AV_JSON   = "/ytd_av.json";
const YTD_TOT_JSON  = "/ytd_total.json";

/* -------------------------- Small DOM helpers ------------------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"]/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const money = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const bust = u => u + (u.includes("?")?"&":"?") + "_=" + Date.now();

/* --------------------------- Formatting utils ------------------------- */
const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtPct   = n => (n==null?"—":(Math.round((Number(n||0))*1000)/10).toFixed(1)+"%");
const pad2     = n => String(n).padStart(2,"0");
const hmm      = mins => { const m=Math.max(0,Math.round(mins||0)); return `${Math.floor(m/60)}:${pad2(m%60)}`; };
const toET     = d => new Date(new Date(d).toLocaleString("en-US",{timeZone:ET_TZ}));

/* ----------------------------- Safe fetch ----------------------------- */
async function getJSON(path){
  const url = path.startsWith("http") ? path : bust(BASE + path);
  try{
    const r = await fetch(url, { cache:"no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }catch(e){
    console.warn("getJSON fail:", path, e?.message || e);
    return null;
  }
}

/* --------------------------- Layout targets --------------------------- */
const hdrRule   = $("#rule");
const hdrBonus  = $("#bonus");
const cards     = $$("#cards .card .value");
const thead     = $("#thead");
const tbody     = $("#tbody");

/* Expecting the HTML to have:
  <div id="rule"></div>
  <div id="bonus">Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.</div>
  <div id="cards">... three .card with .value elements ...</div>
  <table><thead id="thead"></thead><tbody id="tbody"></tbody></table>
  <div id="splash" class="hidden"></div>
*/

/* --------------------------- State & caches --------------------------- */
let viewIdx = 0;
let lastTeamSold = null;          // cached /api/team_sold
let lastCalls = null;             // cached /api/calls_by_agent
let rosterPhotos = [];            // from /headshots/roster.json
let ytdTotals = { list:[], total:0 };
let rotatingTimer = null;
let refreshTimer = null;

/* For splash dedupe across refreshes */
const SEEN_KEY = "few_seen_sales_v1";

/* ----------------------- Rule of the Day (daily) ---------------------- */
async function renderRule(){
  const rules = await getJSON(RULES_PATH) || [];
  if (!Array.isArray(rules) || rules.length === 0){
    hdrRule.textContent = "RULE OF THE DAY — …";
    return;
  }
  // Deterministic daily selection (ET)
  const today = toET(new Date());
  const dayKey = Math.floor(+today/86_400_000);
  const rule = rules[ dayKey % rules.length ];
  hdrRule.textContent = rule.toUpperCase();
  hdrRule.style.fontWeight = "800";
  hdrRule.style.textAlign  = "center";
}

/* --------------------------- Headshots utils -------------------------- */
function initialsFrom(name){
  return String(name||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
}
function photoFor(nameOrEmail){
  // rosterPhotos: [{name,email,photo}]
  const key = String(nameOrEmail||"").trim().toLowerCase();
  const hit = rosterPhotos.find(p =>
    (p.email && p.email.toLowerCase()===key) ||
    (p.name  && p.name.toLowerCase()===key)
  );
  if (hit && hit.photo) return `/headshots/${hit.photo}`;
  return null;
}
function avatarHTML(name,email, big=false){
  const src = photoFor(email||name);
  const label = esc(name||"");
  const cls = big ? "avatar avatar-big" : "avatar";
  if (src){
    return `<img class="${cls}" alt="${label}" src="${src}">`;
  }else{
    return `<span class="${cls} avatar-fallback">${initialsFrom(name)}</span>`;
  }
}

/* ----------------------- Vendor Buckets (45 days) --------------------- */
const KNOWN_VENDORS = [
  "$7.50","George Region Shared","Red Media","Blast/Bulk","Exclusive JUMBO","ABC","Shared Jumbo",
  "VS Default","RKA Website","Redrip/Give up Purchased","Lamy Dynasty Specials","JUMBO Splits",
  "Exclusive 30s","Positive Intent/Argos","HotLine Bling","Referral","CG Exclusive","TTM Nice!"
];
function normalizeVendor(name){
  const n = String(name||"Unknown").trim();
  // direct hit
  if (KNOWN_VENDORS.includes(n)) return n;
  // loose groupings
  if (/red\s*media/i.test(n)) return "Red Media";
  if (/exclusive/i.test(n) && /jumbo/i.test(n)) return "Exclusive JUMBO";
  if (/shared/i.test(n) && /jumbo/i.test(n)) return "Shared Jumbo";
  if (/referral/i.test(n)) return "Referral";
  return "Unknown";
}

/* --------------------------- Splash for sales ------------------------- */
function getSeenSet(){
  try{
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr)?arr:[]);
  }catch{ return new Set(); }
}
function saveSeenSet(set){
  try{
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set)));
  }catch{}
}
function showSplash(agent, amountMonthly){
  const splash = $("#splash");
  if (!splash) return;
  const av12 = Math.round(Number(amountMonthly||0)*12);
  splash.innerHTML = `
    <div class="splash-inner">
      <div class="splash-title">NEW SALE!</div>
      <div class="splash-agent">${esc(agent)}</div>
      <div class="splash-av">${money(av12)}</div>
    </div>
  `;
  splash.classList.remove("hidden");
  setTimeout(()=> splash.classList.add("hidden"), SPLASH_MS);
}
function scanForNewSales(sold){
  if (!sold || !Array.isArray(sold.allSales)) return;
  const seen = getSeenSet();
  let anyNew = false;
  sold.allSales.forEach(s=>{
    const id = String(s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.amount}`);
    if (!seen.has(id)){
      // only splash truly new sales in the last 2 minutes to avoid spamming old history
      const when = new Date(s.dateSold||Date.now());
      if (Date.now() - +when < 2*60*1000){
        showSplash(s.agent, s.amount);
        anyNew = true;
      }
      seen.add(id);
    }
  });
  if (anyNew) saveSeenSet(seen);
}

/* ------------------------------ Boards ------------------------------- */
function setCards({ calls=0, submittedAV=0, deals=0 }={}){
  // Expect 3 cards in order: Calls, Total Submitted AV, Deals
  if (cards[0]) cards[0].textContent = fmtInt(calls);
  if (cards[1]) cards[1].textContent = money(submittedAV);
  if (cards[2]) cards[2].textContent = fmtInt(deals);
}

/* 1) Weekly Submitted AV (renamed Roster) */
function renderWeeklyAV(sold){
  const team = sold?.team || {};
  const per  = sold?.perAgent || [];
  setCards({
    calls: 0, // unknown here
    submittedAV: Math.round(Number(team.totalAV12x||0)),
    deals: Number(team.totalSales||0)
  });

  thead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;
  const rows = per.map(a=>{
    return `
      <tr>
        <td class="agent">
          ${avatarHTML(a.name, a.email)}
          <span>${esc(a.name||"")}</span>
        </td>
        <td class="num">${fmtInt(a.sales||0)}</td>
        <td class="num">${money(a.av12x||0)}</td>
      </tr>`;
  }).join("");
  tbody.innerHTML = rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No sales found.</td></tr>`;
}

/* 2) Agent of the Week */
function renderAgentOfWeek(sold){
  const per = sold?.perAgent || [];
  const lead = [...per].sort((a,b)=>(b.av12x||0)-(a.av12x||0))[0];
  setCards({
    calls: 0,
    submittedAV: Math.round(Number(sold?.team?.totalAV12x||0)),
    deals: Number(sold?.team?.totalSales||0)
  });

  thead.innerHTML = `
    <tr>
      <th>Agent of the Week</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;
  if (!lead){
    tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No leader yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = `
    <tr>
      <td class="agent">
        ${avatarHTML(lead.name, lead.email, true)}
        <div class="lead-wrap">
          <div class="lead-name">${esc(lead.name)}</div>
          <div class="lead-sub">Leading for Agent of the Week</div>
        </div>
      </td>
      <td class="num">${fmtInt(lead.sales||0)}</td>
      <td class="num">${money(lead.av12x||0)}</td>
    </tr>`;
}

/* 3) Lead Vendors — % of Sales (45 days) */
function renderVendors(sold){
  // We’ll compute shares by soldProductName over allSales
  const all = sold?.allSales || [];
  // Only keep last 45 days (server should do this, but double-guard)
  const now = Date.now();
  const cutoff = now - 45*24*60*60*1000;
  const bucket = new Map();
  let count = 0;
  all.forEach(s=>{
    const when = +new Date(s.dateSold||now);
    if (when >= cutoff){
      const key = normalizeVendor(s.soldProductName);
      bucket.set(key, (bucket.get(key)||0)+1);
      count++;
    }
  });
  setCards({
    calls: 0,
    submittedAV: Math.round(Number(sold?.team?.totalAV12x||0)),
    deals: Number(sold?.team?.totalSales||0)
  });

  thead.innerHTML = `<tr><th>Lead Vendors — % of Sales (Last 45 days)</th><th class="num">Count</th><th class="num">Share</th></tr>`;
  if (count===0){
    tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`;
    return;
  }
  const rows = [...bucket.entries()]
      .sort((a,b)=>b[1]-a[1])
      .map(([name,c])=>{
        const pct = c / count;
        return `<tr>
          <td>${esc(name)}</td>
          <td class="num">${fmtInt(c)}</td>
          <td class="num">${fmtPct(pct)}</td>
        </tr>`;
      }).join("");
  tbody.innerHTML = rows;
}

/* 4) Agent Activity (calls/talk/logged/leads/sold/conv) */
function renderActivity(callsData){
  const team = callsData?.team || {};
  const per  = callsData?.perAgent || [];

  thead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th class="num">Calls</th>
      <th class="num">Talk (min)</th>
      <th class="num">Logged (h:mm)</th>
      <th class="num">Leads</th>
      <th class="num">Sold</th>
      <th class="num">Conv %</th>
    </tr>`;

  // Fallback rows (when API returns empty)
  const rows = (per.length ? per : []).map(a=>{
    const calls = Number(a.calls||0);
    const leads = Number(a.leads||0);
    const sold  = Number(a.sold||0);
    const conv  = leads>0 ? (sold/leads) : null;

    return `<tr>
      <td class="agent">
        ${avatarHTML(a.name, a.email)}
        <span>${esc(a.name||"")}</span>
      </td>
      <td class="num">${fmtInt(calls)}</td>
      <td class="num">${fmtInt(a.talkMin||0)}</td>
      <td class="num">${hmm(a.loggedMin||0)}</td>
      <td class="num">${fmtInt(leads)}</td>
      <td class="num">${fmtInt(sold)}</td>
      <td class="num">${conv==null?"—":fmtPct(conv)}</td>
    </tr>`;
  }).join("");

  tbody.innerHTML = rows || `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">No call data this week.</td></tr>`;

  setCards({
    calls: Number(team.calls||0),
    submittedAV: 0,
    deals: Number(team.sold||0)
  });
}

/* --------------------------- View switching --------------------------- */
function renderView(){
  const id = VIEWS[viewIdx % VIEWS.length];
  // Title text under banner
  const title = $("#viewTitle");
  if (title){
    title.textContent =
      id==="weekly_av" ? "This Week — Weekly Submitted AV" :
      id==="agent_week" ? "This Week — Roster" :
      id==="vendors_45d" ? "Lead Vendors — % of Sales (Last 45 days)" :
      id==="activity" ? "Agent Activity" : "";
  }

  if (id==="weekly_av")       renderWeeklyAV(lastTeamSold);
  else if (id==="agent_week") renderAgentOfWeek(lastTeamSold);
  else if (id==="vendors_45d")renderVendors(lastTeamSold);
  else if (id==="activity")   renderActivity(lastCalls);
}

function startRotation(){
  if (rotatingTimer) clearInterval(rotatingTimer);
  rotatingTimer = setInterval(()=>{
    viewIdx = (viewIdx + 1) % VIEWS.length;
    renderView();
  }, ROTATE_MS);
}

/* --------------------------- Data refreshing -------------------------- */
async function refreshAll(){
  // parallel fetches
  const [photos, sold, calls, ytdList, ytdTotal] = await Promise.all([
    rosterPhotos.length ? Promise.resolve(rosterPhotos) : getJSON(ROSTER_PHOTOS),
    getJSON(TEAM_SOLD),
    getJSON(CALLS_AGENT),
    getJSON(YTD_AV_JSON),
    getJSON(YTD_TOT_JSON)
  ]);

  if (Array.isArray(photos)) rosterPhotos = photos;
  if (sold) {
    lastTeamSold = sold;
    scanForNewSales(sold);
  }
  if (calls) lastCalls = calls;

  // store YTD in case you add a YTD board later
  ytdTotals.list  = Array.isArray(ytdList) ? ytdList : [];
  ytdTotals.total = Number((ytdTotal&&ytdTotal.total)||0);

  renderView();
}

function startRefresher(){
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, REFRESH_MS);
}

/* ------------------------------ Boot ------------------------------- */
(async function boot(){
  // Style the header pieces
  await renderRule();
  hdrBonus.textContent = "Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.";

  await refreshAll();
  startRotation();
  startRefresher();
})();

/* ------------------------------ Styles ------------------------------- */
/* (these assume your CSS file already has base classes; these just ensure
   the new pieces look right if not defined) */
const css = `
  #rule{font-size:28px;margin:8px 0 0;letter-spacing:.5px}
  #bonus{opacity:.9;margin:6px 0 18px;text-align:center}
  .agent{display:flex;align-items:center;gap:10px}
  .avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;background:#2a3340;color:#cbd5e1;display:inline-flex;align-items:center;justify-content:center;font-weight:700}
  .avatar-big{width:56px;height:56px;font-size:18px}
  .avatar-fallback{border:1px solid #394455}
  .num{text-align:right}
  .lead-wrap{display:flex;flex-direction:column}
  .lead-name{font-weight:700}
  .lead-sub{font-size:12px;color:#8aa0b8;margin-top:2px}
  #splash{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:9999;backdrop-filter: blur(2px)}
  #splash.hidden{display:none}
  .splash-inner{background:linear-gradient(180deg,#1d1f24,#0f1115);border:2px solid #f3e39a;padding:32px 40px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.6);text-align:center}
  .splash-title{color:#f3e39a;font-size:14px;letter-spacing:4px;margin-bottom:8px}
  .splash-agent{color:white;font-size:28px;font-weight:800;margin-bottom:6px}
  .splash-av{color:#f3e39a;font-size:36px;font-weight:900}
`;
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);
</script>
