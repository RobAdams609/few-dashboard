/* ========= RULES ========= */
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
const fmt = (n) => (n||0).toLocaleString();
const fmtMoney = (n)=> `$${Math.round(n||0).toLocaleString()}`;

/* stable rule-of-day index */
function ruleIndexForToday(){
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(),0,0));
  const dayOfYear = Math.floor((now - start)/86400000);
  return dayOfYear % PRINCIPLES.length;
}

/* banner text */
function setPrinciple(){
  $('#principle').textContent = PRINCIPLES[ruleIndexForToday()];
}
/* top ticker text */
function setRuleTicker(){
  $('#rule-ticker-text').textContent = `RULE OF THE DAY — ${PRINCIPLES[ruleIndexForToday()]} — `;
}

/* ========= data + render ========= */
let board = { agents: [], rank: {} };

/* If the data comes in as "Unknown", show your name instead */
function normalizeName(name){
  if (!name) return "Robert Adams";
  const n = String(name).trim();
  if (n.toLowerCase() === "unknown") return "Robert Adams";
  return n;
}

async function fetchBoard(){
  const res = await fetch('/api/board', { credentials:'include' });
  if (!res.ok) throw new Error(`board ${res.status}`);
  board = await res.json();
}

function render(){
  const tbody = $('#table tbody');
  tbody.innerHTML = '';

  const rows = Array.isArray(board.agents) ? board.agents : [];

  // Sort by Sales desc, then AV, then Calls
  rows.sort((a,b) => (b.sales||0)-(a.sales||0) || (b.av||0)-(a.av||0) || (b.calls||0)-(a.calls||0));

  for (const a of rows){
    const tr = document.createElement('tr');

    const name = normalizeName(a.display || a.name);
    const calls = a.calls ?? 0;
    const talkMin = Math.round((a.talk || 0));
    const sales = a.sales ?? 0;
    const av12 = a.av ?? 0;

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

/* ========= loop ========= */
async function tick(){
  try{
    await fetchBoard();
    render();
  }catch(e){
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setPrinciple();
  setRuleTicker();
  tick();

  setInterval(tick, 20_000);              // refresh data
  setInterval(setPrinciple, 60_000);      // refresh banner rule
  setInterval(setRuleTicker, 60*60*1000); // refresh ticker hourly
});
