/* FEW Dashboard — v7 (30s rotation, team totals, ET filters, sale pop) */
const DEBUG = new URLSearchParams(location.search).has('debug');
const log = (...a)=>{ if(DEBUG) console.log(...a); };

const DATA_REFRESH_MS = 30_000;   // refetch cadence
const ROTATION_MS     = 30_000;   // rotate views every 30s
const VIEWS = ['roster','av','sales']; // cycle order
let viewIdx = 0;

const ET_TZ = "America/New_York";
const fmtMoney = n => `$${Math.round(Number(n||0)).toLocaleString('en-US')}`;

function bust(url){ return url + (url.includes('?')?'&':'?') + 't=' + Date.now(); }
async function getJSON(url){ const r=await fetch(bust(url),{cache:'no-store'}); if(!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
function toET(d){ return new Date(new Date(d).toLocaleString('en-US',{timeZone:ET_TZ})); }
function initials(n=''){ return n.trim().split(/\s+/).map(s=>s[0]||'').join('').slice(0,2).toUpperCase(); }
function cleanDigits(s){ return String(s||'').replace(/\D/g,''); }
function readCallMin(r){ const sec = r.duration ?? r.callDuration ?? 0; return sec/60; }

function todayETRange(){
  const now = toET(new Date());
  const start = new Date(now); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate()+1);
  return [start,end];
}
function currentSalesWeekRangeET(){
  const now = toET(new Date());
  const day = now.getDay(); // 0..6
  const daysSinceFri = (day + 2) % 7; // Fri=0
  const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate()-daysSinceFri);
  const end = new Date(start); end.setDate(end.getDate()+7);
  return [start,end];
}

// ---------- RULE/TICKER ----------
function setRuleText(rulesObj){
  const list = Array.isArray(rulesObj) ? rulesObj : (Array.isArray(rulesObj?.rules)?rulesObj.rules:[]);
  if(!list.length) return;
  const idx = (new Date().getUTCDate()) % list.length;
  const text = String(list[idx]||'').replace(/Bonus\)\s*/,'Bonus: ');
  const tik = document.getElementById('ticker'); if(tik) tik.textContent = `RULE OF THE DAY — ${text}`;
  const sub = document.getElementById('principle'); if(sub) sub.textContent = text;
}

// ---------- STATE ----------
const STATE = {
  roster: [],                 // [{name,email,photo,phones[]}]
  phoneToKey: new Map(),      // phone -> agentKey
  callsByKey: new Map(),      // key -> {calls,talkMin}
  salesByKey: new Map(),      // key -> {salesAmt,av12x}
  team: { calls:0, talk:0, sales:0, av:0, unassigned:0 },
  seenSaleHashes: new Set()
};
const agentKey = a => (a.email || a.name || '').trim().toLowerCase();

