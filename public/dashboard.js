/* FEW Dashboard — Single File (45d rolling vendors, EST weeks, OE countdown)
   Boards (30s rotate):
     1. This Week — Roster
     2. YTD — Team
     3. Weekly Activity (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, no weekly reset)
     5. PAR — Tracking
     6. Agent of the Week (auto from sales week)

   Extras:
     - Center splash on new sale (60s)
     - Vendor donut + legend
     - Headshots w/ canonical names (Ajani → "a s", Fabricio → "f n")
     - Rules rotation every 12h: “THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT”
     - OE Countdown → Dec 15, 2025 11:59 PM EST, shows “LIVE!” after
*/

(() => {
  // --------- Endpoints
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json'
  };

  // --------- Tiny utils
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
  const safe = (v, d) => (v === undefined || v === null ? d : v);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const fetchJSON = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON fail:', url, e.message || e);
      return null;
    }
  };

  // --------- Time helpers (EST)

  function nowInEST() {
    const s = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(s);
  }

  // Fri→Thu EST sales week [start,end)
  function getWeekRangeEST() {
    const d = nowInEST();
    const dow = d.getDay(); // 0=Sun..6=Sat
    const diffSinceFri = (dow - 5 + 7) % 7;
    const start = new Date(d);
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - diffSinceFri);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.getTime(), end: end.getTime() };
  }

  // Parse any sale date as EST-based timestamp
  function parseSaleDateEST(raw) {
    if (!raw) return NaN;
    const s = String(raw).trim();
    if (/[+-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }
    const t1 = Date.parse(s + ' EST');
    if (Number.isFinite(t1)) return t1;
    const t2 = Date.parse(s + ' ET');
    if (Number.isFinite(t2)) return t2;
    const t3 = Date.parse(s);
    return Number.isFinite(t3) ? t3 : NaN;
  }

  // --------- Allowed vendors — 18 total
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

  // --------- Canonical names
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
    ['marie saint cyr', 'marie saint cyr'],
    ['eli thermilus', 'eli thermilus'],
    ['philip baxter', 'philip baxter'],
    ['robert adams', 'robert adams'],
    ['nathan johnson', 'nathan johnson'],
    ['anna gleason', 'anna'],
    ['sebastian beltran', 'sebastian beltran'],
    ['michelle landis', 'michelle landis'],
    ['elizabeth snyder', 'elizabeth snyder'],
    ['fraitzline healthadvisor', 'fraitzline healthadvisor']
  ]);
  const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  // --------- Headshot resolver
  function buildHeadshotResolver(roster) {
    const byName = new Map(), byEmail = new Map(), byPhone = new Map(), byInitial = new Map();

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

      if (Array.isArray(p.phones)) {
        for (const raw of p.phones) {
          const phone = String(raw || '').replace(/\D+/g, '');
          if (phone) byPhone.set(phone, photo);
        }
      }

      const ini = initialsOf(p.name || '');
      if (ini) byInitial.set(ini, photo);
    }

    return (agent = {}) => {
      const cName = norm(canonicalName(agent.name));
      const email = String(agent.email || '').trim().toLowerCase();
      const phone = String(agent.phone || '').replace(/\D+/g, '');
      const ini = (agent.name || '').split(/\s+/)
        .map(w => (w[0] || '').toUpperCase()).join('');
      return (
        byName.get(cName) ??
        byEmail.get(email) ??
        (phone ? byPhone.get(phone) : null) ??
        byInitial.get(ini) ??
        null
      );
    };
  }

  // --------- Layout anchors
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const cards = {
    calls: $('#sumCalls'),
    av:    $('#sumSales'),
    deals: $('#sumTalk')
  };
  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // --------- Inject CSS
  (function injectCSS(){
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

  // --------- Splash
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name}</div>
      <div class="mid">${fmtMoney(amount)}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60_000);
  }

  const seenLeadIds = new Set();
  const saleId = (s) =>
    String(s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`);

  // --------- Cards (This Week — top row)
  function renderCardsFromWeek(allSales) {
    const { start, end } = getWeekRangeEST();
    let calls = 0; // if you want weekly calls from /api/calls_by_agent you can wire here
    let deals = 0;
    let av = 0;

    for (const s of allSales || []) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < start || t >= end) continue;
      deals += 1;
      const amt = Number(s.av12x || s.av12X || s.amount || 0);
      av += amt;
    }

    if (cards.calls) cards.calls.textContent = (calls || 0).toLocaleString();
    if (cards.deals) cards.deals.textContent = deals.toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(av);
  }

  // --------- Table row helper
  function agentRowHTML({ name, right1, right2, photoUrl, initial }) {
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initial || '?'}</div>`;
    return `
      <tr>
        <td style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
        <td class="right">${right1}</td>
        ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
      </tr>
    `;
  }

  // --------- Vendors aggregation (STRICT rolling 45d, EST, from allSales)
  function summarizeVendors45d(allSales = []) {
    const cutoff = nowInEST().getTime() - 45 * 24 * 3600 * 1000;
    const by = new Map();
    let totalDeals = 0;

    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < cutoff) continue;

      const raw = String(s.soldProductName || '').trim();
      if (!VENDOR_SET.has(raw)) continue;

      const key = raw;
      const row = by.get(key) || { name: key, deals: 0 };
      row.deals += 1;
      by.set(key, row);
      totalDeals += 1;
    }

    const rows = [...by.values()];
    for (const r of rows) {
      r.shareDeals = totalDeals ? +(r.deals * 100 / totalDeals).toFixed(1) : 0;
    }
    rows.sort((a,b) => b.deals - a.deals || (a.name > b.name ? 1 : -1));

    return { rows, totalDeals };
  }

  // --------- Boards

  // 1) This Week — Roster (uses weekly per-agent from allSales)
  function renderRosterBoard({ allSales, resolvePhoto }) {
    setView('This Week — Roster');
    const { start, end } = getWeekRangeEST();
    const per = new Map();

    for (const s of allSales || []) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const nameKey = norm(canonicalName(s.agent || s.name || ''));
      if (!nameKey) continue;
      const amt = Number(s.av12x || s.av12X || s.amount || 0);
      const row = per.get(nameKey) || { name: canonicalName(s.agent || s.name || nameKey), av: 0, deals: 0 };
      row.av += amt;
      row.deals += 1;
      per.set(nameKey, row);
    }

    const rows = [...per.values()].sort((a,b) => b.av - a.av);

    if (headEl) {
      headEl.innerHTML =
        `<tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    }

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => {
        const initials = (r.name || '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
        const photo = resolvePhoto({ name: r.name });
        return agentRowHTML({
          name: r.name,
          right1: fmtMoney(r.av),
          right2: r.deals.toLocaleString(),
          photoUrl: photo,
          initial: initials
        });
      }).join('');
    }
  }

  // 2) YTD — Team (unchanged; uses ytd_av.json / ytd_total.json)
  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b) => (b.av || 0) - (a.av || 0));

    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(p => {
        const initials = (p.name || '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
        const photo = resolvePhoto({ name: p.name });
        return agentRowHTML({
          name: p.name,
          right1: fmtMoney(p.av || 0),
          photoUrl: photo,
          initial: initials
        });
      }).join('') + `
        <tr class="total">
          <td><strong>Total</strong></td>
          <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
        </tr>`;
    }
  }

  // 3) Weekly Activity — from calls_week_override.json (THIS IS THE FIX)
  async function renderWeeklyActivityBoard() {
    setView('Weekly Activity');

    const thead = headEl || $('#thead');
    const tbody = bodyEl || $('#tbody');

    const res = await fetch('/calls_week_override.json', { cache: 'no-store' }).catch(() => null);
    const json = res && res.ok ? await res.json() : null;

    if (!json || typeof json !== 'object') {
      if (thead) {
        thead.innerHTML = `
          <tr>
            <th>Agent</th>
            <th class="right">Leads</th>
            <th class="right">Sold</th>
            <th class="right">Conv%</th>
            <th class="right">Calls</th>
            <th class="right">Talk&nbsp;min</th>
            <th class="right">Log&nbsp;min</th>
          </tr>`;
      }
      if (tbody) {
        tbody.innerHTML =
          `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No call data.</td></tr>`;
      }
      return;
    }

    const rosterMap = new Map();
    const roster = (window.__fewRoster || []); // will be set in loadAll
    for (const p of roster) {
      const em = (p.email || '').trim().toLowerCase();
      if (em) rosterMap.set(em, p);
    }

    const rows = [];
    for (const [email, stats] of Object.entries(json)) {
      const em = (email || '').toLowerCase();
      const rosterEntry = rosterMap.get(em);
      const nameFromEmail = (email || '').split('@')[0].replace(/\./g, ' ');
      const display = rosterEntry ? rosterEntry.name : (stats.name || nameFromEmail);
      const name = display.replace(/\b\w/g, c => c.toUpperCase());

      const leads = Number(stats.leads || 0);
      const sold  = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talk  = Number(stats.talkMin || 0);
      const log   = Number(stats.loggedMin || 0);
      const conv  = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      let photoUrl = null;
      if (rosterEntry && rosterEntry.photo) {
        const s = String(rosterEntry.photo);
        photoUrl = (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
      }

      rows.push({ name, leads, sold, conv, calls, talk, log, photoUrl });
    }

    rows.sort((a,b) => b.sold - a.sold || b.leads - a.leads);

    if (thead) {
      thead.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Leads</th>
          <th class="right">Sold</th>
          <th class="right">Conv%</th>
          <th class="right">Calls</th>
          <th class="right">Talk&nbsp;min</th>
          <th class="right">Log&nbsp;min</th>
        </tr>`;
    }

    if (tbody) {
      tbody.innerHTML = rows.map(r => {
        const initials = r.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
        const avatar = r.photoUrl
          ? `<img src="${r.photoUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
          : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;font-size:12px;font-weight:700;color:#89a2c6;border:1px solid rgba(255,255,255,.15);">${initials}</div>`;
        return `
          <tr>
            <td style="display:flex;align-items:center;">${avatar}${r.name}</td>
            <td class="right">${r.leads}</td>
            <td class="right">${r.sold}</td>
            <td class="right">${r.conv}%</td>
            <td class="right">${r.calls}</td>
            <td class="right">${r.talk}</td>
            <td class="right">${r.log}</td>
          </tr>`;
      }).join('');
    }
  }

  // 4) Lead Vendors — Last 45 Days (STRICT rolling 45d — THIS IS THE FIX)
  function renderVendorsBoard({ allSales }) {
    setView('Lead Vendors — Last 45 Days');

    const { rows, totalDeals } = summarizeVendors45d(allSales || []);

    if (!rows.length) {
      if (headEl) headEl.innerHTML = `
        <tr>
          <th>Vendor</th>
          <th class="right">Deals (45d)</th>
          <th class="right">% of total</th>
        </tr>`;
      if (bodyEl) bodyEl.innerHTML =
        `<tr><td colspan="3" style="padding:18px;color:#5c6c82;">No vendor data in last 45 days.</td></tr>`;
      return;
    }

    if (headEl) headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals (45d)</th>
        <th class="right">% of total</th>
      </tr>`;

    const COLORS = [
      '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
    ];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a,c)=> a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    const size = 240;
    const cx = size / 2;
    const cy = size / 2;
    const r  = size / 2 - 8;

    const polar = (cx,cy,r,a) => [cx + r*Math.cos(a), cy + r*Math.sin(a)];
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
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="12" fill="#9fb0c8">Deals (45d)</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">
          ${totalDeals.toLocaleString()}
        </text>
      </svg>`;

    const legend = rows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.name)}"></span>
        <span class="label">${v.name}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.shareDeals}%</span>
      </div>`).join('');

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px">
          <div class="vendor-flex">
            ${svg}
            <div class="legend">${legend}</div>
          </div>
        </td>
      </tr>`;

    const rowsHTML = rows.map(v => `
      <tr>
        <td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.name)}">${v.shareDeals}%</td>
      </tr>`).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
      </tr>`;

    if (bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  // 5) PAR — Tracking (unchanged)
  function renderParBoard({ par }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];

    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`;
      }
      return;
    }

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Take&nbsp;Rate</th>
          <th class="right">Annual&nbsp;AV</th>
        </tr>`;
    }

    if (bodyEl) {
      bodyEl.innerHTML = `
        ${agents.map(a => `
          <tr>
            <td>${a.name}</td>
            <td class="right">${safe(a.take_rate,0)}%</td>
            <td class="right">${fmtMoney(safe(a.ytd_av,0))}</td>
          </tr>`).join('')}
        <tr class="total">
          <td><strong>PACE TO QUALIFY</strong></td>
          <td></td>
          <td class="right"><strong>${fmtMoney(pace)}</strong></td>
        </tr>`;
    }
  }

  // 6) Agent of the Week (auto from weekly sales)
  function renderAgentOfWeek({ allSales, resolvePhoto, ytdList }) {
    setView('Agent of the Week');

    const { start, end } = getWeekRangeEST();
    const per = new Map();

    for (const s of allSales || []) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const key = norm(canonicalName(s.agent || s.name || ''));
      if (!key) continue;
      const amt = Number(s.av12x || s.av12X || s.amount || 0);
      const row = per.get(key) || {
        key,
        name: canonicalName(s.agent || s.name || key),
        av: 0,
        deals: 0
      };
      row.av += amt;
      row.deals += 1;
      per.set(key, row);
    }

    if (!per.size) {
      if (headEl) headEl.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      }
      return;
    }

    const top = [...per.values()].sort((a,b) => b.av - a.av)[0];

    // YTD pull
    let ytdVal = 0;
    const want = top.key;
    if (Array.isArray(ytdList)) {
      const hit = ytdList.find(
        x => norm(x.name) === want || norm(canonicalName(x.name)) === want
      );
      if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
    }

    const photo = resolvePhoto({ name: top.name });
    const initials = top.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

    if (headEl) headEl.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;
    if (bodyEl) {
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
                <div style="margin-top:4px;opacity:.85;">Weekly Submitted AV • ${fmtMoney(top.av)}</div>
                <div style="margin-top:2px;opacity:.55;">Deals this week • ${top.deals.toLocaleString()}</div>
                <div style="margin-top:2px;opacity:.55;">YTD AV • ${fmtMoney(ytdVal)}</div>
                <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.4);border-radius:999px;padding:4px 16px;font-size:12px;letter-spacing:.04em;">
                  <span style="font-size:16px;">🥇</span>
                  <span>Agent of the Week Belt</span>
                </div>
              </div>
            </div>
          </td>
        </tr>`;
    }
  }

  // --------- Rules rotation
  function startRuleRotation(rulesJson) {
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list = Array.isArray(rulesJson?.rules)
      ? rulesJson.rules.filter(Boolean)
      : [];

    if (!list.length) {
      setBanner(
        base,
        'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.'
      );
    } else {
      let i = 0;
      const apply = () => setBanner(base, list[i % list.length]);
      apply();
      setInterval(() => { i++; apply(); }, 12 * 60 * 60 * 1000);
    }
  }

  // --------- Load everything once
  async function loadAll() {
    const [
      rules,
      roster,
      _calls,
      sold,
      ytdList,
      ytdTotalJson,
      par
    ] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent), // not directly used in board now
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);
    const allSales = Array.isArray(sold?.allSales) ? sold.allSales : [];

    // seed seenLeadIds from all current 45d sales
    const { start, end } = getWeekRangeEST();
    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t >= end) continue;
      seenLeadIds.add(saleId(s));
    }

    window.__fewRoster = roster || [];

    return {
      rules: rules || { rules: [] },
      allSales,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation
  function startBoardRotation(data) {
    const sequence = [
      () => renderRosterBoard({ allSales: data.allSales, resolvePhoto: data.resolvePhoto }),
      () => renderYtdBoard(data),
      () => renderWeeklyActivityBoard(),
      () => renderVendorsBoard({ allSales: data.allSales }),
      () => renderParBoard({ par: data.par }),
      () => renderAgentOfWeek({
        allSales: data.allSales,
        resolvePhoto: data.resolvePhoto,
        ytdList: data.ytdList
      })
    ];

    let i = 0;
    const run = () => sequence[i % sequence.length]();
    run();
    setInterval(() => { i++; run(); }, 30_000);
  }

  // --------- Live sale polling for splash + vendor refresh (still 45d)
  function startLiveSalePolling(baseData) {
    const POLL_MS = 12_000;

    setInterval(async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold || !Array.isArray(sold.allSales)) return;

      const allSales = sold.allSales;
      const cutoff45 = nowInEST().getTime() - 45 * 24 * 3600 * 1000;

      let newSeen = false;
      for (const s of allSales) {
        const id = saleId(s);
        const t = parseSaleDateEST(s.dateSold || s.date || '');
        if (!Number.isFinite(t) || t < cutoff45) continue;
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newSeen = true;
          showSplash({
            name: s.agent || 'Agent',
            amount: s.amount || s.av12x || s.av12X || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      if (newSeen) {
        renderCardsFromWeek(allSales);
        renderVendorsBoard({ allSales });
        baseData.allSales = allSales;
      }
    }, POLL_MS);
  }

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();
      renderCardsFromWeek(data.allSales);
      startRuleRotation(data.rules);
      startBoardRotation(data);
      startLiveSalePolling(data);
    } catch (err) {
      console.error(err);
      setBanner(
        'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT',
        'Error loading data.'
      );
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
      }
    }
  })();
})();

// ---------- OE Countdown (Dec 15, 2025 11:59 PM EST) ----------
(function () {
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
