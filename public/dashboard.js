/* public/dashboard.js — FULL REPLACEMENT
   Rotates 4 boards, rule banner, sale splash, vendor donut, headshots, activity.
*/

/* ========================== UTIL / CONFIG ========================== */
const $ = sel => document.querySelector(sel);
const fmtInt  = n => (n||0).toLocaleString('en-US');
const fmtUSD  = n => `$${Math.round(n||0).toLocaleString('en-US')}`;
const pad2 = n => String(n).padStart(2,'0');

const ROTATE_MS = 15000;          // board rotation
const SALE_HOLD_MS = 60000;       // sale splash duration
const RULE_ROTATE_HOURS = 12;     // rule rotation

// Netlify functions: try /api/* first, then /.netlify/functions/*
const FN = {
  team:   ['api/team_sold','/.netlify/functions/team_sold'],
  calls:  ['api/calls_by_agent','/.netlify/functions/calls_by_agent'],
  vendor: ['api/sales_by_vendor','/.netlify/functions/sales_by_vendor']
};
// Static overrides
const OVERRIDES = {
  rules:        '/public/rules.json',
  ytdList:      '/public/ytd_av.json',
  ytdTotal:     '/public/ytd_total.json',
  par:          '/public/par_override.json',
  vendorStatic: '/public/sales_by_vendor.json'
};

// headshot URL candidates per slug (in order)
function headshotURLs(slug){
  return [
    `/public/headshots/${slug}.webp`,
    `/public/headshots/${slug}.jpg`,
    `/public/headshots/${slug}.png`,
  ];
}

function toSlug(name=''){
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/(^-|-$)/g,'');
}

