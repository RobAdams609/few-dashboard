/* FEW Dashboard — Single File (Full Rewrite)
   Boards: This Week — Roster | YTD — Team | Weekly Activity | Lead Vendors (45d) | PAR — Tracking
   Extras: Center splash on new sale (60s), vendor donut+legend, headshots w/ canonical names,
           rules rotation every 12h (no top ticker), resilient to missing endpoints.
   Notes: 1) No layout width changes. 2) Fixed all template literal bugs, duplicate utils, and string concat.
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

  // IMPORTANT: you were using this below but it wasn’t declared
  // leave empty unless you want to force a specific week
  const MANUAL_WEEKLY_OVERRIDES = [];

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

  // --------- Allowed vendor labels (canonical, permanent)
  const VENDOR_SET = new Set([
    '$7.50', 'TTM Nice!', 'George Region Shared', 'Red Media', 'Blast/Bulk', 'Exclusive JUMBO', 'ABC',
    'Shared Jumbo', 'VS Default', 'RKA Website', 'Redrip/Give up Purchased', 'Lamy Dynasty Specials',
    'JUMBO Splits', 'Exclusive 30s', 'Positive Intent/Argos', 'HotLine Bling', 'Referral', 'CG Exclusive'
  ]);

  // --------- Name normalization (fixes F N / Fabricio variants)
  const NAME_ALIASES = new Map([
    ['f n','fabricio navarrete cervantes'],
    ['fab','fabricio navarrete cervantes'],
    ['fabrico','fabricio navarrete cervantes'],
    ['fabricio','fabricio navarrete cervantes'],
    ['fabricio navarrete','fabricio navarrete cervantes'],
    ['fabricio cervantes','fabricio navarrete cervantes'],
    ['fabricio navarrete cervantes','fabricio navarrete cervantes'],
    ['a s','ajani senior'],
    ['marie saint cyr','marie saint cyr'],
    ['eli thermilus','eli thermilus'],
    ['philip baxter','philip baxter'],
    ['robert adams','robert adams'],
    ['nathan johnson','nathan johnson'],
    ['anna gleason','anna'],
    ['sebastian beltran','sebastian beltran']
  ]);
  const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  // --------- Headshot resolver (with photoURL helper)
  function buildHeadshotResolver(roster) {
    const byName = new Map(), byEmail = new Map(), byPhone = new Map(), byInitial = new Map();

    const initialsOf = (full = '') => full.trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

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
      const ini   = (agent.name ? agent.name : '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
      return (
        byName.get(cName) ??
        byEmail.get(email) ??
        (phone ? byPhone.get(phone) : null) ??
        byInitial.get(ini) ??
        null
      );
    };
  }

  // --------- Layout anchors (match your index.html)
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const cards = { calls: $('#sumCalls'), av: $('#sumSales'), deals: $('#sumTalk') };
  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  // Remove legacy ticker if present
  const ticker = $('#ticker');
  if (ticker && ticker.parentNode) ticker.parentNode.removeChild(ticker);

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub) bannerSub.textContent = s || '';
  };

  // --------- Inject minimal CSS
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
  const saleId = (s) => String(
    s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`
  );

  // --------- Cards
  function renderCards({ calls, sold }) {
    const callsVal = safe(calls?.team?.calls, 0);

    let avVal = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
    if (!avVal && Array.isArray(sold?.perAgent)) {
      avVal = sold.perAgent.reduce((a,p)=> a + (+p.av12x || +p.av12X || +p.amount || 0), 0);
    }

    let dealsVal = safe(sold?.team?.totalSales, 0);
    if (!dealsVal && Array.isArray(sold?.perAgent)) {
      dealsVal = sold.perAgent.reduce((a,p)=> a + (+p.sales || 0), 0);
    }

    if (cards.calls) cards.calls.textContent = (callsVal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal || 0).toLocaleString();
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

  // --------- Vendors aggregation (rolling 45d)
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();
    for (const s of allSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < cutoff) continue;
      const vendorRaw = String(s.soldProductName || 'Unknown').trim();
      const vendor = VENDOR_SET.has(vendorRaw) ? vendorRaw : null;
      if (!vendor) continue;

      const amount = +s.amount || 0;
      const row = byName.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      row.deals += 1; row.amount += amount;
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

  // --------- Boards
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');
    const per = new Map();
    for (const a of (sold?.perAgent || [])) {
      const key = norm(canonicalName(a.name));
      per.set(key, {
        av: +a.av12x || +a.av12X || +a.amount || 0,
        deals: +a.sales || 0
      });
    }
    const rows = [];
    for (const p of roster || []) {
      const key = norm(canonicalName(p.name));
      const d = per.get(key) || { av:0, deals:0 };
      const photo = resolvePhoto({ name: p.name, email: p.email });
      const initials = (p.name || '').trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
      rows.push({ name:p.name, av:d.av, deals:d.deals, photo, initials });
    }
    rows.sort((a,b)=> b.av - a.av);

    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>
    `;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name, right1:fmtMoney(r.av), right2:(r.deals||0).toLocaleString(),
      photoUrl:r.photo, initial:r.initials
    })).join('');
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
        photoUrl: resolvePhoto({ name: p.name }),
        initial: (p.name || '').split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('')
      })).join('')}
      <tr class="total"><td><strong>Total</strong></td>
      <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td></tr>
    `;
  }

  // look up display name from roster by email
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
          if (em) map.set(em, p.name);
        }
        WEEKLY_ROSTER_CACHE = map;
        return map;
      }
    } catch (e) {}
    WEEKLY_ROSTER_CACHE = new Map();
    return WEEKLY_ROSTER_CACHE;
  }

  // --- WEEKLY ACTIVITY (calls_week_override.json)
  async function renderWeeklyActivity() {
    const headEl = document.querySelector('#thead');
    const bodyEl = document.querySelector('#tbody');
    const viewLabelEl = document.querySelector('#viewLabel');

    if (viewLabelEl) viewLabelEl.textContent = 'Weekly Activity';

    // pull override
    const res = await fetch('/calls_week_override.json', { cache: 'no-store' }).catch(() => null);
    const json = res && res.ok ? await res.json() : null;
    if (!json || typeof json !== 'object') {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No call data.</td></tr>`;
      return;
    }

    // build rows
    const rows = [];
    let rosterMap = null;
    try {
      rosterMap = await getRosterByEmail();
    } catch (e) {
      rosterMap = null;
    }

    for (const [email, stats] of Object.entries(json)) {
      const em = (email || '').toLowerCase();
      const rosterName = rosterMap ? rosterMap.get(em) : null;
      const nameFromEmail = (email || '').split('@')[0].replace(/\./g, ' ');
      const name = (rosterName || stats.name || nameFromEmail).replace(/\b\w/g, c => c.toUpperCase());
      const leads = Number(stats.leads || 0);
      const sold = Number(stats.sold || 0);
      const calls = Number(stats.calls || 0);
      const talkMin = Number(stats.talkMin || 0);
      const loggedMin = Number(stats.loggedMin || 0);
      const conv = leads ? +(sold * 100 / leads).toFixed(1) : 0;

      rows.push({ name, email, leads, sold, conv, calls, talkMin, loggedMin });
    }

    // sort: sold desc → leads desc
    rows.sort((a, b) => b.sold - a.sold || b.leads - a.leads);

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
        const initials = r.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
        return `
          <tr>
            <td style="display:flex;align-items:center;">
              <div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;font-size:12px;font-weight:700;color:#89a2c6;">${initials}</div>
              ${r.name}
            </td>
            <td class="right">${r.leads.toLocaleString()}</td>
            <td class="right">${r.sold.toLocaleString()}</td>
            <td class="right">${r.conv}%</td>
            <td class="right">${r.calls.toLocaleString()}</td>
            <td class="right">${r.talkMin.toLocaleString()}</td>
            <td class="right">${r.loggedMin.toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // --- AGENT OF THE WEEK (uses av_week_override.json + ytd_av.json)
  async function renderAgentOfWeek() {
    const headEl = document.querySelector('#thead');
    const bodyEl = document.querySelector('#tbody');
    const viewLabelEl = document.querySelector('#viewLabel');
    if (viewLabelEl) viewLabelEl.textContent = 'Agent of the Week';

    // weekly AV
    const weekRes = await fetch('/av_week_override.json', { cache: 'no-store' }).catch(() => null);
    const weekJson = weekRes && weekRes.ok ? await weekRes.json() : null;

    if (!Array.isArray(weekJson) || !weekJson.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      return;
    }

    // find top
    let top = null;
    for (const row of weekJson) {
      const name = row.name || row.agent || '';
      const av = Number(row.av12x || row.av || 0);
      if (!top || av > top.av) {
        top = { name, av };
      }
    }

    // YTD lookup
    let ytdVal = 0;
    const ytdRes = await fetch('/ytd_av.json', { cache: 'no-store' }).catch(() => null);
    const ytdJson = ytdRes && ytdRes.ok ? await ytdRes.json() : null;
    if (Array.isArray(ytdJson)) {
      const hit = ytdJson.find(x => (x.name || '').toLowerCase() === top.name.toLowerCase());
      if (hit) ytdVal = Number(hit.av || 0);
    }

    // headshot (from your roster)
    let photo = null;
    try {
      const rosterRes = await fetch('/headshots/roster.json', { cache: 'no-store' });
      if (rosterRes.ok) {
        const roster = await rosterRes.json();
        const m = Array.isArray(roster)
          ? roster.find(p => (p.name || '').toLowerCase() === top.name.toLowerCase())
          : null;
        if (m && m.photo) {
          const s = String(m.photo);
          photo = s.startsWith('http') || s.startsWith('/') ? s : `/headshots/${s}`;
        }
      }
    } catch (_) {
      /* ignore */
    }

    if (headEl) headEl.innerHTML = `<tr><th colspan="3">AGENT OF THE WEEK</th></tr>`;
    if (bodyEl) {
      const initials = top.name.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
      bodyEl.innerHTML = `
        <tr>
          <td colspan="3" style="padding:26px 18px;">
            <div style="display:flex;align-items:center;gap:18px;">
              ${
                photo
                  ? `<img src="${photo}" style="width:78px;height:78px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3);" />`
                  : `<div style="width:78px;height:78px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;border:2px solid rgba(255,255,255,.3);">${initials}</div>`
              }
              <div>
                <div style="font-size:20px;font-weight:700;">${top.name}</div>
                <div style="opacity:.8;margin-top:4px;">Weekly AV Submitted • $${Math.round(top.av).toLocaleString()}</div>
                <div style="opacity:.5;margin-top:2px;">YTD AV • $${Math.round(ytdVal).toLocaleString()}</div>
                <div style="margin-top:8px;background:rgba(0,255,128,.12);border:1px solid rgba(0,255,128,.4);border-radius:999px;display:inline-block;padding:3px 14px;font-size:12px;letter-spacing:.04em;">🏅 AGENT OF THE WEEK</div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
  }

  function renderVendorsBoard({ vendorRows }) {
    const data = Array.isArray(vendorRows?.rows) ? vendorRows : summarizeVendors([]);
    const rows = data.rows || [];
    const totalDeals = data.totalDeals || 0;

    setView('Lead Vendors — Last 45 Days');

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

    // donut by deals
    const size=240, cx=size/2, cy=size/2, r=size/2-8;
    const polar=(cx,cy,r,a)=>[cx + r*Math.cos(a), cy + r*Math.sin(a)];
    const arcPath=(cx,cy,r,a0,a1)=>{const large=(a1-a0)>Math.PI?1:0; const [x0,y0]=polar(cx,cy,r,a0); const [x1,y1]=polar(cx,cy,r,a1); return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;};
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
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text>
      </svg>
    `;

    if (headEl) headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals</th>
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

  // --------- Rules rotation (every 12h)
  function startRuleRotation(rulesJson) {
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list = Array.isArray(rulesJson?.rules) ? rulesJson.rules.filter(Boolean) : [];
    if (!list.length) {
      setBanner(base, 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.');
    } else {
      let i = 0;
      const apply = () => setBanner(base, list[i % list.length]);
      apply();
      setInterval(() => { i++; apply(); }, 12*60*60*1000);
    }
  }

  // ---------- Backfill Parser
  const BACKFILL_TEXT = `...`;// KEEP your giant pasted block here, I truncated for brevity

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
        if (!VENDOR_SET.has(vendor)) { continue; }
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

  // ---------- Data load ----------
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

    const soldSafe = sold || { team: { totalSales: 0, totalAV12X: 0 }, perAgent: [], allSales: [] };
    if (!Array.isArray(soldSafe.perAgent)) soldSafe.perAgent = [];

    // keep this — now MANUAL_WEEKLY_OVERRIDES exists
    if (Array.isArray(MANUAL_WEEKLY_OVERRIDES) && MANUAL_WEEKLY_OVERRIDES.length) {
      const overrideKeys = new Set(MANUAL_WEEKLY_OVERRIDES.map(o => norm(canonicalName(o.name))));
      soldSafe.perAgent = soldSafe.perAgent.filter(
        a => !overrideKeys.has(norm(canonicalName(a.name)))
      );
      for (const o of MANUAL_WEEKLY_OVERRIDES) {
        soldSafe.perAgent.push({
          name: o.name,
          av12x: +o.av12x || 0,
          sales: +o.sales || 0
        });
      }
    }

    const resolvePhoto = buildHeadshotResolver(roster || []);

    const liveAllSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const mergedAllSales = [...liveAllSales, ...BACKFILL_SALES];
    const vendorRows = summarizeVendors(mergedAllSales);

    if (Array.isArray(liveAllSales)) {
      const cutoff = Date.now() - 45*24*3600*1000;
      for (const s of liveAllSales) {
        const t = Date.parse(s.dateSold || s.date || '');
        if (Number.isFinite(t) && t >= cutoff) {
          seenLeadIds.add(saleId(s));
        }
      }
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 }, perAgent: [] },
      sold: soldSafe,
      vendorRows,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      resolvePhoto
    };
  }

  // --------- Board rotation (30s each)
  function startBoardRotation(data) {
    const order = [
      () => renderRosterBoard(data),
      () => renderYtdBoard(data),
      () => renderWeeklyActivity(data),
      () => renderVendorsBoard(data),
      () => renderParBoard(data),
    ];
    let i = 0;
    const paint = () => order[i % order.length]();
    paint();
    setInterval(() => { i++; paint(); }, 30_000);
  }

  // --------- Live sale polling
  function startLiveSalePolling(initialData) {
    const POLL_MS = 12_000;
    const cutoffWindow = 45 * 24 * 3600 * 1000;

    const tick = async () => {
      const sold = await fetchJSON(ENDPOINTS.teamSold);
      if (!sold) return;

      const liveAllSales = Array.isArray(sold.allSales) ? sold.allSales : [];
      const nowCutoff = Date.now() - cutoffWindow;

      let newSalesFound = false;

      for (const s of liveAllSales) {
        const id = saleId(s);
        const t  = Date.parse(s.dateSold || s.date || '');
        if (!seenLeadIds.has(id) && Number.isFinite(t) && t >= nowCutoff) {
          seenLeadIds.add(id);
          newSalesFound = true;
          showSplash({
            name: s.agent || 'Agent',
            amount: s.amount || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }

      if (newSalesFound) {
        renderCards({ calls: initialData.calls, sold });
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
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
    }
  })();
})();

// ---------- OE Countdown ----------
(function () {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;

  const deadline = new Date('2025-11-01T00:00:00-04:00');
  const pad = n => String(n).padStart(2, '0');

  function updateCountdown() {
    const now = new Date();
    const diff = deadline - now;
    if (diff <= 0) {
      timerEl.textContent = 'LIVE';
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
