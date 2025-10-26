/* =========================================================
   FEW — Dashboard (single-file override)
   ========================================================= */

/* -----------------------------
   Config / Endpoints
------------------------------ */
const API = {
  TEAM_SOLD: '/api/team_sold',
  CALLS: '/api/calls_by_agent',
  VENDORS: '/api/sales_by_vendor',
  YTD_AV: '/boards/ytd_av.json',
  RULES: '/rules.json',
};

// Board rotation order (keys must match renderers below)
const BOARD_ORDER = ['roster', 'agent_of_week', 'vendors', 'ytd_team', 'par'];
const BOARD_DWELL_MS = 15000;

/* -----------------------------
   Utilities
------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmt = (n) =>
  (isFinite(n) ? Number(n) : 0).toLocaleString('en-US');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function initialsBadge(name, size = '') {
  const parts = (name || '').trim().split(/\s+/);
  const inits = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  return `<div class="avatar ${size} initials">${inits.toUpperCase()}</div>`;
}

/* -----------------------------
   Headshots mapping + helper
   (works across ALL boards)
------------------------------ */
// filenames must exist in /public/headshots
const HEADSHOT_SLUG = {
  'Philip Baxter': 'baxter.jpg',
  'Robert Adams': 'robert-adams.jpg',
  'Nathan Johnson': 'nathan.jpg',
  'Michelle Landis': 'michelle-landis.jpg',
  'Joseph Lipari': 'joseph.jpg',
  'Marie Saint Cyr': 'marie.jpg',
  'Eli Thermilus': 'eli.jpg',
  'Anna Gleason': 'anna.jpg',

  // Ajani aliases
  'Ajani Senior': 'a-s.jpg',
  'A S': 'a-s.jpg',

  // Fabricio aliases (F N is SAME person)
  'Fabricio Navarrete': 'f-n.jpg',
  'Fabricio Navarrete Cervantes': 'f-n.jpg',
  'F N': 'f-n.jpg',
  'FN': 'f-n.jpg',

  // Fraitzline variants
  'Fraitlzine Gustave': 'fraitzline.jpg',
  'F G': 'fraitzline.jpg',
  'Fraitlzine': 'fraitzline.jpg',
};

function headshotFor(name) {
  const file = HEADSHOT_SLUG[name?.trim()];
  return file ? `/headshots/${file}` : null;
}

