293?/* FEW Dashboard — Single File

   Boards (30s rotate) — ORDER:
     1. YTD — Team
     2. PAR — Tracking
     3. Lead Vendors — Last 45 Days (rolling)
     4. This Week — Roster
     5. Weekly Activity (calls_week_override.json)
     6. Agent of the Week

   Rules:
     - Week = Fri 12:00am EST → Thu 11:59:59pm EST
     - This Week cards / roster / AOTW all use SAME filtered sales set
     - Lead Vendors = allowed 18 vendors, rolling last 45 days from same sales universe
     - Weekly Activity = ONLY calls_week_override.json override; always shows if file exists
     - No random renaming. Only explicit NAME_ALIASES.
     - Exclude A C + Abigail Austin from sales metrics.
     - AV is treated as already 12x (as per your API / instructions).
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

  // --------- Vendors (18 allowed)
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

  // --------- Name canon + exclusions
  const NAME_ALIASES = new Map([
    ['fabricio a navarrete', 'Fabricio Navarrete Cervantes'],
    ['fabricio navarrete', 'Fabricio Navarrete Cervantes'],
    ['fabricio navarrete cervantes', 'Fabricio Navarrete Cervantes'],
    ['fabricio cervantes', 'Fabricio Navarrete Cervantes'],
    ['fab', 'Fabricio Navarrete Cervantes'],
    ['f n', 'Fabricio Navarrete Cervantes'],

    ['ajani senior', 'Ajani Senior'],
    ['ajani s', 'Ajani Senior'],
    ['a s', 'Ajani Senior'],

    // others map to themselves canonically
    ['marie saint cyr', 'Marie Saint Cyr'],
    ['eli thermilus', 'Eli Thermilus'],
    ['philip baxter', 'Philip Baxter'],
    ['robert adams', 'Robert Adams'],
    ['nathan johnson', 'Nathan Johnson'],
    ['anna gleason', 'Anna Gleason'],
    ['sebastian beltran', 'Sebastian Beltran'],
    ['michelle landis', 'Michelle Landis'],
    ['elizabeth snyder', 'Elizabeth Snyder'],
    ['fraitzline gustave', 'Fraitzline Gustave']
  ]);

  const EXCLUDED_AGENTS = new Set([
    'a c',
    'abigail austin'
  ]);

  const canonicalName = (name) => {
    const key = norm(name);
    if (!key) return '';
    if (EXCLUDED_AGENTS.has(key)) return '__EXCLUDED__';
    return NAME_ALIASES.get(key) || name;
  };

  // --------- Date helpers (Ringy UTC → EST, Fri–Thu week)
  function parseApiDate(raw) {
    if (!raw) return NaN;
    let s = String(raw).trim();
    // handle "YYYY-MM-DD HH:mm:ss" or already ISO
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) && !s.endsWith('Z')) {
      s = s.replace(' ', 'T') + 'Z';
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? NaN : t;
  }

  function toESTms(utcMs) {
    // Browser-local trick: create EST string then parse back
    const utc = new Date(utcMs);
    const estStr = utc.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(estStr).getTime();
  }

  function currentWeekWindowEST() {
    const nowEst = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
    );
    const day = nowEst.getDay(); // 0=Sun..6=Sat
    // days since last Friday:
    const sinceFri = (day + 7 - 5) % 7;
    const start = new Date(nowEst);
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - sinceFri);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  // --------- Headshots
  function buildHeadshotResolver(roster) {
    const byName = new Map();
    const byEmail = new Map();

    const photoURL = (p) => {
      if (!p) return null;
      const s = String(p);
      return (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
    };

    for (const p of roster || []) {
      const cName = norm(canonicalName(p.name));
      const email = String(p.email || '').trim().toLowerCase();
      const photo = photoURL(p.photo);
      if (cName && !byName.has(cName)) byName.set(cName, photo);
      if (email && !byEmail.has(email)) byEmail.set(email, photo);
    }

    return ({ name, email }) => {
      const cName = norm(canonicalName(name));
      const em = String(email || '').trim().toLowerCase();
      return (
        byName.get(cName) ??
        byEmail.get(em) ??
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

  // remove any old ticker node if present
  const oldTicker = $('#ticker');
  if (oldTicker && oldTicker.parentNode) oldTicker.parentNode.removeChild(oldTicker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // --------- Inline CSS (minimal)
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
  const saleId = (s) => String(
    s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`
  );

  // --------- Cards (use computed weekly stats)
  function renderCards({ calls, week }) {
    const callsVal  = safe(calls?.team?.calls, 0);
    const avVal     = safe(week?.totalAV, 0);
    const dealsVal  = safe(week?.totalDeals, 0);

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal || 0).toLocaleString();
  }

  function agentRowHTML({ name, right1, right2, photoUrl }) {
    const initials = (name || '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initials || '?'}</div>`;
    return `
      <tr>
        <td class="agent" style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
        <td class="right">${right1}</td>
        ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
      </tr>
    `;
  }

   // -------- Vendor summary (rolling 45d, ONLY your 18 vendors — no exclusions)
function summarizeVendors(allSales = []) {
  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000; // last 45 days
  const byName = new Map();

  for (const s of allSales || []) {
    const when = Date.parse(s.dateSold || s.date || '');
    if (!Number.isFinite(when) || when < cutoff) continue;   // 45d window only

    const vendorRaw = String(s.soldProductName || '').trim();
    if (!VENDOR_SET.has(vendorRaw)) continue;                // only your 18 vendors

    const vendor = vendorRaw;
    const amount = Number(s.amount) || 0;

    const row = byName.get(vendor) || { name: vendor, deals: 0, amount: 0 };
    row.deals += 1;
    row.amount += amount;
    byName.set(vendor, row);
  }

  const rows = [...byName.values()];
  const totalDeals = rows.reduce((sum, r) => sum + r.deals, 0);

  for (const r of rows) {
    r.shareDeals = totalDeals ? +(r.deals * 100 / totalDeals).toFixed(1) : 0;
  }

  rows.sort((a, b) => b.deals - a.deals || b.amount - a.amount);

  return { rows, totalDeals };
}

  // --------- Compute weekly stats from allSales (Fri–Thu EST)
  function computeWeeklyStats(allSales) {
    const { startMs, endMs } = currentWeekWindowEST();
    const perMap = new Map();
    let totalAV = 0;
    let totalDeals = 0;

    for (const s of allSales || []) {
      const tUTC = parseApiDate(s.dateSold || s.date);
      if (!Number.isFinite(tUTC)) continue;
      const tEST = toESTms(tUTC);
      if (tEST < startMs || tEST > endMs) continue;

      const rawVendor = String(s.soldProductName || '').trim();
      if (!VENDOR_SET.has(rawVendor)) continue; // every deal has vendor; this keeps garbage out

      const canon = canonicalName(s.agent || s.owner || '');
      const key = norm(canon);
      if (!canon || canon === '__EXCLUDED__' || !key || EXCLUDED_AGENTS.has(key)) continue;

      const amount = +s.amount || +s.av12x || 0; // you’ve said your AV feed is already 12x
      totalAV += amount;
      totalDeals += 1;

      const cur = perMap.get(canon) || { name: canon, av: 0, deals: 0 };
      cur.av += amount;
      cur.deals += 1;
      perMap.set(canon, cur);
    }

    return {
      totalAV,
      totalDeals,
      perAgent: [...perMap.values()].sort((a,b)=> b.av - a.av)
    };
  }

  // --------- Boards

  function renderRosterBoard({ roster, week, resolvePhoto }) {
    setView('This Week — Roster');
    const rows = [];

    for (const p of roster || []) {
      const canon = canonicalName(p.name);
      if (canon === '__EXCLUDED__') continue;

      const wk = (week?.perAgent || []).find(a => norm(a.name) === norm(canon));
      const av = wk ? wk.av : 0;
      const deals = wk ? wk.deals : 0;

      const photo = resolvePhoto({ name: p.name, email: p.email });
      rows.push({ name: canon || p.name, av, deals, photo });
    }

    rows.sort((a,b)=> b.av - a.av);

    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>
    `;
    if (bodyEl) bodyEl.innerHTML = rows.map(r =>
      agentRowHTML({
        name: r.name,
        right1: fmtMoney(r.av),
        right2: (r.deals || 0).toLocaleString(),
        photoUrl: r.photo
      })
    ).join('');
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b)=> (b.av || 0) - (a.av || 0));
    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av || 0),
        photoUrl: resolvePhoto({ name: p.name, email: p.email })
      })).join('')}
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
      </tr>
    `;
  }

  // --- WEEKLY ACTIVITY (calls_week_override.json)
  let WEEKLY_ROSTER_CACHE = null;
  async function getRosterByEmail() {
    if (WEEKLY_ROSTER_CACHE) return WEEKLY_ROSTER_CACHE;
    try {
      const r = await fetch('/headshots/roster.json', { cache: 'no-store' });
      if (!r.ok) throw 0;
      const arr = await r.json();
      const map = new Map();
      for (const p of arr || []) {
        const em = (p.email || '').trim().toLowerCase();
        if (em) map.set(em, p);
      }
      WEEKLY_ROSTER_CACHE = map;
    } catch {
      WEEKLY_ROSTER_CACHE = new Map();
    }
    return WEEKLY_ROSTER_CACHE;
  }

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
        bodyEl.innerHTML = `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No weekly activity override loaded.</td></tr>`;
      }
      return;
    }

    const rosterMap = await getRosterByEmail();
    const rows = [];

    for (const [email, stats] of Object.entries(json)) {
      const em = (email || '').toLowerCase();
      const rosterEntry = rosterMap.get(em);
      const baseName = rosterEntry?.name || (stats.name || (email || '').split('@')[0].replace(/\./g,' '));
      const name = canonicalName(baseName);
      if (name === '__EXCLUDED__') continue;

      const leads = +stats.leads || 0;
      const sold = +stats.sold || 0;
      const calls = +stats.calls || 0;
      const talkMin = +stats.talkMin || 0;
      const loggedMin = +stats.loggedMin || 0;
      const conv = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      let photo = null;
      if (rosterEntry && rosterEntry.photo) {
        const s = String(rosterEntry.photo);
        photo = (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
      }

      rows.push({ name, leads, sold, calls, talkMin, loggedMin, conv, photoUrl: photo });
    }

    rows.sort((a,b)=> b.sold - a.sold || b.leads - a.leads);

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => {
        return `
          <tr>
            ${agentRowHTML({ name: r.name, right1: '', photoUrl: r.photoUrl }).replace(
              /<td class="right">.*?<\/td>/, ''
            )}
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

  // --- Agent of the Week (from weekly stats)
  async function renderAgentOfWeekAuto(data) {
    setView('Agent of the Week');
    const per = Array.isArray(data.week?.perAgent) ? data.week.perAgent : [];
    if (!per.length) {
      if (headEl) headEl.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      return;
    }

    const top = per.reduce((a,b)=> b.av > a.av ? b : a, per[0]);
    const want = norm(top.name);

    // YTD lookup
    let ytdVal = 0;
    if (Array.isArray(data.ytdList)) {
      const hit = data.ytdList.find(x => norm(x.name) === want);
      if (hit) ytdVal = +hit.av || +hit.ytd_av || 0;
    }

    const photo = data.resolvePhoto({ name: top.name });
    const initials = (top.name || '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

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

  // --- Vendors board
  function renderVendorsBoard({ vendorRows }) {
    setView('Lead Vendors — Last 45 Days');
    const data = vendorRows || { rows: [], totalDeals: 0 };
    const rows = data.rows || [];
    const totalDeals = data.totalDeals || 0;

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    const COLORS = ['#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787','#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a,c)=> a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    // donut
    const size=240, cx=size/2, cy=size/2, r=size/2-8;
    const polar=(cx,cy,r,a)=>[cx + r*Math.cos(a), cy + r*Math.sin(a)];
    const arcPath=(cx,cy,r,a0,a1)=>{
      const large=(a1-a0)>Math.PI?1:0;
      const [x0,y0]=polar(cx,cy,r,a0);
      const [x1,y1]=polar(cx,cy,r,a1);
      return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };
    let acc=-Math.PI/2;
    const arcs = rows.map(v=>{
      const span = totalDeals ? 2*Math.PI*(v.deals/totalDeals) : 0;
      const d = arcPath(cx,cy,r,acc,acc+span); acc+=span;
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

    if (headEl) headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals (45d)</th>
        <th class="right">% of total</th>
      </tr>
    `;

    const legend = rows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.name)}"></span>
        <span class="label">${v.name}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.shareDeals}%</span>
      </div>`).join('');

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px">
          <div class="vendor-flex">${svg}<div class="legend">${legend}</div></div>
        </td>
      </tr>
    `;

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
      </tr>
    `;

    if (bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  // --- PAR Board
  function renderParBoard({ par }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];

    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`;
      return;
    }

    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">Annual&nbsp;AV</th></tr>
    `;
    if (bodyEl) bodyEl.innerHTML = `
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

  // --- Rules rotation
  function startRuleRotation(rulesJson) {
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list = Array.isArray(rulesJson?.rules) ? rulesJson.rules.filter(Boolean) : [];
    if (!list.length) {
      setBanner(base, 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.');
      return;
    }
    let i = 0;
    const apply = () => setBanner(base, list[i % list.length]);
    apply();
    setInterval(() => { i++; apply(); }, 12 * 60 * 60 * 1000);
  }

  // ---------- BACKFILL
  // IMPORTANT:
  // Replace the placeholder text below with your FULL 45-day backfill block EXACTLY as you maintain it.
  const BACKFILL_TEXT = `
  `; // <-- paste your real backfill between these backticks. No ellipsis.

  function parseBackfill(text) {
    const out = [];
    const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    const vendorRe = /^([A-Za-z0-9 $!\/&:+.'-]+?)\s*-\s*\$([\d,]+(?:\.\d+)?)$/;
    const agentRe  = /^([A-Za-z .'-]+?)\s+(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))$/i;

    let pending = null;

    for (const ln of lines) {
      const v = vendorRe.exec(ln);
      if (v) {
        const vendor = v[1].trim();
        if (!VENDOR_SET.has(vendor)) { pending = null; continue; }
        const amount = +v[2].replace(/,/g,'');
        pending = { soldProductName: vendor, amount, date: '', agent: '' };
        out.push(pending);
        continue;
      }
      const a = agentRe.exec(ln);
      if (a && pending) {
        pending.agent = a[1].trim();
        pending.date  = a[2].trim();
        pending = null;
      }
    }

    return out.map(o => ({
      ...o,
      dateSold: o.date
    }));
  }

  const BACKFILL_SALES = parseBackfill(BACKFILL_TEXT);

  // ---------- Data load ----------
  async function loadAll() {
    const [rules, roster, calls, soldRaw, ytdList, ytdTotalJson, par] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const sold = soldRaw || {};
    const resolvePhoto = buildHeadshotResolver(roster || []);

    const liveAllSales = Array.isArray(sold.allSales) ? sold.allSales : [];
    const mergedAllSales = [...liveAllSales, ...BACKFILL_SALES];

    // Rolling 45d vendor base
    const vendorRows = summarizeVendors(mergedAllSales);

    // Weekly stats from same merged sales
    const week = computeWeeklyStats(mergedAllSales);

    // seed splash IDs from current 45d universe
    for (const s of mergedAllSales) {
      seenLeadIds.add(saleId(s));
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 } },
      soldAll: mergedAllSales,
      vendorRows,
      week,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation
  function startBoardRotation(data) {
    const order = [
      () => renderYtdBoard(data),
      () => renderParBoard(data),
      () => renderVendorsBoard(data),
      () => renderRosterBoard(data),
      () => renderWeeklyActivity(),
      () => renderAgentOfWeekAuto(data)
    ];
    let i = 0;
    const paint = () => order[i % order.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30_000);
  }

  // --------- Live sale polling (keeps 45d + week & vendors in sync, no extra UX)
  function startLiveSalePolling(initialData) {
    const POLL_MS = 12_000;
    const cutoffWindow = 45 * 24 * 3600 * 1000;

    const tick = async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;

      const liveAllSales = Array.isArray(sold.allSales) ? sold.allSales : [];
      const now = Date.now();
      const merged = [...liveAllSales, ...BACKFILL_SALES].filter(s => {
        const t = parseApiDate(s.dateSold || s.date);
        return Number.isFinite(t) && (now - t) <= cutoffWindow;
      });

      let newSalesFound = false;
      for (const s of merged) {
        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newSalesFound = true;
          showSplash({
            name: canonicalName(s.agent || s.owner || 'Agent'),
            amount: s.amount || s.av12x || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      if (newSalesFound) {
        const week = computeWeeklyStats(merged);
        const vendorRows = summarizeVendors(merged);
        initialData.week = week;
        initialData.vendorRows = vendorRows;
        renderCards({ calls: initialData.calls, week });
      }
    };

    setInterval(tick, POLL_MS);
  }

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();
      renderCards({ calls: data.calls, week: data.week });
      startRuleRotation(data.rules);
      startBoardRotation(data);
      startLiveSalePolling(data);
    } catch (err) {
      console.error(err);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (bodyEl) {
        bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
      }
    }
  })();
})();

// ---------- OE Countdown ----------
(function () {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;
  const deadline = new Date('2025-12-15T23:59:59-05:00'); // Dec 15, 2025 11:59:59 PM EST
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
