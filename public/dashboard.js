/* ================== FEW Dashboard (single rule banner + clean views) ================== */
"use strict";

/* ---------------- Config ---------------- */
const DEBUG     = new URLSearchParams(location.search).has("debug");
const log       = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };
const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;       // refresh every 30s
const ROTATE_MS = 30_000;       // rotate every 30s
const VIEWS     = ["roster","av","aotw","vendors"];
let   viewIdx   = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------------- DOM helpers ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct   = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const escapeHtml= s => String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const toET     = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){
  const r = await fetch(bust(u), { cache:"no-store" });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  const t = await r.text();
  try { return JSON.parse(t); } catch(e){ throw new Error(`Bad JSON from ${u}: ${e.message}`); }
}
function hmm(mins){
  const mm=Math.max(0,Math.round(Number(mins||0)));
  const h=Math.floor(mm/60), m2=mm%60;
  return `${h}:${String(m2).padStart(2,"0")}`;
}
function loadScriptOnce(src, id){
  return new Promise((res)=> {
    if (id && document.getElementById(id)) return res(true);
    const s = document.createElement("script");
    if (id) s.id = id;
    s.src = src; s.async = true; s.onload = ()=>res(true); s.onerror = ()=>res(false);
    document.head.appendChild(s);
  });
}

/* ---------------- Weekly window = Fri 12:00am ET → next Fri 12:00am ET ---------------- */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();            // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;      // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                  // [inclusive, exclusive)
}

/* ---------------- State ---------------- */
const STATE = {
  roster: [],                              // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),               // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),               // key -> {sales,amount,av12x}
  overrides: { calls:null, av:null },      // loaded from /calls_week_override.json & /av_week_override.json
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  vendors: { as_of:"", window_days:45, rows:[] }
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------------- ONE (and only one) centered rule banner ---------------- */
function setRuleText(rulesObj){
  // Remove any legacy rule UI
  ["ticker","principle","ruleBannerCSS","ruleBannerHost"].forEach(id=>{
    const el = document.getElementById(id); if (el) el.remove();
  });

  // Pick text
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");

  // CSS (larger, bold, grey)
  if (!document.getElementById("ruleBannerCSS")){
    const s = document.createElement("style");
    s.id = "ruleBannerCSS";
    s.textContent = `
      #ruleBannerHost{ display:flex; justify-content:center; margin:10px 0 14px; }
      #ruleBanner{
        display:flex; align-items:center; justify-content:center; text-align:center;
        padding:18px 24px; border-radius:18px; max-width:1200px; width:100%;
        background: #11161f;
        border: 1px solid rgba(255,255,255,0.06);
        box-shadow: 0 6px 28px rgba(0,0,0,.35);
      }
      #ruleBanner .ruleText{
        font-weight: 900;
        font-size: clamp(26px, 3.2vw, 44px);
        color: #c9d1d9;           /* grey lettering */
        letter-spacing: .6px;
      }
    `;
    document.head.appendChild(s);
  }

  // Host
  let host = document.getElementById("ruleBannerHost");
  if (!host){
    host = document.createElement("div");
    host.id = "ruleBannerHost";
    const target = document.querySelector("#app") || document.body;
    target.insertBefore(host, target.firstChild);
  }
  host.innerHTML = `
    <div id="ruleBanner"><span class="ruleText">${escapeHtml(text)}</span></div>
  `;
}

/* ---------------- Simple table helpers ---------------- */
function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){
  const thead=$("#thead"); if (!thead) return;
  thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
}
function setRows(rows){
  const tbody = $("#tbody"); if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">Loading...</td></tr>`;
}

/* ---------------- Avatar helpers ---------------- */
function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  const img = src
    ? `<img class="avatar" src="${src}"
         onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${escapeHtml(a.name)}</span></div>`;
}
function avatarBlock(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  if (src){
    return `<img class="avatar" style="width:84px;height:84px;border-radius:50%;object-fit:cover"
                 src="${src}"
                 onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot; style=&quot;width:84px;height:84px;font-size:28px;&quot;>${initials(a.name)}</div>')">`;
  }
  return `<div class="avatar-fallback" style="width:84px;height:84px;font-size:28px">${initials(a.name)}</div>`;
}

