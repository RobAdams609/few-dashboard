/***** RULES / PRINCIPLES *****/
const PRINCIPLES = [
  "Do not be entitled. Earn everything. Choose hard work over handouts… always.",
  "To get, give.",
  "Bring The Few Energy. Exude grit, gratitude, and go in every moment of every day.",
  "Get comfortable being uncomfortable.",
  "If you risk nothing, you risk everything. Risk is scary, but regret is terrifying.",
  "Luck favors hard workers. You make your own luck.",
  "Your goal is growth to the grave.",
  "Plan your day. If you have no plan, expect no progress.",
  "Choose effort over your excuses and emotions.",
  "Restore the dignity of hard work.",
  "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];

/***** STATE *****/
let viewMode = 0;                 // rotate table views in the future if needed
let board = { agents: [], rank: {} };
let lastSalesCount = 0;

/***** UTIL *****/
const $ = sel => document.querySelector(sel);
const fmt = n => (n||0).toLocaleString();
const fmtMoney = n => '$' + (Math.round(n||0)).toLocaleString();
const slug = s => String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

function normalizeName(n){
  if (!n || n === 'Unknown') return 'Robert Adams';
  return n;
}

function initialsOf(name){
  const parts = String(name||'').trim().split(/\s+/).slice(0,2);
  return parts.map(p => p[0]?.toUpperCase() || '').join('');
}

/***** RULE OF THE DAY *****/
function setPrinciple(){
  const idx = Math.floor((Date.now() / (24*60*60*1000))) % PRINCIPLES.length;
  $('#principle').textContent = PRINCIPLES[idx];
}
function setRuleTicker(){
  const idx = Math.floor((Date.now() / (24*60*60*1000))) % PRINCIPLES.length;
  $('#rule-ticker-text').textContent = PRINCIPLES[idx];
}

/***** DATA FETCH *****/
async function fetchBoard(){
  const res = await fetch('/api/board', { credentials: 'include' });
  if(!res.ok) throw new Error('board ' + res.status);
  board = await res.json();
}

async function fetchSales(){
  const res = await fetch('/api/sales', { credentials: 'include' });
  if(!res.ok) return { list: [] };
  return await res.json();
}

/***** RENDER *****/
function render(){
  const tbody = $('#table tbody');
  tbody.innerHTML = '';

  const agents = Array.isArray(board.agents) ? board.agents : [];

  agents.forEach(a => {
    const name = normalizeName(a.display || a.name || 'Unknown');
    const calls = a.calls ?? 0;
    const talk = a.talk ?? a.talkMin ?? 0;
    const sales = a.sales ?? 0;
    const av = a.av ?? 0;

    const tr = document.createElement('tr');

    // Agent cell (avatar + name)
    const tdAgent = document.createElement('td');
    const wrap = document.createElement('div'); wrap.className = 'agent';

    // avatar (try headshot, else initials)
    const img = document.createElement('img');
    img.className = 'avatar';
    img.alt = name;
    img.src = `/headshots/${slug(name)}.jpg`;
    img.onerror = () => {
      const d = document.createElement('div');
      d.className = 'initials';
      d.textContent = initialsOf(name);
      img.replaceWith(d);
    };

    const spanName = document.createElement('span');
    spanName.textContent = name;

    wrap.appendChild(img);
    wrap.appendChild(spanName);
    tdAgent.appendChild(wrap);

    const tdCalls = document.createElement('td'); tdCalls.textContent = fmt(calls);
    const tdTalk  = document.createElement('td'); tdTalk.textContent  = fmt(Math.round(talk));
    const tdSales = document.createElement('td'); tdSales.textContent = fmt(sales);
    const tdAV    = document.createElement('td'); tdAV.textContent    = fmtMoney(av);

    tr.append(tdAgent, tdCalls, tdTalk, tdSales, tdAV);
    tbody.appendChild(tr);
  });
}

/***** ROTATION / POLLING *****/
async function tick(){
  try{
    await fetchBoard();
    render();
  }catch(e){
    console.error(e);
  }
}
function rotateView(){
  viewMode = (viewMode + 1) % 4;
  render();
}

/***** SALE BANNER *****/
function showSaleBanner(text){
  const el = $('#sale-banner');
  $('#sale-text').textContent = text;
  el.classList.remove('hidden');
  // kick in transition
  requestAnimationFrame(() => el.classList.add('show'));
  // hide after 12s
  setTimeout(() => el.classList.remove('show'), 12000);
}
async function pollSales(){
  try{
    const data = await fetchSales();           // expected shape { list: [...] }
    const list = Array.isArray(data.list) ? data.list : [];
    if(list.length > lastSalesCount){
      const sale = list[0] || {};
      const who = normalizeName(sale.agentName || sale.agent || '');
      const amt = sale.amount != null ? fmtMoney(sale.amount) : '';
      const what = sale.soldProductName || sale.product || 'A sale';
      const msg = `${what} ${amt ? '— ' + amt : ''}${who ? ' by ' + who : ''}!`;
      showSaleBanner(msg);
      lastSalesCount = list.length;
    }
  }catch(e){
    // silent – keep dashboard calm
  }
}

/***** STARTUP *****/
document.addEventListener('DOMContentLoaded', () => {
  setPrinciple();
  setRuleTicker();

  tick();                         // initial load
  setInterval(tick, 20_000);      // refresh every 20s

  setInterval(rotateView, 30_000);   // reserved
  setInterval(setPrinciple, 60_000); // update subline hourly
  setInterval(setRuleTicker, 60_000);// keep ticker fresh

  pollSales();                    // first sales check
  setInterval(pollSales, 30_000); // check every 30s
});
