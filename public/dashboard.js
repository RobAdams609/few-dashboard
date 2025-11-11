/* FEW Dashboard — Single File
   Boards (30s rotate):
     1. This Week — Roster  (Fri→Thu EST)
     2. YTD — Team
     3. Weekly Activity (calls_week_override.json, with headshots)
     4. Lead Vendors — Last 45 Days (rolling, no weekly reset)
     5. PAR — Tracking
     6. Agent of the Week (auto from sales week)

   Rules:
     - All AV displayed is 12x.
     - No placeholders.
     - No invented vendors.
     - Vendors limited to the 18 approved labels.
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
    par: '/par.json',
    weeklyOverride: '/calls_week_override.json'
  };

  // --------- Vendor labels (canonical, permanent)
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

  // Agents whose sales should NOT count anywhere (per your note)
  const EXCLUDED_AGENTS = new Set([
    'a c',
    'abigail austin'
  ].map(s => s.toLowerCase()));

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
    ['anna gleason', 'anna gleason'],
    ['sebastian beltran', 'sebastian beltran'],
    ['michelle landis', 'michelle landis'],
    ['elizabeth snyder', 'elizabeth snyder'],
    ['fraitzline healthadvisor', 'fraitzline gustave']
  ]);
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  // --------- Tiny utils
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const safe = (v, d) => (v === undefined || v === null ? d : v);
  const fmtMoney = (n) => {
    const num = Math.round(Number(n) || 0);
    return `$${num.toLocaleString()}`;
  };

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

  // --------- Time helpers (force EST)
  function nowInEST() {
    const now = new Date();
    // EST/EDT offset approximation via fixed -5; for your use case (short OE window) this is acceptable.
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utc + (-5) * 3600000);
  }

  // Sales week: Fri 00:00 EST → next Fri 00:00 EST
  function getWeekRangeEST() {
    const d = nowInEST();
    const day = d.getDay(); // 0=Sun..6=Sat
    // We want Friday as day 5 → start = that Friday 00:00
    const diffToFriday = (day + 2) % 7; // days since last Fri
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diffToFriday);
    const start = d.getTime();
    const end = start + 7 * 24 * 3600 * 1000;
    return { start, end };
  }

  function parseSaleDateEST(raw) {
    if (!raw) return NaN;
    const s = String(raw).trim();
    if (/[+-]\d{2}:?\d{2}$/.test(s) || s.endsWith('Z')) {
      const t = Date.parse(s);
      return Number.isFinite(t) ? t : NaN;
    }
    const withEST = Date.parse(s + ' EST');
    if (Number.isFinite(withEST)) return withEST;
    const plain = Date.parse(s);
    return Number.isFinite(plain) ? plain : NaN;
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
      const cName = norm(canonicalName(p.name));
      const email = String(p.email || '').trim().toLowerCase();
      const photo = photoURL(p.photo);
      if (cName) byName.set(cName, photo);
      if (email) byEmail.set(email, photo);
    }

    return ({ name, email }) => {
      const cName = norm(canonicalName(name));
      const em = String(email || '').trim().toLowerCase();
      return byName.get(cName) || byEmail.get(em) || null;
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

  // --------- Splash on new sale
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name}</div>
      <div class="mid">${fmtMoney(amount)}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60000);
  }

  const seenLeadIds = new Set();
  const saleId = (s) =>
    String(s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`);

  // --------- Compute 12x AV helpers
  function saleAmount12x(s) {
    const av12 =
      Number(s.av12x || s.av12X) ||
      (Number(s.amount) ? Number(s.amount) * 12 : 0);
    return av12 || 0;
  }

  // --------- Cards (THIS WEEK only)
  function renderCards({ allSales, callsSummary }) {
    const { start, end } = getWeekRangeEST();

    let totalAV12x = 0;
    let totalDeals = 0;

    for (const s of allSales || []) {
      const agentName = norm(canonicalName(s.agent || s.agentName || ''));
      if (EXCLUDED_AGENTS.has(agentName)) continue;

      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const v = saleAmount12x(s);
      if (v > 0) {
        totalAV12x += v;
        totalDeals += 1;
      }
    }

    const callsVal = safe(callsSummary?.team?.calls, 0);

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(totalAV12x);
    if (cards.deals) cards.deals.textContent = (totalDeals || 0).toLocaleString();
  }

  // --------- Table row helper
  function agentRowHTML({ name, cols, photoUrl }) {
    const initials = (name || '')
      .trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('') || '?';

    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initials}</div>`;

    const tds = cols.map(c => `<td class="right">${c}</td>`).join('');

    return `
      <tr>
        <td style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
        ${tds}
      </tr>
    `;
  }

  // --------- Lead Vendors — Last 45 Days
  function summarizeVendors45d(allSales) {
    const cutoff = nowInEST().getTime() - 45 * 24 * 3600 * 1000;
    const byVendor = new Map();
    let totalDeals = 0;

    for (const s of allSales || []) {
      const agentName = norm(canonicalName(s.agent || s.agentName || ''));
      if (EXCLUDED_AGENTS.has(agentName)) continue;

      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < cutoff) continue;

      const vendorRaw = String(s.soldProductName || '').trim();
      if (!VENDOR_SET.has(vendorRaw)) continue;

      const key = vendorRaw;
      const row = byVendor.get(key) || { name: key, deals: 0 };
      row.deals += 1;
      totalDeals += 1;
      byVendor.set(key, row);
    }

    const rows = [...byVendor.values()];
    for (const r of rows) {
      r.share = totalDeals ? +(r.deals * 100 / totalDeals).toFixed(1) : 0;
    }
    rows.sort((a, b) => b.deals - a.deals || a.name.localeCompare(b.name));
    return { rows, totalDeals };
  }

  function renderVendorsBoard({ allSales }) {
    const { rows, totalDeals } = summarizeVendors45d(allSales);
    setView('Lead Vendors — Last 45 Days');

    if (!rows.length) {
      headEl.innerHTML = '';
      bodyEl.innerHTML =
        `<tr><td style="padding:18px;color:#5c6c82;">No vendor data.</td></tr>`;
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
    const colorFor = (name = '') => {
      const h = [...name].reduce((a,c)=> a + c.charCodeAt(0), 0);
      return COLORS[h % COLORS.length];
    };

    const size = 260, cx = size/2, cy = size/2, r = size/2 - 12;
    const polar = (cx,cy,r,a) => [cx + r*Math.cos(a), cy + r*Math.sin(a)];
    const arcPath = (a0,a1) => {
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const [x0,y0] = polar(cx,cy,r,a0);
      const [x1,y1] = polar(cx,cy,r,a1);
      return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    };

    let acc = -Math.PI/2;
    const arcs = rows.map(v => {
      const span = totalDeals ? 2*Math.PI*(v.deals/totalDeals) : 0;
      const d = arcPath(acc, acc + span);
      acc += span;
      return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="32" fill="none" />`;
    }).join('');

    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-18}" fill="#0f141c" />
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="12" fill="#9fb0c8">Deals (45d)</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="22" font-weight="700" fill="#ffd36a">
          ${totalDeals.toLocaleString()}
        </text>
      </svg>
    `;

    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px 18px 8px;">
          <div style="display:flex;gap:28px;align-items:center;flex-wrap:wrap;">
            ${svg}
            <div class="legend">
              ${rows.map(v => `
                <div class="legend-item">
                  <span class="dot" style="background:${colorFor(v.name)}"></span>
                  <span class="label">${v.name}</span>
                  <span class="val">${v.deals.toLocaleString()} • ${v.share}%</span>
                </div>
              `).join('')}
            </div>
          </div>
        </td>
      </tr>
    `;

    const rowsHTML = rows.map(v => `
      <tr>
        <td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right">${v.share}%</td>
      </tr>
    `).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
      </tr>
    `;

    if (bodyEl) bodyEl.innerHTML = donutRow + rowsHTML + totals;
  }

  // --------- This Week — Roster
  function renderRosterBoard({ allSales, roster, resolvePhoto }) {
    setView('This Week — Roster');

    const { start, end } = getWeekRangeEST();
    const per = new Map();

    for (const s of allSales || []) {
      const agentRaw = s.agent || s.agentName || '';
      const agentNorm = norm(canonicalName(agentRaw));
      if (!agentNorm || EXCLUDED_AGENTS.has(agentNorm)) continue;

      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const av = saleAmount12x(s);
      if (!av) continue;

      const row = per.get(agentNorm) || { name: canonicalName(agentRaw), av: 0, deals: 0 };
      row.av += av;
      row.deals += 1;
      per.set(agentNorm, row);
    }

    const rows = [];

    for (const p of roster || []) {
      const key = norm(canonicalName(p.name));
      if (!key) continue;
      const stats = per.get(key) || { av:0, deals:0, name:p.name };
      const photo = resolvePhoto({ name: p.name, email: p.email });
      rows.push({
        name: canonicalName(p.name),
        av: stats.av,
        deals: stats.deals,
        photo
      });
    }

    // include any producing non-roster agents (if API has them & not excluded)
    for (const [, r] of per) {
      const exists = rows.some(x => norm(x.name) === norm(r.name));
      if (!exists) {
        if (!EXCLUDED_AGENTS.has(norm(r.name))) {
          rows.push({
            name: r.name,
            av: r.av,
            deals: r.deals,
            photo: resolvePhoto({ name: r.name })
          });
        }
      }
    }

    rows.sort((a,b)=> b.av - a.av || b.deals - a.deals || a.name.localeCompare(b.name));

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Submitted AV (12x)</th>
          <th class="right">Deals</th>
        </tr>
      `;
    }

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => agentRowHTML({
        name: r.name,
        cols: [fmtMoney(r.av), (r.deals || 0).toLocaleString()],
        photoUrl: r.photo
      })).join('');
    }
  }

  // --------- YTD — Team
  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');

    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b)=> (b.av || 0) - (a.av || 0));

    if (headEl) {
      headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">YTD AV (12x)</th>
        </tr>
      `;
    }

    if (bodyEl) {
      const html = rows.map(p => agentRowHTML({
        name: canonicalName(p.name),
        cols: [fmtMoney(p.av || 0)],
        photoUrl: resolvePhoto({ name: p.name, email: p.email })
      })).join('');

      bodyEl.innerHTML = html + `
        <tr class="total">
          <td><strong>Total</strong></td>
          <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
        </tr>
      `;
    }
  }

  // --------- Weekly Activity (manual override)
  async function renderWeeklyActivity({ resolvePhoto }) {
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
        </tr>
      `;
    }

    const json = await fetchJSON(ENDPOINTS.weeklyOverride);
    if (!json || typeof json !== 'object' || !Object.keys(json).length) {
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No weekly activity override loaded.</td></tr>`;
      }
      return;
    }

    const rows = [];

    for (const [email, stats] of Object.entries(json)) {
      const em = (email || '').toLowerCase();
      const fromStatsName = (stats.name || '').trim();
      const baseName = fromStatsName || em.split('@')[0].replace(/\./g,' ');
      const pretty = baseName.replace(/\b\w/g, c => c.toUpperCase());
      const name = canonicalName(pretty);

      const leads = Number(stats.leads || 0);
      const sold  = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talk  = Number(stats.talkMin || stats.talkmin || 0);
      const logm  = Number(stats.loggedMin || stats.loggedmin || 0);
      const conv  = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      const photoUrl = resolvePhoto({ name, email });

      rows.push({
        name,
        leads,
        sold,
        conv,
        calls,
        talk,
        logm,
        photoUrl
      });
    }

    rows.sort((a,b)=> b.sold - a.sold || b.leads - a.leads || a.name.localeCompare(b.name));

    if (bodyEl) {
      bodyEl.innerHTML = rows.map(r => agentRowHTML({
        name: r.name,
        cols: [
          r.leads.toLocaleString(),
          r.sold.toLocaleString(),
          `${r.conv}%`,
          r.calls.toLocaleString(),
          r.talk.toLocaleString(),
          r.logm.toLocaleString()
        ],
        photoUrl: r.photoUrl
      })).join('');
    }
  }

  // --------- PAR
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
          <th class="right">Take Rate</th>
          <th class="right">Annual AV</th>
        </tr>
      `;
    }

    if (bodyEl) {
      bodyEl.innerHTML = `
        ${agents.map(a => `
          <tr>
            <td>${canonicalName(a.name)}</td>
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

  // --------- Agent of the Week (auto, with YTD AV)
  async function renderAgentOfWeek({ allSales, ytdList, resolvePhoto }) {
    setView('Agent of the Week');

    const { start, end } = getWeekRangeEST();
    const per = new Map();

    for (const s of allSales || []) {
      const agentRaw = s.agent || s.agentName || '';
      const agentNorm = norm(canonicalName(agentRaw));
      if (!agentNorm || EXCLUDED_AGENTS.has(agentNorm)) continue;

      const t = parseSaleDateEST(s.dateSold || s.date);
      if (!Number.isFinite(t) || t < start || t >= end) continue;

      const av = saleAmount12x(s);
      if (!av) continue;

      const row = per.get(agentNorm) || { name: canonicalName(agentRaw), av: 0, deals: 0 };
      row.av += av;
      row.deals += 1;
      per.set(agentNorm, row);
    }

    if (!per.size) {
      if (headEl) headEl.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      if (bodyEl) {
        bodyEl.innerHTML =
          `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      }
      return;
    }

    let top = null;
    for (const r of per.values()) {
      if (!top || r.av > top.av) top = r;
    }

    // find YTD AV for that agent
    let ytdVal = 0;
    if (Array.isArray(ytdList)) {
      const hit = ytdList.find(
        x => norm(canonicalName(x.name)) === norm(top.name)
      );
      if (hit) ytdVal = Number(hit.av || 0);
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
                <div style="font-size:22px;font-weight:700;text-transform:lowercase;">
                  ${top.name}
                </div>
                <div style="margin-top:4px;opacity:.9;">
                  Weekly Submitted AV • ${fmtMoney(top.av)}
                </div>
                <div style="margin-top:2px;opacity:.75;">
                  Deals this week • ${(top.deals || 0).toLocaleString()}
                </div>
                <div style="margin-top:2px;opacity:.75;">
                  YTD AV • ${fmtMoney(ytdVal)}
                </div>
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
      setBanner(base, 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.');
    } else {
      let i = 0;
      const apply = () => setBanner(base, list[i % list.length]);
      apply();
      setInterval(() => { i++; apply(); }, 12 * 60 * 60 * 1000);
    }
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

    const allSales = Array.isArray(sold?.allSales)
      ? sold.allSales
      : [];

    const ytdTotal = (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0;

    for (const s of allSales) {
      seenLeadIds.add(saleId(s));
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      callsSummary: calls || { team: { calls: 0 } },
      allSales,
      ytdList: ytdList || [],
      ytdTotal,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation (30s)
  function startBoardRotation(data) {
    const order = [
      () => renderRosterBoard(data),
      () => renderYtdBoard(data),
      () => renderWeeklyActivity(data),
      () => renderVendorsBoard(data),
      () => renderParBoard(data),
      () => renderAgentOfWeek(data)
    ];

    let i = 0;
    const paint = () => order[i % order.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30000);
  }

  // --------- Live sale polling (splash + vendor refresh)
  function startLiveSalePolling(initialData) {
    const POLL_MS = 12000;
    const windowMs = 45 * 24 * 3600 * 1000;

    const tick = async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;

      const liveAll = Array.isArray(sold.allSales) ? sold.allSales : [];
      const cutoff = nowInEST().getTime() - windowMs;

      const kept = [];
      let newFound = false;

      for (const s of liveAll) {
        const t = parseSaleDateEST(s.dateSold || s.date);
        if (!Number.isFinite(t) || t < cutoff) continue;
        kept.push(s);
        const id = saleId(s);
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          newFound = true;
          showSplash({
            name: s.agent || 'Agent',
            amount: saleAmount12x(s),
            soldProductName: s.soldProductName || ''
          });
        }
      }

      if (newFound) {
        renderCards({ allSales: kept, callsSummary: initialData.callsSummary });
        renderVendorsBoard({ allSales: kept });
      }
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

  // --------- OE Countdown (Dec 15, 2025 11:59 PM EST)
  (function () {
    const timerEl = document.querySelector('#oeTimer');
    if (!timerEl) return;

    const deadline = new Date('2025-12-15T23:59:59-05:00');
    const pad = n => String(n).padStart(2, '0');

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
})();
