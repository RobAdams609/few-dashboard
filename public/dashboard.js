/* ================= FEW Dashboard — FULL REWRITE (permanent) ================= */
"use strict";

/* ---------- Config ---------- */
const ET_TZ      = "America/New_York";
const DATA_MS    = 30_000;               // refresh cadence
const ROTATE_MS  = 30_000;               // view rotation cadence
const VIEWS      = ["roster","av","aotw","vendors","ytd"];
let   viewIdx    = 0;

const QS         = new URLSearchParams(location.search);
const DEBUG      = QS.has("debug");
const VIEW       = (QS.get("view") || "").toLowerCase();

/* ---------- Logging ---------- */
const log = (...a)=>{ if (DEBUG) console.log("[FEW]", ...a); };

/* ---------- URL helpers (no hard-coded domain) ---------- */
const abs = (p)=> new URL(p, location.origin).href;
const api = (p)=> abs(p);

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
const hmm       = mins => {
  const m=Math.max(0,Math.round(Number(mins||0)));
  const h=Math.floor(m/60), r=m%60; return `${h}:${String(r).padStart(2,"0")}`;
};

/* ---------- Name normalization + aliases ---------- */
function normName(s){
  return String(s||"")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu,"")
    .replace(/\s+/g," ")
    .trim();
}
// (LEFT → RIGHT)
const NAME_ALIASES = new Map([
  ["a s", "ajani senior"],
  ["ajani s", "ajani senior"],
  ["f n", "fabricio navarrete cervantes"],
  ["fabricio navarrete", "fabricio navarrete cervantes"]
]);
const resolveAlias = n => NAME_ALIASES.get(normName(n)) || normName(n);
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- Weekly window = Fri 12:00am ET → next Fri 12:00am ET ---------- */
function weekRangeET(){
  const now = toET(new Date());                 // ET
  const day = now.getDay();                     // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;               // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                           // [inclusive, exclusive)
}

/* ---------- Permanent vendor labels (canonical) ---------- */
const VENDOR_LABELS = [
  "$7.50",
  "George Region Shared",
  "Red Media",
  "Blast/Bulk",
  "Exclusive JUMBO",
  "ABC",
  "Shared Jumbo",
  "VS Default",
  "RKA Website",
  "Redrip/Give up Purchased",
  "Lamy Dynasty Specials",
  "JUMBO Splits",
  "Exclusive 30s",
  "Positive Intent/Argos",
  "HotLine Bling",
  "Referral",
  "CG Exclusive"
];
const VENDOR_SET = new Set(VENDOR_LABELS.map(v => v.toLowerCase()));

/* ---------- State ---------- */
const STATE = {
  roster: [],                                   // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),                    // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),                    // key -> {sales,amount,av12x}
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  vendors: { as_of:"", window_days:45, rows:[] }, // [{name,deals}]
  overrides: { av: null },
  seenSaleHashes: new Set(),
  lastNewestSoldAt: 0
};

/* ---------- Small helpers ---------- */
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){
  const href = api(u);
  if (DEBUG) console.log("GET", href);
  const r = await fetch(bust(href), { cache:"no-store" });
  if (!r.ok) throw new Error(`${href} ${r.status}`);
  const t = await r.text();
  try { return JSON.parse(t); }
  catch(e){ throw new Error(`Bad JSON from ${href}: ${e.message}`); }
}

