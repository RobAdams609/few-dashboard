/* ============ FEW Dashboard — Rewritten (single-file replacement) ============ */
/* - Purpose: reliable, defensive, merges API + manual overrides, vendor view from sales_by_vendor.json
   - Replace the entire old dashboard.js with this file.
*/

"use strict";

/* ---------- Config ---------- */
const DEBUG = new URLSearchParams(location.search).has("debug");
const log = (...a) => { if (DEBUG) console.log("[DBG]", ...a); };
const ET_TZ = "America/New_York";
const DATA_MS = 30_000;    // refresh every 30s
const ROTATE_MS = 30_000;
const VIEWS = ["roster","av","aotw","vendors","ytd"];
let viewIdx = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------- DOM helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- Format helpers ---------- */
const fmtInt = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct = n => (n == null ? "—" : ((Math.round(n*1000)/10).toFixed(1) + "%"));
const initials = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const escapeHtml = s => String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const toET = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){
  const r = await fetch(bust(u), { cache:"no-store" });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch(e){ throw new Error(`Bad JSON from ${u}: ${e.message}`); }
}
function hmm(mins){
  const mm = Math.max(0, Math.round(Number(mins||0)));
  const h = Math.floor(mm/60), m2 = mm%60;
  return `${h}:${String(m2).padStart(2,"0")}`;
}

/* ---------- Weekly window = Fri 00:00 ET -> next Fri 00:00 ET ---------- */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();            // Sun=0..Sat=6
  const sinceFri = (day + 2) % 7;      // number of days since last Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];
}

