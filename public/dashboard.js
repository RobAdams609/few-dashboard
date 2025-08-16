/* ===========================
   Live Board (no partials)
   =========================== */

const ROSTER_URL = '/headshots/roster.json';
const RULES_URL  = '/rules.json';
const BOARD_URL  = '/api/board';     // existing serverless function that returns today's stats

// Rotation controls
const ROTATE_SECONDS = 45;           // Roster → Sales → Submitted AV (12x)

// Data refresh cadence
const FETCH_SECONDS = 20;            // fetch fresh stats every 20s

// DOM
const elRule = document.getElementById('rule-ticker-text');
const elLabel = document.getElementById('view-label');
const elThead = document.getElementById('thead');
const elTbody = document.getElementById('tbody');
const elSubtitle = document.getElementById('subtitle');

// -------------- Utils --------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmtMoney = n => new Intl.NumberFormat('en-US',{ style:'currency', currency:'USD', maximumFractionDigits:0 }).format(n||0);
const initials = (name='') => name.split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();

// Conservative normalizer for whatever /api/board returns
function normAgent(a = {}){
  const email = String(a.email || a.userEmail || a.leadEmail || '').toLowerCase();
  const calls = + (a.calls ?? a.callCount ?? 0);
  const talk  = + (a.talk ?? a.talkMin ?? a.talkMinutes ?? 0);
  const sales = + (a.sales ?? a.saleCount ?? 0);
  const av    = + (a.av12 ?? a.avx12 ?? a.av ?? 0);  // submitted AV 12x
  return { email, calls, talk, sales, av };
}

// Daily (ET) index for rules
function dayOfYearEST(){
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const start = new Date(est.getFullYear(), 0, 1);
  return Math.floor((est - start)/86400000);
}

// -------------- Load rules --------------
async function setRuleTicker(){
  try{
    const res = await fetch(RULES_URL, { cache: 'no-store' });
    const json = await res.json();
    const list = Array.isArray(json.rules) ? json.rules : [];
    if(!list.length) return;

    // Rule of the day (drop any leading "1) ")
    const idx = dayOfYearEST() % list.length;
    const headline = String(list[idx]).replace(/^\s*\d+\)\s*/,'').trim();
    elRule.textContent = headline;

    // Subtitle from the Bonus if present
    const bonus = list.find(x => /^bonus\)/i.test(x));
    if (bonus) {
      elSubtitle.textContent = bonus;
    } else {
      elSubtitle.textContent = '';
    }
  }catch(e){
    console.error('rules error', e);
  }
}

// refresh rule once an hour in case the page is left open forever
setRuleTicker();
setInterval(setRuleTicker, 60*60*1000);

// -------------- Load roster --------------
/*
  public/headshots/roster.json
  {
    "agents":[
      {"name":"Robert Adams","email":"robert@americanpathinsurance.com","photo":"robert-adams.jpg"},
      ...
    ]
  }
*/
let ROSTER = [];

async function loadRoster(){
  const res = await fetch(ROSTER_URL, { cache: 'no-store' });
  const json = await res.json();
  ROSTER = Array.isArray(json.agents) ? json.agents : [];
  // safety: drop anyone explicitly named "Abigail Austin" if you’ve removed her from reporting
  ROSTER = ROSTER.filter(a => (a.name || '').toLowerCase() !== 'abigail austin');
}

// -------------- Fetch stats --------------
let BOARD = [];  // normalized stats by email

async function fetchBoard(){
  try{
    const res = await fetch(BOARD_URL, { cache: 'no-store' });
    const j = await res.json();
    const arr = Array.isArray(j.agents) ? j.agents : (Array.isArray(j.data) ? j.data : []);
    BOARD = arr.map(normAgent);
  }catch(e){
    console.error('board fetch error', e);
    BOARD = [];
  }
}

// -------------- Views --------------
const VIEW = {
  ROSTER: 'roster',
  SALES:  'sales',
  AV:     'av'
};
const ROTATION = [VIEW.ROSTER, VIEW.SALES, VIEW.AV];
let curIndex = 0;

function labelFor(view){
  if (view === VIEW.SALES) return 'Today — Leaderboard (Sales)';
  if (view === VIEW.AV)    return 'Today — Leaderboard (Submitted AV)';
  return 'Today — Roster';
}

