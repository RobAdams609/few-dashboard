/* ========================= FEW Dashboard — single file =========================
   - One centered Rule banner (rotates daily from /rules.json)
   - 4 rotating boards: Roster, Weekly AV, Agent of the Week, Vendors, plus YTD
   - Uses Netlify Functions you already have:
       /api/team_sold (authoritative sales + per-sale rows)
       /api/calls_by_agent (weekly calls/leads/sold aggregation; OK if empty)
   - Pulls static:
       /headshots/roster.json    (array OR {agents:[]})
       /ytd_av.json + /ytd_total.json
       /sales_by_vendor.json OR falls back to /sales_by_vendor.png
   - Safe against missing/empty endpoints (renders what’s available)
=============================================================================== */
"use strict";

/* ---------- Config ---------- */
const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;                      // refresh data every 30s
const ROTATE_MS = 30_000;                      // rotate boards every 30s
const BOARDS    = ["roster","av","aotw","vendors","ytd"];
const PINNED    = (new URLSearchParams(location.search).get("view")||"").toLowerCase();

/* ---------- Tiny DOM helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const escapeHtml = s => String(s??"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));

/* ---------- Format helpers ---------- */
const fmtInt    = n => Number(n||0).toLocaleString("en-US");
const fmtMoney  = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct    = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials  = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const hmm       = mins => { const mm=Math.max(0,Math.round(Number(mins||0))); const h=Math.floor(mm/60), m2=mm%60; return `${h}:${String(m2).padStart(2,"0")}`; };
const toET      = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

/* ---------- Generic JSON fetch (same-origin safe) ---------- */
async function getJSON(u){
  const url = /^https?:\/\//i.test(u) ? u : (u.startsWith("/") ? u : "/" + u);
  try{
    const r = await fetch(url + (url.includes("?")?"&":"?") + "t=" + Date.now(), { cache:"no-store" });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }catch(e){
    console.warn("getJSON failed:", url, e?.message||e);
    return null;
  }
}

/* ---------- Weekly window (Fri→Fri ET) ---------- */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                 // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;           // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                       // [inclusive, exclusive)
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                                // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),                 // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),                 // key -> {sales,amount,av12x}
  prevSalesByKey: new Map(),                 // snapshot for splash heuristic
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  vendors: { as_of:"", window_days:45, rows:[] },
  seenSaleHashes: new Set(),
};
const keyOf = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- One centered rule banner ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");]

  // remove legacy banners if present
  ["ticker","principle","ruleBanner","rule-banner-css"].forEach(id=>{
    const el = document.getElementById(id); if (el) el.remove();
  });

  if (!document.getElementById("rule-banner-css")){
    const el = document.createElement("style");
    el.id = "rule-banner-css";
    el.textContent = `
      #ruleBanner{ display:flex; align-items:center; justify-content:center; text-align:center;
        padding:18px 24px; margin:10px auto; max-width:1280px; border-radius:18px;
        background: rgba(255,255,255,0.03);
        box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,255,255,.06); }
      #ruleBanner .ruleText{ font-weight: 1000; letter-spacing:.6px; color:#cfd6de;
        font-size: clamp(28px, 3.4vw, 48px); line-height: 1.15; }
      .ruleBanner-host{ position:relative; z-index:2; }
    `;
    document.head.appendChild(el);
  }
  let host = document.querySelector(".ruleBanner-host");
  if (!host){
    host = document.createElement("div");
    host.className = "ruleBanner-host";
    const target = document.querySelector("#app") || document.body;
    target.insertBefore(host, target.firstChild);
  }
  host.innerHTML = `<div id="ruleBanner"><div class="ruleText">${escapeHtml(text)}</div></div>`;
}