/* ---------- One banner (rotates a single rule) ---------- */
function setRuleTextOne(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;

  ["ruleBanner","ticker","principle"].forEach(id=>{ const el = document.getElementById(id); if (el) el.remove(); });
  const hostOld = document.querySelector(".ruleBanner-host"); if (hostOld) hostOld.remove();

  const idx  = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");

  const styleId = "rule-banner-css-one";
  if (!document.getElementById(styleId)){
    const el = document.createElement("style");
    el.id = styleId;
    el.textContent = `
      #ruleBanner{
        display:flex; align-items:center; justify-content:center; text-align:center;
        padding:18px 22px; margin:10px auto 12px; max-width:1200px; border-radius:18px;
        background: #0e1116; border: 1px solid rgba(255,255,255,.06);
        box-shadow: 0 10px 30px rgba(0,0,0,.35);
      }
      #ruleBanner .ruleText{
        font-weight: 900;
        color: #cfd2d6;
        letter-spacing:.4px;
        font-size: clamp(22px, 3.4vw, 44px);
      }
      .ruleBanner-host{ position:relative; z-index:2; }
    `;
    document.head.appendChild(el);
  }

  const host = document.createElement("div");
  host.className = "ruleBanner-host";
  host.innerHTML = `<div id="ruleBanner"><div class="ruleText">${escapeHtml(text)}</div></div>`;
  const target = document.querySelector("#app") || document.body;
  target.insertBefore(host, target.firstChild);
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
    : `<tr><td style="padding:18px;color:#5c6c82;">Loading...</td></tr>`;
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

/* ---------- Summary cards (3 fixed) ---------- */
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
  if (dealsEl) dealsEl.textContent = fmtInt(STATE.team.deals || 0);
}

/* ---------- Load static: roster, rules, vendor fallback, weekly override ---------- */
async function loadStatic(){
  const [rosterRaw, rules, vendorRaw, aOverride] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[]),
    getJSON("/sales_by_vendor.json").catch(()=>({ as_of:"", window_days:45, vendors:[] })),
    getJSON("/av_week_override.json").catch(()=>null)
  ]);

  // banner
  setRuleTextOne(rules);

  // roster
  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  // vendor fallback (may get replaced live by sales API)
  const rows = Array.isArray(vendorRaw?.vendors) ? vendorRaw.vendors : [];
  STATE.vendors = {
    as_of: vendorRaw?.as_of || "",
    window_days: Number(vendorRaw?.window_days || 45),
    rows: rows.map(v => ({ name:String(v.name||""), deals:Number(v.deals||0) }))
  };

  // weekly override
  STATE.overrides.av = aOverride || null;

  if (DEBUG){
    console.table(STATE.roster);
    console.table(STATE.vendors.rows);
    console.log("override", STATE.overrides);
  }
}

