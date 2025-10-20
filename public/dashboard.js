/* =========================
   FEW Dashboard — Full Rewrite
   (Replace your public/dashboard.js with this file)
   ========================= */

// ---------- CONSTANTS (PERMANENT, NO RELATIVE PATHS) ----------
const BASE = 'https://few-dashboard-live.netlify.app';
const ENDPOINTS = {
  teamSold: `${BASE}/.netlify/functions/team_sold`,
  callsByAgent: `${BASE}/.netlify/functions/calls_by_agent`,
};

const ASSETS = {
  headshotsJSON: `${BASE}/headshots/roster.json`,
  headshot: (file) => `${BASE}/headshots/${file}`,
};

// Single rule rotation (permanent: ONE banner slot)
const RULES = [
  '10) Restore the dignity of hard work.',
];

// Vendors canon list (your “sold products” set)
const VENDORS_CANON = [
  'George Region Shared','Red Media','Blast/Bulk','Exclusive JUMBO','ABC','Shared Jumbo',
  'VS Default','RKA Website','Redrip/Give up Purchased','Lamy Dynasty Specials','JUMBO Splits',
  'Exclusive 30s','Positive Intent/Argos','HotLine Bling','Referral','CG Exclusive','$7.50'
];

// Optional overrides (if present in /public/overrides/)
const OVERRIDES = {
  vendors45d: `${BASE}/overrides/vendors_45d.json`,          // { "Red Media": 12345, "Referral": 2345, ... }
  avWeek:     `${BASE}/overrides/av_week_override.json`,      // { "submittedAV": 36372 }
  callsWeek:  `${BASE}/overrides/calls_week_override.json`,   // { "calls": 0 }
};

// ---------- UTIL ----------
const qs  = (sel,root=document)=>root.querySelector(sel);
const qsa = (sel,root=document)=>[...root.querySelectorAll(sel)];

