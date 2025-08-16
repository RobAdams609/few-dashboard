// === Config ===
const ROTATION_MS = 45_000;
const DATA_REFRESH_MS = 30_000;
const HEALTH_REFRESH_MS = 60_000;
const TIMEZONE = 'America/New_York';
const DEBUG = new URLSearchParams(location.search).has('debug');
const dbg = (...args) => { if (DEBUG) console.log('[DBG]', ...args); };

const DEFAULT_ROSTER = [
  { name: 'Robert Adams' },
  { name: 'Philip Baxter' },
  { name: 'Ajani' },
  { name: 'Anna' },
  { name: 'Eli' },
  { name: 'Fabricio' },
  { name: 'Fraitzline' },
  { name: 'Joseph' },
  { name: 'Marie Saint Cyr' },
  { name: 'Michelle Landis' },
  { name: 'Alrens' }
];

const STATE = {
  roster: [],
  callsByKey: new Map(),
  salesByKey: new Map(),
  seenSaleHashes: new Set(),
  views: [
    { id: 'roster', label: 'Today — Roster' },
    { id: 'lb-sales', label: 'Today — Leaderboard (Sales)', metric: 'sales' },
    { id: 'lb-av', label: 'Today — Leaderboard (Submitted AV)', metric: 'av' }
  ],
  viewIndex: 0,
  rules: []
};

const $ = s => document.querySelector(s);
function fmtNumber(n){ return (n||0).toLocaleString('en-US'); }
function fmtCurrency(n){ return (n||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}); }
function normalizeKey(s){ return (s||'').toString().toLowerCase().replace(/[^a-z]/g,''); }
function nameToFile(name){ return name.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-') + '.jpg'; }
function ensureHeadshotPath(p){ if(!p) return null; return p.includes('/') ? p : `headshots/${p}`; }

async function fetchJSON(path){ try{ const r=await fetch(path,{cache:'no-store'}); if(!r.ok) throw new Error(r.status); return await r.json(); }catch(e){ dbg('fetchJSON fail', path, e); return null; } }
function nowET(){ try{ return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:TIMEZONE}).format(new Date()); }catch{ return new Date().toLocaleString(); } }
function getDeterministicIndex(len,hours=3){ const slot=Math.floor(Date.now()/(hours*3600_000)); return len?slot%len:0; }

async function loadRoster(){
  const json = await fetchJSON('headshots/roster.json');
  let list = [];
  if (Array.isArray(json)) list = json;
  else if (json && Array.isArray(json.agents)) list = json.agents;
  else list = DEFAULT_ROSTER;

  STATE.roster = list.map(e=>({
    name: e.name || 'Unknown',
    email: e.email || '',
    photo: ensureHeadshotPath(e.photo || nameToFile(e.name||'unknown'))
  }));
  dbg('roster size', STATE.roster.length);
}

function readCallDurationMin(rec){ const dSec = rec.duration_seconds ?? rec.duration ?? rec.talk_time_seconds ?? 0; return (dSec||0)/60; }
function readCallUser(rec){ return rec.user_name || rec.user || rec.agent || rec.owner || rec.email || ''; }
function readSaleUser(rec){ return rec.user_name || rec.seller || rec.agent || rec.owner || rec.email || ''; }
function readSaleMonthlyAmount(rec){ const raw = rec.monthly_premium ?? rec.premium ?? rec.amount_monthly ?? rec.amount ?? rec.pmt ?? rec.monthly ?? 0; const n=Number(raw); return isFinite(n)?n:0; }
function saleHash(r){ const u=normalizeKey(readSaleUser(r)); const a=readSaleMonthlyAmount(r).toFixed(2); const t=r.timestamp||r.ts||r.created_at||r.date||JSON.stringify(r).length; return `${u}|${a}|${t}`; }

async function loadCalls(){
  const payload = await fetchJSON('/api/calls_diag?days=7');
  const rows = (payload?.records || payload?.data || payload || []).filter(Boolean);
  dbg('calls count', rows.length);
  const map = new Map();
  for (const r of rows){
    const key = normalizeKey(readCallUser(r));
    if (!key) continue;
    const obj = map.get(key) || { calls:0, talkMin:0 };
    obj.calls += 1; obj.talkMin += readCallDurationMin(r);
    map.set(key, obj);
  }
  STATE.callsByKey = map;
}

async function loadSales(){
  const payload = await fetchJSON('/api/sales_diag?days=30');
  const rows = (payload?.records || payload?.data || payload || []).filter(Boolean);
  dbg('sales count', rows.length);
  const map = new Map();
  const pops = [];
  for (const r of rows){
    const key = normalizeKey(readSaleUser(r));
    if(!key) continue;
    const monthly = readSaleMonthlyAmount(r);
    const av = monthly * 12;
    const obj = map.get(key) || { sales:0, av:0 };
    obj.sales += 1; obj.av += av; map.set(key, obj);
    const h = saleHash(r); if(!STATE.seenSaleHashes.has(h)){ STATE.seenSaleHashes.add(h); pops.push({key,av}); }
  }
  STATE.salesByKey = map;
  if (pops.length){ const last=pops[pops.length-1]; celebrateSale(lookupNameByKey(last.key) || 'Unknown', last.av); }
}

