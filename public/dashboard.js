/* few-dashboard — daily & sales-week (Fri→Thu) views with auto-rotation
   Views (45s each):
     Today — Roster
     Today — Leaders — Submitted AV
     Today — Leaders — Sales
     This Week (Fri→Thu) — Roster
     This Week (Fri→Thu) — Leaders — Submitted AV
     This Week (Fri→Thu) — Leaders — Sales
*/

/* ---------- SETTINGS ---------- */
const DEAL_VALUE = 200;          // $ per sale
const AV_MULTIPLIER = 12;        // 12× AV
const ROTATE_MS = 45_000;        // rotate every 45 seconds
const MAX_LEADER_ROWS = 12;      // top list length

/* ---------- DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const table = $('#table');
const tableBody = table.querySelector('tbody');
const viewTag = document.getElementById('viewTag') || (() => {
  const d = document.createElement('div'); d.id = 'viewTag';
  document.getElementById('banner')?.appendChild(d); return d;
})();

/* ---------- PRINCIPLES / RULES ---------- */
const PRINCIPLES = [
  "1) Own the first 10 minutes.",
  "2) To get, give.",
  "3) Bring The Few Energy.",
  "4) Get comfortable being uncomfortable.",
  "5) If you risk nothing, you risk everything.",
  "6) Luck favors hard workers.",
  "7) Your goal is growth to the grave.",
  "8) Plan your day.",
  "9) Choose effort over your excuses and emotions.",
  "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];
function setPrinciple(){
  const idx = Math.floor(Date.now() / (24*60*60*1000)) % PRINCIPLES.length;
  const el = document.getElementById('principle');
  if (el) el.textContent = PRINCIPLES[idx];
}

/* ---------- ROSTER ---------- */
let roster = []; // [{name, email, photo|null}, ...]
const ROSTER_TRY = [
  '/headshots/roster.json',
  'https://raw.githubusercontent.com/RobAdams609/few-dashboard/main/public/headshots/roster.json'
];
async function fetchRoster(){
  roster = [];
  for (const url of ROSTER_TRY){
    try{
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const txt = await res.text();
      let json; try { json = JSON.parse(txt); } catch { continue; }
      if (Array.isArray(json)) { roster = json; return; }
      if (json && Array.isArray(json.agents)) { roster = json.agents; return; }
    }catch{}
  }
}

/* ---------- BOARD (stats) ---------- */
let stats = {
  daily:  { agents: [] },
  weekly: { agents: [] }
};

// Days since last Friday (ET), inclusive of today.
// Fri=1, Sat=2, Sun=3, Mon=4, Tue=5, Wed=6, Thu=7.
function daysSinceSalesWeekStartET(){
  const now = new Date();
  // Convert "now" to America/New_York local time
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = et.getDay();            // 0=Sun, 1=Mon, ... 5=Fri, 6=Sat
  const FRIDAY = 5;
  const delta = ((dow + 7) - FRIDAY) % 7; // 0 if Fri, 1 if Sat, ... 6 if Thu
  return delta + 1;
}

async function fetchBoardRangeDays(days){
  const urls = [
    `/api/board?days=${days}`,
    `/api/board&days=${days}`,
    '/api/board'
  ];
  for (const url of urls){
    try{
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && Array.isArray(data.agents)) return data;
    }catch{}
  }
  return { agents: [] };
}

async function fetchAllStats(){
  const weeklyDays = daysSinceSalesWeekStartET(); // Fri→today (ET)
  const [daily, weekly] = await Promise.all([
    fetchBoardRangeDays(1),
    fetchBoardRangeDays(weeklyDays),
  ]);
  stats.daily  = daily  || { agents: [] };
  stats.weekly = weekly || { agents: [] };
}

/* ---------- MERGE roster + stats ---------- */
const keyEmail = (s) => (s||'').trim().toLowerCase();
const keyName  = (s) => (s||'').trim().toLowerCase().replace(/\s+/g, ' ');

function mergeRows(range){ // range: 'daily' | 'weekly'
  const src = stats[range] || { agents: [] };
  const byEmail = new Map();
  const byName  = new Map();
  (src.agents || []).forEach(a => {
    if (a.email) byEmail.set(keyEmail(a.email), a);
    if (a.name)  byName.set(keyName(a.name), a);
  });

  return (roster || []).map(r => {
    const stat = byEmail.get(keyEmail(r.email)) || byName.get(keyName(r.name)) || {};
    const calls = Number(stat.calls||0);
    const talk  = Number(stat.talk||0);
    const sales = Number(stat.sales||0);
    const submittedAV = sales * DEAL_VALUE * AV_MULTIPLIER;
    return {
      name: r.name, email: r.email, photo: r.photo || null,
      calls, talk, sales, submittedAV
    };
  });
}

