/* ================== FEW Dashboard (all-in-one) ================== */
"use strict";

/* -------------------- Config -------------------- */
const ET_TZ          = "America/New_York";
const DATA_MS        = 30_000;   // refresh data every 30s
const ROTATE_MS      = 30_000;   // rotate boards every 30s
const RULE_ROTATE_HR = 12;       // rule of the day rotates every 12 hours
const VIEWS          = ["roster","aotw","vendors","activity"]; // 4 boards in loop
let   viewIdx        = 0;

/* -------------------- DOM helpers -------------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const pct   = n => (n==null ? "—" : (Math.round(Number(n)*10)/10).toFixed(1) + "%");
const initials = name => (String(name||"").trim().split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase());
const nowET = () => new Date(new Date().toLocaleString("en-US", { timeZone: ET_TZ }));

/* -------------------- Fetch helpers -------------------- */
async function getJSON(url){
  const u = url.includes("?") ? url + "&t=" + Date.now() : url + "?t=" + Date.now();
  try{
    const r = await fetch(u, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }catch(e){
    console.warn("getJSON failed:", url, e.message);
    return null;
  }
}

/* Load roster headshots; supports raw array or {agents:[...]} */
let ROSTER = [];       // [{name,email,photo,phones?}, ...]
let PHOTO_BY = {};     // map lowercased name/email -> filename
async function loadRoster(){
  const raw = await getJSON("/headshots/roster.json");
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.agents) ? raw.agents : []);
  ROSTER = list;
  PHOTO_BY = {};
  for (const a of list){
    if (!a) continue;
    const nameKey  = (a.name  ||"").toLowerCase().trim();
    const emailKey = (a.email ||"").toLowerCase().trim();
    if (nameKey)  PHOTO_BY["name:"+nameKey]   = a.photo || null;
    if (emailKey) PHOTO_BY["email:"+emailKey] = a.photo || null;
  }
}
function photoFor(agentName, agentEmail){
  const nameKey  = "name:"  + (agentName ||"").toLowerCase().trim();
  const emailKey = "email:" + (agentEmail||"").toLowerCase().trim();
  const file = PHOTO_BY[emailKey] ?? PHOTO_BY[nameKey] ?? null;
  return file ? `/headshots/${file}` : null;
}

/* -------------------- Rule of the Day -------------------- */
async function setRuleOfTheDay(){
  const el = $("#rule-banner") || (() => {
    // create one centered bold banner if missing
    const bar = document.createElement("div");
    bar.id = "rule-banner";
    bar.style.cssText = "width:100%;text-align:center;font-weight:800;font-size:22px;letter-spacing:.5px;margin:6px 0 10px 0;";
    // Try to place at the very top of main container/body
    (document.body || document.documentElement).prepend(bar);
    return bar;
  })();

  let rules = await getJSON("/rules.json");
  if (!Array.isArray(rules)) {
    rules = [
      "Choose effort over your excuses and emotions.",
      "Do not be entitled. Earn everything.",
      "You are who you hunt with. Everybody wants to eat, but FEW will hunt."
    ];
  }
  const slot = Math.floor(Date.now() / (RULE_ROTATE_HR * 3600_000));
  const rule = rules[slot % rules.length] || rules[0];
  el.textContent = `RULE OF THE DAY — ${rule}`;
}

/* -------------------- Elements used by all boards -------------------- */
const thead = $("#thead") || (()=>{ const e=document.createElement("thead"); e.id="thead"; ($("table")||document.body).appendChild(e); return e;})();
const tbody = $("#tbody") || (()=>{ const e=document.createElement("tbody"); e.id="tbody"; ($("table")||document.body).appendChild(e); return e;})();
function setCard(idCandidates, value){
  for (const id of idCandidates){
    const el = document.getElementById(id);
    if (el){ el.textContent = value; return; }
  }
}

/* -------------------- Live data caches -------------------- */
let SOLD = null;            // /api/team_sold
let CALLS = null;           // /api/calls_by_agent
let VENDOR = null;          // /api/sales_by_vendor or /sales_by_vendor.json
let lastSeenIds = new Set(JSON.parse(localStorage.getItem("few_last_sale_ids")||"[]"));

/* -------------------- Data loaders (with fallbacks) -------------------- */
async function loadSold(){
  const r = await getJSON("/api/team_sold");
  SOLD = r || { team:{totalSales:0,totalAmount:0,totalAV12x:0}, perAgent:[], allSales:[] };
  return SOLD;
}
async function loadCalls(){
  const r = await getJSON("/api/calls_by_agent");
  // When empty, Ringy returns {team:{...zeros}, perAgent:[]}
  CALLS = r || { team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0}, perAgent:[] };
  return CALLS;
}
async function loadVendors(){
  // Try live endpoint first
  let v = await getJSON("/api/sales_by_vendor");
  if (!v){
    // Fallback to repo file
    v = await getJSON("/sales_by_vendor.json");
  }
  // Normalize
  if (!v){
    VENDOR = { window_days:45, vendors:[] };
    return VENDOR;
  }
  if (Array.isArray(v.vendors)){
    VENDOR = v;
  }else if (Array.isArray(v)){
    VENDOR = { window_days:45, vendors:v };
  }else{
    VENDOR = { window_days: v.window_days||45, vendors: Array.isArray(v.vendors)?v.vendors:[] };
  }
  return VENDOR;
}

