/* FEW Dashboard — Single File
   Boards (30s rotate):
     1. This Week — Roster        (Fri→Thu EST week, AV = amount * 12)
     2. YTD — Team                (ytd_av.json / ytd_total.json)
     3. Weekly Activity           (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, no weekly reset, 18 vendors only)
     5. PAR — Tracking
     6. Agent of the Week         (auto from weekly data, with YTD AV)

   Extras:
     - Center splash on new sale (60s)
     - Vendor donut + legend
     - Headshots w/ canonical names (Ajani → "a s", Fabricio → "f n")
     - Rules rotation every 12h
     - OE Countdown → Dec 15, 2025 11:59 PM EST
*/

(() => {
  // ---------- Endpoints ----------
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json'
  };

  // ---------- Tiny utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmtMoney = (n) => {
    const x = Number(n) || 0;
    return '$' + Math.round(x).toLocaleString();
  };

  const safe = (v, d) => (v === undefined || v === null || Number.isNaN(v) ? d : v);

  const norm = (s) =>
    String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Date in EST (no external libs)
  function nowInEST() {
    const now = new Date();
    // EST/EDT offset approximation via US Eastern
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    // Base offset -5; DST handled by Date for "America/New_York"
    const est = new Date(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York'
      }).format(new Date(utc))
    );
    // Above loses time; simpler: use Intl to get pieces:
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find(p => p.type === t)?.value || 0);
    return new Date(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second')
    );
  }

  // Parse sale dates as EST
  function parseSaleDateEST(raw) {
    if (!raw) return NaN;
    const s = String(raw).trim();
    if (/[+-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }
    const tEST = Date.parse(s + ' EST');
    if (Number.isFinite(tEST)) return tEST;
    const tET = Date.parse(s + ' ET');
    if (Number.isFinite(tET)) return tET;
    const tFallback = Date.parse(s);
    return Number.isFinite(tFallback) ? tFallback : NaN;
  }

  // Current sales week [start,end) in EST (Fri 00:00 → next Fri 00:00)
  function getWeekRangeEST() {
    const d = nowInEST();
    const day = d.getDay(); // 0=Sun..6=Sat
    // We want last Friday
    const diffToFriday = (day - 5 + 7) % 7; // days since Friday
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diffToFriday);
    const start = d.getTime();
    const end = start + 7 * 24 * 3600 * 1000;
    return { start, end };
  }

  // ---------- Allowed vendors (canonical labels only) ----------
  const VENDOR_SET = new Set([
    '$7.50',
    'TTM Nice!',
    'George Region Shared',
    'Red Media',
    'Blast/Bulk',
    'Exclusive JUMBO',
    'ABC',
    'Shared Jumbo',
    'VS Default',
    'RKA Website',
    'Redrip/Give up Purchased',
    'Lamy Dynasty Specials',
    'JUMBO Splits',
    'Exclusive 30s',
    'Positive Intent/Argos',
    'HotLine Bling',
    'Referral',
    'CG Exclusive'
  ]);

  // ---------- Canonical names ----------
  const NAME_ALIASES = new Map([
    ['fabricio a navarrete', 'f n'],
    ['fabricio navarrete', 'f n'],
    ['fabricio navarrete cervantes', 'f n'],
    ['fabricio cervantes', 'f n'],
    ['fabricio', 'f n'],
    ['fab', 'f n'],
    ['f n', 'f n'],
    ['ajani senior', 'a s'],
    ['ajani s', 'a s'],
    ['a s', 'a s'],
    // leave others as-is
  ]);

  const canonicalName = (name) =>
    NAME_ALIASES.get(norm(name)) || name;

  // ---------- Headshot resolver ----------
  function buildHeadshotResolver(roster) {
    const byName = new Map();
    const byEmail = new Map();

    const initialsOf = (full = '') =>
      full.trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

    const photoURL = (p) => {
      if (!p) return null;
      const s = String(p);
      return (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
    };

    for (const p of roster || []) {
      const cName = norm(canonicalName(p.name));
      const email = String(p.email || '').trim().toLowerCase();
      const photo = photoURL(p.photo);

      if (cName) byName.set(cName, photo);
      if (email) byEmail.set(email, photo);
    }

    return (agent = {}) => {
      const cName = norm(canonicalName(agent.name));
      const email = String(agent.email || '').trim().toLowerCase();
      const ini = initialsOf(agent.name || '');

      return (
        byName.get(cName) ||
        byEmail.get(email) ||
        null
      );
    };
  }

  // ---------- Layout anchors ----------
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');

  const cards = {
    calls: $('#sumCalls'),
    av: $('#sumSales'),
    deals: $('#sumTalk')
  };

  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // remove ticker if exists
  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  // ---------- Minimal CSS ----------
  (function injectCSS () {
    if (document.getElementById('few-inline-css')) return;
    const css = `
      .right{ text-align:right; font-variant-numeric:tabular-nums; }
      .vendor-flex{ display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
      .legend{ min-width:260px; }
      .legend-item{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid #1b2534; }
      .legend-item .label{ color:#cfd7e3; }
      .legend-item .val{ color:#9fb0c8; font-variant-numeric:tabular-nums; }
      .dot{ display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; vertical-align:middle; }
      .splash{
        position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
        background:linear-gradient(135deg,#a68109,#ffd34d);
        color:#1a1a1a; padding:22px 28px; border-radius:16px;
        box-shadow:0 18px 48px rgba(0,0,0,.45); z-index:9999; min-width:320px; text-align:center;
      }
      .splash .big{ font-size:24px; font-weight:900; line-height:1.2; }
      .splash .mid{ font-size:20px; font-weight:800; margin-top:6px; }
      .splash .sub{ font-size:12px; opacity:.85; margin-top:8px; }
    `;
    const tag = document.createElement('style');
    tag.id = 'few-inline-css';
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  // ---------- Splash on new sale ----------
  const seenLeadIds = new Set();

  function saleId(s) {
    return String(
      s.leadId ||
      s.id ||
      `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`
    );
  }

  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name || 'New Sale'}</div>
      <div class="mid">${fmtMoney(amount || 0)}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60_000);
  }

  // ---------- fetchJSON ----------
  async function fetchJSON(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON fail:', url, e.message || e);
      return null;
    }
  }

  // ---------- Cards: This Week — Calls / AV / Deals ----------
  function renderCards({ calls, sold }) {
    const callsVal = safe(calls?.team?.calls, 0);

    // We treat "Submitted AV" as AV12x (amount * 12)
    let avVal =
      safe(sold?.team?.totalAV12X ??
           sold?.team?.totalAv12x ??
           sold?.team?.total_av12x, 0);

    if (!avVal && Array.isArray(sold?.perAgent)) {
      avVal = sold.perAgent.reduce(
        (a, p) =>
          a +
          (Number(p.av12x || p.av12X || 0) ||
           (Number(p.amount || 0) * 12) ||
           0),
        0
      );
    }

    let dealsVal = safe(sold?.team?.totalSales, 0);
    if (!dealsVal && Array.isArray(sold?.perAgent)) {
      dealsVal = sold.perAgent.reduce(
        (a, p) => a + (Number(p.sales || p.deals || 0) || 0),
        0
      );
    }

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal || 0).toLocaleString();
  }

  // ---------- Helper: table row w/ avatar ----------
  function initialsOf(name = '') {
    return name
      .trim()
      .split(/\s+/)
      .map(w => (w[0] || '').toUpperCase())
      .join('');
  }

  function agentRowHTML({ name, cells, photoUrl }) {
    const initials = initialsOf(name);
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initials || '?'}</div>`;

    const tds = cells.map(c => `<td class="right">${c}</td>`).join('');

    return `
      <tr>
        <td style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
        ${tds}
      </tr>
    `;
  }

  // ---------- Board 1: This Week — Roster ----------
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');
    if (!headEl || !bodyEl) return;

    const { start, end } = getWeekRangeEST();
    const perAgent = new Map();

    // derive per-agent from allSales within week so it matches truth
    const all = Array.isArray(sold.allSales) ? sold.allSales : [];
    for (const s of all) {
      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const name = canonicalName(s.agent || s.writer || '');
      if (!name) continue;

      const key = norm(name);
      const cur = perAgent.get(key) || { name, av: 0, deals: 0 };
      const amt = Number(s.amount || 0) || 0;
      cur.av += amt * 12;
      cur.deals += 1;
      perAgent.set(key, cur);
    }

    const rows = [];

    for (const p of roster || []) {
      const key = norm(canonicalName(p.name));
      const stats = perAgent.get(key) || { av: 0, deals: 0 };
      rows.push({
        name: p.name,
        av: stats.av,
        deals: stats.deals,
        photo: resolvePhoto({ name: p.name, email: p.email })
      });
    }

    rows.sort((a, b) => b.av - a.av || b.deals - a.deals || a.name.localeCompare(b.name));

    headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Submitted AV</th>
        <th class="right">Deals</th>
      </tr>
    `;

    bodyEl.innerHTML = rows.map(r =>
      agentRowHTML({
        name: r.name,
        photoUrl: r.photo,
        cells: [fmtMoney(r.av), (r.deals || 0).toLocaleString()]
      })
    ).join('');
  }

  // ---------- Board 2: YTD — Team ----------
  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    if (!headEl || !bodyEl) return;

    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a, b) => (b.av || b.ytd_av || 0) - (a.av || a.ytd_av || 0));

    headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">YTD AV</th>
      </tr>
    `;

    const html = rows.map(p => {
      const name = p.name || '';
      const val = p.av || p.ytd_av || 0;
      return agentRowHTML({
        name,
        photoUrl: resolvePhoto({ name }),
        cells: [fmtMoney(val)]
      });
    }).join('');

    bodyEl.innerHTML = html + `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
      </tr>
    `;
  }

  // ---------- Board 3: Weekly Activity (calls_week_override.json) ----------
  async function renderWeeklyActivityBoard() {
    setView('Weekly Activity');
    if (!headEl || !bodyEl) return;

    headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Leads</th>
        <th class="right">Sold</th>
        <th class="right">Conv%</th>
        <th class="right">Calls</th>
        <th class="right">Talk min</th>
        <th class="right">Log min</th>
      </tr>
    `;

    try {
      const res = await fetch('/calls_week_override.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('no override');
      const json = await res.json();
      if (!json || typeof json !== 'object') throw new Error('bad json');

      // We need roster to map emails → names/headshots
      const rosterRes = await fetch(ENDPOINTS.roster, { cache: 'no-store' });
      const roster = rosterRes.ok ? await rosterRes.json() : [];
      const byEmail = new Map();
      for (const p of roster || []) {
        const em = String(p.email || '').trim().toLowerCase();
        if (em) byEmail.set(em, p);
      }

      const rows = [];
      for (const [email, stats] of Object.entries(json)) {
        const em = (email || '').toLowerCase();
        const r = byEmail.get(em);
        const name =
          (r && r.name) ||
          (stats.name) ||
          (email.split('@')[0].replace(/\./g, ' '));

        const leads = Number(stats.leads || 0);
        const sold  = Number(stats.sold  || 0);
        const calls = Number(stats.calls || 0);
        const talk  = Number(stats.talkMin    || stats.talkmin    || 0);
        const log   = Number(stats.loggedMin  || stats.logMin     || 0);
        const conv  = leads ? +(sold * 100 / leads).toFixed(1) : 0;

        rows.push({
          name,
          photo: r && r.photo ? (String(r.photo).startsWith('http') || String(r.photo).startsWith('/') ? r.photo : `/headshots/${r.photo}`) : null,
          leads, sold, conv, calls, talk, log
        });
      }

      rows.sort((a, b) => b.sold - a.sold || b.leads - a.leads || a.name.localeCompare(b.name));

      if (!rows.length) {
        bodyEl.innerHTML = `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No weekly activity override loaded.</td></tr>`;
        return;
      }

      bodyEl.innerHTML = rows.map(r =>
        agentRowHTML({
          name: r.name,
          photoUrl: r.photo,
          cells: [
            r.leads.toLocaleString(),
            r.sold.toLocaleString(),
            r.conv + '%',
            r.calls.toLocaleString(),
            r.talk.toLocaleString(),
            r.log.toLocaleString()
          ]
        })
      ).join('');
    } catch {
      bodyEl.innerHTML = `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No weekly activity override loaded.</td></tr>`;
    }
  }

  // ---------- Lead Vendors — Last 45 Days (fixed) ----------
  function summarizeVendors(allSales = [], roster = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;

    const rosterNames = new Set(
      (roster || []).map(p => norm(p.name))
    );

    const byName = new Map();

    for (const s of allSales || []) {
      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < cutoff) continue;

      // parse "Vendor - $xxx" → "Vendor"
      let raw = String(s.soldProductName || s.vendor || '').trim();
      if (!raw) continue;
      const dash = raw.indexOf(' - ');
      if (dash !== -1) raw = raw.slice(0, dash).trim();

      if (!VENDOR_SET.has(raw)) continue;

      // optional: ignore non-roster writers
      const agentName = norm(s.agent || s.writer || '');
      if (rosterNames.size && agentName && !rosterNames.has(agentName)) continue;

      const amount = Number(s.amount || s.av || 0) || 0;

      const row = byName.get(raw) || { name: raw, deals: 0, amount: 0 };
      row.deals += 1;
      row.amount += amount * 12; // keep AV12x consistent
      byName.set(raw, row);
    }

    const rows = [...byName.values()];
    const totalDeals = rows.reduce((a, r) => a + r.deals, 0) || 0;
    const totalAmount = rows.reduce((a, r) => a + r.amount, 0);

    for (const r of rows) {
      r.shareDeals = totalDeals ? +(r.deals * 100 / totalDeals).toFixed(1) : 0;
    }

    rows.sort((a, b) =>
      b.deals - a.deals ||
      b.amount - a.amount ||
      a.name.localeCompare(b.name)
    );

    return { rows, totalDeals, totalAmount };
  }

  function renderVendorsBoard({ allSales, roster }) {
    setView('Lead Vendors — Last 45 Days');
    if (!headEl || !bodyEl) return;

    const data = summarizeVendors(allSales, roster);
    const rows = data.rows;
    const totalDeals = data.totalDeals;

    if (!rows.length) {
      headEl.innerHTML = '';
      bodyEl.innerHTML =
        `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals (45d)</th>
        <th class="right">% of total</th>
      </tr>
    `;

    // donut svg
    const COLORS = [
      '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
    ];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
      return COLORS[h % COLORS.length];
    };

    const size = 240;
    const cx = size / 2;
    const cy = size / 2;
    const r  = size / 2 - 8;

    const polar = (cx,cy,r,a)=>[cx + r*Math.cos(a), cy + r*Math.sin(a)];
    const arcPath = (cx,cy,r,a0,a1) => {
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const [x0,y0] = polar(cx,cy,r,a0);
      const [x1,y1] = polar(cx,cy,r,a1);
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };

    let acc = -Math.PI/2;
    const arcs = rows.map(v => {
      const span = totalDeals ? 2*Math.PI*(v.deals/totalDeals) : 0;
      const d = arcPath(cx,cy,r,acc,acc+span);
      acc += span;
      return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="28" fill="none"></path>`;
    }).join('');

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-16}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals (45d)</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text>
      </svg>
    `;

    const legend = rows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.name)}"></span>
        <span class="label">${v.name}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.shareDeals}%</span>
      </div>
    `).join('');

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px">
          <div class="vendor-flex">
            ${svg}
            <div class="legend">${legend}</div>
          </div>
        </td>
      </tr>
    `;

    const rowsHTML = rows.map(v => `
      <tr>
        <td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.name)}">${v.shareDeals}%</td>
      </tr>
    `).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
      </tr>
    `;

    bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  // ---------- PAR — Tracking ----------
  function renderParBoard({ par }) {
    setView('PAR — Tracking');
    if (!headEl || !bodyEl) return;

    const pace = Number(par?.pace_target || 0) || 0;
    const agents = Array.isArray(par?.agents) ? par.agents : [];

    if (!agents.length) {
      headEl.innerHTML = '';
      bodyEl.innerHTML =
        `<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`;
      return;
    }

    headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Take Rate</th>
        <th class="right">Annual AV</th>
      </tr>
    `;

    bodyEl.innerHTML = `
      ${agents.map(a => `
        <tr>
          <td>${a.name}</td>
          <td class="right">${safe(a.take_rate,0)}%</td>
          <td class="right">${fmtMoney(safe(a.ytd_av,0))}</td>
        </tr>
      `).join('')}
      <tr class="total">
        <td><strong>PACE TO QUALIFY</strong></td>
        <td></td>
        <td class="right"><strong>${fmtMoney(pace)}</strong></td>
      </tr>
    `;
  }

  // ---------- Agent of the Week (auto) ----------
  async function renderAgentOfWeekBoard(data) {
    setView('Agent of the Week');

    if (!headEl || !bodyEl) return;

    const sold = data.sold || {};
    const perAgent = Array.isArray(sold.perAgent) ? sold.perAgent : [];

    headEl.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;

    if (!perAgent.length) {
      bodyEl.innerHTML =
        `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      return;
    }

    // pick top by AV12x
    let top = null;
    for (const row of perAgent) {
      const nameRaw = row.name || row.agent || '';
      const name = canonicalName(nameRaw);
      const av = Number(row.av12x || row.av12X || (row.amount || 0) * 12 || 0);
      const deals = Number(row.sales || row.deals || 0);

      if (!top || av > top.av) {
        top = { name, av, deals };
      }
    }

    if (!top) {
      bodyEl.innerHTML =
        `<tr><td style="padding:18px;color:#5c6c82;">No data.</td></tr>`;
      return;
    }

    // fetch YTD for that agent
    let ytdVal = 0;
    try {
      const r = await fetch(ENDPOINTS.ytdAv, { cache: 'no-store' });
      if (r.ok) {
        const json = await r.json();
        const list =
          Array.isArray(json)
            ? json
            : Array.isArray(json?.list)
              ? json.list
              : Array.isArray(json?.agents)
                ? json.agents
                : [];
        const hit = list.find(
          x =>
            norm(x.name) === norm(top.name) ||
            norm(canonicalName(x.name)) === norm(top.name)
        );
        if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0) || 0;
      }
    } catch { /* ignore */ }

    const photo = data.resolvePhoto({ name: top.name }) || null;
    const initials = initialsOf(top.name);

    bodyEl.innerHTML = `
      <tr>
        <td colspan="4" style="padding:26px 18px;">
          <div style="display:flex;align-items:center;gap:18px;">
            ${
              photo
                ? `<img src="${photo}" style="width:92px;height:92px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3);" />`
                : `<div style="width:92px;height:92px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;border:2px solid rgba(255,255,255,.3);">${initials}</div>`
            }
            <div style="flex:1;">
              <div style="font-size:22px;font-weight:700;">${top.name}</div>
              <div style="margin-top:4px;opacity:.9;">Weekly Submitted AV • ${fmtMoney(top.av)}</div>
              <div style="margin-top:2px;opacity:.7;">Deals this week • ${(top.deals || 0).toLocaleString()}</div>
              <div style="margin-top:2px;opacity:.7;">YTD AV • ${fmtMoney(ytdVal)}</div>
              <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.4);border-radius:999px;padding:4px 16px;font-size:12px;letter-spacing:.04em;">
                <span style="font-size:16px;">🥇</span>
                <span>Agent of the Week Belt</span>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // ---------- Rules rotation ----------
  function startRuleRotation(rulesJson) {
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list = Array.isArray(rulesJson?.rules)
      ? rulesJson.rules.filter(Boolean)
      : [];

    if (!list.length) {
      setBanner(base, '');
      return;
    }

    let i = 0;
    const apply = () => setBanner(base, list[i % list.length]);
    apply();
    setInterval(() => { i++; apply(); }, 12 * 60 * 60 * 1000);
  }

  // ---------- Live sale polling (for splash + vendors refresh) ----------
  function startLiveSalePolling(state) {
    const POLL_MS = 12_000;
    const cutoffMs = 45 * 24 * 3600 * 1000;

    async function tick() {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;

      const all = Array.isArray(sold.allSales) ? sold.allSales : [];
      const now = Date.now();
      const recent = [];

      for (const s of all) {
        const t = parseSaleDateEST(s.dateSold || s.date);
        if (!Number.isFinite(t) || now - t > cutoffMs) continue;
        recent.push(s);

        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          showSplash({
            name: s.agent || 'Agent',
            amount: (Number(s.amount || 0) || 0) * 12,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      renderVendorsBoard({ allSales: recent, roster: state.roster });
    }

    setInterval(tick, POLL_MS);
  }

  // ---------- Load all base data ----------
  async function loadAll() {
    const [
      rules,
      roster,
      calls,
      sold,
      ytdList,
      ytdTotalJson,
      par
    ] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);

    // seed seenLeadIds with existing 45d sales so splash only triggers on new
    const all = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const now = Date.now();
    for (const s of all) {
      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || now - t > 45 * 24 * 3600 * 1000) continue;
      seenLeadIds.add(saleId(s));
    }

    return {
      rules: rules || {},
      roster: roster || [],
      calls: calls || {},
      sold: sold || { team: {}, perAgent: [], allSales: [] },
      ytdList: Array.isArray(ytdList) ? ytdList : (ytdList?.list || []),
      ytdTotal: (ytdTotalJson && (ytdTotalJson.ytd_av_total || ytdTotalJson.total)) || 0,
      par: par || {},
      resolvePhoto
    };
  }

  // ---------- Board rotation ----------
  function startBoardRotation(state) {
    const order = [
      () => renderRosterBoard(state),
      () => renderYtdBoard(state),
      () => renderWeeklyActivityBoard(),
      () => renderVendorsBoard({ allSales: state.sold.allSales || [], roster: state.roster }),
      () => renderParBoard({ par: state.par }),
      () => renderAgentOfWeekBoard(state)
    ];

    let i = 0;
    const paint = () => order[i % order.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30_000);
  }

  // ---------- Boot ----------
  (async () => {
    try {
      const state = await loadAll();
      renderCards(state);
      startRuleRotation(state.rules);
      startBoardRotation(state);
      startLiveSalePolling(state);
    } catch (err) {
      console.error(err);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
      }
    }
  })();
})();

// ---------- OE Countdown (Dec 15, 2025 11:59 PM EST) ----------
(() => {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;

  const deadline = new Date('2025-12-15T23:59:59-05:00');
  const pad = (n) => String(n).padStart(2, '0');

  function update() {
    const now = new Date();
    const diff = deadline - now;
    if (diff <= 0) {
      timerEl.textContent = 'LIVE!';
      return;
    }
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);
    timerEl.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    requestAnimationFrame(() => setTimeout(update, 250));
  }

  update();
})();
