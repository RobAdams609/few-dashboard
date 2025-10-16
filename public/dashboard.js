/* ============ FEW Dashboard — COMPLETE FILE (single banner + full-screen sale splash + sound) ============ */
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
  vendors: { as_of:"", window_days:45, rows:[] }, // ← vendor data loaded from /sales_by_vendor.json
  seenSaleHashes: new Set(),   // stop duplicate splashes (leadId|soldProductId|dateSold)
  lastDealsShown: 0            // fallback: if deals count increases, show splash for newest
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- ONE (and only one) Rule banner, centered & bold ---------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");

  // remove any legacy rule UI (prevents double banners)
  ["ticker","principle","ruleBannerHost"].forEach(id=>{ const el = document.getElementById(id); if (el) el.remove(); });
  const oldCss = document.getElementById("rule-banner-css"); if (oldCss) oldCss.remove();

  // fresh CSS (big, bold, no green brick)
  const css = `
    #ruleBannerHost{display:flex;justify-content:center;margin:8px auto 14px;max-width:1400px}
    #ruleBanner{
      display:flex;align-items:center;justify-content:center;text-align:center;
      padding:18px 22px;border-radius:16px;width:100%;
      background: rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.08);
      box-shadow: 0 8px 24px rgba(0,0,0,.28);
    }
    #ruleBanner .ruleLabel{
      font-weight:900;margin-right:10px;color:#d8deea;opacity:.9;
      letter-spacing:.4px
    }
    #ruleBanner .ruleText{
      font-weight:1000; letter-spacing:.6px;
      font-size: clamp(22px, 3.2vw, 44px);
      color:#ffe08a; text-shadow:0 2px 12px rgba(0,0,0,.35)
    }
  `;
  const el = document.createElement("style");
  el.id = "rule-banner-css";
  el.textContent = css;
  document.head.appendChild(el);

  let host = document.createElement("div");
  host.id = "ruleBannerHost";
  const target = document.querySelector("#app") || document.body;
  target.insertBefore(host, target.firstChild);

  host.innerHTML = `
    <div id="ruleBanner">
      <span class="ruleLabel">RULE OF THE DAY —</span>
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

/* ---------- Sale Splash CSS (modern clean gold) ---------- */
function injectCssOnce(){
  if (document.getElementById("sale-splash-css")) return;
  const css = `
    :root{ --gold-1:#FFE79A; --gold-2:#FFD86B; --gold-3:#E1B64F; --gold-glow:rgba(255,215,128,.35) }
    .saleSplash-backdrop{ position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.55); backdrop-filter: blur(4px); opacity:0; transition: opacity .28s ease; }
    .saleSplash-card{ display:flex; flex-direction:column; align-items:center; gap:10px; padding:28px 40px; border-radius:28px;
      background:linear-gradient(170deg, var(--gold-1) 0%, var(--gold-2) 40%, var(--gold-3) 100%);
      border:1px solid rgba(255,255,255,.18); box-shadow: 0 18px 60px rgba(0,0,0,.45), 0 0 0 3px var(--gold-glow) inset;
      transform:scale(.96) translateY(6px); opacity:.98; transition: transform .28s ease, opacity .28s ease, box-shadow .28s ease; }
    .saleSplash-title{ font-size: clamp(28px, 5vw, 56px); font-weight: 900; letter-spacing:.4px; color:#1a1a1a; text-shadow: 0 1px 0 rgba(255,255,255,.35);}
    .saleSplash-sub{ font-size: clamp(14px, 2.4vw, 20px); font-weight:800; letter-spacing:.5px; color:#2a2a2a; opacity:.8; }
    .saleSplash-amount{ font-size: clamp(36px, 7.2vw, 88px); font-weight: 1000; letter-spacing:.6px; line-height:1.02; color:#111;
      text-shadow:0 1px 0 rgba(255,255,255,.45), 0 10px 30px rgba(0,0,0,.30); }
    .saleSplash-show .saleSplash-backdrop{ opacity:1 } .saleSplash-show .saleSplash-card{ transform:scale(1) translateY(0) }
  `;
  const el = document.createElement("style");
  el.id = "sale-splash-css";
  el.textContent = css;
  document.head.appendChild(el);
}

/* ---------- Full-screen sale splash + sound (queue, 60s, money-counter) ---------- */
(function initSaleSplash(){
  let queue = [];
  let showing = false;
  const SOUND_URL = "/100-bank-notes-counted-on-loose-note-counter-no-errors-327647.mp3";
  const baseAudio = new Audio(SOUND_URL);
  baseAudio.preload = "auto";
  baseAudio.volume  = 1.0;

  function playSound(){
    try{
      const a = baseAudio.cloneNode(true);
      a.currentTime = 0;
      a.play().catch(()=>{});
      a.addEventListener("ended", ()=> a.remove());
    }catch{}
  }
  ["click","keydown","touchstart"].forEach(evt=>{
    window.addEventListener(evt, ()=>{
      baseAudio.play().then(()=>{ baseAudio.pause(); baseAudio.currentTime = 0; }).catch(()=>{});
    }, { once:true, passive:true });
  });

  function showNext(){
    if (showing || queue.length === 0) return;
    showing = true;
    injectCssOnce();

    const { name, amount, ms = 60_000 } = queue.shift();
    const av12 = Math.round(Number(amount || 0) * 12).toLocaleString("en-US");

    const host = document.createElement("div");
    host.className = "saleSplash-host";
    host.innerHTML = `
      <div class="saleSplash-backdrop">
        <div class="saleSplash-card" role="status" aria-live="polite">
          <div class="saleSplash-title">${(name||"").toUpperCase()}</div>
          <div class="saleSplash-sub">SUBMITTED</div>
          <div class="saleSplash-amount">$${av12} AV</div>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    requestAnimationFrame(()=> host.classList.add("saleSplash-show"));
    playSound();

    const done = () => {
      host.classList.remove("saleSplash-show");
      setTimeout(()=>{ host.remove(); showing = false; showNext(); }, 400);
    };
    const t = setTimeout(done, Math.max(3000, ms));
    host.addEventListener("click", ()=>{ clearTimeout(t); done(); }, { once:true });
  }

  window.showSalePop = function({name, amount, ms}){
    queue.push({ name, amount, ms });
    showNext();
  };
})();