/* ---------- Summary + table helpers ---------- */
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
function updateSummary(){
  const callsEl=$("#sumCalls"), avEl=$("#sumSales"), dealsEl=$("#sumTalk");
  if (callsEl) callsEl.textContent = fmtInt(STATE.team.calls);
  if (avEl)     avEl.textContent   = fmtMoney(STATE.team.av);
  if (dealsEl)  dealsEl.textContent= fmtInt(STATE.team.deals||0);
}

/* ---------- Avatar helpers ---------- */
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

/* ---------- Static assets ---------- */
async function loadStatic(){
  // Rules
  const rulesRaw = await getJSON("/rules.json");
  const ruleList = Array.isArray(rulesRaw) ? rulesRaw
                  : (Array.isArray(rulesRaw?.rules) ? rulesRaw.rules : []);
  if (ruleList.length) setRuleText({ rules: ruleList });

  // Roster (array OR {agents:[]})
  const rosterRaw = await getJSON("/headshots/roster.json");
  const list = Array.isArray(rosterRaw) ? rosterRaw
             : (Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : []);
  STATE.roster = list.map(a => ({
    name  : a.name || "",
    email : String(a.email||"").trim().toLowerCase(),
    photo : a.photo || "",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  // Vendors
  const vRaw = await getJSON("/sales_by_vendor.json");
  if (vRaw){
    const rowsRaw = Array.isArray(vRaw?.vendors) ? vRaw.vendors
                 : (Array.isArray(vRaw) ? vRaw : []);
    const rows = rowsRaw.map(v => ({
      name  : String(v.name||""),
      deals : Number(v.deals != null ? v.deals :
                     v.percent != null ? Math.round(Number(v.percent)*10) : 0)
    })).filter(r=>r.name);
    STATE.vendors = {
      as_of: vRaw.as_of || "",
      window_days: Number(vRaw.window_days || 45),
      rows
    };
  }else{
    STATE.vendors = { as_of:"", window_days:45, rows:[] };
  }
}

/* ---------- Calls (best effort; may be empty) ---------- */
async function refreshCalls(){
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();

  try{
    const payload = await getJSON("/api/calls_by_agent");
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
    const emailToKey = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), keyOf(a)]));
    const nameToKey  = new Map(STATE.roster.map(a => [String(a.name ||"").trim().toLowerCase(),  keyOf(a)]));

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
  }catch(e){ console.warn("calls_by_agent error", e?.message||e); }

  STATE.callsWeekByKey = byKey;
  STATE.team.calls = Math.max(0, Math.round(teamCalls));
  STATE.team.talk  = Math.max(0, Math.round(teamTalk));
  STATE.team.leads = Math.max(0, Math.round(teamLeads));
  STATE.team.sold  = Math.max(0, Math.round(teamSold));
}

/* ---------- Sales / AV (authoritative from /api/team_sold) ---------- */
async function refreshSales(){
  const prevDeals = Number(STATE.team.deals||0);
  const prevByKey = new Map(STATE.salesWeekByKey);

  let perByName = new Map();
  let totalDeals = 0;
  let totalAV    = 0;

  try{
    const payload = await getJSON("/api/team_sold");
    const [WSTART, WEND] = weekRangeET();

    const rawPerSale = Array.isArray(payload?.allSales) ? payload.allSales : null;
    if (rawPerSale && rawPerSale.length){
      for (const s of rawPerSale){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;

        const key    = String(s.agent||"").trim().toLowerCase();
        const amount = Number(s.amount||0);
        const cur = perByName.get(key) || { sales:0, amount:0, av12x:0 };
        cur.sales  += 1;
        cur.amount += amount;
        cur.av12x   = cur.amount * 12;
        perByName.set(key, cur);

        totalDeals += 1;
        totalAV    += amount*12;

        // splash de-duped by a minimal hash
        const hash = `${s.leadId||""}|${s.soldProductId||""}|${s.dateSold||""}`;
        if (!STATE.seenSaleHashes.has(hash)){
          STATE.seenSaleHashes.add(hash);
          // (no audible splash in this build; can wire one later)
        }
      }
    }else{
      const pa = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of pa){
        const key    = String(a.name||"").trim().toLowerCase();
        const sales  = Number(a.sales||0);
        const amount = Number(a.amount||0);
        perByName.set(key, { sales, amount, av12x: amount*12 });
        totalDeals += sales;
        totalAV    += amount*12;
      }
    }
  }catch(e){
    console.warn("team_sold error", e?.message||e);
  }

  const out = new Map();
  for (const a of STATE.roster){
    const nk = String(a.name||"").toLowerCase();
    const s  = perByName.get(nk) || { sales:0, amount:0, av12x:0 };
    out.set(keyOf(a), s);
  }

  STATE.prevSalesByKey = prevByKey;
  STATE.salesWeekByKey = out;
  STATE.team.av        = Math.max(0, Math.round(totalAV));
  STATE.team.deals     = Math.max(0, Math.round(totalDeals));
}

