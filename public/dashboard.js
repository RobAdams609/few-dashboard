/* FEW Dashboard — Single File
   - Fri→Thu EST sales week
   - Lead Vendors: rolling last 45 days (no weekly reset)
   - 18 approved vendors only
   - Auto Agent of the Week
   - Weekly Activity from calls_week_override.json
   - OE countdown to Dec 15, 2025 11:59 PM EST
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

  // --------- EST helpers

  // Parse any sale date as EST for consistent week / 45d logic.
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

    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  // Fri 00:00 EST → next Fri 00:00 EST (Thu 23:59:59 inclusive)
  function getWeekRangeEST() {
    const now = new Date();
    const estOffset = 5 * 60; // base EST minutes
    const localOffset = now.getTimezoneOffset();
    const estNow = new Date(now.getTime() + (localOffset - estOffset) * 60000);

    const day = estNow.getDay(); // 0=Sun..6=Sat
    // Map to "days since Friday"
    const daysSinceFri = (day + 2) % 7; // Fri(5)->0, Sat(6)->1, Sun(0)->2, ..., Thu(4)->6

    const start = new Date(estNow);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysSinceFri);

    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    return { start: start.getTime(), end: end.getTime() };
  }

  // --------- Vendor set
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

  // --------- Canonical names (Ajani/Fabricio + others)
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
    ['anna gleason', 'anna gleason'],
    ['sebastian beltran', 'sebastian beltran'],
    ['michelle landis', 'michelle landis'],
    ['elizabeth snyder', 'elizabeth snyder'],
    ['fraitzline healthadvisor', 'fraitzline healthadvisor']
  ]);
  const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  // --------- Headshots
  function buildHeadshotResolver(roster) {
    const byName = new Map();
    const byEmail = new Map();
    const byPhone = new Map();
    const byInitial = new Map();

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

  // --------- Layout
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

  // --------- CSS
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

  // --------- Cards (weekly baseline)
  function renderCardsWeekly({ calls, sold }) {
    const callsVal = safe(calls?.team?.calls, 0);

    let avVal = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
    if (!avVal && Array.isArray(sold?.perAgent)) {
      avVal = sold.perAgent.reduce(
        (a, p) => a + (+p.av12x || +p.av12X || +p.amount || 0), 0
      );
    }

    let dealsVal = safe(sold?.team?.totalSales, 0);
    if (!dealsVal && Array.isArray(sold?.perAgent)) {
      dealsVal = sold.perAgent.reduce((a, p) => a + (+p.sales || 0), 0);
    }

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal || 0).toLocaleString();
  }

  // --------- Agent row helper
  function agentRowHTML({ name, right1, right2, photoUrl, initial }) {
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initial || '?'}</div>`;

    return `
      <tr>
        <td class="agent" style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
        <td class="right">${right1}</td>
        ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
      </tr>
    `;
  }

  // --------- 45d vendor summarizer (core fix)
  function summarizeVendors45d(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();

    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < cutoff) continue;

      const raw = String(s.soldProductName || '').trim();
      const vendor = VENDOR_SET.has(raw) ? raw : null;
      if (!vendor) continue;

      const amount = +s.amount || 0;
      const prev = byName.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      prev.deals += 1;
      prev.amount += amount;
      byName.set(vendor, prev);
    }

    const rows = [...byName.values()];
    const totalDeals  = rows.reduce((a, r) => a + r.deals, 0);
    const totalAmount = rows.reduce((a, r) => a + r.amount, 0);

    if (!totalDeals) return { rows: [], totalDeals: 0, totalAmount: 0 };

    for (const r of rows) {
      r.shareDeals = +(r.deals * 100 / totalDeals).toFixed(1);
    }

    rows.sort((a, b) => b.deals - a.deals || b.amount - a.amount);

    return { rows, totalDeals, totalAmount };
  }

  // --------- Boards

  function renderRosterBoard(data) {
    setView('This Week — Roster');
    renderCardsWeekly(data);

    const per = new Map();
    for (const a of (data.sold.perAgent || [])) {
      const key = norm(canonicalName(a.name));
      per.set(key, {
        av: +a.av12x || +a.av12X || +a.amount || 0,
        deals: +a.sales || 0
      });
    }

    const rows = [];
    for (const p of data.roster || []) {
      const key = norm(canonicalName(p.name));
      const d = per.get(key) || { av: 0, deals: 0 };
      const photo = data.resolvePhoto({ name: p.name, email: p.email });
      const initials = (p.name || '').trim().split(/\s+/)
        .map(w => (w[0] || '').toUpperCase()).join('');
      rows.push({ name: p.name, av: d.av, deals: d.deals, photo, initials });
    }

    rows.sort((a, b) => b.av - a.av);

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
      bodyEl.innerHTML = rows.map(r => agentRowHTML({
        name: r.name,
        right1: fmtMoney(r.av),
        right2: (r.deals || 0).toLocaleString(),
        photoUrl: r.photo,
        initial: r.initials
      })).join('');
    }
  }

  function renderYtdBoard(data) {
    setView('YTD — Team');
    renderCardsWeekly(data);

    const rows = Array.isArray(data.ytdList) ? [...data.ytdList] : [];
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
      bodyEl.innerHTML = rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av || 0),
        photoUrl: data.resolvePhoto({ name: p.name }),
        initial: (p.name || '').split(/\s+/)
          .map(w => (w[0] || '').toUpperCase()).join('')
      })).join('') + `
        <tr class="total">
          <td><strong>Total</strong></td>
          <td class="right"><strong>${fmtMoney(data.ytdTotal || 0)}</strong></td>
        </tr>
      `;
    }
  }

  // Weekly Activity from calls_week_override.json
  async function renderWeeklyActivity(data) {
    setView('Weekly Activity');
    renderCardsWeekly(data);

    const res = await fetch('/calls_week_override.json', { cache: 'no-store' }).catch(() => null);
    const json = res && res.ok ? await res.json() : null;

    if (!json || typeof json !== 'object') {
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
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No call data.</td></tr>`;
      }
      return;
    }

    const rows = [];
    const rosterMap = new Map((data.roster || []).map(p => [
      (p.email || '').trim().toLowerCase(),
      p
    ]));

    for (const [email, stats] of Object.entries(json)) {
      const em = (email || '').toLowerCase();
      const rosterEntry = rosterMap.get(em);
      const nameFromEmail = (email || '').split('@')[0].replace(/\./g, ' ');
      const dispName = rosterEntry ? rosterEntry.name : (stats.name || nameFromEmail);
      const name = dispName.replace(/\b\w/g, c => c.toUpperCase());

      const leads = Number(stats.leads || 0);
      const soldC = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talkMin = Number(stats.talkMin || 0);
      const loggedMin = Number(stats.loggedMin || 0);
      const conv = leads ? +(soldC * 100 / leads).toFixed(1) : 0;

      let photoUrl = null;
      if (rosterEntry && rosterEntry.photo) {
        const s = String(rosterEntry.photo);
        photoUrl = (s.startsWith('http') || s.startsWith('/'))
          ? s
          : `/headshots/${s}`;
      }

      rows.push({
        name,
        leads,
        sold: soldC,
        calls,
        talkMin,
        loggedMin,
        conv,
        photoUrl
      });
    }

    rows.sort((a, b) => b.sold - a.sold || b.calls - a.calls);

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

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => {
        const initials = r.name.split(/\s+/)
          .map(w => (w[0] || '').toUpperCase()).join('');
        const avatar = r.photoUrl
          ? `<img src="${r.photoUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
          : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;font-size:12px;font-weight:700;color:#89a2c6;border:1px solid rgba(255,255,255,.15);">${initials}</div>`;
        return `
          <tr>
            <td style="display:flex;align-items:center;">
              ${avatar}${r.name}
            </td>
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

  // Lead Vendors — Last 45 Days (rolling)
  function renderVendorsBoard(data) {
    setView('Lead Vendors — Last 45 Days');

    const v = data.vendor45d;
    const rows = v.rows || [];

    // Top cards: keep calls weekly, set AV/deals to 45d so donut + card align.
    if (cards.calls) {
      const callsVal = safe(data.calls?.team?.calls, 0);
      cards.calls.textContent = (callsVal || 0).toLocaleString();
    }
    if (cards.av)    cards.av.textContent    = fmtMoney(v.totalAmount || 0);
    if (cards.deals) cards.deals.textContent = (v.totalDeals || 0).toLocaleString();

    if (!rows.length) {
      if (headEl) headEl.innerHTML = `
        <tr>
          <th>Vendor</th>
          <th class="right">Deals (45d)</th>
          <th class="right">% of total</th>
        </tr>
      `;
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td colspan="3" style="padding:18px;color:#5c6c82;">No vendor data in last 45 days.</td></tr>`;
      }
      return;
    }

    const COLORS = [
      '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
    ];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    const size = 240, cx = size / 2, cy = size / 2, r = size / 2 - 8;
    const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const arcPath = (cx, cy, r, a0, a1) => {
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const [x0, y0] = polar(cx, cy, r, a0);
      const [x1, y1] = polar(cx, cy, r, a1);
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };

    let acc = -Math.PI / 2;
    const arcs = rows.map(vr => {
      const span = v.totalDeals ? 2 * Math.PI * (vr.deals / v.totalDeals) : 0;
      const d = arcPath(cx, cy, r, acc, acc + span);
      acc += span;
      return `<path d="${d}" stroke="${colorFor(vr.name)}" stroke-width="28" fill="none"></path>`;
    }).join('');

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-16}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals (45d)</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">
          ${v.totalDeals.toLocaleString()}
        </text>
      </svg>
    `;

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Vendor</th>
          <th class="right">Deals (45d)</th>
          <th class="right">% of total</th>
        </tr>
      `;
    }

    const legend = rows.map(vr => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(vr.name)}"></span>
        <span class="label">${vr.name}</span>
        <span class="val">${vr.deals.toLocaleString()} • ${vr.shareDeals}%</span>
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

    const rowsHTML = rows.map(vr => `
      <tr>
        <td><span class="dot" style="background:${colorFor(vr.name)}"></span>${vr.name}</td>
        <td class="right">${vr.deals.toLocaleString()}</td>
        <td class="right">${vr.shareDeals}%</td>
      </tr>
    `).join('');

    if (bodyEl) {
      bodyEl.innerHTML = donutRow + rowsHTML;
    }
  }

  function renderParBoard(data) {
    setView('PAR — Tracking');
    renderCardsWeekly(data);

    const pace = +safe(data.par?.pace_target, 0);
    const agents = Array.isArray(data.par?.agents) ? data.par.agents : [];

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
  }

  // Agent of the Week (auto from weekly perAgent + YTD)
  async function renderAgentOfWeekAuto(data) {
    setView('Agent of the Week');
    renderCardsWeekly(data);

    const perAgent = Array.isArray(data.sold.perAgent) ? data.sold.perAgent : [];
    const thead = $('#thead');
    const tbody = $('#tbody');

    if (!perAgent.length) {
      if (thead) thead.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (tbody) {
        tbody.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      }
      return;
    }

    let top = null;
    for (const row of perAgent) {
      const nameRaw = row.name || row.agent || '';
      const name = canonicalName(nameRaw);
      const av = Number(row.av12x || row.av12X || row.amount || 0);
      const deals = Number(row.sales || row.deals || 0);
      if (!top || av > top.av) {
        top = { name, av, deals };
      }
    }

    if (!top) {
      if (thead) thead.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (tbody) {
        tbody.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No data.</td></tr>`;
      }
      return;
    }

    const want = norm(top.name);
    let ytdVal = 0;
    for (const x of (data.ytdList || [])) {
      const nm = norm(canonicalName(x.name));
      if (nm === want) {
        ytdVal = Number(x.av || x.ytd_av || 0);
        break;
      }
    }

    const photo = data.resolvePhoto({ name: top.name });
    const initials = top.name.split(/\s+/)
      .map(w => (w[0] || '').toUpperCase()).join('');

    if (thead) thead.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;
    if (tbody) {
      tbody.innerHTML = `
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

  // --------- Load all
  async function loadAll() {
    const [
      rules,
      roster,
      calls,
      soldRaw,
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

    const sold = soldRaw || {
      team: { totalSales: 0, totalAV12X: 0 },
      perAgent: [],
      allSales: []
    };
    if (!Array.isArray(sold.perAgent)) sold.perAgent = [];
    if (!Array.isArray(sold.allSales)) sold.allSales = [];

    const resolvePhoto = buildHeadshotResolver(roster || []);
    const vendor45d = summarizeVendors45d(sold.allSales);

    // seed splash IDs based on all known sales in 45d window
    for (const s of sold.allSales || []) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (Number.isFinite(t) && t >= Date.now() - 45 * 24 * 3600 * 1000) {
        seenLeadIds.add(saleId(s));
      }
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 }, perAgent: [] },
      sold,
      vendor45d,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation (30s)
  function startBoardRotation(data) {
    const sequence = [
      () => renderRosterBoard(data),
      () => renderYtdBoard(data),
      () => renderWeeklyActivity(data),
      () => renderVendorsBoard(data),
      () => renderParBoard(data),
      () => renderAgentOfWeekAuto(data)
    ];

    let i = 0;
    const paint = () => sequence[i % sequence.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30_000);
  }

  // --------- Live sale polling (keeps splash + 45d vendors live)
  function startLiveSalePolling(shared) {
    const POLL_MS = 12_000;
    const windowMs = 45 * 24 * 3600 * 1000;

    const tick = async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold || !Array.isArray(sold.allSales)) return;

      // new sales + splash
      let changed = false;
      for (const s of sold.allSales) {
        const t = parseSaleDateEST(s.dateSold || s.date || '');
        if (!Number.isFinite(t) || t < Date.now() - windowMs) continue;

        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          changed = true;
          showSplash({
            name: s.agent || 'Agent',
            amount: s.amount || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      if (!changed) return;

      shared.sold = { ...shared.sold, allSales: sold.allSales };
      shared.vendor45d = summarizeVendors45d(sold.allSales);

      if (viewLabelEl && viewLabelEl.textContent.includes('Lead Vendors — Last 45 Days')) {
        renderVendorsBoard(shared);
      }
    };

    setInterval(tick, POLL_MS);
  }

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();
      renderCardsWeekly(data);
      startRuleRotation(data.rules);
      startBoardRotation(data);
      startLiveSalePolling(data);
    } catch (err) {
      console.error(err);
      setBanner(
        'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT',
        'Error loading data.'
      );
      const body = $('#tbody');
      if (body) {
        body.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
      }
    }
  })();
})();

// ---------- OE Countdown ----------
(function () {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;

  const deadline = new Date('2025-12-15T23:59:59-05:00');
  const pad = n => String(n).padStart(2, '0');

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
