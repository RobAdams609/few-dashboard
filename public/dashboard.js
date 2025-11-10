/* FEW Dashboard — Single File
   Boards (30s rotate):
     1. This Week — Roster        (Fri–Thu EST sales week, AV = 12x)
     2. YTD — Team                (from ytd_av.json / ytd_total.json)
     3. Weekly Activity           (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, from team_sold.allSales)
     5. PAR — Tracking
     6. Agent of the Week         (auto from weekly data)

   Extras (unchanged):
     - Center splash on new sale (60s)
     - Vendor donut + legend
     - Headshots w/ canonical names (Ajani → "a s", Fabricio → "f n")
     - Rules rotation every 12h
     - OE Countdown → Dec 15, 2025 11:59 PM EST
*/

(() => {
  // ---------- Endpoints
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json',
    weeklyOverride: '/calls_week_override.json'
  };

  // ---------- Utilities
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const safe = (v, d) => (v === undefined || v === null || Number.isNaN(v) ? d : v);
  const fmtMoney = (n) => {
    const num = Number(n) || 0;
    return '$' + Math.round(num).toLocaleString();
  };
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // AV helpers: always display 12x
  const toAv12x = (base, av12xField) => {
    const direct = Number(av12xField);
    if (!Number.isNaN(direct) && direct > 0) return direct;
    const b = Number(base);
    return Number.isNaN(b) ? 0 : b * 12;
  };

  // Fetch JSON with no cache; never throw
  async function fetchJSON(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON failed:', url, e.message || e);
      return null;
    }
  }

  // EST clock
  function nowInEST() {
    const now = new Date();
    // crude but consistent: EST/EDT offset via locale (assumes server/browser TZ ≈ ET)
    const est = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/New_York' })
    );
    return est;
  }

  // Current sales week (Fri 00:00 EST → next Fri 00:00 EST)
  function getWeekRangeEST() {
    const d = nowInEST();
    const day = d.getDay(); // 0=Sun..6=Sat
    const diffFromFri = (day + 2) % 7; // days since last Fri (Fri=0, Sat=1, ... Thu=6)
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diffFromFri);
    const start = d.getTime();
    const endDate = new Date(d);
    endDate.setDate(endDate.getDate() + 7);
    const end = endDate.getTime();
    return { start, end };
  }

  // Parse sale date as EST
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

  // ---------- Canonical names + roster filter
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
    ['a s', 'a s']
    // Add more explicit mappings here if needed
  ]);

  const canonicalName = (name) => {
    const n = norm(name);
    return NAME_ALIASES.get(n) || name || '';
  };

  function buildRosterMaps(roster) {
    const byName = new Map();
    const byEmail = new Map();
    const byInitials = new Map();
    const rosterSet = new Set();

    const photoURL = (p) => {
      if (!p) return null;
      const s = String(p);
      return (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
    };

    const initialsOf = (full = '') =>
      full.trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

    for (const p of roster || []) {
      const cName = norm(canonicalName(p.name));
      const em = String(p.email || '').trim().toLowerCase();
      const ini = initialsOf(p.name || '');
      const photo = photoURL(p.photo);

      if (cName) {
        byName.set(cName, photo);
        rosterSet.add(cName);
      }
      if (em) byEmail.set(em, photo);
      if (ini && !byInitials.has(ini)) byInitials.set(ini, photo);
    }

    function resolve(agent = {}) {
      const cName = norm(canonicalName(agent.name));
      const em = String(agent.email || '').trim().toLowerCase();
      const ini = (agent.name || '').trim()
        .split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

      return (
        byName.get(cName) ||
        byEmail.get(em) ||
        byInitials.get(ini) ||
        null
      );
    }

    return { resolve, rosterSet };
  }

  // ---------- Vendor whitelist (18)
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

  // ---------- DOM anchors
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

  // remove ticker if present
  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // ---------- CSS (unchanged style + few helpers)
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

  // ---------- Splash for new sale
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name || 'New Sale'}</div>
      <div class="mid">${fmtMoney(toAv12x(amount))}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60_000);
  }

  const seenLeadIds = new Set();
  const saleId = (s) =>
    String(
      s.leadId ||
      s.id ||
      `${s.agent || ''}-${s.dateSold || s.date || ''}-${s.soldProductName || ''}-${s.amount || ''}`
    );

  // ---------- Cards (This Week — Team)
  function renderCards({ weekAgg }) {
    const calls = safe(weekAgg.calls, 0);
    const av = safe(weekAgg.av12x, 0);
    const deals = safe(weekAgg.deals, 0);

    if (cards.calls) cards.calls.textContent = calls.toLocaleString();
    if (cards.av) cards.av.textContent = fmtMoney(av);
    if (cards.deals) cards.deals.textContent = deals.toLocaleString();
  }

  // ---------- Agent row HTML
  function initialsOf(name = '') {
    return name.trim().split(/\s+/)
      .map(w => (w[0] || '').toUpperCase()).join('') || '?';
  }

  function avatarHTML(photoUrl, name) {
    const ini = initialsOf(name);
    if (photoUrl) {
      return `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`;
    }
    return `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${ini}</div>`;
  }

  function agentRowHTML({ name, col1, col2, col3, photoUrl }) {
    return `
      <tr>
        <td style="display:flex;align-items:center">
          ${avatarHTML(photoUrl, name)}
          <span>${name}</span>
        </td>
        ${col1 !== undefined ? `<td class="right">${col1}</td>` : ''}
        ${col2 !== undefined ? `<td class="right">${col2}</td>` : ''}
        ${col3 !== undefined ? `<td class="right">${col3}</td>` : ''}
      </tr>
    `;
  }

  // ---------- Aggregate weekly + vendors from allSales
  function buildAggregates({ allSales, rosterSet }) {
    const { start, end } = getWeekRangeEST();
    const cutoff45d = nowInEST().getTime() - 45 * 24 * 3600 * 1000;

    const weekPerAgent = new Map();
    const weekAgg = { calls: 0, av12x: 0, deals: 0 }; // calls filled from callsByAgent later
    const vendorAgg = new Map();
    let vendorDealsTotal = 0;

    for (const s of allSales || []) {
      const ts = parseSaleDateEST(s.dateSold || s.date || s.createdAt);
      if (!Number.isFinite(ts)) continue;

      const rawAgent = s.agent || s.seller || '';
      const cName = norm(canonicalName(rawAgent));

      // ignore non-roster
      if (!rosterSet.has(cName)) continue;

      const vendorRaw = String(s.soldProductName || '').trim();
      const vendor = VENDOR_SET.has(vendorRaw) ? vendorRaw : null;

      const amount = Number(s.amount || s.av || 0);
      const av12x = toAv12x(amount, s.av12x || s.av12X);

      // Weekly (Fri–Thu) stats
      if (ts >= start && ts < end) {
        const row = weekPerAgent.get(cName) || { av12x: 0, deals: 0, name: canonicalName(rawAgent) };
        row.av12x += av12x;
        row.deals += 1;
        weekPerAgent.set(cName, row);

        weekAgg.deals += 1;
        weekAgg.av12x += av12x;
      }

      // 45d vendor stats (rolling)
      if (vendor && ts >= cutoff45d) {
        let v = vendorAgg.get(vendor);
        if (!v) {
          v = { name: vendor, deals: 0 };
          vendorAgg.set(vendor, v);
        }
        v.deals += 1;
        vendorDealsTotal += 1;
      }
    }

    // vendor shares
    const vendorRows = Array.from(vendorAgg.values())
      .map(v => ({
        ...v,
        pct: vendorDealsTotal ? +(v.deals * 100 / vendorDealsTotal).toFixed(1) : 0
      }))
      .sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name));

    return { weekPerAgent, weekAgg, vendorRows, vendorDealsTotal };
  }

  // ---------- Boards

  function renderRosterBoard({ weekPerAgent, resolvePhoto, roster }) {
    setView('This Week — Roster');

    const rows = [];
    for (const p of roster || []) {
      const cName = norm(canonicalName(p.name));
      const wk = weekPerAgent.get(cName) || { av12x: 0, deals: 0 };
      rows.push({
        name: p.name,
        av12x: wk.av12x,
        deals: wk.deals,
        photoUrl: resolvePhoto({ name: p.name })
      });
    }
    rows.sort((a, b) => b.av12x - a.av12x || b.deals - a.deals || a.name.localeCompare(b.name));

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Submitted AV</th>
          <th class="right">Deals</th>
        </tr>`;
    }
    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => agentRowHTML({
        name: r.name,
        col1: fmtMoney(r.av12x),
        col2: (r.deals || 0).toLocaleString(),
        photoUrl: r.photoUrl
      })).join('');
    }
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a, b) => (b.av || 0) - (a.av || 0));

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">YTD AV</th>
        </tr>`;
    }

    if (bodyEl) {
      const listHTML = rows.map(p => agentRowHTML({
        name: p.name,
        col1: fmtMoney(p.av || p.ytd_av || 0),
        photoUrl: resolvePhoto({ name: p.name })
      })).join('');
      bodyEl.innerHTML = listHTML + `
        <tr class="total">
          <td><strong>Total</strong></td>
          <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
        </tr>`;
    }
  }

  async function renderWeeklyActivityBoard({ resolvePhoto }) {
    setView('Weekly Activity');

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
        </tr>`;
    }

    const json = await fetchJSON(ENDPOINTS.weeklyOverride);
    if (!json || typeof json !== 'object' || !Object.keys(json).length) {
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td colspan="7" style="padding:18px;color:#5c6c82;">
              No weekly activity override loaded.
            </td>
          </tr>`;
      }
      return;
    }

    const rows = [];
    for (const [email, stats] of Object.entries(json)) {
      const leads = Number(stats.leads || 0);
      const sold = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talkMin = Number(stats.talkMin || stats.talk_min || 0);
      const logMin = Number(stats.loggedMin || stats.log_min || 0);
      const conv = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      const guessedName = (stats.name ||
        (email || '').split('@')[0].replace(/\./g, ' ')
      ).replace(/\b\w/g, c => c.toUpperCase());

      rows.push({
        name: guessedName,
        leads,
        sold,
        conv,
        calls,
        talkMin,
        logMin,
        photoUrl: resolvePhoto({ email, name: guessedName })
      });
    }

    rows.sort((a, b) => b.sold - a.sold || b.leads - a.leads || a.name.localeCompare(b.name));

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => `
        <tr>
          <td style="display:flex;align-items:center;">
            ${avatarHTML(r.photoUrl, r.name)}${r.name}
          </td>
          <td class="right">${r.leads.toLocaleString()}</td>
          <td class="right">${r.sold.toLocaleString()}</td>
          <td class="right">${r.conv}%</td>
          <td class="right">${r.calls.toLocaleString()}</td>
          <td class="right">${r.talkMin.toLocaleString()}</td>
          <td class="right">${r.logMin.toLocaleString()}</td>
        </tr>`).join('');
    }
  }

  function renderVendorsBoard({ vendorRows, vendorDealsTotal }) {
    setView('Lead Vendors — Last 45 Days');

    if (!vendorRows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td style="padding:18px;color:#5c6c82;">
              No vendor data for last 45 days.
            </td>
          </tr>`;
      }
      return;
    }

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Vendor</th>
          <th class="right">Deals (45d)</th>
          <th class="right">% of total</th>
        </tr>`;
    }

    const COLORS = [
      '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
    ];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    const size = 260;
    const cx = size / 2;
    const cy = size / 2;
    const r  = size / 2 - 10;

    const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const arcPath = (a0, a1) => {
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const [x0, y0] = polar(cx, cy, r, a0);
      const [x1, y1] = polar(cx, cy, r, a1);
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };

    let acc = -Math.PI / 2;
    const arcs = vendorRows.map(v => {
      const span = vendorDealsTotal ? 2 * Math.PI * (v.deals / vendorDealsTotal) : 0;
      const d = arcPath(acc, acc + span);
      acc += span;
      return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="28" fill="none"></path>`;
    }).join('');

    const donut = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r - 18}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="12" fill="#9fb0c8">
          Deals (45d)
        </text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="22" font-weight="700" fill="#ffd36a">
          ${vendorDealsTotal.toLocaleString()}
        </text>
      </svg>
    `;

    const legend = vendorRows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.name)}"></span>
        <span class="label">${v.name}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.pct}%</span>
      </div>`).join('');

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px;">
          <div class="vendor-flex">
            ${donut}
            <div class="legend">${legend}</div>
          </div>
        </td>
      </tr>`;

    const listRows = vendorRows.map(v => `
      <tr>
        <td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.name)}">${v.pct}%</td>
      </tr>`).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${vendorDealsTotal.toLocaleString()}</strong></td>
        <td></td>
      </tr>`;

    if (bodyEl) {
      bodyEl.innerHTML = donutRow + listRows + totals;
    }
  }

  function renderParBoard({ par }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];

    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td style="padding:18px;color:#5c6c82;">
              No PAR list provided.
            </td>
          </tr>`;
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
      bodyEl.innerHTML = agents.map(a => `
        <tr>
          <td>${a.name}</td>
          <td class="right">${safe(a.take_rate, 0)}%</td>
          <td class="right">${fmtMoney(safe(a.ytd_av, 0))}</td>
        </tr>`).join('') + `
        <tr class="total">
          <td><strong>PACE TO QUALIFY</strong></td>
          <td></td>
          <td class="right"><strong>${fmtMoney(pace)}</strong></td>
        </tr>`;
    }
  }

  async function renderAgentOfWeek({ weekPerAgent, resolvePhoto, ytdList }) {
    setView('Agent of the Week');

    const per = Array.from(weekPerAgent.values());
    if (!per.length) {
      if (headEl) headEl.innerHTML = `<tr><th>AGENT OF THE WEEK</th></tr>`;
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td style="padding:18px;color:#5c6c82;">
              No weekly submissions yet.
            </td>
          </tr>`;
      }
      return;
    }

    per.sort((a, b) => b.av12x - a.av12x || b.deals - a.deals);

    const top = per[0];
    const name = top.name || '';
    const want = norm(canonicalName(name));

    let ytdAv = 0;
    if (Array.isArray(ytdList)) {
      const hit = ytdList.find(
        r => norm(canonicalName(r.name)) === want
      );
      if (hit) ytdAv = Number(hit.av || hit.ytd_av || 0) || 0;
    }

    const photo = resolvePhoto({ name });
    const ini = initialsOf(name);

    if (headEl) {
      headEl.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;
    }
    if (bodyEl) {
      bodyEl.innerHTML = `
        <tr>
          <td colspan="4" style="padding:26px 18px;">
            <div style="display:flex;align-items:center;gap:18px;">
              ${
                photo
                  ? `<img src="${photo}" style="width:92px;height:92px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3);" />`
                  : `<div style="width:92px;height:92px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;border:2px solid rgba(255,255,255,.3);">${ini}</div>`
              }
              <div style="flex:1;">
                <div style="font-size:22px;font-weight:700;text-transform:lowercase;">
                  ${name}
                </div>
                <div style="margin-top:4px;opacity:.9;">
                  Weekly Submitted AV • ${fmtMoney(top.av12x)}
                </div>
                <div style="margin-top:2px;opacity:.8;">
                  Deals this week • ${top.deals.toLocaleString()}
                </div>
                <div style="margin-top:2px;opacity:.8;">
                  YTD AV • ${fmtMoney(ytdAv)}
                </div>
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

  // ---------- Rules banner rotation
  function startRuleRotation(rulesJson) {
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list = Array.isArray(rulesJson?.rules)
      ? rulesJson.rules.filter(Boolean)
      : [];

    if (!list.length) {
      setBanner(base, 'Do not be entitled. Earn everything. Choose hard work over handouts... always.');
      return;
    }

    let i = 0;
    const apply = () => setBanner(base, list[i % list.length]);
    apply();
    setInterval(() => { i++; apply(); }, 12 * 60 * 60 * 1000);
  }

  // ---------- Live sale polling (splash + vendor refresh)
  function startLiveSalePolling({ rosterSet }) {
    const POLL_MS = 12_000;
    const windowMs = 45 * 24 * 3600 * 1000;

    const tick = async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;

      const allSales = Array.isArray(sold.allSales) ? sold.allSales : [];
      const now = nowInEST().getTime();
      const cutoff = now - windowMs;

      const vendorAgg = new Map();
      let vendorDealsTotal = 0;
      let newSale = false;

      for (const s of allSales) {
        const ts = parseSaleDateEST(s.dateSold || s.date || s.createdAt);
        if (!Number.isFinite(ts) || ts < cutoff) continue;

        const rawAgent = s.agent || s.seller || '';
        const cName = norm(canonicalName(rawAgent));
        if (!rosterSet.has(cName)) continue;

        const vendorRaw = String(s.soldProductName || '').trim();
        const vendor = VENDOR_SET.has(vendorRaw) ? vendorRaw : null;
        if (!vendor) continue;

        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newSale = true;
          showSplash({
            name: canonicalName(rawAgent),
            amount: s.amount || s.av,
            soldProductName: vendorRaw
          });
        }

        let v = vendorAgg.get(vendor);
        if (!v) {
          v = { name: vendor, deals: 0 };
          vendorAgg.set(vendor, v);
        }
        v.deals += 1;
        vendorDealsTotal += 1;
      }

      if (newSale) {
        const vendorRows = Array.from(vendorAgg.values())
          .map(v => ({
            ...v,
            pct: vendorDealsTotal
              ? +(v.deals * 100 / vendorDealsTotal).toFixed(1)
              : 0
          }))
          .sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name));

        renderVendorsBoard({ vendorRows, vendorDealsTotal });
      }
    };

    setInterval(tick, POLL_MS);
  }

  // ---------- Boot
  (async () => {
    try {
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

      const { resolve: resolvePhoto, rosterSet } = buildRosterMaps(roster || []);

      const allSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
      const { weekPerAgent, weekAgg, vendorRows, vendorDealsTotal } =
        buildAggregates({ allSales, rosterSet });

      // plug in calls for weekAgg from /calls_by_agent if team total exists
      if (calls && calls.team && typeof calls.team.calls === 'number') {
        weekAgg.calls = calls.team.calls;
      }

      const ytdTotal = (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0;

      // populate cards (This Week — AV/Deals)
      renderCards({ weekAgg });

      // banner rules
      startRuleRotation(rules || {});

      // start board rotation
      const boards = [
        () => renderRosterBoard({ weekPerAgent, resolvePhoto, roster }),
        () => renderYtdBoard({ ytdList: ytdList || [], ytdTotal, resolvePhoto }),
        () => renderWeeklyActivityBoard({ resolvePhoto }),
        () => renderVendorsBoard({ vendorRows, vendorDealsTotal }),
        () => renderParBoard({ par: par || {} }),
        () => renderAgentOfWeek({ weekPerAgent, resolvePhoto, ytdList: ytdList || [] })
      ];

      let idx = 0;
      const paint = () => boards[idx % boards.length]();
      paint();
      setInterval(() => { idx = (idx + 1) % boards.length; paint(); }, 30_000);

      // start live vendor refresh & splash
      startLiveSalePolling({ rosterSet });

    } catch (err) {
      console.error(err);
      setBanner(
        'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT',
        'Error loading data.'
      );
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td style="padding:18px;color:#5c6c82;">
              Could not load dashboard data.
            </td>
          </tr>`;
      }
    }
  })();
})();

// ---------- OE Countdown (fixed)
(() => {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;

  const deadline = new Date('2025-12-15T23:59:59-05:00');
  const pad = (n) => String(n).padStart(2, '0');

  function tick() {
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
    requestAnimationFrame(() => setTimeout(tick, 250));
  }

  tick();
})();
