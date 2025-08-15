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
 "Bonus) When in doubt, dial."
];

let viewMode = 0; // 0 Calls, 1 Talk, 2 Sales, 3 AV
let board = { agents: [], rank: {} };

function fmt(n){ return (n||0).toLocaleString(); }
function fmtMoney(n){ return '$' + (Math.round(n||0)).toLocaleString(); }
function setPrinciple(){
  const idx = Math.floor(Date.now() / (3*60*60*1000)) % PRINCIPLES.length;
  document.getElementById('principle').textContent = PRINCIPLES[idx];
}

async function fetchBoard(){
  const res = await fetch('/api/board', { credentials: 'include' });
  if (!res.ok) throw new Error('board ' + res.status);
  board = await res.json();
}

function topBottomClasses(list, key){
  const sorted = [...list].sort((a,b)=> (b[key]||0)-(a[key]||0));
  const top = new Set(sorted.slice(0,3).map(a=>a.display));
  const bottom = new Set(sorted.slice(-1).map(a=>a.display));
  return { top, bottom };
}

function render(){
  const thead = document.querySelector('#table thead');
  const tbody = document.querySelector('#table tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const cols = [
    { key:'agent', label:'Agent', render:(a)=>`<div class="agent"><img src="${a.headshot}" alt=""><span>${a.display}</span></div>` },
    { key:'calls', label:'Calls', render:(a)=>fmt(a.calls) },
    { key:'talkTimeMins', label:'Talk Time (min)', render:(a)=>fmt(a.talkTimeMins) },
    { key:'salesCount', label:'Sales', render:(a)=>fmt(a.salesCount) },
    { key:'av', label:'AV (12×)', render:(a)=>fmtMoney(a.av) }
  ];

  const modeSort = [
    { key:'calls' }, { key:'talkTimeMins' }, { key:'salesCount' }, { key:'av' }
  ][viewMode].key;

  const rows = [...board.agents].sort((a,b)=> (b[modeSort]||0)-(a[modeSort]||0));

  const { top, bottom } = topBottomClasses(board.agents, modeSort);

  // header
  const trh = document.createElement('tr');
  cols.forEach(c => {
    const th = document.createElement('th'); th.textContent = c.label; trh.appendChild(th);
  });
  thead.appendChild(trh);

  // body
  rows.forEach(a => {
    const tr = document.createElement('tr');
    if (top.has(a.display)) tr.classList.add('rank-top');
    if (bottom.has(a.display)) tr.classList.add('rank-bottom');
    cols.forEach(c => {
      const td = document.createElement('td');
      td.innerHTML = c.render(a);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // ticker
  const deals = [...board.agents]
    .filter(a => (a.av||0) > 0)
    .sort((a,b)=> (b.av||0)-(a.av||0))
    .map(a => `${a.display} — ${fmtMoney(a.av)} AV`);
  document.getElementById('tickerContent').textContent = '  ' + deals.join('   •   ') + '  ';
}

async function tick(){
  try { await fetchBoard(); render(); } catch(e){ console.error(e); }
}

function rotateView(){
  viewMode = (viewMode + 1) % 4;
  render();
}

// Start
setPrinciple();
tick();
setInterval(tick, 20000);      // fetch every 20s
setInterval(rotateView, 30000); // rotate view every 30s
setInterval(setPrinciple, 60_000); // update principle hourly