/* ---------- Calls / talk / logged / leads / sold ---------- */
async function refreshCalls(){
  let teamCalls = 0, teamTalk = 0, teamLeads = 0, teamSold = 0;
  const byKey = new Map();

  try{
    const payload = await getJSON("/.netlify/functions/calls_by_agent");
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
    if (DEBUG) console.table(per);

    const emailToKey = new Map(STATE.roster.map(a => [String(a.email||"").trim().toLowerCase(), agentKey(a)]));
    const nameToKey  = new Map(STATE.roster.map(a => [normName(a.name ||""),  agentKey(a)]));

    for (const r of per){
      const e = String(r.email||"").trim().toLowerCase();
      const n = normName(r.name ||"");
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

  STATE.callsWeekByKey = byKey;
  STATE.team.calls = Math.max(0, Math.round(teamCalls));
  STATE.team.talk  = Math.max(0, Math.round(teamTalk));
  STATE.team.leads = Math.max(0, Math.round(teamLeads));
  STATE.team.sold  = Math.max(0, Math.round(teamSold));
}

/* ---------- Vendor recompute (LIVE from sales events, last N days) ---------- */
function canonicalVendorLabel(raw){
  const s = String(raw||"").trim();
  // exact match first
  if (VENDOR_SET.has(s.toLowerCase())) return s;
  // light heuristics (add more normalizers as needed)
  const n = s.toLowerCase();
  if (n.includes("jumbo") && n.includes("exclusive")) return "Exclusive JUMBO";
  if (n.includes("shared") && n.includes("jumbo"))    return "Shared Jumbo";
  if (n.includes("blast") || n.includes("bulk"))      return "Blast/Bulk";
  if (n.includes("exclusive 30"))                     return "Exclusive 30s";
  if (n.includes("positive intent") || n.includes("argos")) return "Positive Intent/Argos";
  if (n.includes("hotline"))                          return "HotLine Bling";
  if (n.includes("red media"))                        return "Red Media";
  if (n.includes("rka") && n.includes("website"))     return "RKA Website";
  if (n.includes("vs default"))                       return "VS Default";
  if (n.includes("referral"))                         return "Referral";
  if (n.includes("abc"))                              return "ABC";
  if (n.includes("redrip"))                           return "Redrip/Give up Purchased";
  if (n.includes("lamy") && n.includes("special"))    return "Lamy Dynasty Specials";
  if (n.includes("$7.50"))                            return "$7.50";
  if (n.includes("george") && n.includes("shared"))   return "George Region Shared";
  if (n.includes("cg") && n.includes("exclusive"))    return "CG Exclusive";
  return s || "Other";
}
function recomputeVendorsFromSales(allSales, days=45){
  if (!Array.isArray(allSales) || !allSales.length) return null;

  const now   = toET(new Date());
  const since = new Date(now); since.setDate(since.getDate() - days);

  const bucket = new Map(); // label -> deals
  for (const s of allSales){
    const when = s.dateSold ? toET(s.dateSold) : null;
    if (!when || when < since || when > now) continue;

    const rawName = s.soldProductName || s.vendor || s.source || "Other";
    const label   = canonicalVendorLabel(rawName);
    bucket.set(label, (bucket.get(label)||0) + 1);
  }

  // ensure canonical labels show up when present in data; sort by deals
  const rows = Array.from(bucket, ([name,deals]) => ({ name, deals }))
                    .sort((a,b)=> b.deals - a.deals);
  return { as_of: now.toISOString().slice(0,10), window_days: days, rows };
}

/* ---------- Weekly Sales → AV(12×) & Deals (with overrides + centered splash) ---------- */
function ensureSplashHost(){
  if (document.getElementById("sale-splash-host")) return;
  const css = document.createElement("style");
  css.id = "sale-splash-css";
  css.textContent = `
    #sale-splash-host{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:99999; }
    #sale-splash-backdrop{ position:absolute; inset:0; background:rgba(0,0,0,.55); backdrop-filter: blur(2px); }
    #sale-splash{
      position:relative; max-width:80vw; padding:28px 36px; border-radius:20px;
      background:#0e1116; border:1px solid rgba(255,255,255,.08);
      box-shadow:0 30px 120px rgba(0,0,0,.55);
      text-align:center;
    }
    #sale-splash .name{ font-weight:900; font-size: clamp(28px, 6vw, 64px); color:#ffd36a; line-height:1.1; }
    #sale-splash .sub { margin-top:10px; font-weight:800; font-size: clamp(18px, 3.5vw, 36px); color:#ffd36a; opacity:.95; }
  `;
  document.head.appendChild(css);

  const host = document.createElement("div");
  host.id = "sale-splash-host";
  host.innerHTML = `
    <div id="sale-splash-backdrop"></div>
    <div id="sale-splash">
      <div class="name" id="sale-splash-name"></div>
      <div class="sub"  id="sale-splash-av"></div>
    </div>
  `;
  document.body.appendChild(host);
}

function showCenteredSaleSplash({name, amountAv12x, ms}){
  ensureSplashHost();
  const host = $("#sale-splash-host");
  $("#sale-splash-name").textContent = String(name||"Team").toUpperCase();
  $("#sale-splash-av").textContent   = `${fmtMoney(amountAv12x||0)} AV`;
  host.style.display = "flex";
  clearTimeout(window.__saleSplashTimer);
  window.__saleSplashTimer = setTimeout(()=>{ host.style.display="none"; }, ms||60_000);
}

async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    const [WSTART, WEND] = weekRangeET();
    const perByName = new Map();   // nameKey -> { sales, amount, av12x }
    let totalDeals = 0;
    let totalAV    = 0;

    // Prefer detailed events if available (best for splash + vendor)
    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];
    let newest = null;

    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;

        if (!newest || when > toET(newest?.dateSold||0)) newest = s;

        const key     = resolveAlias(s.agent || s.name || "");
        const amount  = Number(s.amount||0);         // weekly $ (monthly premium)
        const av12x   = amount * 12;

        const cur = perByName.get(key) || { sales:0, amount:0, av12x:0 };
        cur.sales  += 1;
        cur.amount += amount;
        cur.av12x  += av12x;
        perByName.set(key, cur);

        totalDeals += 1;
        totalAV    += av12x;
      }
    }

    // Fallback to summarized perAgent if no events (still multiply ×12)
    if (!perByName.size){
      const pa = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of pa){
        const key    = resolveAlias(a.name || "");
        const sales  = Number(a.sales||0);
        const amount = Number(a.amount||0);   // weekly $ (monthly premium)
        const av12x  = amount * 12;
        perByName.set(key, { sales, amount, av12x });
        totalDeals += sales;
        totalAV    += av12x;
      }
    }

    /* ---- WEEKLY OVERRIDE (hard replace) ---- */
    if (STATE.overrides?.av && typeof STATE.overrides.av === "object"){
      const oa = STATE.overrides.av.perAgent || {};
      for (const [rawName, v] of Object.entries(oa)){
        const k      = resolveAlias(rawName);
        const sales  = Number(v.sales || 0);
        const av12x  = Number(v.av12x || 0);
        perByName.set(k, { sales, amount: av12x/12, av12x });
      }
      if (STATE.overrides.av.team){
        totalAV    = Math.max(0, Math.round(Number(STATE.overrides.av.team.totalAV12x || 0)));
        totalDeals = Math.max(0, Math.round(Number(STATE.overrides.av.team.totalSales  || 0)));
      }else{
        let tAV = 0, tD = 0;
        perByName.forEach(v => { tAV += v.av12x||0; tD += v.sales||0; });
        totalAV = tAV; totalDeals = tD;
      }
    }

    // Build map keyed by roster identities so rows line up
    const out = new Map();
    for (const a of STATE.roster){
      const nk = resolveAlias(a.name);
      const s  = perByName.get(nk) || { sales:0, amount:0, av12x:0 };
      out.set(agentKey(a), s);
    }

    // update totals
    const prevDeals = Number(STATE.team.deals || 0);
    STATE.salesWeekByKey = out;
    STATE.team.av        = Math.max(0, Math.round(totalAV));
    STATE.team.deals     = Math.max(0, Math.round(totalDeals));

    // Vendor LIVE update (if the API had events)
    const liveVendors = recomputeVendorsFromSales(payload?.allSales, STATE.vendors.window_days || 45);
    if (liveVendors) STATE.vendors = liveVendors;

    // Centered splash on NEW sale (bold & gold, 60s)
    if (raw.length && newest){
      const newestTs = +toET(newest.dateSold||0);
      if (newestTs > STATE.lastNewestSoldAt){
        STATE.lastNewestSoldAt = newestTs;
        const name = newest.agent || "Team";
        const av12x = (Number(newest.amount||0))*12;
        showCenteredSaleSplash({ name, amountAv12x: av12x, ms: 60_000 });
      }
    } else if (STATE.team.deals > prevDeals) {
      // pick the strongest contributor this tick
      let best = { name:"Team", score:-1, amount:0 };
      for (const a of STATE.roster){
        const s = STATE.salesWeekByKey.get(agentKey(a)) || { sales:0, amount:0 };
        const score = (s.sales||0)*10000 + (s.amount||0);
        if (score > best.score) best = { name:a.name, amount:s.amount||0, score };
      }
      showCenteredSaleSplash({ name: best.name, amountAv12x: (best.amount||0)*12, ms: 60_000 });
    }

  }catch(e){
    log("team_sold error", e?.message||e);
    STATE.salesWeekByKey = new Map();
    STATE.team.av = 0; STATE.team.deals = 0;
  }
}

