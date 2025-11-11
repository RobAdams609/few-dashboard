(() => {
  // ---------- Endpoints ----------
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json',
    weeklyOverride: '/overrides/calls_week_override.json'
  };

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const fmtMoney = n => `$${Math.round(Number(n) || 0).toLocaleString()}`;
  const norm = s => String(s || '').trim().toLowerCase();
  const now = () => new Date();

  // EST helper (treat incoming as ISO / UTC; compare in EST)
  const toEST = d => {
    const dt = new Date(d);
    // New York offset via locale; avoids hardcoding DST
    const estStr = dt.toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(estStr);
  };

  // This Week window (Fri 00:00 → Thu 23:59:59 EST)
  function getThisWeekWindowEST() {
    const estNow = toEST(now());
    const day = estNow.getDay(); // 0=Sun..6=Sat
    // We want last Friday
    const diffToFri = (day + 7 - 5) % 7; // days since Fri
    const start = new Date(estNow);
    start.setDate(estNow.getDate() - diffToFri);
    start.setHours(0,0,0,0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    end.setMilliseconds(-1); // Thu 23:59:59
    return { start, end };
  }

  // 45d rolling window (EST)
  function inLast45DaysEST(dateStr) {
    const d = toEST(dateStr);
    const cutoff = now().getTime() - 45*24*3600*1000;
    return d.getTime() >= cutoff;
  }

  const VENDOR_SET = new Set([
    '$7.50','TTM Nice!','George Region Shared','Red Media','Blast/Bulk',
    'Exclusive JUMBO','ABC','Shared Jumbo','VS Default','RKA Website',
    'Redrip/Give up Purchased','Lamy Dynasty Specials','JUMBO Splits',
    'Exclusive 30s','Positive Intent/Argos','HotLine Bling','Referral','CG Exclusive'
  ]);

  const cards = {
    calls: $('#sumCalls'),
    av: $('#sumSales'),
    deals: $('#sumTalk')
  };
  const headEl = $('#thead');
  const bodyEl = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  const setView = t => { if (viewLabelEl) viewLabelEl.textContent = t; };

  const fetchJSON = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch {
      return null;
    }
  };

  // ---------- Headshots ----------
  function buildHeadshotResolver(roster) {
    const byName = new Map();
    const byEmail = new Map();
    roster.forEach(p => {
      const nm = norm(p.name);
      const em = norm(p.email || '');
      const photo = p.photo
        ? (String(p.photo).startsWith('http') || String(p.photo).startsWith('/'))
          ? p.photo
          : `/headshots/${p.photo}`
        : null;
      if (nm) byName.set(nm, photo);
      if (em) byEmail.set(em, photo);
    });
    return ({ name, email }) =>
      byName.get(norm(name)) || byEmail.get(norm(email)) || null;
  }

  // roster helper
  const rosterOnly = (roster) => {
    const set = new Set(roster.map(p => norm(p.name)));
    return name => set.has(norm(name));
  };

  // ---------- Cards (This Week only, from allSales) ----------
  function computeThisWeekFromSales(allSales, isOnRoster) {
    const { start, end } = getThisWeekWindowEST();
    let deals = 0;
    let av12 = 0;
    allSales.forEach(s => {
      if (!s.dateSold && !s.date) return;
      const d = toEST(s.dateSold || s.date);
      if (d < start || d > end) return;
      if (isOnRoster && !isOnRoster(s.agent || s.agentName || s.user)) return;
      deals += 1;
      av12 += Number(s.amount || 0) * 12;
    });
    return { deals, av12 };
  }

  function renderCards({ allSales, callsByAgent, isOnRoster }) {
    const calls = Number(callsByAgent?.team?.calls || 0);
    const { deals, av12 } = computeThisWeekFromSales(allSales, isOnRoster);

    if (cards.calls) cards.calls.textContent = calls.toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(av12);
    if (cards.deals) cards.deals.textContent = deals.toLocaleString();
  }

  // ---------- Boards ----------

  // (1) This Week — Roster
  function renderThisWeekRoster({ roster, allSales, isOnRoster }) {
    setView('This Week — Roster');

    const { start, end } = getThisWeekWindowEST();
    const per = new Map();

    allSales.forEach(s => {
      const name = s.agent || s.agentName || s.user;
      if (!name || (isOnRoster && !isOnRoster(name))) return;

      const d = toEST(s.dateSold || s.date);
      if (d < start || d > end) return;

      const key = norm(name);
      const row = per.get(key) || { name, av:0, deals:0 };
      row.deals += 1;
      row.av += Number(s.amount || 0) * 12;
      per.set(key, row);
    });

    const rows = roster.map(p => {
      const k = norm(p.name);
      const r = per.get(k) || { av:0, deals:0 };
      return {
        name: p.name,
        av: r.av,
        deals: r.deals,
        photo: p.__photo
      };
    }).sort((a,b) => b.av - a.av);

    headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Submitted AV</th>
        <th class="right">Deals</th>
      </tr>`;
    bodyEl.innerHTML = rows.map(r => {
      const initials = r.name.split(' ').map(x => x[0] || '').join('').toUpperCase();
      const avatar = r.photo
        ? `<img src="${r.photo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
        : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;color:#89a2c6;">${initials}</div>`;
      return `
        <tr>
          <td style="display:flex;align-items:center;">${avatar}${r.name}</td>
          <td class="right">${fmtMoney(r.av)}</td>
          <td class="right">${r.deals}</td>
        </tr>`;
    }).join('');
  }

  // (2) YTD — Team (manual)
  function renderYtd({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = (ytdList || []).slice().sort((a,b) => (b.av || 0) - (a.av || 0));
    headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    bodyEl.innerHTML = rows.map(p => {
      const photo = resolvePhoto({ name:p.name });
      const initials = (p.name || '').split(' ').map(x=>x[0]||'').join('').toUpperCase();
      const avatar = photo
        ? `<img src="${photo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15);" />`
        : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;color:#89a2c6;">${initials}</div>`;
      return `
        <tr>
          <td style="display:flex;align-items:center;">${avatar}${p.name}</td>
          <td class="right">${fmtMoney(p.av || 0)}</td>
        </tr>`;
    }).join('') +
    `<tr class="total">
      <td><strong>Total</strong></td>
      <td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td>
    </tr>`;
  }

  // (3) Weekly Activity (manual override)
  async function renderWeeklyActivity() {
    setView('Weekly Activity');
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
    const data = await fetchJSON(ENDPOINTS.weeklyOverride);
    if (!data || typeof data !== 'object') {
      bodyEl.innerHTML = `<tr><td colspan="7" style="padding:18px;color:#5c6c82;">No weekly activity override loaded.</td></tr>`;
      return;
    }
    const rows = Object.entries(data).map(([email, s]) => {
      const name = (s.name || email.split('@')[0] || '').replace(/\./g,' ');
      const leads = +s.leads || 0;
      const sold = +s.sold || 0;
      const conv = leads ? (sold*100/leads).toFixed(1) : '0.0';
      return {
        name,
        leads,
        sold,
        conv,
        calls:+s.calls || 0,
        talk:+s.talkMin || 0,
        log:+s.loggedMin || 0
      };
    }).sort((a,b)=>b.sold-a.sold || b.leads-a.leads);
    bodyEl.innerHTML = rows.map(r => `
      <tr>
        <td>${r.name}</td>
        <td class="right">${r.leads}</td>
        <td class="right">${r.sold}</td>
        <td class="right">${r.conv}%</td>
        <td class="right">${r.calls}</td>
        <td class="right">${r.talk}</td>
        <td class="right">${r.log}</td>
      </tr>`).join('');
  }

  // (4) Lead Vendors — Last 45 Days
  function summarizeVendors45d(allSales, isOnRoster) {
    const by = new Map();
    allSales.forEach(s => {
      const name = s.agent || s.agentName || s.user;
      if (!name || (isOnRoster && !isOnRoster(name))) return;
      const date = s.dateSold || s.date;
      if (!date || !inLast45DaysEST(date)) return;
      const vendor = String(s.soldProductName || '').trim();
      if (!VENDOR_SET.has(vendor)) return;
      const row = by.get(vendor) || { name:vendor, deals:0 };
      row.deals += 1;
      by.set(vendor,row);
    });
    const rows = [...by.values()];
    const totalDeals = rows.reduce((a,r)=>a+r.deals,0);
    rows.forEach(r => r.pct = totalDeals ? +(r.deals*100/totalDeals).toFixed(1) : 0);
    rows.sort((a,b)=>b.deals-a.deals || a.name.localeCompare(b.name));
    return { rows, totalDeals };
  }

  function renderVendors({ allSales, isOnRoster }) {
    setView('Lead Vendors — Last 45 Days');
    const { rows, totalDeals } = summarizeVendors45d(allSales, isOnRoster);
    if (!rows.length) {
      headEl.innerHTML = '';
      bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data.</td></tr>`;
      return;
    }
    headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals (45d)</th>
        <th class="right">% of total</th>
      </tr>`;
    const donutRow = `
      <tr>
        <td colspan="3" style="padding:18px 18px 4px;font-size:13px;color:#9fb0c8;">
          Deals (45d): <strong style="color:#ffd36a;">${totalDeals.toLocaleString()}</strong>
        </td>
      </tr>`;
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.name}</td>
        <td class="right">${r.deals}</td>
        <td class="right">${r.pct}%</td>
      </tr>`).join('');
    const totalRow = `
      <tr class="total">
        <td><strong>Total</strong></td>
        <td class="right"><strong>${totalDeals}</strong></td>
        <td></td>
      </tr>`;
    bodyEl.innerHTML = donutRow + rowsHtml + totalRow;
  }

  // (5) PAR — Tracking
  function renderPar({ par }) {
    setView('PAR — Tracking');
    const agents = Array.isArray(par?.agents) ? par.agents : [];
    if (!agents.length) {
      headEl.innerHTML = '';
      bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No PAR data.</td></tr>`;
      return;
    }
    headEl.innerHTML = `
      <tr>
        <th>Agent</th>
        <th class="right">Take Rate</th>
        <th class="right">Annual AV</th>
      </tr>`;
    bodyEl.innerHTML = agents.map(a => `
      <tr>
        <td>${a.name}</td>
        <td class="right">${(a.take_rate || 0)}%</td>
        <td class="right">${fmtMoney(a.ytd_av || 0)}</td>
      </tr>`).join('') +
      `<tr class="total">
        <td><strong>PACE TO QUALIFY</strong></td>
        <td></td>
        <td class="right"><strong>${fmtMoney(par.pace_target || 0)}</strong></td>
      </tr>`;
  }

  // (6) Agent of the Week
  function renderAgentOfWeek({ roster, allSales, ytdList, resolvePhoto, isOnRoster }) {
    setView('Agent of the Week');
    const { start, end } = getThisWeekWindowEST();
    const per = new Map();

    allSales.forEach(s => {
      const name = s.agent || s.agentName || s.user;
      if (!name || (isOnRoster && !isOnRoster(name))) return;
      const d = toEST(s.dateSold || s.date);
      if (d < start || d > end) return;
      const key = norm(name);
      const row = per.get(key) || { name, av:0, deals:0 };
      row.deals += 1;
      row.av += Number(s.amount || 0) * 12;
      per.set(key,row);
    });

    if (!per.size) {
      headEl.innerHTML = `<tr><th>Agent of the Week</th></tr>`;
      bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No weekly AV submitted.</td></tr>`;
      return;
    }

    const top = [...per.values()].sort((a,b)=>b.av-a.av)[0];
    const ytd = (ytdList || []).find(x => norm(x.name) === norm(top.name));
    const ytdAv = ytd ? (ytd.av || 0) : 0;
    const photo = resolvePhoto({ name: top.name }) || null;
    const initials = top.name.split(' ').map(x=>x[0]||'').join('').toUpperCase();

    headEl.innerHTML = `<tr><th colspan="4">AGENT OF THE WEEK</th></tr>`;
    bodyEl.innerHTML = `
      <tr>
        <td colspan="4" style="padding:26px 18px;">
          <div style="display:flex;align-items:center;gap:18px;">
            ${
              photo
                ? `<img src="${photo}" style="width:92px;height:92px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.3);" />`
                : `<div style="width:92px;height:92px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;border:2px solid rgba(255,255,255,.3);">${initials}</div>`
            }
            <div>
              <div style="font-size:22px;font-weight:700;">${top.name}</div>
              <div style="margin-top:4px;opacity:.85;">Weekly Submitted AV • ${fmtMoney(top.av)}</div>
              <div style="margin-top:2px;opacity:.65;">Deals this week • ${top.deals}</div>
              <div style="margin-top:2px;opacity:.65;">YTD AV • ${fmtMoney(ytdAv)}</div>
              <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.4);border-radius:999px;padding:4px 16px;font-size:12px;">
                <span>🥇</span><span>Agent of the Week Belt</span>
              </div>
            </div>
          </div>
        </td>
      </tr>`;
  }

  // ---------- Rules / Banner ----------
  function startRules(rulesJson) {
    const baseTitle = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const sub = $('.banner-subtitle') || $('.subtitle'); // whatever you use
    const title = $('.banner-title') || $('.title');
    const list = Array.isArray(rulesJson?.rules) ? rulesJson.rules.filter(Boolean) : [];
    if (title) title.textContent = baseTitle;
    if (!sub) return;
    if (!list.length) {
      sub.textContent = 'Do not be entitled. Earn everything. Choose hard work over handouts... always.';
      return;
    }
    let i = 0;
    const apply = () => { sub.textContent = list[i % list.length]; };
    apply();
    setInterval(() => { i++; apply(); }, 12*60*60*1000);
  }

  // ---------- Load all + rotate ----------
  async function boot() {
    const [rules, rosterRaw, callsByAgent, teamSold, ytdList, ytdTotal, par] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);

    const roster = Array.isArray(rosterRaw) ? rosterRaw : [];
    const resolvePhoto = buildHeadshotResolver(roster);
    roster.forEach(p => { p.__photo = resolvePhoto({ name:p.name, email:p.email }); });
    const isOnRoster = rosterOnly(roster);

    const allSales = Array.isArray(teamSold?.allSales) ? teamSold.allSales : [];

    renderCards({ allSales, callsByAgent, isOnRoster });
    startRules(rules || {});

    const data = {
      roster,
      allSales,
      isOnRoster,
      ytdList: Array.isArray(ytdList) ? ytdList : (ytdList?.list || []),
      ytdTotal: ytdTotal?.ytd_av_total || ytdTotal || 0,
      par: par || {},
      resolvePhoto
    };

    const boards = [
      () => renderYtd(data),
      () => renderPar(data),
      () => renderVendors(data),
      () => renderThisWeekRoster(data),
      () => renderWeeklyActivity(),
      () => renderAgentOfWeek(data)
    ];

    let i = 0;
    boards[0]();
    setInterval(() => {
      i = (i + 1) % boards.length;
      boards[i]();
    }, 30000);
  }

  boot().catch(err => {
    console.error(err);
    if (bodyEl) {
      bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
    }
  });

  // ---------- OE Countdown ----------
  (function () {
    const el = document.querySelector('#oeTimer');
    if (!el) return;
    const deadline = new Date('2025-12-15T23:59:59-05:00');
    const pad = n => String(n).padStart(2,'0');
    function tick() {
      const diff = deadline - new Date();
      if (diff <= 0) { el.textContent = 'LIVE!'; return; }
      const d = Math.floor(diff/86400000);
      const h = Math.floor(diff/3600000)%24;
      const m = Math.floor(diff/60000)%60;
      const s = Math.floor(diff/1000)%60;
      el.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
      setTimeout(tick, 250);
    }
    tick();
  })();

})();