/* -------------------- New sale flash -------------------- */
function flashNewSales(){
  const box = $("#sale-flash") || (() => {
    const d = document.createElement("div");
    d.id = "sale-flash";
    d.style.cssText = `
      position:fixed;left:50%;top:20%;transform:translateX(-50%);
      background:rgba(32,32,24,.95);border:2px solid #e7c45a;border-radius:12px;
      padding:22px 28px;font-size:26px;font-weight:800;color:#f5d978;
      text-shadow:0 0 12px rgba(255,212,96,.45);z-index:9999;display:none;
    `;
    document.body.appendChild(d);
    return d;
  })();

  if (!SOLD || !Array.isArray(SOLD.allSales)) return;

  const fresh = [];
  for (const s of SOLD.allSales){
    const id = s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.amount}`;
    if (!id) continue;
    if (!lastSeenIds.has(id)) fresh.push(s);
  }
  if (!fresh.length) return;

  // Show one-by-one; store seen
  const queue = fresh.slice(0,3); // cap burst
  (async function run(){
    for (const s of queue){
      const id = s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.amount}`;
      lastSeenIds.add(id);
      // amount is monthly; show 12x
      const av12 = Number(s.amount||0) * 12;
      box.innerHTML = `<div style="font-size:18px;margin-bottom:6px;">New Sale</div><div>${(s.agent||"Agent")}</div><div style="font-size:20px;margin-top:4px;">${money(av12)} AV (12×)</div>`;
      box.style.display = "block";
      await new Promise(r=>setTimeout(r, 4000)); // visible 4s
      box.style.display = "none";
      await new Promise(r=>setTimeout(r, 500)); // small gap
    }
    // persist last seen ids (limit to 400)
    const arr = Array.from(lastSeenIds).slice(-400);
    localStorage.setItem("few_last_sale_ids", JSON.stringify(arr));
  })();
}

/* -------------------- Boards -------------------- */

// 1) Weekly Submitted AV (Roster)
function renderRoster(){
  if (!SOLD) return;
  const team  = SOLD.team || {};
  const list  = Array.isArray(SOLD.perAgent) ? SOLD.perAgent.slice() : [];

  // Top cards (accept multiple possible ids from old markup)
  setCard(["sumCalls","cardCalls"], (CALLS?.team?.calls ?? 0).toLocaleString("en-US"));
  setCard(["sumSales","cardAV"],    money(team.totalAV12x || 0));
  setCard(["sumTalk","cardDeals"],  (team.totalSales || 0).toLocaleString("en-US"));

  // header
  thead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12×)</th>
    </tr>`;

  // sort by sold then av12x
  list.sort((a,b) => (b.sales||0) - (a.sales||0) || (b.av12x||0) - (a.av12x||0));

  const rows = list.map(a => {
    const img = photoFor(a.name, a.email);
    return `
      <tr>
        <td class="agent">
          ${img ? `<span class="avatar" style="background-image:url('${img}')"></span>` :
                  `<span class="avatar-fallback">${initials(a.name)}</span>`}
          <span>${a.name||""}</span>
        </td>
        <td class="num">${Number(a.sales||0).toLocaleString("en-US")}</td>
        <td class="num">${money(a.av12x||0)}</td>
      </tr>`;
  }).join("");

  tbody.innerHTML = rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No sales found.</td></tr>`;
}

