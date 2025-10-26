/* FEW Dashboard — Single File, Safe & Final
   - Uses your existing HTML (no placeholders).
   - Robust to missing endpoints.
   - Vendor board computed from /api/team_sold (allSales) within rolling 45 days.
   - PAR board reads /par.json: { pace_target, agents:[{name,take_rate,annual_av?}] }
*/

(() => {
  // --------- Endpoints (exactly as your site uses) ---------
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json' // manual override file you manage
  };

  // --------- Tiny utils ---------
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

  // --------- Headshots: build dynamic resolver from roster.json ---------
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

  // --------- Layout anchors from your page ---------
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const cards = {
    calls:  $$('.cards .card .value')[0] || $('#metric-calls'),
    av:     $$('.cards .card .value')[1] || $('#metric-av'),
    deals:  $$('.cards .card .value')[2] || $('#metric-deals'),
  };
  const boardTitleEl = $('#board-title') || $('.section h3') || $('.board-title');
  const boardEl      = $('#board')       || $('.table')      || $('.board');

  // remove old ticker if any
  const oldTicker = $('.ticker');
  if (oldTicker && oldTicker.parentNode) oldTicker.parentNode.removeChild(oldTicker);

  // lightweight banner setter
  const setBanner = (headline, sub='') => {
    if (bannerTitle) bannerTitle.textContent = headline || '';
    if (bannerSub)   bannerSub.textContent   = sub || '';
  };

  // --------- Live sales alerts (gold toasts, 60s) ---------
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

  // Dedup alerting
  const seenLeadIds = new Set();

  // --------- Vendor summary (from team_sold.allSales) ---------
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();

    for (const s of allSales) {
      // dateSold may be string; be defensive
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

  // --------- Render helpers ---------
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
      <td style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
      <td class="right">${right1}</td>
      ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
    </tr>`;
  }

  // --------- Boards ---------
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    boardTitleEl && (boardTitleEl.textContent = 'This Week — Roster');

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
      rows.push({
        name: p.name,
        av: d.av, deals: d.deals,
        photo, initials
      });
    }

    rows.sort((a,b) => b.av - a.av);

    boardEl.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Agent</th>
          <th class="right">Submitted AV</th>
          <th class="right">Deals</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => agentRowHTML({
            name: r.name,
            right1: fmtMoney(r.av),
            right2: (r.deals||0).toLocaleString(),
            photoUrl: r.photo,
            initial: r.initials
          })).join('')}
        </tbody>
      </table>
    `;
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    boardTitleEl && (boardTitleEl.textContent = 'YTD — Team');

    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b) => (b.av||0) - (a.av||0));

    boardEl.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Agent</th>
          <th class="right">YTD AV</th>
        </tr></thead>
        <tbody>
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
        </tbody>
      </table>
    `;
  }

  function renderWeeklyActivity({ calls, sold, resolvePhoto }) {
    boardTitleEl && (boardTitleEl.textContent = 'Weekly Activity');

    // per agent calls
    const callMap = new Map();
    for (const a of (calls?.perAgent || [])) {
      callMap.set((a.name||'').trim().toLowerCase(), a.calls || 0);
    }

    // per agent deals (from sold)
    const dealMap = new Map();
    for (const a of (sold?.perAgent || [])) {
      dealMap.set((a.name||'').trim().toLowerCase(), a.sales || 0);
    }

    // union of names
    const names = new Set([...callMap.keys(), ...dealMap.keys()]);
    const rows = [...names].map(k => {
      const display = k.replace(/\b\w/g, m => m.toUpperCase());
      return {
        key: k,
        name: display,
        calls: callMap.get(k) || 0,
        deals: dealMap.get(k) || 0
      };
    }).sort((a,b) => (b.calls + b.deals) - (a.calls + a.deals));

    boardEl.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Agent</th>
          <th class="right">Calls</th>
          <th class="right">Deals</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => agentRowHTML({
            name: r.name,
            right1: (r.calls||0).toLocaleString(),
            right2: (r.deals||0).toLocaleString(),
            photoUrl: resolvePhoto({ name: r.name }),
            initial: r.name.split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('')
          })).join('')}
        </tbody>
      </table>
    `;
  }

  function renderVendorsBoard({ vendorRows }) {
    boardTitleEl && (boardTitleEl.textContent = 'Lead Vendors — Last 45 Days');

    if (!vendorRows.length) {
      boardEl.innerHTML = `<div class="empty">No vendor data yet.</div>`;
      return;
    }

    // simple color band by share
    const color = (pct) =>
      pct >= 40 ? '#ffd34d' :
      pct >= 20 ? '#f5c24a' :
      pct >= 10 ? '#e8b147' : '#d7a044';

    boardEl.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Vendor</th>
          <th class="right">Deals</th>
          <th class="right">% of total</th>
        </tr></thead>
        <tbody>
          ${vendorRows.map(v => `
            <tr>
              <td>${v.name}</td>
              <td class="right">${v.deals.toLocaleString()}</td>
              <td class="right" style="color:${color(v.share)}">${v.share}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderParBoard({ par }) {
    boardTitleEl && (boardTitleEl.textContent = 'PAR — Tracking');

    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];

    if (!agents.length) {
      boardEl.innerHTML = `<div class="empty">No PAR list provided.</div>`;
      return;
    }

    boardEl.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Agent</th>
          <th class="right">Take&nbsp;Rate</th>
          <th class="right">Annual&nbsp;AV</th>
        </tr></thead>
        <tbody>
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
        </tbody>
      </table>
    `;
  }

  // --------- Rules (headline rotates every 12 hours) ---------
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
    setInterval(() => { i++; apply(); }, 12 * 60 * 60 * 1000); // 12 hours
  }

  // --------- Data load ---------
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

    // vendor rows
    const vendorRows = summarizeVendors(sold?.allSales || []);

    // build alert list from allSales (only new)
    if (Array.isArray(sold?.allSales)) {
      for (const s of sold.allSales) {
        const id = s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.soldProductName}-${s.amount}`;
        if (!seenLeadIds.has(id)) {
          seenLeadIds.add(id);
          // show alert for most recent 45d only
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

  // --------- Board rotation (5 boards x 30s) ---------
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

  // --------- Boot ---------
  (async () => {
    try {
      const data = await loadAll();
      renderCards(data);
      startRuleRotation(data.rules);
      startBoardRotation(data);
    } catch (err) {
      console.error(err);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (boardEl) boardEl.innerHTML = `<div class="empty">Could not load dashboard data.</div>`;
    }
  })();

})();
