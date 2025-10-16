/* ============ FEW Dashboard — COMPLETE FILE (one centered banner + modern vendors chart) ============ */
"use strict";

/* ---------- Config ---------- */
const DEBUG     = new URLSearchParams(location.search).has("debug");
const log       = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };
const ET_TZ     = "America/New_York";
const DATA_MS   = 30_000;   // refresh data every 30s
const ROTATE_MS = 30_000;   // rotate views every 30s
const VIEWS     = ["roster","av","aotw","vendors","ytd"];
let   viewIdx   = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------- DOM helpers ---------- */
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
async function getJSON(u){
  const r = await fetch(bust(u), { cache:"no-store" });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch(e){ throw new Error(`Bad JSON from ${u}: ${e.message}`); }
}
function hmm(mins){
  const mm=Math.max(0,Math.round(Number(mins||0)));
  const h=Math.floor(mm/60), m2=mm%60;
  return `${h}:${String(m2).padStart(2,"0")}`;
}

/* ---------- Weekly window = Fri 12:00am ET -> next Fri 12:00am ET ---------- */
function weekRangeET(){
  const now = toET(new Date());                 // in ET
  const day = now.getDay();                     // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;               // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                           // [inclusive, exclusive)
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                  // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),   // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),   // key -> {sales,amount,av12x}
  overrides: { calls:null, av:null },
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  seenSaleHashes: new Set(),   // stop duplicate splashes (leadId|soldProductId|dateSold)
  lastDealsShown: 0,           // fallback: if deals count increases, show splash for newest
  vendors: { as_of:"", window_days:45, rows:[] } // <- for the lead-vendor chart
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- ONE (and only one) Rule banner, centered & bold ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");

  // Remove any legacy rule nodes
  ["ticker","principle","ruleBanner","rule-banner-css"].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  if (!document.getElementById("rule-banner-css")){
    const el = document.createElement("style");
    el.id = "rule-banner-css";
    el.textContent = `
      #ruleBanner{
        display:flex; align-items:center; justify-content:center; text-align:center;
        padding:22px 26px; margin:8px auto 12px; max-width:1200px; border-radius:18px;
        background: rgba(255, 206, 86, 0.08);
        border: 2px solid rgba(255, 206, 86, .35);
        box-shadow: 0 10px 30px rgba(0,0,0,.30), inset 0 0 0 2px rgba(255,206,86,.12);
      }
      #ruleBanner .ruleText{
        font-weight: 1000;
        font-size: clamp(22px, 2.8vw, 44px);
        color:#ffe08a;
        letter-spacing:.6px;
        text-shadow: 0 3px 12px rgba(0,0,0,.35);
      }
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
  host.innerHTML = `
    <div id="ruleBanner">
      <span class="ruleText">${escapeHtml(text)}</span>
    </div>
  `;
}

/* ---------- Simple table helpers ---------- */
function setLabel(txt){ const el = $("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){
  const thead=$("#thead"); if (!thead) return;
  thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
}
function setRows(rows){
  const tbody = $("#tbody"); if (!tbody) return;
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

/* ---------- Sale Splash CSS (gold) ---------- */
function injectCssOnce(){
  if (document.getElementById("sale-splash-css")) return;
  const css = `
    :root{ --gold-1:#FFE79A; --gold-2:#FFD86B; --gold-3:#E1B64F; --gold-glow:rgba(255, 215, 128, .35); }
    .saleSplash-backdrop{ position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.55); backdrop-filter: blur(4px); opacity:0; transition: opacity .28s ease; }
    .saleSplash-card{ display:flex; flex-direction:column; align-items:center; gap:10px; padding:28px 40px; border-radius:28px;
      background:linear-gradient(170deg, var(--gold-1) 0%, var(--gold-2) 40%, var(--gold-3) 100%);
      border:1px solid rgba(255,255,255,.18); box-shadow: 0 18px 60px rgba(0,0,0,.45), 0 0 0 3px var(--gold-glow) inset;
      transform:scale(.96) translateY(6px); opacity:.98; transition: transform .28s ease, opacity .28s ease, box-shadow .28s ease; }
    .saleSplash-title{ font-size: clamp(28px, 5vw, 56px); font-weight: 900; letter-spacing:.4px; color:#1a1a1a; text-shadow: 0 1px 0 rgba(255,255,255,.35); }
    .saleSplash-sub{ font-size: clamp(14px, 2.4vw, 20px); font-weight:800; letter-spacing:.5px; color:#2a2a2a; opacity:.8; }
    .saleSplash-amount{ font-size: clamp(36px, 7.2vw, 88px); font-weight: 1000; letter-spacing:.6px; line-height:1.02; color:#111;
      text-shadow: 0 1px 0 rgba(255,255,255,.45), 0 10px 30px rgba(0,0,0,.30); }
    @media (max-width: 900px){ .saleSplash-card{ padding:20px 24px; border-radius:22px; } }
    .saleSplash-show .saleSplash-backdrop{ opacity:1; } .saleSplash-show .saleSplash-card{ transform:scale(1) translateY(0); }
  `;
  const el = document.createElement("style");
  el.id = "sale-splash-css";
  el.textContent = css;
  document.head.appendChild(el);
}

/* ---------- Full-screen sale splash + sound ---------- */
(function initSaleSplash(){
  let queue = [];
  let showing = false;
  const SOUND_URL = "/100-bank-notes-counted-on-loose-note-counter-no-errors-327647.mp3";
  const baseAudio = new Audio(SOUND_URL); baseAudio.preload = "auto"; baseAudio.volume = 1.0;

  function playSound(){ try{ const a = baseAudio.cloneNode(true); a.currentTime=0; a.play().catch(()=>{}); a.addEventListener("ended",()=>a.remove()); }catch{} }
  ["click","keydown","touchstart"].forEach(evt=>{
    window.addEventListener(evt, ()=>{ baseAudio.play().then(()=>{ baseAudio.pause(); baseAudio.currentTime=0; }).catch(()=>{}); },
      { once:true, passive:true });
  });

  function showNext(){
    if (showing || queue.length === 0) return;
    showing = true; injectCssOnce();
    const { name, amount, ms = 60_000 } = queue.shift();
    const av12 = Math.round(Number(amount || 0)).toLocaleString("en-US");
    const host = document.createElement("div");
    host.className = "saleSplash-host";
    host.innerHTML = `
      <div class="saleSplash-backdrop">
        <div class="saleSplash-card" role="status" aria-live="polite">
          <div class="saleSplash-title">${(name||"").toUpperCase()}</div>
          <div class="saleSplash-sub">SUBMITTED</div>
          <div class="saleSplash-amount">$${av12} AV</div>
        </div>
      </div>`;
    document.body.appendChild(host);
    requestAnimationFrame(()=> host.classList.add("saleSplash-show"));
    playSound();
    const done = () => { host.classList.remove("saleSplash-show"); setTimeout(()=>{ host.remove(); showing=false; showNext(); }, 400); };
    const t = setTimeout(done, Math.max(3000, ms));
    host.addEventListener("click", ()=>{ clearTimeout(t); done(); }, { once:true });
  }
  window.showSalePop = function({name, amount, ms}){ queue.push({ name, amount, ms }); showNext(); };
})();

/* ---------- Summary cards (3) ---------- */
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
  if (dealsEl) { const lbl = dealsEl.previousElementSibling; if (lbl) lbl.textContent = "This Week — Deals Submitted"; dealsEl.textContent = fmtInt(STATE.team.deals || 0); }
}

/* ---------- Load static assets & overrides ---------- */
async function loadStatic(){
  const [rosterRaw, rules, vendorsJson] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[]),
    getJSON("/sales_by_vendor.json").catch(()=>({ as_of:"", window_days:45, vendors:[] }))
  ]);
  setRuleText(rules);

  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  // vendor state
  const rows = Array.isArray(vendorsJson?.vendors) ? vendorsJson.vendors : [];
  STATE.vendors = {
    as_of: String(vendorsJson?.as_of||""),
    window_days: Number(vendorsJson?.window_days||45),
    rows
  };

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
        sold     : Number(r.sold||0)
      };
      byKey.set(k, row);
      teamCalls += row.calls; teamTalk += row.talkMin; teamLeads += row.leads; teamSold += row.sold;
    }
  }catch(e){ log("calls_by_agent error", e?.message||e); }

  // optional overrides
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

/* ---------- Ringy: Weekly Sales → AV(12×) & Deals + Splash trigger ---------- */
/*  IMPORTANT: API safety — we auto-detect whether amounts are MONTHLY or already AV(12x):
    - If payload.isAv12x === true → treat numbers as AV 12x
    - Else if a typical sale amount > $10,000 → treat as AV 12x
    - Otherwise assume MONTHLY and multiply by 12
*/
function normalizeToAV12x(amountRaw, isAvFlag){
  const amt = Number(amountRaw||0);
  if (isAvFlag === true) return amt;
  if (amt >= 10_000) return amt;       // infer already annualized
  return amt * 12;                      // monthly → annual
}

async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");
    const [WSTART, WEND] = weekRangeET();
    const perByName = new Map();     // nameKey -> { sales, amount, av12x }
    let totalDeals = 0;
    let totalAV12  = 0;

    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];
    const apiSaysAv = payload?.isAv12x === true;
    let newest = null;

    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;
        if (!newest || when > toET(newest?.dateSold||0)) newest = s;

        const name   = String(s.agent||"").trim(); if (!name) continue;
        const key    = name.toLowerCase();
        const base   = (s.amount!=null) ? s.amount : (s.av12x!=null ? s.av12x : 0);
        const av12x  = normalizeToAV12x(base, apiSaysAv);

        const cur = perByName.get(key) || { sales:0, amount:0, av12x:0 };
        cur.sales += 1;
        cur.av12x += av12x;
        cur.amount = cur.av12x; // keep amount aligned to av12x
        perByName.set(key, cur);

        totalDeals += 1;
        totalAV12  += av12x;
      }
    } else {
      // fallback perAgent shape
      const pa = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of pa){
        const key  = String(a.name||"").trim().toLowerCase();
        const base = (a.amount!=null) ? a.amount : (a.av12x!=null ? a.av12x : 0);
        const av12x = normalizeToAV12x(base, apiSaysAv);
        const sales = Number(a.sales||0);
        perByName.set(key, { sales, amount: av12x, av12x });
        totalDeals += sales;
        totalAV12  += av12x;
      }
    }

    // Per-agent overrides only (one-time adjustments). No team-level add-ons to avoid double counts.
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      const oa = STATE.overrides.av.perAgent || {};
      for (const [rawName, v] of Object.entries(oa)){
        const k     = String(rawName||"").trim().toLowerCase();
        const sales = Number(v.sales || 0);
        const av12x = Number(v.av12x || 0);
        // Replace this agent row with override values
        const prev = perByName.get(k);
        if (prev){
          totalDeals -= Number(prev.sales||0);
          totalAV12  -= Number(prev.av12x||0);
        }
        perByName.set(k, { sales, amount: av12x, av12x });
        totalDeals += sales;
        totalAV12  += av12x;
      }
    }

    // Align with roster ordering
    const out = new Map();
    for (const a of STATE.roster){
      const nk = String(a.name||"").toLowerCase();
      out.set(agentKey(a), perByName.get(nk) || { sales:0, amount:0, av12x:0 });
    }

    // Update totals
    const prevDeals = STATE.team.deals || 0;
    STATE.salesWeekByKey = out;
    STATE.team.av    = Math.max(0, Math.round(totalAV12));
    STATE.team.deals = Math.max(0, Math.round(totalDeals));

    // Splash: newest sale if seen for first time
    if (newest){
      const h = `${newest.leadId||""}|${newest.soldProductId||""}|${newest.dateSold||""}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        const base = (newest.amount!=null) ? newest.amount : (newest.av12x!=null ? newest.av12x : 0);
        const av12x = normalizeToAV12x(base, apiSaysAv);
        window.showSalePop({ name:newest.agent || "Team", amount: av12x, ms:60_000 });
      }
    } else if (STATE.team.deals > prevDeals && STATE.team.deals > STATE.lastDealsShown){
      // Fallback splash if counter jumped but no row detail
      let best = { name:"Team", amount:0, _score:0 };
      for (const a of STATE.roster){
        const s = STATE.salesWeekByKey.get(agentKey(a)) || { sales:0, amount:0 };
        const score = (s.sales*10000 + s.amount);
        if (score > best._score) best = { name:a.name, amount:(s.amount||0), _score:score };
      }
      window.showSalePop({ name:best.name, amount:best.amount || 0, ms:60_000 });
      STATE.lastDealsShown = STATE.team.deals;
    }

  }catch(e){
    log("team_sold error", e?.message||e);
    STATE.salesWeekByKey = new Map();
    STATE.team.av    = 0;
    STATE.team.deals = 0;
  }
}