/* ---------- YTD list ---------- */
async function loadYTD(){
  try{
    const list = await getJSON("/ytd_av.json");
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
  }catch(e){
    console.warn("ytd load error", e?.message||e);
    STATE.ytd = { list:[], total:0 };
  }
}

/* ---------- Derived + renderers ---------- */
function bestOfWeek(){
  const entries = STATE.roster.map(a=>{
    const s = STATE.salesWeekByKey.get(keyOf(a)) || { av12x:0, sales:0, amount:0 };
    return { a, av12x:Number(s.av12x||0), sales:Number(s.sales||0), salesAmt:Number(s.amount||0) };
  }).sort((x,y)=>{
    if (y.av12x !== x.av12x) return y.av12x - x.av12x;
    if (y.sales !== x.sales) return y.sales - x.sales;
    return y.salesAmt - x.salesAmt;
  });
  return entries[0] || null;
}

function renderRoster(){
  setLabel("This Week — Roster");
  setHead(["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %","Submitted AV"]);
  const rows = STATE.roster.map(a=>{
    const c = STATE.callsWeekByKey.get(keyOf(a)) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = STATE.salesWeekByKey.get(keyOf(a)) || { av12x:0, sales:0, amount:0 };
    const conv = c.leads > 0 ? (Number(s.sales||0) / c.leads) : null;
    return [
      avatarCell(a),
      fmtInt(c.calls),
      fmtInt(Math.round(c.talkMin)),
      hmm(c.loggedMin),
      fmtInt(c.leads),
      fmtInt(s.sales||0),
      fmtPct(conv),
      fmtMoney(s.av12x||0)
    ];
  });
  setRows(rows);
}

function renderWeekAV(){
  setLabel("This Week — Leaderboard (Submitted AV)");
  setHead(["Agent","Submitted AV"]);
  const ranked = STATE.roster
    .map(a=>({ a, val: Number((STATE.salesWeekByKey.get(keyOf(a))||{}).av12x||0) }))
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
    </div>`;
  setHead([]); setRows([[html]]);
}

function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days || 45} days)`);
  setHead([]);

  const rows = STATE.vendors.rows || [];
  if (!rows.length){
    const imgHtml = `<div style="display:flex;justify-content:center;padding:8px 0 16px">
      <img src="/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:72%;height:auto;opacity:.95"/>
    </div>
    <div style="text-align:center;color:#9fb0c8;font-size:13px;margin-top:6px;">Last ${STATE.vendors.window_days||45} days as of ${STATE.vendors.as_of||"—"}</div>`;
    setRows([[imgHtml]]); return;
  }

  const chartId  = `vendorChart_${Date.now()}`;
  const container= `<div style="display:flex;align-items:flex-start;justify-content:center;gap:16px;">
      <canvas id="${chartId}" width="520" height="520" style="max-width:520px;max-height:520px;"></canvas>
    </div>
    <div style="margin-top:8px;color:#9fb0c8;font-size:12px;text-align:center;">Last ${STATE.vendors.window_days||45} days as of ${STATE.vendors.as_of||"—"}</div>`;
  setRows([[container]]);

  if (window.Chart){
    const ctx = document.getElementById(chartId).getContext("2d");
    const labels = rows.map(r=>r.name);
    const data   = rows.map(r=>r.deals);
    new Chart(ctx, {
      type: "pie",
      data:{ labels, datasets:[{ data, borderWidth:0 }] },
      options:{
        responsive:true, maintainAspectRatio:true,
        plugins:{
          legend:{ position:"right", labels:{ color:"#cfd7e3", boxWidth:14, padding:10 } },
          tooltip:{ callbacks:{ label:(c)=> `${c.label}: ${fmtInt(c.raw)} deals` } }
        }
      }
    });
  }else{
    const png = `<div style="display:flex;justify-content:center;padding:8px 0 16px">
      <img src="/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:72%;height:auto;opacity:.95"/>
    </div>`;
    setRows([[png]]);
  }
}

