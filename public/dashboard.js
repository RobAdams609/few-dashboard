// ------------------------ Config ------------------------
const DEBUG = new URLSearchParams(location.search).has('debug');
const log = (...a)=>{ if(DEBUG) console.log('[DBG]', ...a); };

const DATA_REFRESH_MS = 30_000;        // poll Ringy every 30s
const ROTATION_MS     = 30_000;        // rotate views every 30s
const ET_TZ           = "America/New_York";
const VIEWS           = ['roster','av','sales']; // rotation order
let   viewIdx         = 0;

// ------------------------ Utils -------------------------
const $    = s=>document.querySelector(s);
const $$   = s=>Array.from(document.querySelectorAll(s));
const $mk  = (t,cls,html)=>{ const n=document.createElement(t); if(cls) n.className=cls; if(html!=null) n.innerHTML=html; return n; };

const fmtMoney = n => `$${Math.round(Number(n||0)).toLocaleString('en-US')}`;
const fmtInt   = n => Number(n||0).toLocaleString('en-US');

function bust(url){ return url + (url.includes('?')?'&':'?') + 't=' + Date.now(); }
async function getJSON(url){ const r=await fetch(bust(url),{cache:'no-store'}); if(!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }

function toET(d){ return new Date(new Date(d).toLocaleString('en-US',{timeZone:ET_TZ})); }
function initials(n=''){ return n.trim().split(/\s+/).map(s=>s[0]||'').join('').slice(0,2).toUpperCase(); }
function cleanDigits(s){ return String(s||'').replace(/\D/g,''); }
function readCallMin(r){ const sec = r.duration ?? r.callDuration ?? r.talk_time_seconds ?? 0; return Number(sec)/60; }

function todayETRange(){
  const now = toET(new Date());
  const start = new Date(now); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate()+1);
  return [start,end];
}

// Friday→Thursday “sales week”
function currentWeekRangeET(){
  const now = toET(new Date());
  const day = now.getDay();                   // Sun=0..Sat=6
  const daysSinceFri = (day + 2) % 7;         // Fri=0
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-daysSinceFri);
  const end   = new Date(start); end.setDate(end.getDate()+7);
  return [start,end];
}

// ------------------------ State -------------------------
const STATE = {
  roster: [],                    // [{name,email,photo,phones[]}]
  phoneToKey: new Map(),         // phone (10/11 digits) -> agentKey
  callsByKey: new Map(),         // agentKey -> {calls,talkMin}
  salesByKey: new Map(),         // agentKey -> {salesAmt,av12x}
  team: { calls:0, talk:0, av:0 },
  overrides: { av: null, calls: null },
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || '').trim().toLowerCase();

// ------------------------ Layout (self-contained) -------
function ensureUI(){
  // If you still have the old markup, hide extra KPI tiles we don't use
  for (const label of ['This Week — Team Sales','Unassigned Sales']) {
    $$( 'div,section,article' ).forEach(el => {
      if (new RegExp(label,'i').test(el.textContent||'')) el.style.display='none';
    });
  }

  // Build a simple app shell if missing
  let root = $('#few-root');
  if (!root) {
    root = $mk('div','few-root'); root.id='few-root';
    const wrap = $mk('div','few-wrap',`
      <div id="ticker" class="ticker"></div>
      <h1 class="title">THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT</h1>
      <h4 id="principle" class="sub"></h4>

      <div id="kpis" class="kpis"></div>

      <div class="label"><span id="viewLabel">Today — Roster</span></div>
      <table class="grid">
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>

      <div id="salePop" class="sale-pop"></div>
    `);
    root.appendChild(wrap);
    document.body.prepend(root);
  }
  // KPI tiles: only 3, recreate each time for safety
  const k = $('#kpis');
  if (k) {
    k.innerHTML =
      tile('kpi-calls','This Week — Team Calls','0') +
      tile('kpi-talk','This Week — Team Talk (min)','0') +
      tile('kpi-av','This Week — Team AV (12×)','$0');
  }
  function tile(id,label,val){
    return `<div class="kpi"><div class="label">${label}</div><div id="${id}" class="value">${val}</div></div>`;
  }
}