/* ---------- YTD board ---------- */
async function loadYTD(){
  try {
    const list = await getJSON("/ytd_av.json");           // [{name,email,av}]
    const totalObj = await getJSON("/ytd_total.json").catch(()=>({ytd_av_total:0}));
    const rosterByName = new Map(STATE.roster.map(a => [normName(a.name||""), a]));
    const rows = Array.isArray(list) ? list : [];
    const withAvatars = rows.map(r=>{
      const a = rosterByName.get(normName(r.name||""));
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

/* ---------- Vendor renderer: SVG donut (live) ---------- */
function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days || 45} days)`);
  setHead([]);

  const rows = Array.isArray(STATE.vendors.rows) ? STATE.vendors.rows : [];
  const total = rows.reduce((s,r)=> s + Number(r.deals||0), 0);
  if (!rows.length || total <= 0){
    setRows([[`<div style="text-align:center;color:#8aa0b8;padding:18px">No vendor data</div>`]]);
    return;
  }

  const normalized = rows.map(r => ({ name:r.name, val:Number(r.deals||0) }))
                         .filter(r=>r.val>0)
                         .sort((a,b)=> b.val - a.val);
  const size = 420;
  const r    = 180;
  let angle  = 0;

  const slices = normalized.map((s,i)=>{
    const frac = s.val / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI*2;
    angle = a1;

    const cx=size/2, cy=size/2;
    const x0=cx + r*Math.cos(a0), y0=cy + r*Math.sin(a0);
    const x1=cx + r*Math.cos(a1), y1=cy + r*Math.sin(a1);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const color = `hsl(${(i*48)%360} 70% 60%)`;

    const path = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    return `<path d="${path}" fill="${color}" opacity=".92"><title>${escapeHtml(s.name)} — ${(s.val/total*100).toFixed(1)}%</title></path>`;
  }).join("");

  const legend = normalized.slice(0,14).map((s,i)=>{
    const color = `hsl(${(i*48)%360} 70% 60%)`;
    const pct = (s.val/total*100).toFixed(1);
    return `<div style="display:flex;gap:8px;align-items:center"><span style="width:10px;height:10px;border-radius:2px;background:${color}"></span><span>${escapeHtml(s.name)}</span><span style="color:#9fb0c8;margin-left:6px">${pct}%</span></div>`;
  }).join("");

  const html = `
    <div style="display:flex;justify-content:center;gap:26px;align-items:center;padding:8px 0 12px;flex-wrap:wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Lead Vendor Breakdown">
        <g>${slices}</g>
        <circle cx="${size/2}" cy="${size/2}" r="88" fill="#0e1116"></circle>
        <text x="50%" y="50%" fill="#cfd7e3" text-anchor="middle" dominant-baseline="middle" style="font-weight:800;font-size:18px">VENDORS</text>
      </svg>
      <div style="min-width:240px;display:grid;grid-template-columns:1fr;gap:6px">${legend}</div>
    </div>
    <div style="text-align:center;color:#8aa0b8;font-size:12px;margin-top:6px">Last ${STATE.vendors.window_days} days as of ${escapeHtml(STATE.vendors.as_of || "")}</div>
  `;
  setRows([[html]]);
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
    const v = VIEW || VIEWS[viewIdx % VIEWS.length];
    if (v === "roster")      renderRoster();
    else if (v === "av")     renderWeekAV();
    else if (v === "aotw")   renderAOTW();
    else if (v === "vendors")renderVendors();
    else if (v === "ytd")    renderYTD();
    else                     renderRoster();
  } catch(e){
    log("render err", e?.message||e);
    setHead([]); setRows([["<div style='padding:18px;color:#d66'>Render error</div>"]]);
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
    if (!VIEW){
      setInterval(()=>{
        viewIdx = (viewIdx + 1) % VIEWS.length;
        renderCurrentView();
      }, ROTATE_MS);
    }

    if (DEBUG){
      console.log("Origin:", location.origin);
      console.log("Functions:", api("/.netlify/functions/team_sold"), api("/.netlify/functions/calls_by_agent"));
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
