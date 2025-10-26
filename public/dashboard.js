/* ==================== FEW — FULL DASHBOARD (Single File) ==================== */
/* Permanent rules implemented:
   - Single banner + Rule of the Day (12h rotation)
   - 6 rotating boards (30s): Weekly AV, AOTW, Vendors(45d), Activity, YTD, PAR
   - Live Ringy APIs (absolute URLs), fallbacks, and robust vendor normalization
   - Gold "NEW SALE" centered modal (no x12 shown), holds 60s
   - Headshots from /headshots/, roster from /headshots/roster.json
*/
"use strict";

/* ------------------------ Config ------------------------ */
const BASE = "https://few-dashboard-live.netlify.app"; // live absolute base
const ET_TZ = "America/New_York";

const ROTATE_MS = 30_000;
const ROTATE_ORDER = ["weekly_av", "aotw", "vendors", "activity", "ytd", "par"]; // 6 boards
const RULE_ROTATE_HOURS = 12;

const PERMANENT_VENDORS = [
  "$7.50","George Region Shared","Red Media","Blast/Bulk","Exclusive JUMBO","ABC",
  "Shared Jumbo","VS Default","RKA Website","Redrip/Give up Purchased",
  "Lamy Dynasty Specials","JUMBO Splits","Exclusive 30s","Positive Intent/Argos",
  "HotLine Bling","Referral","CG Exclusive","TTM Nice!"
];

/* ------------------------ DOM helpers ------------------------ */
const $ = (s) => document.querySelector(s);
const byId = (id) => document.getElementById(id);
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* ------------------------ Formatting ------------------------ */
const fmtInt = (n) => Number(n || 0).toLocaleString("en-US");
const fmtMoney = (n) => "$" + Number(Math.round(Number(n || 0))).toLocaleString("en-US");
const pct = (num, den) => (den > 0 ? (Math.round((num/den)*1000)/10).toFixed(1)+"%" : "—");
const pad2 = (n) => String(n).padStart(2,"0");
const minutesToHMM = (m) => {
  const mm = Math.max(0, Math.round(Number(m||0)));
  const h = Math.floor(mm/60), r = mm % 60;
  return `${h}:${pad2(r)}`;
};
const initials = (name) => String(name||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();

/* ------------------------ Fetch (resilient) ------------------------ */
function cacheBust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(urlAbs){
  const u = cacheBust(urlAbs);
  const r = await fetch(u, { cache:"no-store" });
  if (!r.ok) throw new Error(`${urlAbs} ${r.status}`);
  return r.json();
}
async function getAPI(path){ // tries /api first, then /.netlify/functions
  const primary = `${BASE}/api/${path}`;
  const secondary = `${BASE}/.netlify/functions/${path}`;
  try { return await getJSON(primary); } catch { return await getJSON(secondary); }
}

/* ------------------------ Time (ET) ------------------------ */
function toETDate(d = new Date()){
  return new Date(d.toLocaleString("en-US",{ timeZone: ET_TZ }));
}
function thisEtWeekWindow(){ // Fri 00:00 ET to next Fri 00:00 ET
  const now = toETDate();
  const dow = now.getDay(); // Sun=0..Sat=6
  const sinceFri = (dow + 2) % 7; // Fri => 0
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-sinceFri);
  const end = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];
}

/* ------------------------ State ------------------------ */
const STATE = {
  viewIndex: 0,
  roster: [],             // [{name,email,photo,phones}]
  rules: [],              // ["rule line", ...]
  ytd: [],                // [{name,av}]
  ytdTotal: 0,            // number
  par: [],                // [{name, note?}] manual override
  // Weekly merged
  weekly: {
    per: new Map(),       // key -> {name,email,calls,talkMin,loggedMin,leads,sold,weeklyDeals,weeklyAV}
    team: { calls:0, talkMin:0, deals:0, av:0, leads:0, sold:0 }
  },
  vendors: { as_of:"", window_days:45, byName: new Map(), totalDeals:0 },
  lastSaleSnapshot: new Map(), // agent -> {deals,av}
  seenHashes: new Set()
};

function agentKeyFromName(n){ return String(n||"").trim().toLowerCase(); }

