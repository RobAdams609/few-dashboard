/* ================= FEW Dashboard — FULL REWRITE (permanent) ================= */
"use strict";

/* ---------- Runtime flags ---------- */
const DEBUG = new URLSearchParams(location.search).has("debug");
const log   = (...a)=>{ if (DEBUG) console.log("[DBG]", ...a); };

/* ---------- Time + format ---------- */
const ET_TZ = "America/New_York";
const toET  = d => new Date(new Date(d).toLocaleString("en-US",{ timeZone: ET_TZ }));

const fmtInt   = n => Number(n||0).toLocaleString("en-US");
const fmtMoney = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtPct   = n => (n==null ? "—" : (Math.round(n*1000)/10).toFixed(1) + "%");
const initials = n => String(n||"").trim().split(/\s+/).map(s=>s[0]||"").join("").slice(0,2).toUpperCase();
const hmm      = mins => { const m=Math.max(0,Math.round(Number(mins||0))); const h=Math.floor(m/60), r=m%60; return `${h}:${String(r).padStart(2,"0")}`; };
const esc      = s => String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));

/* ---------- Week & window helpers ---------- */
function weekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                     // Sun=0…Sat=6
  const sinceFri = (day + 2) % 7;               // distance back to Friday
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - sinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start, end];                           // [inclusive, exclusive)
}

function daysAgoET(n){
  const now = toET(new Date());
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d;
}

/* ---------- Fetch (no-store, with cache-bust) ---------- */
function bust(u){ return u + (u.includes("?")?"&":"?") + "t=" + Date.now(); }
async function getJSON(u){
  const r = await fetch(bust(u), { cache:"no-store" });
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  const t = await r.text();
  try { return JSON.parse(t); }
  catch(e){ throw new Error(`Bad JSON from ${u}: ${e.message}`); }
}

