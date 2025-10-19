/* ================= FEW Dashboard — FULL FILE (final) ================= */
"use strict";

/* ---------- Config ---------- */
const DEBUG      = new URLSearchParams(location.search).has("debug");
const log        = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };
const ET_TZ      = "America/New_York";
const DATA_MS    = 30_000;  // refresh cadence
const ROTATE_MS  = 30_000;  // view rotation cadence
const VIEWS      = ["roster","av","aotw","vendors","ytd"];
let   viewIdx    = 0;

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

/* ---------- Name normalize + alias (ONE copy) ---------- */
function normName(s){
  return String(s||"")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu,"")
    .replace(/\s+/g," ")
    .trim();
}
const NAME_ALIASES = new Map([
  ["a s", "ajani senior"],
  ["ajani s", "ajani senior"]
]);
function resolveAlias(n){
  const nn = normName(n);
  return NAME_ALIASES.get(nn) || nn;
}

/* ---------- Fetch helpers ---------- */
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){
  const r = await fetch(bust(u), { cache:"no-store" });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  const t = await r.text();
  try { return JSON.parse(t); }
  catch(e){ throw new Error(`Bad JSON from ${u}: ${e.message}`); }
}
function hmm(mins){
  const mm=Math.max(0,Math.round(Number(mins||0)));
  const h=Math.floor(mm/60), m2=mm%60;
  return `${h}:${String(m2).padStart(2,"0")}`;
}

/* ---------- Weekly window = Fri 12:00am ET → next Fri 12:00am ET ---------- */
function weekRangeET(){
  const now = toET(new Date());                 // ET
  const day = now.getDay();                     // Sun=0 … Sat=6
  const sinceFri = (day + 2) % 7;               // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                           // [inclusive, exclusive)
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                                   // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),                    // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),                    // key -> {sales,amount,av12x}
  team: { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd: { list:[], total:0 },
  vendors: { as_of:"", window_days:45, rows:[] }, // [{name,deals}]
  // splash de-dup + tick memory
  seenSaleHashes: new Set(),
  lastDealsShown: 0,
  // ONE-TIME weekly override (remove when no longer needed)
  overrides: {
    av: {
      perAgent: {
        "Philip Baxter": { av12x: 5637, sales: 2, mode: "hard" } // hard replace just for this week
      }
      // team: { totalAV12x: 0, totalSales: 0 } // (optional)
    }
  }
};
const agentKey = a => (a.email || a.name || "").trim().toLowerCase();

/* ---------- ONE (and only one) Rule banner, centered & bold ---------- */
function setRuleTextOne(rulesObj){
  const list = Array.isArray(rulesObj?.rules) ? rulesObj.rules : (Array.isArray(rulesObj) ? rulesObj : []);
  if (!list.length) return;

  // remove any legacy/duplicate banners
  ["ruleBanner","ticker","principle"].forEach(id=>{ const el = document.getElementById(id); if (el) el.remove(); });
  const hostOld = document.querySelector(".ruleBanner-host");
  if (hostOld) hostOld.remove();

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
        background:#0e1116; border:1px solid rgba(255,255,255,.06);
        box-shadow:0 10px 30px rgba(0,0,0,.35);
      }
      #ruleBanner .ruleText{
        font-weight:900;
        color:#cfd2d6;                  /* gray text */
        letter-spacing:.4px;
        font-size:clamp(22px,3.4vw,44px);
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

/* ---------- Load static: roster, rules, vendors ---------- */
async function loadStatic(){
  const [rosterRaw, rules, vendorRaw] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[]),
    getJSON("/sales_by_vendor.json").catch(()=>({ as_of:"", window_days:45, vendors:[] }))
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

  // vendors
  const rows = Array.isArray(vendorRaw?.vendors) ? vendorRaw.vendors : [];
  STATE.vendors = {
    as_of: vendorRaw?.as_of || "",
    window_days: Number(vendorRaw?.window_days || 45),
    rows: rows.map(v => ({ name:String(v.name||""), deals:Number(v.deals||0) }))
  };
}

/* ---------- Calls / talk / logged / leads / sold ---------- */
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

  STATE.callsWeekByKey = byKey;
  STATE.team.calls = Math.max(0, Math.round(teamCalls));
  STATE.team.talk  = Math.max(0, Math.round(teamTalk));
  STATE.team.leads = Math.max(0, Math.round(teamLeads));
  STATE.team.sold  = Math.max(0, Math.round(teamSold));
}