/* ------------------------ Headshots ------------------------ */
function avatarHTML(name, photo){
  const src = photo ? `${BASE}/headshots/${photo}` : "";
  const fallback = `<div class="avatar-fallback">${initials(name)}</div>`;
  if (!photo) return `<div class="agent"><div class="avatar">${fallback}</div><span>${escapeHTML(name)}</span></div>`;
  return `<div class="agent">
    <img class="avatar" src="${src}" alt="" onerror="this.replaceWith(this.closest('.agent').querySelector('.avatar-fallback')||document.createElement('div'))">
    <span>${escapeHTML(name)}</span>
    <div class="avatar-fallback" style="display:none">${initials(name)}</div>
  </div>`;
}
function bigHeadshotHTML(name, photo){
  const src = photo ? `${BASE}/headshots/${photo}` : "";
  const fallback = `<div class="avatar-fallback" style="width:96px;height:96px;font-size:32px">${initials(name)}</div>`;
  return src
    ? `<img src="${src}" alt="" style="width:96px;height:96px;border-radius:50%;object-fit:cover"
         onerror="this.replaceWith(document.createRange().createContextualFragment('${fallback.replace(/'/g,"&#39;")}'))">`
    : fallback;
}

/* ------------------------ Single Banner Rule (12h rotation) ------------------------ */
function startRuleOfDay(){
  const el = byId("ruleText");
  if (!el || STATE.rules.length === 0) return;
  const period = RULE_ROTATE_HOURS*3600*1000;
  function show(){
    const now = Date.now();
    const idx = Math.floor(now/period) % STATE.rules.length;
    el.textContent = STATE.rules[idx] || "";
  }
  show();
  setInterval(show, 60_000); // recompute index each minute
}

/* ------------------------ NEW SALE Modal (centered, gold) ------------------------ */
(function ensureSaleModal(){
  if (!byId("saleOverlay")) {
    const style = document.createElement("style");
    style.textContent = `
      #saleOverlay{position:fixed;inset:0;display:none;place-items:center;z-index:99999;background:rgba(0,0,0,.35);backdrop-filter:blur(2px)}
      #saleOverlay.show{display:grid}
      .sale-card{min-width:520px;max-width:90vw;text-align:center;padding:28px 32px;border-radius:18px;background:#0b0f15;border:3px solid #ffd36a;box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 42px rgba(255,211,106,.35);color:#ffd36a;animation:ringPulse 2s infinite}
      .sale-badge{font-weight:800;letter-spacing:.18em;font-size:12px;margin-bottom:10px;opacity:.9;display:inline-block;background:#ffd36a;color:#0b0f15;padding:6px 10px;border-radius:999px}
      .sale-name{font-weight:900;font-size:40px;line-height:1.05}
      .sale-amount{margin-top:8px;font-weight:900;font-size:28px;color:#cfd7e3}
      .sale-countdown{margin-top:10px;font-size:12px;color:#c9d3e5;opacity:.8}
      @keyframes ringPulse{0%{box-shadow:0 0 0 0 rgba(255,211,106,.45)}70%{box-shadow:0 0 0 20px rgba(255,211,106,0)}100%{box-shadow:0 0 0 0 rgba(255,211,106,0)}}
    `;
    document.head.appendChild(style);
    const host = document.createElement("div"); host.id="saleOverlay";
    host.addEventListener("click", ()=> hideSaleOverlay());
    document.body.appendChild(host);
  }
})();
let saleHideTimer = null;
function showSaleOverlay(agentName, avAmount){
  const host = byId("saleOverlay"); if (!host) return;
  host.innerHTML = `
    <div class="sale-card" role="dialog" aria-label="New sale">
      <div class="sale-badge">NEW SALE</div>
      <div class="sale-name">${escapeHTML(agentName||"")}</div>
      <div class="sale-amount">${fmtMoney(Number(avAmount||0))}</div>
      <div class="sale-countdown" id="saleCountdown">closes in 60s</div>
    </div>`;
  host.classList.add("show");
  if (saleHideTimer) clearTimeout(saleHideTimer);
  let left = 60;
  const tick = setInterval(()=>{
    left -= 1;
    const cd = byId("saleCountdown");
    if (cd) cd.textContent = `closes in ${left}s`;
    if (left <= 0){ clearInterval(tick); hideSaleOverlay(); }
  }, 1000);
  saleHideTimer = setTimeout(()=>{ clearInterval(tick); hideSaleOverlay(); }, 60_000);
}
function hideSaleOverlay(){
  const host = byId("saleOverlay"); if (!host) return;
  host.classList.remove("show"); host.innerHTML = "";
}

