/* =========================
   THE FEW — Single File Build
   No placeholders required.
   ========================= */

const API = {
  TEAM_SOLD: '/api/team_sold',
  CALLS: '/api/calls_by_agent',
  VENDORS: '/api/sales_by_vendor',
  RULES: '/rules.json',
  YTD: '/boards/ytd_av.json',
  HEADSHOTS: '/headshots/roster.json',
};

const ROTATION_MS = 15000;               // per-board time
const BOARDS = ['roster','agent','vendors','ytd','par'];

const $ = (sel,root=document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html!=null) n.innerHTML = html;
  return n;
};
const fmtMoney = n => `$${(Math.round(Number(n)||0)).toLocaleString()}`;
const esc = s => (s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

async function getJSON(url){
  const r = await fetch(url,{cache:'no-store'});
  if(!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

/* -------- Runtime state -------- */
let data = {
  sold:null, calls:null, vendors:[], rules:[], ytd:{}, headshots:{}
};

/* Headshot aliases (same person, multiple labels) */
const HEADSHOT_ALIASES = {
  "Philip Baxter": "baxter.jpg",
  "Fabricio Navarrete": "fabricio.jpg",
  "F N": "fabricio.jpg",
  "Nathan Johnson": "nathan.jpg",
  "Robert Adams": "robert-adams.jpg",
  "Ajani Senior": "ajani.jpg",
  "A S": "ajani.jpg",
};

function imgFor(name){
  const file =
    data.headshots[name] ||
    data.headshots[(name||'').trim().toUpperCase()] ||
    HEADSHOT_ALIASES[name] ||
    HEADSHOT_ALIASES[(name||'').trim().toUpperCase()];
  return file ? `/headshots/${file}` : `/headshots/roster.png`;
}

/* -------- Build the entire layout -------- */
function buildShell(){
  // Minimal base styles to guarantee layout even if CSS misses something.
  const baseCSS = `
  .wrap{max-width:1200px;margin:24px auto;padding:0 16px}
  .title{font-size:40px;font-weight:800;text-align:center;margin:0 0 8px}
  .rule{opacity:.9;text-align:center;margin:0 0 18px}
  .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:6px 0 18px}
  .metric{background:#121416;border-radius:12px;padding:16px;text-align:center}
  .metric .label{opacity:.8;font-size:12px;margin-bottom:6px}
  .metric .value{font-size:24px;font-weight:800}
  .board{background:#0f1113;border-radius:14px;padding:16px;min-height:380px}
  .board h2{margin:0 0 12px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:12px 10px;border-bottom:1px solid rgba(255,255,255,.06)}
  th{opacity:.8;text-align:left;font-weight:600}
  .num{text-align:right}
  .row{display:flex;align-items:center;gap:12px}
  .avatar{width:32px;height:32px;border-radius:50%;object-fit:cover}
  .avatar.lg{width:72px;height:72px}
  .agent-card{display:flex;align-items:center;gap:16px;background:#121416;border-radius:12px;padding:16px}
  .agent-name{font-size:20px;font-weight:700}
  .badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .badge{background:#1b1f24;border-radius:999px;padding:6px 10px;font-size:12px}
  .badge.gold{background:#2a2314;color:#f0c96a;font-weight:700}
  .empty{opacity:.6;padding:10px 0}
  .oe-wrap{position:fixed;left:0;right:0;bottom:18px;display:flex;justify-content:center;pointer-events:none}
  .oe{pointer-events:auto;min-width:320px;max-width:560px;background:linear-gradient(180deg,#0b1712,#0e1f18);border:1px solid #1f3a2e;border-radius:999px;padding:10px 18px;text-align:center}
  @media(max-width:860px){.metrics{grid-template-columns:1fr}}
  `;
  const style = el('style'); style.textContent = baseCSS; document.head.appendChild(style);

  const wrap = el('div','wrap');

  const header = el('header');
  header.append(
    el('h1','title','THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT'),
    el('div','rule', 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.')
  );

  const metrics = el('section','metrics');
  metrics.innerHTML = `
    <div class="metric"><div class="label">This Week — Team Calls</div><div class="value" data-kpi="calls">0</div></div>
    <div class="metric"><div class="label">This Week — Total Submitted AV</div><div class="value" data-kpi="av">$0</div></div>
    <div class="metric"><div class="label">This Week — Deals Submitted</div><div class="value" data-kpi="deals">0</div></div>
  `;

  const board = el('main','board'); // content gets replaced by JS

  const oeWrap = el('div','oe-wrap');
  oeWrap.appendChild(el('div','oe','OE Countdown'));

  wrap.append(header, metrics, board);
  document.body.append(wrap, oeWrap);

  return {ruleNode:$('.rule',header), kpi:metrics, board};
}

/* -------- Renderers -------- */
function setKPIs(){
  $('[data-kpi="calls"]').textContent = (data.calls?.team?.calls ?? 0);
  $('[data-kpi="av"]').textContent = fmtMoney(data.sold?.team?.totalAV12x ?? data.sold?.team?.totalAmount ?? 0);
  $('[data-kpi="deals"]').textContent = (data.sold?.team?.totalSales ?? 0);
}

function startRuleRotation(ruleNode){
  const list = Array.isArray(data.rules) && data.rules.length ? data.rules
    : ['Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.'];
  let i = 0;
  const tick = ()=>{ ruleNode.innerHTML = list[i % list.length]; i++; };
  tick();
  setInterval(tick, 8000);
}

function renderRoster(board){
  const rows = (data.sold?.perAgent ?? []).slice()
    .sort((a,b)=>(b.av12x??b.amount??0)-(a.av12x??a.amount??0));
  board.innerHTML = `
    <h2>This Week — Roster</h2>
    <table>
      <thead><tr><th>Agent</th><th class="num">Submitted AV</th><th class="num">Deals</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td><span class="row"><img class="avatar" src="${imgFor(r.name)}" alt=""> ${esc(r.name||'')}</span></td>
            <td class="num">${fmtMoney(r.av12x??r.amount??0)}</td>
            <td class="num">${r.sales ?? r.deals ?? 0}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderAgent(board){
  const rows = (data.sold?.perAgent ?? []).slice()
    .sort((a,b)=>(b.av12x??b.amount??0)-(a.av12x??a.amount??0));
  const lead = rows[0];
  const name = lead?.name || '—';
  const weekAV = lead ? (lead.av12x ?? lead.amount ?? 0) : 0;
  const ytdAV = data.ytd[name] ?? 0;

  board.innerHTML = `
    <h2>Agent of the Week</h2>
    <div class="agent-card">
      <img class="avatar lg" src="${imgFor(name)}" alt="">
      <div>
        <div class="agent-name">${esc(name)}</div>
        <div class="badges">
          <span class="badge">${lead?.sales ?? 0} deals (this week)</span>
          <span class="badge gold">${fmtMoney(weekAV)} submitted AV (this week)</span>
          <span class="badge">${fmtMoney(ytdAV)} YTD AV</span>
        </div>
      </div>
    </div>
  `;
}

function renderVendors(board){
  let rows = [];
  if (Array.isArray(data.vendors)) {
    rows = data.vendors.map(v=>({
      vendor: v.vendor || v.name || 'Unknown',
      deals: v.deals ?? v.count ?? 0,
      pct: Number(v.pct ?? v.percent ?? 0)
    }));
  } else if (data.vendors && typeof data.vendors === 'object') {
    rows = Object.entries(data.vendors).map(([k,v])=>({
      vendor:k, deals:v.deals ?? v.count ?? 0, pct:Number(v.pct ?? v.percent ?? 0)
    }));
  }
  rows.sort((a,b)=>(b.deals||0)-(a.deals||0));

  board.innerHTML = `
    <h2>Lead Vendors — Last 45 Days</h2>
    <table>
      <thead><tr><th>Vendor</th><th class="num">Deals</th><th class="num">% of total</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${esc(r.vendor)}</td>
            <td class="num">${r.deals}</td>
            <td class="num">${r.pct.toFixed(1)}%</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderYTD(board){
  const rows = Object.entries(data.ytd).map(([name,av])=>({name, av:Number(av)||0}))
    .sort((a,b)=>b.av-a.av);
  board.innerHTML = `
    <h2>YTD — Team</h2>
    <table>
      <thead><tr><th>Agent</th><th class="num">YTD AV</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td><span class="row"><img class="avatar" src="${imgFor(r.name)}" alt=""> ${esc(r.name)}</span></td>
            <td class="num">${fmtMoney(r.av)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderPAR(board){
  board.innerHTML = `<h2>PAR — On Track</h2><div class="empty">No PAR list provided.</div>`;
}

/* -------- Rotation -------- */
let rot = 0, timer=null;
function render(boardEl){
  const k = BOARDS[rot % BOARDS.length];
  if (k==='roster') renderRoster(boardEl);
  else if (k==='agent') renderAgent(boardEl);
  else if (k==='vendors') renderVendors(boardEl);
  else if (k==='ytd') renderYTD(boardEl);
  else renderPAR(boardEl);
}
function startRotation(boardEl){
  render(boardEl);
  timer = setInterval(()=>{ rot++; render(boardEl); }, ROTATION_MS);
}

/* -------- Boot -------- */
(async function boot(){
  const {ruleNode, kpi, board} = buildShell();

  // fetch all data in parallel
  const [sold,calls,vendors,rules,ytd,roster] = await Promise.all([
    getJSON(API.TEAM_SOLD).catch(()=>({team:{totalSales:0,totalAmount:0,totalAV12x:0},perAgent:[]})),
    getJSON(API.CALLS).catch(()=>({team:{calls:0}})),
    getJSON(API.VENDORS).catch(()=>([])),
    getJSON(API.RULES).catch(()=>([])),
    getJSON(API.YTD).catch(()=>({})),
    getJSON(API.HEADSHOTS).catch(()=>({}))
  ]);

  data.sold = sold;
  data.calls = calls;
  data.vendors = vendors;
  data.rules = rules;
  data.ytd = ytd || {};
  data.headshots = {...roster, ...HEADSHOT_ALIASES};

  setKPIs();
  startRuleRotation(ruleNode);
  startRotation(board);
})().catch(err=>{
  console.error(err);
  const fallback = el('div','wrap'); 
  fallback.innerHTML = `<div class="board"><div class="empty">Dashboard failed to load.</div></div>`;
  document.body.appendChild(fallback);
});
