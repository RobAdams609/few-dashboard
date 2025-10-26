/* FEW Dashboard — Single File, Final
   - Uses existing HTML (IDs: #sumCalls, #sumSales, #sumTalk, #thead, #tbody, #viewLabel)
   - Robust to missing endpoints
   - Vendor donut + legend from /api/team_sold (allSales) within rolling 45 days
   - Live sale alerts (gold), 60s persistence
   - 5 boards rotating every 30s
   - Rules rotate every 12 hours
   - PAR reads /par.json: { pace_target, agents:[{name,take_rate,annual_av}] }
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
  };

  // --------- Tiny utils
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n) => `$${Math.round(+n || 0).toLocaleString()}`;
  const safe = (v, d) => (v === undefined || v === null ? d : v);

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

  // --------- Color + SVG helpers for donut
  const VENDOR_COLORS = [
    '#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787',
    '#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'
  ];
  const colorFor = (name='') => {
    const h = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
    return VENDOR_COLORS[h % VENDOR_COLORS.length];
  };
  const polar = (cx,cy,r,a)=>[cx + r*Math.cos(a), cy + r*Math.sin(a)];
  const arcPath = (cx,cy,r,a0,a1) => {
    const large = (a1-a0) > Math.PI ? 1 : 0;
    const [x0,y0] = polar(cx,cy,r,a0);
    const [x1,y1] = polar(cx,cy,r,a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };

  // --------- Headshots: dynamic resolver from roster.json
  function buildHeadshotResolver(roster) {
    const byName    = new Map();
    const byEmail   = new Map();
    const byPhone   = new Map();
    const byInitial = new Map();

    const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const initialsOf = (full='') =>
      full.trim().split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');

    for (const p of roster || []) {
      const name  = norm(p.name);
      const email = (p.email || '').trim().toLowerCase();
      const photo = p.photo || null;

      if (name)  byName.set(name, photo);
      if (email) byEmail.set(email, photo);

      if (Array.isArray(p.phones)) {
        for (const raw of p.phones) {
          const phone = String(raw||'').replace(/\D+/g, '');
          if (phone) byPhone.set(phone, photo);
        }
      }
      const ini = initialsOf(p.name);
      if (ini) byInitial.set(ini, photo);
    }

    return (agent = {}) => {
      const name  = norm(agent.name);
      const email = (agent.email || '').trim().toLowerCase();
      const phone = String(agent.phone || '').replace(/\D+/g, '');
      const ini   = initialsOf(agent.name);

      return (
        byName.get(name)   ??
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

  // SUMMARY CARDS (your HTML uses these IDs)
  const cards = {
    calls: $('#sumCalls'),
    av:    $('#sumSales'),
    deals: $('#sumTalk'),
  };

  const boardTable  = $('#board');
  const headEl      = $('#thead');   // table head region
  const bodyEl      = $('#tbody');   // table body region
  const viewLabelEl = $('#viewLabel');

  // Remove legacy ticker (we use banner subtitle instead)
  const oldTicker = $('.ticker');
  if (oldTicker && oldTicker.parentNode) oldTicker.parentNode.removeChild(oldTicker);

  // Banner setter
  const setBanner = (headline, sub='') => {
    if (bannerTitle) bannerTitle.textContent = headline || '';
    if (bannerSub)   bannerSub.textContent   = sub || '';
  };

  // --------- Live sales alerts (gold toasts, 60s)
  const alertsRoot = (() => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.right = '24px';
    el.style.bottom = '24px';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.gap = '8px';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
    return el;
  })();

  function pushAlert({ name, soldProductName, amount }) {
    const card = document.createElement('div');
    card.style.padding = '12px 14px';
    card.style.borderRadius = '10px';
    card.style.background = 'linear-gradient(135deg,#9c7b00,#ffd34d)';
    card.style.color = '#1a1a1a';
    card.style.boxShadow = '0 6px 18px rgba(0,0,0,.35)';
    card.style.fontWeight = '700';
    card.style.maxWidth = '480px';
    card.style.fontSize = '14px';
    card.textContent = `${name} — ${soldProductName} • ${fmtMoney(amount)}`;
    alertsRoot.appendChild(card);
    setTimeout(() => card.remove(), 60_000); // 60 seconds
  }
  const seenLeadIds = new Set();

  // --------- Vendor summary (from team_sold.allSales)
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000; // rolling 45 days
    const byName = new Map();

    for (const s of allSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (!isFinite(t) || t < cutoff) continue;

      const vendor = (s.soldProductName || 'Unknown').trim();
      const amount = +s.amount || 0;

      const row = byName.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      row.deals += 1;
      row.amount += amount;
      byName.set(vendor, row);
    }

    const rows = [...byName.values()];
    const totalDeals = rows.reduce((a, b) => a + b.deals, 0) || 1;
    for (const r of rows) r.share = +(r.deals * 100 / totalDeals).toFixed(1);

    rows.sort((a,b) => b.deals - a.deals || b.amount - a.amount);
    return rows;
  }

  // --------- Render helpers
  function renderCards({ calls, sold }) {
    const callsVal = safe(calls?.team?.calls, 0);
    const avVal    = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
    const dealsVal = safe(sold?.team?.totalSales, 0);
    if (cards.calls)  cards.calls.textContent  = (callsVal || 0).toLocaleString();
    if (cards.av)     cards.av.textContent     = fmtMoney(avVal);
    if (cards.deals)  cards.deals.textContent  = (dealsVal || 0).toLocaleString();
  }

  function agentRowHTML({ name, right1, right2, photoUrl, initial }) {
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:26px;height:26px;border-radius:50%;background:#2a2a2a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;color:#ddd">${initial || '?'}</div>`;

    return `<tr>
      <td style="display:flex;align-items:center"><span>${avatar}</span><span>${name}</span></td>
      <td class="right">${right1}</td>
      ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
    </tr>`;
  }

  const setView = (label) => { if (viewLabelEl) viewLabelEl.textContent = label; };

  // --------- Boards
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');

    const per = new Map();
    for (const a of (sold?.perAgent || [])) {
      const key = (a.name || '').trim().toLowerCase();
      per.set(key, {
        av: a.av12x ?? a.av12X ?? a.amount ?? 0,
        deals: a.sales ?? 0
      });
    }

    const rows = [];
    for (const p of roster || []) {
      const key = (p.name || '').trim().toLowerCase();
      const d = per.get(key) || { av: 0, deals: 0 };
      const photo = resolvePhoto({ name: p.name, email: p.email });
      const initials = (p.name || '').split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
      rows.push({ name: p.name, av: d.av, deals: d.deals, photo, initials });
    }
    rows.sort((a,b) => b.av - a.av);

    headEl && (headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Submitted AV</th>
        <th class="right">Deals</th>
      </tr>
    `);
    bodyEl && (bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name: r.name,
      right1: fmtMoney(r.av),
      right2: (r.deals||0).toLocaleString(),
      photoUrl: r.photo,
      initial: r.initials
    })).join(''));
    if (!headEl || !bodyEl) boardTable.innerHTML = `<thead>${headEl.innerHTML}</thead><tbody>${bodyEl.innerHTML}</tbody>`;
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');

    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b) => (b.av||0) - (a.av||0));

    headEl && (headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">YTD AV</th></tr>
    `);
    bodyEl && (bodyEl.innerHTML = `
      ${rows.map(p => agentRowHTML({
        name: p.name,
        right1: fmtMoney(p.av||0),
        photoUrl: resolvePhoto({ name: p.name }),
        initial: (p.name||'').split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('')
      })).join('')}
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
      </tr>
    `);
  }

  function renderWeeklyActivity({ calls, sold, resolvePhoto }) {
    setView('Weekly Activity');

    const callMap = new Map();
    for (const a of (calls?.perAgent || [])) {
      callMap.set((a.name||'').trim().toLowerCase(), a.calls || 0);
    }
    const dealMap = new Map();
    for (const a of (sold?.perAgent || [])) {
      dealMap.set((a.name||'').trim().toLowerCase(), a.sales || 0);
    }

    const names = new Set([...callMap.keys(), ...dealMap.keys()]);
    const rows = [...names].map(k => {
      const display = k.replace(/\b\w/g, m => m.toUpperCase());
      return { key:k, name:display, calls:callMap.get(k)||0, deals:dealMap.get(k)||0 };
    }).sort((a,b) => (b.calls + b.deals) - (a.calls + a.deals));

    headEl && (headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Calls</th><th class="right">Deals</th></tr>
    `);
    bodyEl && (bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name: r.name,
      right1: (r.calls||0).toLocaleString(),
      right2: (r.deals||0).toLocaleString(),
      photoUrl: resolvePhoto({ name: r.name }),
      initial: r.name.split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('')
    })).join(''));
  }

  function renderVendorsBoard({ vendorRows }) {
    setView('Lead Vendors — Last 45 Days');

    if (!vendorRows || !vendorRows.length) {
      headEl && (headEl.innerHTML = '');
      bodyEl && (bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`);
      return;
    }

    const totalDeals = vendorRows.reduce((s,r)=>s+r.deals,0) || 1;
    const rows = vendorRows.map(v => ({
      name: v.name,
      deals: v.deals,
      share: +(v.deals*100/totalDeals).toFixed(1),
      color: colorFor(v.name)
    }));

    const size = 220, cx = size/2, cy = size/2, r = size/2 - 6;
    let acc = -Math.PI/2;
    const arcs = rows.map(v => {
      const span = 2*Math.PI*(v.deals/totalDeals);
      const d = arcPath(cx,cy,r,acc,acc+span);
      acc += span;
      return `<path d="${d}" stroke="${v.color}" stroke-width="26" fill="none"></path>`;
    }).join('');
    const svg = `
      <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Vendor share donut">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-14}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="14" fill="#9fb0c8">Total deals</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text>
      </svg>
    `;

    const theadHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals</th>
        <th class="right">% of total</th>
      </tr>
    `;
    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px">
          <div class="vendor-flex">
            ${svg}
            <div class="legend">
              ${rows.map(v=>`<div class="legend-item">
                <span class="dot" style="background:${v.color}"></span>
                <span class="label">${v.name}</span>
                <span class="val">${v.deals.toLocaleString()} • ${v.share}%</span>
              </div>`).join('')}
            </div>
          </div>
        </td>
      </tr>
    `;
    const rowsHTML = rows.map(v => `
      <tr>
        <td><span class="dot" style="background:${v.color}"></span>${v.name}</td>
        <td class="right">${v.deals.toLocaleString()}</td>
        <td class="right" style="color:${v.color}">${v.share}%</td>
      </tr>
    `).join('');

    headEl && (headEl.innerHTML = theadHTML);
    bodyEl && (bodyEl.innerHTML = donutRow + rowsHTML);
  }

  function renderParBoard({ par }) {
    setView('PAR — Tracking');

    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];
    if (!agents.length) {
      headEl && (headEl.innerHTML = '');
      bodyEl && (bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`);
      return;
    }

    headEl && (headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Take&nbsp;Rate</th>
        <th class="right">Annual&nbsp;AV</th>
      </tr>
    `);
    bodyEl && (bodyEl.innerHTML = `
      ${agents.map(a => `
        <tr>
          <td>${a.name}</td>
          <td class="right">${safe(a.take_rate, 0)}%</td>
          <td class="right">${fmtMoney(safe(a.annual_av, 0))}</td>
        </tr>
      `).join('')}
      <tr class="total">
        <td><strong>PACE TO QUALIFY</strong></td>
        <td></td>
        <td class="right"><strong>${fmtMoney(pace)}</strong></td>
      </tr>
    `);
  }

  // --------- Rules (headline rotates every 12 hours)
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

  // --------- Data load
  async function loadAll() {
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par),
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);

    // Vendor rows
    const vendorRows = summarizeVendors(sold?.allSales || []);

    // Live alerts (only for last 45d, dedup by id)
    if (Array.isArray(sold?.allSales)) {
      for (const s of sold.allSales) {
        const id = s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.soldProductName}-${s.amount}`;
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          const t = Date.parse(s.dateSold || s.date || '');
          if (isFinite(t) && (Date.now() - t) <= 45 * 24 * 3600 * 1000) {
            pushAlert({
              name: s.agent || 'Agent',
              soldProductName: s.soldProductName || 'Sale',
              amount: s.amount || 0
            });
          }
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
      resolvePhoto
    };
  }

  // --------- Board rotation (5 boards x 30s)
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