/* ------------------------ Vendor normalization ------------------------ */
function normalizeVendorName(raw){
  if (!raw) return "Unknown";
  const s = String(raw).trim();
  // exact name if in permanent list
  if (PERMANENT_VENDORS.includes(s)) return s;
  const key = s.toLowerCase();
  // loose maps
  const map = [
    [/positive/i, "Positive Intent/Argos"],
    [/argos/i, "Positive Intent/Argos"],
    [/hot ?line/i, "HotLine Bling"],
    [/jumbo/i, /exclusive/i, "Exclusive JUMBO"],
    [/shared.*jumbo/i, "Shared Jumbo"],
    [/vs/i, "VS Default"],
    [/abc/i, "ABC"],
    [/red\s?media/i, "Red Media"],
    [/blast|bulk/i, "Blast/Bulk"],
    [/referr/i, "Referral"],
    [/website|rka/i, "RKA Website"],
    [/default/i, "VS Default"],
    [/30s|30 sec/i, "Exclusive 30s"],
    [/split/i, "JUMBO Splits"],
    [/lamy/i, "Lamy Dynasty Specials"],
    [/redrip|give up/i, "Redrip/Give up Purchased"],
    [/\$?\s*7\.?50/, "$7.50"],
    [/ttm|nice/i, "TTM Nice!"]
  ];
  for (const rule of map){
    if (rule.length === 3){
      if (rule[0].test(key) && rule[1].test(key)) return rule[2];
    } else {
      if (rule[0].test(key)) return rule[1];
    }
  }
  return "Unknown";
}

