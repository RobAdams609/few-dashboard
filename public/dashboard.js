/* FEW Dashboard — Single File (45d rolling vendors, EST weeks, OE countdown)
   Boards (30s rotate):
     1. This Week — Roster
     2. YTD — Team
     3. Weekly Activity (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, no weekly reset)
     5. PAR — Tracking
     6. Agent of the Week (auto from sales week, not manual)

   Extras:
     - Center splash on new sale (60s)
     - Vendor donut + legend
     - Headshots w/ canonical names (Ajani → "a s", Fabricio → "f n")
     - Rules rotation every 12h: “THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT”
     - 45d rolling vendor aggregation (from API data), live merge
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
  const safe = (v, d) => (v === undefined || v === null ? d : v);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const fmtMoney = (n) => {
    const x = Math.round(Number(n) || 0);
    return `$${x.toLocaleString()}`;
  };

  // Current time in America/New_York
  function nowInET() {
    // relies on browser Intl; falls back to local if missing
    try {
      const s = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      return new Date(s);
    } catch {
      return new Date();
    }
  }

  // Parse a sale date as ET (so late deals don't bleed weeks)
  function parseSaleDateET(raw) {
    if (!raw) return NaN;
    const s = String(raw).trim();
    // If already has offset/Z, trust it
    if (/[+-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }
    // Otherwise append ET hint
    const withET = Date.parse(s + ' ET');
    if (Number.isFinite(withET)) return withET;
    const plain = Date.parse(s);
    return Number.isFinite(plain) ? plain : NaN;
  }

  // Get [start,end) of current FEW sales week in ET.
  // Week: FRIDAY 00:00 ET → next FRIDAY 00:00 ET.
  function getSalesWeekRangeET() {
    const d = nowInET();
    const day = d.getDay();       // 0=Sun .. 5=Fri .. 6=Sat
    const diffFromFri = (day + 7 - 5) % 7; // days since last Friday
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diffFromFri);
    const start = d.getTime();
    const end = start + 7 * 24 * 60 * 60 * 1000;
    return { start, end };
  }

  const isInCurrentSalesWeek = (ts) => {
    const { start, end } = getSalesWeekRangeET();
    return ts >= start && ts < end;
  };

  // --------- Allowed vendor labels (18)
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

  // --------- Canonical names (Ajani, Fabricio, etc.)
  const NAME_ALIASES = new Map([
    // Fabricio
    ['fabricio a navarrete', 'f n'],
    ['fabricio navarrete', 'f n'],
    ['fabricio navarrete cervantes', 'f n'],
    ['fabricio cervantes', 'f n'],
    ['fabricio', 'f n'],
    ['fab', 'f n'],
    ['f n', 'f n'],
    // Ajani
    ['ajani senior', 'a s'],
    ['ajani s', 'a s'],
    ['a s', 'a s'],
    // Others mirror roster
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
      const ini = (agent.name || '')
        .split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

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

  // Remove any old ticker
  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // --------- CSS (minimal, same style you had)
  (function injectCSS() {
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

  // --------- Splash on new sale (60s)
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

  // --------- Normalize sales from API
  function normalizeSales(rawAllSales = []) {
    const out = [];
    for (const s of rawAllSales) {
      const t = parseSaleDateET(s.dateSold || s.date || s.created_at || s.submitted_at);
      if (!Number.isFinite(t)) continue;

      const agent = canonicalName(s.agent || s.writer || s.closer || s.name || '');
      const vendor = String(
        s.soldProductName || s.vendor || s.leadVendor || s.source || ''
      ).trim();

      const avField = +s.av12x || +s.av12X;
      const amount = +s.amount || +s.premium || 0;
      const av12 = avField || (amount > 0 ? amount * 12 : 0);

      out.push({
        ...s,
        t,
        agent,
        vendor,
        av12,
        amount
      });
    }
    return out;
  }

  // --------- Build week + 45d aggregates from normalized sales
  function buildAggregates(allSalesNorm) {
    const { start, end } = getSalesWeekRangeET();
    const nowET = nowInET().getTime();
    const cutoff45 = nowET - 45 * 24 * 60 * 60 * 1000;

    const weekPerAgent = new Map();
    let weekDeals = 0;
    let weekAv = 0;

    const vendors45 = new Map();
    let totalDeals45 = 0;
    let totalAv45 = 0;

    for (const s of allSalesNorm) {
      const { t, agent, vendor, av12 } = s;

      // Week (Fri–Thu)
      if (t >= start && t < end && agent) {
        const key = norm(agent);
        const cur = weekPerAgent.get(key) || { name: agent, deals: 0, av: 0 };
        cur.deals += 1;
        cur.av += av12;
        weekPerAgent.set(key, cur);
        weekDeals += 1;
        weekAv += av12;
      }

      // 45d vendors
      if (t >= cutoff45 && t <= nowET && VENDOR_SET.has(vendor)) {
        const vCur = vendors45.get(vendor) || { name: vendor, deals: 0, av: 0 };
        vCur.deals += 1;
        vCur.av += av12;
        vendors45.set(vendor, vCur);
        totalDeals45 += 1;
        totalAv45 += av12;
      }
    }

    const weekAgents = Array.from(weekPerAgent.values())
      .sort((a, b) => b.av - a.av || b.deals - a.deals);

    const vendorRows = Array.from(vendors45.values());
    vendorRows.sort((a, b) => b.deals - a.deals || b.av - a.av);
    const withShares = vendorRows.map(r => ({
      ...r,
      shareDeals: totalDeals45 ? +(r.deals * 100 / totalDeals45).toFixed(1) : 0
    }));

    return {
      weekAgents,
      weekDeals,
      weekAv,
      vendorRows: withShares,
      totalDeals45,
      totalAv45
    };
  }

  // --------- Cards (always current FEW week)
  function renderCardsWeek({ calls, weekAv, weekDeals }) {
    if (cards.calls) cards.calls.textContent = (Number(calls) || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(weekAv || 0);
    if (cards.deals) cards.deals.textContent = (Number(weekDeals) || 0).toLocaleString();
  }

  // --------- Row HTML helpers
  function initials(name = '') {
    return name.trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
  }

  function agentRowHTML({ name, right1, right2, photoUrl }) {
    const init = initials(name || '');
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6;">${init || '?'}</div>`;

    return `
      <tr>
        <td class="agent" style="display:flex;align-items:center;">${avatar}<span>${name}</span></td>
        <td class="right">${right1}</td>
        ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
      </tr>
    `;
  }

  // --------- Boards

  // 1. This Week — Roster (from FEW week aggregates)
  function renderRosterBoard(data) {
    setView('This Week — Roster');
    const { weekAgents, resolvePhoto } = data;

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Submitted AV</th>
          <th class="right">Deals</th>
        </tr>
      `;
    }

    if (bodyEl) {
      bodyEl.innerHTML = (weekAgents || []).map(a => {
        const photo = resolvePhoto({ name: a.name });
        return agentRowHTML({
          name: a.name,
          right1: fmtMoney(a.av),
          right2: (a.deals || 0).toLocaleString(),
          photoUrl: photo
        });
      }).join('');
    }
  }

  // 2. YTD — Team (from ytd_av.json / ytd_total.json)
  function renderYtdBoard(data) {
    setView('YTD — Team');
    const { ytdList, ytdTotal, resolvePhoto } = data;
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a, b) => (b.av || 0) - (a.av || 0));

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">YTD AV</th>
        </tr>
      `;
    }

    if (bodyEl) {
      const html = rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av || 0),
        photoUrl: resolvePhoto({ name: p.name })
      })).join('');

      bodyEl.innerHTML = `
        ${html}
        <tr class="total">
          <td><strong>Total</strong></td>
          <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
        </tr>
      `;
    }
  }

  // 3. Weekly Activity (calls_week_override.json)
  async function renderWeeklyActivity() {
    setView('Weekly Activity');

    const res = await fetch('/calls_week_override.json', { cache: 'no-store' }).catch(() => null);
    const json = res && res.ok ? await res.json() : null;

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Leads</th>
          <th class="right">Sold</th>
          <th class="right">Conv%</th>
          <th class="right">Calls</th>
          <th class="right">Talk&nbsp;min</th>
          <th class="right">Log&nbsp;min</th>
        </tr>
      `;
    }

    if (!json || typeof json !== 'object') {
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No call data.</td></tr>`;
      }
      return;
    }

    // Roster lookup for headshots
    const rosterRes = await fetch(ENDPOINTS.roster, { cache: 'no-store' }).catch(() => null);
    const roster = rosterRes && rosterRes.ok ? await rosterRes.json() : [];
    const resolvePhoto = buildHeadshotResolver(roster || []);

    const rows = [];
    for (const [email, stats] of Object.entries(json)) {
      const leads = Number(stats.leads || 0);
      const sold = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talkMin = Number(stats.talkMin || 0);
      const loggedMin = Number(stats.loggedMin || 0);
      const conv = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      const ro = (roster || []).find(p =>
        (p.email || '').trim().toLowerCase() === (email || '').trim().toLowerCase()
      );
      const name = ro
        ? ro.name
        : (stats.name || (email || '').split('@')[0].replace(/\./g, ' '));

      const photoUrl = resolvePhoto({ name, email });

      rows.push({
        name,
        leads,
        sold,
        conv,
        calls,
        talkMin,
        loggedMin,
        photoUrl
      });
    }

    rows.sort((a, b) => b.sold - a.sold || b.leads - a.leads);

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => {
        const init = initials(r.name);
        const avatar = r.photoUrl
          ? `<img src="${r.photoUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
          : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;font-size:12px;font-weight:700;color:#89a2c6;border:1px solid rgba(255,255,255,.15);">${init}</div>`;
        return `
          <tr>
            <td style="display:flex;align-items:center;">${avatar}${r.name}</td>
            <td class="right">${r.leads}</td>
            <td class="right">${r.sold}</td>
            <td class="right">${r.conv}%</td>
            <td class="right">${r.calls}</td>
            <td class="right">${r.talkMin}</td>
            <td class="right">${r.loggedMin}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // 4. Lead Vendors — Last 45 Days (rolling)
  function renderVendorsBoard(data) {
    setView('Lead Vendors — Last 45 Days');

    const { vendorRows, totalDeals45 } = data;
    const rows = Array.isArray(vendorRows) ? vendorRows : [];

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No vendor data in last 45 days.</td></tr>`;
      }
      return;
    }

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Vendor</th>
          <th class="right">Deals (45d)</th>
          <th class="right">% of total</th>
        </tr>
      `;
    }

    const COLORS = [
      '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff',
      '#f4b4ff','#c0ffb4'
    ];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    // Donut SVG
    const size = 260;
    const cx = size / 2;
    const cy = size / 2;
    const r  = size / 2 - 10;

    const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const arcPath = (cx, cy, r, a0, a1) => {
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const [x0, y0] = polar(cx, cy, r, a0);
      const [x1, y1] = polar(cx, cy, r, a1);
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };

    let acc = -Math.PI / 2;
    const arcs = rows.map(v => {
      const span = totalDeals45 ? 2 * Math.PI * (v.deals / totalDeals45) : 0;
      const d = arcPath(cx, cy, r, acc, acc + span);
      acc += span;
      return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="30" fill="none"></path>`;
    }).join('');

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-20}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="12" fill="#9fb0c8">
          Deals (45d)
        </text>
        <text x="${cx}" y="${cy+18}" text-anchor="middle" font-size="22" font-weight="700" fill="#ffd36a">
          ${totalDeals45.toLocaleString()}
        </text>
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
        <td colspan="3" style="padding:18px;">
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
        <td class="right"><strong>${totalDeals45.toLocaleString()}</strong></td>
        <td></td>
      </tr>
    `;

    if (bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  // 5. PAR — Tracking
  function renderParBoard(data) {
    setView('PAR — Tracking');
    const { par } = data;
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
        </tr>
      `;
    }

    if (bodyEl) {
      bodyEl.innerHTML = `
        ${agents.map(a => `
          <tr>
            <td>${a.name}</td>
            <td class="right">${safe(a.take_rate, 0)}%</td>
            <td class="right">${fmtMoney(safe(a.ytd_av, 0))}</td>
          </tr>
        `).join('')}
        <tr class="total">
          <td><strong>PACE TO QUALIFY</strong></td>
          <td></td>
          <td class="right"><strong>${fmtMoney(pace)}</strong></td>
        </tr>
      `;
    }
  }

  // 6. Agent of the Week (from FEW week aggregates)
  function renderAgentOfWeekAuto(data) {
    setView('Agent of the Week');

    const { weekAgents, ytdList, resolvePhoto } = data;
    const thead = headEl;
    const tbody = bodyEl;

    if (!weekAgents || !weekAgents.length) {
      if (thead) thead.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (tbody) {
        tbody.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      }
      return;
    }

    const top = weekAgents[0]; // already sorted by AV desc

    const want = norm(top.name);
    let ytdVal = 0;
    if (Array.isArray(ytdList)) {
      const hit = ytdList.find(
        x => norm(x.name) === want || norm(canonicalName(x.name)) === want
      );
      if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
    }

    const photo = resolvePhoto({ name: top.name });
    const init = initials(top.name);

    if (thead) thead.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="padding:26px 18px;">
            <div style="display:flex;align-items:center;gap:18px;">
              ${
                photo
                  ? `<img src="${photo}" style="width:92px;height:92px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3);" />`
                  : `<div style="width:92px;height:92px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;border:2px solid rgba(255,255,255,.3);">${init}</div>`
              }
              <div style="flex:1;">
                <div style="font-size:22px;font-weight:700;">${top.name}</div>
                <div style="margin-top:4px;opacity:.85;">Weekly Submitted AV • ${fmtMoney(top.av)}</div>
                <div style="margin-top:2px;opacity:.55;">Deals this week • ${(top.deals || 0).toLocaleString()}</div>
                <div style="margin-top:2px;opacity:.55;">YTD AV • ${fmtMoney(ytdVal)}</div>
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
  }

  // --------- Rules rotation every 12h
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
      return;
    }

    let i = 0;
    const apply = () => setBanner(base, list[i % list.length]);
    apply();
    setInterval(() => { i++; apply(); }, 12 * 60 * 60 * 1000);
  }

  // --------- Data load
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
      fetch(ENDPOINTS.rules, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(ENDPOINTS.roster, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(ENDPOINTS.callsByAgent, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(ENDPOINTS.teamSold, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(ENDPOINTS.ytdAv, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(ENDPOINTS.ytdTotal, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(ENDPOINTS.par, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);

    const rawAllSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const allSalesNorm = normalizeSales(rawAllSales);
    const aggs = buildAggregates(allSalesNorm);

    // primes for splash: mark existing
    for (const s of allSalesNorm) {
      seenLeadIds.add(saleId(s));
    }

    const callsTotal = safe(calls?.team?.calls, 0);

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      callsTotal,
      soldRaw: sold || {},
      allSalesNorm,
      ...aggs,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation (30s)
  function startBoardRotation(data) {
    const order = [
      () => renderRosterBoard(data),
      () => renderYtdBoard(data),
      () => renderWeeklyActivity(),
      () => renderVendorsBoard(data),
      () => renderParBoard(data),
      () => renderAgentOfWeekAuto(data)
    ];

    let i = 0;
    const paint = () => order[i % order.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30_000);
  }

  // --------- Live sale polling (uses same rules)
  function startLiveSalePolling(baseData) {
    const POLL_MS = 12_000;

    const tick = async () => {
      const r = await fetch(ENDPOINTS.teamSold, { cache: 'no-store' }).catch(() => null);
      if (!r || !r.ok) return;
      const nextSold = await r.json();

      const rawAllSales = Array.isArray(nextSold?.allSales) ? nextSold.allSales : [];
      const allSalesNorm = normalizeSales(rawAllSales);
      const aggs = buildAggregates(allSalesNorm);

      // new sales + splash
      for (const s of allSalesNorm) {
        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          if (isInCurrentSalesWeek(s.t)) {
            showSplash({
              name: s.agent || 'Agent',
              amount: s.av12 || s.amount || 0,
              soldProductName: s.vendor || s.soldProductName || ''
            });
          }
        }
      }

      // update cards + vendor board + agent of week + roster (all driven by aggs)
      const merged = {
        ...baseData,
        ...aggs
      };

      renderCardsWeek({
        calls: baseData.callsTotal,
        weekAv: aggs.weekAv,
        weekDeals: aggs.weekDeals
      });

      // If vendors or roster/agent board currently visible, the 30s rotation
      // will repaint on its own. We don't try to be clever here.
    };

    setInterval(tick, POLL_MS);
  }

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();

      renderCardsWeek({
        calls: data.callsTotal,
        weekAv: data.weekAv,
        weekDeals: data.weekDeals
      });

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

  const deadline = new Date('2025-12-16T04:59:59Z'); // 11:59:59 PM EST

  const pad = (n) => String(n).padStart(2, '0');

  function updateCountdown() {
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
    requestAnimationFrame(() => setTimeout(updateCountdown, 250));
  }

  updateCountdown();
})();
