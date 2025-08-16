/* -----------------------------------------------------------
   FEW Dashboard — single-file client logic
   - Loads Rule-of-the-Day from /rules.json (your file)
   - Loads roster & headshots from /headshots/roster.json
   - Loads today's metrics from /api/board (if available)
   - Always shows roster; fills zeros when no stats
   - Rotates views every 45s: Roster → Sales LB → AV LB
----------------------------------------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const el = {
  ticker: $('#rule-ticker-text'),
  label:  $('#viewLabel'),
  thead:  $('#table thead'),
  tbody:  $('#table tbody'),
};

const COLS = {
  agent:  $('.col-agent'),
  calls:  $('.col-calls'),
  talk:   $('.col-talk'),
  sales:  $('.col-sales'),
  av:     $('.col-av'),
};

let VIEW = 0; // 0: roster, 1: sales leaderboard, 2: AV leaderboard
const ROTATE_MS = 45_000;

let roster = [];   // [{name,email,photo}]
let today = [];    // [{name,display,calls,talkMin,sales,av}]
let merged = [];   // roster + today merged

/* ---------- Utilities ---------- */

// ET-based day index (for "daily" rule selection)
function etDayIndex() {
  // y-m-d string in America/New_York, then divide epoch days
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York' })
                  .format(new Date()); // "YYYY-MM-DD"
  return Math.floor(Date.parse(ymd) / 86400000);
}

function money(n){
  const v = Math.round(n||0);
  return '$' + v.toLocaleString();
}
function mins(n){
  return Math.round(n||0).toLocaleString();
}

// Safe fetch JSON
async function getJSON(path, opts={}){
  const res = await fetch(path, { credentials:'include', ...opts });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

/* ---------- Data loaders ---------- */

async function loadRulesTicker(){
  try{
    const data = await getJSON('/rules.json');
    const rules = Array.isArray(data) ? data : (data.rules || []);
    if (rules.length){
      const idx = etDayIndex() % rules.length;
      el.ticker.textContent = `RULE OF THE DAY — ${rules[idx]}`;
    } else {
      el.ticker.textContent = 'RULE OF THE DAY — (no rules found)';
    }
  }catch{
    el.ticker.textContent = 'RULE OF THE DAY — (failed to load rules.json)';
  }
}

async function loadRoster(){
  try{
    const data = await getJSON('/headshots/roster.json');
    // Expect { agents: [ {name,email,photo} ] }
    const list = Array.isArray(data) ? data : (data.agents || []);
    roster = list.map(a => ({
      name: a.name || '',
      email: (a.email||'').toLowerCase(),
      photo: a.photo || null
    }));
  }catch{
    roster = [];
  }
}

async function loadTodayBoard(){
  try{
    const b = await getJSON('/api/board');
    // Expect { agents: [ { display, email?, calls, talkMin, sales, av } ] }
    const list = (b && b.agents) ? b.agents : [];
    today = list.map(a => ({
      name: a.display || a.name || '',
      email: (a.email||'').toLowerCase(),
      calls: a.calls || 0,
      talk:  a.talkMin || a.talk || 0,
      sales: a.sales || 0,
      av:    a.av || 0
    }));
  }catch{
    today = [];
  }
}

/* ---------- Merge + Render ---------- */

function initials(name=''){
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = (parts[0]?.[0]||'') + (parts[1]?.[0]||'');
  return chars.toUpperCase();
}

function rowHTML(a, show){
  // show = { calls:true/false, talk:true/false, sales:true/false, av:true/false }
  return `
    <tr>
      <td class="col-agent">
        <div class="agent">
          <span class="avatar">${a.photo ? `<img src="/headshots/${a.photo}" alt="">` : initials(a.name)}</span>
          <span>${a.name}</span>
        </div>
      </td>
      <td class="col-calls ${show.calls ? '' : 'hide'}">${(a.calls||0).toLocaleString()}</td>
      <td class="col-talk ${show.talk ? '' : 'hide'}">${mins(a.talk)}</td>
      <td class="col-sales ${show.sales ? '' : 'hide'}">${(a.sales||0).toLocaleString()}</td>
      <td class="col-av ${show.av ? '' : 'hide'}">${money((a.av||0))}</td>
    </tr>
  `;
}

function applyHeaderVisibility(show){
  COLS.calls.classList.toggle('hide', !show.calls);
  COLS.talk.classList.toggle('hide', !show.talk);
  COLS.sales.classList.toggle('hide', !show.sales);
  COLS.av.classList.toggle('hide', !show.av);
}

function render(){
  let show;
  let rows = [];

  if (VIEW === 0){
    el.label.textContent = 'Today — Roster';
    show = {calls:true, talk:true, sales:true, av:true};
    // roster order; merged keeps zeros if no stat
    rows = merged.map(a => rowHTML(a, show));
  } else if (VIEW === 1){
    el.label.textContent = 'Today — Leaderboard (Sales)';
    show = {calls:false, talk:false, sales:true, av:false};
    rows = [...merged]
      .sort((a,b)=>(b.sales||0)-(a.sales||0))
      .map(a => rowHTML(a, show));
  } else {
    el.label.textContent = 'Today — Leaderboard (Submitted AV)';
    show = {calls:false, talk:false, sales:false, av:true};
    rows = [...merged]
      .sort((a,b)=>(b.av||0)-(a.av||0))
      .map(a => rowHTML(a, show));
  }

  applyHeaderVisibility(show);
  el.tbody.innerHTML = rows.join('');
}

function mergeRosterAndToday(){
  const byEmail = new Map();
  for (const t of today){
    const key = (t.email||t.name||'').toLowerCase();
    byEmail.set(key, t);
  }
  merged = roster.map(r => {
    const key = (r.email||r.name||'').toLowerCase();
    const t = byEmail.get(key);
    return {
      name: r.name,
      email: r.email,
      photo: r.photo,
      calls: t?.calls || 0,
      talk:  t?.talk  || 0,
      sales: t?.sales || 0,
      av:    t?.av    || 0,
    };
  });
}

/* ---------- Rotation ---------- */

function startRotation(){
  setInterval(() => {
    VIEW = (VIEW + 1) % 3; // 0 → 1 → 2 → 0
    render();
  }, ROTATE_MS);
}

/* ---------- Boot ---------- */

(async function boot(){
  await Promise.all([
    loadRulesTicker(),
    loadRoster()
  ]);
  await loadTodayBoard();
  mergeRosterAndToday();
  render();
  startRotation();

  // refresh stats every 60s (lightweight)
  setInterval(async () => {
    await loadTodayBoard();
    mergeRosterAndToday();
    render();
  }, 60_000);
})();
