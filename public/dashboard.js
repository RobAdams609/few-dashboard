// ---------- principles (rule of the day) ----------
const PRINCIPLES = [
  "1) Own the first 10 minutes.",
  "2) To get, give.",
  "3) Bring The Few Energy. Exude grit, gratitude, and go in every moment of every day.",
  "4) Get comfortable being uncomfortable.",
  "5) If you risk nothing, you risk everything. Risk is scary, but regret is terrifying.",
  "6) Luck favors hard workers. You make your own luck.",
  "7) Your goal is growth to the grave.",
  "8) Plan your day. If you have no plan, expect no progress.",
  "9) Choose effort over your excuses and emotions.",
  "10) Restore the dignity of hard work.",
  "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];

// ---------- config ----------
const HEAD_BASE = "/headshots/";
const ROSTER_URL = "/headshots/roster.json";
const EXCLUDE_EMAILS = new Set([
  "abigailaustin.healthadvisor@gmail.com" // <- already excluded
]);

// ---------- state ----------
let board = { agents: [] };
let roster = [];
let lastSalesByKey = new Map(); // email preferred, else name
let viewMode = 0;

// ---------- helpers ----------
const fmt = n => (n||0).toLocaleString();
const fmtMoney = n => '$' + (Math.round(n||0)).toLocaleString();

// prefer email for identity; fall back to lowercased name
const keyFor = a => (a.email && a.email.toLowerCase()) || (a.name||'').toLowerCase();

// avatar component
function avatarCell(r){
  const img = document.createElement('img');
  if (r.photo) {
    img.src = HEAD_BASE + r.photo;
    img.alt = r.name;
    img.onerror = () => img.replaceWith(initialsChip(r.name));
    return img;
  }
  return initialsChip(r.name);
}
function initialsChip(name){
  const span = document.createElement('span');
  span.className = 'initials';
  const initials = (name || '?').split(/\s+/).map(s => s[0]||'').join('').slice(0,2).toUpperCase();
  span.textContent = initials;
  return span;
}

// ---------- fetch ----------
async function fetchBoard(){
  const res = await fetch('/api/board', { credentials: 'include' });
  if (!res.ok) throw new Error('board ' + res.status);
  board = await res.json();
}

async function fetchRoster(){
  const res = await fetch(ROSTER_URL, { cache: 'no-store' });
  roster = await res.json();
}

// ---------- merge roster + live ----------
function buildRows(){
  // map live by email or name
  const liveMap = new Map();
  for(const a of (board.agents || [])){
    liveMap.set(keyFor(a), a);
  }

  // build rows from roster order
  const rows = [];
  for(const r of roster){
    if (EXCLUDE_EMAILS.has((r.email||'').toLowerCase())) continue;

    const k = keyFor(r);
    const live = liveMap.get(k) || {};
    rows.push({
      key: k,
      name: r.name,
      email: r.email,
      photo: r.photo || null,
      calls: live.calls || 0,
      talk: live.talk || 0,
      sales: live.sales || 0,
      av: live.av || 0
    });
  }
  return rows;
}

// ---------- render ----------
function render(){
  const tbody = document.querySelector('#table tbody');
  tbody.innerHTML = '';

  const rows = buildRows();

  // sort by sales desc, then calls desc
  rows.sort((a,b)=> (b.sales||0)-(a.sales||0) || (b.calls||0)-(a.calls||0));

  for(const r of rows){
    const tr = document.createElement('tr');

    const tdAgent = document.createElement('td');
    const chip = document.createElement('div'); chip.className = 'agent';
    chip.appendChild(avatarCell(r));
    const nameSpan = document.createElement('span'); nameSpan.textContent = r.name;
    chip.appendChild(nameSpan);
    tdAgent.appendChild(chip);

    const tdCalls = document.createElement('td'); tdCalls.className='calls'; tdCalls.textContent = fmt(r.calls);
    const tdTalk  = document.createElement('td'); tdTalk.className='talk'; tdTalk.textContent  = fmt(r.talk);
    const tdSales = document.createElement('td'); tdSales.className='sales'; tdSales.textContent = fmt(r.sales);
    const tdAv    = document.createElement('td'); tdAv.className='av'; tdAv.textContent    = fmtMoney(r.av);

    tr.append(tdAgent, tdCalls, tdTalk, tdSales, tdAv);
    tbody.appendChild(tr);
  }
}

// ---------- rule ticker & headline subtext ----------
function setPrinciple(){
  const dayIndex = Math.floor(Date.now() / (24*60*60*1000)) % PRINCIPLES.length;
  document.getElementById('principle').textContent = PRINCIPLES[dayIndex];
}
function setRuleTicker(){
  setPrinciple();
  const t = document.getElementById('rule-ticker-text');
  t.textContent = PRINCIPLES[dayIndexForTicker()];
  // simple drift: rotate every ~40s
  let i = dayIndexForTicker();
  setInterval(()=>{
    i = (i+1) % PRINCIPLES.length;
    t.textContent = PRINCIPLES[i];
  }, 40000);
}
const dayIndexForTicker = () => Math.floor(Date.now()/(24*60*60*1000)) % PRINCIPLES.length;

// ---------- sale celebration ----------
function checkCelebrations(){
  const rows = buildRows();
  for(const r of rows){
    const k = r.key;
    const prev = lastSalesByKey.get(k) || 0;
    if (r.sales > prev){
      showSalePop(r.name, r.sales - prev, r.av);
    }
    lastSalesByKey.set(k, r.sales);
  }
}

let popTimer = null;
function showSalePop(name, inc, av){
  const root = document.getElementById('sale-pop');
  root.innerHTML = `
    <div class="card">
      <span class="badge">SALE</span>
      <div class="msg">${name} just sold! (+${inc}) — AV ${fmtMoney(av)}</div>
    </div>
  `;
  root.classList.add('show');
  clearTimeout(popTimer);
  popTimer = setTimeout(()=> root.classList.remove('show'), 4500);
}

// ---------- loop ----------
async function tick(){
  try {
    await fetchBoard();
    render();
    checkCelebrations();
  } catch(e){
    console.error(e);
  }
}

// ---------- boot ----------
document.addEventListener('DOMContentLoaded', async () => {
  await fetchRoster();
  setRuleTicker();
  setPrinciple();
  await tick();
  setInterval(tick, 20000);     // refresh every 20s
  setInterval(setPrinciple, 60000); // refresh principle hourly-ish
});
