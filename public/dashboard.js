/*
 FEW Dashboard — single-file overwrite (front-end only)
 Drop this in place of public/dashboard.js
 It injects its own CSS so you don’t have to touch dashboard.css.

 What it fixes (per your notes):
 - One line motto header only (no duplicate). Rotating “Rule of the Day” under it.
 - Agent aliasing: treats "F N" / "FN" / "Fabricio Navarrete Cervantes" as Fabricio Navarrete, etc.
 - Consistent headshots across boards (slug map + alias map).
 - Agent of the Week shows YTD AV (if ytd_av.json present) + this-week stats.
 - Roster lists real weekly deals/AV and headshots.
 - Vendor board: proper color‑coded chart + sorted vendor list by deals % (last 45 days).
 - Centered gold "NEW SALE" overlay (not a toaster). Auto-dismiss.
 - TYD/YTD boards pulled from overrides when present, hidden gracefully if missing.
 - Removes any visual “×12” multiplier.

 Endpoints used (must exist):
   /api/team_sold         -> weekly sales (with allSales array)
   /api/calls_by_agent    -> weekly calls/logged
   /api/sales_by_vendor   -> last 45d vendor breakdown
 Optional static/override files (if present):
   /overrides/rules.json or /rules.json                -> rotating rules
   /overrides/ytd_av.json or /ytd_av.json              -> YTD per agent
   /overrides/par.json                                 -> PAR manual override
*/

// ------------------------------
// Config
// ------------------------------
const CONFIG = {
  POLL_MS: 15000,
  ROTATE_RULE_MS: 15000,
  MAX_RULE_LINES: 2,
  HEADSHOT_PATH: '/public/headshots/', // adjust if your headshots live elsewhere
  HEADSHOT_EXT: '.jpg',
  PLACEHOLDER: '/public/boards/placeholder.png'
};

// Deterministic brand colors (stable by vendor name)
const BRAND_COLORS = [
  '#6EE7B7', '#93C5FD', '#FDE68A', '#FCA5A5', '#C4B5FD', '#A7F3D0', '#F9A8D4', '#FCD34D', '#BFDBFE', '#FDBA74'
];

// Known agent aliases -> canonical name
const AGENT_ALIASES = {
  'f n': 'Fabricio Navarrete',
  'fn': 'Fabricio Navarrete',
  'fabricio navarrete cervantes': 'Fabricio Navarrete',
  'phillip baxter': 'Philip Baxter',
  'rob adams': 'Robert Adams'
};

// Explicit headshot slugs (filename without extension)
const HEADSHOT_SLUG = {
  'Philip Baxter': 'philip-baxter',
  'Fabricio Navarrete': 'fabricio-navarrete',
  'Robert Adams': 'robert-adams',
  'Nathan Johnson': 'nathan-johnson',
  // add more as needed
};

// ------------------------------
// CSS Injection (single file delivery)
// ------------------------------
(function injectCSS(){
  if (document.getElementById('few-inline-css')) return;
  const css = `
  :root{--few-gold:#f7d98b;--few-gold-2:#ffe8a3;--few-ink:#0e141b;--few-card:#151a21;--few-muted:#8b98a5;}
  .few-wrap{max-width:1280px;margin:0 auto;padding:16px 20px 80px;}
  .few-header{margin:0 0 12px 0;text-align:center;}
  .few-motto{font-size:44px;line-height:1.1;font-weight:800;letter-spacing:1px;color:var(--few-gold);text-shadow:0 0 28px rgba(247,217,139,.25);} 
  .few-rule{margin:12px auto 22px;max-width:980px;background:#0f141a;border:1px solid #233041;border-radius:12px;padding:14px 18px;font-size:22px;color:#cfd8e3;text-align:center}
  .few-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:14px 0 18px}
  .few-kpi{background:var(--few-card);border:1px solid #222b36;border-radius:14px;padding:14px 16px;text-align:center}
  .few-kpi h4{color:#95a2b3;margin:0 0 6px 0;font-weight:600;font-size:13px;letter-spacing:.3px}
  .few-kpi .v{font-size:28px;font-weight:800;color:var(--few-gold)}
  .few-section{background:transparent;border:1px solid #222b36;border-radius:16px;padding:16px;margin:14px 0}
  .few-title{font-weight:800;color:#b8c2cf;margin:4px 0 14px 4px;letter-spacing:.2px}
  .few-table{width:100%;border-collapse:collapse}
  .few-table th,.few-table td{padding:14px;border-top:1px solid #1e2530}
  .few-table th{color:#97a6ba;text-transform:uppercase;font-size:12px;letter-spacing:.5px;text-align:left}
  .few-table td{color:#e5ecf4}
  .few-agent{display:flex;align-items:center;gap:12px}
  .few-avatar{width:40px;height:40px;border-radius:999px;object-fit:cover;border:1px solid #2b3646;background:#0b1016}
  .few-chip{display:inline-block;padding:6px 10px;border-radius:999px;background:#111722;border:1px solid #2a3545;color:#b9c6d8;font-size:12px;margin-right:8px}
  .few-chip.gold{border-color:#6b5626;background:rgba(247,217,139,.08);color:var(--few-gold)}
  .few-center{display:flex;align-items:center;justify-content:center}
  .few-vendor{display:grid;grid-template-columns:300px 1fr;gap:24px}
  canvas#vendorChart{width:300px;height:300px;}

  /* NEW SALE overlay */
  .few-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:9999}
  .few-overlay.on{display:flex}
  .few-pop{background:linear-gradient(180deg,#0b0f14,#0f141a);border:2px solid #6b5626;box-shadow:0 10px 80px rgba(247,217,139,.18), inset 0 0 0 1px rgba(247,217,139,.2);border-radius:22px;padding:26px 32px;text-align:center;min-width:520px}
  .few-pop .tag{display:inline-block;font-weight:800;letter-spacing:.08em;color:#8c7538;border:1px solid #3c2f12;background:rgba(247,217,139,.05);padding:6px 10px;border-radius:999px;margin-bottom:10px}
  .few-pop .name{font-size:34px;font-weight:900;color:#e8d7a7;margin:6px 0}
  .few-pop .amt{font-size:28px;color:#ffe8a3;font-weight:800}

  /* Small layout tweak */
  @media (max-width: 980px){
    .few-motto{font-size:34px}
    .few-kpis{grid-template-columns:1fr}
    .few-vendor{grid-template-columns:1fr}
  }
  `;
  const style = document.createElement('style');
  style.id = 'few-inline-css';
  style.textContent = css;
  document.head.appendChild(style);
})();

