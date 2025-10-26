/* ================= FEW DASHBOARD — FULL REPLACEMENT ================== */
/* Single source of truth for all boards, one rule banner, live APIs     */
/* ===================================================================== */
"use strict";

/* ---------------------- Config ---------------------- */
const ET_TZ       = "America/New_York";
const ROTATE_MS   = 30_000;      // rotate boards every 30s
const REFRESH_MS  = 30_000;      // refetch data every 30s
const RULE_ROTATE_HOURS = 12;    // rotate rule of the day every 12h
const VENDOR_WINDOW_DAYS = 45;   // vendor chart window; API should honor

// Boards (exactly 4, fixed order)
const BOARDS = ["activity","weeklyAV","aotw","vendors"];
let   boardIdx = 0;

// Endpoints (root-relative to your domain)
const ENDPOINTS = {
  calls:           "/api/calls_by_agent",
  sold:            "/api/team_sold",
  vendors:         "/api/sales_by_vendor",
  roster:          "/headshots/roster.json",
  rules:           "/rules.json",
  ytdList:         "/ytd_av.json",
  ytdTotal:        "/ytd_total.json"
};

// Vendor name normalization (includes requested “TTM Nice!”)
const VENDOR_CANON = [
  "$7.50","George Region Shared","Red Media","Blast/Bulk","Exclusive JUMBO","ABC",
  "Shared Jumbo","VS Default","RKA Website","Redrip/Give up Purchased","Lamy Dynasty Specials",
  "JUMBO Splits","Exclusive 30s","Positive Intent/Argos","HotLine Bling","Referral","CG Exclusive",
  "TTM Nice!"
];

// UI colors
const COLOR = {
  gold: "#FFD700",
  goldSoft: "#ffd36a",
  muted: "#9fb0c8",
  text: "#cfd7e3",
  good: "#00e39b"
};