/* ---------- RENDER ---------- */
function fmtMoney(n){ return '$' + Math.round(n).toLocaleString(); }
function initials(name){
  return (name||'')
    .split(/\s+/).filter(Boolean).slice(0,2)
    .map(s => s[0].toUpperCase()).join('');
}
function avatarCell(row){
  const wrap = document.createElement('div');
  wrap.className = 'avatar-wrap';
  if (row.photo){
    const img = document.createElement('img');
    img.src = `/headshots/${row.photo}`;
    img.alt = row.name;
    img.className = 'avatar';
    img.onerror = () => { wrap.textContent = initials(row.name); wrap.classList.add('initials'); };
    wrap.appendChild(img);
  } else {
    wrap.textContent = initials(row.name);
    wrap.classList.add('initials');
  }
  return wrap;
}
function clearTbody(){ while (tableBody.firstChild) tableBody.removeChild(tableBody.firstChild); }
function renderTable(rows){
  clearTbody();
  for (const r of rows){
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.className = 'col-name';
    const av = avatarCell(r); const label = document.createElement('span'); label.className = 'name'; label.textContent = r.name;
    tdName.appendChild(av); tdName.appendChild(label);
    const tdCalls = document.createElement('td'); tdCalls.textContent = (r.calls||0).toLocaleString();
    const tdTalk  = document.createElement('td'); tdTalk.textContent  = (r.talk||0).toLocaleString();
    const tdSales = document.createElement('td'); tdSales.textContent = (r.sales||0).toLocaleString();
    const tdAV    = document.createElement('td'); tdAV.textContent    = fmtMoney(r.submittedAV||0);
    tr.appendChild(tdName); tr.appendChild(tdCalls); tr.appendChild(tdTalk); tr.appendChild(tdSales); tr.appendChild(tdAV);
    tableBody.appendChild(tr);
  }
}
function setViewBadge(text){ if (viewTag){ viewTag.textContent = text; viewTag.className = 'view-tag'; } }

/* ---------- VIEWS & ROTATION ---------- */
const VIEWS = [
  { key: 'daily_roster',         range: 'daily',  type: 'roster',        label: 'Today — Roster' },
  { key: 'daily_leaders_av',     range: 'daily',  type: 'leaders_av',    label: 'Today — Leaders — Submitted AV' },
  { key: 'daily_leaders_sales',  range: 'daily',  type: 'leaders_sales', label: 'Today — Leaders — Sales' },
  { key: 'weekly_roster',        range: 'weekly', type: 'roster',        label: 'This Week (Fri→Thu) — Roster' },
  { key: 'weekly_leaders_av',    range: 'weekly', type: 'leaders_av',    label: 'This Week (Fri→Thu) — Leaders — Submitted AV' },
  { key: 'weekly_leaders_sales', range: 'weekly', type: 'leaders_sales', label: 'This Week (Fri→Thu) — Leaders — Sales' },
];
let viewIndex = 0;

function render(){
  const v = VIEWS[viewIndex];
  const rows = mergeRows(v.range);

  let out = rows;
  if (v.type === 'leaders_av'){
    out = rows.slice().sort((a,b)=> (b.submittedAV||0) - (a.submittedAV||0)).slice(0, MAX_LEADER_ROWS);
  } else if (v.type === 'leaders_sales'){
    out = rows.slice().sort((a,b)=> (b.sales||0) - (a.sales||0)).slice(0, MAX_LEADER_ROWS);
  } else if (v.type === 'roster'){
    out = rows.slice().sort((a,b)=> a.name.localeCompare(b.name));
  }

  setViewBadge(v.label);
  renderTable(out);
}
function rotate(){ viewIndex = (viewIndex + 1) % VIEWS.length; render(); }

/* ---------- LOOP ---------- */
async function tick(){
  await Promise.all([fetchRoster(), fetchAllStats()]);
  setPrinciple();
  render();
}

/* ---------- INIT ---------- */
document.addEventListener('DOMContentLoaded', () => {
  setPrinciple();
  tick();
  setInterval(tick, 20_000);      // refresh data every 20s
  setInterval(rotate, ROTATE_MS); // rotate views every 45s
});