/* ---------- STATE ---------- */
const STATE = {
  roster: [],                  // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),   // key -> {sales,amount,av12x}
  overrides: { calls:null, av:null },
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  seenSaleHashes: new Set(),
  lastDealsShown: 0,
  vendors: { as_of: "", window_days: 45, rows: [] }  // new vendors state
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- Small UI helpers (kept familiar to original HTML) ---------- */
function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){
  const thead = $("#thead"); if (!thead) return;
  thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
}
function setRows(rows){
  const tbody = $("#tbody"); if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

/* ---------- Avatar helpers (keep original markup) ---------- */
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

/* ---------- Sale splash (keeps previous look + sound) ---------- */
(function initSaleSplash(){
  let queue = [];
  let showing = false;
  const SOUND_URL = "/100-bank-notes-counted-on-loose-note-counter-no-errors-327647.mp3";
  const baseAudio = new Audio(SOUND_URL); baseAudio.preload = "auto"; baseAudio.volume = 1.0;
  ["click","keydown","touchstart"].forEach(evt=>{
    window.addEventListener(evt, ()=>{
      baseAudio.play().then(()=>{ baseAudio.pause(); baseAudio.currentTime = 0; }).catch(()=>{});
    }, { once:true, passive:true });
  });
  function playSound(){ try{ const a = baseAudio.cloneNode(true); a.play().catch(()=>{}); a.addEventListener("ended",()=>a.remove()); }catch{} }

  function showNext(){
    if (showing || queue.length === 0) return;
    showing = true;
    const { name, amount, ms = 60_000 } = queue.shift();
    const av12 = Math.round(Number(amount || 0) * 12).toLocaleString("en-US");
    const host = document.createElement("div");
    host.className = "saleSplash-host";
    host.innerHTML = `
      <div class="saleSplash-backdrop" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:99999;background:rgba(0,0,0,.55)">
        <div class="saleSplash-card" style="padding:28px 40px;border-radius:20px;background:linear-gradient(170deg,#FFE79A,#FFD86B);text-align:center;">
          <div style="font-weight:900;font-size:28px;color:#111">${escapeHtml(String(name||"Team")).toUpperCase()}</div>
          <div style="margin-top:8px;font-weight:700;color:#222">SUBMITTED</div>
          <div style="margin-top:12px;font-weight:1000;font-size:44px;color:#111">$${av12} AV</div>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    requestAnimationFrame(()=> host.firstElementChild.style.opacity = 1);
    playSound();
    const t = setTimeout(()=>{ host.remove(); showing=false; showNext(); }, Math.max(3000, ms));
    host.addEventListener("click", ()=>{ clearTimeout(t); host.remove(); showing=false; showNext(); }, { once:true });
  }

  window.showSalePop = function({name, amount, ms}){
    queue.push({ name, amount, ms });
    showNext();
  };
})();

/* ---------- Summary layout & update ---------- */
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
      if (!keep) card.style.display = "none";
    });
    $$(".card").filter(c=>c.style.display!=="none").slice(3).forEach(c=> c.style.display="none");
  } catch(e){ log("massageSummaryLayout err", e?.message||e); }
}
function updateSummary(){
  if ($("#sumCalls")) $("#sumCalls").textContent = fmtInt(STATE.team.calls);
  if ($("#sumSales")) $("#sumSales").textContent = fmtMoney(STATE.team.av);
  const dealsEl = $("#sumTalk");
  if (dealsEl) {
    const lbl = dealsEl.previousElementSibling;
    if (lbl) lbl.textContent = "This Week — Deals Submitted";
    dealsEl.textContent = fmtInt(STATE.team.deals || 0);
  }
}

/* ---------- Load static assets & overrides ---------- */
async function loadStatic(){
  try {
    const [rosterRaw, rules] = await Promise.all([
      getJSON("/headshots/roster.json").catch(()=>[]),
      getJSON("/rules.json").catch(()=>[])
    ]);
    // set rule banner if present (preserve existing function if page provides)
    try { if (typeof setRuleText === "function") setRuleText(rules); } catch(e){ /* ignore */ }

    const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
    STATE.roster = list.map(a => ({
      name: a.name,
      email: (a.email||"").trim().toLowerCase(),
      photo: a.photo||"",
      phones: Array.isArray(a.phones) ? a.phones : []
    }));

    // overrides (optional)
    try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
    try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av = null; }

    // vendors file (optional) - if present set STATE.vendors
    try {
      const v = await getJSON("/sales_by_vendor.json");
      if (v && typeof v === "object" && Array.isArray(v.vendors)) {
        STATE.vendors = { as_of: v.as_of || "", window_days: v.window_days || 45, rows: v.vendors.slice() };
      }
    } catch(e){
      log("no sales_by_vendor.json or bad JSON", e?.message||e);
      // attempt to leave STATE.vendors as default
    }
  } catch(e){
    log("loadStatic error", e?.message||e);
  }
}

/* ---------- Refresh Calls (calls_by_agent) ---------- */
async function refreshCalls(){
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();
  try {
    const payload = await getJSON("/.netlify/functions/calls_by_agent").catch(e => { log("calls_by_agent fetch fail", e?.message||e); return { perAgent: [] }; });
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
    // build roster lookup
    const emailToKey = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), agentKey(a)]));
    const nameToKey  = new Map(STATE.roster.map(a => [String(a.name||"").trim().toLowerCase(),  agentKey(a)]));

    for (const r of per){
      const e = String(r.email||"").trim().toLowerCase();
      const n = String(r.name||"").trim().toLowerCase();
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
      teamCalls += row.calls; teamTalk += row.talkMin; teamLeads += row.leads; teamSold += row.sold;
    }
  } catch(e){ log("refreshCalls error", e?.message||e); }

  // Manual overrides for calls (replace per-agent rows if provided)
  try {
    if (STATE.overrides.calls && typeof STATE.overrides.calls === "object"){
      const byEmail = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), a]));
      for (const [email, o] of Object.entries(STATE.overrides.calls)){
        const a = byEmail.get(String(email).toLowerCase());
        if (!a) continue;
        const k = agentKey(a);
        const cur = byKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
        // subtract cur from totals
        teamCalls -= Number(cur.calls||0); teamTalk -= Number(cur.talkMin||0); teamLeads -= Number(cur.leads||0); teamSold -= Number(cur.sold||0);
        // set new row
        const row = {
          calls    : Number(o.calls||0),
          talkMin  : Number(o.talkMin||0),
          loggedMin: Number(o.loggedMin||0),
          leads    : Number(o.leads||0),
          sold     : Number(o.sold||0)
        };
        byKey.set(k, row);
        // add into totals
        teamCalls += row.calls; teamTalk += row.talkMin; teamLeads += row.leads; teamSold += row.sold;
      }
    }
  } catch(e){ log("calls override merge error", e?.message||e); }

  STATE.callsWeekByKey = byKey;
  STATE.team.calls = Math.max(0, Math.round(teamCalls));
  STATE.team.talk  = Math.max(0, Math.round(teamTalk));
  STATE.team.leads = Math.max(0, Math.round(teamLeads));
  STATE.team.sold  = Math.max(0, Math.round(teamSold));
}

/* ---------- Refresh Sales (team_sold) - merge API + optional manual AV override ---------- */
async function refreshSales(){
  try {
    const payload = await getJSON("/.netlify/functions/team_sold").catch(e => { log("team_sold fetch fail", e?.message||e); return {}; });
    const [WSTART, WEND] = weekRangeET();

    // primary per-agent bucket from raw sales rows (preferred)
    const perByName = new Map(); // key -> { sales, amount, av12x }
    let totalDeals = 0, totalAV = 0;
    let newest = null;

    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];
    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;
        if (!newest || when > toET(newest?.dateSold||0)) newest = s;

        const name = String(s.agent||"").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const amount = Number(s.amount||0);
        const cur = perByName.get(key) || { sales:0, amount:0, av12x:0 };
        cur.sales += 1;
        cur.amount += amount;
        cur.av12x = cur.amount * 12;
        perByName.set(key, cur);

        totalDeals += 1;
        totalAV += amount * 12;
      }
    } else {
      // Fallback: the API returned perAgent aggregates
      const pa = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of pa){
        const key = String(a.name||"").trim().toLowerCase();
        const sales = Number(a.sales||0);
        const amount = Number(a.amount||0);
        perByName.set(key, { sales, amount, av12x: amount*12 });
        totalDeals += sales;
        totalAV += amount*12;
      }
    }

    // Now apply manual AV overrides (if present) — these replace the displayed per-agent values
    // Important: do NOT remove API data — just set them in perByName and update totals accordingly.
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      const oa = STATE.overrides.av.perAgent || {};
      // To avoid double-counting totals, first subtract any existing agent totals that are being overridden,
      // then add the override values.
      for (const [rawName, v] of Object.entries(oa)){
        const k = String(rawName||"").trim().toLowerCase();
        const sales = Number(v.sales || 0);
        const av12x = Number(v.av12x || 0);
        const prev = perByName.get(k) || { sales:0, av12x:0 };
        // adjust totals
        totalDeals -= Number(prev.sales||0);
        totalAV   -= Number(prev.av12x||0);
        // set override
        perByName.set(k, { sales, amount: av12x/12, av12x });
        // add override to totals
        totalDeals += sales;
        totalAV   += av12x;
      }

      // team-level manual override (one-time totals)
      if (STATE.overrides.av.team){
        // The team override is stored as av12x and totalSales; treat it as an additive or replacement?
        // Behavior: treat team override as additive correction delta (like the prior code: add into totals).
        // It's safer: if the file was intended to reflect the full totals, you'd set per-agent values above.
        // Here we will **add** the team totals so operator can use it as final correction.
        const tAddAV = Number(STATE.overrides.av.team.totalAV12x || 0);
        const tAddSls = Number(STATE.overrides.av.team.totalSales || 0);
        if (tAddAV !== 0 || tAddSls !== 0){
          totalAV += tAddAV;
          totalDeals += tAddSls;
        }
      }
    }

    // Build STATE.salesWeekByKey keyed by agentKey (based on roster entries)
    const out = new Map();
    for (const a of STATE.roster){
      const k = agentKey(a);
      const nk = String(a.name||"").toLowerCase();
      const s = perByName.get(nk) || { sales:0, amount:0, av12x:0 };
      out.set(k, s);
    }

    // Save totals and map
    const prevDeals = STATE.team.deals || 0;
    STATE.salesWeekByKey = out;
    STATE.team.av = Math.max(0, Math.round(totalAV));
    STATE.team.deals = Math.max(0, Math.round(totalDeals));

    // Splash logic:
    // 1) If we saw a raw sale row in-window, splash the newest unique one (use seenSaleHashes to prevent duplicates)
    if (newest){
      const h = `${newest.leadId||""}|${newest.soldProductId||""}|${newest.dateSold||""}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        window.showSalePop({ name:newest.agent || "Team", amount:newest.amount || 0, ms:60_000 });
      }
    }

    // 2) Fallback: if the total deal count increased but we didn't see the raw row (some APIs return only aggregates)
    if (!newest && STATE.team.deals > prevDeals && STATE.team.deals > STATE.lastDealsShown){
      // pick agent with best (sales*10000 + amount)
      let best = { name:"Team", amount:0, _score:0 };
      for (const a of STATE.roster){
        const k = agentKey(a);
        const s = STATE.salesWeekByKey.get(k) || { sales:0, amount:0 };
        const score = (s.sales||0) * 10000 + (s.amount||0);
        if (score > best._score){
          best = { name: a.name, amount: s.amount||0, _score: score };
        }
      }
      window.showSalePop({ name:best.name, amount:best.amount || 0, ms:60_000 });
      STATE.lastDealsShown = STATE.team.deals;
    }
  } catch(e){
    log("refreshSales error", e?.message||e);
    STATE.salesWeekByKey = new Map();
    STATE.team.av = 0;
    STATE.team.deals = 0;
  }
}

