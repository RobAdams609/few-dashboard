/* FEW Dashboard — v4 (owner join + sale pop) */
const DEBUG = new URLSearchParams(location.search).has('debug');
const log = (...a) => { if (DEBUG) console.log(...a); };

const DATA_REFRESH_MS = 30_000;

function bust(url){ return url + (url.includes('?')?'&':'?') + 't=' + Date.now(); }
async function getJSON(url){ const r = await fetch(bust(url), {cache:'no-store'}); if(!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
function initials(n=''){ return n.trim().split(/\s+/).map(s=>s[0]||'').join('').slice(0,2).toUpperCase(); }
function normEmail(e=''){ return e.trim().toLowerCase(); }
function normName(n=''){ return n.trim().toLowerCase().replace(/\s+/g,' '); }

function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj) ? rulesObj :
               Array.isArray(rulesObj?.rules) ? rulesObj.rules : [];
  if(!list.length) return;
  const idx = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx] || '').replace(/Bonus\)\s*/,'Bonus: ');
  const tik = document.getElementById('ticker');
  const sub = document.getElementById('principle');
  if (tik) tik.textContent = `RULE OF THE DAY — ${text}`;
  if (sub) sub.textContent = text;
}

function renderRosterSkeleton(agents){
  const tbody = document.getElementById('rosterBody'); if(!tbody) return;
  tbody.innerHTML = '';
  agents.forEach(a => {
    const photo = a.photo ? `/headshots/${a.photo}` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="agent">
        ${photo ? `<img class="avatar" src="${photo}" onerror="this.remove();this.closest('td').insertAdjacentHTML('afterbegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
                : `<div class="avatar-fallback">${initials(a.name)}</div>`}
        <span>${a.name}</span>
      </td>
      <td class="num" data-col="calls">0</td>
      <td class="num" data-col="talk">0</td>
      <td class="num" data-col="sales">$0</td>
      <td class="num" data-col="av">$0</td>
    `;
    tbody.appendChild(tr);
  });
}

function showSalePop({ name, product, amount }){
  const el = document.getElementById('salePop'); if(!el) return;
  el.textContent = `🔥 ${name} sold ${product} — $${Math.round(Number(amount||0))}`;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 7000);
}

const STATE = {
  roster: [],
  salesByKey: new Map(),   // key: email|name → {sales, av}
  seenSaleHashes: new Set()
};

function keyFromOwner({ownerEmail, ownerName}){
  if (ownerEmail) return `e:${normEmail(ownerEmail)}`;
  if (ownerName)  return `n:${normName(ownerName)}`;
  return ''; // unknown owner
}

function addSales(records){
  let pops = [];
  for (const r of records){
    const h = `${r.leadId}|${r.soldProductId}|${r.dateSold}`;
    if (!STATE.seenSaleHashes.has(h)){
      STATE.seenSaleHashes.add(h);
      pops.push({ name: r.ownerName || r.ownerEmail || 'Unknown', product: r.soldProductName || 'Product', amount: r.amount || 0 });
    }
    const k = keyFromOwner(r); if(!k) continue;
    const obj = STATE.salesByKey.get(k) || { sales: 0, av: 0 };
    obj.sales += Number(r.amount || 0);
    obj.av += Number(r.amount || 0) * 12;  // “Submitted AV (12x)”
    STATE.salesByKey.set(k, obj);
  }
  if (pops.length){
    const last = pops[pops.length-1];
    showSalePop(last);
  }
}

function dataForAgent(agent){
  const keyEmail = `e:${normEmail(agent.email||'')}`;
  const keyName  = `n:${normName(agent.name||'')}`;
  const salesObj = STATE.salesByKey.get(keyEmail) || STATE.salesByKey.get(keyName) || { sales:0, av:0 };
  return {
    calls: 0, talk: 0,
    sales: salesObj.sales,
    av: salesObj.av
  };
}

function render(){
  const tbody = document.getElementById('rosterBody'); if(!tbody) return;
  tbody.querySelectorAll('tr').forEach((tr, i) => {
    const a = STATE.roster[i]; if(!a) return;
    const d = dataForAgent(a);
    const tds = tr.querySelectorAll('td.num');
    const [calls, talk, sales, av] = tds;
    calls.textContent = d.calls;
    talk.textContent = d.talk.toLocaleString('en-US', { maximumFractionDigits: 0 });
    sales.textContent = `$${Math.round(d.sales).toLocaleString('en-US')}`;
    av.textContent = `$${Math.round(d.av).toLocaleString('en-US')}`;
  });
}

async function loadAll(){
  // Roster + rules first (table visible immediately)
  const [rosterRaw, rules] = await Promise.all([
    getJSON('/headshots/roster.json'),
    getJSON('/rules.json').catch(()=>[])
  ]);
  const agents = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : Array.isArray(rosterRaw) ? rosterRaw : [];
  STATE.roster = agents.map(a => ({ name: a.name, email: a.email || '', photo: a.photo || '' }));
  log('roster size', STATE.roster.length);
  renderRosterSkeleton(STATE.roster);
  setRuleText(rules);

  // Ping health (small green dot in Console)
  getJSON('/api/health').then(()=>log('health ok')).catch(e=>log('health error', e));

  // First sales load + set interval
  await refreshSales();
  setInterval(refreshSales, DATA_REFRESH_MS);
}

async function refreshSales(){
  try{
    const payload = await getJSON('/api/sales_diag?days=30&limit=5000');
    const rows = payload?.records || payload?.data || (Array.isArray(payload)?payload:[]);
    log('sales count', rows.length);
    addSales(rows);
    render();
  }catch(e){
    log('sales error', e.message || e);
  }
}

window.addEventListener('DOMContentLoaded', loadAll);
