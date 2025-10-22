/* ================= FEW Dashboard (Production, Self-Healing) ================= */
"use strict";

/* ---------------- Config ---------------- */
const BASE       = "https://few-dashboard-live.netlify.app"; // absolute paths only
const ET_TZ      = "America/New_York";
const DATA_MS    = 30_000;            // refresh data every 30s
const ROTATE_MS  = 30_000;            // rotate views every 30s
const VIEWS      = ["roster","av","aotw","vendors","ytd"];
let   viewIdx    = 0;

const QS = new URLSearchParams(location.search);
const VIEW_OVERRIDE = (QS.get("view") || "").toLowerCase();

/* ---------------- DOM utils ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const escapeHtml = s => String(s??"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const bust = (u)=> u + (u.includes("?")?"&":"?") + "t=" + Date.now();

async function getJSON(u){
  const url = u.startsWith("http") ? u : (BASE + u);
  try{
    const r = await fetch(bust(url), { cache:"no-store" });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return await r.json();
  }catch(e){
    console.warn("getJSON fail:", url, e.message);
    return null;
  }
}

/* ---------------- Format helpers ---------------- */
const fmtInt    = n => Number(n||0).toLocaleString("en-US");
const fmtMoney  = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct    = n => (n == null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials  = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const hmm       = mins => { const mm=Math.max(0,Math.round(Number(mins||0))); const h=Math.floor(mm/60), m2=mm%60; return `${h}:${String(m2).padStart(2,"0")}`; };
const toET      = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

/* ---------------- Weekly window (Fri→Fri ET) ---------------- */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                 // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;           // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                       // [inclusive, exclusive)
}

/* ---------------- State ---------------- */
const STATE = {
  roster: [],                                // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),                 // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),                 // key -> {sales,amount,av12x}
  prevSalesByKey: new Map(),
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  seenSaleHashes: new Set(),
  lastDealsShown: 0,
  vendors: { as_of:"", window_days:45, rows:[] }
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------------- ONE (and only one) centered Rule banner — rotates daily ---------------- */
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;
  const daysSinceEpoch = Math.floor(Date.now()/86400000);
  const idx  = daysSinceEpoch % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");

  // remove legacy dupes
  $$("#ticker, #principle, #ruleBanner, #rule-banner-css").forEach(n=>n.remove());

  if (!$("#rule-banner-css")){
    const el = document.createElement("style");
    el.id = "rule-banner-css";
    el.textContent = `
      #ruleBanner{
        display:flex; align-items:center; justify-content:center; text-align:center;
        padding:18px 24px; margin:10px auto; max-width:1280px; border-radius:18px;
        background: rgba(255,255,255,0.03);
        box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,255,255,.06);
      }
      #ruleBanner .ruleText{
        font-weight: 1000;
        letter-spacing:.6px;
        color:#cfd6de;
        font-size: clamp(28px, 3.4vw, 48px);
        line-height: 1.15;
      }`;
    document.head.appendChild(el);
  }
  let host = $(".ruleBanner-host");
  if (!host){
    host = document.createElement("div");
    host.className = "ruleBanner-host";
    const target = $("#app") || document.body;
    target.insertBefore(host, target.firstChild);
  }
  host.innerHTML = `<div id="ruleBanner"><div class="ruleText">${escapeHtml(text)}</div></div>`;
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
  const src = a.photo ? `${BASE}/headshots/${a.photo}` : "";
  const img = src
    ? `<img class="avatar" src="${src}"
         onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${escapeHtml(a.name)}</span></div>`;
}
function avatarBlock(a){
  const src = a.photo ? `${BASE}/headshots/${a.photo}` : "";
  if (src){
    return `<img class="avatar" style="width:84px;height:84px;border-radius:50%;object-fit:cover"
                 src="${src}"
                 onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot; style=&quot;width:84px;height:84px;font-size:28px;&quot;>${initials(a.name)}</div>')">`;
  }
  return `<div class="avatar-fallback" style="width:84px;height:84px;font-size:28px">${initials(a.name)}</div>`;
}