// ------------------------------
// Utilities
// ------------------------------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function hashColor(s){
  let h=0; for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i))|0;
  const idx = Math.abs(h)%BRAND_COLORS.length; return BRAND_COLORS[idx];
}

function canonicalName(name){
  if (!name) return '';
  const k = name.trim().toLowerCase();
  return AGENT_ALIASES[k] || name.trim();
}

function headshotFor(name){
  const canonical = canonicalName(name);
  const slug = HEADSHOT_SLUG[canonical] || canonical.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return `${CONFIG.HEADSHOT_PATH}${slug}${CONFIG.HEADSHOT_EXT}`;
}

async function fetchJSON(url){
  const res = await fetch(`${url}${url.includes('?')?'&':'?'}_=${Date.now()}`);
  if (!res.ok) throw new Error(`Fetch failed ${url}`);
  return res.json();
}

async function firstAvailable(urls){
  for (const u of urls){
    try { return await fetchJSON(u); } catch { /* try next */ }
  }
  return null;
}

function formatMoney(n){
  const v = Number(n||0);
  return v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
}

function byNumberDesc(key){
  return (a,b)=> (Number(b[key]||0) - Number(a[key]||0));
}

// ------------------------------
// DOM Skeleton (works with any HTML shell)
// ------------------------------
function ensureSkeleton(){
  const root = document.getElementById('app') || document.body;
  root.innerHTML = `
    <div class="few-wrap">
      <header class="few-header">
        <div class="few-motto">THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT</div>
        <div id="rule" class="few-rule">Loading rule…</div>
      </header>

      <section class="few-kpis">
        <div class="few-kpi"><h4>This Week — Team Calls</h4><div id="kpiCalls" class="v">0</div></div>
        <div class="few-kpi"><h4>This Week — Total Submitted AV</h4><div id="kpiAV" class="v">$0</div></div>
        <div class="few-kpi"><h4>This Week — Deals Submitted</h4><div id="kpiDeals" class="v">0</div></div>
      </section>

      <section id="boardRoster" class="few-section">
        <div class="few-title">This Week — Roster</div>
        <table class="few-table">
          <thead><tr><th>Agent</th><th>Submitted AV</th><th>Deals</th></tr></thead>
          <tbody id="tbodyRoster"><tr><td colspan="3">Loading…</td></tr></tbody>
        </table>
      </section>

      <section id="boardAOTW" class="few-section">
        <div class="few-title">Agent of the Week</div>
        <div id="aotw"></div>
      </section>

      <section id="boardVendor" class="few-section">
        <div class="few-title">Lead Vendors — Last 45 Days</div>
        <div class="few-vendor">
          <div class="few-center"><canvas id="vendorChart" width="300" height="300"></canvas></div>
          <table class="few-table">
            <thead><tr><th>Vendor</th><th>Deals</th><th>% of total</th></tr></thead>
            <tbody id="tbodyVendors"><tr><td colspan="3">Loading…</td></tr></tbody>
          </table>
        </div>
      </section>

      <section id="boardYTD" class="few-section">
        <div class="few-title">YTD — Team</div>
        <table class="few-table">
          <thead><tr><th>Agent</th><th class="right">YTD AV</th></tr></thead>
          <tbody id="tbodyYTD"><tr><td colspan="2">Loading…</td></tr></tbody>
        </table>
      </section>

      <section id="boardPAR" class="few-section">
        <div class="few-title">PAR — On Track</div>
        <div id="parBox" class="few-chip">No PAR list provided.</div>
      </section>
    </div>

    <div id="saleOverlay" class="few-overlay"><div class="few-pop">
      <div class="tag">NEW SALE</div>
      <div id="saleName" class="name">—</div>
      <div id="saleAmt" class="amt">—</div>
    </div></div>
  `;
}