/* -----------------------------
   Stable color by vendor
------------------------------ */
function colorForVendor(vendor) {
  let h = 0;
  for (let i = 0; i < vendor.length; i++) h = (h * 31 + vendor.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 55%)`;
}

/* -----------------------------
   Data loaders (cache-busting)
------------------------------ */
async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

let YTD_INDEX = null;
async function loadYTDIndex() {
  if (YTD_INDEX) return YTD_INDEX;
  try {
    const data = await getJSON(API.YTD_AV);
    YTD_INDEX = Array.isArray(data)
      ? Object.fromEntries(data.map((r) => [r.name.trim(), Number(r.ytd) || 0]))
      : Object.fromEntries(Object.entries(data).map(([k, v]) => [k.trim(), Number(v) || 0]));
  } catch {
    YTD_INDEX = {};
  }
  return YTD_INDEX;
}
async function ytdFor(name) {
  const idx = await loadYTDIndex();
  return idx[name?.trim()] || 0;
}

/* -----------------------------
   Header metrics + rules rotator
------------------------------ */
function setHeaderMetrics({ calls = 0, totalAV = 0, deals = 0 }) {
  const callsEl = $('#metric-calls'); // numbers in the 3 KPI tiles
  const avEl = $('#metric-av');
  const dealsEl = $('#metric-deals');
  if (callsEl) callsEl.textContent = fmt(calls);
  if (avEl) avEl.textContent = `$${fmt(totalAV)}`;
  if (dealsEl) dealsEl.textContent = fmt(deals);
}

// Rotate the small rule line under the big motto
async function startRuleRotation() {
  try {
    const data = await getJSON(API.RULES); // { rules: ["...", "..."] }
    const rules = Array.isArray(data.rules) ? data.rules : [];
    const spot = $('#rule-of-the-day'); // must exist once in the DOM
    if (!spot || rules.length === 0) return;
    let i = 0;
    function showNext() {
      spot.textContent = rules[i % rules.length];
      i++;
    }
    showNext();
    setInterval(showNext, 15000);
  } catch {
    /* leave as-is */
  }
}

/* -----------------------------
   Render: Roster (This Week)
------------------------------ */
async function renderRoster(container) {
  container.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const [sold, calls] = await Promise.all([
      getJSON(API.TEAM_SOLD), // {team:{totalSales,totalAmount,totalAV12x}, perAgent:[{name,sales,amount,av12x}]}
      getJSON(API.CALLS),     // {team:{calls,talkMin, ...}, perAgent:[...]}
    ]);

    // header metrics (weekly)
    setHeaderMetrics({
      calls: calls?.team?.calls || 0,
      totalAV: sold?.team?.totalAV12x || 0,
      deals: sold?.team?.totalSales || 0,
    });

    const rows = (sold.perAgent || []).map((a) => ({
      name: a.name,
      deals: Number(a.sales) || 0,
      av: Number(a.av12x) || 0,
    }));

    if (rows.length === 0) {
      container.innerHTML = `<div class="muted">No sales yet this week.</div>`;
      return;
    }

    const table = `
      <div class="table">
        <div class="tr th">
          <div class="td left">Agent</div>
          <div class="td right">Submitted AV</div>
          <div class="td right">Deals</div>
        </div>
        ${rows.map((r) => {
          const src = headshotFor(r.name);
          const avatar = src
            ? `<img class="avatar" src="${src}" alt="${r.name}">`
            : initialsBadge(r.name);
          return `
          <div class="tr">
            <div class="td left">
              <div class="agent-cell">
                ${avatar}
                <span>${r.name}</span>
              </div>
            </div>
            <div class="td right">$${fmt(r.av)}</div>
            <div class="td right">${fmt(r.deals)}</div>
          </div>`;
        }).join('')}
      </div>
    `;
    container.innerHTML = table;
  } catch {
    container.innerHTML = `<div class="error">Couldn’t load roster.</div>`;
  }
}

/* -----------------------------
   Render: Agent of the Week
------------------------------ */
async function renderAgentOfWeek(container) {
  container.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const sold = await getJSON(API.TEAM_SOLD);
    setHeaderMetrics({
      // keep weekly KPIs consistent while rotating boards
      calls: $('#metric-calls')?.textContent?.replaceAll(',', '') || 0,
      totalAV: sold?.team?.totalAV12x || 0,
      deals: sold?.team?.totalSales || 0,
    });

    const rows = (sold.perAgent || [])
      .map((a) => ({
        name: a.name,
        deals: Number(a.sales) || 0,
        av: Number(a.av12x) || 0,
      }))
      .sort((a, b) => b.av - a.av);

    const leader = rows[0];
    if (!leader) {
      container.innerHTML = `<div class="muted">No leader yet.</div>`;
      return;
    }
    const src = headshotFor(leader.name);
    const ytd = await ytdFor(leader.name);

    container.innerHTML = `
      <div class="leader-card">
        ${src ? `<img class="avatar xl" src="${src}" alt="${leader.name}">` : initialsBadge(leader.name, 'xl')}
        <div class="leader-meta">
          <div class="name">${leader.name}</div>
          <div class="chips">
            <span class="chip">${fmt(leader.deals)} deals (this week)</span>
            <span class="chip gold">$${fmt(leader.av)} submitted AV (this week)</span>
            <span class="chip">$${fmt(ytd)} YTD AV</span>
          </div>
        </div>
      </div>
    `;
  } catch {
    container.innerHTML = `<div class="error">Couldn’t load Agent of the Week.</div>`;
  }
}

/* -----------------------------
   Render: Vendors (45 days)
------------------------------ */
async function renderVendors(container) {
  container.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const [sold, vendors] = await Promise.all([
      getJSON(API.TEAM_SOLD),
      getJSON(API.VENDORS), // expect { breakdown: [{vendor, deals, pct}] }
    ]);
    setHeaderMetrics({
      calls: $('#metric-calls')?.textContent?.replaceAll(',', '') || 0,
      totalAV: sold?.team?.totalAV12x || 0,
      deals: sold?.team?.totalSales || 0,
    });

    const rows = (vendors.breakdown || [])
      .map((v) => ({ vendor: v.vendor, deals: Number(v.deals) || 0, pct: Number(v.pct) || 0 }))
      .filter((r) => r.deals > 0)
      .sort((a, b) => b.deals - a.deals);

    if (rows.length === 0) {
      container.innerHTML = `<div class="muted">No vendor data yet.</div>`;
      return;
    }

    const maxDeals = rows[0].deals;
    container.innerHTML = `
      <div class="vendor-legend">
        ${rows.map(({ vendor }) => `
          <span class="legend-item">
            <i class="dot" style="background:${colorForVendor(vendor)}"></i>${vendor}
          </span>
        `).join('')}
      </div>
      <div class="vendor-table">
        <div class="tr th">
          <div class="td left">Vendor</div>
          <div class="td">Deals</div>
          <div class="td right">% of total</div>
        </div>
        ${rows.map(({ vendor, deals, pct }) => `
          <div class="tr">
            <div class="td left">
              <span class="vendor-name"><i class="dot" style="background:${colorForVendor(vendor)}"></i>${vendor}</span>
            </div>
            <div class="td">
              <div class="bar">
                <div class="fill" style="width:${(deals / maxDeals) * 100}%; background:${colorForVendor(vendor)}"></div>
              </div>
              <span class="num">${fmt(deals)}</span>
            </div>
            <div class="td right">${pct}%</div>
          </div>
        `).join('')}
      </div>
      <div class="asof">As of ${new Date().toISOString().slice(0, 10)}</div>
    `;
  } catch {
    container.innerHTML = `<div class="error">Couldn’t load vendors.</div>`;
  }
}

/* -----------------------------
   Render: YTD Team
------------------------------ */
async function renderYTDTeam(container) {
  container.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const [sold] = await Promise.all([getJSON(API.TEAM_SOLD)]);
    setHeaderMetrics({
      calls: $('#metric-calls')?.textContent?.replaceAll(',', '') || 0,
      totalAV: sold?.team?.totalAV12x || 0,
      deals: sold?.team?.totalSales || 0,
    });

    const idx = await loadYTDIndex();
    const rows = Object.entries(idx)
      .map(([name, ytd]) => ({ name, ytd: Number(ytd) || 0 }))
      .sort((a, b) => b.ytd - a.ytd);

    if (rows.length === 0) {
      container.innerHTML = `<div class="muted">No YTD data.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="table">
        <div class="tr th">
          <div class="td left">Agent</div>
          <div class="td right">YTD AV</div>
        </div>
        ${rows.map((r) => {
          const src = headshotFor(r.name);
          const avatar = src ? `<img class="avatar" src="${src}" alt="${r.name}">` : initialsBadge(r.name);
          return `
            <div class="tr">
              <div class="td left">
                <div class="agent-cell">${avatar}<span>${r.name}</span></div>
              </div>
              <div class="td right">$${fmt(r.ytd)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch {
    container.innerHTML = `<div class="error">Couldn’t load YTD.</div>`;
  }
}

/* -----------------------------
   Render: PAR (manual override)
   Shows a table if provided; muted message otherwise
------------------------------ */
async function renderPAR(container) {
  container.innerHTML = `<div class="muted">No PAR list provided.</div>`;
  // If/when you add a JSON for PAR, fetch & render it here.
}

/* -----------------------------
   Router / Rotation
------------------------------ */
const RENDERERS = {
  roster: renderRoster,
  agent_of_week: renderAgentOfWeek,
  vendors: renderVendors,
  ytd_team: renderYTDTeam,
  par: renderPAR,
};

let rotateTimer;
async function renderBoard(key) {
  const container = $('#board'); // single mount point
  if (!container) return;
  const fn = RENDERERS[key];
  if (!fn) {
    container.innerHTML = `<div class="error">Unknown board: ${key}</div>`;
    return;
  }
  await fn(container);
}

async function startRotation() {
  let i = 0;
  clearInterval(rotateTimer);
  await renderBoard(BOARD_ORDER[i % BOARD_ORDER.length]);
  rotateTimer = setInterval(async () => {
    i++;
    await renderBoard(BOARD_ORDER[i % BOARD_ORDER.length]);
  }, BOARD_DWELL_MS);
}

/* -----------------------------
   Init
------------------------------ */
async function init() {
  // Make sure the KPI tiles exist in HTML:
  // <div id="metric-calls"></div> <div id="metric-av"></div> <div id="metric-deals"></div>
  // And a single board mount:
  // <section id="board"></section>
  // And the rotating rule line under the big motto:
  // <div id="rule-of-the-day"></div>

  startRuleRotation();
  startRotation();
}

document.addEventListener('DOMContentLoaded', init);
