/* =============== FEW Dashboard (clean, unified) =============== */
"use strict";

/* ---------------- Config ---------------- */
const BASE = "https://few-dashboard-live.netlify.app"; // absolute paths only
const ET_TZ = "America/New_York";
const DATA_MS = 30_000;         // refresh data every 30s
const ROTATE_MS = 30_000;       // rotate views every 30s
const VIEWS = ["roster","aotw","vendors","ytd"];  // 4-board loop
let viewIdx = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* --------------- Tiny DOM helpers --------------- */
const $   = s => document.querySelector(s);
const $$  = s => Array.from(document.querySelectorAll(s));
const escapeHtml = s => String(s??"").replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));
const bust = (u)=> u + (u.includes("?")?"&":"?") + "t=" + Date.now();

/* ---------------- Format helpers ---------------- */
const fmtInt     = n => Number(n||0).toLocaleString("en-US");
const fmtMoney   = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct     = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials   = n => String(n||"").trim().split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
const hmm        = mins => { const mm=Math.max(0,Math.round(Number(mins||0))); const h=Math.floor(mm/60), m2=mm%60; return `${h}:${String(m2).padStart(2,"0")}`; };
const toET       = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

/* --------------- Weekly window (Fri→Fri ET) --------------- */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();             // Sun=0 — Sat=6
  const sinceFri = (day + 2) % 7;       // distance back to Friday
  const start = new Date(now);  start.setHours(0,0,0,0);  start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return { start, end };
}

/* --------------- Safe static loader --------------- */
async function loadStatic(pathOrUrl){
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : (BASE + pathOrUrl);
  try{
    const r = await fetch(bust(url), { cache:"no-store" });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  }catch(e){
    console.warn("loadStatic failed:", url, e.message);
    return null;
  }
}