/* ---------------------- Utils ---------------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const safe  = v => (v==null?"":String(v));
const esc   = s => safe(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const pad2  = n => String(n).padStart(2,"0");
const fmtInt= n => Number(n||0).toLocaleString("en-US");
const fmt$  = n => "$" + Number(Math.round(n||0)).toLocaleString("en-US");
const toET  = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));
const hmm   = mins => { const m=Math.max(0,Math.round(Number(mins||0))); const h=Math.floor(m/60); const mm=m%60; return `${h}:${pad2(mm)}`; };
const initials = name => safe(name).trim().split(/\s+/).map(x=>x[0]||"").join("").slice(0,2).toUpperCase();

/* Cache-busted fetch */
async function getJSON(url){
  const u = url + (url.includes("?")?"&":"?") + "t=" + Date.now();
  const r = await fetch(u, { cache:"no-store" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

/* Friday→Friday ET week */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay(); // Sun 0 .. Sat 6
  const sinceFri = (day + 2) % 7;
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];
}

/* ---------------------- State ---------------------- */
const S = {
  roster: [],         // [{name,email,photo,phones:[]}]
  byKey: new Map(),   // key: email||name lower -> roster entry
  team: { calls:0, talk:0, leads:0, sold:0, av:0, deals:0 },
  calls: new Map(),   // key -> { calls, talkMin, loggedMin, leads, sold }
  sales: new Map(),   // key -> { sales, amount, av12x }
  aotw:  null,        // {a, av12x, sales}
  vendors: { as_of:"", window_days:VENDOR_WINDOW_DAYS, rows:[] },
  ytd: { list:[], total:0 },
  seenSales: new Set()
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------------------- Rule Banner (ONE banner only) ---------------------- */
function installRuleBanner(text){
  // remove any legacy tickers/subtitles
  ["ticker","principle","ruleBanner","rule-banner-css"].forEach(id=>{
    const el=document.getElementById(id); if (el) el.remove();
  });
  if (!$("#rule-banner-css")){
    const st = document.createElement("style");
    st.id="rule-banner-css";
    st.textContent = `
      .ruleBanner-host{ display:flex; align-items:center; justify-content:center; padding:8px 12px; }
      #ruleBanner{
        display:flex; align-items:center; justify-content:center; text-align:center;
        padding:18px 24px; margin:10px auto; max-width:1280px; border-radius:18px;
        background: rgba(255,255,255,0.03);
        box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 0 0 2px rgba(255,255,255,.06);
      }
      #ruleBanner .ruleText{
        font-weight: 1000; letter-spacing:.6px; color:#cfd6de;
        font-size: clamp(28px, 3.4vw, 48px); line-height:1.15;
      }`;
    document.head.appendChild(st);
  }
  let host = $(".ruleBanner-host");
  if (!host){
    host = document.createElement("div"); host.className="ruleBanner-host";
    const bannerZone = document.querySelector("header.banner") || document.body;
    bannerZone.insertAdjacentElement("afterend", host);
  }
  host.innerHTML = `<div id="ruleBanner"><div class="ruleText">${esc(text)}</div></div>`;
}

function rotateRule(rules){
  if (!Array.isArray(rules) || rules.length===0) return;
  const epochHours = Math.floor(Date.now() / 3_600_000);
  const slot = Math.floor(epochHours / RULE_ROTATE_HOURS) % rules.length;
  const base = "THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT";
  const rule = String(rules[slot]||"").replace(/Bonus\)\s*/,"Bonus: ");
  installRuleBanner(`${base}<br>${esc(rule)}`);
}

/* ---------------------- Sale Banner (centered, no “×12”) ---------------------- */
(function initSaleBanner(){
  const el = document.getElementById("salePop");
  if (!el) return;
  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";

  window.showSaleBanner = ({ agent, amount })=>{
    const annual = Math.round(Number(amount||0) * 12); // compute, but do NOT show “×12”
    el.innerHTML = `
      <div style="
        display:inline-block; padding:18px 26px; border-radius:16px;
        background:#123a22; border:1px solid #2ad47a; box-shadow:0 14px 40px rgba(0,0,0,.5)">
        <div style="font-size:12px; letter-spacing:.12em; color:#7bf7bd; text-align:center">NEW SALE</div>
        <div style="font-size:28px; font-weight:800; margin-top:6px; color:#fff; text-align:center">${esc(agent)}</div>
        <div style="font-size:22px; font-weight:900; margin-top:4px; color:#9df6c7; text-align:center">$${fmtInt(annual)}</div>
      </div>`;
    el.classList.add("show");
    setTimeout(()=> el.classList.remove("show"), 60_000); // 60s hold
  };
})();

/* ---------------------- DOM Table helpers ---------------------- */
function setLabel(s){ const el=$("#viewLabel"); if (el) el.textContent=s; }
function setHead(cols){ const thead=$("#thead"); if (thead) thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`; }
function setRows(rows){
  const tbody=$("#tbody"); if (!tbody) return;
  tbody.innerHTML = rows && rows.length
    ? rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:${COLOR.muted}">No data yet.</td></tr>`;
}

/* ---------------------- Avatars ---------------------- */
function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  if (src){
    return `<div class="agent">
      <img class="avatar" src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">
      <span>${esc(a.name)}</span>
    </div>`;
  }
  return `<div class="agent">
    <div class="avatar-fallback">${initials(a.name)}</div><span>${esc(a.name)}</span>
  </div>`;
}
function avatarBlock(a, size=120){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  const style = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover`;
  if (src){
    return `<img src="${src}" style="${style}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot; style=&quot;${style};display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size/3)}px;background:#1f2a3a;color:#89a2c6&quot;>${initials(a.name)}</div>')">`;
  }
  return `<div class="avatar-fallback" style="${style};display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size/3)}px;background:#1f2a3a;color:#89a2c6">${initials(a.name)}</div>`;
}

/* ---------------------- Loading & Static ---------------------- */
async function loadStatic(){
  // Roster
  const rosterRaw = await getJSON(ENDPOINTS.roster).catch(()=>[]);
  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  S.roster = list.map(a=>({
    name: a.name,
    email: safe(a.email).toLowerCase(),
    photo: a.photo || "",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));
  S.byKey = new Map(S.roster.map(a => [agentKey(a), a]));

  // Rules (one banner)
  const rules = await getJSON(ENDPOINTS.rules).catch(()=>[]);
  const ruleList = Array.isArray(rules?.rules) ? rules.rules : (Array.isArray(rules) ? rules : []);
  rotateRule(ruleList);

  // YTD overrides
  const ytdList  = await getJSON(ENDPOINTS.ytdList).catch(()=>[]);
  const ytdTotal = await getJSON(ENDPOINTS.ytdTotal).catch(()=>({ ytd_av_total: 0 }));
  const rosterByName = new Map(S.roster.map(a=>[safe(a.name).toLowerCase(), a]));
  const yRows = (Array.isArray(ytdList)? ytdList : []).map(r=>{
    const a = rosterByName.get(safe(r.name).toLowerCase());
    return { name: r.name, av: Number(r.av||0), photo: a?.photo||"" };
  }).sort((x,y)=> (y.av)-(x.av));
  S.ytd = { list: yRows, total: Number(ytdTotal?.ytd_av_total||0) };
}

/* ---------------------- Live Feeds ---------------------- */
async function refreshActivity(){
  try{
    const j = await getJSON(ENDPOINTS.calls);
    S.team.calls = Math.round(Number(j?.team?.calls||0));
    S.team.talk  = Math.round(Number(j?.team?.talkMin||0));
    S.team.leads = Math.round(Number(j?.team?.leads||0));
    S.team.sold  = Math.round(Number(j?.team?.sold||0));
    const per = Array.isArray(j?.perAgent) ? j.perAgent : [];
    const map = new Map();
    for (const r of per){
      const k = (safe(r.email)||safe(r.name)).toLowerCase();
      map.set(k, {
        calls: Number(r.calls||0),
        talkMin: Number(r.talkMin||0),
        loggedMin: Number(r.loggedMin||0),
        leads: Number(r.leads||0),
        sold: Number(r.sold||0)
      });
    }
    S.calls = map;
  }catch(e){
    console.warn("refreshActivity", e);
  }
}

async function refreshSales(){
  try{
    const j = await getJSON(ENDPOINTS.sold);
    const [WSTART, WEND] = weekRangeET();
    let perName = new Map();
    let totalDeals = 0;
    let totalAV12  = 0;

    // Prefer per-sale list when available
    const raw = Array.isArray(j?.allSales) ? j.allSales : [];
    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;
        const name = safe(s.agent).toLowerCase();
        const amt  = Number(s.amount||0);
        const cur = perName.get(name) || { sales:0, amount:0, av12x:0 };
        cur.sales += 1;
        cur.amount += amt;
        cur.av12x = cur.amount * 12;
        perName.set(name, cur);
        totalDeals += 1;
        totalAV12  += amt*12;

        // Sale banner (dedupe by composite key)
        const uid = `${s.leadId||""}|${s.soldProductId||""}|${s.dateSold||""}`;
        if (!S.seenSales.has(uid)){
          S.seenSales.add(uid);
          window.showSaleBanner({ agent: s.agent || "Agent", amount: amt });
        }
      }
    } else {
      // fallback to rollup
      const pa = Array.isArray(j?.perAgent) ? j.perAgent : [];
      for (const a of pa){
        const name = safe(a.name).toLowerCase();
        const sales = Number(a.sales||0);
        const amount= Number(a.amount||0);
        perName.set(name, { sales, amount, av12x: amount*12 });
        totalDeals += sales;
        totalAV12  += amount*12;
      }
    }

    // map to roster keys
    const salesMap = new Map();
    for (const a of S.roster){
      const k = safe(a.name).toLowerCase();
      const s = perName.get(k) || { sales:0, amount:0, av12x:0 };
      salesMap.set(agentKey(a), s);
    }
    S.sales = salesMap;
    S.team.deals = Math.round(totalDeals);
    S.team.av    = Math.round(totalAV12);

    // compute aotw (by AV, tie-breaker: deals then gross)
    const ranks = S.roster.map(a=>{
      const s = S.sales.get(agentKey(a)) || { av12x:0, sales:0, amount:0 };
      return { a, av12x:Number(s.av12x||0), sales:Number(s.sales||0), amount:Number(s.amount||0) };
    }).sort((x,y)=>{
      if (y.av12x !== x.av12x) return y.av12x - x.av12x;
      if (y.sales !== x.sales) return y.sales - x.sales;
      return y.amount - x.amount;
    });
    S.aotw = ranks[0] || null;
  }catch(e){
    console.warn("refreshSales", e);
  }
}

function normalizeVendor(name){
  const n = safe(name).trim();
  // return canon match when obvious, else pass through
  const hit = VENDOR_CANON.find(v => v.toLowerCase() === n.toLowerCase());
  return hit || n;
}

async function refreshVendors(){
  try{
    const j = await getJSON(ENDPOINTS.vendors);
    const rows = Array.isArray(j?.vendors) ? j.vendors : [];
    const by = new Map();
    for (const r of rows){
      const key = normalizeVendor(r.name || r.vendor || r.source || "");
      const deals = Number(r.deals || r.count || 0);
      by.set(key, (by.get(key)||0) + deals);
    }
    const list = Array.from(by.entries()).map(([name,deals])=>({ name, deals }))
      .sort((a,b)=> b.deals - a.deals);
    S.vendors = { as_of: j?.as_of || "", window_days: Number(j?.window_days || VENDOR_WINDOW_DAYS), rows: list };
  }catch(e){
    console.warn("refreshVendors", e);
    S.vendors = { as_of:"", window_days:VENDOR_WINDOW_DAYS, rows:[] };
  }
}

/* ---------------------- Summary Cards ---------------------- */
function renderSummary(){
  const callsEl=$("#sumCalls"), avEl=$("#sumSales"), dealsEl=$("#sumTalk");
  if (callsEl) callsEl.textContent = fmtInt(S.team.calls);
  if (avEl)    avEl.textContent    = fmt$  (S.team.av);
  if (dealsEl) dealsEl.textContent = fmtInt(S.team.deals);
}

/* ---------------------- Boards ---------------------- */
function renderActivity(){
  setLabel("Agent Activity — This Week");
  setHead(["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %"]);
  const rows = S.roster.map(a=>{
    const c = S.calls.get(agentKey(a)) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = S.sales.get(agentKey(a)) || { sales:0 };
    const conv = c.leads > 0 ? (s.sales / c.leads) : null;
    return [
      avatarCell(a),
      fmtInt(c.calls),
      fmtInt(Math.round(c.talkMin)),
      hmm(c.loggedMin),
      fmtInt(c.leads),
      fmtInt(s.sales),
      (conv==null? "—" : `${(Math.round(conv*1000)/10).toFixed(1)}%`)
    ];
  });
  setRows(rows);
}

function renderWeeklyAV(){
  setLabel("This Week — Submitted AV");
  setHead(["Agent","Submitted AV"]);
  const rows = S.roster
    .map(a=>({ a, av12: Number((S.sales.get(agentKey(a))||{}).av12x||0) }))
    .sort((x,y)=> y.av12 - x.av12)
    .map(({a,av12}) => [avatarCell(a), fmt$(av12)]);
  setRows(rows);
}

function renderAOTW(){
  setLabel("Agent of the Week");
  setHead([]);
  const best = S.aotw;
  if (!best){ setRows([]); return; }
  const a = best.a;
  const weeklyDeals = fmtInt(best.sales);
  const weeklyAV    = fmt$(best.av12x);
  const ytdRow = S.ytd.list.find(r => safe(r.name).toLowerCase() === safe(a.name).toLowerCase());
  const ytdAV  = ytdRow ? fmt$(ytdRow.av) : fmt$(0);
  const html = `
    <div style="display:flex;align-items:center;gap:24px; padding:14px 10px;">
      ${avatarBlock(a, 140)}
      <div>
        <div style="font-size:28px;font-weight:900;margin-bottom:6px">${esc(a.name)}</div>
        <div style="color:${COLOR.muted};margin-bottom:10px">LEADING FOR AGENT OF THE WEEK</div>
        <div style="display:flex;gap:20px;color:${COLOR.muted};flex-wrap:wrap">
          <div><b style="color:${COLOR.text}">${weeklyDeals}</b> deals</div>
          <div><b style="color:${COLOR.goldSoft}">${weeklyAV}</b> submitted AV</div>
          <div><b style="color:${COLOR.gold}">${ytdAV}</b> YTD AV</div>
        </div>
      </div>
    </div>`;
  setRows([[html]]);
}

function renderVendors(){
  const days = S.vendors.window_days || VENDOR_WINDOW_DAYS;
  setLabel(`Lead Vendors — Last ${days} Days`);
  setHead([]);
  const rows = S.vendors.rows||[];
  if (!rows.length){
    setRows([[`<div style="padding:20px;color:${COLOR.muted};text-align:center">No vendor data yet.</div>`]]);
    return;
  }
  const total = rows.reduce((a,b)=> a + Number(b.deals||0), 0) || 1;

  // Simple list with % (Chart.js optional, not required)
  const listHtml = `
    <div style="display:grid;grid-template-columns:1fr 140px 120px;gap:8px;width:min(860px,95%);margin:0 auto;">
      <div style="color:${COLOR.muted};font-weight:700">Vendor</div>
      <div style="color:${COLOR.muted};font-weight:700;text-align:right">Deals</div>
      <div style="color:${COLOR.muted};font-weight:700;text-align:right">% of Sales</div>
      ${rows.map((r,i)=>`
        <div>${esc(r.name)}</div>
        <div style="text-align:right">${fmtInt(r.deals||0)}</div>
        <div style="text-align:right">${((r.deals||0)*100/total).toFixed(1)}%</div>
      `).join("")}
      <div style="border-top:1px solid #223046;margin-top:6px;padding-top:6px;color:${COLOR.muted}">Total</div>
      <div style="border-top:1px solid #223046;margin-top:6px;padding-top:6px;text-align:right">${fmtInt(total)}</div>
      <div style="border-top:1px solid #223046;margin-top:6px;padding-top:6px;text-align:right">100.0%</div>
    </div>
    <div style="text-align:center;color:${COLOR.muted};margin-top:10px;">As of ${esc(S.vendors.as_of || "")}</div>`;
  setRows([[listHtml]]);
}

/* ---------------------- Router ---------------------- */
function renderBoard(){
  renderSummary();
  const id = BOARDS[boardIdx % BOARDS.length];
  if (id === "activity")  return renderActivity();
  if (id === "weeklyAV")  return renderWeeklyAV();
  if (id === "aotw")      return renderAOTW();
  if (id === "vendors")   return renderVendors();
  renderActivity();
}

/* ---------------------- Boot ---------------------- */
async function tickAll(){
  await Promise.all([refreshActivity(), refreshSales(), refreshVendors()]);
  renderBoard();
}

async function boot(){
  try{
    await loadStatic();
    await tickAll();

    // rotate boards
    setInterval(()=>{ boardIdx = (boardIdx + 1) % BOARDS.length; renderBoard(); }, ROTATE_MS);
    // refresh live data
    setInterval(()=>{ tickAll().catch(e=>console.warn("tickAll", e)); }, REFRESH_MS);
  }catch(e){
    console.error("boot error", e);
    const tbody=$("#tbody"); if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error: ${esc(e.message||e)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", boot);
/* ============================== END ============================== */
