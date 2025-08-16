/* ---------- RULES / TICKER ---------- */
const PRINCIPLES = [
  "1) Own the first 10 minutes.",
  "2) To get, give.",
  "3) Bring The Few Energy.",
  "4) Get comfortable being uncomfortable.",
  "5) If you risk nothing, you risk everything.",
  "6) Luck favors hard workers. You make your own luck.",
  "7) Your goal is growth to the grave.",
  "8) Plan your day. If you have no plan, expect no progress.",
  "9) Choose effort over your excuses and emotions.",
  "10) Restore the dignity of hard work.",
  "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];

function setPrinciple(){
  const idx = Math.floor(Date.now()/(24*60*60*1000)) % PRINCIPLES.length;
  document.getElementById('principle').textContent = PRINCIPLES[idx];
}
function setRuleTicker(){
  const idx = Math.floor(Date.now()/(24*60*60*1000)) % PRINCIPLES.length;
  document.getElementById('rule-ticker-text').textContent = PRINCIPLES[idx];
}

/* ---------- VIEWS (45s rotation) ---------- */
const VIEWS = [
  { id:'today-roster', label:'Today — Roster',   sort:null },
  { id:'today-av',     label:'Today — Top Submitted AV', sort:(a,b)=> (b.av||0)-(a.av||0) },
  { id:'today-sales',  label:'Today — Top Sales',        sort:(a,b)=> (b.sales||0)-(a.sales||0) },
];
let viewIndex = 0;

/* ---------- ROSTER + LIVE DATA ---------- */
let roster = [];     // [{name,email,photo}]
let board = {agents:[]};  // live numbers (today)

const fmtMoney = n => '$' + (Math.round(n||0)).toLocaleString('en-US');

async function fetchRoster(){
  const r = await fetch('/headshots/roster.json', {cache:'no-store'});
  const j = await r.json();
  roster = (j.agents||[]).filter(a => (a.name||'').trim() !== 'Abigail Austin'); // ensure gone
}

async function fetchBoardToday(){
  const r = await fetch('/api/board', { credentials:'include' });
  if(!r.ok){ throw new Error('board ' + r.status); }
  board = await r.json();
}

/* merge roster with board today */
function buildRows(){
  const byKey = x => (x.email||x.name||'').trim().toLowerCase();

  const rows = roster.map(a => ({
    key: byKey(a),
    name: a.name,
    email: a.email || '',
    photo: a.photo ? `/headshots/${a.photo}` : null,
    calls: 0, talk: 0, sales: 0, av: 0
  }));

  const map = new Map(rows.map(r=>[r.key,r]));
  (board.agents||[]).forEach(a => {
    const k = byKey(a);
    const row = map.get(k) || map.get(byKey({name:a.name})) ;
    if(row){
      row.calls = a.calls||0;
      row.talk  = a.talk||0;
      row.sales = a.sales||0;
      row.av    = a.av||0;
    }
  });

  return rows;
}

/* ---------- RENDER ---------- */
const tbody = document.querySelector('#table tbody');
const viewLabelEl = document.getElementById('viewLabel');

function initials(name){
  const parts = (name||'').trim().split(/\s+/);
  return (parts[0]?.[0]||'').toUpperCase() + (parts[parts.length-1]?.[0]||'').toUpperCase();
}

function render(){
  const rows = buildRows();

  // sort for current view (roster = natural roster order)
  const v = VIEWS[viewIndex];
  viewLabelEl.textContent = v.label;
  if(v.sort) rows.sort(v.sort);

  // draw
  tbody.innerHTML = '';
  for(const r of rows){
    const tr = document.createElement('tr');

    // Agent cell with 36px avatar (no large images!)
    const tdA = document.createElement('td');
    tdA.className = 'col-agent';
    const cell = document.createElement('div');
    cell.className = 'agent';

    const av = document.createElement('div');
    av.className = 'avatar';
    if(r.photo){
      av.style.backgroundImage = `url("${r.photo}")`;
      av.textContent = ''; // no initials when photo present
    }else{
      av.textContent = initials(r.name);
    }

    const meta = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'name';
    nm.textContent = r.name;
    const em = document.createElement('span');
    em.className = 'email';
    em.textContent = r.email;

    meta.appendChild(nm); meta.appendChild(em);
    cell.appendChild(av); cell.appendChild(meta);
    tdA.appendChild(cell);

    const tdCalls = document.createElement('td'); tdCalls.className='num'; tdCalls.textContent = (r.calls||0).toLocaleString();
    const tdTalk  = document.createElement('td'); tdTalk.className='num';  tdTalk.textContent  = (r.talk||0).toLocaleString();
    const tdSales = document.createElement('td'); tdSales.className='num'; tdSales.textContent = (r.sales||0).toLocaleString();
    const tdAV    = document.createElement('td'); tdAV.className='num';    tdAV.textContent    = fmtMoney((r.av||0));

    tr.append(tdA, tdCalls, tdTalk, tdSales, tdAV);
    tbody.appendChild(tr);
  }
}

/* ---------- ROTATION ---------- */
function nextView(){
  viewIndex = (viewIndex + 1) % VIEWS.length;
  render();
}

/* ---------- BOOT ---------- */
async function boot(){
  setRuleTicker();
  setPrinciple();

  await fetchRoster();
  await fetchBoardToday();
  render();

  // refresh numbers every 20s
  setInterval(async ()=>{
    try{ await fetchBoardToday(); render(); }catch(err){ console.warn(err); }
  }, 20000);

  // rotate views every 45s
  setInterval(nextView, 45000);
}

document.addEventListener('DOMContentLoaded', boot);