/* ---------- Load YTD (keeps original behavior) ---------- */
async function loadYTD(){
  try {
    const list = await getJSON("/ytd_av.json").catch(()=>[]);
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
    log("loadYTD error", e?.message||e);
    STATE.ytd = { list:[], total:0 };
  }
}

/* ---------- Derived helpers ---------- */
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

/* ---------- Renderers ---------- */
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

/* ---------- Vendor renderer (uses STATE.vendors & Chart.js if available) ---------- */
function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days || 45} days)`);
  setHead([]); // no table header for graphic layout

  // If we have vendor rows render a sleek pie (or fallback to image)
  const rows = STATE.vendors.rows || [];
  if (!rows.length){
    // fallback: show image placeholder or text
    const imgHtml = `<div style="display:flex;justify-content:center;padding:8px 0 16px">
      <img src="/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:100%;height:auto;opacity:.95"/>
    </div><div style="text-align:center;color:#9fb0c8;margin-top:8px">Last ${STATE.vendors.window_days} days as of ${STATE.vendors.as_of || "today"}</div>`;
    setRows([[imgHtml]]);
    return;
  }

  // Create canvas container
  const chartId = `vendorChart-${Date.now()}`;
  const container = `<div style="display:flex;align-items:center;flex-direction:column;gap:8px">
    <canvas id="${chartId}" width="600" height="360" style="max-width:100%;height:auto"></canvas>
    <div style="margin-top:8px;color:#9fb0c8;font-size:12px">Last ${STATE.vendors.window_days} days as of ${STATE.vendors.as_of || "today"}</div>
  </div>`;
  setRows([[container]]);

  // load Chart.js dynamically if needed
  function drawChart(){
    try {
      const labels = rows.map(r => r.name);
      const data = rows.map(r => Number(r.deals||0));
      const ctx = document.getElementById(chartId).getContext('2d');
      // Simple modern color palette
      const palette = [
        "#00a3ff","#00d4a6","#ffd36a","#ff7b7b","#b28cff","#7ad0ff","#ffb36a","#7fffbe","#9be6ff","#ffd7f0",
        "#cfe6a6","#ffd3a6"
      ];
      const bg = data.map((_,i)=> palette[i % palette.length]);
      // if Chart exists from prior render, destroy it
      if (window.__vendorChart && window.__vendorChart.destroy) { try{ window.__vendorChart.destroy(); }catch{} }
      // create chart
      window.__vendorChart = new Chart(ctx, {
        type: 'pie',
        data: { labels, datasets: [{ data, backgroundColor: bg, borderWidth:1 }] },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'right', labels: { usePointStyle:true, padding:12 } },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} deals (${Math.round((ctx.raw/ (data.reduce((s,x)=>s+x,0)||1))*100)}%)` } }
          }
        }
      });
    } catch(e){
      log("drawChart failed:", e?.message||e);
      // fall back to simple table
      const tableRows = rows.map(r => `<tr><td style="padding:6px 8px">${escapeHtml(r.name)}</td><td style="padding:6px 8px;text-align:right">${fmtInt(r.deals)}</td></tr>`).join("");
      const table = `<table style="width:60%;margin:12px auto;border-collapse:collapse;background:transparent"><tbody>${tableRows}</tbody></table>`;
      setRows([[table]]);
    }
  }

  // Try to use Chart global; if not present inject CDN and draw when ready
  if (typeof Chart === "undefined"){
    const url = "https://cdn.jsdelivr.net/npm/chart.js";
    if (!document.querySelector(`script[src="${url}"]`)){
      const s = document.createElement("script");
      s.src = url; s.async = true;
      s.onload = ()=> setTimeout(drawChart, 80);
      s.onerror = ()=> { log("Chart.js load error"); drawChart(); };
      document.head.appendChild(s);
    } else {
      // already loading, wait and draw
      setTimeout(drawChart, 150);
    }
  } else {
    drawChart();
  }
}