// 2) Agent of the Week (leader)
function renderAotW(){
  if (!SOLD) return;
  const list = Array.isArray(SOLD.perAgent) ? SOLD.perAgent.slice() : [];
  if (!list.length){
    thead.innerHTML = `<tr><th>Agent of the Week</th><th>Sold</th><th>Submitted AV (12×)</th></tr>`;
    tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No data.</td></tr>`;
    return;
  }
  // Choose leader by AV, then sold
  list.sort((a,b) => (b.av12x||0) - (a.av12x||0) || (b.sales||0) - (a.sales||0));
  const top = list[0];

  thead.innerHTML = `<tr><th>Leading for Agent of the Week</th><th>Sold</th><th>Submitted AV (12×)</th></tr>`;
  const img = photoFor(top.name, top.email);
  tbody.innerHTML = `
    <tr>
      <td class="agent" style="font-size:18px;">
        ${img ? `<span class="avatar big" style="background-image:url('${img}')"></span>` :
                `<span class="avatar-fallback big">${initials(top.name)}</span>`}
        <span style="margin-left:8px">${top.name||""}</span>
      </td>
      <td class="num" style="font-size:18px;">${Number(top.sales||0).toLocaleString("en-US")}</td>
      <td class="num" style="font-size:18px;">${money(top.av12x||0)}</td>
    </tr>`;
}

// 3) Vendors (45-day %) with fallback file
function renderVendors(){
  thead.innerHTML = `<tr><th>Lead Vendors — % of Sales (Last ${VENDOR?.window_days||45} days)</th><th style="text-align:right">Count (Share)</th></tr>`;
  const data = Array.isArray(VENDOR?.vendors) ? VENDOR.vendors.slice() : [];
  if (!data.length){
    tbody.innerHTML = `<tr><td colspan="2" style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`;
    return;
  }
  // normalize names (ensure TTM Nice! supported)
  data.forEach(d => { if (d && typeof d.name==="string") d.name = d.name.replace(/\s+/g," ").trim(); });
  const total = data.reduce((s,v)=>s+(v.deals||v.count||0),0) || 0;
  data.sort((a,b)=> (b.deals||b.count||0) - (a.deals||a.count||0));

  const rows = data.map(v => {
    const n = v.deals ?? v.count ?? 0;
    const share = total ? Math.round(n*1000/total)/10 : 0;
    return `<tr>
      <td>${v.name||"Unknown"}</td>
      <td class="num">${n.toLocaleString("en-US")} (${share.toFixed(1)}%)</td>
    </tr>`;
  }).join("");
  tbody.innerHTML = rows;
}

// 4) Agent Activity (calls, talk, leads, sold, conv, logged)
function renderActivity(){
  thead.innerHTML = `
  <tr>
    <th>Agent</th>
    <th style="text-align:right">Calls</th>
    <th style="text-align:right">Talk (min)</th>
    <th style="text-align:right">Logged (h:mm)</th>
    <th style="text-align:right">Leads</th>
    <th style="text-align:right">Sold</th>
    <th style="text-align:right">Conv %</th>
  </tr>`;

  const list = Array.isArray(CALLS?.perAgent) ? CALLS.perAgent.slice() : [];
  if (!list.length){
    tbody.innerHTML = `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">No activity reported yet.</td></tr>`;
    return;
  }
  const rows = list.map(a => {
    const img = photoFor(a.name, a.email);
    const calls = Number(a.calls||0);
    const sold  = Number(a.sold||0);
    const talk  = Number(a.talkMin||0);
    const logged= Number(a.loggedMin||0);
    const conv  = calls>0 ? (sold*100/calls) : 0;
    const h     = Math.floor(logged/60), m = (logged%60+"").padStart(2,"0");
    return `<tr>
      <td class="agent">
        ${img ? `<span class="avatar" style="background-image:url('${img}')"></span>` :
                `<span class="avatar-fallback">${initials(a.name)}</span>`}
        <span>${a.name||""}</span>
      </td>
      <td class="num">${calls.toLocaleString("en-US")}</td>
      <td class="num">${talk.toLocaleString("en-US")}</td>
      <td class="num">${h}:${m}</td>
      <td class="num">${Number(a.leads||0).toLocaleString("en-US")}</td>
      <td class="num">${sold.toLocaleString("en-US")}</td>
      <td class="num">${pct(conv)}</td>
    </tr>`;
  }).join("");
  tbody.innerHTML = rows;
}

/* -------------------- Rotation engine -------------------- */
async function refreshData(){
  await Promise.all([loadSold(), loadCalls(), loadVendors()]);
  flashNewSales();
  // keep top cards refreshed across views
  setCard(["sumCalls","cardCalls"], (CALLS?.team?.calls ?? 0).toLocaleString("en-US"));
  setCard(["sumSales","cardAV"],    money(SOLD?.team?.totalAV12x || 0));
  setCard(["sumTalk","cardDeals"],  (SOLD?.team?.totalSales || 0).toLocaleString("en-US"));
}
function renderCurrent(){
  const v = VIEWS[viewIdx % VIEWS.length];
  if (v==="roster")   renderRoster();
  if (v==="aotw")     renderAotW();
  if (v==="vendors")  renderVendors();
  if (v==="activity") renderActivity();
}
function nextView(){
  viewIdx = (viewIdx + 1) % VIEWS.length;
  renderCurrent();
}

/* -------------------- Boot -------------------- */
(async function boot(){
  // minimal avatar styling if not present
  const css = document.createElement("style");
  css.textContent = `
    .agent{display:flex;align-items:center;gap:10px}
    .avatar{width:28px;height:28px;border-radius:50%;background-size:cover;background-position:center;border:1px solid #2d2d2d}
    .avatar.big{width:48px;height:48px}
    .avatar-fallback{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#2a2f38;color:#cdd7e1;font-weight:700}
    .avatar-fallback.big{width:48px;height:48px;font-size:18px}
    td.num, th[style*="right"]{text-align:right}
  `;
  document.head.appendChild(css);

  await loadRoster();
  await refreshData();
  await setRuleOfTheDay();
  renderCurrent();

  // timers
  setInterval(refreshData, DATA_MS);
  setInterval(nextView, ROTATE_MS);
  // rule rotates every 12 hours—check hourly to catch boundary
  setInterval(setRuleOfTheDay, 60*60*1000);
})();
