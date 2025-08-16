/* ========= RULES (from your images) ========= */
const PRINCIPLES = [
  "Do not be entitled. Earn everything. Choose hard work over handouts… always.",
  "To get, give.",
  "Bring The Few Energy. Exude grit, gratitude, and go in every moment of every day.",
  "Get comfortable being uncomfortable.",
  "If you risk nothing, you risk everything.",
  "Luck favors hard workers. You make your own luck.",
  "Your goal is growth to the grave.",
  "Plan your day. If you have no plan, expect no progress.",
  "Choose effort over your excuses and emotions.",
  "Restore the dignity of hard work.",
  "(Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];

/* ========= helpers ========= */
const $ = (sel) => document.querySelector(sel);
const pad2 = (n) => String(n).padStart(2,'0');
const fmt = (n) => (n||0).toLocaleString();
const fmtMoney = (n)=> `$${Math.round(n||0).toLocaleString()}`;

/* pick a stable rule for the day (ET) */
function ruleIndexForToday(){
  const now = new Date();
  // convert to ET without timezone libs: assume server/browser local offset okay for daily roll
  const start = new Date(Date.UTC(now.getUTCFullYear(),0,0));
  const dayOfYear = Math.floor((now - start)/86400000);
  return dayOfYear % PRINCIPLES.length;
}

/* banner rule (right side) */
function setPrinciple(){
  const idx = ruleIndexForToday();
  $('#principle').textContent = PRINCIPLES[idx];
}

/* scrolling ticker text (top) */
function setRuleTicker(){
  const idx = ruleIndexForToday();
  $('#rule-ticker-text').textContent = `RULE OF THE DAY — ${PRINCIPLES[idx]} — `;
}

/* ========= data + render ========= */
let board = { agents: [], rank: {} };

async function fetchBoard(){
  const res = await fetch('/api/board', { credentials:'include' });
  if (!res.ok) throw new Error(`board ${res.status}`);
  board = await res.json();
}

function render(){
  const tbody = $('#table tbody');
  tbody.innerHTML = '';

  const rows = Array.isArray(board.agents) ? board.agents : [];

  // Sort by Sales desc, then AV, then Calls (tweak as desired)
  rows.sort((a,b) => (b.sales||0)-(a.sales||0) || (b.av||0)-(a.av||0) || (b.calls||0)-(a.calls||0));

  for (const a of rows){
    const tr = document.createElement('tr');

    const name = a.display || a.name || 'Unknown';
    const calls = a.calls ?? 0;
    const talkMin = Math.round((a.talk || 0)); // already minutes in backend
    const sales = a.sales ?? 0;
    const av12 = a.av ?? 0; // already 12× calc on backend

    tr.innerHTML = `
      <td>${name}</td>
      <td class="num">${fmt(calls)}</td>
      <td class="num">${fmt(talkMin)}</td>
      <td class="num">${fmt(sales)}</td>
      <td class="num money">${fmtMoney(av12)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ========= loop + start ========= */
async function tick(){
  try{
    await fetchBoard();
    render();
  }catch(e){
    // keep the page alive even if API hiccups
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // initial UI
  setPrinciple();
  setRuleTicker();
  tick();

  // intervals
  setInterval(tick, 20_000);            // fetch fresh data every 20s
  setInterval(setPrinciple, 60_000);    // banner rule re-evaluated hourly-ish
  setInterval(setRuleTicker, 60*60*1000); // ticker text refresh hourly
});
