/* FEW Dashboard — Single File
   Boards (30s rotate):
     1. This Week — Roster (Fri–Thu EST sales week, AV = amount * 12)
     2. YTD — Team
     3. Weekly Activity (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, no weekly reset)
     5. PAR — Tracking
     6. Agent of the Week (auto from sales week, not manual)

   Extras:
     - Center splash on new sale (60s)
     - Vendor donut + legend
     - Headshots w/ canonical names (Ajani → "a s", Fabricio → "f n")
     - Rules rotation every 12h
     - 45d rolling vendor aggregation from /api/team_sold (allSales)
     - OE Countdown → Dec 15, 2025 11:59 PM EST
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
  const safe = (v, d) => (v === undefined || v === null || Number.isNaN(v) ? d : v);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function nowInEST() {
    const now = new Date();
    const est = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(est);
  }

  // Sales week = Friday 00:00:00 EST → next Friday 00:00:00 EST
  function getSalesWeekRangeEST() {
    const d = nowInEST();
    const day = d.getDay(); // 0=Sun .. 6=Sat
    const diffToFriday = (day + 2) % 7; // Fri(5)->0, Thu(4)->6, etc.
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diffToFriday);
    const start = d.getTime();
    const endDate = new Date(d);
    endDate.setDate(endDate.getDate() + 7);
    const end = endDate.getTime();
    return { start, end };
  }

  function parseSaleDateEST(raw) {
    if (!raw) return NaN;
    const s = String(raw).trim();
    if (/[+-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }
    const try1 = Date.parse(s + ' EST');
    if (Number.isFinite(try1)) return try1;
    const try2 = Date.parse(s + ' ET');
    if (Number.isFinite(try2)) return try2;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  // --------- Vendor labels (only these count)
  const VENDOR_LABELS = [
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
  ];
  const VENDOR_SET = new Set(VENDOR_LABELS);

  // --------- Canonical names & exclusions
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
  ]);
  const canonicalName = (name) =>
    NAME_ALIASES.get(norm(name)) || String(name || '').trim();

  // These must NOT count.
  const EXCLUDED_AGENTS = new Set([
    norm('A C'),
    norm('Abigail Austin')
  ]);

  const saleAv12x = (s) => {
    if (s.av12x !== undefined) return +s.av12x || 0;
    if (s.av12X !== undefined) return +s.av12X || 0;
    const amt = +s.amount || 0;
    return amt * 12;
  };

  const inCurrentSalesWeek = (s) => {
    const t = parseSaleDateEST(s.dateSold || s.date);
    if (!Number.isFinite(t)) return false;
    const { start, end } = getSalesWeekRangeEST();
    return t >= start && t < end;
  };

  const isVendorAllowed = (label) =>
    VENDOR_SET.has(String(label || '').trim());

  const isAgentIncluded = (agentName) => {
    const c = norm(canonicalName(agentName));
    return c && !EXCLUDED_AGENTS.has(c);
  };

  // --------- Fetch helper
  async function fetchJSON(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON failed:', url, e);
      return null;
    }
  }

  // --------- Headshot resolver
  function buildHeadshotResolver(roster) {
    const byName = new Map();
    const byEmail = new Map();

    const photoURL = (p) => {
      if (!p) return null;
      const s = String(p);
      return (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
    };

    for (const p of roster || []) {
      const nameKey = norm(canonicalName(p.name));
      const email = String(p.email || '').trim().toLowerCase();
      const photo = photoURL(p.photo);
      if (nameKey && photo) byName.set(nameKey, photo);
      if (email && photo) byEmail.set(email, photo);
    }

    return ({ name, email }) => {
      const key = norm(canonicalName(name));
      const mail = String(email || '').trim().toLowerCase();
      return byName.get(key) || byEmail.get(mail) || null;
    };
  }

  // --------- Layout hooks (matches your existing HTML)
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

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s) => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub)   bannerSub.textContent   = s || '';
  };

  // Kill any old ticker element that might conflict.
  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  // --------- Small UI helpers
  const initials = (name = '') =>
    name.trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

  const avatarHTML = (name, photoUrl) => {
    const ini = initials(name || '?');
    return photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${ini}</div>`;
  };

  const agentRowHTML = ({ name, cols, photoUrl }) => `
    <tr>
      <td style="display:flex;align-items:center">
        ${avatarHTML(name, photoUrl)}<span>${name}</span>
      </td>
      ${cols.map(v => `<td class="right">${v}</td>`).join('')}
    </tr>
  `;

  // --------- Inject minimal CSS (donut + splash)
  (function injectCSS() {
    if (document.getElementById('few-inline-css')) return;
    const css = `
      .right{ text-align:right;font-variant-numeric:tabular-nums; }
      .vendor-flex{ display:flex;gap:20px;align-items:center;flex-wrap:wrap; }
      .legend{ min-width:260px; }
      .legend-item{ display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #1b2534; }
      .legend-item .label{ color:#cfd7e3; }
      .legend-item .val{ color:#9fb0c8;font-variant-numeric:tabular-nums; }
      .dot{ display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:middle; }
      .splash{
        position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
        background:linear-gradient(135deg,#a68109,#ffd34d);
        color:#1a1a1a;padding:22px 28px;border-radius:16px;
        box-shadow:0 18px 48px rgba(0,0,0,.45);
        z-index:9999;min-width:320px;text-align:center;
      }
      .splash .big{font-size:24px;font-weight:900;}
      .splash .mid{font-size:20px;font-weight:800;margin-top:6px;}
      .splash .sub{font-size:12px;opacity:.85;margin-top:8px;}
    `;
    const tag = document.createElement('style');
    tag.id = 'few-inline-css';
    tag.textContent = css;
    document.head.appendChild(tag);
  })();

  // --------- New sale splash
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name || 'New Sale'}</div>
      <div class="mid">${fmtMoney(amount)}</div>
      <div class="sub">${soldProductName || ''}</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60000);
  }

  const seenLeadIds = new Set();
  const saleId = (s) =>
    String(s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`);

  // --------- Build summaries from allSales
  function buildSummaries(allSalesRaw) {
    const allSales = Array.isArray(allSalesRaw) ? allSalesRaw : [];
    const { start, end } = getSalesWeekRangeEST();
    const cutoff45 = nowInEST().getTime() - 45 * 24 * 3600 * 1000;

    let weekDeals = 0;
    let weekAv12x = 0;
    const perAgentWeek = new Map();
    const vendorAgg45 = new Map();
    let vendorDeals45 = 0;

    for (const s of allSales) {
      const when = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(when)) continue;

      const agent = s.agent || s.writing_agent || s.seller || '';
      const vendor = s.soldProductName || s.vendor || '';
      const av12 = saleAv12x(s);

      if (when >= start && when < end && isAgentIncluded(agent)) {
        weekDeals += 1;
        weekAv12x += av12;
        const key = canonicalName(agent);
        const prev = perAgentWeek.get(key) || { name: key, deals: 0, av: 0 };
        prev.deals += 1;
        prev.av += av12;
        perAgentWeek.set(key, prev);
      }

      if (when >= cutoff45 && isVendorAllowed(vendor) && isAgentIncluded(agent)) {
        vendorDeals45 += 1;
        const key = String(vendor).trim();
        const row = vendorAgg45.get(key) || { vendor: key, deals: 0 };
        row.deals += 1;
        vendorAgg45.set(key, row);
      }
    }

    const vendorRows = [...vendorAgg45.values()];
    for (const r of vendorRows) {
      r.share = vendorDeals45 ? +(r.deals * 100 / vendorDeals45).toFixed(1) : 0;
    }
    vendorRows.sort((a, b) => b.deals - a.deals || a.vendor.localeCompare(b.vendor));

    return { weekDeals, weekAv12x, perAgentWeek, vendorDeals45, vendorRows };
  }

  // --------- Cards
  function renderCards({ calls, summaries }) {
    const callsVal = safe(calls?.team?.calls, 0);
    if (cards.calls) cards.calls.textContent = callsVal.toLocaleString();
    if (cards.deals) cards.deals.textContent = summaries.weekDeals.toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(summaries.weekAv12x);
  }

  // --------- Boards

  // 1) This Week — Roster
  function renderRosterBoard({ summaries, resolvePhoto }) {
    setView('This Week — Roster');
    const rows = [...summaries.perAgentWeek.values()].sort((a,b) => b.av - a.av);

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
        cols: [fmtMoney(r.av), r.deals.toLocaleString()],
        photoUrl: resolvePhoto({ name: r.name })
      })).join('');
    }
  }

  // 2) YTD — Team
  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b) => (b.av || b.ytd_av || 0) - (a.av || a.ytd_av || 0));

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">YTD AV</th>
        </tr>`;
    }
    if (bodyEl) {
      const body = rows.map(p => agentRowHTML({
        name: p.name,
        cols: [fmtMoney(p.av || p.ytd_av || 0)],
        photoUrl: resolvePhoto({ name: p.name })
      })).join('');
      bodyEl.innerHTML = body + `
        <tr class="total">
          <td><strong>Total</strong></td>
          <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
        </tr>`;
    }
  }

  // 3) Weekly Activity — calls_week_override.json
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
          <th class="right">Talk min</th>
          <th class="right">Log min</th>
        </tr>`;
    }

    const json = await fetchJSON('/calls_week_override.json');
    if (!json || typeof json !== 'object') {
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
    for (const [email, sRaw] of Object.entries(json)) {
      const s = sRaw || {};
      const em = (email || '').toLowerCase();
      const leads = Number(s.leads || 0);
      const sold  = Number(s.sold || 0);
      const calls = Number(s.calls || 0);
      const talk  = Number(s.talkMin || 0);
      const log   = Number(s.loggedMin || 0);
      const conv  = leads ? +(sold * 100 / leads).toFixed(1) : 0;
      let name = s.name || em.split('@')[0].replace(/\./g, ' ');
      name = canonicalName(name);
      rows.push({ name, leads, sold, conv, calls, talk, log, email: em });
    }

    rows.sort((a,b) => b.sold - a.sold || b.leads - a.leads);

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => {
        const photo = resolvePhoto({ name: r.name, email: r.email });
        return `
          <tr>
            <td style="display:flex;align-items:center">
              ${avatarHTML(r.name, photo)}<span>${r.name}</span>
            </td>
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

  // 4) Lead Vendors — Last 45 Days
  function renderVendorsBoard({ summaries }) {
    setView('Lead Vendors — Last 45 Days');

    const rows = summaries.vendorRows;
    const totalDeals = summaries.vendorDeals45;

    if (!rows.length) {
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

    const COLORS = [
      '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
    ];
    const colorFor = (name='') => {
      const h = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
      return COLORS[h % COLORS.length];
    };

    const size = 240;
    const cx = size/2, cy = size/2, r = size/2 - 8;
    const polar = (cx,cy,r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
    const arcPath = (cx,cy,r,a0,a1)=>{
      const large = (a1-a0) > Math.PI ? 1 : 0;
      const [x0,y0] = polar(cx,cy,r,a0);
      const [x1,y1] = polar(cx,cy,r,a1);
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };

    let acc = -Math.PI/2;
    const arcs = rows.map(v => {
      const span = totalDeals ? 2*Math.PI*(v.deals/totalDeals) : 0;
      const d = arcPath(cx,cy,r,acc,acc+span);
      acc += span;
      return `<path d="${d}" stroke="${colorFor(v.vendor)}" stroke-width="28" fill="none"></path>`;
    }).join('');

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-16}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals (45d)</text>
        <text x="${cx}" y="${cy+18}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">
          ${totalDeals.toLocaleString()}
        </text>
      </svg>`;

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Vendor</th>
          <th class="right">Deals (45d)</th>
          <th class="right">% of total</th>
        </tr>`;
    }

    const legend = rows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.vendor)}"></span>
        <span class="label">${v.vendor}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.share}%</span>
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
        <td><span class="dot" style="background:${colorFor(v.vendor)}"></span>${v.vendor}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.vendor)}">${v.share}%</td>
      </tr>`).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
      </tr>`;

    if (bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  // 5) PAR — Tracking
  function renderParBoard({ par }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];

    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td style="padding:18px;color:#5c6c82;">No PAR data.</td>
          </tr>`;
      }
      return;
    }

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Take Rate</th>
          <th class="right">Annual AV</th>
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
          <td><strong>Pace to Qualify</strong></td>
          <td></td>
          <td class="right"><strong>${fmtMoney(pace)}</strong></td>
        </tr>`;
    }
  }

  // 6) Agent of the Week
  function renderAgentOfWeek({ summaries, ytdList, resolvePhoto }) {
    setView('Agent of the Week');
    const rows = [...summaries.perAgentWeek.values()];
    if (!rows.length) {
      if (headEl) headEl.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      }
      return;
    }

    rows.sort((a,b)=> b.av - a.av);
    const top = rows[0];

    let ytdVal = 0;
    if (Array.isArray(ytdList)) {
      const hit = ytdList.find(x =>
        norm(x.name) === norm(top.name) ||
        norm(canonicalName(x.name)) === norm(top.name)
      );
      if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
    }

    const photo = resolvePhoto({ name: top.name });
    const ini = initials(top.name);

    if (headEl) headEl.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;
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
              <div>
                <div style="font-size:22px;font-weight:700;text-transform:lowercase;">${top.name}</div>
                <div style="margin-top:4px;opacity:.9;">Weekly Submitted AV • ${fmtMoney(top.av)}</div>
                <div style="margin-top:2px;opacity:.7;">Deals this week • ${top.deals}</div>
                <div style="margin-top:2px;opacity:.7;">YTD AV • ${fmtMoney(ytdVal)}</div>
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
      ? rulesJson.rules.filter(x => x && String(x).trim())
      : [];

    if (!list.length) {
      setBanner(base, '1) Do not be entitled. Earn everything. Choose hard work over handouts... always.');
      return;
    }

    let i = 0;
    const apply = () => setBanner(base, list[i % list.length]);
    apply();
    setInterval(() => { i = (i + 1) % list.length; apply(); }, 12 * 60 * 60 * 1000);
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
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);

    const allSales =
      Array.isArray(sold?.allSales) ? sold.allSales :
      Array.isArray(sold) ? sold : [];

    const summaries = buildSummaries(allSales);

    for (const s of allSales) seenLeadIds.add(saleId(s));

    return {
      rules: rules || {},
      calls: calls || { team: { calls: 0 } },
      ytdList: Array.isArray(ytdList) ? ytdList : (Array.isArray(ytdList?.list) ? ytdList.list : []),
      ytdTotal: (ytdTotalJson && (ytdTotalJson.ytd_av_total || ytdTotalJson.total)) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto,
      summaries
    };
  }

  // --------- Board rotation
  function startBoardRotation(data) {
    const boards = [
      () => renderRosterBoard(data),
      () => renderYtdBoard(data),
      () => renderWeeklyActivityBoard(data),
      () => renderVendorsBoard(data),
      () => renderParBoard(data),
      () => renderAgentOfWeek(data)
    ];
    let i = 0;
    const paint = () => boards[i % boards.length]();
    paint();
    setInterval(() => { i = (i + 1) % boards.length; paint(); }, 30000);
  }

  // --------- Live polling (keeps everything in sync; same source)
  function startLiveSalePolling(baseData) {
    const POLL_MS = 15000;

    async function tick() {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;
      const allSales =
        Array.isArray(sold.allSales) ? sold.allSales :
        Array.isArray(sold) ? sold : [];

      let newSale = false;
      for (const s of allSales) {
        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newSale = true;
          if (inCurrentSalesWeek(s) && isAgentIncluded(s.agent || '')) {
            showSplash({
              name: canonicalName(s.agent || 'Agent'),
              amount: saleAv12x(s),
              soldProductName: s.soldProductName || ''
            });
          }
        }
      }
      if (!newSale) return;

      const summaries = buildSummaries(allSales);
      baseData.summaries = summaries;
      renderCards({ calls: baseData.calls, summaries });
      renderRosterBoard(baseData);
      renderVendorsBoard(baseData);
      renderAgentOfWeek(baseData);
    }

    setInterval(tick, POLL_MS);
  }

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();
      renderCards({ calls: data.calls, summaries: data.summaries });
      startRuleRotation(data.rules);
      startBoardRotation(data);
      startLiveSalePolling(data);
    } catch (err) {
      console.error('Dashboard init failed:', err);
      setBanner(
        'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT',
        'Error loading data.'
      );
      if (bodyEl) {
        bodyEl.innerHTML = `
          <tr>
            <td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td>
          </tr>`;
      }
    }
  })();
})();

// --------- OE Countdown → Dec 15, 2025 11:59 PM EST
(() => {
  const el = document.querySelector('#oeTimer');
  if (!el) return;

  const deadline = new Date('2025-12-15T23:59:59-05:00');
  const pad = (n) => String(n).padStart(2, '0');

  function update() {
    const now = new Date();
    const diff = deadline - now;
    if (diff <= 0) {
      el.textContent = 'LIVE!';
      return;
    }
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);
    el.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    requestAnimationFrame(() => setTimeout(update, 250));
  }

  update();
})();
