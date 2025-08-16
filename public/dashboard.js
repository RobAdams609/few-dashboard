/* ========= RULES (your list) ========= */
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
const $ = s => document.querySelector(s);
const fmt = n => (n||0).toLocaleString();
const fmtMoney = n => `$${Math.round(n||0).toLocaleString()}`;

/* “Rule of the day” is locked to calendar day */
function ruleIndexForToday(){
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(),0,0));
  const day = Math.floor((now - start)/86400000);
  return day % PRINCIPLES.length;
}
function setPrinciple(){ $('#principle').textContent = PRINCIPLES[ruleIndexForToday()]; }
function setRuleTicker(){ $('#rule-ticker-text').textContent = `RULE OF THE DAY — ${PRINCIPLES[ruleIndexForToday()]} — `; }

/* ========= data + render ========= */
let board = { agents: [], rank: {} };
let prevSales = new Map();    // track prior sales count per agent for the toast

/* If the API returns “Unknown”, show your name */
function normalizeName(name){
  if (!name) return "Robert Adams";
  const n = String(name).trim();
  if (n.toLowerCase() === "unknown") return "Robert Adams";
  return n;
}

/* Headshot path: /headshots/<slug>.jpg ; fall back to an inline placeholder */
function slugify(n){ return n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function avatarImg(name){
  const src = `/headshots/${slugify(name)}.jpg`;
  // data URI gray circle fallback (so no broken image icon)
  const fallback = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
       <rect width="100%" height="100%" fill="#333"/>
       <text x="50%" y="52%" text-anchor="middle" font-family="Arial" font-size="64" fill="#999">•</text>
     </svg>`
  );
  return `<img class="avatar" src="${src}" onerror="this.onerror=null;this.src='${fallback}'" alt="">`;
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
  rows.sort((a,b) => (b.sales||0)-(a.sales||0) || (b.av||0)-(a.av||0) || (b.calls||0)-(a.calls||0));

  for (const a of rows){
    const name = normalizeName(a.display || a.name || '');
    const calls = a.calls ?? 0;
    const talkMin = Math.round(a.talk || 0);
    const sales = a.sales ?? 0;
    const av12 = a.av ?? 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="agent">${avatarImg(name)} <span>${name}</span></td>
      <td class="num">${fmt(calls)}</td>
      <td class="num">${fmt(talkMin)}</td>
      <td class="num">${fmt(sales)}</td>
      <td class="num money">${fmtMoney(av12)}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ========= SALE toast ========= */
let toastTimer = null;
function ensureToast(){
  if (!$('#sale-toast')){
    document.body.insertAdjacentHTML('beforeend', `<div id="sale-toast"></div>`);
  }
  return $('#sale-toast');
}
function showSaleToast(msg){
  const el = ensureToast();
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 6000);
}

/* Compare new board to previous map; show toast for increases */
function checkForNewSales(){
  const list = Array.isArray(board.agents) ? board.agents : [];
  for (const a of list){
    const name = normalizeName(a.display || a.name || '');
    const cur = a.sales || 0;
    const prev = prevSales.get(name) || 0;
    if (cur > prev){
      const inc = cur - prev;
      showSaleToast(`SALE! ${name} just logged ${inc} sale${inc>1?'s':''}.`);
    }
    prevSales.set(name, cur);
  }
}

/* ========= loop ========= */
async function tick(){
  try{
    await fetchBoard();
    render();
    checkForNewSales();
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