/* ---------------- Summary cards (exactly 3) ---------------- */
function massageSummaryLayout(){
  try {
    const callsVal = $("#sumCalls");
    const avVal    = $("#sumSales");
    const dealsVal = $("#sumTalk");

    if (callsVal){ const l = callsVal.previousElementSibling; if (l) l.textContent = "This Week — Team Calls"; }
    if (avVal){    const l = avVal.previousElementSibling;    if (l) l.textContent = "This Week — Total Submitted AV"; }
    if (dealsVal){ const l = dealsVal.previousElementSibling; if (l) l.textContent = "This Week — Deals Submitted"; }

    $$(".card").forEach(card=>{
      const keep = card.contains(callsVal) || card.contains(avVal) || card.contains(dealsVal);
      card.style.display = keep ? "" : "none";
    });
  } catch(e){ log("summary layout", e?.message||e); }
}
function updateSummary(){
  if ($("#sumCalls")) $("#sumCalls").textContent = fmtInt(STATE.team.calls);
  if ($("#sumSales")) $("#sumSales").textContent = fmtMoney(STATE.team.av);
  const dealsEl = $("#sumTalk");
  if (dealsEl) dealsEl.textContent = fmtInt(STATE.team.deals || 0);
}

/* ---------------- Load static (roster, rules, overrides, vendors) ---------------- */
async function loadStatic(){
  const [rosterRaw, rules, vjson] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[]),
    getJSON("/sales_by_vendor.json").catch(()=>null)
  ]);
  setRuleText(rules);
  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  // Optional overrides
  try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
  try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av    = null; }

  // Vendors JSON (optional – fallback to png in renderer)
  if (vjson && Array.isArray(vjson?.vendors)) {
    STATE.vendors.as_of = vjson.as_of || "";
    STATE.vendors.window_days = Number(vjson.window_days||45);
    STATE.vendors.rows = vjson.vendors.map(v=>({ name:String(v.name||""), deals:Number(v.deals||0) }));
  }
}

/* ---------------- Calls / Talk / Leads / Sold ---------------- */
async function refreshCalls(){
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();

  try{
    const payload = await getJSON("/.netlify/functions/calls_by_agent");
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];

    const emailToKey = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), agentKey(a)]));
    const nameToKey  = new Map(STATE.roster.map(a => [String(a.name ||"").trim().toLowerCase(),  agentKey(a)]));

    for (const r of per){
      const e = String(r.email||"").trim().toLowerCase();
      const n = String(r.name ||"").trim().toLowerCase();
      const k = emailToKey.get(e) || nameToKey.get(n);
      if (!k) continue;

      const row = {
        calls    : Number(r.calls||0),
        talkMin  : Number(r.talkMin||0),
        loggedMin: Number(r.loggedMin||0),
        leads    : Number(r.leads||0),
        sold     : Number(r.sold||0)
      };
      byKey.set(k, row);
      teamCalls += row.calls;
      teamTalk  += row.talkMin;
      teamLeads += row.leads;
      teamSold  += row.sold;
    }
  }catch(e){ log("calls_by_agent error", e?.message||e); }

  // Optional manual calls override: replace values for specified emails
  if (STATE.overrides.calls && typeof STATE.overrides.calls === "object"){
    const byEmail = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), a]));
    for (const [email, o] of Object.entries(STATE.overrides.calls)){
      const a = byEmail.get(String(email).toLowerCase());
      if (!a) continue;
      const k   = agentKey(a);
      const cur = byKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
      // remove old
      teamCalls -= cur.calls; teamTalk -= cur.talkMin; teamLeads -= cur.leads; teamSold -= cur.sold;
      // set new
      const row = {
        calls    : Number(o.calls||0),
        talkMin  : Number(o.talkMin||0),
        loggedMin: Number(o.loggedMin||0),
        leads    : Number(o.leads||0),
        sold     : Number(o.sold||0)
      };
      byKey.set(k, row);
      teamCalls += row.calls; teamTalk += row.talkMin; teamLeads += row.leads; teamSold += row.sold;
    }
  }

  STATE.callsWeekByKey = byKey;
  STATE.team.calls = Math.max(0, Math.round(teamCalls));
  STATE.team.talk  = Math.max(0, Math.round(teamTalk));
  STATE.team.leads = Math.max(0, Math.round(teamLeads));
  STATE.team.sold  = Math.max(0, Math.round(teamSold));
}