// ------------------------------
// Rendering
// ------------------------------
function setKPIs({calls=0,totalAV=0,deals=0}){
  $('#kpiCalls').textContent = String(calls);
  $('#kpiAV').textContent = formatMoney(totalAV);
  $('#kpiDeals').textContent = String(deals);
}

function renderRoster(perAgent){
  const tbody = $('#tbodyRoster');
  if (!perAgent?.length){ tbody.innerHTML = '<tr><td colspan="3">No activity reported yet.</td></tr>'; return; }
  const rows = perAgent.sort(byNumberDesc('amount')).map(a=>{
    const name = canonicalName(a.name);
    return `<tr>
      <td><div class="few-agent"><img class="few-avatar" src="${headshotFor(name)}" onerror="this.src='${CONFIG.PLACEHOLDER}'" alt="${name}"><span>${name}</span></div></td>
      <td>${formatMoney(a.amount)}</td>
      <td>${a.sales||0}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rows;
}

function renderAOTW(perAgent, ytdMap){
  const box = $('#aotw');
  if (!perAgent?.length){ box.innerHTML = '<div class="few-chip">No leader yet.</div>'; return; }
  const top = [...perAgent].sort(byNumberDesc('amount'))[0];
  const name = canonicalName(top.name);
  const ytd = ytdMap?.[name] || 0;
  box.innerHTML = `
    <div class="few-agent" style="gap:18px">
      <img class="few-avatar" style="width:72px;height:72px" src="${headshotFor(name)}" onerror="this.src='${CONFIG.PLACEHOLDER}'" alt="${name}">
      <div>
        <div style="font-size:22px;font-weight:900;color:#e5ecf4">${name}</div>
        <div style="margin-top:8px">
          <span class="few-chip">${top.sales||0} deal${(top.sales||0)==1?'':'s'} (this week)</span>
          <span class="few-chip gold">${formatMoney(top.amount)} submitted AV (this week)</span>
          <span class="few-chip">${formatMoney(ytd)} YTD AV</span>
        </div>
      </div>
    </div>`;
}

function renderVendors(list){
  const tbody = $('#tbodyVendors');
  if (!list?.length){ tbody.innerHTML='<tr><td colspan="3">No vendor data yet.</td></tr>'; drawDonut([]); return; }
  const total = list.reduce((s,v)=> s + Number(v.deals||0), 0) || 1;
  const sorted = [...list].sort((a,b)=> Number(b.deals||0)-Number(a.deals||0));
  tbody.innerHTML = sorted.map(v=>{
    const pct = (Number(v.deals||0)*100/total);
    return `<tr>
      <td><span class="few-chip" style="border-color:${hashColor(v.vendor)};color:${hashColor(v.vendor)}">&nbsp;</span> ${v.vendor}</td>
      <td>${v.deals||0}</td>
      <td>${pct.toFixed(1)}%</td>
    </tr>`;
  }).join('');
  drawDonut(sorted.map(v=>({label:v.vendor, value:Number(v.deals||0)})));
}

function drawDonut(parts){
  const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('vendorChart'));
  if (!cv) return; const ctx = cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  const cx=cv.width/2, cy=cv.height/2, r = Math.min(cx,cy)-10; const lw = 44;
  const total = parts.reduce((s,p)=>s+p.value,0) || 1;
  let a0 = -Math.PI/2;
  parts.forEach(p=>{
    const frac = p.value/total; const a1 = a0 + frac*2*Math.PI;
    ctx.beginPath(); ctx.arc(cx,cy,r, a0,a1); ctx.strokeStyle = hashColor(p.label); ctx.lineWidth = lw; ctx.stroke();
    a0 = a1;
  });
  // inner hole
  ctx.beginPath(); ctx.arc(cx,cy, r-lw/2-2, 0, 2*Math.PI); ctx.fillStyle = '#0f141a'; ctx.fill();
}

function renderYTD(ytdMap){
  const tbody = $('#tbodyYTD');
  const entries = Object.entries(ytdMap||{});
  if (!entries.length){ $('#boardYTD').style.display='none'; return; }
  const rows = entries
    .map(([name,val])=>({name, val:Number(val||0)}))
    .sort((a,b)=>b.val-a.val)
    .map(x=>`<tr><td><div class="few-agent"><img class="few-avatar" src="${headshotFor(x.name)}" onerror="this.src='${CONFIG.PLACEHOLDER}'"><span>${x.name}</span></div></td><td>${formatMoney(x.val)}</td></tr>`)
    .join('');
  tbody.innerHTML = rows;
}

// ------------------------------
// Rules rotator
// ------------------------------
let RULES = [];
let ruleIdx = 0;
function setRule(text){ $('#rule').innerHTML = text; }
function startRuleRotation(){
  if (!RULES.length){ setRule('Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.'); return; }
  setRule(RULES[0]); ruleIdx = 1;
  setInterval(()=>{ setRule(RULES[ruleIdx++ % RULES.length]); }, CONFIG.ROTATE_RULE_MS);
}

// ------------------------------
// Sales popup (central, gold)
// ------------------------------
let seenSaleIds = new Set();
let overlayTimer = null;
function showSale(name, amount){
  $('#saleName').textContent = canonicalName(name);
  $('#saleAmt').textContent = formatMoney(amount);
  const o = $('#saleOverlay');
  o.classList.add('on');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(()=> o.classList.remove('on'), 6000);
}

// ------------------------------
// Data pump
// ------------------------------
async function loadAll(){
  // Rules
  const rules = await firstAvailable(['/overrides/rules.json','/rules.json']);
  RULES = Array.isArray(rules)? rules.map(x=>String(x)) : (rules?.rules||[]);
  startRuleRotation();

  // YTD map
  const ytd = await firstAvailable(['/overrides/ytd_av.json','/ytd_av.json']);
  const ytdMap = {}; if (ytd){
    if (Array.isArray(ytd)) ytd.forEach(r=> ytdMap[canonicalName(r.name||r.agent)] = Number(r.ytd||r.av||r.amount||0));
    else Object.keys(ytd).forEach(k=> ytdMap[canonicalName(k)] = Number(ytd[k]));
  }

  // PAR manual override (simple text list)
  const par = await firstAvailable(['/overrides/par.json']);
  if (par?.list?.length){ $('#parBox').textContent = par.list.join('  •  '); }

  // Prime load + poll loop
  await refreshOnce(ytdMap);
  setInterval(()=> refreshOnce(ytdMap), CONFIG.POLL_MS);
}

async function refreshOnce(ytdMap){
  const [sold, calls, vendors] = await Promise.allSettled([
    fetchJSON('/api/team_sold'),
    fetchJSON('/api/calls_by_agent'),
    fetchJSON('/api/sales_by_vendor')
  ]);

  // Weekly sales
  if (sold.status==='fulfilled'){
    const s = sold.value || {};
    const team = s.team||{};
    setKPIs({calls: (calls.value?.team?.calls)||0, totalAV: Number(team.totalAV12x||team.totalAV||team.totalAmount||0), deals: team.totalSales||0});

    // Alias and collapse duplicates
    let per = Array.isArray(s.perAgent)? s.perAgent : [];
    const bucket = new Map();
    per.forEach(r=>{
      const name = canonicalName(r.name);
      const cur = bucket.get(name) || {name, sales:0, amount:0};
      cur.sales += Number(r.sales||0);
      cur.amount += Number(r.av12x||r.totalAV||r.amount||0);
      bucket.set(name, cur);
    });
    const perMerged = Array.from(bucket.values());
    renderRoster(perMerged);
    renderAOTW(perMerged, ytdMap);

    // New sale popups (based on allSales array)
    if (Array.isArray(s.allSales)){
      s.allSales.sort((a,b)=> new Date(a.dateSold)-new Date(b.dateSold));
      s.allSales.forEach(x=>{
        if (!seenSaleIds.has(x.leadId)){
          seenSaleIds.add(x.leadId);
          showSale(canonicalName(x.agent), Number(x.av12x||x.amount||0));
        }
      });
      // keep set bounded
      if (seenSaleIds.size>500) seenSaleIds = new Set(Array.from(seenSaleIds).slice(-250));
    }
  }

  // Vendors
  if (vendors.status==='fulfilled'){
    const list = (vendors.value?.vendors) || vendors.value || [];
    const norm = list.map(v=>({vendor: v.vendor||v.name, deals: Number(v.deals||v.count||0)}));
    renderVendors(norm);
  } else {
    renderVendors([]);
  }

  // YTD board (already loaded map)
  // This is static per page load; rendered once in loadAll via refreshOnce first call
}

// ------------------------------
// Boot
// ------------------------------
(async function main(){
  ensureSkeleton();
  try{ await loadAll(); }catch(e){ console.error(e); }
})();