/* ------------------------ Load static (roster, rules, overrides) ------------------------ */
async function loadStatic(){
  const [rosterRaw, rulesRaw, ytdList, ytdTotal, parRaw] = await Promise.all([
    getJSON(`${BASE}/headshots/roster.json`).catch(()=>[]),
    getJSON(`${BASE}/rules.json`).catch(()=>[]),
    getJSON(`${BASE}/ytd_av.json`).catch(()=>[]),
    getJSON(`${BASE}/ytd_total.json`).catch(()=>({ ytd_av_total: 0 })),
    getJSON(`${BASE}/par_override.json`).catch(()=>[])
  ]);

  // roster can be {agents:[]} or []
  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents
              : Array.isArray(rosterRaw) ? rosterRaw : [];
  STATE.roster = list.map(a => ({
    name: a.name || "",
    email: String(a.email||"").trim().toLowerCase(),
    photo: a.photo || "",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  STATE.rules = Array.isArray(rulesRaw) ? rulesRaw.filter(Boolean) : [];

  const ytdRows = Array.isArray(ytdList) ? ytdList : [];
  STATE.ytd = ytdRows.map(r => ({ name: r.name || "", av: Number(r.av || r.ytd_av || 0), photo: r.photo || "" }))
                     .sort((a,b)=> b.av - a.av);
  STATE.ytdTotal = Number(ytdTotal?.ytd_av_total || 0);

  const parList = Array.isArray(parRaw) ? parRaw : (Array.isArray(parRaw?.list) ? parRaw.list : []);
  STATE.par = parList.map(x => ({ name: x.name || x.agent || "", note: x.note || "" }));
}

/* ------------------------ Live APIs (weekly) ------------------------ */
async function loadWeekly(){
  // Sales (ET week) with per-sale where available
  let sales = null;
  try { sales = await getAPI("team_sold"); } catch { sales = null; }

  // Calls (ET week) with agent-level stats
  let calls = null;
  try { calls = await getAPI("calls_by_agent"); } catch { calls = null; }

  // Build merged per-agent weekly map
  const per = new Map();
  const team = { calls:0, talkMin:0, leads:0, sold:0, deals:0, av:0 };

  // sales rollup
  if (sales){
    // Prefer per-sale for splash; also perAgent for weekly av/deals
    const perAgent = Array.isArray(sales.perAgent) ? sales.perAgent
                    : Array.isArray(sales.per_agent) ? sales.per_agent
                    : Array.isArray(sales.per) ? sales.per : [];

    for (const row of perAgent){
      const name = row.name || row.agent || "";
      const k = agentKeyFromName(name);
      const av12 = Number(row.av12x || row.amount*12 || row.amountAV || 0);
      const deals = Number(row.sales || row.salesCount || row.count || 0);
      const cur = per.get(k) || { name, email:"", calls:0, talkMin:0, loggedMin:0, leads:0, sold:0, weeklyDeals:0, weeklyAV:0 };
      cur.weeklyDeals += deals;
      cur.weeklyAV    += av12;
      per.set(k, cur);
      team.deals += deals;
      team.av    += av12;
    }

    // Sale splash detection (delta-based)
    const snapshot = new Map();
    for (const [k, v] of per.entries()){
      snapshot.set(k, { deals: v.weeklyDeals, av: v.weeklyAV });
    }
    // Compare to previous
    for (const [k, cur] of snapshot.entries()){
      const prev = STATE.lastSaleSnapshot.get(k) || { deals:0, av:0 };
      if (cur.deals > prev.deals){
        // estimate last sale AV
        const deltaDeals = cur.deals - prev.deals;
        const deltaAV = Math.max(0, cur.av - prev.av);
        const perSale = deltaAV / Math.max(1, deltaDeals);
        const agentName = (per.get(k)?.name) || "Agent";
        // IMPORTANT: show AV ONLY (no x12 text)
        showSaleOverlay(agentName, perSale);
      }
    }
    STATE.lastSaleSnapshot = snapshot;
  }

  // calls rollup
  if (calls){
    team.calls   = Number(calls.team?.calls || 0);
    team.talkMin = Number(calls.team?.talkMin || 0);
    team.leads   = Number(calls.team?.leads || 0);
    team.sold    = Number(calls.team?.sold || 0);

    const rows = Array.isArray(calls.perAgent) ? calls.perAgent : [];
    for (const r of rows){
      const name = r.name || r.agent || "";
      const k = agentKeyFromName(name);
      const cur = per.get(k) || { name, email:"", calls:0, talkMin:0, loggedMin:0, leads:0, sold:0, weeklyDeals:0, weeklyAV:0 };
      cur.calls     += Number(r.calls || 0);
      cur.talkMin   += Number(r.talkMin || 0);
      cur.loggedMin += Number(r.loggedMin || 0);
      cur.leads     += Number(r.leads || 0);
      cur.sold      += Number(r.sold || 0);
      per.set(k, cur);
    }
  }

  // Attach email/photo from roster (and ensure everyone appears)
  const byName = new Map(STATE.roster.map(a => [agentKeyFromName(a.name), a]));
  for (const a of STATE.roster){
    const k = agentKeyFromName(a.name);
    if (!per.has(k)) per.set(k, { name:a.name, email:a.email, calls:0, talkMin:0, loggedMin:0, leads:0, sold:0, weeklyDeals:0, weeklyAV:0 });
  }
  for (const [k, v] of per.entries()){
    const a = byName.get(k);
    if (a){ v.email = a.email; v.photo = a.photo; }
  }

  STATE.weekly.per = per;
  STATE.weekly.team = team;
}

/* ------------------------ Vendors (45d) ------------------------ */
async function loadVendors(){
  // prefer API endpoint; fallback to static file if present
  let raw = null;
  try { raw = await getAPI("sales_by_vendor"); } catch { raw = null; }
  if (!raw){
    try { raw = await getJSON(`${BASE}/sales_by_vendor.json`); } catch { raw = null; }
  }
  const byName = new Map();
  let total = 0;
  if (raw && (Array.isArray(raw.records) || Array.isArray(raw.vendors) || Array.isArray(raw))){
    const rows = Array.isArray(raw.vendors) ? raw.vendors
               : Array.isArray(raw.records) ? raw.records
               : Array.isArray(raw) ? raw : [];
    for (const r of rows){
      const nm = normalizeVendorName(r.name || r.vendor || r.vendorName || "");
      const deals = Number(r.deals || r.count || r.sales || 0);
      if (!nm || !deals) continue;
      byName.set(nm, (byName.get(nm) || 0) + deals);
      total += deals;
    }
  }
  // ensure every permanent vendor exists (even 0)
  for (const v of PERMANENT_VENDORS) if (!byName.has(v)) byName.set(v, 0);

  STATE.vendors.byName = byName;
  STATE.vendors.totalDeals = total;
  STATE.vendors.window_days = 45;
  STATE.vendors.as_of = new Date().toISOString().slice(0,10);
}

/* ------------------------ Summary Cards ------------------------ */
function renderSummary(){
  const sumCalls = byId("sumCalls");
  const sumSales = byId("sumSales");
  const sumDeals = byId("sumTalk");
  if (sumCalls) sumCalls.textContent = fmtInt(STATE.weekly.team.calls);
  if (sumSales) sumSales.textContent = fmtMoney(STATE.weekly.team.av);
  if (sumDeals) sumDeals.textContent = fmtInt(STATE.weekly.team.deals);
}

/* ------------------------ Board helpers ------------------------ */
function setViewLabel(txt){ const el = byId("viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){
  const thead = byId("thead");
  if (!thead) return;
  thead.innerHTML = `<tr>${cols.map(c=>`<th${c.num?' class="num"':''}>${c.label}</th>`).join("")}</tr>`;
}
function setRows(html){
  const tbody = byId("tbody");
  if (!tbody) return;
  tbody.innerHTML = html || `<tr><td style="padding:18px;color:#5c6c82;">Loading…</td></tr>`;
}

/* ------------------------ Renderers ------------------------ */

// 1) Weekly Submitted AV (Leaderboard)
function renderWeeklyAV(){
  setViewLabel("This Week — Submitted AV");
  setHead([{label:"Agent"},{label:"Submitted AV",num:true},{label:"Deals",num:true}]);
  const list = Array.from(STATE.weekly.per.values())
    .map(x=>({ name:x.name, photo:x.photo, av:x.weeklyAV, deals:x.weeklyDeals }))
    .sort((a,b)=> b.av - a.av);
  if (!list.length){ setRows(); return; }
  const rows = list.map(r => `
    <tr>
      <td>${avatarHTML(r.name, r.photo)}</td>
      <td class="num">${fmtMoney(r.av)}</td>
      <td class="num">${fmtInt(r.deals)}</td>
    </tr>`).join("");
  setRows(rows);
}

// 2) Agent of the Week (big headshot + copy) with YTD AV
function renderAOTW(){
  setViewLabel("Agent of the Week");
  setHead([{label:"Leader"}]); // single cell row
  const list = Array.from(STATE.weekly.per.values())
    .map(x=>({ name:x.name, photo:x.photo, av:x.weeklyAV, deals:x.weeklyDeals }))
    .sort((a,b)=> (b.av - a.av) || (b.deals - a.deals));
  if (!list.length){ setRows(`<tr><td style="padding:18px;color:#5c6c82;">No data yet.</td></tr>`); return; }
  const top = list[0];

  const ytdRow = STATE.ytd.find(y => agentKeyFromName(y.name) === agentKeyFromName(top.name));
  const ytdVal = ytdRow ? ytdRow.av : 0;

  const cell = `
    <div style="display:flex;gap:18px;align-items:center;justify-content:center;padding:16px 6px;">
      ${bigHeadshotHTML(top.name, top.photo)}
      <div style="max-width:680px">
        <div style="font-size:26px;font-weight:900;margin-bottom:6px">${escapeHTML(top.name)}</div>
        <div style="color:#9fb0c8;margin-bottom:10px;">LEADING FOR AGENT OF THE WEEK</div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;color:#9fb0c8">
          <div><b style="color:#ffd36a">${fmtInt(top.deals)}</b> deals (this week)</div>
          <div><b style="color:#ffd36a">${fmtMoney(top.av)}</b> submitted AV (this week)</div>
          <div><b style="color:#cfd7e3">${fmtMoney(ytdVal)}</b> YTD AV</div>
        </div>
      </div>
    </div>`;
  setRows(`<tr><td>${cell}</td></tr>`);
}

// 3) Vendors — Last 45 Days (donut + legend)
function renderVendors(){
  setViewLabel(`Lead Vendors — Last ${STATE.vendors.window_days} Days`);
  setHead([{label:"Breakdown"}]);

  const byName = STATE.vendors.byName;
  const total = STATE.vendors.totalDeals || Array.from(byName.values()).reduce((a,b)=>a+b,0);
  if (!total){ setRows(`<tr><td style="padding:18px;color:#5c6c82;">No data yet.</td></tr>`); return; }

  const names = PERMANENT_VENDORS;
  const values = names.map(n => byName.get(n) || 0);

  const chartId = "vendorChart_" + Date.now();
  const legend = names.map((n,i) => {
    const v = values[i]||0;
    const p = total ? Math.round((v/total)*1000)/10 : 0;
    return `<div style="display:flex;justify-content:space-between;gap:12px;">
      <span>${escapeHTML(n)}</span>
      <span>${fmtInt(v)} (${p.toFixed(1)}%)</span>
    </div>`;
  }).join("");

  const html = `
    <div style="display:flex;gap:24px;align-items:flex-start;justify-content:center;flex-wrap:wrap;padding:12px;">
      <canvas id="${chartId}" width="420" height="420" style="max-width:420px;max-height:420px"></canvas>
      <div style="min-width:280px">${legend}</div>
    </div>
    <div style="text-align:center;color:#9fb0c8;font-size:12px;margin-top:6px;">As of ${STATE.vendors.as_of}</div>
  `;
  setRows(`<tr><td>${html}</td></tr>`);

  if (window.Chart){
    const ctx = byId(chartId).getContext("2d");
    new Chart(ctx, {
      type: "doughnut",
      data: { labels: names, datasets: [{ data: values, borderWidth: 0 }] },
      options: {
        cutout: "58%",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c)=> `${c.label}: ${fmtInt(c.raw)} deals` } }
        }
      }
    });
  }
}