/* ---------- Weekly Sales → AV(12×) & Deals + Splash ---------- */
async function refreshSales(){
  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    const [WSTART, WEND] = weekRangeET();
    const perByName = new Map();   // nameKey -> { sales, amount, av12x }
    let totalDeals = 0;
    let totalAV    = 0;

    const raw = Array.isArray(payload?.allSales) ? payload.allSales : [];
    let newest = null;

    if (raw.length){
      for (const s of raw){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;

        if (!newest || when > toET(newest?.dateSold||0)) newest = s;

        const nameRaw = s.agent || s.name || "";
        const key     = resolveAlias(nameRaw);
        const amount  = Number(s.amount||0);

        const cur = perByName.get(key) || { sales:0, amount:0, av12x:0 };
        cur.sales  += 1;
        cur.amount += amount;
        cur.av12x   = cur.amount * 12;
        perByName.set(key, cur);

        totalDeals += 1;
        totalAV    += amount * 12;
      }
    } else {
      // fallback: only perAgent totals provided by backend
      const pa = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of pa){
        const key    = resolveAlias(a.name || "");
        const sales  = Number(a.sales||0);
        const amount = Number(a.amount||0);   // weekly $ (not 12x)
        perByName.set(key, { sales, amount, av12x: amount*12 });
        totalDeals += sales;
        totalAV    += amount*12;
      }
    }

    /* ---- ONE-TIME WEEKLY OVERRIDE (merge/replace) ---- */
    if (STATE.overrides?.av && typeof STATE.overrides.av === "object"){
      const oa = STATE.overrides.av.perAgent || {};
      for (const [rawName, v] of Object.entries(oa)){
        const k        = resolveAlias(rawName);
        const sales    = Number(v.sales || 0);
        const av12x    = Number(v.av12x || 0);
        const isHard   = String(v.mode||"").toLowerCase() === "hard";

        if (isHard){
          perByName.set(k, { sales, amount: av12x/12, av12x });
        } else {
          const cur = perByName.get(k) || { sales:0, amount:0, av12x:0 };
          const mergedSales = Math.max(cur.sales, sales);
          const mergedAV12x = Math.max(cur.av12x, av12x);
          perByName.set(k, { sales: mergedSales, amount: mergedAV12x/12, av12x: mergedAV12x });
        }
      }
      if (STATE.overrides.av.team){
        totalAV    += Number(STATE.overrides.av.team.totalAV12x || 0);
        totalDeals += Number(STATE.overrides.av.team.totalSales  || 0);
      }
    }

    // Build map keyed by roster identities so rows line up
    const out = new Map();
    for (const a of STATE.roster){
      const nk = resolveAlias(a.name);
      const s  = perByName.get(nk) || { sales:0, amount:0, av12x:0 };
      out.set(agentKey(a), s);
    }

    // update totals + splash
    const prevDeals = Number(STATE.team.deals || 0);
    STATE.salesWeekByKey = out;
    STATE.team.av        = Math.max(0, Math.round(totalAV));
    STATE.team.deals     = Math.max(0, Math.round(totalDeals));

    // Splash logic (requires seenSaleHashes)
    if (newest){
      const h = `${newest.leadId||""}|${newest.soldProductId||""}|${newest.dateSold||""}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        window.showSalePop?.({ name: newest.agent || "Team", amount: newest.amount || 0, ms: 60_000 });
      }
    } else if (STATE.team.deals > prevDeals) {
      let best = { name:"Team", score:-1, amount:0 };
      for (const a of STATE.roster){
        const s = STATE.salesWeekByKey.get(agentKey(a)) || { sales:0, amount:0 };
        const score = s.sales*10000 + s.amount;
        if (score > best.score) best = { name:a.name, amount:s.amount||0, score };
      }
      window.showSalePop?.({ name: best.name, amount: best.amount||0, ms: 60_000 });
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

/* ---------- Vendor renderer: small SVG pie (no external libs) ---------- */
function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days || 45} days)`);
  setHead([]);

  const rows = Array.isArray(STATE.vendors.rows) ? STATE.vendors.rows : [];
  const total = rows.reduce((s,r)=> s + Number(r.deals||0), 0);
  if (!rows.length || total <= 0){
    setRows([[`<div style="text-align:center;color:#8aa0b8;padding:18px">No vendor data</div>`]]);
    return;
  }

  // compute slices
  const normalized = rows.map(r => ({ name:r.name, val:Number(r.deals||0) }))
                         .filter(r=>r.val>0)
                         .sort((a,b)=> b.val - a.val);
  const size = 420;  // scaled down
  const r    = 180;
  let angle  = 0;

  const slices = normalized.map((s,i)=>{
    const frac = s.val / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI*2;
    angle = a1;

    // convert to arc path
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
    const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
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