function renderYTD(){
  setLabel("YTD — Leaders");
  setHead(["Agent","YTD AV (12×)"]);
  const rows = (STATE.ytd.list||[]).map(r=>{
    const a = { name:r.name, photo:r.photo };
    return [avatarCell(a), fmtMoney(r.av)];
  });
  setRows(rows);
}

/* ---------- Router ---------- */
let boardIdx = 0;
function renderBoard(){
  updateSummary();
  const v = PINNED || BOARDS[boardIdx % BOARDS.length];
  if (v === "roster")      renderRoster();
  else if (v === "av")     renderWeekAV();
  else if (v === "aotw")   renderAOTW();
  else if (v === "vendors")renderVendors();
  else if (v === "ytd")    renderYTD();
  else                     renderRoster();
}

/* ---------- Boot ---------- */
async function boot(){
  try{
    await loadStatic();
    await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
    renderBoard();

    setInterval(async ()=>{
      try{
        await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
        renderBoard();
      }catch(e){ console.warn("refresh tick error", e?.message||e); }
    }, DATA_MS);

    if (!PINNED){
      setInterval(()=>{ boardIdx = (boardIdx + 1) % BOARDS.length; renderBoard(); }, ROTATE_MS);
    }
  }catch(e){
    console.error("Dashboard boot error:", e);
    const tbody = $("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", boot);
(async function(){
  console.log("Roster fallback: starting…");
  const money = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
  const tbody = document.getElementById("tbody");
  const thead = document.getElementById("thead");
  const sumSales = document.getElementById("sumSales");
  const sumCalls = document.getElementById("sumCalls");
  const sumTalk  = document.getElementById("sumTalk");

  try {
    const r = await fetch("/api/team_sold?v="+Date.now());
    if (!r.ok) throw new Error("team_sold " + r.status);
    const sold = await r.json();

    // Summary cards
    if (sumCalls) sumCalls.textContent = "0";
    if (sumSales) sumSales.textContent = money(sold.team.totalAV12x);
    if (sumTalk)  sumTalk.textContent  = String(sold.team.totalSales);

    // Table header
    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Submitted AV (12×)</th>
      </tr>`;

    // Rows
    const rows = (sold.perAgent||[]).map(a => {
      const initials = (a.name||"").split(" ").map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
      return `
      <tr>
        <td class="agent">
          <span class="avatar-fallback">${initials}</span>
          <span>${a.name||""}</span>
        </td>
        <td class="num">${(a.sales||0).toLocaleString("en-US")}</td>
        <td class="num">${money((a.amount||0)*12)}</td>
      </tr>`;
    }).join("");

    tbody.innerHTML = rows || `<tr><td style="padding:14px;color:#7b8aa3">No sales found.</td></tr>`;
    console.log("Roster fallback: done.");
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td style="padding:14px;color:#f66">Roster fallback error: ${e.message}</td></tr>`;
  }
})();
