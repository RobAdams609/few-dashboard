/* ============ FEW Dashboard — COMPLETE FILE (v3 + full-screen deal banner) ============ */
"use strict";

/* ---------- Config ---------- */
const DEBUG    = new URLSearchParams(location.search).has("debug");
const log      = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };
const ET_TZ    = "America/New_York";
const DATA_MS  = 30_000;                      // refresh data
const ROTATE_MS= 30_000;                      // switch table view
const VIEWS    = ["roster","av","aotw","vendors","ytd"]; // rotation order (vendors re-added)
let   viewIdx  = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------- Dom helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- Format helpers ---------- */
const fmtInt    = n => Number(n||0).toLocaleString("en-US");
const fmtMoney  = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct    = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials  = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const escapeHtml= s => String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const toET      = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){ const r=await fetch(bust(u),{cache:"no-store"}); if(!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); }
function hmm(mins){ const mm=Math.max(0,Math.round(Number(mins||0))); const h=Math.floor(mm/60), m2=mm%60; return `${h}:${String(m2).padStart(2,"0")}`; }

/* Weekly window = Friday 12:00am ET → next Friday 12:00am ET */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;          // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                      // [inclusive, exclusive)
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                  // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),   // key -> {sales,salesAmt,av12x}
  overrides: { calls:null, av:null },
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- Headline rule (ticker) ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
  $("#ticker")     && ($("#ticker").textContent    = `RULE OF THE DAY — ${text}`);
  $("#principle")  && ($("#principle").textContent = text);
}

/* ---------- Simple table helpers ---------- */
function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){ const thead=$("#thead"); if(thead) thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`; }
function setRows(rows){
  const tbody = $("#tbody");
  if (!tbody) return;
  tbody.innerHTML = rows.length
    ? rows.map(r => `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
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

/* =======================================================================
   FULL-SCREEN CENTER “SPLAT” DEAL BANNER  (replaces old tiny toast)
   - 60s on screen
   - queues back-to-back sales
   - shows: Agent Name + Submitted AV (12×)
   ======================================================================= */
let SALE_QUEUE = [];
let SALE_ACTIVE = false;

function ensureSaleBannerDOM(){
  if ($("#saleSplat")) return;
  // style (one-time)
  if (!$("#saleSplatStyles")){
    const css = document.createElement("style");
    css.id = "saleSplatStyles";
    css.textContent = `
      #saleSplat{
        position:fixed; inset:0; display:none; place-items:center; z-index:9999;
        background:rgba(0,0,0,0.65); backdrop-filter: blur(2px);
      }
      #saleSplat.show{ display:grid; }
      #saleCard{
        max-width: 72vw; width: 72vw; max-height: 80vh;
        background: radial-gradient(1200px 500px at 50% -10%, rgba(255,255,255,0.08), transparent 60%),
                    rgba(20,24,32,0.92);
        border: 3px solid rgba(255,211,106,0.45);
        box-shadow: 0 30px 90px rgba(0,0,0,0.70), 0 0 80px rgba(255,211,106,0.08) inset;
        border-radius: 28px;
        padding: 48px 56px;
        transform: scale(0.92) rotate(-1deg);
        animation: popIn 300ms ease-out forwards;
        text-align:center;
      }
      #saleWho{
        font-size: clamp(26px, 3.6vw, 48px);
        font-weight: 900;
        letter-spacing: 0.5px;
        color:#fff3c2;
        margin: 0 0 10px;
        text-shadow: 0 2px 0 rgba(0,0,0,0.6);
      }
      #saleWhat{
        font-size: clamp(42px, 7.4vw, 120px);
        font-weight: 1000;
        color:#ffd36a;
        margin: 0 0 8px;
        line-height: 1.05;
        text-shadow: 0 8px 22px rgba(0,0,0,0.55);
      }
      #saleSub{
        font-size: clamp(16px, 2.2vw, 28px);
        color:#b7c4d8;
        letter-spacing: .3px;
      }
      @keyframes popIn{ to{ transform: scale(1) rotate(0deg);} }
    `;
    document.head.appendChild(css);
  }
  // container
  const wrap = document.createElement("div");
  wrap.id = "saleSplat";
  wrap.innerHTML = `
    <div id="saleCard">
      <div id="saleWho">New Deal</div>
      <div id="saleWhat">$0 AV</div>
      <div id="saleSub">To get, give.</div>
    </div>`;
  document.body.appendChild(wrap);
}

function showSalePop({name, amount}){
  // enqueue request; banner runner will display one at a time
  SALE_QUEUE.push({ name: String(name||"Team"), amount: Number(amount||0) });
  drainSaleQueue();
}

function drainSaleQueue(){
  if (SALE_ACTIVE || SALE_QUEUE.length===0) return;
  SALE_ACTIVE = true;

  ensureSaleBannerDOM();
  const item = SALE_QUEUE.shift();
  const av12 = Math.max(0, Math.round(item.amount * 12));
  const $wrap = $("#saleSplat");
  const $who  = $("#saleWho");
  const $what = $("#saleWhat");
  const $sub  = $("#saleSub");

  $who.textContent  = `${item.name} — New Deal`;
  $what.textContent = `${fmtMoney(av12)} AV`;
  $sub.textContent  = "THE FEW";

  $wrap.classList.add("show");

  // keep on screen 60s
  setTimeout(()=>{
    $wrap.classList.remove("show");
    SALE_ACTIVE = false;
    // slight gap so back-to-back animations snap cleanly
    setTimeout(drainSaleQueue, 250);
  }, 60_000);
}
/* ======================================================================= */

/* ---------- Force exactly 3 KPI cards ---------- */
function massageSummaryLayout(){
  const callsVal = $("#sumCalls"); // will show Team Calls
  const avVal    = $("#sumSales"); // repurposed to Total Submitted AV
  const dealsVal = $("#sumTalk");  // repurposed to Deals Submitted

  if (callsVal){ const l = callsVal.previousElementSibling; if (l) l.textContent = "This Week — Team Calls"; }
  if (avVal){    const l = avVal.previousElementSibling;    if (l) l.textContent = "This Week — Total Submitted AV"; }
  if (dealsVal){ const l = dealsVal.previousElementSibling; if (l) l.textContent = "This Week — Deals Submitted"; }

  // Hide any other KPI cards present in the HTML
  $$(".card").forEach(card=>{
    const keep = card.contains(callsVal) || card.contains(avVal) || card.contains(dealsVal);
    if (!keep) card.style.display = "none";
  });

  // Ensure no more than 3 visible
  $$(".card").filter(c=>c.style.display!=="none").slice(3).forEach(c=> c.style.display="none");
}

/* ---------- KPI values ---------- */
function updateSummary(){
  $("#sumCalls") && ($("#sumCalls").textContent = fmtInt(STATE.team.calls));
  $("#sumSales") && ($("#sumSales").textContent = fmtMoney(STATE.team.av));

  const dealsEl = $("#sumTalk");
  if (dealsEl) {
    const lbl = dealsEl.previousElementSibling;
    if (lbl) lbl.textContent = "This Week — Deals Submitted";
    dealsEl.textContent = fmtInt(STATE.team.deals || 0);
  }
}

/* ---------- Load static assets & overrides ---------- */
async function loadStatic(){
  const [rosterRaw, rules] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[])
  ]);
  setRuleText(rules);

  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
  try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av    = null; }
}

