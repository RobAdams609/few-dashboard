/* ---------- Configuration ---------- */
const VIEWS = [
  { id: 'roster', label: 'Today — Roster' },
  { id: 'av',     label: 'Today — Leaderboard (Submitted AV)' },
  { id: 'sales',  label: 'Today — Leaderboard (Sales)' }
];
const ROTATE_MS = 45_000; // rotate every 45s

/* ---------- State ---------- */
let roster = [];        // [{name,email,photo}]
let board = [];         // [{email,calls,talkMin,sales,av12x}]
let viewIdx = 0;

/* ---------- Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function fmtMoney(n=0){ return `$${(Math.round((n||0))).toLocaleString()}`; }
function initials(name=''){
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0]||'').toUpperCase() + (parts[1]?.[0]||'').toUpperCase();
}

/* ---------- Daily rule + principle (once/day, not 3h) ---------- */
const PRINCIPLES = [
  "1) Own the first 10 minutes.",
  "2) Speed to lead beats price.",
  "3) Ask, then shut up and listen.",
  "4) The follow-up is the sale.",
  "5) Tonality > words.",
  "6) Control the frame, softly.",
  "7) Prequalify without friction.",
  "8) Solve; don’t sell.",
  "9) Document everything, instantly.",
  "10) Prospect daily, even on wins.",
  "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];
function setPrincipleDaily(){
  // rotate by DAY so it changes once per day
  const todayIdx = Math.floor(Date.now()/(24*60*60*1000)) % PRINCIPLES.length;
  $("#principle").textContent = PRINCIPLES[ todayIdx ];
  $("#rule-ticker-text").textContent = `RULE OF THE DAY — ${PRINCIPLES[todayIdx]}`;
}

/* ---------- Data ---------- */

// Roster is always the source of truth for which rows appear
async function loadRoster(){
  try{
    const r = await fetch('/headshots/roster.json', { cache: 'no-store' });
    const j = await r.json();
    roster = (j?.agents||[]).filter(a => !!a?.name && !!a?.email);
  }catch(e){
    console.error('roster load failed', e);
    roster = [];
  }
}

// /api/board should return per-agent stats. We fall back to zeros if it’s missing.
async function loadBoardToday(){
  try{
    const r = await fetch('/api/board', { cache:'no-store', credentials:'include' });
    if(!r.ok) throw new Error(await r.text());
    const j = await r.json();
    // Normalize to: email, calls, talkMin, sales, av12x
    const rows = (j?.agents || j || []);
    board = rows.map(x => ({
      email: (x.email||'').toLowerCase(),
      calls: +x.calls || 0,
      talkMin: +x.talkMin || +x.talk_mins || 0,
      sales: +x.sales || 0,
      av12x: +x.av12x || +x.av || 0
    }));
  }catch(e){
    console.warn('board fetch failed; rendering zeros', e);
    board = [];
  }
}

/* ---------- Rendering ---------- */

function rowFor(agent, stats){
  const tr = document.createElement('tr');
  const imgOrInit = agent.photo
    ? `<img class="avatar" src="/headshots/${agent.photo}" alt="${agent.name}">`
    : `<span class="initials">${initials(agent.name)}</span>`;
  tr.innerHTML = `
    <td class="agent-cell">${imgOrInit}<span>${agent.name}</span></td>
    <td>${stats.calls||0}</td>
    <td>${(stats.talkMin||0)}</td>
    <td>${stats.sales||0}</td>
    <td>${fmtMoney(stats.av12x||0)}</td>
  `;
  return tr;
}

function renderRoster(){
  $("#mode").textContent = VIEWS[0].label;
  const tbody = $("#tbody"); tbody.innerHTML = '';
  const byEmail = new Map(board.map(b => [b.email, b]));
  roster.forEach(a => {
    tbody.appendChild(rowFor(a, byEmail.get(a.email.toLowerCase()) || {}));
  });
}

function renderLeaderboard(kind){
  const tbody = $("#tbody"); tbody.innerHTML = '';

  // Attach stats to roster rows; missing stats -> zeros
  const byEmail = new Map(board.map(b => [b.email, b]));
  const rows = roster.map(a => ({
    a,
    s: byEmail.get(a.email.toLowerCase()) || { calls:0, talkMin:0, sales:0, av12x:0 }
  }));

  if(kind === 'av'){
    $("#mode").textContent = VIEWS[1].label;
    rows.sort((x,y) => (y.s.av12x||0) - (x.s.av12x||0));
  }else{
    $("#mode").textContent = VIEWS[2].label;
    rows.sort((x,y) => (y.s.sales||0) - (x.s.sales||0));
  }

  rows.forEach(({a,s}) => tbody.appendChild(rowFor(a,s)));
}

/* ---------- Rotation ---------- */

function showCurrentView(){
  const id = VIEWS[viewIdx].id;
  if(id === 'roster') renderRoster();
  else if(id === 'av') renderLeaderboard('av');
  else renderLeaderboard('sales');
}
function startRotation(){
  showCurrentView();
  setInterval(() => {
    viewIdx = (viewIdx + 1) % VIEWS.length;
    showCurrentView();
  }, ROTATE_MS);
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  setPrincipleDaily();                 // daily rule + subtitle
  await loadRoster();                  // who should be visible
  await loadBoardToday();              // today’s stats (zeros if missing)
  startRotation();                     // roster -> av -> sales (every 45s)
});