async function loadRules(){
  const json = await fetchJSON('rules.json');
  STATE.rules = Array.isArray(json) ? json.filter(Boolean).map(String) : [];
  $('#tickerText').textContent = STATE.rules.join('  •  ') || 'Add rules to public/rules.json';
  const idx = getDeterministicIndex(STATE.rules.length, 3);
  const chosen = STATE.rules[idx] || 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.';
  $('#principle').textContent = chosen.replace(/^Bonus\)\s*/, 'Bonus: ');
}

async function pingHealth(){
  let ok=false; try{ const r=await fetch('/api/health',{cache:'no-store'}); ok=r.ok; }catch{}
  const dot=$('#healthDot'), text=$('#healthText');
  if (dot&&text){ dot.style.background = ok ? 'var(--green)' : 'var(--red)'; text.textContent = ok ? 'OK' : 'API issue'; }
}

function lookupNameByKey(key){ const hit=STATE.roster.find(r=>normalizeKey(r.name)===key || normalizeKey(r.email)===key); return hit?.name || null; }
function dataForAgent(a){ const key=normalizeKey(a.email||a.name); const c=STATE.callsByKey.get(key)||{calls:0,talkMin:0}; const s=STATE.salesByKey.get(key)||{sales:0,av:0}; return { name:a.name, photo:a.photo, calls:c.calls|0, talkMin:c.talkMin||0, sales:s.sales|0, av:s.av||0 } }

function buildHead(cols){ const tr=$('#tableHead'); tr.innerHTML=''; cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; tr.appendChild(th); }); }
function makeInitials(name){ const el=document.createElement('div'); el.className='initials'; const parts=(name||'').trim().split(/\s+/); el.textContent=(parts[0]?.[0]||'').toUpperCase()+(parts[1]?.[0]||'').toUpperCase(); return el; }

function renderRoster(){ $('#viewLabel').textContent='Today — Roster'; buildHead(['Agent','Calls','Talk Time (min)','Sales','Submitted AV (12×)']); const tb=$('#tableBody'); tb.innerHTML=''; if(!STATE.roster.length){ $('#emptyState').hidden=false; return;} $('#emptyState').hidden=true; for(const a of STATE.roster){ const d=dataForAgent(a); const tr=document.createElement('tr'); const tdA=document.createElement('td'); tdA.className='agentcell'; const img=document.createElement('img'); img.src=d.photo; img.alt=d.name; img.onerror=()=>{ img.replaceWith(makeInitials(d.name)); }; const nm=document.createElement('span'); nm.textContent=d.name; tdA.appendChild(img); tdA.appendChild(nm); const t1=document.createElement('td'); t1.textContent=fmtNumber(d.calls); const t2=document.createElement('td'); t2.textContent=Math.round(d.talkMin).toString(); const t3=document.createElement('td'); t3.textContent=fmtNumber(d.sales); const t4=document.createElement('td'); t4.textContent=fmtCurrency(Math.round(d.av)); [tdA,t1,t2,t3,t4].forEach(x=>tr.appendChild(x)); tb.appendChild(tr);} }

function renderLeaderboard(metric){ const label=metric==='sales'?'Sales':'Submitted AV (12×)'; $('#viewLabel').textContent=`Today — Leaderboard (${label})`; buildHead(['Agent',label]); const tb=$('#tableBody'); tb.innerHTML=''; if(!STATE.roster.length){ $('#emptyState').hidden=false; return;} $('#emptyState').hidden=true; const rows=STATE.roster.map(a=>dataForAgent(a)); rows.sort((a,b)=> metric==='sales'? b.sales-a.sales : b.av-a.av); rows.forEach((d,i)=>{ const tr=document.createElement('tr'); if(i<3) tr.classList.add('top'); const tdA=document.createElement('td'); tdA.className='agentcell'; const img=document.createElement('img'); img.src=d.photo; img.alt=d.name; img.onerror=()=>{ img.replaceWith(makeInitials(d.name)); }; const nm=document.createElement('span'); nm.textContent=d.name; tdA.appendChild(img); tdA.appendChild(nm); const tdV=document.createElement('td'); tdV.textContent = metric==='sales' ? fmtNumber(d.sales) : fmtCurrency(Math.round(d.av)); tr.appendChild(tdA); tr.appendChild(tdV); tb.appendChild(tr); }); }

function render(){ const v=STATE.views[STATE.viewIndex%STATE.views.length]; if(v.id==='roster') return renderRoster(); if(v.id==='lb-sales') return renderLeaderboard('sales'); if(v.id==='lb-av') return renderLeaderboard('av'); }
function nextView(){ STATE.viewIndex=(STATE.viewIndex+1)%STATE.views.length; render(); }
function celebrateSale(name,av){ const el=document.querySelector('#salePop'); if(!el) return; el.textContent=`SALE: ${name} — ${fmtCurrency(Math.round(av))}`; el.hidden=false; clearTimeout(el._t); el._t=setTimeout(()=>{ el.hidden=true; },5000); }

function loops(){ render(); setInterval(nextView, ROTATION_MS); const refresh=async()=>{ await Promise.all([loadCalls(), loadSales()]); render(); }; refresh(); setInterval(refresh, DATA_REFRESH_MS); pingHealth(); setInterval(pingHealth, HEALTH_REFRESH_MS); setInterval(()=>{ const ts=document.querySelector('#timestamp'); if(ts) ts.textContent=nowET(); },10_000); }

(async function init(){ const ts=document.querySelector('#timestamp'); if(ts) ts.textContent=nowET(); await loadRoster(); await loadRules(); await Promise.all([loadCalls(), loadSales()]); render(); loops(); })();