/* ---------- Ringy: Calls / Talk / Leads / Sold ---------- */
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
        sold     : Number(r.sold||0),
      };
      byKey.set(k, row);
      teamCalls += row.calls;
      teamTalk  += row.talkMin;
      teamLeads += row.leads;
      teamSold  += row.sold;
    }
  }catch(e){ log("calls_by_agent error", e?.message||e); }

  // Manual overrides (optional)
  if (STATE.overrides.calls && typeof STATE.overrides.calls === "object"){
    const byEmail = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), a]));
    for (const [email, o] of Object.entries(STATE.overrides.calls)){
      const a = byEmail.get(String(email).toLowerCase());
      if (!a) continue;
      const k   = agentKey(a);
      const cur = byKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };

      teamCalls -= cur.calls; teamTalk -= cur.talkMin; teamLeads -= cur.leads; teamSold -= cur.sold;

      const row = {
        calls    : Number(o.calls||0),
        talkMin  : Number(o.talkMin||0),
        loggedMin: Number(o.loggedMin||0),
        leads    : Number(o.leads||0),
        sold     : Number(o.sold||0),
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

/* ---------- Ringy: Weekly Sales → AV(12×) & Deals ---------- */
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    const [WSTART, WEND] = weekRangeET();
    const perByName = new Map();     // nameKey -> { sales, amount, av12x }
    let totalDeals = 0;
    let totalAV    = 0;

    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];
    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;

        const name   = String(s.agent||"").trim();
        if (!name) continue;
        const key    = name.toLowerCase();
        const amount = Number(s.amount||0);

        const cur = perByName.get(key) || { sales:0, amount:0, av12x:0 };
        cur.sales  += 1;
        cur.amount += amount;
        cur.av12x   = cur.amount * 12;
        perByName.set(key, cur);

        totalDeals += 1;
        totalAV    += amount * 12;
      }
    } else {
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

    // --- Apply manual AV overrides (merge, don't wipe) ---
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      // per agent
      const oa = STATE.overrides.av.perAgent || {};
      for (const [rawName, v] of Object.entries(oa)){
        const k = String(rawName||"").trim().toLowerCase();
        const cur = perByName.get(k) || { sales:0, amount:0, av12x:0 };
        // Replace agent row with the override exactly (your stated behavior)
        const sales = Number(v.sales || 0);
        const av12x = Number(v.av12x ||