// ------------------------ Rules banner ------------------
async function setRuleText(){
  try {
    const rules = await getJSON('/rules.json').catch(()=>[]);
    const list = Array.isArray(rules?.rules) ? rules.rules : (Array.isArray(rules) ? rules : []);
    if (!list.length) return;
    const idx = (new Date().getUTCDate()) % list.length;
    const text = String(list[idx]||'').replace(/Bonus\)\s*/,'Bonus: ');
    const tik = $('#ticker');     if (tik) tik.textContent = `RULE OF THE DAY — ${text}`;
    const sub = $('#principle');  if (sub) sub.textContent = text;
  } catch {}
}

// ------------------------ Load static roster ------------
async function loadRoster(){
  const raw = await getJSON('/headshots/roster.json');
  const list = Array.isArray(raw?.agents) ? raw.agents : (Array.isArray(raw)?raw:[]);
  STATE.roster = list.map(a=>({
    name: a.name, email: (a.email||'').trim().toLowerCase(), photo: a.photo||'',
    phones: Array.isArray(a.phones) ? a.phones : []
  }));

  // Build phone map (both 10-digit and 11-digit with leading 1)
  STATE.phoneToKey = new Map();
  for (const a of STATE.roster){
    const key = agentKey(a);
    for (const p of a.phones||[]){
      const d = cleanDigits(p);
      if (!d) continue;
      STATE.phoneToKey.set(d, key);
      if (d.length===10) STATE.phoneToKey.set('1'+d, key);
    }
  }
}

// ------------------------ Overrides ---------------------
async function loadOverrides(){
  try { STATE.overrides.av = await getJSON('/av_week_override.json'); } catch { STATE.overrides.av = null; }
  try { STATE.overrides.calls = await getJSON('/calls_week_override.json'); } catch { STATE.overrides.calls = null; }
}

// ------------------------ KPI helpers -------------------
function renderKPIs(){
  $('#kpi-calls') && ($('#kpi-calls').textContent = fmtInt(STATE.team.calls));
  $('#kpi-talk')  && ($('#kpi-talk').textContent  = fmtInt(Math.round(STATE.team.talk)));
  $('#kpi-av')    && ($('#kpi-av').textContent    = fmtMoney(STATE.team.av));
}

// ------------------------ Render table ------------------
function setLabel(txt){ const el = $('#viewLabel'); if(el) el.textContent = txt; }
function setHead(cols){ const thead=$('#thead'); thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>`; }

function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : '';
  const img = src
    ? `<img class="avatar" src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
    : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${a.name}</span></div>`;
}

function renderRoster(){
  setLabel('Today — Roster');
  setHead(['Agent','Calls','Talk Time (min)','Sales','Submitted AV (12×)']);
  const tbody = $('#tbody');
  const rows = STATE.roster.map(a=>{
    const k = agentKey(a);
    const c = STATE.callsByKey.get(k) || {calls:0,talkMin:0};
    const s = STATE.salesByKey.get(k) || {salesAmt:0,av12x:0};
    return `<tr>
      <td>${avatarCell(a)}</td>
      <td class="num">${fmtInt(c.calls)}</td>
      <td class="num">${fmtInt(Math.round(c.talkMin))}</td>
      <td class="num">${fmtMoney(s.salesAmt)}</td>
      <td class="num">${fmtMoney(s.av12x)}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rows || `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

function renderLeaderboard(metric){
  const isAV = metric==='av';
  setLabel(isAV ? 'This Week — Leaderboard (Submitted AV)' : 'This Week — Leaderboard (Sales)');
  setHead(['Agent', isAV ? 'Submitted AV (12×)' : 'Sales']);
  const tbody = $('#tbody');
  const rows = STATE.roster.map(a=>{
    const k = agentKey(a);
    const s = STATE.salesByKey.get(k) || {salesAmt:0,av12x:0};
    return { a, val: isAV ? s.av12x : s.salesAmt };
  }).sort((x,y)=> (y.val||0)-(x.val||0))
    .map(({a,val})=> `<tr><td>${avatarCell(a)}</td><td class="num">${fmtMoney(val)}</td></tr>`)
    .join('');
  tbody.innerHTML = rows || `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}