/* ---------- YTD renderer ---------- */
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
function renderCurrentView(){
  try {
    updateSummary();
    const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
    if (v === "roster") renderRoster();
    else if (v === "av") renderWeekAV();
    else if (v === "aotw") renderAOTW();
    else if (v === "vendors") renderVendors();
    else if (v === "ytd") renderYTD();
    else renderRoster();
  } catch(e){ log("render err", e?.message||e); setHead([]); setRows([]); }
}

/* ---------- Boot sequence ---------- */
async function boot(){
  try{
    massageSummaryLayout();
    await loadStatic();
    // first run
    await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
    renderCurrentView();

    // periodic refresh ticker
    setInterval(async ()=>{
      try{
        await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
        renderCurrentView();
      }catch(e){ log("tick error", e?.message||e); }
    }, DATA_MS);

    // rotate views unless pinned
    if (!VIEW_OVERRIDE){
      setInterval(()=>{
        viewIdx = (viewIdx + 1) % VIEWS.length;
        renderCurrentView();
      }, ROTATE_MS);
    }
  } catch(e){
    console.error("Dashboard boot error:", e);
    const tbody = $("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
  }
}

/* ---------- Start on DOM ready ---------- */
document.addEventListener("DOMContentLoaded", () => {
  try { boot(); } catch(e){ console.error("boot() parse/runtime error:", e); }
});

/* ============================== End rewritten dashboard.js ============================== */
