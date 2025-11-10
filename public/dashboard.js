/* FEW Dashboard — Single File
   Boards (30s rotate):
     1. This Week — Roster  (Fri–Thu EST sales week, AV = 12x amounts when provided)
     2. YTD — Team          (from ytd_av.json / ytd_total.json)
     3. Weekly Activity     (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, from team_sold.allSales)
     5. PAR — Tracking
     6. Agent of the Week   (auto from weekly team_sold)
   Extras:
     - Center splash on new sale
     - Vendor donut + legend
     - Headshots w/ canonical names
     - Rules rotation every 12h
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
  const fmtMoney = (n) => {
    const v = Number(n) || 0;
    return `$${Math.round(v).toLocaleString()}`;
  };
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

  // EST helper
  function parseSaleDateEST(raw) {
    if (!raw) return NaN;
    const s = String(raw).trim();
    if (/[+-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }
    const withEST = Date.parse(s + ' EST');
    if (Number.isFinite(withEST)) return withEST;
    const withET = Date.parse(s + ' ET');
    if (Number.isFinite(withET)) return withET;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  // --------- This Week range (Fri–Thu in EST)
  function getWeekRangeEST_FriThu() {
    const now = new Date();
    // approximate EST by shifting from local to UTC then minus 5h; precise TZ offset not critical for boundary if API dates already EST
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const estNow = new Date(utc - 5 * 3600 * 1000);

    const d = new Date(estNow.getTime());
    const day = d.getUTCDay(); // 0=Sun..6=Sat on EST-adjusted clock
    // we want Friday as day 5 → backtrack ((day - 5 + 7) % 7)
    const diffToFri = (day - 5 + 7) % 7;
    d.setUTCDate(d.getUTCDate() - diffToFri);
    d.setUTCHours(5, 0, 0, 0); // 00:00 EST == 05:00 UTC

    const start = d.getTime();
    const end = start + 7 * 24 * 3600 * 1000; // next Fri 00:00 EST

    return { start, end };
  }

  // --------- Vendor labels (18)
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

  // --------- Name aliases
  const NAME_ALIASES = new Map([
    ['fabricio a navarrete', 'f n'],
    ['fabricio navarrete', 'f n'],
    ['fabricio navarrete cervantes', 'f n'],
    ['fabricio cervantes', 'f n'],
    ['f n', 'f n'],
    ['ajani senior', 'a s'],
    ['ajani s', 'a s'],
    ['a s', 'a s'],
  ]);
  const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  // --------- Headshot resolver
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

    return ({ name, email }) => {
      const cName = norm(canonicalName(name || ''));
      const em = String(email || '').trim().toLowerCase();
      return (
        byName.get(cName) ||
        byEmail.get(em) ||
        null
      );
    };
  }

  // --------- Layout anchors
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

  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // --------- Minimal CSS (avatars, donut, splash)
  (function injectCSS(){
    if (document.getElementById('few-inline-css')) return;
    const css = `
      .right{ text-align:right; font-variant-numeric:tabular-nums; }
      .splash{
        position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
        background:linear-gradient(135deg,#a68109,#ffd34d);
        color:#111; padding:22px 28px; border-radius:16px;
        box-shadow:0 18px 48px rgba(0,0,0,.45); z-index:9999; min-width:320px; text-align:center;
      }
      .splash .big{ font-size:24px; font-weight:900; }
      .splash .mid{ font-size:20px; font-weight:800; margin-top:4px; }
      .splash .sub{ font-size:12px; opacity:.85; margin-top:6px; }
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
      <div class="big">${name || 'New Sale'}</div>
      <div class="mid">${fmtMoney(amount || 0)}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60_000);
  }

  const seenLeadIds = new Set();
  const saleId = (s) =>
    String(s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`);

  // --------- Cards (This Week)
  function renderCards({ calls, sold }) {
    const { start, end } = getWeekRangeEST_FriThu();

    let callsVal = 0;
    if (Array.isArray(calls?.perAgent)) {
      callsVal = calls.perAgent.reduce((sum, a) => sum + (Number(a.calls || 0)), 0);
    } else if (calls?.team?.calls) {
      callsVal = Number(calls.team.calls || 0);
    }

    let dealsVal = 0;
    let av12x = 0;

    const allSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < start || t >= end) continue;
      dealsVal += 1;
      // prefer API av12x / av12X / totalAV12X; otherwise assume already 12x in amount
      const raw = Number(
        s.av12x || s.av12X || s.totalAV12X || s.amount || 0
      );
      av12x += raw;
    }

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(av12x);
    if (cards.deals) cards.deals.textContent = (dealsVal || 0).toLocaleString();
  }

  // --------- Helper row renderer
  function agentRowHTML({ name, right1, right2, photoUrl }) {
    const initials = (name || '')
      .split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6;">${initials || '?'}</div>`;

    return `
      <tr>
        <td style="display:flex;align-items:center;">${avatar}${name}</td>
        <td class="right">${right1}</td>
        ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
      </tr>
    `;
  }

  // --------- Vendors summarizer (45d rolling)
  function summarizeVendors45d(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();

    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < cutoff) continue;

      const vendorRaw = String(s.soldProductName || '').trim();
      if (!VENDOR_SET.has(vendorRaw)) continue;

      const key = vendorRaw;
      const row = byName.get(key) || { name: key, deals: 0 };
      row.deals += 1;
      byName.set(key, row);
    }

    const rows = [...byName.values()];
    const totalDeals = rows.reduce((a, r) => a + r.deals, 0) || 0;

    for (const r of rows) {
      r.shareDeals = totalDeals ? +(r.deals * 100 / totalDeals).toFixed(1) : 0;
    }

    rows.sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name));
    return { rows, totalDeals };
  }

  // --------- Roster Board (This Week — Roster)
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');
    const { start, end } = getWeekRangeEST_FriThu();
    const per = new Map();

    const allSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const nameKey = norm(canonicalName(s.agent || s.agentName || ''));
      const curr = per.get(nameKey) || { av: 0, deals: 0 };
      const amt = Number(
        s.av12x || s.av12X || s.totalAV12X || s.amount || 0
      );
      curr.av += amt;
      curr.deals += 1;
      per.set(nameKey, curr);
    }

    const rows = (roster || []).map(p => {
      const key = norm(canonicalName(p.name));
      const d = per.get(key) || { av: 0, deals: 0 };
      const photo = resolvePhoto({ name: p.name, email: p.email });
      return {
        name: p.name,
        av: d.av,
        deals: d.deals,
        photo
      };
    });

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
        photoUrl: r.photo
      })).join('');
    }
  }

  // --------- YTD Board
  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b)=> (b.av || 0) - (a.av || 0));

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

      bodyEl.innerHTML = html + `
        <tr class="total">
          <td><strong>Total</strong></td>
          <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
        </tr>
      `;
    }
  }

  // --------- WEEKLY ACTIVITY (manual override)
  async function renderWeeklyActivity() {
    setView('Weekly Activity');

    const [override, roster] = await Promise.all([
      fetchJSON('/calls_week_override.json'),
      fetchJSON(ENDPOINTS.roster)
    ]);

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

    if (!override || typeof override !== 'object') {
      if (bodyEl) {
        bodyEl.innerHTML = `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">
          No weekly activity override loaded.
        </td></tr>`;
      }
      return;
    }

    const rosterArr = Array.isArray(roster) ? roster : [];
    const byEmail = new Map();
    for (const p of rosterArr) {
      const em = (p.email || '').trim().toLowerCase();
      if (em) byEmail.set(em, p);
    }

    const rows = [];
    for (const [email, stats] of Object.entries(override)) {
      const em = (email || '').toLowerCase();
      const profile = byEmail.get(em) || {};
      const name = profile.name ||
        (stats.name || (email || '').split('@')[0].replace(/\./g,' '));

      const leads = Number(stats.leads || 0);
      const sold = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talkMin = Number(stats.talkMin || 0);
      const logMin = Number(stats.loggedMin || stats.logMin || 0);
      const conv = leads > 0 ? +(sold * 100 / leads).toFixed(1) : 0;

      let photoUrl = profile.photo || '';
      if (photoUrl && !photoUrl.startsWith('http') && !photoUrl.startsWith('/')) {
        photoUrl = `/headshots/${photoUrl}`;
      }

      rows.push({ name, leads, sold, calls, talkMin, logMin, conv, photoUrl });
    }

    rows.sort((a,b)=> b.sold - a.sold || b.leads - a.leads);

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => {
        const initials = r.name.split(/\s+/)
          .map(w => (w[0] || '').toUpperCase()).join('');
        const avatar = r.photoUrl
          ? `<img src="${r.photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
          : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6;">${initials}</div>`;
        return `
          <tr>
            <td style="display:flex;align-items:center;">${avatar}${r.name}</td>
            <td class="right">${r.leads}</td>
            <td class="right">${r.sold}</td>
            <td class="right">${r.conv}%</td>
            <td class="right">${r.calls}</td>
            <td class="right">${r.talkMin}</td>
            <td class="right">${r.logMin}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // --------- Vendors Board (45d rolling)
  function renderVendorsBoard({ sold }) {
    setView('Lead Vendors — Last 45 Days');

    const allSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const { rows, totalDeals } = summarizeVendors45d(allSales);

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">
          No vendor data in last 45 days.
        </td></tr>`;
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
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
    ];
    const colorFor = (name='') => {
      const h = [...name].reduce((a,c)=> a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    const size = 260;
    const cx = size/2, cy = size/2, r = size/2 - 16;
    const polar = (cx,cy,r,a)=>[cx + r*Math.cos(a), cy + r*Math.sin(a)];
    const arcPath = (a0,a1)=>{
      const [x0,y0] = polar(cx,cy,r,a0);
      const [x1,y1] = polar(cx,cy,r,a1);
      const large = (a1-a0) > Math.PI ? 1 : 0;
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };

    let acc = -Math.PI/2;
    const arcs = rows.map(v => {
      const span = totalDeals ? 2*Math.PI*(v.deals/totalDeals) : 0;
      const d = arcPath(acc, acc+span);
      acc += span;
      return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="26" fill="none"></path>`;
    }).join('');

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-20}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-4}" text-anchor="middle" font-size="12" fill="#9fb0c8">
          Deals (45d)
        </text>
        <text x="${cx}" y="${cy+18}" text-anchor="middle" font-size="22" font-weight="700" fill="#ffd36a">
          ${totalDeals}
        </text>
      </svg>
    `;

    const legend = rows.map(v => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0;">
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${colorFor(v.name)};"></span>
          ${v.name}
        </span>
        <span style="font-variant-numeric:tabular-nums;color:#9fb0c8;">
          ${v.deals} • ${v.shareDeals}%
        </span>
      </div>
    `).join('');

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px;">
          <div style="display:flex;gap:30px;align-items:center;flex-wrap:wrap;">
            ${svg}
            <div style="min-width:260px;">${legend}</div>
          </div>
        </td>
      </tr>
    `;

    const rowsHTML = rows.map(v => `
      <tr>
        <td>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorFor(v.name)};margin-right:8px;"></span>
          ${v.name}
        </td>
        <td class="right">${v.deals}</td>
        <td class="right" style="color:${colorFor(v.name)}">${v.shareDeals}%</td>
      </tr>
    `).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals}</strong></td>
        <td></td>
      </tr>
    `;

    if (bodyEl) {
      bodyEl.innerHTML = donutRow + rowsHTML + totals;
    }
  }

  // --------- PAR Board
  function renderParBoard({ par }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];

    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">
          No PAR list provided.
        </td></tr>`;
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

  // --------- Agent of the Week
  async function renderAgentOfWeekAuto(data) {
    setView('Agent of the Week');

    const perAgent = Array.isArray(data?.sold?.perAgent)
      ? data.sold.perAgent
      : [];

    if (!perAgent.length) {
      if (headEl) headEl.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (bodyEl) bodyEl.innerHTML =
        `<tr><td style="padding:18px;color:#5c6c82;">No weekly data.</td></tr>`;
      return;
    }

    let top = null;
    for (const row of perAgent) {
      const name = canonicalName(row.name || row.agent || '');
      const av = Number(row.av12x || row.av12X || row.amount || 0);
      const deals = Number(row.sales || row.deals || 0);
      if (!top || av > top.av) top = { name, av, deals };
    }
    if (!top) return;

    const resolvePhoto = data.resolvePhoto || (() => null);
    const photo = resolvePhoto({ name: top.name });
    const initials = top.name.split(/\s+/)
      .map(w => (w[0] || '').toUpperCase()).join('');

    let ytdVal = 0;
    if (Array.isArray(data.ytdList)) {
      const hit = data.ytdList.find(x => norm(x.name) === norm(top.name));
      if (hit) ytdVal = Number(hit.av || 0);
    }

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
  }

  // --------- Rules rotation
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

  // --------- Load all & boot
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

    const soldSafe = sold || {};
    if (!Array.isArray(soldSafe.allSales)) {
      soldSafe.allSales = Array.isArray(soldSafe.sales) ? soldSafe.sales : [];
    }

    for (const s of soldSafe.allSales) {
      seenLeadIds.add(saleId(s));
    }

    return {
      rules: rules || {},
      roster: roster || [],
      calls: calls || {},
      sold: soldSafe,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || {},
      resolvePhoto
    };
  }

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

  function startLiveSalePolling(initialData) {
    const POLL_MS = 12_000;
    const window45 = 45 * 24 * 3600 * 1000;

    setInterval(async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;

      const allSales = Array.isArray(sold.allSales) ? sold.allSales : [];
      const cutoff = Date.now() - window45;

      const rolled = [];
      let newFound = false;

      for (const s of allSales) {
        const t = parseSaleDateEST(s.dateSold || s.date);
        if (!Number.isFinite(t) || t < cutoff) continue;

        rolled.push(s);

        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newFound = true;
          showSplash({
            name: s.agent || 'Agent',
            amount: s.av12x || s.av12X || s.totalAV12X || s.amount || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      if (!rolled.length) return;

      const data = {
        ...initialData,
        sold: { ...sold, allSales: rolled }
      };

      if (newFound) {
        renderCards({ calls: initialData.calls, sold: data.sold });
        renderVendorsBoard(data);
      }
    }, POLL_MS);
  }

  (async () => {
    try {
      const data = await loadAll();
      renderCards(data);
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

// ---------- OE Countdown (to Dec 15, 2025 11:59 PM EST) ----------
(function () {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;

  const deadline = new Date('2025-12-15T23:59:59-05:00');

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