/* --------------- API helpers --------------- */
async function getJSONSmart(pathOrUrl){
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : (BASE + pathOrUrl);
  let lastErr = null;
  for (const u of [bust(url), url]) {
    try{
      const r = await fetch(u, { cache:"no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    }catch(e){ lastErr = e; }
  }
  console.warn("getJSONSmart failed:", pathOrUrl, lastErr?.message || lastErr);
  return null;
}

/* ---------------------- RULE OF THE DAY ---------------------- */
async function renderRotatingRule(){
  const ruleEl = $("#rule");
  const data = await loadStatic("/public/rules.json");
  const rules = Array.isArray(data?.rules) ? data.rules : [];
  if (!rules.length){ ruleEl.textContent = "RULE OF THE DAY — …"; return; }

  const slotHours = 12; // rotate every 12h
  const slot = Math.floor(Date.now() / (slotHours*60*60*1000)) % rules.length;
  ruleEl.innerHTML = `<strong>RULE OF THE DAY —</strong> ${escapeHtml(rules[slot])}`;
}

/* ---------------------- VIEWS ---------------------- */
function setTitle(sub){ $("#subTitle").textContent = sub; }
function setSummary({teamCalls=0, totalAV12x=0, deals=0}){
  $("#sumCalls").textContent = fmtInt(teamCalls);
  $("#sumSales").textContent = fmtMoney(totalAV12x);
  $("#sumTalk").textContent  = fmtInt(deals);
}

/* ---- Roster / Weekly Submitted AV ---- */
async function viewRoster(){
  setTitle("This Week — Roster");
  const thead = $("#thead"); const tbody = $("#tbody");
  thead.innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;
  tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">Loading…</td></tr>`;

  const sold = await getJSONSmart(`/api/team_sold?v=${Date.now()}`);
  if (!sold){ tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#f66">Could not load sales.</td></tr>`; return; }

  setSummary({
    teamCalls: 0, // roster board shows calls card but summed elsewhere
    totalAV12x: sold?.team?.totalAV12x || 0,
    deals: sold?.team?.totalSales || 0
  });

  const rows = (sold.perAgent||[]).map(a => `
    <tr>
      <td class="agent">
        <span class="avatar" style="background-image:url('${BASE}/public/headshots/${encodeURIComponent((a.photoFile||"").trim())}')"></span>
        <span>${escapeHtml(a.name||"")}</span>
      </td>
      <td class="num">${fmtInt(a.sales||0)}</td>
      <td class="num">${fmtMoney((a.av12x||0))}</td>
    </tr>
  `).join("");

  tbody.innerHTML = rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No sales found.</td></tr>`;
}

/* ---- Agent of the Week (centered, large) ---- */
async function viewAotw(){
  setTitle("Agent of the Week");
  const thead = $("#thead"); const tbody = $("#tbody");
  thead.innerHTML = `
    <tr>
      <th>Agent of the Week</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;
  tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">Loading…</td></tr>`;

  const sold = await getJSONSmart(`/api/team_sold?v=${Date.now()}`);
  if (!sold){ tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#f66">Could not load.</td></tr>`; return; }

  const best = [...(sold.perAgent||[])].sort((a,b)=>(b.av12x||0)-(a.av12x||0))[0];
  setSummary({
    teamCalls: 0,
    totalAV12x: sold?.team?.totalAV12x || 0,
    deals: sold?.team?.totalSales || 0
  });

  if (!best){ tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No sales yet.</td></tr>`; return; }

  // Big, centered card row
  tbody.innerHTML = `
    <tr>
      <td colspan="3">
        <div style="display:flex;align-items:center;justify-content:center;gap:24px;padding:26px 12px;">
          <span class="avatar big" style="width:96px;height:96px;background-image:url('${BASE}/public/headshots/${encodeURIComponent((best.photoFile||"").trim())}')"></span>
          <div style="text-align:left">
            <div style="font-size:28px;font-weight:800;letter-spacing:.3px">Leading for Agent of the Week</div>
            <div style="font-size:24px;margin-top:6px">${escapeHtml(best.name||"")}</div>
            <div style="display:flex;gap:24px;margin-top:8px;font-size:18px">
              <span>Sold: <b>${fmtInt(best.sales||0)}</b></span>
              <span>Submitted AV (12x): <b>${fmtMoney(best.av12x||0)}</b></span>
            </div>
          </div>
        </div>
      </td>
    </tr>`;
}

/* ---- Lead Vendors — % of Sales (Last 45 days) ---- */
async function viewVendors(){
  setTitle("Lead Vendors — % of Sales (Last 45 days)");
  const thead = $("#thead"); const tbody = $("#tbody");
  thead.innerHTML = `<tr><th>Vendor</th><th style="text-align:right">Deals</th><th style="text-align:right">% of total</th></tr>`;
  tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">Loading…</td></tr>`;

  const data = await loadStatic("/public/sales_by_vendor.json"); // static JSON you maintain
  const list = Array.isArray(data?.vendors) ? data.vendors : [];
  const total = list.reduce((s,v)=>s+(v.deals||0),0)||0;

  if (!total){
    tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`;
    return;
  }

  const rows = list
    .sort((a,b)=>(b.deals||0)-(a.deals||0))
    .map(v=>`
      <tr>
        <td>${escapeHtml(v.name||"Unknown")}</td>
        <td class="num">${fmtInt(v.deals||0)}</td>
        <td class="num">${fmtPct((v.deals||0)/total)}</td>
      </tr>`).join("");

  tbody.innerHTML = rows;
}

/* ---- YTD Leaders (uses public/ytd_av.json & ytd_total.json) ---- */
async function viewYTD(){
  setTitle("YTD — Leaders");
  const thead = $("#thead"); const tbody = $("#tbody");
  thead.innerHTML = `<tr><th>Agent</th><th style="text-align:right">YTD AV (12x)</th></tr>`;
  tbody.innerHTML = `<tr><td colspan="2" style="padding:14px;color:#7b8aa3">Loading…</td></tr>`;

  const list = await loadStatic("/public/ytd_av.json");
  const rows = (Array.isArray(list)?list:[]).map(a=>`
    <tr>
      <td class="agent">
        <span class="avatar" style="background-image:url('${BASE}/public/headshots/${encodeURIComponent((a.photoFile||"").trim())}')"></span>
        <span>${escapeHtml(a.name||"")}</span>
      </td>
      <td class="num">${fmtMoney(a.av||0)}</td>
    </tr>`).join("");

  tbody.innerHTML = rows || `<tr><td colspan="2" style="padding:14px;color:#7b8aa3">No YTD entries.</td></tr>`;
}

/* ---- Agent Activity (calls/talk/leads/sold/conv/logged) ---- */
async function viewActivity(){
  setTitle("This Week — Roster");
  const thead = $("#thead"); const tbody = $("#tbody");
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
  tbody.innerHTML = `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">Loading…</td></tr>`;

  const calls = await getJSONSmart(`/api/calls_by_agent?v=${Date.now()}`);
  if (!calls || !Array.isArray(calls.perAgent) || !calls.perAgent.length){
    tbody.innerHTML = `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">No activity reported yet.</td></tr>`;
    // Summary cards still reflect roster totals from other views; not duplicated here
    return;
  }

  const rows = calls.perAgent.map(a => `
    <tr>
      <td class="agent">
        <span class="avatar" style="background-image:url('${BASE}/public/headshots/${encodeURIComponent((a.photoFile||"").trim())}')"></span>
        <span>${escapeHtml(a.name||"")}</span>
      </td>
      <td class="num">${fmtInt(a.calls||0)}</td>
      <td class="num">${fmtInt(a.talkMin||0)}</td>
      <td class="num">${hmm(a.loggedMin||0)}</td>
      <td class="num">${fmtInt(a.leads||0)}</td>
      <td class="num">${fmtInt(a.sold||0)}</td>
      <td class="num">${fmtPct((a.sold||0)/Math.max(1,(a.leads||0)))}</td>
    </tr>`).join("");

  tbody.innerHTML = rows;
}

/* ------------------ Sales Ticker (always on) ------------------ */
// decoupled from rotation; won’t miss on board swaps; no “×12” in display
let lastSeenLeadAt = 0;
async function pollNewSales(){
  const data = await getJSONSmart(`/api/team_sold?v=${Date.now()}`);
  if (!data || !Array.isArray(data.allSales)) return;

  // Find most recent sale
  const latest = [...data.allSales].sort((a,b)=> new Date(b.dateSold) - new Date(a.dateSold))[0];
  if (!latest) return;

  const ts = +toET(latest.dateSold);
  if (ts <= lastSeenLeadAt) return;
  lastSeenLeadAt = ts;

  showSaleToast(latest.agent, latest.amount); // amount displayed as AV12x (number given by API)
}

let toastTimer = null;
function showSaleToast(agent, amount12x){
  const el = $("#saleToast");
  el.innerHTML = `
    <div class="toast-title">New Sale</div>
    <div class="toast-agent">${escapeHtml(agent||"")}</div>
    <div class="toast-amount">${fmtMoney(amount12x||0)} AV</div>`;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove("on"), 60_000); // hold 1 minute
}

/* ------------------ Rotation + boot ------------------ */
function rotate(){
  if (VIEW_OVERRIDE){ render(VIEW_OVERRIDE); return; }
  viewIdx = (viewIdx + 1) % VIEWS.length;
  render(VIEWS[viewIdx]);
}

async function render(which){
  await renderRotatingRule();
  // default summary clear
  setSummary({teamCalls:0,totalAV12x:0,deals:0});

  if (which==="roster")   await viewRoster();
  else if (which==="aotw")     await viewAotw();
  else if (which==="vendors")  await viewVendors();
  else if (which==="ytd")      await viewYTD();
  else                         await viewRoster();
}

async function boot(){
  // first screen
  await render(VIEW_OVERRIDE || VIEWS[0]);

  // rotate boards
  if (!VIEW_OVERRIDE) setInterval(rotate, ROTATE_MS);

  // background polling
  setInterval(()=> renderRotatingRule(), 60_000);       // refresh rule text hourly
  setInterval(pollNewSales, 15_000);                    // check new sales every 15s
  pollNewSales();                                       // initial check
}

document.addEventListener("DOMContentLoaded", boot);