// ---------- RENDER ----------
function setLabel(txt){ const el = document.getElementById('viewLabel'); if(el) el.textContent = txt; }
function setHead(cols){ const thead=document.getElementById('thead'); thead.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>`; }
function setBodyRows(rows){
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = rows.length ? rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${i>0?'num':''}">${c}</td>`).join('')}</tr>`).join('')
                                : `<tr><td style="padding:18px;color:#5c6c82;">No data</td></tr>`;
}
function avatarCell(a){
  const src = a.photo ? `/headshots/${a.photo}` : '';
  const img = src ? `<img class="avatar" src="${src}" onerror="this.remove();this.insertAdjacentHTML('beforebegin','<div class=&quot;avatar-fallback&quot;>${initials(a.name)}</div>')">`
                  : `<div class="avatar-fallback">${initials(a.name)}</div>`;
  return `<div class="agent">${img}<span>${a.name}</span></div>`;
}
function renderSummary(){
  document.getElementById('sumCalls').textContent      = STATE.team.calls.toLocaleString('en-US');
  document.getElementById('sumTalk').textContent       = Math.round(STATE.team.talk).toLocaleString('en-US');
  document.getElementById('sumSales').textContent      = fmtMoney(STATE.team.sales);
  document.getElementById('sumAV').textContent         = fmtMoney(STATE.team.av);
  document.getElementById('sumUnassigned').textContent = fmtMoney(STATE.team.unassigned);
}
function renderRoster(){
  setLabel('Today — Roster');
  setHead(['Agent','Calls','Talk Time (min)','Sales','Submitted AV (12×)']);
  const rows = STATE.roster.map(a=>{
    const k = agentKey(a);
    const c = STATE.callsByKey.get(k) || {calls:0,talkMin:0};
    const s = STATE.salesByKey.get(k) || {salesAmt:0,av12x:0};
    return [avatarCell(a), c.calls, Math.round(c.talkMin), fmtMoney(s.salesAmt), fmtMoney(s.av12x)];
  });
  setBodyRows(rows);
}
function renderLeaderboard(metric){
  const isAV = metric === 'av';
  const label = isAV ? 'This Week — Leaderboard (Submitted AV)' : 'This Week — Leaderboard (Sales)';
  setLabel(label);
  setHead(['Agent', isAV ? 'Submitted AV (12×)' : 'Sales']);
  const rows = STATE.roster.map(a=>{
    const k = agentKey(a);
    const s = STATE.salesByKey.get(k) || {salesAmt:0,av12x:0};
    const val = isAV ? s.av12x : s.salesAmt;
    return { a, val };
  }).sort((x,y)=> (y.val||0) - (x.val||0))
    .map(({a,val})=> [avatarCell(a), fmtMoney(val)]);
  setBodyRows(rows);
}
function renderCurrent(){
  renderSummary();
  const v = VIEWS[viewIdx];
  if (v === 'roster') renderRoster();
  else if (v === 'av') renderLeaderboard('av');
  else renderLeaderboard('sales');
}

// ---------- SALE POP ----------
function showSalePop({ name, product, amount }){
  const el = document.getElementById('salePop'); if(!el) return;
  el.textContent = `🔥 ${name || 'Team'} sold ${product || 'Product'} — ${fmtMoney(amount)}`;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 7000);
}

// ---------- LOADERS ----------
async function loadStatic(){
  const [rosterRaw, rules] = await Promise.all([
    getJSON('/headshots/roster.json'),
    getJSON('/rules.json').catch(()=>[])
  ]);
  const list = Array.isArray(rosterRaw?.agents) ? rosterRaw.agents : (Array.isArray(rosterRaw)?rosterRaw:[]);
  STATE.roster = list.map(a=>({ name:a.name, email:a.email||'', photo:a.photo||'', phones:Array.isArray(a.phones)?a.phones:[] }));
  STATE.phoneToKey = new Map();
  for (const a of STATE.roster){
    const key = agentKey(a);
    for (const raw of (a.phones||[])){
      const d10 = cleanDigits(raw);
      if (!d10) continue;
      STATE.phoneToKey.set(d10, key);                 // 10-digit match
      if (d10.length===10) STATE.phoneToKey.set('1'+d10, key); // also accept 11-digit with leading 1
    }
  }
  setRuleText(rules);
}

async function refreshCalls(){
  try{
    const payload = await getJSON('/api/calls_diag?days=7&limit=2000');
    const rows = (payload.records || payload.data || []).filter(Boolean);
    log('calls count', rows.length);

    const [start,end] = todayETRange();

    // TEAM TOTALS (no attribution needed)
    let teamCalls = 0, teamTalk = 0;
    for (const rec of rows){
      const when = toET((rec.callStartDate || rec.dateRecorded || '').replace(' ','T')+'Z');
      if (!(when >= start && when < end)) continue;
      teamCalls += 1;
      teamTalk  += readCallMin(rec);
    }
    STATE.team.calls = teamCalls;
    STATE.team.talk  = teamTalk;

    // PER-AGENT (best-effort attribution)
    const map = new Map();
    function bump(key, rec){
      const obj = map.get(key) || {calls:0,talkMin:0};
      obj.calls += 1;
      obj.talkMin += readCallMin(rec);
      map.set(key,obj);
    }
    for (const rec of rows){
      const when = toET((rec.callStartDate || rec.dateRecorded || '').replace(' ','T')+'Z');
      if (!(when >= start && when < end)) continue;
      const to = cleanDigits(rec.toPhoneNumber);
      const from = cleanDigits(rec.fromPhoneNumber);
      const candidates = [to, from, to.replace(/^1/,''), from.replace(/^1/,'')];
      const seen = new Set();
      for (const num of candidates){
        const key = STATE.phoneToKey.get(num);
        if (key && !seen.has(key)){ bump(key, rec); seen.add(key); }
      }
    }
    STATE.callsByKey = map;
  }catch(e){ log('calls error', e.message||e); }
}

async function refreshSales(){
  try{
    const payload = await getJSON('/api/sales_diag?days=30&limit=1000');
    const rows = (payload.records || payload.data || []).filter(Boolean);
    log('sales count', rows.length);

    const [start,end] = currentSalesWeekRangeET();

    // TEAM TOTALS
    let teamSalesAmt = 0, teamAV = 0;
    for (const r of rows){
      const soldAt = toET((r.dateSold||'').replace(' ','T')+'Z');
      if (!(soldAt >= start && soldAt < end)) continue;
      teamSalesAmt += Number(r.amount||0);
      teamAV      += Number(r.amount||0) * 12;
    }

    // PER-AGENT (ownerEmail/ownerName if available)
    const per = new Map();
    function bump(key, amt){
      const obj = per.get(key) || {salesAmt:0,av12x:0};
      obj.salesAmt += amt;
      obj.av12x    += amt*12;
      per.set(key,obj);
    }
    for (const r of rows){
      const soldAt = toET((r.dateSold||'').replace(' ','T')+'Z');
      if (!(soldAt >= start && soldAt < end)) continue;
      const key = (r.ownerEmail || r.ownerName || '').trim().toLowerCase();
      if (key) bump(key, Number(r.amount||0));
    }

    // Project onto roster keys
    const out = new Map();
    let attributed = 0;
    for (const a of STATE.roster){
      const k = agentKey(a);
      const v = per.get(k) || per.get((a.name||'').trim().toLowerCase()) || {salesAmt:0,av12x:0};
      attributed += v.salesAmt;
      out.set(k, v);
    }
    STATE.salesByKey = out;

    // Summary
    STATE.team.sales = teamSalesAmt;
    STATE.team.av    = teamAV;
    STATE.team.unassigned = Math.max(0, teamSalesAmt - attributed);

    // Sale pop (last record new)
    const last = rows[rows.length-1];
    if (last){
      const h = `${last.leadId}|${last.soldProductId}|${last.dateSold}`;
      if (!STATE.seenSaleHashes.has(h)){
        STATE.seenSaleHashes.add(h);
        showSalePop({ name: last.ownerName || last.ownerEmail || 'Team', product: last.soldProductName || 'Product', amount: last.amount || 0 });
      }
    }
  }catch(e){ log('sales error', e.message||e); }
}

// ---------- BOOT ----------
async function boot(){
  await loadStatic();
  renderCurrent();
  await Promise.all([refreshCalls(), refreshSales()]);
  renderCurrent();
  setInterval(async ()=>{ await refreshCalls(); await refreshSales(); renderCurrent(); }, DATA_REFRESH_MS);
  setInterval(()=>{ viewIdx = (viewIdx+1)%VIEWS.length; renderCurrent(); }, ROTATION_MS);
}

window.addEventListener('DOMContentLoaded', boot);
// ===== FEW: AV override + simple KPI trim (drop-in) =====

// Read /av_week_override.json and paint per-agent AV + Team AV tile
async function loadAVOverrideAndPaint() {
  try {
    const override = await (await fetch('/av_week_override.json', { cache: 'no-store' })).json();
    if (!override || typeof override !== 'object') return;

    // Crosswalk emails -> names via roster.json
    const roster = await (await fetch('/headshots/roster.json', { cache: 'no-store' })).json();
    const list = Array.isArray(roster) ? roster : (roster?.agents || []);
    const nameByEmail = new Map(list.map(r => [
      (r.email || '').trim().toLowerCase(),
      (r.name || '').trim()
    ]));

    const avByName = new Map(
      Object.entries(override).map(([email, av]) => [
        (nameByEmail.get((email || '').trim().toLowerCase()) || '').trim().toLowerCase(),
        Number(av) || 0
      ])
    );

    // Update table cells (expects first <td> is name, last <td data-col="av"> is AV)
    const tbody = document.querySelector('#tableBody') || document.querySelector('tbody');
    if (tbody) {
      for (const tr of Array.from(tbody.querySelectorAll('tr'))) {
        const nameCell = tr.querySelector('td');
        const avCell = tr.querySelector('td[data-col="av"]') || tr.lastElementChild;
        if (!nameCell || !avCell) continue;
        const rowName = nameCell.textContent.trim().toLowerCase();
        if (avByName.has(rowName)) {
          const av = avByName.get(rowName);
          avCell.textContent = `$${av.toLocaleString()}`;
        }
      }
    }

    // Update Team AV KPI value
    const teamTotal = [...avByName.values()].reduce((a, b) => a + b, 0);
    const avKpiValue =
      document.querySelector('#kpi-week-av') ||
      document.querySelector('[data-kpi="team-av"] .value') ||
      (() => {
        const tiles = Array.from(document.querySelectorAll('div,section,article'));
        for (const t of tiles) {
          if (/team av/i.test(t.textContent || '')) {
            const leafs = Array.from(t.querySelectorAll('*')).reverse();
            const node = leafs.find(n => /^\$?\d[\d,]*$/.test((n.textContent || '').trim()));
            if (node) return node;
          }
        }
        return null;
      })();

    if (avKpiValue) avKpiValue.textContent = `$${teamTotal.toLocaleString()}`;
  } catch (err) {
    console.warn('AV override not applied:', err);
  }
}

// Keep only three KPI tiles (Week Calls, Week Talk, Week AV) and fill calls/talk from /api/calls_diag
async function updateWeekKpisOnly() {
  // 1) Pull week calls/talk
  let weekCalls = 0, weekTalkMin = 0;
  try {
    const calls = await (await fetch('/api/calls_diag?days=7', { cache: 'no-store' })).json();
    const rows = calls?.records || calls?.data || calls || [];
    weekCalls = rows.length;
    weekTalkMin = Math.round(rows.reduce((s, r) => s + (Number(r.duration || r.talk_time_seconds || 0) / 60), 0));
  } catch {}

  // 2) Utility to find a tile by label text
  const all = Array.from(document.querySelectorAll('div,section,article'));
  const findTile = (label) => all.find(n => new RegExp(label, 'i').test(n.textContent || ''));

  // Hide extra tiles
  for (const label of ['This Week — Team Sales', 'Unassigned Sales']) {
    const el = findTile(label);
    if (el) el.style.display = 'none';
  }

  // Relabel/replace values on “Today — Team Calls/Talk” tiles to week versions
  const relabel = (oldLabelRegex, newLabel, value) => {
    const el = findTile(oldLabelRegex);
    if (!el) return;
    const labelNode = Array.from(el.querySelectorAll('*')).find(n => /today|team calls|team talk|\(min\)/i.test(n.textContent || ''));
    if (labelNode) labelNode.textContent = newLabel;
    const leafs = Array.from(el.querySelectorAll('*')).reverse();
    const valNode = leafs.find(n => /^\$?\d[\d,]*$/.test((n.textContent || '').trim()));
    if (valNode) valNode.textContent = String(value);
  };

  relabel(/Today\s*—\s*Team Calls/i, 'This Week — Team Calls', weekCalls);
  relabel(/Today\s*—\s*Team Talk/i,  'This Week — Team Talk (min)', weekTalkMin);

  // Ensure AV tile label says “This Week — Team AV (12x)”
  const avTile = findTile(/Team AV/i);
  if (avTile) {
    const labelNode = Array.from(avTile.querySelectorAll('*')).find(n => /team av/i.test(n.textContent || ''));
    if (labelNode) labelNode.textContent = 'This Week — Team AV (12x)';
  }
}

// Run once on load, then once per minute (no need to touch your existing refresh code)
window.addEventListener('load', () => {
  updateWeekKpisOnly();
  loadAVOverrideAndPaint();
});
setInterval(() => {
  updateWeekKpisOnly();
  loadAVOverrideAndPaint();
}, 60_000);

// ===== END FEW drop-in =====