async function fetchJSON(url, { timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function tryFetch(url) {
  try { return await fetchJSON(url); } catch { return null; }
}

function money(n) {
  if (n == null || isNaN(n)) return '$0';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function initials(name='') {
  const parts = name.trim().split(/\s+/).slice(0,2);
  return parts.map(p=>p[0]?.toUpperCase()||'').join('');
}

function byString(o, p, def=null) {
  return p.split('.').reduce((a,k)=> (a && a[k] != null ? a[k] : null), o) ?? def;
}

// ---------- HEADSHOTS ----------
let HEADSHOT_MAP = new Map(); // name (lowercase) -> url

async function loadHeadshots() {
  const roster = await fetchJSON(ASSETS.headshotsJSON).catch(()=>[]);
  HEADSHOT_MAP.clear();
  for (const r of roster) {
    const name = (r.name || '').trim().toLowerCase();
    const file = r.photo ? String(r.photo).trim() : null;
    if (name && file) HEADSHOT_MAP.set(name, ASSETS.headshot(file));
  }
}

function headshotFor(name) {
  const key = (name || '').trim().toLowerCase();
  return HEADSHOT_MAP.get(key) || null;
}

// ---------- RULE BANNER (single slot) ----------
function mountRuleBanner() {
  const el = qs('#rule-of-the-day');
  if (!el) return;
  let i = 0;
  const apply = () => { el.textContent = `RULE OF THE DAY — ${RULES[i]}`; };
  apply();
  // rotate every 3 hours (10800000 ms). Safe no-op if page refreshes
  setInterval(() => { i = (i+1) % RULES.length; apply(); }, 10800000);
}

// ---------- TOP KPIs ----------
function setTopKPIs({ calls=0, submittedAV=0, deals=0 }={}) {
  const callsEl = qs('#kpi-team-calls');
  const avEl    = qs('#kpi-submitted-av');
  const dealsEl = qs('#kpi-deals');

  if (callsEl) callsEl.textContent = Number(calls || 0).toLocaleString();
  if (avEl)    avEl.textContent    = money(submittedAV || 0);
  if (dealsEl) dealsEl.textContent = Number(deals || 0).toLocaleString();
}

// ---------- DATA GATHER ----------
async function getWeekData() {
  // functions
  const [teamSold, calls, avOverride, callsOverride] = await Promise.all([
    tryFetch(ENDPOINTS.teamSold),
    tryFetch(ENDPOINTS.callsByAgent),
    tryFetch(OVERRIDES.avWeek),
    tryFetch(OVERRIDES.callsWeek),
  ]);

  // submitted AV: prefer override, else teamSold.team.totaAV12X | teamSold.team.avi12x | teamSold.team.av12x
  const avFromApi = byString(teamSold, 'team.totaAV12X') ??
                    byString(teamSold, 'team.avi12x') ??
                    byString(teamSold, 'team.av12x') ??
                    0;
  const submittedAV = byString(avOverride, 'submittedAV') ?? avFromApi ?? 0;

  const callsSum = byString(callsOverride, 'calls') ?? byString(calls, 'team.calls') ?? 0;
  const deals = byString(teamSold, 'team.totalSales') ?? 0;

  // per-agent compiled
  const perAgentSold = new Map(); // name -> { sales, amount, av12x }
  (byString(teamSold, 'perAgent') || []).forEach(p => {
    const name = p.name || '';
    perAgentSold.set(name, {
      sales: Number(p.sales || 0),
      amount: Number(p.amount || 0),
      av12x: Number(p.av12x || p.avi12x || 0),
    });
  });

  const perAgentCalls = new Map(); // name -> { calls, talkMin, loggedMin, leads, sold }
  (byString(calls, 'perAgent') || []).forEach(p => {
    const name = p.name || '';
    perAgentCalls.set(name, {
      calls: Number(p.calls || 0),
      talkMin: Number(p.talkMin || 0),
      loggedMin: Number(p.loggedMin || 0),
      leads: Number(p.leads || 0),
      sold: Number(p.sold || 0),
    });
  });

  // join
  const agents = new Map();
  for (const name of new Set([...perAgentSold.keys(), ...perAgentCalls.keys()])) {
    agents.set(name, {
      name,
      ...(perAgentCalls.get(name) || { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 }),
      ...(perAgentSold.get(name)  || { sales:0, amount:0, av12x:0 }),
    });
  }

  return {
    kpis: { calls: callsSum, submittedAV, deals },
    agents: [...agents.values()],
    allSales: byString(teamSold, 'allSales') || [],
  };
}

// ---------- RENDER: AGENT TABLE ----------
function renderAgents(agents) {
  const tbody = qs('#agents-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!agents || !agents.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'muted';
    td.textContent = 'No data yet';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const a of agents) {
    const tr = document.createElement('tr');

    // Agent cell with headshot or initials
    const tdAgent = document.createElement('td');
    tdAgent.className = 'agent-cell';
    const imgUrl = headshotFor(a.name);
    if (imgUrl) {
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = a.name;
      img.className = 'avatar';
      // fallback to initials if image fails
      img.onerror = () => {
        img.replaceWith(makeInitialsBadge(a.name));
      };
      tdAgent.appendChild(img);
    } else {
      tdAgent.appendChild(makeInitialsBadge(a.name));
    }
    const span = document.createElement('span');
    span.textContent = ' ' + (a.name || '—');
    tdAgent.appendChild(span);

    const tdCalls   = cellNum(a.calls);
    const tdTalk    = cellNum(a.talkMin);
    const tdLogged  = cellTime(a.loggedMin);
    const tdLeads   = cellNum(a.leads);
    const tdSold    = cellNum(a.sales ?? a.sold);
    const tdAV      = cellMoney(a.av12x);

    tr.append(tdAgent, tdCalls, tdTalk, tdLogged, tdLeads, tdSold, tdAV);
    tbody.appendChild(tr);
  }

  function makeInitialsBadge(name) {
    const d = document.createElement('div');
    d.className = 'avatar initials';
    d.textContent = initials(name);
    return d;
  }
  function cellNum(n)  { const td=document.createElement('td'); td.textContent = Number(n||0).toLocaleString(); return td; }
  function cellTime(m) { const td=document.createElement('td'); const v=Number(m||0); const h=Math.floor(v/60); const mm=v%60; td.textContent = `${h}:${String(mm).padStart(2,'0')}`; return td; }
  function cellMoney(n){ const td=document.createElement('td'); td.textContent = money(n||0); return td; }
}

// ---------- VENDOR CHART (45 days) ----------
async function buildVendors45d(allSales) {
  // Try overrides/vendors_45d.json first
  const override = await tryFetch(OVERRIDES.vendors45d);
  if (override && typeof override === 'object') {
    return normalizeVendors(override);
  }

  // If API in week payload includes allSales across only this week, we’ll still show this week.
  // If you later expose a 45d function, plug it here (first-try).
  // Example (uncomment when you deploy it):
  // const fromFn = await tryFetch(`${BASE}/.netlify/functions/vendors_45d`);
  // if (fromFn && typeof fromFn === 'object') return normalizeVendors(fromFn);

  // Fallback: aggregate from provided allSales list
  const agg = {};
  (allSales || []).forEach(s => {
    const name = (s.soldProductName || 'Other').trim();
    const amount = Number(s.amount || 0);
    agg[name] = (agg[name] || 0) + amount;
  });
  return normalizeVendors(agg);

  function normalizeVendors(obj) {
    // Map to canon list, everything else collapses to "Other"
    const out = {};
    let other = 0;
    for (const [k,v] of Object.entries(obj)) {
      if (VENDORS_CANON.includes(k)) out[k] = (out[k] || 0) + Number(v||0);
      else other += Number(v||0);
    }
    if (other > 0) out['Other'] = other;

    // sort by value desc
    const entries = Object.entries(out).sort((a,b)=>b[1]-a[1]);
    return entries;
  }
}

function renderVendorChart(pairs) {
  const container = qs('#vendors-chart');
  const legend = qs('#vendors-legend');

  if (!container || !legend) return;
  container.innerHTML = '';
  legend.innerHTML = '';

  if (!pairs || !pairs.length) {
    container.textContent = 'No vendor data yet';
    return;
  }

  // Simple donut using conic-gradient
  const total = pairs.reduce((s,[,v])=>s+v,0) || 1;
  let acc = 0;
  const segments = pairs.map(([label,val])=>{
    const start = acc/total*360;
    acc += val;
    const end = acc/total*360;
    return { label, start, end };
  });

  const colors = pairs.map((_,i)=>`hsl(${(i*47)%360} 75% 55%)`);
  const gradient = segments.map((s,i)=>`${colors[i]} ${s.start}deg ${s.end}deg`).join(', ');

  const donut = document.createElement('div');
  donut.className = 'donut';
  donut.style.background = `conic-gradient(${gradient})`;
  container.appendChild(donut);

  // legend
  for (let i=0;i<pairs.length;i++){
    const [label,val] = pairs[i];
    const li = document.createElement('div');
    li.className = 'legend-row';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = colors[i];
    const pct = ((val/total)*100);
    li.append(sw, document.createTextNode(` ${label}  ${pct.toFixed(1)}%`));
    legend.appendChild(li);
  }
}

// ---------- BOOTSTRAP ----------
async function init() {
  mountRuleBanner();
  await loadHeadshots();

  // Load week data
  const { kpis, agents, allSales } = await getWeekData();

  // Fix “Team $0”
  setTopKPIs(kpis);

  // Roster table
  renderAgents(agents);

  // Vendors (45d — via override or best available)
  const vendorPairs = await buildVendors45d(allSales);
  renderVendorChart(vendorPairs);
}

// Kick it off
document.addEventListener('DOMContentLoaded', init);

/* =========================
   Minimal CSS helpers (if not already present in CSS)
   You can move these into dashboard.css if you prefer.
   ========================= */
(function injectCSS() {
  const css = `
    .avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle}
    .avatar.initials{display:inline-flex;align-items:center;justify-content:center;background:#333;color:#ffd66b;font-weight:700}
    .agent-cell{display:flex;align-items:center;gap:.5rem}
    .muted{opacity:.6;text-align:center;padding:1rem}
    .donut{width:240px;height:240px;border-radius:50%;position:relative;margin:0 auto}
    .donut::after{content:"";position:absolute;inset:25%;background:#0f0f10;border-radius:50%}
    .legend-row{display:flex;align-items:center;gap:.5rem;margin:.25rem 0;font-size:.95rem}
    .swatch{width:10px;height:10px;border-radius:2px;display:inline-block}
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();