// 4) Agent Activity (calls, talk, logged, leads, sold, conv%)
function renderActivity(){
  setViewLabel("Agent Activity — This Week");
  setHead([
    {label:"Agent"},
    {label:"Calls",num:true},
    {label:"Talk (min)",num:true},
    {label:"Logged (h:mm)",num:true},
    {label:"Leads",num:true},
    {label:"Sold",num:true},
    {label:"Conv %",num:true}
  ]);

  const list = Array.from(STATE.weekly.per.values())
    .map(x=>{
      const conv = x.leads > 0 ? (x.sold / x.leads) : null;
      return { ...x, conv };
    })
    .sort((a,b)=> (b.calls - a.calls) || (b.talkMin - a.talkMin));

  const rows = list.map(r => `
    <tr>
      <td>${avatarHTML(r.name, r.photo)}</td>
      <td class="num">${fmtInt(r.calls)}</td>
      <td class="num">${fmtInt(r.talkMin)}</td>
      <td class="num">${minutesToHMM(r.loggedMin)}</td>
      <td class="num">${fmtInt(r.leads)}</td>
      <td class="num">${fmtInt(r.sold)}</td>
      <td class="num">${r.conv==null?"—":(Math.round(r.conv*1000)/10).toFixed(1)+"%"}</td>
    </tr>
  `).join("");
  setRows(rows || `<tr><td style="padding:18px;color:#5c6c82;">No data yet.</td></tr>`);
}