/* ---------------- Weekly Sales → AV(12×) & Deals (no doubling) ---------------- */
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");
    const [WSTART, WEND] = weekRangeET();

    // Build per-agent from raw sales rows in window
    const perByName = new Map();     // nameKey -> { sales, amount, av12x }
    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];

    for (const s of raw){
      const when = s.dateSold ? toET(s.dateSold) : null;
      if (!when || when < WSTART || when >= WEND) continue;
      const key    = String(s.agent||"").trim().toLowerCase();
      const amount = Number(s.amount||0);
      if (!key) continue;

      const cur = perByName.get(key) || { sales:0, amount:0, av12x:0 };
      cur.sales  += 1;
      cur.amount += amount;
      cur.av12x   = cur.amount * 12;
      perByName.set(key, cur);
    }

    // If no row-level data, fall back to perAgent summary returned by API
    if (perByName.size === 0){
      const pa = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of pa){
        const key    = String(a.name||"").trim().toLowerCase();
        const sales  = Number(a.sales||0);
        const amount = Number(a.amount||0);
        perByName.set(key, { sales, amount, av12x: amount*12 });
      }
    }

    // ------ ONE-TIME OVERRIDE (replace, not add) ------
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      const oa = STATE.overrides.av.perAgent || {};
      for (const [rawName, v] of Object.entries(oa)){
        const k = String(rawName||"").trim().toLowerCase();
        const sales = Number(v.sales || 0);
        const av12x = Number(v.av12x || 0);
        perByName.set(k, { sales, amount: av12x/12, av12x });
      }
      // Team block in override is treated as REPLACEMENT of totals only when no perAgent entries exist
      // (avoids double-count). We will recompute totals from perByName; ignore team additive math.
    }

    // Map per roster + compute totals from perByName only (prevents double)
    const out = new Map();
    let totalDeals = 0;
    let totalAV12x = 0;

    for (const a of STATE.roster){
      const k  = agentKey(a);
      const nk = String(a.name||"").toLowerCase();
      const s  = perByName.get(nk) || { sales:0, amount:0, av12x:0 };
      out.set(k, s);
      totalDeals += Number(s.sales||0);
      totalAV12x += Number(s.av12x||0);
    }

    STATE.salesWeekByKey = out;
    STATE.team.av    = Math.max(0, Math.round(totalAV12x));
    STATE.team.deals = Math.max(0, Math.round(totalDeals));

  }catch(e){
    log("team_sold error", e?.message||e);
    STATE.salesWeekByKey = new Map();
    STATE.team.av    = 0;
    STATE.team.deals = 0;
  }
}

/* ---------------- YTD (unchanged) ---------------- */
async function loadYTD(){
  try {
    const list = await getJSON("/ytd_av.json");           // [{name,email,av}]
    const totalObj = await getJSON("/ytd_total.json").catch(()=>({ytd_av_total:0}));
    const rosterByName = new Map(STATE.roster.map(a => [String(a.name||"").toLowerCase(), a]));
    const rows = Array.isArray(list) ? list : [];
    const withAvatars = rows.map(r=>{
      const a = rosterByName.get(String(r.name||"").toLowerCase());
      return { name:r.name, email:r.email, av:Number(r.av||0), photo:a?.photo||"" };
    });
    withAvatars.sort((x,y)=> (y.av)-(x.av));
    STATE.ytd.list  = withAvatars;
    STATE.ytd.total = Number(totalObj?.ytd_av_total||0);
  } catch(e){
    log("ytd load error", e?.message||e);
    STATE.ytd = { list:[], total:0 };
  }
}

/* ---------------- Derived ---------------- */
function bestOfWeek(){
  const entries = STATE.roster.map(a=>{
    const k = agentKey(a);
    const s = STATE.salesWeekByKey.get(k) || { av12x:0, sales:0, amount:0 };
    return { a, av12x:Number(s.av12x||0), sales:Number(s.sales||0), salesAmt:Number(s.amount||0) };
  });
  entries.sort((x,y)=>{
    if (y.av12x !== x.av12x) return y.av12x - x.av12x;
    if (y.sales !== x.sales) return y.sales - x.sales;
    return y.salesAmt - x.salesAmt;
  });
  return entries[0] || null;
}

/* ---------------- Renderers ---------------- */
function renderRoster(){
  setLabel("This Week — Roster");
  setHead(["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %","Submitted AV"]);
  const rows = (STATE.roster||[]).map(a=>{
    const k = agentKey(a);
    const c = STATE.callsWeekByKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = STATE.salesWeekByKey.get(k) || { av12x:0, sales:0, amount:0 };
    const soldDeals = Number(s.sales || 0);
    const conv = c.leads > 0 ? (soldDeals / c.leads) : null;

    return [
      avatarCell(a),
      fmtInt(c.calls),
      fmtInt(Math.round(c.talkMin)),
      hmm(c.loggedMin),
      fmtInt(c.leads),
      fmtInt(soldDeals),
      fmtPct(conv),
      fmtMoney(Number(s.av12x||0))
    ];
  });
  setRows(rows);
}