/* ---------- DOM shortcuts ---------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- Vendor normalization (PERMANENT) ---------- */
/* The canonical vendor buckets we will chart against. */
const VENDOR_BUCKETS = [
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

/* Map many raw product/vendor strings into those buckets. */
const VENDOR_MAP = (()=> {
  const m = new Map();
  const put = (k,v)=> m.set(k.toLowerCase(), v);

  // one-to-ones
  VENDOR_BUCKETS.forEach(v=> put(v, v));

  // common spellings / synonyms
  [
    ["Exclusive Jumbo",       "Exclusive JUMBO"],
    ["Exclusive 30",          "Exclusive 30s"],
    ["Exclusive30s",          "Exclusive 30s"],
    ["Jumbo Splits",          "JUMBO Splits"],
    ["Shared JUMBO",          "Shared Jumbo"],
    ["VSDefault",             "VS Default"],
    ["VS - Default",          "VS Default"],
    ["RKA",                   "RKA Website"],
    ["RKA Web",               "RKA Website"],
    ["Give up Purchased",     "Redrip/Give up Purchased"],
    ["Redrip",                "Redrip/Give up Purchased"],
    ["Lamy",                  "Lamy Dynasty Specials"],
    ["Lamy Dynasty",          "Lamy Dynasty Specials"],
    ["Hotline Bling",         "HotLine Bling"],
    ["PI Argos",              "Positive Intent/Argos"],
    ["Positive Intent",       "Positive Intent/Argos"],
    ["Argos",                 "Positive Intent/Argos"],
    ["ABC Leads",             "ABC"],
    ["ABC Default",           "ABC"],
    ["Blast",                 "Blast/Bulk"],
    ["Bulk",                  "Blast/Bulk"],
  ].forEach(([raw,canon])=> put(raw, canon));

  return m;
})();

/* normalize a raw sold product / vendor string into our bucket */
function normalizeVendor(raw){
  const s = String(raw||"").trim();
  if (!s) return "Other";
  // pull out obvious labels from patterns like "Red Media - $250"
  const head = s.split("-")[0].trim();

  // direct hits or synonyms
  const tryKeys = [s, head];
  for (const k of tryKeys){
    const hit = VENDOR_MAP.get(k.toLowerCase());
    if (hit) return hit;
  }

  // special patterns
  if (/\$?\s*7(\.00|\.5|\.50)?/i.test(s) || /\$7\.50/.test(s) || /7\.50/.test(s)) return "$7.50";
  if (/exclusive/i.test(s) && /jumbo/i.test(s)) return "Exclusive JUMBO";
  if (/exclusive/i.test(s) && /(30s|30’s|30)/i.test(s)) return "Exclusive 30s";
  if (/jumbo/i.test(s) && /split/i.test(s)) return "JUMBO Splits";
  if (/referr?/i.test(s)) return "Referral";
  if (/lamy/i.test(s)) return "Lamy Dynasty Specials";
  if (/red\s*media/i.test(s)) return "Red Media";
  if (/vs.*default/i.test(s)) return "VS Default";
  if (/rka/i.test(s)) return "RKA Website";
  if (/abc/i.test(s)) return "ABC";
  if (/blast|bulk/i.test(s)) return "Blast/Bulk";
  if (/shared.*jumbo/i.test(s)) return "Shared Jumbo";
  if (/hot\s*line\s*bling/i.test(s)) return "HotLine Bling";
  if (/positive|argos/i.test(s)) return "Positive Intent/Argos";
  if (/redrip|give ?up/i.test(s)) return "Redrip/Give up Purchased";
  if (/cg.*exclusive/i.test(s)) return "CG Exclusive";

  return "Other";
}

/* ---------- State ---------- */
const STATE = {
  roster: [],                 // [{name,email,photo,phones}]
  callsWeekByKey: new Map(),  // key -> {calls,talkMin,loggedMin,leads,sold}
  salesWeekByKey: new Map(),  // key -> {sales,amount,av12x}
  vendors: { as_of:"", rows:[], window_days:45 },
  team:   { calls:0, talk:0, av:0, deals:0, leads:0, sold:0 },
  ytd:    { list:[], total:0 },
  seenSaleHashes: new Set()
};

/* ---------- UI: summary + table ---------- */
function setLabel(txt){ const el=$("#viewLabel"); if (el) el.textContent = txt; }
function setHead(cols){
  const thead=$("#thead"); if (!thead) return;
  thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
}
function setRows(rows){
  const tbody=$("#tbody"); if (!tbody) return;
  tbody.innerHTML = rows && rows.length
    ? rows.map(r=> `<tr>${r.map((c,i)=>`<td class="${i>0?"num":""}">${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td style="padding:18px;color:#5c6c82;">Loading...</td></tr>`;
}

function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : "";
  const img = src
    ? `<img class="avatar" src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${esc(a.name)}</span></div>`;
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

/* ---------- Big centered GOLD splash (NO TOASTER) ---------- */
(function installSplashStyles(){
  const css = `
  #saleSplash{
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background: rgba(0,0,0,.55); z-index: 99999;
    backdrop-filter: blur(2px);
  }
  #saleSplash .panel{
    background:#0e1116; border:2px solid #3a4353; border-radius:24px;
    padding:28px 34px; max-width:90vw; text-align:center;
    box-shadow:0 25px 80px rgba(0,0,0,.55);
  }
  #saleSplash .who{
    font-weight:900; font-size: clamp(28px,5vw,64px);
    color:#FFD36A; letter-spacing:.5px; line-height:1.1;
  }
  #saleSplash .av{
    margin-top:8px; font-weight:900; font-size: clamp(26px,4.5vw,56px);
    color:#FFD36A; text-shadow: 0 0 22px rgba(255,211,106,.35);
  }
  #saleSplash .sub{
    margin-top:8px; color:#98a7bd; font-size:14px;
  }`;
  const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);

  const host = document.createElement("div");
  host.id = "saleSplash";
  host.innerHTML = `<div class="panel"><div class="who"></div><div class="av"></div><div class="sub">Submitted AV (annualized)</div></div>`;
  document.body.appendChild(host);

  window.showCenterSplash = function({name, amount12x, ms}){
    const el = $("#saleSplash"); if (!el) return;
    el.querySelector(".who").innerHTML = `<span class="who">${esc(name||"Team")}</span>`;
    el.querySelector(".av").innerHTML  = `<span class="av">${fmtMoney(amount12x||0)}</span>`;
    el.style.display = "flex";
    clearTimeout(window.__splashTimer);
    window.__splashTimer = setTimeout(()=>{ el.style.display = "none"; }, ms||60_000);
  };
})();

/* ---------- Data loaders ---------- */
async function loadRosterAndRules(){
  const [rosterRaw, rules] = await Promise.all([
    getJSON("/headshots/roster.json").catch(()=>[]),
    getJSON("/rules.json").catch(()=>[])
  ]);

  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw) ? rosterRaw : []);
  STATE.roster = list.map(a => ({
    name: a.name,
    email: (a.email||"").trim().toLowerCase(),
    photo: a.photo||"",
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  // one banner (safe)
  if (Array.isArray(rules?.rules) && rules.rules.length){
    const idx  = (new Date().getUTCDate()) % rules.rules.length;
    const text = String(rules.rules[idx]||"").replace(/Bonus\)\s*/,"Bonus: ");
    const id = "rule-banner-css-one";
    if (!document.getElementById(id)){
      const el=document.createElement("style"); el.id=id;
      el.textContent = `
        #ruleBanner{display:flex;align-items:center;justify-content:center;text-align:center;
          padding:18px 22px;margin:10px auto 12px;max-width:1200px;border-radius:18px;
          background:#0e1116;border:1px solid rgba(255,255,255,.06);box-shadow:0 10px 30px rgba(0,0,0,.35)}
        #ruleBanner .ruleText{font-weight:900;color:#cfd2d6;letter-spacing:.4px;font-size:clamp(22px,3.4vw,44px)}
        .ruleBanner-host{position:relative;z-index:2}
      `;
      document.head.appendChild(el);
    }
    const host=document.createElement("div"); host.className="ruleBanner-host";
    host.innerHTML = `<div id="ruleBanner"><div class="ruleText">${esc(text)}</div></div>`;
    const target = document.querySelector("#app") || document.body;
    target.insertBefore(host, target.firstChild);
  }
}

async function refreshCalls(){
  let teamCalls=0, teamTalk=0, teamLeads=0, teamSold=0;
  const byKey = new Map();

  try{
    const payload = await getJSON("/.netlify/functions/calls_by_agent");
    const per = Array.isArray(payload?.perAgent) ? payload.perAgent : [];

    const emailToKey = new Map(STATE.roster.map(a=> [String(a.email||"").trim().toLowerCase(), (a.email||a.name||"").toLowerCase()]));
    const nameToKey  = new Map(STATE.roster.map(a=> [String(a.name||"").trim().toLowerCase(), (a.email||a.name||"").toLowerCase()]));

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
      byKey.set(k,row);
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

/* Pull weekly sales + compute team totals + splash */
async function refreshSalesAndVendors(){
  const [WSTART, WEND] = weekRangeET();
  const FORTYFIVE = 45;

  let totalDeals=0, totalAV12=0;
  const perByRosterKey = new Map();

  // for vendor donut
  const vendorBucket = new Map(VENDOR_BUCKETS.map(v=> [v,0]));
  let vendorsAsOf = toET(new Date()).toISOString().slice(0,10);

  try{
    const payload = await getJSON("/.netlify/functions/team_sold");

    // Prefer detailed events for both weekly & 45d vendor window
    const rawAll = Array.isArray(payload?.allSales) ? payload.allSales : [];

    // 1) Weekly stats (Fri->Fri)
    if (rawAll.length){
      for (const s of rawAll){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < WSTART || when >= WEND) continue;

        const rosterKey = String((s.email||s.agentEmail||s.agent||s.name||"")).trim().toLowerCase();
        const amountWeek = Number(s.amount||0);          // weekly $
        const av12x = amountWeek * 12;

        const cur = perByRosterKey.get(rosterKey) || { sales:0, amount:0, av12x:0 };
        cur.sales  += 1;
        cur.amount += amountWeek;
        cur.av12x  += av12x;
        perByRosterKey.set(rosterKey, cur);

        totalDeals += 1;
        totalAV12  += av12x;
      }
    } else {
      // Fallback to summarized perAgent (still multiply ×12)
      const pa = Array.isArray(payload?.perAgent) ? payload.perAgent : [];
      for (const a of pa){
        const rosterKey = String((a.email||a.name||"")).trim().toLowerCase();
        const sales  = Number(a.sales||0);
        const amount = Number(a.amount||0);
        const av12x  = amount * 12;
        perByRosterKey.set(rosterKey, { sales, amount, av12x });
        totalDeals += sales;
        totalAV12  += av12x;
      }
    }

    // 2) Vendor donut from actual events in last 45 days
    if (rawAll.length){
      const since = daysAgoET(FORTYFIVE);
      const now = toET(new Date());
      vendorsAsOf = now.toISOString().slice(0,10);

      for (const s of rawAll){
        const when = s.dateSold ? toET(s.dateSold) : null;
        if (!when || when < since || when > now) continue;

        const rawVendor = s.vendor || s.soldProductName || s.product || s.source || "";
        const bucket = normalizeVendor(rawVendor);
        const prev = vendorBucket.get(bucket);
        vendorBucket.set(bucket, (prev||0) + 1);
      }
    } else {
      // Optional manual seed (paste the raw text into localStorage.setItem('seed_45d', '...'))
      try{
        const seedText = localStorage.getItem("seed_45d") || "";
        if (seedText){
          const lines = seedText.split(/\n+/);
          const since = daysAgoET(FORTYFIVE);
          const now = toET(new Date());
          vendorsAsOf = now.toISOString().slice(0,10);

          for (const line of lines){
            const m = line.match(/^\s*([A-Za-z].*?)\s*-\s*\$/) || line.match(/^\s*\$?7\.?50\b/i) || null;
            if (!m) continue;
            const bucket = normalizeVendor(line);
            const prev = vendorBucket.get(bucket);
            vendorBucket.set(bucket, (prev||0) + 1);
          }
        }
      }catch(e){ /* ignore seed issues */ }
    }

  }catch(e){
    log("team_sold error", e?.message||e);
  }

  // Reindex weekly map by roster identity so rows line up
  const out = new Map();
  for (const a of STATE.roster){
    const key = String((a.email||a.name||"")).trim().toLowerCase();
    const s = perByRosterKey.get(key) || { sales:0, amount:0, av12x:0 };
    out.set(key, s);
  }
  STATE.salesWeekByKey = out;
  STATE.team.av        = Math.max(0, Math.round(totalAV12));
  STATE.team.deals     = Math.max(0, Math.round(totalDeals));

  // Build vendors rows (strip zeroes, sort desc)
  const rows = [];
  vendorBucket.forEach((v,k)=> { if (v>0) rows.push({name:k, deals:v}); });
  rows.sort((a,b)=> b.deals - a.deals);
  STATE.vendors = { as_of: vendorsAsOf, rows, window_days:45 };

  // Splash on newest weekly contributor (compute delta)
  try {
    const lastTotals = Number(sessionStorage.getItem("prev_deals")||"0");
    if (STATE.team.deals > lastTotals){
      // choose the strongest contributor this tick
      let best = { name:"Team", score:-1, av12:0 };
      for (const a of STATE.roster){
        const k = String((a.email||a.name||"")).trim().toLowerCase();
        const s = STATE.salesWeekByKey.get(k) || { sales:0, amount:0 };
        const score = (s.sales||0)*10000 + (s.amount||0);
        if (score > best.score) best = { name:a.name, score, av12:(s.amount||0)*12 };
      }
      window.showCenterSplash({ name: best.name, amount12x: best.av12, ms: 60_000 });
    }
    sessionStorage.setItem("prev_deals", String(STATE.team.deals||0));
  }catch(e){}
}

/* ---------- YTD ---------- */
async function loadYTD(){
  try{
    const list = await getJSON("/ytd_av.json").catch(()=>[]);
    const totalObj = await getJSON("/ytd_total.json").catch(()=>({ytd_av_total:0}));
    const byName = new Map(STATE.roster.map(a=> [String(a.name||"").trim().toLowerCase(), a]));
    const rows = Array.isArray(list) ? list : [];
    const withAv = rows.map(r=>{
      const a = byName.get(String(r.name||"").trim().toLowerCase());
      return { name:r.name, email:r.email, av:Number(r.av||0), photo:a?.photo||"" };
    }).sort((x,y)=> (y.av)-(x.av));
    STATE.ytd.list  = withAv;
    STATE.ytd.total = Number(totalObj?.ytd_av_total||0);
  }catch(e){
    STATE.ytd = { list:[], total:0 };
    log("ytd load error", e?.message||e);
  }
}

/* ---------- Renderers ---------- */
function renderRoster(){
  setLabel("This Week — Roster");
  setHead(["Agent","Calls","Talk (min)","Logged (h:mm)","Leads","Sold","Conv %","Submitted AV"]);
  const rows = (STATE.roster||[]).map(a=>{
    const k = String((a.email||a.name||"")).trim().toLowerCase();
    const c = STATE.callsWeekByKey.get(k) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const s = STATE.salesWeekByKey.get(k) || { av12x:0, sales:0, amount:0 };
    const conv = c.leads > 0 ? (Number(s.sales||0) / Number(c.leads||0)) : null;
    return [
      avatarCell(a),
      fmtInt(c.calls),
      fmtInt(Math.round(c.talkMin)),
      hmm(c.loggedMin),
      fmtInt(c.leads),
      fmtInt(Number(s.sales||0)),
      fmtPct(conv),
      fmtMoney(Number(s.av12x||((s.amount||0)*12)))
    ];
  });
  setRows(rows);
}

function renderWeekAV(){
  setLabel("This Week — Leaderboard (Submitted AV)");
  setHead(["Agent","Submitted AV"]);
  const ranked = (STATE.roster||[])
    .map(a=>{
      const k = String((a.email||a.name||"")).trim().toLowerCase();
      const s = STATE.salesWeekByKey.get(k) || { av12x:0, amount:0 };
      const val = Number(s.av12x || ((s.amount||0)*12));
      return { a, val };
    })
    .sort((x,y)=> (y.val)-(x.val));
  setRows(ranked.map(({a,val})=> [avatarCell(a), fmtMoney(val)]));
}

function bestOfWeek(){
  const entries = STATE.roster.map(a=>{
    const k = String((a.email||a.name||"")).trim().toLowerCase();
    const s = STATE.salesWeekByKey.get(k) || { av12x:0, sales:0, amount:0 };
    const av12 = Number(s.av12x || ((s.amount||0)*12));
    return { a, av12, sales:Number(s.sales||0), amt:Number(s.amount||0) };
  });
  entries.sort((x,y)=> (y.av12 - x.av12) || (y.sales - x.sales) || (y.amt - x.amt));
  return entries[0] || null;
}

function renderAOTW(){
  setLabel("Agent of the Week");
  setHead([]);
  const top = bestOfWeek();
  if (!top){ setRows([[`<div style="padding:18px;color:#8aa0b8;text-align:center">No data yet</div>`]]); return; }
  const { a, av12, sales } = top;
  const html = `
    <div style="display:flex;gap:18px;align-items:center;">
      ${avatarBlock(a)}
      <div>
        <div style="font-size:22px;font-weight:800;margin-bottom:4px">${esc(a.name)}</div>
        <div style="color:#9fb0c8;margin-bottom:6px;">LEADING FOR AGENT OF THE WEEK</div>
        <div style="display:flex;gap:18px;color:#9fb0c8">
          <div><b style="color:#cfd7e3">${fmtInt(sales)}</b> deals</div>
          <div><b style="color:#ffd36a">${fmtMoney(av12)}</b> submitted AV</div>
        </div>
      </div>
    </div>
  `;
  setRows([[html]]);
}

function renderVendors(){
  setLabel(`Lead Vendors — % of Sales (Last ${STATE.vendors.window_days||45} days)`);
  setHead([]);

  const rows = Array.isArray(STATE.vendors.rows) ? STATE.vendors.rows : [];
  const total = rows.reduce((s,r)=> s + Number(r.deals||0), 0);
  if (!rows.length || total <= 0){
    setRows([[`<div style="text-align:center;color:#8aa0b8;padding:18px">No vendor data</div>`]]);
    return;
  }

  const normalized = rows.map(r=> ({ name:r.name, val:Number(r.deals||0) }))
    .filter(r=>r.val>0)
    .sort((a,b)=> b.val - a.val);

  const size=420, R=180; let angle=0;
  const slices = normalized.map((s,i)=>{
    const frac = s.val / total;
    const a0 = angle, a1 = angle + frac * Math.PI*2; angle = a1;
    const cx=size/2, cy=size/2;
    const x0=cx + R*Math.cos(a0), y0=cy + R*Math.sin(a0);
    const x1=cx + R*Math.cos(a1), y1=cy + R*Math.sin(a1);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const color = `hsl(${(i*48)%360} 70% 60%)`;
    const path = `M ${cx} ${cy} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
    return `<path d="${path}" fill="${color}" opacity=".92"><title>${esc(s.name)} — ${(s.val/total*100).toFixed(1)}%</title></path>`;
  }).join("");

  const legend = normalized.slice(0,16).map((s,i)=>{
    const color = `hsl(${(i*48)%360} 70% 60%)`;
    const pct = (s.val/total*100).toFixed(1);
    return `<div style="display:flex;gap:8px;align-items:center"><span style="width:10px;height:10px;border-radius:2px;background:${color}"></span><span>${esc(s.name)}</span><span style="color:#9fb0c8;margin-left:6px">${pct}%</span></div>`;
  }).join("");

  const html = `
    <div style="display:flex;justify-content:center;gap:26px;align-items:center;padding:8px 0 12px;flex-wrap:wrap">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Lead Vendor Breakdown">
        <g>${slices}</g>
        <circle cx="${size/2}" cy="${size/2}" r="88" fill="#0e1116"></circle>
        <text x="50%" y="50%" fill="#cfd7e3" text-anchor="middle" dominant-baseline="middle" style="font-weight:800;font-size:18px">VENDORS</text>
      </svg>
      <div style="min-width:260px;display:grid;grid-template-columns:1fr;gap:6px">${legend}</div>
    </div>
    <div style="text-align:center;color:#8aa0b8;font-size:12px;margin-top:6px">Last ${STATE.vendors.window_days} days as of ${esc(STATE.vendors.as_of||"")}</div>
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
const VIEWS = ["roster","av","aotw","vendors","ytd"];
let viewIdx = 0;
const VIEW_OVERRIDE = (new URLSearchParams(location.search).get("view") || "").toLowerCase();

function updateSummary(){
  const callsEl = $("#sumCalls");
  const avEl    = $("#sumSales");
  const dealsEl = $("#sumTalk");

  if (callsEl) callsEl.textContent = fmtInt(STATE.team.calls);
  if (avEl)    avEl.textContent    = fmtMoney(STATE.team.av);
  if (dealsEl) dealsEl.textContent = fmtInt(STATE.team.deals || 0);

  // relabel once
  try{
    const callsVal = $("#sumCalls");
    const avVal    = $("#sumSales");
    const dealsVal = $("#sumTalk");
    if (callsVal){ const l=callsVal.previousElementSibling; if (l) l.textContent="This Week — Team Calls"; }
    if (avVal){    const l=avVal.previousElementSibling;    if (l) l.textContent="This Week — Total Submitted AV"; }
    if (dealsVal){ const l=dealsVal.previousElementSibling; if (l) l.textContent="This Week — Deals Submitted"; }
  }catch(e){}
}

function renderCurrentView(){
  try{
    updateSummary();
    const v = VIEW_OVERRIDE || VIEWS[viewIdx % VIEWS.length];
    if (v==="roster")       renderRoster();
    else if (v==="av")      renderWeekAV();
    else if (v==="aotw")    renderAOTW();
    else if (v==="vendors") renderVendors();
    else if (v==="ytd")     renderYTD();
    else                    renderRoster();
  }catch(e){
    log("render err", e?.message||e);
    setHead([]); setRows([[`<div style='padding:18px;color:#d66'>Render error</div>`]]);
  }
}

/* ---------- Boot ---------- */
const DATA_MS   = 30_000; // refresh cadence
const ROTATE_MS = 30_000; // view rotation

async function boot(){
  try{
    await loadRosterAndRules();
    await Promise.all([refreshCalls(), refreshSalesAndVendors(), loadYTD()]);
    renderCurrentView();

    // periodic refresh
    setInterval(async ()=>{
      try{
        await Promise.all([refreshCalls(), refreshSalesAndVendors(), loadYTD()]);
        renderCurrentView();
      }catch(e){ log("refresh tick error", e?.message||e); }
    }, DATA_MS);

    // rotation (unless pinned)
    if (!VIEW_OVERRIDE){
      setInterval(()=>{ viewIdx = (viewIdx + 1) % VIEWS.length; renderCurrentView(); }, ROTATE_MS);
    }

    if (DEBUG){
      console.table(STATE.vendors.rows);
      console.log("Vendor buckets used:", VENDOR_BUCKETS);
      console.log("Live at:", location.href);
    }
  }catch(e){
    console.error("Dashboard boot error:", e);
    const tbody=$("#tbody");
    if (tbody) tbody.innerHTML = `<tr><td style="padding:18px;color:#d66">Error loading dashboard: ${esc(e.message||e)}</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", ()=> { try{ boot(); }catch(e){ console.error("boot() error:", e); }});
/* ============================== End ============================== */