function buildHead(view){
  let cols = [];
  if (view === VIEW.SALES){
    cols = ['Agent', 'Sales'];
  } else if (view === VIEW.AV){
    cols = ['Agent', 'Submitted AV (12x)'];
  } else {
    cols = ['Agent', 'Calls', 'Talk Time (min)', 'Sales', 'Submitted AV (12x)'];
  }

  const tr = document.createElement('tr');
  cols.forEach(c => {
    const th = document.createElement('th');
    th.textContent = c;
    tr.appendChild(th);
  });
  elThead.innerHTML = '';
  elThead.appendChild(tr);
}

function metricFor(email){
  const key = String(email||'').toLowerCase();
  if(!key) return { calls:0, talk:0, sales:0, av:0 };
  return BOARD.find(x => x.email === key) || { calls:0, talk:0, sales:0, av:0 };
}

function avatarCell(agent){
  const wrap = document.createElement('div');
  wrap.className = 'agent-cell';

  const a = document.createElement('div');
  a.className = 'avatar';

  if (agent.photo){
    const img = document.createElement('img');
    img.src = `/headshots/${agent.photo}`;
    img.alt = `${agent.name}`;
    a.appendChild(img);
  } else {
    a.textContent = initials(agent.name||'');
  }

  const name = document.createElement('div');
  name.textContent = agent.name || 'Unknown';

  wrap.appendChild(a);
  wrap.appendChild(name);
  return wrap;
}

function render(view){
  elLabel.textContent = labelFor(view);
  buildHead(view);
  elTbody.innerHTML = '';

  // Always render roster order (stable), fill with zeros if no stats yet
  ROSTER.forEach(agent => {
    const { calls, talk, sales, av } = metricFor(agent.email);

    const tr = document.createElement('tr');

    const tdAgent = document.createElement('td');
    tdAgent.appendChild(avatarCell(agent));
    tr.appendChild(tdAgent);

    if (view === VIEW.SALES){
      const tdSales = document.createElement('td');
      tdSales.textContent = String(sales||0);
      tr.appendChild(tdSales);
    } else if (view === VIEW.AV){
      const tdAv = document.createElement('td');
      tdAv.textContent = fmtMoney(av||0);
      tr.appendChild(tdAv);
    } else {
      const tdCalls = document.createElement('td');
      const tdTalk  = document.createElement('td');
      const tdSales = document.createElement('td');
      const tdAv    = document.createElement('td');

      tdCalls.textContent = String(calls||0);
      tdTalk.textContent  = String(Math.round(talk||0));
      tdSales.textContent = String(sales||0);
      tdAv.textContent    = fmtMoney(av||0);

      tr.appendChild(tdCalls);
      tr.appendChild(tdTalk);
      tr.appendChild(tdSales);
      tr.appendChild(tdAv);
    }

    elTbody.appendChild(tr);
  });

  // Sort rows for leaderboards (descending)
  if (view !== VIEW.ROSTER){
    // build a value map from BOARD for quick read
    const map = Object.fromEntries(BOARD.map(b => [b.email, b]));
    const rows = Array.from(elTbody.querySelectorAll('tr'));
    rows.sort((r1, r2) => {
      const email1 = (ROSTER[rows.indexOf(r1)]?.email||'').toLowerCase();
      const email2 = (ROSTER[rows.indexOf(r2)]?.email||'').toLowerCase();
      const m1 = map[email1] || { sales:0, av:0 };
      const m2 = map[email2] || { sales:0, av:0 };
      if (view === VIEW.SALES) return (m2.sales||0) - (m1.sales||0);
      if (view === VIEW.AV)    return (m2.av||0) - (m1.av||0);
      return 0;
    });
    rows.forEach(r => elTbody.appendChild(r));
  }
}

async function refreshAndRender(view){
  await fetchBoard();
  render(view);
}

// Rotate views
async function start(){
  await loadRoster();
  await refreshAndRender(ROTATION[curIndex]);

  // periodic data refresh
  setInterval(() => refreshAndRender(ROTATION[curIndex]), FETCH_SECONDS*1000);

  // rotation
  if (ROTATE_SECONDS > 0){
    setInterval(() => {
      curIndex = (curIndex + 1) % ROTATION.length;
      render(ROTATION[curIndex]);        // re-render immediately with existing data
    }, ROTATE_SECONDS * 1000);
  }
}

start();
