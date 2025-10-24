/* dashboard.js
   Full replacement implementing:
   - single rule banner (rotates every 12h)
   - 4 boards:
     1) Weekly Submitted AV (roster) -> /api/team_sold
     2) Agent of the Week (big centered photo + numbers)
     3) Lead Vendors % -> public/sales_by_vendor.json (fallback)
     4) Activity Board -> /api/calls_by_agent
   - sale splash on new sale (gold card) holding for 60s
   - polls and updates
   - robust logging for missing fields
*/

/* ======= CONFIG ======= */
const POLL_MS = 30_000; // poll 30s for updates
const RULE_ROTATE_MS = 12 * 60 * 60 * 1000; // 12 hours
const SALE_SPLASH_MS = 60_000; // 60s splash
const API_BASE = ''; // assume same origin; APIs used: /api/team_sold, /api/calls_by_agent
const HEADSHOTS_JSON = '/public/headshots/roster.json';
const SALES_BY_VENDOR_STATIC = '/public/sales_by_vendor.json';

/* ======= UTILS ======= */
function $id(id){ return document.getElementById(id); }
async function fetchJSON(url, opts){ 
  const r = await fetch(url, opts); 
  if(!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}
function money(n){
  if (!isFinite(n)) return '$0';
  return '$' + Number(n).toLocaleString('en-US');
}
function fmtMin(n){ return Number(n || 0).toFixed(0); }
function nowISO(){ return new Date().toISOString(); }

/* ======= RULE BANNER ======= */
let RULES = [ "You are who you hunt with. Everybody wants to eat, but FEW will hunt." ];
async function loadRules(){
  try{
    // if you have a rules.json, load it; otherwise keep default single rule
    const r = await fetchJSON('/public/rules.json').catch(()=>null);
    if (Array.isArray(r?.rules) && r.rules.length) RULES = r.rules;
  }catch(e){ console.warn('rules load err', e); }
}
let currentRuleIndex = 0;
function showRule(){
  const el = $id('rule-banner-single');
  if(!el) return;
  el.textContent = RULES[currentRuleIndex] || RULES[0];
}
function rotateRule(){
  currentRuleIndex = (currentRuleIndex + 1) % RULES.length;
  showRule();
  setTimeout(rotateRule, RULE_ROTATE_MS);
}

/* ======= UI: helpers to create board containers if they don't exist ======= */
function ensureUI(){
  if ($id('few-dashboard-root')) return;

  const root = document.createElement('div');
  root.id = 'few-dashboard-root';
  root.style.cssText = 'color:#dfe6ee;font-family:Inter,system-ui,Arial;';

  root.innerHTML = `
  <div id="top-rule" style="width:100%;background:#0f1012;padding:6px 0;color:#fff;text-align:center;font-weight:700">
    <div id="rule-banner-single" style="font-size:18px;letter-spacing:.6px"></div>
  </div>

  <div style="padding:24px 32px">
    <h1 id="title-hero" style="font-size:56px;margin:6px 0;color:#ffeb8a;text-align:center;text-shadow:0 0 14px #ffd86b">THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT</h1>
    <p style="text-align:center;color:#bfc9d3;margin:0 0 18px">Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.</p>

    <section id="summary-cards" style="display:flex;gap:18px;justify-content:center;margin:18px 0">
      <div class="card" id="card-calls" style="flex:1;max-width:320px;padding:18px;border-radius:12px;background:#0d1113;text-align:center"> <div style="font-size:12px;color:#93a6bd">This Week — Team Calls</div><div id="sumCalls" style="font-size:22px;margin-top:8px">0</div></div>
      <div class="card" id="card-av" style="flex:1;max-width:320px;padding:18px;border-radius:12px;background:#0d1113;text-align:center"> <div style="font-size:12px;color:#93a6bd">This Week — Total Submitted AV</div><div id="sumAV" style="font-size:22px;margin-top:8px">$0</div></div>
      <div class="card" id="card-deals" style="flex:1;max-width:320px;padding:18px;border-radius:12px;background:#0d1113;text-align:center"> <div style="font-size:12px;color:#93a6bd">This Week — Deals Submitted</div><div id="sumDeals" style="font-size:22px;margin-top:8px">0</div></div>
    </section>

    <div id="boards" style="margin-top:8px">
      <div id="board-roster" style="margin-bottom:22px"></div>
      <div id="board-agent-of-week" style="margin-bottom:22px"></div>
      <div id="board-vendors" style="margin-bottom:22px"></div>
      <div id="board-activity" style="margin-bottom:22px"></div>
    </div>

    <div id="splash-holder" style="position:fixed;left:50%;top:28%;transform:translateX(-50%);z-index:9999;pointer-events:none"></div>

  </div>`;

  document.body.prepend(root);
}

/* ======= HEADSHOTS ======= */
let HEADSHOTS = [];
async function loadHeadshots(){
  try{
    const j = await fetchJSON(HEADSHOTS_JSON);
    if (Array.isArray(j)) HEADSHOTS = j;
    else if (Array.isArray(j?.headshots)) HEADSHOTS = j.headshots;
  }catch(e){ console.warn('headshots load', e); }
}
function getHeadshotFor(name){
  if(!name) return null;
  const n = name.toLowerCase().trim();
  const found = HEADSHOTS.find(h=>{
    const candidate = (h.name||'').toLowerCase().trim();
    return candidate === n;
  });
  return found?.photo || null;
}

/* ======= BOARD: Weekly Submitted AV (Roster) ======= */
async function renderRoster(data){
  const container = $id('board-roster');
  container.innerHTML = `<h3 style="color:#ffd77a">This Week — Roster</h3><div id="roster-table" style="background:#0b0c0d;border-radius:8px;padding:8px"></div>`;
  const table = $id('roster-table');

  if(!data){
    table.innerHTML = `<div style="padding:18px;color:#7b8aa3">Loading...</div>`;
    return;
  }

  const team = data.team || {};
  $id('sumDeals').textContent = String(team.totalSales || 0);
  $id('sumAV').textContent = money(team.totalAV12x || team.totalAmount || 0);
  $id('card-calls'); // kept for style
  const perAgent = Array.isArray(data.perAgent) ? data.perAgent : [];

  if(!perAgent.length){
    table.innerHTML = `<div style="padding:18px;color:#7b8aa3">Loading roster or no sales yet.</div>`;
    return;
  }

  // Build rows sorted by AV desc
  const rows = perAgent.slice().sort((a,b)=> (b.av12x||b.av||b.amount||0) - (a.av12x||a.av||a.amount||0));
  const rowsHtml = rows.map(r=>{
    const avatar = getHeadshotFor(r.name) ? `<img src="/public/headshots/${getHeadshotFor(r.name)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;margin-right:12px">` : `<span style="width:38px;height:38px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#25313a;color:#fff;margin-right:12px">${(r.name||'').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</span>`;
    const sold = r.sales || r.sold || 0;
    const av12x = r.av12x || Math.round((r.amount||0) * 12) || 0;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 10px;border-bottom:1px solid rgba(255,255,255,.03)">
      <div style="display:flex;align-items:center">
        ${avatar}
        <div style="min-width:220px">${r.name || 'Unknown'}</div>
      </div>
      <div style="min-width:60px;text-align:center;color:#fff">${sold}</div>
      <div style="min-width:120px;text-align:right;color:#fff">${money(av12x)}</div>
    </div>`;
  }).join('');

  table.innerHTML = `<div style="display:block">${rowsHtml}</div>`;
}

/* ======= BOARD: Agent of the Week (big) ======= */
function renderAgentOfWeek(data){
  const container = $id('board-agent-of-week');
  if(!data || !Array.isArray(data.perAgent) || !data.perAgent.length){
    container.innerHTML = `<h3 style="color:#ffd77a">Agent of the Week</h3><div style="padding:18px;color:#7b8aa3">No leader yet.</div>`;
    return;
  }
  const best = data.perAgent.slice().sort((a,b)=> (b.av12x||b.amount||0) - (a.av12x||a.amount||0))[0];
  const name = best.name || 'Unknown';
  const av12x = best.av12x || Math.round((best.amount||0)*12) || 0;
  const sold = best.sales || 0;
  const photo = getHeadshotFor(name);

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;background:#0b0c0d;border-radius:10px;padding:18px">
      <div style="text-align:center">
        ${photo ? `<img src="/public/headshots/${photo}" style="width:112px;height:112px;border-radius:50%;object-fit:cover;border:4px solid #1b1f21;margin-bottom:12px">` : `<div style="width:112px;height:112px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#25313a;color:#fff;font-size:34px;margin-bottom:12px">${(name||'').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div>`}
        <div style="font-size:20px;font-weight:700;color:#ffd86b">${name}</div>
        <div style="margin-top:6px;color:#bfc9d3">Sold: <strong>${sold}</strong></div>
        <div style="margin-top:6px;color:#fff;font-size:18px">${money(av12x)}</div>
      </div>
    </div>`;
}

/* ======= BOARD: Lead Vendors (pie-like list) ======= */
async function renderVendors(staticFallback){
  const container = $id('board-vendors');
  container.innerHTML = `<h3 style="color:#ffd77a">Lead Vendors — % of Sales (Last 45 days)</h3><div id="vendor-table" style="background:#0b0c0d;border-radius:8px;padding:8px"></div>`;
  const table = $id('vendor-table');
  let data = null;
  try{
    data = await fetchJSON('/api/sales_by_vendor').catch(()=>null);
  }catch(e){ data = null; }
  // fallback to static file
  if(!data) {
    try{ data = await fetchJSON(SALES_BY_VENDOR_STATIC); }catch(e){ data = staticFallback || null; }
  }
  if(!data || !Array.isArray(data.vendors)){
    table.innerHTML = `<div style="padding:18px;color:#7b8aa3">No vendor chart available.</div>`;
    return;
  }
  const list = data.vendors.slice().sort((a,b)=> (b.deals||0)-(a.deals||0));
  const total = list.reduce((s,v)=> s + (v.deals||0), 0) || 0;
  const rows = list.map(v => {
    const pct = total ? Math.round( (v.deals||0) / total * 100 ) : 0;
    return `<div style="display:flex;justify-content:space-between;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.03)">
      <div>${v.name}</div>
      <div style="color:#fff">${v.deals || 0} <span style="color:#7b8aa3">(${pct}%)</span></div>
    </div>`;
  }).join('');
  table.innerHTML = rows;
}

/* ======= BOARD: Activity Board (calls_by_agent) ======= */
function renderActivity(data){
  const container = $id('board-activity');
  container.innerHTML = `<h3 style="color:#ffd77a">Agent Activity — (This week)</h3><div id="activity-table" style="background:#0b0c0d;border-radius:8px;padding:8px"></div>`;
  const table = $id('activity-table');

  if(!data || (!Array.isArray(data.perAgent) && !data.perAgent)){
    table.innerHTML = `<div style="padding:18px;color:#7b8aa3">No activity reported yet.</div>`;
    return;
  }

  const team = data.team || {};
  $id('sumCalls').textContent = String(team.calls || 0);

  const list = Array.isArray(data.perAgent) ? data.perAgent : [];

  if(!list.length) {
    table.innerHTML = `<div style="padding:18px;color:#7b8aa3">No activity reported yet.</div>`;
    return;
  }

  const rows = list.map(a=>{
    const calls = a.calls || 0;
    const talkMin = a.talkMin || 0;
    const loggedMin = a.loggedMin || 0;
    const leads = a.leads || 0;
    const sold = a.sold || 0;
    const conv = leads ? Math.round((sold / leads) * 100) : 0;
    const avatar = getHeadshotFor(a.name) ? `<img src="/public/headshots/${getHeadshotFor(a.name)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;margin-right:8px">` : `<div style="width:32px;height:32px;border-radius:50%;background:#25313a;display:inline-flex;align-items:center;justify-content:center;color:#fff;margin-right:8px">${(a.name||'').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</div>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.03)">
      <div style="display:flex;align-items:center;min-width:220px">${avatar}<div>${a.name || 'Unknown'}</div></div>
      <div style="min-width:60px;text-align:center">${calls}</div>
      <div style="min-width:80px;text-align:center">${fmtMin(talkMin)}</div>
      <div style="min-width:80px;text-align:center">${Math.round(loggedMin)}h</div>
      <div style="min-width:60px;text-align:center">${leads}</div>
      <div style="min-width:60px;text-align:center">${sold}</div>
      <div style="min-width:60px;text-align:right">${conv}%</div>
    </div>`;
  }).join('');

  table.innerHTML = rows;
}

/* ======= SALE SPLASH (big gold card) ======= */
let lastAllSalesHash = '';
function makeSalesHash(salesArray){
  try{ return JSON.stringify((salesArray||[]).slice(-10)); }catch(e){ return '';}
}
function showSaleSplash(agentName, av){
  const holder = $id('splash-holder');
  if(!holder) return;
  const splash = document.createElement('div');
  splash.style.cssText = `background:linear-gradient(180deg,#2d220b,#332914);border:4px solid #f3c96c;padding:14px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.6);text-align:center;color:#ffd86b;pointer-events:none;min-width:240px`;
  splash.innerHTML = `<div style="font-size:14px;color:#ffeab1">New Sale</div><div style="font-size:22px;font-weight:800">${agentName}</div><div style="font-size:18px;margin-top:6px">${money(av)} AV</div>`;
  holder.appendChild(splash);
  setTimeout(()=>{ splash.remove(); }, SALE_SPLASH_MS);
}

/* ======= POLL & BOOT ======= */
async function pollOnce(){
  try{
    const [teamSold, calls, vendorsStatic] = await Promise.all([
      fetchJSON('/api/team_sold?v=' + Date.now()).catch(()=>null),
      fetchJSON('/api/calls_by_agent?v=' + Date.now()).catch(()=>null),
      (async()=>{ try{return await fetchJSON(SALES_BY_VENDOR_STATIC);}catch(e){return null;} })()
    ]);

    // roster & AV
    if(teamSold) {
      renderRoster(teamSold);
      renderAgentOfWeek(teamSold);
      // detect new sale for splash:
      const hash = makeSalesHash(teamSold.allSales || teamSold.allsales || []);
      if(lastAllSalesHash && hash !== lastAllSalesHash){
        // find newest sale
        const arr = (teamSold.allSales || teamSold.allsales || []).slice().sort((a,b)=> new Date(b.dateSold||b.date||0) - new Date(a.dateSold||a.date||0));
        if(arr.length){
          const newest = arr[0];
          showSaleSplash(newest.agent || 'Unknown', newest.amount || newest.av || 0);
        }
      }
      lastAllSalesHash = hash;
    } else {
      // if missing, clear
      renderRoster(null);
      renderAgentOfWeek(null);
    }

    // vendors
    await renderVendors(vendorsStatic);

    // calls/activity
    if(calls) renderActivity(calls);
    else renderActivity(null);

  }catch(e){
    console.error('pollOnce error', e);
  }
}

async function boot(){
  ensureUI();
  await loadRules();
  await loadHeadshots();
  showRule();
  setTimeout(rotateRule, RULE_ROTATE_MS);
  // initial render placeholders:
  renderRoster(null);
  renderAgentOfWeek(null);
  renderVendors(null).catch(()=>{});
  renderActivity(null);

  // initial poll:
  await pollOnce();
  // poll loop:
  setInterval(pollOnce, POLL_MS);
}

document.addEventListener('DOMContentLoaded', boot);
