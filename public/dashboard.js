/* ---------- Rotation set ---------- */
/* Main board shows all columns.
   Leaderboards only show the metric they’re about. */
const VIEWS = [
  { id: 'roster', label: 'Today — Roster', cols: ['agent','calls','talk','sales','av'] },
  { id: 'av',     label: 'Today — Leaderboard (Submitted AV)', cols: ['agent','av'] },
  { id: 'sales',  label: 'Today — Leaderboard (Sales)',        cols: ['agent','sales'] },
];
const ROTATE_MS = 45_000;

/* ---------- State ---------- */
let roster = [];   // [{name,email,photo}]
let board  = [];   // [{email,calls,talkMin,sales,av12x}]
let viewIdx = 0;

/* ---------- DOM helpers ---------- */
const $  = (s) => document.querySelector(s);
const fmtMoney = (n=0) => `$${Math.round(n||0).toLocaleString()}`;
const initials  = (name='') => {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0]||'').toUpperCase() + (p[1]?.[0]||'').toUpperCase();
};

/* ---------- Daily rule (once per day) ---------- */
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
  const idx = Math.floor(Date.now()/86400000) % PRINCIPLES.length; // change per day
  $("#principle").textContent = PRINCIPLES[idx];
  $("#rule-ticker-text").textContent = `RULE OF THE DAY — ${PRINCIPLES[idx]}`;
}

/* ---------- Data ---------- */
async function loadRoster(){
  try{
    const r = await fetch('/headshots/roster.json', { cache:'no-store' });
    const j = await r.json();
    roster = (j?.agents||[]).filter(a => a?.name && a?.email);
  }catch(e){
    console.error('roster error', e);
    roster = [];
  }
}

async function loadBoardToday(){
  try{
    const r = await fetch('/api/board', { cache:'no-store', credentials:'include' });
    if(!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const rows = (j?.agents || j || []);
    board = rows.map(x => ({
      email: (x.email||'').toLowerCase(),
      calls: +x.calls || 0,
      talkMin: +x.talkMin || +x.talk_mins || 0,
      sales: +x.sales || 0,
      av12x: +x.av12x || +x.av || 0,
    }));
  }catch(e){
    console.warn('board fetch failed, rendering zeros', e);
    board = [];
  }
}

/* ---------- Rendering ---------- */

function setHeader(cols){
  const map = {
    agent: 'Agent',
    calls: 'Calls',
    talk:  'Talk Time (min)',
    sales: 'Sales',
    av:    'Submitted AV (12×)'
  };
  $("#thead").innerHTML =
    `<tr>${cols.map(c => `<th>${map[c]}</th>`).join('')}</tr>`;
}

function agentCell(agent){
  const img = agent.photo
    ? `<img class="avatar" src="/headshots/${agent.photo}" alt="${agent.name}">`
    : `<span class="initials">${initials(agent.name)}</span>`;
  return `<td class="agent-cell">${img}<span>${agent.name}</span></td>`;
}

function rowHTML(agent, stats, cols){
  const cells = cols.map(c => {
    if (c === 'agent') return agentCell(agent);
    if (c === 'calls') return `<td>${stats.calls||0}</td>`;
    if (c === 'talk')  return `<td>${stats.talkMin||0}</td>`;
    if (c === 'sales') return `<td>${stats.sales||0}</td>`;
    if (c === 'av')    return `<td>${fmtMoney(stats.av12x||0)}</td>`;
    return '<td></td>';
  });
  return `<tr>${cells.join('')}</tr>`;
}

function renderRoster(){
  const view = VIEWS[0];
  $("#mode").textContent = view.label;
  setHeader(view.cols);

  const tbody = $("#tbody"); tbody.innerHTML = '';
  const byEmail = new Map(board.map(b => [b.email, b]));
  roster.forEach(a => {
    const s = byEmail.get(a.email.toLowerCase()) || {calls:0,talkMin:0,sales:0,av12x:0};
    tbody.insertAdjacentHTML('beforeend', rowHTML(a, s, view.cols));
  });
}

function renderLeaderboard(kind){
  const view = (kind === 'av') ? VIEWS[1] : VIEWS[2];
  $("#mode").textContent = view.label;
  setHeader(view.cols);

  const byEmail = new Map(board.map(b => [b.email, b]));
  const rows = roster.map(a => ({
    a,
    s: byEmail.get(a.email.toLowerCase()) || {calls:0,talkMin:0,sales:0,av12x:0}
  }));

  if (kind === 'av') rows.sort((x,y)=> (y.s.av12x||0) - (x.s.av12x||0));
  else rows.sort((x,y)=> (y.s.sales||0) - (x.s.sales||0));

  const tbody = $("#tbody"); tbody.innerHTML = '';
  rows.forEach(({a,s}) => {
    tbody.insertAdjacentHTML('beforeend', rowHTML(a, s, view.cols));
  });
}

/* ---------- Rotation ---------- */
function showCurrentView(){
  const id = VIEWS[viewIdx].id;
  if (id === 'roster') renderRoster();
  else if (id === 'av') renderLeaderboard('av');
  else renderLeaderboard('sales');
}
function startRotation(){
  showCurrentView();
  setInterval(() => { viewIdx = (viewIdx+1) % VIEWS.length; showCurrentView(); }, ROTATE_MS);
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  setPrincipleDaily();
  await loadRoster();
  await loadBoardToday();   // if API is down you still see everyone with zeros
  startRotation();          // roster -> AV-only -> Sales-only (every 45s)
});