async function getJSON(tryList){
  const urls = Array.isArray(tryList) ? tryList : [tryList];
  const ts = `ts=${Date.now()}`;
  let lastErr;
  for (const raw of urls){
    const u = raw.includes('?') ? `${raw}&${ts}` : `${raw}?${ts}`;
    try{
      const r = await fetch(u, {cache:'no-store'});
      if (!r.ok) { lastErr = new Error(`${u} ${r.status}`); continue; }
      return await r.json();
    }catch(e){ lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}

/* ========================== STATE ========================== */
let dataTeam = {team:{}, perAgent:[], allSales:[]};
let dataCalls = {team:{}, perAgent:[]};
let dataVendors = {vendors:[]};
let rules = [];
let ytd = null;     // { list, total }
let parList = null; // array of names & numbers (override)
let viewIdx = 0;
let lastSaleIds = new Set();      // detect new sales
let rotateTimer = null;

/* ========================== RULES / BANNER ========================== */
async function loadRules(){
  try { rules = await getJSON(OVERRIDES.rules) || []; }
  catch { rules = []; }
  if (!Array.isArray(rules) || rules.length === 0){
    rules = [{title:'Win the morning to win the day.'}];
  }
  applyRule();
  setInterval(applyRule, RULE_ROTATE_HOURS*3600*1000);
}
function applyRule(){
  const i = Math.floor(Date.now() / (RULE_ROTATE_HOURS*3600*1000)) % rules.length;
  const txt = (rules[i]?.title || '').trim() || 'Win the morning to win the day.';
  $('#ticker').textContent = `RULE OF THE DAY — ${txt}`;
}

/* ========================== FETCH & REFRESH ========================== */
async function loadAll(){
  // team & calls
  [dataTeam, dataCalls] = await Promise.all([
    getJSON(FN.team).catch(_=>({team:{}, perAgent:[], allSales:[]})),
    getJSON(FN.calls).catch(_=>({team:{}, perAgent:[]})),
  ]);

  // vendors (API, then static)
  try{
    dataVendors = await getJSON(FN.vendor);
    if (!dataVendors?.vendors?.length){
      dataVendors = await getJSON(OVERRIDES.vendorStatic).catch(_=>({vendors:[]}));
    }
  }catch{ dataVendors = {vendors:[]}; }

  // YTD & PAR (optional)
  try{
    const list  = await getJSON(OVERRIDES.ytdList);
    const total = await getJSON(OVERRIDES.ytdTotal);
    if (list && total) ytd = {list, total};
  }catch{ ytd = null; }

  try { parList = await getJSON(OVERRIDES.par); } catch { parList = null; }

  setSummary();
  // First render & start rotation
  renderCurrentView();
  if (rotateTimer) clearInterval(rotateTimer);
  rotateTimer = setInterval(nextView, ROTATE_MS);

  // refresh live cards and sales polling
  setInterval(refreshTick, 30000);
}

async function refreshTick(){
  try{
    const freshTeam = await getJSON(FN.team).catch(_=>dataTeam);
    if (freshTeam?.team) dataTeam = freshTeam;
    const freshCalls = await getJSON(FN.calls).catch(_=>dataCalls);
    if (freshCalls?.team) dataCalls = freshCalls;
    setSummary();
    detectNewSales();
  }catch{}
}

/* ========================== SUMMARY CARDS ========================== */
function setSummary(){
  const calls = dataCalls?.team?.calls ?? 0;
  const deals = dataTeam?.team?.totalSales ?? 0;
  const av = (dataTeam?.team?.totalAV12x ?? dataTeam?.team?.totalAmount ?? 0);
  $('#sumCalls')?.textContent = fmtInt(calls);
  $('#sumSales')?.textContent = fmtUSD(av);
  $('#sumTalk')?.textContent  = fmtInt(deals);
}

/* ========================== VIEWS ========================== */
// 0: Roster (Weekly Submitted AV)
function viewRoster(){
  setTitle('This Week — Roster');
  make3Cards();
  writeRosterTable();
}
// 1: Agent of the Week (big headshot, YTD/PAR inline if available)
function viewAOTW(){
  setTitle('Agent of the Week');
  make3Cards();
  writeLeaderTable();
}
// 2: Vendors last 45 days (donut + table)
function viewVendors(){
  setTitle('Lead Vendors — % of Sales (Last 45 days)');
  make3Cards();
  writeVendorDonut();
}
// 3: Agent Activity
function viewActivity(){
  setTitle('Agent Activity — (This week)');
  make3Cards();
  writeActivityTable();
}

const VIEWS = [viewRoster, viewAOTW, viewVendors, viewActivity];

function renderCurrentView(){
  const fn = VIEWS[viewIdx] || VIEWS[0];
  fn();
}
function nextView(){
  viewIdx = (viewIdx + 1) % VIEWS.length;
  renderCurrentView();
}

/* ---------- Shared helpers for views ---------- */
function setTitle(t){
  $('#viewLabel').textContent = t;
  // header text already exists in HTML
}
function make3Cards(){
  $('#summary').innerHTML = `
    <div class="card"><div class="k">This Week — Team Calls</div><div id="sumCalls" class="v">0</div></div>
    <div class="card"><div class="k">This Week — Total Submitted AV</div><div id="sumSales" class="v">$0</div></div>
    <div class="card"><div class="k">This Week — Deals Submitted</div><div id="sumTalk" class="v">0</div></div>
  `;
  setSummary();
  $('#thead').innerHTML = '';
  $('#tbody').innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Loading…</td></tr>`;
}

/* ---------- Roster ---------- */
function writeRosterTable(){
  const rows = Array.isArray(dataTeam?.perAgent) ? dataTeam.perAgent.slice() : [];
  // normalize fields
  rows.forEach(r=>{
    r.sold = r.sales ?? r.sold ?? 0;
    r.av  = r.av12x ?? r.amount ?? 0;
  });
  rows.sort((a,b)=>(b.av||0)-(a.av||0));

  $('#thead').innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV</th>
    </tr>
  `;
  $('#tbody').innerHTML = rows.map(r => `
    <tr>
      ${tdAgent(r.name)}
      <td class="num">${fmtInt(r.sold)}</td>
      <td class="num">${fmtUSD(r.av)}</td>
    </tr>
  `).join('') || `<tr><td style="padding:14px;color:#5c6c82;">No roster data yet.</td></tr>`;
}

/* ---------- Agent of the Week ---------- */
function writeLeaderTable(){
  const rows = Array.isArray(dataTeam?.perAgent) ? dataTeam.perAgent.slice() : [];
  rows.forEach(r=>{ r.sold = r.sales ?? r.sold ?? 0; r.av = r.av12x ?? r.amount ?? 0; });
  rows.sort((a,b)=>(b.av||0)-(a.av||0));
  const leader = rows[0];

  $('#thead').innerHTML = `
    <tr>
      <th>Leading for Agent of the Week</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV</th>
    </tr>
  `;
  if (!leader){
    $('#tbody').innerHTML = `<tr><td style="padding:14px;color:#5c6c82;">No leader yet.</td></tr>`;
    return;
  }

  const extra = [];
  // YTD inline (if available)
  if (ytd?.list?.length){
    const match = ytd.list.find(x => (x?.name||'').toLowerCase() === (leader.name||'').toLowerCase());
    if (match) extra.push(`<div style="margin-top:6px;color:#9fb0c8;font-size:12px;">YTD Issued AV: <b>${fmtUSD(match?.amount||0)}</b></div>`);
  }
  // PAR inline (if available)
  if (Array.isArray(parList)){
    const p = parList.find(x => (x?.name||'').toLowerCase() === (leader.name||'').toLowerCase());
    if (p) extra.push(`<div style="margin-top:2px;color:#9fb0c8;font-size:12px;">PAR: <b>${fmtUSD(p?.amount||0)}</b></div>`);
  }

  $('#tbody').innerHTML = `
    <tr>
      ${tdAgent(leader.name, true, extra.join(''))}
      <td class="num">${fmtInt(leader.sold)}</td>
      <td class="num">${fmtUSD(leader.av)}</td>
    </tr>
  `;
}

/* ---------- Vendors (donut + table) ---------- */
function writeVendorDonut(){
  // table
  const list = Array.isArray(dataVendors?.vendors) ? dataVendors.vendors.slice() : [];
  const total = list.reduce((s,v)=>s + (v.deals||v.count||0), 0);
  list.forEach(v=>{ v.deals = v.deals ?? v.count ?? 0; v.pct = total? Math.round(v.deals*100/total):0; });
  list.sort((a,b)=>(b.deals||0)-(a.deals||0));

  $('#thead').innerHTML = `
    <tr>
      <th>Vendor</th>
      <th style="text-align:right">Deals</th>
      <th style="text-align:right">% of total</th>
    </tr>
  `;
  $('#tbody').innerHTML = list.map(v => `
    <tr>
      <td>${escapeHtml(v.name||'Unknown')}</td>
      <td class="num">${fmtInt(v.deals)}</td>
      <td class="num">${v.pct}%</td>
    </tr>
  `).join('') || `<tr><td style="padding:14px;color:#5c6c82;">No vendor chart available.</td></tr>`;

  // donut (SVG) injected above table body row 1
  if (list.length){
    const svg = donutSVG(list.map(v=>v.pct));
    const host = document.createElement('tr');
    host.innerHTML = `<td colspan="3" style="padding:8px 10px 2px;">${svg}</td>`;
    $('#tbody').prepend(host);
  }
}
// simple donut (no external libs)
function donutSVG(pcts){
  const R=54, C=64, SW=18, cx=C, cy=C, per=2*Math.PI*R;
  let off=0;
  const arcs = pcts.map((p,i)=>{
    const len = per * (p/100);
    const dash = `${len} ${per-len}`;
    const s = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none"
      stroke="hsl(${(i*47)%360} 70% 60%)" stroke-width="${SW}"
      stroke-dasharray="${dash}" stroke-dashoffset="${-off}" />`;
    off += len;
    return s;
  }).join('');
  return `<svg width="140" height="140" viewBox="0 0 128 128" style="display:block;margin:8px auto 2px;">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#222e3f" stroke-width="${SW}"/>
    ${arcs}
  </svg>`;
}

/* ---------- Agent Activity ---------- */
function writeActivityTable(){
  // join calls + sold by name
  const map = new Map();
  (dataCalls?.perAgent||[]).forEach(a=>{
    const k = (a.name||'').toLowerCase();
    map.set(k, {
      name:a.name,
      calls:a.calls||0,
      talkMin: Math.round(a.talkMin||a.talkmin||0),
      loggedMin: Math.round(a.loggedMin||a.loggedmin||0),
      leads: a.leads||0,
      sold: 0
    });
  });
  (dataTeam?.perAgent||[]).forEach(s=>{
    const k = (s.name||'').toLowerCase();
    const rec = map.get(k) || {name:s.name, calls:0,talkMin:0,loggedMin:0,leads:0,sold:0};
    rec.sold = s.sales ?? s.sold ?? rec.sold;
    map.set(k, rec);
  });
  const rows = [...map.values()];
  rows.forEach(r=>{
    r.conv = r.leads ? Math.round((r.sold*100)/r.leads) : 0;
  });
  rows.sort((a,b)=>(b.calls||0)-(a.calls||0));

  $('#thead').innerHTML = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Calls</th>
      <th style="text-align:right">Talk (min)</th>
      <th style="text-align:right">Logged (h:mm)</th>
      <th style="text-align:right">Leads</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Conv %</th>
    </tr>
  `;
  $('#tbody').innerHTML = rows.length ? rows.map(r=>{
    const h = `${Math.floor((r.loggedMin||0)/60)}:${pad2(Math.round((r.loggedMin||0)%60))}`;
    return `<tr>
      ${tdAgent(r.name)}
      <td class="num">${fmtInt(r.calls)}</td>
      <td class="num">${fmtInt(r.talkMin)}</td>
      <td class="num">${h}</td>
      <td class="num">${fmtInt(r.leads)}</td>
      <td class="num">${fmtInt(r.sold)}</td>
      <td class="num">${fmtInt(r.conv)}%</td>
    </tr>`;
  }).join('') : `<tr><td style="padding:14px;color:#5c6c82;">No activity reported yet.</td></tr>`;
}

/* ========================== HEADSHOTS ========================== */
function tdAgent(name='', big=false, underHTML=''){
  const slug = toSlug(name||'');
  const initials = (name||'')
    .split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]?.toUpperCase()).join('') || 'A';
  const size = big? 44: 28;
  const pads = big? 'margin:2px 12px 2px 0;' : 'margin-right:10px;';
  const tryImgs = headshotURLs(slug).map(src => `url('${src}')`).join(',');
  return `
    <td>
      <div class="agent">
        <span class="avatar" style="
          width:${size}px;height:${size}px;${pads}
          background-image:${tryImgs};
          background-size:cover;background-position:center;
          display:inline-flex;align-items:center;justify-content:center;
          border-radius:50%; color:#89a2c6; font-weight:800; font-size:${big?16:12}px;
          background-color:#1f2a3a;
        ">${initials}</span>
        <div style="font-weight:700;${big?'font-size:20px;':''}">${escapeHtml(name||'Unknown')}${underHTML? `<div>${underHTML}</div>`:''}</div>
      </div>
    </td>
  `;
}

/* ========================== SALE SPLASH ========================== */
function detectNewSales(){
  const list = dataTeam?.allSales || [];
  if (!Array.isArray(list) || list.length===0) return;
  // newest first assumed — show any unseen
  for (const s of list){
    const id = s.leadId || s.id || `${s.agent||''}-${s.dateSold||s.date||''}-${s.amount||0}`;
    if (!lastSaleIds.has(id)){
      lastSaleIds.add(id);
      showSaleSplash(s.agent || s.name || 'New Sale', s.av12x ?? s.amount ?? 0);
      break;
    }
  }
}
function showSaleSplash(agent, amount){
  let el = $('#salePop'); // using index.html element name
  if (!el){
    el = document.createElement('div');
    el.id = 'salePop';
    el.className = 'sale-pop';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div style="font-size:12px;opacity:.9;">NEW SALE</div>
    <div style="font-size:20px;font-weight:800;margin-top:2px;">${escapeHtml(agent||'')}</div>
    <div style="font-size:14px;margin-top:2px;">${fmtUSD(amount)}</div>
  `;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), SALE_HOLD_MS);
}

/* ========================== HTML ESCAPE ========================== */
function escapeHtml(s=''){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ========================== INIT ========================== */
(function init(){
  // Ensure the 3 summary cards exist on load
  make3Cards();
  loadRules();
  loadAll().then(detectNewSales).catch(()=>{});
})();