function renderCurrent(){
  renderKPIs();
  const v = VIEWS[viewIdx];
  if (v==='roster') renderRoster();
  else if (v==='av') renderLeaderboard('av');
  else renderLeaderboard('sales');
}

// ------------------------ Sale toast --------------------
function showSalePop({ name, product, amount }){
  const el = $('#salePop'); if(!el) return;
  el.textContent = `🔥 ${name || 'Team'} sold ${product || 'Product'} — ${fmtMoney(amount)}`;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 7000);
}

// ------------------------ Data refresh ------------------
async function refreshCalls(){
  try{
    const rows = (await getJSON('/api/calls_diag?days=7&limit=2000')).records || [];
    const [weekStart, weekEnd] = currentWeekRangeET();
    const [todayStart, todayEnd] = todayETRange();

    // Team totals (week) — independent of attribution
    let wkCalls=0, wkTalk=0;
    for (const r of rows){
      const when = toET((r.callStartDate || r.dateRecorded || '').replace(' ','T')+'Z');
      if (when>=weekStart && when<weekEnd){ wkCalls += 1; wkTalk += readCallMin(r); }
    }

    // Apply overrides (by email) if present
    if (STATE.overrides.calls && typeof STATE.overrides.calls==='object'){
      // Recompute by summing only roster emails present in override
      let oc=0, ot=0;
      for (const a of STATE.roster){
        const o = STATE.overrides.calls[a.email];
        if (!o) continue;
        oc += Number(o.calls||0);
        ot += Number(o.talkMin||0);
      }
      if (oc>0 || ot>0){ wkCalls = oc; wkTalk = ot; }
    }

    STATE.team.calls = wkCalls;
    STATE.team.talk  = wkTalk;

    // Per-agent calls for **today** (roster table column)
    const map = new Map();
    function bump(key, rec){
      const obj = map.get(key) || {calls:0,talkMin:0};
      obj.calls  += 1;
      obj.talkMin+= readCallMin(rec);
      map.set(key,obj);
    }

    for (const r of rows){
      const when = toET((r.callStartDate || r.dateRecorded || '').replace(' ','T')+'Z');
      if (!(when>=todayStart && when<todayEnd)) continue;

      const to   = cleanDigits(r.toPhoneNumber);
      const from = cleanDigits(r.fromPhoneNumber);
      const candidates = [to,from, to.replace(/^1/,''), from.replace(/^1/,'')];
      const seen = new Set();
      for (const num of candidates){
        const key = STATE.phoneToKey.get(num);
        if (key && !seen.has(key)){ bump(key, r); seen.add(key); }
      }
    }
    STATE.callsByKey = map;
  }catch(e){ log('calls error', e); }
}

