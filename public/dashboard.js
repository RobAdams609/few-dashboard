/* FEW Dashboard — Single File, Final
   Boards: This Week — Roster | YTD — Team | Weekly Activity | Lead Vendors (45d) | PAR — Tracking
   Extras: Center splash on new sale (60s), vendor donut+legend, headshots with canonical names,
           rules rotation every 12h (no top ticker), resilient to missing endpoints.
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
    leadsPurchased: '/api/leads_purchased',
  };

  // --------- Tiny utils
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n) => `$${Math.round(+n || 0).toLocaleString()}`;
  const safe = (v, d) => (v === undefined || v === null ? d : v);
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

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

  // Leads purchased (this week) helper
  async function fetchLeadsPurchased() {
    const raw = await fetchJSON(ENDPOINTS.leadsPurchased);
    if (!raw) return new Map();

    const weekStart = Date.now() - 7 * 24 * 3600 * 1000;
    const byAgent = new Map();
    const bump = (name, n = 1) => {
      if (!name) return;
      const k = String(name).trim().toLowerCase();
      byAgent.set(k, (byAgent.get(k) || 0) + n);
    };

    // Aggregated shape
    if (Array.isArray(raw?.perAgent)) {
      for (const r of raw.perAgent) bump(r.name, +r.leads || +r.count || 0);
      return byAgent;
    }

    // Flat list shape
    if (Array.isArray(raw)) {
      for (const e of raw) {
        const who = e.agent || e.buyer || e.owner || e.name;
        const t = Date.parse(e.createdAt || e.date || e.purchasedAt || '');
        if (isFinite(t) && t >= weekStart) bump(who, 1);
      }
      return byAgent;
    }

    return byAgent;
  }

  // --------- Name normalization (fixes F N / Fabricio variants)
  const NAME_ALIASES = new Map([
    ['f n', 'fabricio navarrete cervantes'],
    ['fab', 'fabricio navarrete cervantes'],
    ['fabrico', 'fabricio navarrete cervantes'],
    ['fabricio', 'fabricio navarrete cervantes'],
    ['fabricio navarrete', 'fabricio navarrete cervantes'],
    ['fabricio cervantes', 'fabricio navarrete cervantes'],
    ['fabricio navarrete cervantes', 'fabricio navarrete cervantes'],
  ]);
  const canonicalName = name => NAME_ALIASES.get(norm(name)) || name;

  // --------- Vendor normalization (lock to your permanent labels)
  const VENDOR_LABELS = [
    '$7.50','TTM Nice!','George Region Shared','Red Media','Blast/Bulk','Exclusive JUMBO','ABC',
    'Shared Jumbo','VS Default','RKA Website','Redrip/Give up Purchased','Lamy Dynasty Specials',
    'JUMBO Splits','Exclusive 30s','Positive Intent/Argos','HotLine Bling','Referral','CG Exclusive'
  ];

  // map common messy variants → canonical labels above
  const VENDOR_MAP = new Map([
    // direct matches handled automatically
    // frequent variants / noise → canonical
    ['red media', 'Red Media'],
    ['blast', 'Blast/Bulk'], ['blast/bulk', 'Blast/Bulk'],
    ['abc', 'ABC'],
    ['vs default', 'VS Default'], ['vs', 'VS Default'],
    ['rka website', 'RKA Website'], ['website', 'RKA Website'],
    ['redrip', 'Redrip/Give up Purchased'], ['give up purchased', 'Redrip/Give up Purchased'],
    ['lamy dynasty specials', 'Lamy Dynasty Specials'], ['lamy dynasty', 'Lamy Dynasty Specials'],
    ['jumbo splits', 'JUMBO Splits'], ['jumbo split', 'JUMBO Splits'],
    ['exclusive 30s', 'Exclusive 30s'], ['exclusive 30', 'Exclusive 30s'],
    ['positive intent', 'Positive Intent/Argos'], ['argos', 'Positive Intent/Argos'],
    ['hotline bling', 'HotLine Bling'],
    ['referral', 'Referral'],
    ['cg exclusive', 'CG Exclusive'],
    ['george region shared', 'George Region Shared'],
    ['$7.50', '$7.50'], ['7.50', '$7.50'], ['$ 7.50', '$7.50'],
    // junk that is NOT a vendor (plans/products) → ignore vendor change (we’ll keep last known or mark Unknown)
    ['uhc', null], ['secure advantage', null], ['health access', null], ['secure access', null],
    ['dental/vision', null], ['pa/pc', null], ['aca', null], ['aca/suppy', null], ['aca/suppy/wrap', null],
    ['supplemental', null], ['stand alone supplemental', null]
  ]);

  function normalizeVendor(raw) {
    const s = norm(raw);
    // try exact canonical match first
    for (const label of VENDOR_LABELS) {
      if (s === norm(label)) return label;
    }
    // try mapped variants
    for (const [k, v] of VENDOR_MAP.entries()) {
      if (s.includes(k)) return v === null ? null : v; // null means “not a vendor label”
    }
    // heuristic: strip trailing amounts like "Red Media - $123"
    const hyphen = s.split('-')[0].trim();
    for (const label of VENDOR_LABELS) {
      if (norm(label) === hyphen) return label;
    }
    // unknown → keep original casing if it’s close to any known label, else “Other”
    const title = raw && String(raw).trim();
    if (title) return title;
    return 'Other';
  }

  // --------- Headshot resolver (with photoURL helper)
  function buildHeadshotResolver(roster) {
    const byName = new Map(), byEmail = new Map(), byPhone = new Map(), byInitial = new Map();

    const initialsOf = (full = '') =>
      full.trim().split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');

    const photoURL = (p) => {
      if (!p) return null;
      const s = String(p);
      return (s.startsWith('http') || s.startsWith('/')) ? s : `/headshots/${s}`;
    };

    // index by canonical name, email, phone, initials
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
      const ini = initialsOf(p.name);
      if (ini) byInitial.set(ini, photo);
    }

    // resolver used by all boards
    return (agent = {}) => {
      const cName = norm(canonicalName(agent.name));
      const email = String(agent.email || '').trim().toLowerCase();
      const phone = String(agent.phone || '').replace(/\D+/g, '');
      const ini   = initialsOf(agent.name);
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
    if (bannerSub)   bannerSub.textContent   = s || '';
  };

  // --------- Inject minimal CSS (donut + legend + splash)
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

  // --------- Cards (top 3)
  function renderCards({ calls, sold }) {
    const callsVal = safe(calls?.team?.calls, 0);

    let avVal = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
    if (!avVal && Array.isArray(sold?.perAgent)) {
      avVal = sold.perAgent.reduce((a,p)=>a + (+p.av12x || +p.av12X || +p.amount || 0), 0);
    }

    let dealsVal = safe(sold?.team?.totalSales, 0);
    if (!dealsVal && Array.isArray(sold?.perAgent)) {
      dealsVal = sold.perAgent.reduce((a,p)=>a + (+p.sales || 0), 0);
    }

    if (cards.calls) cards.calls.textContent = (callsVal||0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal||0).toLocaleString();
  }

  function agentRowHTML({ name, right1, right2, photoUrl, initial }) {
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initial || '?'}</div>`;
    return `<tr>
      <td class="agent" style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
      <td class="right">${right1}</td>
      ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
    </tr>`;
  }

  // --------- Vendors aggregation (rolling 45d, normalized)
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();

    for (const s of allSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (!isFinite(t) || t < cutoff) continue;

      // vendor can live in multiple fields; prefer soldProductName
      const rawVendor = s.soldProductName || s.leadVendor || s.vendor || s.source || '';
      const vendor = normalizeVendor(rawVendor);
      if (vendor === null) continue; // skip things like "UHC", plan lines, etc.

      // amount fallback chain (handle numbers like 159.12 or strings "$159.12")
      let amount = +s.amount || +s.av12x || +s.av12X || 0;
      if (!amount && typeof s.amount === 'string') {
        const m = s.amount.match(/[\d,.]+/g);
        if (m) amount = +m.join('').replace(/,/g, '');
      }

      const key = vendor || 'Other';
      const row = byName.get(key) || { name: key, deals: 0, amount: 0 };
      row.deals += 1;
      row.amount += amount;
      byName.set(key, row);
    }

    // ensure only canonical labels are present; bucket unknowns as "Other"
    const rows = [];
    let other = null;
    for (const [name, r] of byName.entries()) {
      if (VENDOR_LABELS.includes(name)) rows.push(r);
      else {
        other = other || { name: 'Other', deals: 0, amount: 0 };
        other.deals += r.deals;
        other.amount += r.amount;
      }
    }
    if (other) rows.push(other);

    const totalDeals  = rows.reduce((a,r)=>a+r.deals,0) || 1;
    const totalAmount = rows.reduce((a,r)=>a+r.amount,0);
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
      const initials = (p.name||'').trim().split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
      rows.push({ name:p.name, av:d.av, deals:d.deals, photo, initials });
    }
    rows.sort((a,b)=> b.av - a.av);

    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name, right1:fmtMoney(r.av), right2:(r.deals||0).toLocaleString(),
      photoUrl:r.photo, initial:r.initials
    })).join('');
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b)=> (b.av||0) - (a.av||0));
    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av||0),
        photoUrl: resolvePhoto({ name: p.name }),
        initial: (p.name||'').split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('')
      })).join('')}
      <tr class="total"><td><strong>Total</strong></td>
      <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td></tr>
    `;
  }

  function renderWeeklyActivity({ calls, sold, resolvePhoto }) {
    setView('Weekly Activity');
    const callMap = new Map();
    for (const a of (calls?.perAgent || [])) {
      callMap.set(norm(canonicalName(a.name)), +a.calls || 0);
    }
    const dealMap = new Map();
    for (const a of (sold?.perAgent || [])) {
      dealMap.set(norm(canonicalName(a.name)), +a.sales || 0);
    }
    const names = new Set([...callMap.keys(), ...dealMap.keys()]);
    const rows = [...names].map(k => {
      const disp = k.replace(/\b\w/g, m => m.toUpperCase());
      return { key:k, name:disp, calls:callMap.get(k)||0, deals:dealMap.get(k)||0 };
    }).sort((a,b)=> (b.calls+b.deals) - (a.calls+a.deals));

    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Calls</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name,
      right1:(r.calls||0).toLocaleString(),
      right2:(r.deals||0).toLocaleString(),
      photoUrl: resolvePhoto({ name: r.name }),
      initial: r.name.split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('')
    })).join('');
  }

  function renderVendorsBoard({ vendorRows }) {
    const data = Array.isArray(vendorRows?.rows) ? vendorRows : summarizeVendors([]);
    const rows = data.rows || [];
    const totalDeals = data.totalDeals || 0;
    const totalAmount = data.totalAmount || 0;

    setView('Lead Vendors — Last 45 Days');

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    const COLORS = ['#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787','#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'];
    const colorFor = (name='') => {
      const h = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
      return COLORS[h % COLORS.length];
    };

    // donut by deals
    const size=240, cx=size/2, cy=size/2, r=size/2-8;
    const polar=(cx,cy,r,a)=>[cx+r*Math.cos(a), cy+r*Math.sin(a)];
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
        <th class="right">Amount (45d)</th>
      </tr>
    `;

    const legend = rows.map(v => `
      <div class="legend-item">
        <span class="dot" style="background:${colorFor(v.name)}"></span>
        <span class="label">${v.name}</span>
        <span class="val">${v.deals.toLocaleString()} • ${v.shareDeals}% • ${fmtMoney(v.amount)}</span>
      </div>`).join('');

    const donutRow = `
      <tr>
        <td colspan="4" style="padding:18px">
          <div class="vendor-flex">${svg}<div class="legend">${legend}</div></div>
        </td>
      </tr>
    `;

    const rowsHTML = rows.map(v => `
      <tr>
        <td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${colorFor(v.name)}">${v.shareDeals}%</td>
        <td class="right">${fmtMoney(v.amount)}</td>
      </tr>`).join('');

    const totals = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals.toLocaleString()}</strong></td>
        <td></td>
        <td class="right"><strong>${fmtMoney(totalAmount)}</strong></td>
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
      <tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">Annual&nbsp;AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${agents.map(a => `
        <tr>
          <td>${a.name}</td>
          <td class="right">${safe(a.take_rate,0)}%</td>
          <td class="right">${fmtMoney(safe(a.annual_av,0))}</td>
        </tr>`).join('')}
      <tr class="total"><td><strong>PACE TO QUALIFY</strong></td><td></td>
      <td class="right"><strong>${fmtMoney(pace)}</strong></td></tr>
    `;
  }

  // --------- Rules rotation (every 12h) — no ticker
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
    setInterval(() => { i++; apply(); }, 12*60*60*1000);
  }

  // ---------- Data load ----------
  async function loadAll() {
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par, leadsPurchasedMap] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par),
      fetchLeadsPurchased(),
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);

    // Vendor rows object — computed from last 45d of allSales
    const vendorRows = summarizeVendors(sold?.allSales || []);

    // Center splash alerts for new sales within 45d
    if (Array.isArray(sold?.allSales)) {
      const cutoff = Date.now() - 45*24*3600*1000;
      for (const s of sold.allSales) {
        const id = s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.soldProductName}-${s.amount}`;
        const t = Date.parse(s.dateSold || s.date || '');
        if (!seenLeadIds.has(id) && isFinite(t) && t >= cutoff) {
          seenLeadIds.add(id);
          showSplash({
            name: s.agent || 'Agent',
            amount: s.amount || 0,
            soldProductName: s.soldProductName || ''
          });
        }
      }
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 }, perAgent: [] },
      sold: sold || { team: { totalSales: 0, totalAV12X: 0 }, perAgent: [], allSales: [] },
      vendorRows,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target: 0, agents: [] },
      leadsPurchased: leadsPurchasedMap || {},
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

  // --------- Boot
  (async () => {
    try {
      const data = await loadAll();
      renderCards(data);
      startRuleRotation(data.rules);
      startBoardRotation(data);
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

  // Set your OE deadline here (ET)
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