/* ---------- Summary cards (exactly 3) ---------- */
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

/* ---------- Load static assets & overrides (and vendor JSON) ---------- */
async function loadStatic(){
  const [rosterRaw, rules, vendorJson] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[]),
    getJSON("/sales_by_vendor.json").catch(()=>null)
  ]);
  setRuleText(rules);  // one big centered banner

  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  // Vendor JSON (optional)
  if (vendorJson && Array.isArray(vendorJson.vendors)) {
    STATE.vendors.as_of = vendorJson.as_of || "";
    STATE.vendors.window_days = Number(vendorJson.window_days || 45);
    STATE.vendors.rows = vendorJson.vendors.map(v => ({ name: String(v.name||""), deals: Number(v.deals||0) }));
  } else {
    STATE.vendors = { as_of:"", window_days:45, rows:[] };
  }

  try { STATE.overrides.calls = await getJSON("/calls_week_override.json"); } catch { STATE.overrides.calls = null; }
  try { STATE.overrides.av    = await getJSON("/av_week_override.json");    } catch { STATE.overrides.av    = null; }
}

/* ---------- Ringy: Calls / Talk / Leads / Sold (from calls fn) ---------- */
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

/* ---------- Ringy: Weekly Sales → AV(12×) & Deals + Splash trigger (API-first; overrides are additive) ---------- */
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");
    const [WSTART, WEND] = weekRangeET();
    const perByName = new Map();     // nameKey -> { sales, amount, av12x }
    let totalDeals = 0;
    let totalAV    = 0;

    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];
    let newest = null; // keep the newest sale object we see in-window

    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;

        if (!newest || when > toET(newest?.dateSold||0)) newest = s;

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

    // Manual AV overrides (merge ADDITIVELY — will not block live API numbers)
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      const oa = STATE.overrides.av.perAgent || {};
      for (const [rawName, v] of Object.entries(oa)){
        const k = String(rawName||"").trim().toLowerCase();
        const salesAdd = Number(v.sales || 0);
        const av12xAdd = Number(v.av12x || 0);
        const cur = perByName.get(k) || { sales:0, amount:0, av12x:0 };
        cur.sales += salesAdd;
        cur.av12x += av12xAdd;
        cur.amount = cur.av12x / 12;
        perByName.set(k, cur);
        totalDeals += salesAdd;
        totalAV    += av12xAdd;
      }
      if (STATE.overrides.av.team){
        const tAddAV  = Number(STATE.overrides.av.team.totalAV12x || 0);
        const tAddSls = Number(STATE.overrides.av.team.totalSales || 0);
        totalAV   += tAddAV;
        totalDeals+= tAddSls;
      }
    }

    const out = new Map();
    for (const a of STATE.roster){
      const k  = agentKey(a);
      const nk = String(a.name||"").toLowerCase();
      const s  = perByName.get(nk) || { sales:0, amount:0, av12x:0 };
      out.set(k, s);
    }

    // Update totals
    const prevDeals = STATE.team.deals || 0;
    STATE.salesWeekByKey = out;
    STATE.team.av    = Math.max(0, Math.round(totalAV));
    STATE.team.deals = Math.max(0, Math.round(totalDeals));

    // 1) Primary anti-dup: splash the newest raw sale we saw
    if (newest){
      const h = `${newest.leadId||""}|${newest.soldProductId||""}|${newest.dateSold||""}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        window.showSalePop({ name:newest.agent || "Team", amount:newest.amount || 0, ms:60_000 });
      }
    }

    // 2) Fallback if deals ticked up but no per-sale rows
    if (!newest && STATE.team.deals > prevDeals && STATE.team.deals > STATE.lastDealsShown){
      let best = { name:"Team", amount:0 };
      for (const a of STATE.roster){
        const k = agentKey(a);
        const s = STATE.salesWeekByKey.get(k) || { sales:0, amount:0 };
        if (!best._score || (s.sales*10000 + s.amount) > best._score){
          best = { name:a.name, amount:(s.amount||0), _score:(s.sales*10000 + s.amount) };
        }
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

/* ---------- YTD board ---------- */
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

/* ---------- Derived ---------- */
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
function setLabelAndHead(label, cols){
  setLabel(label); setHead(cols);
}

function renderRoster(){
  setLabelAndHead("This Week — Roster", ["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %","Submitted AV"]);
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
  setLabelAndHead("This Week — Leaderboard (Submitted AV)", ["Agent","Submitted AV"]);
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
        <div style="font-size:24px;font-weight:900;margin-bottom:4px">${escapeHtml(a.name)}</div>
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

/* -------- Vendor renderer (scaled down pie; uses STATE.vendors & Chart.js if present) -------- */
function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days || 45} days)`);
  setHead([]); // graphic layout (no table header)

  const rows = STATE.vendors.rows || [];
  if (!rows.length){
    const imgHtml = `
      <div style="display:flex;justify-content:center;padding:8px 0 16px">
        <img src="/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:720px;width:100%;height:auto;opacity:.95"/>
      </div>
      <div style="text-align:center;color:#9fb0c8;font-size:12px;margin-top:8px">
        Last ${STATE.vendors.window_days||45} days as of ${STATE.vendors.as_of||""}
      </div>
    `;
    setRows([[imgHtml]]);
    return;
  }

  // Canvas container (scaled down; responsive)
  const chartId = `vendorChart-${Date.now()}`;
  const container = `
    <div style="display:flex;justify-content:center">
      <div style="width: min(720px, 92vw);">
        <div style="position:relative;width:100%;height:360px">
          <canvas id="${chartId}"></canvas>
        </div>
        <div style="margin-top:8px;color:#9fb0c8;font-size:12px;text-align:center">
          Last ${STATE.vendors.window_days||45} days as of ${STATE.vendors.as_of||""}
        </div>
      </div>
    </div>
  `;
  setRows([[container]]);

  // Build chart if available
  if (window.Chart){
    const el = document.getElementById(chartId);
    const labels = rows.map(r=> r.name);
    const data   = rows.map(r=> r.deals);
    new Chart(el.getContext("2d"), {
      type: "pie",
      data: {
        labels,
        datasets: [{ data }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 8 },
        plugins: {
          legend: { position:"right", labels:{ boxWidth:12, usePointStyle:true } },
          tooltip: { callbacks:{ label: ctx => `${ctx.label}: ${fmtInt(ctx.parsed)} deals` } }
        }
      }
    });
  }
}

function renderYTD(){
  setLabelAndHead("YTD — Leaders", ["Agent","YTD AV (12×)"]);
  const rows = (STATE.ytd.list||[]).map(r=>{
    const a = { name:r.name, photo:r.photo };
    return [avatarCell(a), fmtMoney(r.av)];
  });
  setRows(rows);
}

/* ---------- Router ---------- */
function renderCurrentView(){
  try{
    updateSummary();
    const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
    if (v === "roster")      renderRoster();
    else if (v === "av")     renderWeekAV();
    else if (v === "aotw")   renderAOTW();
    else if (v === "vendors")renderVendors();
    else if (v === "ytd")    renderYTD();
    else                     renderRoster();
  } catch(e){
    log("render err", e?.message||e);
    setHead([]); setRows([]);
  }
}

/* ---------- Boot ---------- */
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

    // rotation (unless manually pinned with ?view=…)
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
/* ============================== End ============================== */
