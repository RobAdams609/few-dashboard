/* public/dashboard.js  — full replacement
   - Always shows every person in /headshots/roster.json
   - Merges today's stats from /api/board
   - Excludes anyone in EXCLUDE_EMAILS from ALL UI reporting
   - Keeps your Rule-of-the-Day banner & hero header
*/

/* ------------------- Config ------------------- */

// Anyone in this set will be hidden from rows, ranks and totals
const EXCLUDE_EMAILS = new Set([
  'abigailaustin.healthadvisor@gmail.com'
]);

// Your 10 rules + bonus (used in the ticker and subheader)
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
  "Bonus) You are who you hunt with. Everybody wants to eat, but FEW will hunt."
];

/* -------------- Helpers / formatting ---------- */

const $ = (sel) => document.querySelector(sel);

const toMoney = (n) =>
  (n ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const toInt = (n) => (n ? Math.round(n) : 0);

const todayUtcRange = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
};

const ruleIndexForToday = () => Math.floor(Date.now() / (24*60*60*1000)) % PRINCIPLES.length;

/* -------------------- Data fetch -------------------- */

async function getRoster() {
  const res = await fetch('/headshots/roster.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('roster.json not found');
  const list = await res.json();
  // normalize emails and drop excluded
  return list
    .map(r => ({ ...r, email: String(r.email || '').toLowerCase() }))
    .filter(r => !EXCLUDE_EMAILS.has(r.email));
}

async function getBoard() {
  // Your Netlify function for “today”
  const res = await fetch('/api/board', { credentials: 'include' });
  if (!res.ok) throw new Error('board api failed');
  const data = await res.json();

  // Normalize and remove excluded from API payload we’ll use for joins & totals
  const agents = (data.agents || [])
    .map(a => ({ ...a, email: String(a.email || '').toLowerCase() }))
    .filter(a => !EXCLUDE_EMAILS.has(a.email));

  return { ...data, agents };
}

/* -------------------- Render -------------------- */

function setHeroAndTicker() {
  // Big hero header already exists in your HTML/CSS; we only set texts
  const rule = PRINCIPLES[ruleIndexForToday()];
  const banner = $('#rule-ticker-text');
  const sub = $('#principle');

  if (banner) banner.textContent = `RULE OF THE DAY —  ${rule}`;
  if (sub) sub.textContent = rule;
}

function buildRows(roster, board) {
  // Map today’s stats by email for quick join
  const byEmail = new Map(
    (board.agents || []).map(a => [
      String(a.email || '').toLowerCase(),
      {
        calls: toInt(a.calls),
        talk: toInt(a.talk),       // expect minutes from your API (adjust if seconds)
        sales: toInt(a.sales),
        av: toInt(a.av)            // expect 12x AV number; format later
      }
    ])
  );

  // Always list the roster, falling back to zeros if no activity today
  return roster.map(p => {
    const stats = byEmail.get(p.email) || { calls: 0, talk: 0, sales: 0, av: 0 };
    return {
      name: p.name,
      email: p.email,
      photo: p.photo ? `/headshots/${p.photo}` : null,
      ...stats
    };
  });
}

function renderTable(rows) {
  const tbody = document.querySelector('#table tbody');
  if (!tbody) return;

  // Clear
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  // Simple alphabetical – you can sort by calls/sales/AV if you prefer
  rows.sort((a, b) => a.name.localeCompare(b.name));

  for (const r of rows) {
    const tr = document.createElement('tr');

    // Agent cell with headshot
    const agentTd = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'agent';
    if (r.photo) {
      const img = document.createElement('img');
      img.src = r.photo;
      img.alt = r.name;
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else {
      // fallback circle with initials
      const init = document.createElement('div');
      init.className = 'initials';
      init.textContent = r.name.split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
      wrap.appendChild(init);
    }
    const nameSpan = document.createElement('span');
    nameSpan.textContent = r.name;
    wrap.appendChild(nameSpan);
    agentTd.appendChild(wrap);

    const callsTd = document.createElement('td'); callsTd.textContent = r.calls;
    const talkTd  = document.createElement('td'); talkTd.textContent  = r.talk;
    const salesTd = document.createElement('td'); salesTd.textContent = r.sales;
    const avTd    = document.createElement('td'); avTd.textContent    = toMoney(r.av);

    tr.append(agentTd, callsTd, talkTd, salesTd, avTd);
    tbody.appendChild(tr);
  }
}

function renderTotals(rows) {
  // (Optional) If you show totals anywhere, compute them from the filtered rows.
  // Example: document.getElementById('totals-calls').textContent = rows.reduce((s,r)=>s+r.calls,0);
}

/* -------------------- Live loop -------------------- */

async function refresh() {
  try {
    const [roster, board] = await Promise.all([getRoster(), getBoard()]);
    const rows = buildRows(roster, board);
    renderTable(rows);
    renderTotals(rows);
  } catch (e) {
    console.error(e);
  }
}

function start() {
  setHeroAndTicker();
  refresh();                      // initial
  setInterval(refresh, 20_000);   // poll every 20s
  // rotate rule once an hour
  setInterval(setHeroAndTicker, 60_000);
}

document.addEventListener('DOMContentLoaded', start);