// 5) YTD AV (override)
function renderYTD(){
  setViewLabel("YTD — Team");
  setHead([{label:"Agent"},{label:"YTD AV",num:true}]);
  if (!STATE.ytd.length){ setRows(`<tr><td style="padding:18px;color:#5c6c82;">No YTD data yet.</td></tr>`); return; }
  const rows = STATE.ytd.map(r => `
    <tr>
      <td>${avatarHTML(r.name, r.photo)}</td>
      <td class="num">${fmtMoney(r.av)}</td>
    </tr>`).join("");
  setRows(rows);
}

// 6) PAR (manual)
function renderPAR(){
  setViewLabel("PAR — On Track");
  setHead([{label:"Agent"},{label:"Note"}]);
  if (!STATE.par.length){ setRows(`<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`); return; }
  const rows = STATE.par.map(x => `
    <tr>
      <td>${avatarHTML(x.name)}</td>
      <td class="num">${escapeHTML(x.note||"")}</td>
    </tr>`).join("");
  setRows(rows);
}

/* ------------------------ Router ------------------------ */
function renderCurrent(){
  renderSummary();
  const which = ROTATE_ORDER[STATE.viewIndex % ROTATE_ORDER.length];
  switch(which){
    case "weekly_av": return renderWeeklyAV();
    case "aotw":      return renderAOTW();
    case "vendors":   return renderVendors();
    case "activity":  return renderActivity();
    case "ytd":       return renderYTD();
    case "par":       return renderPAR();
    default:          return renderWeeklyAV();
  }
}

/* ------------------------ Boot & Tickers ------------------------ */
async function refreshAll(){
  await Promise.all([loadWeekly(), loadVendors()]);
  renderCurrent();
}

async function boot(){
  try{
    await loadStatic();
    startRuleOfDay();
    await refreshAll();
    // rotation
    setInterval(()=>{ STATE.viewIndex = (STATE.viewIndex + 1) % ROTATE_ORDER.length; renderCurrent(); }, ROTATE_MS);
    // data refresh every 30s (same cadence)
    setInterval(refreshAll, 30_000);
  }catch(e){
    console.error("Boot error:", e);
    setRows(`<tr><td style="padding:18px;color:#d66">${escapeHTML(e.message||e)}</td></tr>`);
  }
}

document.addEventListener("DOMContentLoaded", boot);
/* ==================== End ==================== */
