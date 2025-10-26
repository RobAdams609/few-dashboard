/* =========================================
   FEW Dashboard — Single File Override
   - No hardcoded headshot list
   - Uses /headshots/roster.json for mapping
   - Works with your existing index.html
   ========================================= */

(() => {
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    salesByVendor: '/sales_by_vendor.json', // TEMP fallback while server API needs env vars
    ytdAv: '/ytd_av.json',                  // FIX: root, not /boards/
    ytdTotal: '/ytd_total.json',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
  };

  // ----- tiny utils
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n) => `$${(+n || 0).toLocaleString()}`;

  const fetchJSON = async (url) => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  };

  // ---------- Headshots: build dynamic resolver from roster.json
  function buildHeadshotResolver(roster) {
    const byName    = new Map();
    const byEmail   = new Map();
    const byPhone   = new Map();
    const byInitial = new Map();

    const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const initialsOf = (full) =>
      (full || '')
        .split(/\s+/)
        .map(w => w[0] ? w[0].toUpperCase() : '')
        .join('');

    for (const person of roster || []) {
      const name   = norm(person.name);
      const email  = (person.email || '').trim().toLowerCase();
      const photo  = person.photo || null;

      if (name) byName.set(name, photo);
      if (email) byEmail.set(email, photo);
      if (Array.isArray(person.phones)) {
        for (const p of person.phones) {
          const phone = (p || '').replace(/\D+/g, '');
          if (phone) byPhone.set(phone, photo);
        }
      }
      const ini = initialsOf(person.name);
      if (ini) byInitial.set(ini, photo);
    }

    // Resolve in this order: name → email → phone → initials → null
    return (agent = {}) => {
      const name = norm(agent.name);
      const email = (agent.email || '').trim().toLowerCase();
      const phone = (agent.phone || '').replace(/\D+/g, '');
      const ini = initialsOf(agent.name);

      return (
        byName.get(name) ??
        byEmail.get(email) ??
        (phone ? byPhone.get(phone) : null) ??
        byInitial.get(ini) ??
        null
      );
    };
  }

  // ---------- Layout anchors (use the existing structure on page)
  const bannerEl   = $('.banner .title');
  const blurbEl    = $('.banner .subtitle');
  const cards = {
    calls:  $$('.cards .card .value')[0] || $('#metric-calls'),
    av:     $$('.cards .card .value')[1] || $('#metric-av'),
    deals:  $$('.cards .card .value')[2] || $('#metric-deals'),
  };
  const boardTitleEl = $('#board-title') || $('.section h3') || $('.board-title');
  const boardEl      = $('#board')       || $('.table')      || $('.board');

  // Remove old “Rule of the Day — …” ticker if present
  const oldTicker = $('.ticker');
  if (oldTicker && oldTicker.parentNode) oldTicker.parentNode.removeChild(oldTicker);

  // Make banner headline big + rotating rule lives here
  const setBanner = (headline, sub) => {
    if (bannerEl) bannerEl.textContent = headline || '';
    if (blurbEl)  blurbEl.textContent  = sub || '';
  };

  // ---------- Data loaders
  async function loadAll() {
    const [rules, roster, calls, sold] = await Promise.all([
      fetchJSON(ENDPOINTS.rules).catch(() => ({rules: []})),
      fetchJSON(ENDPOINTS.roster).catch(() => []),
      fetchJSON(ENDPOINTS.callsByAgent).catch(() => ({team: {calls: 0}})),
      fetchJSON(ENDPOINTS.teamSold).catch(() => ({team: {totalSales:0,totalAV12X:0}, perAgent: []})),
    ]);

    let vendors = null;
    try { vendors = await fetchJSON(ENDPOINTS.salesByVendor); }
    catch { vendors = null; }

    let ytdList = [];
    let ytdTotal = 0;
    try { ytdList  = await fetchJSON(ENDPOINTS.ytdAv); } catch {}
    try { const t  = await fetchJSON(ENDPOINTS.ytdTotal); ytdTotal = t?.ytd_av_total || 0; } catch {}

    return { rules, roster, calls, sold, vendors, ytdList, ytdTotal };
  }

  // ---------- Cards
  function renderCards({ calls, sold }) {
    const callsVal = calls?.team?.calls ?? 0;
    const avVal    = sold?.team?.totalAV12X ?? 0;
    const dealsVal = sold?.team?.totalSales ?? 0;

    if (cards.calls)  cards.calls.textContent  = (callsVal || 0).toLocaleString();
    if (cards.av)     cards.av.textContent     = fmtMoney(avVal);
    if (cards.deals)  cards.deals.textContent  = (dealsVal || 0).toLocaleString();
  }

  // ---------- Board: Roster (show EVERY agent, even with $0)
  function renderRosterBoard({ roster, sold }) {
    const per = new Map();
    for (const a of (sold?.perAgent || [])) {
      per.set((a.name || '').trim().toLowerCase(), {
        av: a.av12x || a.av12X || a.amount || 0,
        deals: a.sales || 0
      });
    }

    boardTitleEl && (boardTitleEl.textContent = 'This Week — Roster');

    const rows = [];
    for (const person of roster || []) {
      const key = (person.name || '').trim().toLowerCase();
      const data = per.get(key) || { av: 0, deals: 0 };
      rows.push({
        name: person.name,
        av: data.av,
        deals: data.deals
      });
    }

    rows.sort((a,b) => b.av - a.av);

    boardEl.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Agent</th>
            <th class="right">Submitted AV</th>
            <th class="right">Deals</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.name}</td>
              <td class="right">${fmtMoney(r.av)}</td>
              <td class="right">${(r.deals||0).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ---------- Board: Agent of the Week
  function renderAotWBoard({ sold, ytdList }) {
    boardTitleEl && (boardTitleEl.textContent = 'Agent of the Week');

    const per = sold?.perAgent || [];
    if (!per.length) {
      boardEl.innerHTML = `<div class="empty">No sales yet this week.</div>`;
      return;
    }

    // top current week by av12x
    const top = [...per].map(x => ({
      name: x.name,
      av: x.av12x || x.av12X || x.amount || 0,
      deals: x.sales || 0
    })).sort((a,b) => b.av - a.av)[0];

    // YTD for that person (optional)
    let ytd = 0;
    if (Array.isArray(ytdList)) {
      const hit = ytdList.find(p => (p.name || '').trim().toLowerCase() === (top.name || '').trim().toLowerCase());
      ytd = hit?.av || 0;
    }

    boardEl.innerHTML = `
      <div class="card aotw">
        <div class="aotw-name">${top.name}</div>
        <div class="aotw-stats">
          <span>${(top.deals||0)} deal${top.deals === 1 ? '' : 's'} (this week)</span>
          <span>${fmtMoney(top.av)} submitted AV (this week)</span>
          <span>${fmtMoney(ytd)} YTD AV</span>
        </div>
      </div>
    `;
  }

  // ---------- Board: Vendors (fallback if API not available)
  function renderVendorsBoard({ vendors }) {
    boardTitleEl && (boardTitleEl.textContent = 'Lead Vendors — Last 45 Days');

    if (!vendors || !Array.isArray(vendors) || !vendors.length) {
      boardEl.innerHTML = `<div class="empty">No vendor data yet.</div>`;
      return;
    }

    const rows = vendors
      .map(v => ({ name: v.vendor || v.name || 'Unknown', deals: v.count || 0 }))
      .sort((a,b) => b.deals - a.deals);

    const total = rows.reduce((s,r) => s + r.deals, 0) || 1;

    boardEl.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Vendor</th>
            <th class="right">Deals</th>
            <th class="right">% of total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.name}</td>
              <td class="right">${r.deals.toLocaleString()}</td>
              <td class="right">${((r.deals/total)*100).toFixed(1)}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ---------- Board: YTD Team
  function renderYtdBoard({ ytdList, ytdTotal }) {
    boardTitleEl && (boardTitleEl.textContent = 'YTD — Team');

    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b) => (b.av || 0) - (a.av || 0));

    boardEl.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Agent</th>
            <th class="right">YTD AV</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.name}</td>
              <td class="right">${fmtMoney(r.av || 0)}</td>
            </tr>
          `).join('')}
          <tr class="total">
            <td><strong>Total</strong></td>
            <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
          </tr>
        </tbody>
      </table>
    `;
  }

  // ---------- Board: PAR (manual until a list is provided)
  function renderParBoard() {
    boardTitleEl && (boardTitleEl.textContent = 'PAR — On Track');
    boardEl.innerHTML = `<div class="empty">No PAR list provided.</div>`;
  }

  // ---------- Rule rotator (headline)
  function startRuleRotation(rulesJson) {
    const list = Array.isArray(rulesJson?.rules) ? rulesJson.rules.filter(Boolean) : [];
    const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    if (!list.length) {
      setBanner(base, 'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.');
      return;
    }

    let i = 0;
    const apply = () => setBanner(base, list[i % list.length]);
    apply();
    setInterval(() => { i++; apply(); }, 8000);
  }

  // ---------- Board rotation orchestrator
  function startBoardRotation(data) {
    const renderers = [
      () => renderRosterBoard(data),
      () => renderAotWBoard(data),
      () => renderVendorsBoard(data),
      () => renderYtdBoard(data),
      () => renderParBoard(),
    ];

    let i = 0;
    const paint = () => renderers[i % renderers.length]();
    paint();
    setInterval(() => { i++; paint(); }, 20000);
  }

  // ---------- Boot
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
