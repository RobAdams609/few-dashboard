/* FEW Dashboard — Single File (45d rolling vendors, EST weeks, OE countdown)
   Boards (30s rotate):
     1. This Week — Roster
     2. YTD — Team
     3. Weekly Activity (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, no weekly reset)
     5. PAR — Tracking
     6. Agent of the Week (auto from weekly data, not manual)

   Extras:
     - Center splash on new sale (60s)
     - Vendor donut + legend
     - Headshots w/ canonical names (Ajani → "a s", Fabricio → "f n")
     - Rules rotation every 12h (THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT)
     - 45d rolling vendor aggregation, backfill + live merge
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

  // --------- Parse dates as Eastern time for week boundaries
  function parseSaleDateEST(raw) {
    if (!raw) return NaN;
    const s = String(raw).trim();

    // If already has zone/Z, trust it.
    if (/[T ]\d{2}:\d{2}(:\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }

    // Otherwise treat as ET.
    const tET = Date.parse(s + ' ET');
    if (Number.isFinite(tET)) return tET;

    const t = Date.parse(s);
    return Number.isFinite(t) ? t : NaN;
  }

  // --------- Sales week: Friday 00:00 → next Friday 00:00 (EST semantics)
  function getSalesWeekRangeEST() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun..6=Sat

    // Days since last Friday (5)
    const sinceFriday = (day >= 5) ? (day - 5) : (day + 2);

    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - sinceFriday,
      0, 0, 0, 0
    );
    const end = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 7,
      0, 0, 0, 0
    );

    return { start: start.getTime(), end: end.getTime() };
  }

  // --------- Allowed vendor labels (your 18 only)
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
          const phone = String(raw || '').replace(/\D+/g,'');
          if (phone) byPhone.set(phone, photo);
        }
      }

      const ini = initialsOf(p.name || '');
      if (ini) byInitial.set(ini, photo);
    }

    return (agent = {}) => {
      const cName = norm(canonicalName(agent.name));
      const email = String(agent.email || '').trim().toLowerCase();
      const phone = String(agent.phone || '').replace(/\D+/g,'');
      const ini   = (agent.name ? agent.name : '')
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
  const cards       = { calls: $('#sumCalls'), av: $('#sumSales'), deals: $('#sumTalk') };
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

  // --------- Inject minimal CSS (unchanged visual)
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

  // --------- Gold center splash for new sale (60s)
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

  // --------- Cards — use computed sales week (Fri–Thu, AV=amount*12)
  function renderCards(data) {
    const callsVal = safe(data.calls?.team?.calls, 0);
    const week = data.soldWeek || { team: { totalSales: 0, totalAV12X: 0 } };

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(week.team.totalAV12X || 0);
    if (cards.deals) cards.deals.textContent = (week.team.totalSales || 0).toLocaleString();
  }

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

  // --------- Vendors aggregation (rolling 45d, live + backfill, no weekly reset)
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();

    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < cutoff) continue;

      const vendorRaw = String(s.soldProductName || 'Unknown').trim();
      const vendor = VENDOR_SET.has(vendorRaw) ? vendorRaw : null;
      if (!vendor) continue;

      const amount = +s.amount || 0;
      const row = byName.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      row.deals += 1;
      row.amount += amount;
      byName.set(vendor, row);
    }

    const rows = [...byName.values()];
    const totalDeals  = rows.reduce((a,r)=> a + r.deals, 0) || 1;
    const totalAmount = rows.reduce((a,r)=> a + r.amount, 0);

    for (const r of rows) {
      r.shareDeals  = +(r.deals  * 100 / totalDeals).toFixed(1);
      r.shareAmount = totalAmount ? +(r.amount * 100 / totalAmount).toFixed(1) : 0;
    }

    rows.sort((a,b)=> b.shareDeals - a.shareDeals || b.amount - a.amount);
    return { rows, totalDeals, totalAmount };
  }

  // --------- Build weekly stats from live allSales (Fri–Thu EST, AV=amount*12)
  function buildWeeklyFromAllSales(allSales = []) {
    const { start, end } = getSalesWeekRangeEST();
    const byAgent = new Map();
    let totalSales = 0;
    let totalAV12X = 0;

    for (const s of allSales) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const nameRaw = s.agent || s.agentName || s.who || '';
      if (!nameRaw) continue;

      const name = canonicalName(nameRaw);
      const amount = +s.amount || 0;
      const av12x = amount * 12;

      let row = byAgent.get(name);
      if (!row) {
        row = { name, sales: 0, av12x: 0 };
        byAgent.set(name, row);
      }

      row.sales += 1;
      row.av12x += av12x;

      totalSales += 1;
      totalAV12X += av12x;
    }

    const perAgent = [...byAgent.values()].sort((a,b) => b.av12x - a.av12x);
    return {
      team: { totalSales, totalAV12X },
      perAgent,
      allSales
    };
  }

  // --------- Boards

  // This Week — Roster (from computed sales week)
  function renderRosterBoard(data) {
    setView('This Week — Roster');
    const soldWeek = data.soldWeek || { perAgent: [] };
    const roster = data.roster || [];
    const resolvePhoto = data.resolvePhoto || (() => null);

    const byKey = new Map();
    for (const a of soldWeek.perAgent || []) {
      const key = norm(canonicalName(a.name));
      byKey.set(key, {
        av: +a.av12x || 0,
        deals: +a.sales || 0
      });
    }

    const rows = [];
    for (const p of roster) {
      const key = norm(canonicalName(p.name));
      const d = byKey.get(key) || { av: 0, deals: 0 };
      const photo = resolvePhoto({ name: p.name, email: p.email });
      const initials = (p.name || '').trim().split(/\s+/)
        .map(w => (w[0] || '').toUpperCase()).join('');
      rows.push({ name: p.name, av: d.av, deals: d.deals, photo, initials });
    }

    rows.sort((a,b)=> b.av - a.av);

    if (headEl) {
      headEl.innerHTML =
        '<tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>';
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

  // YTD — Team (unchanged)
  function renderYtdBoard(data) {
    setView('YTD — Team');
    const rows = Array.isArray(data.ytdList) ? [...data.ytdList] : [];
    const resolvePhoto = data.resolvePhoto || (() => null);
    const ytdTotal = data.ytdTotal || 0;

    rows.sort((a,b)=> (b.av || 0) - (a.av || 0));

    if (headEl) {
      headEl.innerHTML = '<tr><th>Agent</th><th class="right">YTD AV</th></tr>';
    }

    if (bodyEl) {
      const html = rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av || 0),
        photoUrl: resolvePhoto({ name: p.name }),
        initial: (p.name || '').split(/\s+/)
          .map(w => (w[0] || '').toUpperCase()).join('')
      })).join('');

      bodyEl.innerHTML = html +
        `<tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${fmtMoney(ytdTotal)}</strong></td></tr>`;
    }
  }

  // Weekly Activity (existing behavior kept)
  let WEEKLY_ROSTER_CACHE = null;

  async function getRosterByEmail() {
    if (WEEKLY_ROSTER_CACHE) return WEEKLY_ROSTER_CACHE;
    try {
      const r = await fetch('/headshots/roster.json', { cache: 'no-store' });
      if (r.ok) {
        const arr = await r.json();
        const map = new Map();
        for (const p of arr || []) {
          const em = (p.email || '').trim().toLowerCase();
          if (em) map.set(em, p);
        }
        WEEKLY_ROSTER_CACHE = map;
        return map;
      }
    } catch (e) {}
    WEEKLY_ROSTER_CACHE = new Map();
    return WEEKLY_ROSTER_CACHE;
  }

  async function renderWeeklyActivity() {
    const head = $('#thead');
    const body = $('#tbody');
    const label = $('#viewLabel');

    if (label) label.textContent = 'Weekly Activity';

    const res = await fetch('/calls_week_override.json', { cache: 'no-store' }).catch(() => null);
    const json = res && res.ok ? await res.json() : null;

    if (!json || typeof json !== 'object') {
      if (head) {
        head.innerHTML = `
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
      if (body) {
        body.innerHTML =
          `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No call data.</td></tr>`;
      }
      return;
    }

    const rows = [];
    const rosterMap = await getRosterByEmail();

    for (const [email, stats] of Object.entries(json)) {
      const em = (email || '').toLowerCase();
      const rosterEntry = rosterMap.get(em);
      const nameFromEmail = (email || '').split('@')[0].replace(/\./g, ' ');
      const dispName = rosterEntry ? rosterEntry.name : (stats.name || nameFromEmail);
      const name = dispName.replace(/\b\w/g, c => c.toUpperCase());

      const leads = Number(stats.leads || 0);
      const sold = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talkMin = Number(stats.talkMin || 0);
      const loggedMin = Number(stats.loggedMin || 0);
      const conv = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      let photoUrl = null;
      if (rosterEntry && rosterEntry.photo) {
        const s = String(rosterEntry.photo);
        photoUrl = (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
      }

      rows.push({ name, leads, sold, calls, talkMin, loggedMin, conv, photoUrl });
    }

    rows.sort((a,b)=> b.sold - a.sold || b.leads - a.leads);

    if (head) {
      head.innerHTML = `
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

    if (body) {
      body.innerHTML = rows.map(r => {
        const initials = r.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
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
          </tr>`;
      }).join('');
    }
  }

  // Agent of the Week — from computed weekly stats
  async function renderAgentOfWeekAuto(data) {
    setView('Agent of the Week');

    const soldWeek = data.soldWeek || { perAgent: [] };
    const perAgent = Array.isArray(soldWeek.perAgent) ? soldWeek.perAgent : [];

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

    const top = perAgent.reduce(
      (best, r) => (!best || r.av12x > best.av12x) ? r : best,
      null
    );

    if (!top) {
      if (thead) thead.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (tbody) {
        tbody.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No data.</td></tr>`;
      }
      return;
    }

    const wantName = norm(top.name);
    let ytdVal = 0;

    if (Array.isArray(data.ytdList)) {
      const hit = data.ytdList.find(
        x => norm(x.name) === wantName || norm(canonicalName(x.name)) === wantName
      );
      if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
    }

    if (!ytdVal) {
      try {
        const r = await fetch('/ytd_av.json', { cache: 'no-store' });
        if (r.ok) {
          const json = await r.json();
          const arr = Array.isArray(json)
            ? json
            : (json && (json.list || json.agents)) || [];
          const hit = (arr || []).find(
            x => norm(x.name) === wantName || norm(canonicalName(x.name)) === wantName
          );
          if (hit) ytdVal = Number(hit.av || hit.ytd_av || 0);
        }
      } catch (_) {}
    }

    const resolvePhoto = data.resolvePhoto || (() => null);
    const photo = resolvePhoto({ name: top.name });
    const initials = top.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

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
                <div style="margin-top:4px;opacity:.85;">Weekly Submitted AV • ${fmtMoney(top.av12x)}</div>
                <div style="margin-top:2px;opacity:.55;">Deals this week • ${(top.sales || 0).toLocaleString()}</div>
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

  // Lead Vendors — Last 45 Days (rolling)
  function renderVendorsBoard(data) {
    setView('Lead Vendors — Last 45 Days');

    const vendorRows = data.vendorRows || summarizeVendors([]);
    const rows = vendorRows.rows || [];
    const totalDeals = vendorRows.totalDeals || 0;

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      }
      return;
    }

    const COLORS = [
      '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
      '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
    ];
    const colorFor = (name = '') => {
      const h = [...name].reduce((a,c)=> a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    const size = 240;
    const cx = size/2;
    const cy = size/2;
    const r  = size/2 - 8;

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
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">
          ${totalDeals.toLocaleString()}
        </text>
      </svg>`;

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Vendor</th>
          <th class="right">Deals</th>
          <th class="right">% of total</th>
        </tr>`;
    }

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

  // PAR — Tracking (unchanged)
  function renderParBoard(data) {
    setView('PAR — Tracking');
    const par = data.par || {};
    const pace = +safe(par.pace_target, 0);
    const agents = Array.isArray(par.agents) ? par.agents : [];

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

  // --------- Rules rotation (unchanged)
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

  // ---------- BACKFILL
  // IMPORTANT: keep your existing 45-day dump content EXACTLY here. Do not edit values.
  const BACKFILL_TEXT = `
PASTE YOUR CURRENT 45-DAY BACKFILL BLOCK HERE UNCHANGED.
`;

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
        if (!VENDOR_SET.has(vendor)) continue;
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

    return out.map(o => ({ ...o, dateSold: o.date }));
  }

  const BACKFILL_SALES = parseBackfill(BACKFILL_TEXT);

  // ---------- Data load
  async function loadAll() {
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const soldSafe = sold || {
      team: { totalSales: 0, totalAV12X: 0 },
      perAgent: [],
      allSales: []
    };
    if (!Array.isArray(soldSafe.perAgent)) soldSafe.perAgent = [];
    if (!Array.isArray(soldSafe.allSales)) soldSafe.allSales = [];

    const resolvePhoto = buildHeadshotResolver(roster || []);

    // Rolling 45d dataset for vendors = live allSales + backfill
    const mergedAllSales = [...soldSafe.allSales, ...BACKFILL_SALES];
    const vendorRows = summarizeVendors(mergedAllSales);

    // Weekly stats from live allSales only (Fri–Thu, AV=amount*12)
    const soldWeek = buildWeeklyFromAllSales(soldSafe.allSales);

    // Seed seen ids from everything inside 45d so no double splashes
    const cutoff45 = Date.now() - 45 * 24 * 3600 * 1000;
    for (const s of mergedAllSales) {
      const t = parseSaleDateEST(s.dateSold || s.date || '');
      if (Number.isFinite(t) && t >= cutoff45) {
        seenLeadIds.add(saleId(s));
      }
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 }, perAgent: [] },
      soldRaw: soldSafe,
      soldWeek,
      vendorRows,
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

  // --------- Live sale polling (45d window, Fri–Thu rules for splash)
  function startLiveSalePolling(initialData) {
    const POLL_MS = 12_000;
    const cutoffWindow = 45 * 24 * 3600 * 1000;

    const tick = async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold || !Array.isArray(sold.allSales)) return;

      const nowCutoff = Date.now() - cutoffWindow;
      const liveAllSales = sold.allSales;

      let newSalesFound = false;
      const fresh = [];

      for (const s of liveAllSales) {
        const t = parseSaleDateEST(s.dateSold || s.date || '');
        if (!Number.isFinite(t) || t < nowCutoff) continue;

        fresh.push(s);

        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newSalesFound = true;
          showSplash({
            name: s.agent || 'Agent',
            amount: (s.amount || 0) * 12,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      if (!newSalesFound) return;

      // Rebuild 45d + weekly on new data
      const merged = [...fresh, ...BACKFILL_SALES];
      const vendorRows = summarizeVendors(merged);
      const soldWeek = buildWeeklyFromAllSales(fresh);

      const updated = {
        ...initialData,
        soldWeek,
        vendorRows
      };

      renderCards(updated);
      renderRosterBoard(updated);
      renderVendorsBoard(updated);
      renderAgentOfWeekAuto(updated);
    };

    setInterval(tick, POLL_MS);
  }

  // --------- Boot
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

// ---------- OE Countdown (Dec 15, 2025 11:59 PM EST) ----------
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