async function refreshSales(){
  try{
    const rows = (await getJSON('/api/sales_diag?days=30&limit=1000')).records || [];
    const [weekStart, weekEnd] = currentWeekRangeET();

    // Aggregate sales by owner (email/name), week filter
    const byKey = new Map();
    let teamSales=0, teamAV=0;
    for (const r of rows){
      const soldAt = toET((r.dateSold||'').replace(' ','T')+'Z');
      if (!(soldAt>=weekStart && soldAt<weekEnd)) continue;
      const amt = Number(r.amount||0);
      teamSales += amt;
      teamAV    += amt*12;

      const key = String((r.ownerEmail || r.ownerName || '')).trim().toLowerCase();
      if (!key) continue;
      const cur = byKey.get(key) || {salesAmt:0,av12x:0};
      cur.salesAmt += amt; cur.av12x += amt*12;
      byKey.set(key, cur);
    }

    // Project onto roster keys (name/email)
    const out = new Map();
    for (const a of STATE.roster){
      const k = agentKey(a);
      // prefer email match, else name match
      const v = byKey.get(a.email) || byKey.get((a.name||'').trim().toLowerCase()) || {salesAmt:0,av12x:0};
      out.set(k, v);
    }

    // Apply AV overrides (email→amount)
    if (STATE.overrides.av && typeof STATE.overrides.av==='object'){
      let sum = 0;
      for (const a of STATE.roster){
        const val = Number(STATE.overrides.av[a.email]||0);
        if (val>0){
          const k = agentKey(a);
          const cur = out.get(k) || {salesAmt:0,av12x:0};
          cur.av12x = val;   // override weekly AV
          out.set(k, cur);
          sum += val;
        }
      }
      teamAV = sum; // team tile mirrors override when provided
    }

    STATE.salesByKey = out;
    STATE.team.av    = teamAV;

    // Sale toast (new sale since load)
    const last = rows[rows.length-1];
    if (last){
      const h = `${last.leadId}|${last.soldProductId}|${last.dateSold}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        showSalePop({ name: last.ownerName || last.ownerEmail || 'Team',
                      product: last.soldProductName || 'Product',
                      amount: last.amount || 0 });
      }
    }
  }catch(e){ log('sales error', e); }
}

// ------------------------ Boot --------------------------
async function boot(){
  ensureUI();
  await Promise.all([setRuleText(), loadRoster(), loadOverrides()]);
  renderCurrent();

  await Promise.all([refreshCalls(), refreshSales()]);
  renderCurrent();

  setInterval(async ()=>{ await refreshCalls(); await refreshSales(); renderCurrent(); }, DATA_REFRESH_MS);
  setInterval(()=>{ viewIdx = (viewIdx+1) % VIEWS.length; renderCurrent(); }, ROTATION_MS);
}

window.addEventListener('DOMContentLoaded', boot);

// ------------------------ Minimal styles (optional) -----
// Uses your existing CSS; keep this tiny fallback if needed.
const FALLBACK_CSS = `
.few-root{padding:12px}
.title{margin:6px 0 2px;font-size:28px;text-align:center;color:#ffeaa7;text-shadow:0 0 12px #222}
.sub{margin:0 0 12px;text-align:center;color:#9fb}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 10px}
.kpi{background:#111a22;border:1px solid #24313f;border-radius:10px;padding:10px}
.kpi .label{font-size:12px;color:#9fb}
.kpi .value{font-size:22px;color:#ffeaa7}
.label{margin:10px 0 6px;color:#9fb}
.grid{width:100%;border-collapse:separate;border-spacing:0 6px}
.grid th,.grid td{padding:10px;background:#0e1720;border-bottom:1px solid #1f2a36}
.grid th{color:#9fb;text-align:left}
.grid td.num{text-align:right;color:#eaeef5}
.agent{display:flex;gap:8px;align-items:center}
.avatar{width:28px;height:28px;border-radius:50%;object-fit:cover}
.avatar-fallback{width:28px;height:28px;border-radius:50%;display:inline-grid;place-items:center;background:#223246;color:#bee}
.ticker{font-size:12px;color:#9fb;margin-bottom:4px}
.sale-pop{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;background:#072;color:#cfe;padding:10px 14px;border-radius:12px;opacity:0;pointer-events:none;transition:.3s}
.sale-pop.show{opacity:1}
`;
(() => {
  const s = document.createElement('style');
  s.textContent = FALLBACK_CSS;
  document.head.appendChild(s);
})();