function renderWeekAV(){
  setLabel("This Week — Leaderboard (Submitted AV)");
  setHead(["Agent","Submitted AV"]);
  const ranked = (STATE.roster||[])
    .map(a=>{
      const k = agentKey(a);
      const s = STATE.salesWeekByKey.get(k) || { av12x:0 };
      return { a, val: Number(s.av12x||0) };
    })
    .sort((x,y)=> (y.val)-(x.val));
  setRows(ranked.map(({a,val})=> [avatarCell(a), fmtMoney(val)]));
}

function renderAOTW(){
  const top = bestOfWeek();
  setLabel("Agent of the Week");
  if (!top){ setHead([]); setRows([]); return; }
  const { a, av12x, sales } = top;
  const html = `
    <div style="display:flex;gap:18px;align-items:center;">
      ${avatarBlock(a)}
      <div>
        <div style="font-size:22px;font-weight:800;margin-bottom:4px">${escapeHtml(a.name)}</div>
        <div style="color:#9fb0c8;margin-bottom:6px;">LEADING FOR AGENT OF THE WEEK</div>
        <div style="display:flex;gap:18px;color:#9fb0c8">
          <div><b style="color:#cfd7e3">${fmtInt(sales)}</b> deals</div>
          <div><b style="color:#ffd36a">${fmtMoney(av12x)}</b> submitted AV</div>
        </div>
      </div>
    </div>
  `;
  setHead([]); setRows([[html]]);
}

async function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days||45} days)`);
  setHead([]);

  // Prefer JSON rows → draw chart; else fallback to PNG
  const rows = Array.isArray(STATE.vendors.rows) ? STATE.vendors.rows.filter(r=>r.deals>0) : [];
  if (!rows.length){
    const img = `
      <div style="display:flex;justify-content:center;padding:8px 0 12px">
        <img src="/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:900px;width:92%;height:auto;opacity:.95"/>
      </div>
      <div style="text-align:center;color:#9fb0c8;font-size:12px;margin-top:8px;">
        Last ${STATE.vendors.window_days||45} days as of ${STATE.vendors.as_of||""}
      </div>`;
    setRows([[img]]);
    return;
  }

  // Load Chart.js once (CDN). If it fails, fallback to image.
  const ok = await loadScriptOnce("https://cdn.jsdelivr.net/npm/chart.js", "chartjs-cdn");
  if (!ok || typeof window.Chart === "undefined"){
    STATE.vendors.rows = []; // force fallback next render
    return renderVendors();
  }

  const labels = rows.map(r=>r.name);
  const data   = rows.map(r=>r.deals);

  const chartId = `vendorChart-${Date.now()}`;
  const container = `
    <div style="display:flex;justify-content:center">
      <div style="width:min(700px,92vw);">
        <canvas id="${chartId}" width="700" height="420"></canvas>
        <div style="margin-top:8px;color:#9fb0c8;font-size:12px;text-align:center">
          Last ${STATE.vendors.window_days||45} days as of ${STATE.vendors.as_of||""}
        </div>
      </div>
    </div>`;
  setRows([[container]]);

  const ctx = document.getElementById(chartId).getContext("2d");
  new window.Chart(ctx, {
    type: "pie",
    data: {
      labels,
      datasets: [{ data }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "right", labels: { color:"#cfd7e3" } },
        tooltip:{ callbacks:{ label:(ctx)=> `${ctx.label}: ${fmtInt(ctx.parsed)} deals` } }
      }
    }
  });
}

/* ---------------- Router ---------------- */
function renderCurrentView(){
  try{
    updateSummary();
    const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
    if      (v === "roster")  renderRoster();
    else if (v === "av")      renderWeekAV();
    else if (v === "aotw")    renderAOTW();
    else if (v === "vendors") renderVendors();
    else                      renderRoster();
  } catch(e){
    log("render err", e?.message||e);
    setHead([]); setRows([]);
  }
}

/* ---------------- Boot ---------------- */
async function boot(){
  try{
    massageSummaryLayout();
    await loadStatic();
    await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
    renderCurrentView();

    // periodic refresh
    setInterval(async ()=>{
      try{
        await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
        renderCurrentView();
      }catch(e){ log("refresh tick error", e?.message||e); }
    }, DATA_MS);

    // rotation (unless pinned with ?view=…)
    if (!VIEW_OVERRIDE){
      setInterval(()=>{
        viewIdx = (viewIdx + 1) % VIEWS.length;
        renderCurrentView();
      }, ROTATE_MS);
    }
  }catch(e){
    console.error("Dashboard boot error:", e);
    const tbody = $("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  try { boot(); } catch(e){ console.error("boot() parse/runtime error:", e); }
});
/* =================================== End =================================== */
