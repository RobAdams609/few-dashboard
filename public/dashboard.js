/* ============ FEW Dashboard — COMPLETE FILE (single rule banner + full-screen sale splash) ============ */
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
  lastDealsShown: 0            // fallback: if deals count increases, show splash for newest
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- ONE big “Rule of the Day” banner (centered, money-green brick style) ---------- */
function setRuleText(rulesObj){
  // Build list
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");

  // Kill any legacy duplicate rule elements if they exist
  const legacyIds = ["ticker","principle"];
  legacyIds.forEach(id=>{ const el = document.getElementById(id); if (el) el.remove(); });

  // Inject CSS once
  if (!document.getElementById("rule-banner-css")){
    const css = `
      #ruleBanner{
        display:flex; align-items:center; justify-content:center;
        text-align:center;
        padding:16px 22px; margin:8px auto 12px;
        max-width:1200px; border-radius:18px;
        background: repeating-linear-gradient(
          135deg,
          #0f2914, #0f2914 10px,
          #124019 10px, #124019 20px
        );
        color:#c8f7c8; letter-spacing:.6px;
        border:3px solid rgba(76,175,80,.6);
        box-shadow: 0 10px 30px rgba(0,0,0,.35), inset 0 0 0 2px rgba(133,255,133,.18);
      }
      #ruleBanner .ruleLabel{
        font-weight:900; margin-right:10px; opacity:.9;
        color:#e7ffe7;
      }
      #ruleBanner .ruleText{
        font-weight:900;
        font-size: clamp(22px, 3.0vw, 40px);
        color:#b6ff7a; text-shadow: 0 3px 10px rgba(0,0,0,.35);
      }
      /* keep it near top */
      .ruleBanner-host{ position:relative; z-index:2; }
    `;
    const el = document.createElement("style");
    el.id = "rule-banner-css";
    el.textContent = css;
    document.head.appendChild(el);
  }

  // Ensure host exists once, near top of main content
  let host = document.querySelector(".ruleBanner-host");
  if (!host){
    host = document.createElement("div");
    host.className = "ruleBanner-host";
    const target = document.querySelector("#app") || document.body;
    target.insertBefore(host, target.firstChild);
  }

  // Write banner
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

/* ---------- Full-screen sale splash (queue + 60s + chime; no toaster) ---------- */
(function initSaleSplash(){
  let queue = [];
  let showing = false;

  function injectCssOnce(){
    if (document.getElementById("sale-splash-css")) return;
    const css = `
      .saleSplash-backdrop{
        position:fixed; inset:0; z-index:99999;
        display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,.55); backdrop-filter: blur(2px);
        opacity:0; transition: opacity .35s ease;
      }
      .saleSplash-wrap{
        max-width:88vw; text-align:center;
        transform:scale(.96); transition: transform .35s ease, opacity .35s ease;
        opacity:.98;
      }
      .saleSplash-bubble{
        display:inline-block; padding:28px 40px; border-radius:28px;
        background:linear-gradient(180deg,#1a3b1f,#0f2914);
        box-shadow: 0 18px 60px rgba(0,0,0,.45), inset 0 0 0 3px rgba(133,255,133,.25);
        color:#eaffea; font-weight:900; line-height:1.2; letter-spacing:.4px;
        border:2px solid rgba(76,175,80,.5);
      }
      .saleSplash-name{ font-size:64px; }
      .saleSplash-txt { font-size:40px; margin:8px 0 0; color:#c7f5c7; }
      .saleSplash-amount{ display:block; font-size:86px; color:#b7ff7a; margin-top:10px; text-shadow: 0 4px 14px rgba(0,0,0,.35); }
      @media (max-width: 900px){
        .saleSplash-name{ font-size:44px; }
        .saleSplash-amount{ font-size:64px; }
        .saleSplash-txt{ font-size:28px; }
      }
      .saleSplash-show .saleSplash-backdrop{ opacity:1; }
      .saleSplash-show .saleSplash-wrap{ transform:scale(1); }
    `;
    const el = document.createElement("style");
    el.id = "sale-splash-css";
    el.textContent = css;
    document.head.appendChild(el);
  }

  function chime(){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      o.start(); o.stop(ctx.currentTime + 0.65);
    }catch{}
  }

  function showNext(){
    if (showing || queue.length === 0) return;
    showing = true;
    injectCssOnce();

    const { name, amount, ms=60_000 } = queue.shift();
    const av12 = Math.round(Number(amount||0)*12).toLocaleString("en-US");

    const host = document.createElement("div");
    host.className = "saleSplash-host";
    host.innerHTML = `
      <div class="saleSplash-backdrop">
        <div class="saleSplash-wrap">
          <div class="saleSplash-bubble">
            <div class="saleSplash-name">${(name||"").toUpperCase()}</div>
            <div class="saleSplash-txt">SUBMITTED</div>
            <span class="saleSplash-amount">$${av12} AV</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    requestAnimationFrame(()=> host.classList.add("saleSplash-show"));
    chime();

    const done = ()=> {
      host.classList.remove("saleSplash-show");
      setTimeout(()=>{ host.remove(); showing = false; showNext(); }, 400);
    };
    const t = setTimeout(done, Math.max(3000, ms));
    host.addEventListener("click", ()=>{ clearTimeout(t); done(); }, { once:true });
  }

  // Global API to queue a splash
  window.showSalePop = function({name, amount, ms}){
    queue.push({name, amount, ms});
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

/* ---------- Load static assets & overrides ---------- */
async function loadStatic(){
  const [rosterRaw, rules] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[])
  ]);
  setRuleText(rules);  // writes the single big banner

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

/* ---------- Ringy: Weekly Sales → AV(12×) & Deals + Splash trigger ---------- */
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

        // Track newest
        if (!newest || when > toET(newest.dateSold||0)) newest = s;

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

    // Manual AV overrides (merge)
    if (STATE.overrides.av && typeof STATE.overrides.av === "object"){
      const oa = STATE.overrides.av.perAgent || {};
      for (const [rawName, v] of Object.entries(oa)){
        const k = String(rawName||"").trim().toLowerCase();
        const sales = Number(v.sales || 0);
        const av12x = Number(v.av12x || 0);
        perByName.set(k, { sales, amount: av12x/12, av12x });
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

    // Update team totals
    const prevDeals = STATE.team.deals || 0;
    STATE.salesWeekByKey = out;
    STATE.team.av    = Math.max(0, Math.round(totalAV));
    STATE.team.deals = Math.max(0, Math.round(totalDeals));

    // 1) Primary anti-dup splash: hash the newest raw sale
    if (newest){
      const h = `${newest.leadId||""}|${newest.soldProductId||""}|${newest.dateSold||""}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        window.showSalePop({ name:newest.agent || "Team", amount:newest.amount || 0, ms:60_000 });
      }
    }

    // 2) Fallback splash if total deals increased but we didn't have raw/newest (e.g., condensed API)
    if (!newest && STATE.team.deals > prevDeals && STATE.team.deals > STATE.lastDealsShown){
      // Pick top agent by increase (best effort)
      let best = { name:"Team", amount:0 };
      // Find who currently leads by sales/amount
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

/* ---------- YTD Manual board ---------- */
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
function renderRoster(){
  setLabel("This Week — Roster");
  setHead(["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %","Submitted AV"]);
  const rows = (STATE.roster||[]).map(a=>{
    const k = agentKey(a);
    const c = STATE.callsWeekByKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = STATE.salesWeekByKey.get(k) || { av12x:0, sales:0, amount:0 };

    const soldDeals = Number(s.sales || 0);            // Sold column from sales function (truth)
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

function renderVendors(){
  setLabel("Lead Vendors — % of Sales (Last 45 days)");
  setHead([]);
  const img = `<div style="display:flex;justify-content:center;padding:8px 0 16px">
    <img src="/boards/Sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:100%;height:auto"/>
  </div>`;
  setRows([[img]]);
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