/* ---------- YTD Manual board ---------- */
async function loadYTD(){
  try {
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
  } catch(e){
    log("ytd load error", e?.message||e);
    STATE.ytd = { list:[], total:0 };
  }
}

/* ---------- Derived ---------- */
function bestOfWeek(){
  const entries = STATE.roster.map(a=>{
    const s = STATE.salesWeekByKey.get(agentKey(a)) || { av12x:0, sales:0, amount:0 };
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
    const c = STATE.callsWeekByKey.get(agentKey(a)) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = STATE.salesWeekByKey.get(agentKey(a)) || { av12x:0, sales:0, amount:0 };
    const soldDeals = Number(s.sales || 0);
    const conv = c.leads > 0 ? (soldDeals / c.leads) : null;
    return [ avatarCell(a), fmtInt(c.calls), fmtInt(Math.round(c.talkMin)), hmm(c.loggedMin), fmtInt(c.leads),
             fmtInt(soldDeals), fmtPct(conv), fmtMoney(Number(s.av12x||0)) ];
  });
  setRows(rows);
}

function renderWeekAV(){
  setLabel("This Week — Leaderboard (Submitted AV)");
  setHead(["Agent","Submitted AV"]);
  const ranked = (STATE.roster||[])
    .map(a=>({ a, val: Number((STATE.salesWeekByKey.get(agentKey(a))||{av12x:0}).av12x) }))
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

/* ---- Load Chart.js on demand ---- */
function ensureChartJs(){
  return new Promise(res=>{
    if (window.Chart) return res();
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
    s.onload = ()=>res();
    document.head.appendChild(s);
  });
}

function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days || 45} days)`);
  setHead([]);

  const rows = STATE.vendors.rows || [];
  if (!rows.length){
    const imgHtml = `<div style="display:flex;justify-content:center;padding:8px 0 16px">
      <img src="/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:820px;width:100%;height:auto;opacity:.95"/>
    </div>
    <div style="text-align:center;color:#9fb0c8;font-size:12px;margin-top:8px">Last ${STATE.vendors.window_days} days as of ${STATE.vendors.as_of||"