/* ---------------- Full-screen sale splash (queue + audio) ---------------- */
(function initSaleSplash(){
  let queue = [];
  let showing = false;
  const SOUND_URL = `${BASE}/100-bank-notes-counted-on-loose-note-counter-no-errors-327647.mp3`;

  const baseAudio = new Audio(SOUND_URL);
  baseAudio.preload = "auto"; baseAudio.volume = 1.0;

  function playSound(){
    try{ const a = baseAudio.cloneNode(true); a.currentTime = 0; a.play().catch(()=>{}); a.addEventListener("ended", ()=> a.remove()); }catch{}
  }
  ["click","keydown","touchstart"].forEach(evt=>{
    window.addEventListener(evt, ()=>{
      baseAudio.play().then(()=>{ baseAudio.pause(); baseAudio.currentTime = 0; }).catch(()=>{});
    }, { once:true, passive:true });
  });

  function showNext(){
    if (showing || queue.length === 0) return;
    showing = true;
    if (!$("#sale-splash-css")){
      const css = `
        .saleSplash-backdrop{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter: blur(4px);opacity:0;transition: opacity .28s ease;}
        .saleSplash-card{display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 40px;border-radius:28px;background:linear-gradient(170deg,#FFE79A 0%,#FFD86B 40%,#E1B64F 100%);box-shadow:0 18px 60px rgba(0,0,0,.45),0 0 0 3px rgba(255,215,128,.35) inset;transform:scale(.96) translateY(6px);opacity:.98;transition: transform .28s ease, opacity .28s ease;}
        .saleSplash-title{font-size: clamp(28px, 5vw, 56px);font-weight:900;color:#1a1a1a}
        .saleSplash-sub{font-size: clamp(14px, 2.4vw, 20px);font-weight:800;color:#2a2a2a;opacity:.8}
        .saleSplash-amount{font-size: clamp(36px, 7.2vw, 88px);font-weight:1000;color:#111}
        .saleSplash-show .saleSplash-backdrop{opacity:1}
        .saleSplash-show .saleSplash-card{transform:scale(1) translateY(0)}
      `;
      const el = document.createElement("style"); el.id="sale-splash-css"; el.textContent = css; document.head.appendChild(el);
    }

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
      </div>`;
    document.body.appendChild(host);

    requestAnimationFrame(()=> host.classList.add("saleSplash-show"));
    playSound();

    const done = () => { host.classList.remove("saleSplash-show"); setTimeout(()=>{ host.remove(); showing = false; showNext(); }, 400); };
    const t = setTimeout(done, Math.max(3000, ms));
    host.addEventListener("click", ()=>{ clearTimeout(t); done(); }, { once:true });
  }

  window.showSalePop = ({name, amount, ms}) => { queue.push({name, amount, ms}); showNext(); };
})();

/* ---------------- Summary cards ---------------- */
function updateSummary(){
  const callsEl = $("#sumCalls");
  const avEl    = $("#sumSales");
  const dealsEl = $("#sumTalk");            // your markup uses these IDs already
  if (callsEl) callsEl.textContent = fmtInt(STATE.team.calls);
  if (avEl)     avEl.textContent   = fmtMoney(STATE.team.av);
  if (dealsEl)  dealsEl.textContent= fmtInt(STATE.team.deals||0);
}

/* ---------------- Static assets & roster ---------------- */
async function loadStatic(){
  const [rosterRaw, rules, vendorsRaw] = await Promise.all([
    getJSON("/headshots/roster.json"),
    getJSON("/rules.json"),
    // try function first if you wire it; else json fallback
    getJSON("/.netlify/functions/vendors_45") || getJSON("/sales_by_vendor.json")
  ]);

  if (rules) setRuleText(rules);

  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  if (vendorsRaw && (Array.isArray(vendorsRaw.vendors) || Array.isArray(vendorsRaw.rows))){
    const rows = Array.isArray(vendorsRaw.vendors) ? vendorsRaw.vendors : vendorsRaw.rows;
    STATE.vendors = {
      as_of: vendorsRaw.as_of || vendorsRaw.asOf || "",
      window_days: Number(vendorsRaw.window_days || vendorsRaw.windowDays || 45),
      rows: rows.map(v=>({ name:String(v.name||v.vendor||""), deals:Number(v.deals||v.count||0) }))
    };
  }else{
    STATE.vendors = { as_of:"", window_days:45, rows:[] };
  }
}

/* ---------------- Calls / Leads / Sold (with hard fallbacks) ---------------- */
async function refreshCalls(){
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();

  // 1) function
  let payload = await getJSON("/.netlify/functions/calls_by_agent");

  // 2) fallback override
  if (!payload){
    const ov = await getJSON("/calls_week_override.json");
    if (Array.isArray(ov)){
      // shape to {perAgent:[{name,email,calls,talkMin,loggedMin,leads,sold}]}
      payload = { perAgent: ov.map(x=>({
        name: x.agent || x.name,
        email: x.email || "",
        calls: Number(x.calls||x.count||1),        // at least 1 so it shows
        talkMin: Number(x.talkMin || (x.talkSec ? x.talkSec/60 : 0)),
        loggedMin: Number(x.loggedMin||0),
        leads: Number(x.leads||0),
        sold: Number(x.sold||0)
      }))};
    }
  }

  try{
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];

    const emailToKey = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), agentKey(a)]));
    const nameToKey  = new Map(STATE.roster.map(a => [String(a.name ||"").trim().toLowerCase(),  agentKey(a)]));

    for (const r of per){
      const e = String(r.email||"").trim().toLowerCase();
      const n = String(r.name ||"").trim().toLowerCase();
      const k = emailToKey.get(e) || nameToKey.get(n) || n || e;
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
  }catch(e){ console.warn("calls_by_agent parse error", e?.message||e); }

  STATE.callsWeekByKey = byKey;
  STATE.team.calls = Math.max(0, Math.round(teamCalls));
  STATE.team.talk  = Math.max(0, Math.round(teamTalk));
  STATE.team.leads = Math.max(0, Math.round(teamLeads));
  STATE.team.sold  = Math.max(0, Math.round(teamSold));
}

/* ---------------- Sales / AV(12×) + robust splash trigger ---------------- */
async function refreshSales(){
  const prevDeals = Number(STATE.team.deals||0);
  const prevByKey = new Map(STATE.salesWeekByKey);

  // 1) function
  let payload = await getJSON("/.netlify/functions/team_sold");

  // 2) fallback override (rollup by agent)
  if (!payload){
    const ov = await getJSON("/av_week_override.json");
    if (Array.isArray(ov)){
      payload = { perAgent: ov.map(x=>({
        name: x.name || x.agent,
        sales: Number(x.sales||x.deals||1),
        amount: Number(x.amount || (x.av ? x.av/12 : 0))
      }))};
    }
  }

  const perByName = new Map();
  let totalDeals = 0;
  let totalAV    = 0;

  try{
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
        cur.av12x   = cur.amount*12;
        perByName.set(key, cur);

        totalDeals += 1;
        totalAV    += amount*12;

        const hash = `${s.leadId||""}|${s.soldProductId||""}|${s.dateSold||""}`;
        if (!STATE.seenSaleHashes.has(hash)){
          STATE.seenSaleHashes.add(hash);
          window.showSalePop({ name:s.agent||"Team", amount:s.amount||0, ms:60_000 });
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

  // Map to roster keys
  const out = new Map();
  for (const a of STATE.roster){
    const nk = String(a.name||"").toLowerCase();
    const s  = perByName.get(nk) || { sales:0, amount:0, av12x:0 };
    out.set(agentKey(a), s);
  }

  STATE.prevSalesByKey = prevByKey;
  STATE.salesWeekByKey = out;
  STATE.team.av        = Math.max(0, Math.round(totalAV));
  STATE.team.deals     = Math.max(0, Math.round(totalDeals));

  // Fallback splash for rollup-only feeds
  if (STATE.team.deals > prevDeals){
    let winner = null;
    for (const a of STATE.roster){
      const k  = agentKey(a);
      const now = STATE.salesWeekByKey.get(k) || { sales:0, amount:0 };
      const then= STATE.prevSalesByKey.get(k)  || { sales:0, amount:0 };
      if (now.sales > then.sales){
        const deltaDeals = now.sales - then.sales;
        const estAmount  = (now.amount - then.amount) / Math.max(1, deltaDeals);
        winner = { name:a.name, amount: estAmount || now.amount };
        break;
      }
    }
    if (winner) window.showSalePop({ name:winner.name, amount:winner.amount||0, ms:60_000 });
    STATE.lastDealsShown = STATE.team.deals;
  }
}

/* ---------------- YTD ---------------- */
async function loadYTD(){
  const list = await getJSON("/ytd_av.json");
  const totalObj = await getJSON("/ytd_total.json");
  const rosterByName = new Map(STATE.roster.map(a => [String(a.name||"").toLowerCase(), a]));
  const rows = Array.isArray(list) ? list : [];
  const withAvatars = rows.map(r=>{
    const a = rosterByName.get(String(r.name||"").toLowerCase());
    return { name:r.name, email:r.email, av:Number(r.av||0), photo:a?.photo||"" };
  });
  withAvatars.sort((x,y)=> (y.av)-(x.av));
  STATE.ytd.list  = withAvatars;
  STATE.ytd.total = Number(totalObj?.ytd_av_total||0);
}

/* ---------------- Derived + Renderers ---------------- */
function bestOfWeek(){
  const entries = STATE.roster.map(a=>{
    const s = STATE.salesWeekByKey.get(agentKey(a)) || { av12x:0, sales:0, amount:0 };
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
    const c = STATE.callsWeekByKey.get(agentKey(a)) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = STATE.salesWeekByKey.get(agentKey(a)) || { av12x:0, sales:0, amount:0 };
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
    .map(a=>({ a, val: Number((STATE.salesWeekByKey.get(agentKey(a))||{}).av12x||0) }))
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
  setHead([]); // graphic layout

  const rows = STATE.vendors.rows || [];
  if (!rows.length){
    const imgHtml = `<div style="display:flex;justify-content:center;padding:8px 0 16px">
      <img src="${BASE}/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:72%;height:auto;opacity:.95"/>
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
    new Chart(ctx, {
      type: "pie",
      data:{ labels: rows.map(r=>r.name), datasets:[{ data: rows.map(r=>r.deals), borderWidth:0 }] },
      options:{
        responsive:true,
        maintainAspectRatio:true,
        plugins:{
          legend:{ position:"right", labels:{ color:"#cfd7e3", boxWidth:14, padding:10 } },
          tooltip:{ callbacks:{ label:(c)=> `${c.label}: ${fmtInt(c.raw)} deals` } }
        }
      }
    });
  }else{
    const png = `<div style="display:flex;justify-content:center;padding:8px 0 16px">
      <img src="${BASE}/sales_by_vendor.png" alt="Lead Vendor Breakdown" style="max-width:72%;height:auto;opacity:.95"/>
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

/* ---------------- Router ---------------- */
function renderCurrentView(){
  updateSummary();
  const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
  if (v === "roster")      renderRoster();
  else if (v === "av")     renderWeekAV();
  else if (v === "aotw")   renderAOTW();
  else if (v === "vendors")renderVendors();
  else if (v === "ytd")    renderYTD();
  else                     renderRoster();
}

/* ---------------- Boot ---------------- */
async function boot(){
  try{
    await loadStatic();
    await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
    renderCurrentView();

    // periodic refresh
    setInterval(async ()=>{
      try{
        await Promise.all([refreshCalls(), refreshSales(), loadYTD()]);
        renderCurrentView();
      }catch(e){ console.warn("refresh tick error", e?.message||e); }
    }, DATA_MS);

    // rotation (unless pinned with ?view=…)
    if (!VIEW_OVERRIDE){
      setInterval(()=>{ viewIdx = (viewIdx + 1) % VIEWS.length; renderCurrentView(); }, ROTATE_MS);
    }
  }catch(e){
    console.error("Dashboard boot error:", e);
    const tbody = $("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", () => { boot(); });
/* =============================== End =============================== */
