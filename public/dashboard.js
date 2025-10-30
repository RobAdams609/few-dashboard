/* FEW Dashboard — FULL OVERWRITE
   Uses ONLY existing public files on https://few-dashboard-live.netlify.app
   Files used:
   - /rules.json
   - /headshots/roster.json
   - /av_week_override.json
   - /calls_week_override.json
   - /sales_by_vendor.json
   - /ytd_av.json
   - /ytd_total.json
   - /par.json
*/

(() => {
  const BASE = '';
  const ENDPOINTS = {
    rules: `${BASE}/rules.json`,
    roster: `${BASE}/headshots/roster.json`,
    avWeek: `${BASE}/av_week_override.json`,
    callsWeek: `${BASE}/calls_week_override.json`,
    vendors45: `${BASE}/sales_by_vendor.json`,
    ytdAv: `${BASE}/ytd_av.json`,
    ytdTotal: `${BASE}/ytd_total.json`,
    par: `${BASE}/par.json`
  };

  // Board order: 0 roster, 1 weekly activity, 2 vendors, 3 PAR
  const BOARD_TITLES = [
    'This Week — Roster',
    'Weekly Activity',
    'Lead Vendors — Last 45 Days',
    'PAR — Tracking'
  ];

  // State
  const state = {
    rules: [],
    currentRuleIndex: 0,
    roster: [],             // [{name,email,photo}]
    avWeek: [],             // [{email|name, av, deals}]
    callsWeek: {},          // {email: {calls,talkMin,loggedMin,leads,sold}}
    vendors45: null,        // {as_of,window_days,vendors:[{name,deals}]}
    ytdAv: [],              // [{name,email,av}]
    ytdTotal: null,         // {ytd_total: ...} (if you use it)
    par: null,              // {pace_target, agents:[{name,take_rate,ytd_av}]}
    boardIndex: 0
  };

  // ------------------- DOM helpers -------------------
  function $(sel) { return document.querySelector(sel); }
  function $el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  // ------------------- Fetch helpers -------------------
  async function getJSON(url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('fetch failed', url, e);
      return null;
    }
  }

  // ------------------- Data loading -------------------
  async function loadAll() {
    const [
      rules,
      roster,
      avWeek,
      callsWeek,
      vendors45,
      ytdAv,
      ytdTotal,
      par
    ] = await Promise.all([
      getJSON(ENDPOINTS.rules),
      getJSON(ENDPOINTS.roster),
      getJSON(ENDPOINTS.avWeek),
      getJSON(ENDPOINTS.callsWeek),
      getJSON(ENDPOINTS.vendors45),
      getJSON(ENDPOINTS.ytdAv),
      getJSON(ENDPOINTS.ytdTotal),
      getJSON(ENDPOINTS.par)
    ]);

    state.rules = Array.isArray(rules?.rules) ? rules.rules : [];
    state.roster = Array.isArray(roster) ? roster : [];
    state.avWeek = Array.isArray(avWeek) ? avWeek : [];
    state.callsWeek = callsWeek && typeof callsWeek === 'object' ? callsWeek : {};
    state.vendors45 = vendors45 || null;
    state.ytdAv = Array.isArray(ytdAv) ? ytdAv : [];
    state.ytdTotal = ytdTotal || null;
    state.par = par || null;

    render();
  }

  // ------------------- Utils -------------------
  function formatMoney(n) {
    if (n == null || isNaN(n)) return '$0';
    return '$' + Number(n).toLocaleString();
  }
  function pickHeadshotByEmail(email) {
    if (!email) return null;
    const lower = email.toLowerCase();
    const match = state.roster.find(r => (r.email || '').toLowerCase() === lower);
    return match || null;
  }
  function pickHeadshotByName(name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    const match = state.roster.find(r => (r.name || '').toLowerCase() === lower);
    return match || null;
  }

  // weekly AV helpers
  function normalizeWeeklyAV() {
    // your /av_week_override.json is an object? or array?
    // from GitHub screenshot it looked like an object: { "robert@...": { weekly_av, deals } }
    // but earlier AV override was array. We'll support both.
    const src = state.avWeek;
    const out = [];
    if (Array.isArray(src)) {
      // array form: [{name/email,av,deals}]
      src.forEach(x => {
        out.push({
          key: (x.email || x.name || '').toLowerCase(),
          name: x.name || '',
          email: x.email || '',
          av: Number(x.av || x.weekly_av || 0),
          deals: Number(x.deals || 0)
        });
      });
    } else if (src && typeof src === 'object') {
      // object form: { "email": { av: 16247, deals: 4 } }
      Object.entries(src).forEach(([email, v]) => {
        const match = pickHeadshotByEmail(email);
        out.push({
          key: email.toLowerCase(),
          name: match ? match.name : email,
          email,
          av: Number(v.av || v.weekly_av || 0),
          deals: Number(v.deals || v.sold || 0)
        });
      });
    }
    // sort desc by AV
    out.sort((a, b) => b.av - a.av);
    return out;
  }

  function normalizeWeeklyCalls() {
    const src = state.callsWeek;
    const arr = [];
    if (!src || typeof src !== 'object') return arr;
    Object.entries(src).forEach(([email, v]) => {
      const match = pickHeadshotByEmail(email);
      arr.push({
        email,
        name: match ? match.name : email,
        photo: match ? `/headshots/${match.photo}` : null,
        calls: Number(v.calls || 0),
        talkMin: Number(v.talkMin || 0),
        loggedMin: Number(v.loggedMin || 0),
        leads: Number(v.leads || 0),
        sold: Number(v.sold || 0)
      });
    });
    // Sort: sold desc, then calls desc
    arr.sort((a, b) => {
      if (b.sold !== a.sold) return b.sold - a.sold;
      return b.calls - a.calls;
    });
    return arr;
  }

  function getBoardContainer() {
    let c = $('#board-root');
    if (!c) {
      c = $el('div', 'board-root');
      c.id = 'board-root';
      const main = document.body;
      main.appendChild(c);
    }
    return c;
  }

  // ------------------- RENDER MAIN -------------------
  function renderHeader() {
    let h = $('#few-header');
    if (!h) {
      h = $el('div', 'few-header');
      h.id = 'few-header';
      document.body.prepend(h);
    }
    h.innerHTML = `
      <div class="few-title">THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT</div>
      <div class="few-sub" id="few-sub"></div>
      <div class="few-tabs" id="few-tabs"></div>
    `;
    const tabs = $('#few-tabs');
    tabs.innerHTML = '';
    BOARD_TITLES.forEach((t, i) => {
      const b = $el('button', 'few-tab' + (i === state.boardIndex ? ' active' : ''), t);
      b.addEventListener('click', () => {
        state.boardIndex = i;
        render();
      });
      tabs.appendChild(b);
    });
    // set initial rule
    updateRuleLine();
  }

  function updateRuleLine() {
    const sub = $('#few-sub');
    if (!sub) return;
    if (!state.rules.length) {
      sub.textContent = '1) Do not be entitled. Earn everything. Choose hard work over handouts… always.';
      return;
    }
    const r = state.rules[state.currentRuleIndex % state.rules.length];
    sub.textContent = r;
  }

  // rotate every 3 hours
  setInterval(() => {
    if (!state.rules.length) return;
    state.currentRuleIndex = (state.currentRuleIndex + 1) % state.rules.length;
    updateRuleLine();
  }, 3 * 60 * 60 * 1000);

  // ------------------- BOARD RENDERS -------------------
  function renderRosterBoard(root) {
    const weeklyAV = normalizeWeeklyAV(); // sorted desc
    const top = weeklyAV[0] || null;

    // top metrics
    const totalCalls = sumCallsFromOverrides();
    const totalAv = weeklyAV.reduce((s, x) => s + (x.av || 0), 0);
    const totalDeals = weeklyAV.reduce((s, x) => s + (x.deals || 0), 0);

    const board = $el('div', 'board board-roster');
    board.innerHTML = `
      <div class="metrics-row">
        <div class="metric-box">
          <div class="metric-title">This Week — Team Calls</div>
          <div class="metric-value">${totalCalls}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Total Submitted AV</div>
          <div class="metric-value">${formatMoney(totalAv)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Deals Submitted</div>
          <div class="metric-value">${totalDeals}</div>
        </div>
      </div>
    `;

    // Agent of the Week section (bigger)
    const aotw = $el('div', 'agent-of-week');
    aotw.innerHTML = `<div class="section-title">Agent of the Week</div>`;
    const aotwBody = $el('div', 'agent-of-week-body');
    if (top) {
      // find photo
      let photo = null;
      if (top.email) {
        const match = pickHeadshotByEmail(top.email);
        if (match && match.photo) photo = `/headshots/${match.photo}`;
      } else if (top.name) {
        const match = pickHeadshotByName(top.name);
        if (match && match.photo) photo = `/headshots/${match.photo}`;
      }
      const card = $el('div', 'agent-card agent-card-large');
      card.innerHTML = `
        <div class="agent-card-left">
          <div class="agent-photo-wrap ${photo ? '' : 'no-photo'}">
            ${photo ? `<img src="${photo}" alt="${top.name}">` : `<span>${(top.name || '?').slice(0,1)}</span>`}
          </div>
        </div>
        <div class="agent-card-right">
          <div class="agent-name-large">${top.name || top.email || 'Unknown Agent'}</div>
          <div class="agent-sub">AV ${formatMoney(top.av || 0)} • ${top.deals || 0} deals</div>
        </div>
      `;
      aotwBody.appendChild(card);
    } else {
      aotwBody.textContent = 'No data';
    }
    aotw.appendChild(aotwBody);
    board.appendChild(aotw);

    // table
    const tbl = $el('div', 'table table-roster');
    const header = $el('div', 'table-row table-header');
    header.innerHTML = `
      <div class="col-agent">Agent</div>
      <div class="col-av">Weekly AV</div>
      <div class="col-deals">Deals</div>
    `;
    tbl.appendChild(header);

    weeklyAV.forEach(item => {
      const tr = $el('div', 'table-row');
      // find photo
      let photo = null;
      if (item.email) {
        const match = pickHeadshotByEmail(item.email);
        if (match && match.photo) photo = `/headshots/${match.photo}`;
      } else if (item.name) {
        const match = pickHeadshotByName(item.name);
        if (match && match.photo) photo = `/headshots/${match.photo}`;
      }
      tr.innerHTML = `
        <div class="col-agent">
          <span class="agent-inline-photo ${photo ? '' : 'no-photo'}">
            ${photo ? `<img src="${photo}">` : (item.name || item.email || '?').slice(0,1)}
          </span>
          ${item.name || item.email || ''}
        </div>
        <div class="col-av">${formatMoney(item.av || 0)}</div>
        <div class="col-deals">${item.deals || 0}</div>
      `;
      tbl.appendChild(tr);
    });

    board.appendChild(tbl);
    root.appendChild(board);
  }

  function renderWeeklyActivityBoard(root) {
    const rows = normalizeWeeklyCalls();

    // compute top metrics from overrides (not from API)
    const totalCalls = rows.reduce((s, r) => s + (r.calls || 0), 0);
    // AV for the week should come from /av_week_override.json — same as roster board
    const weeklyAV = normalizeWeeklyAV();
    const totalAv = weeklyAV.reduce((s, x) => s + (x.av || 0), 0);
    const totalDeals = rows.reduce((s, r) => s + (r.sold || 0), 0);

    const board = $el('div', 'board board-weekly-activity');
    board.innerHTML = `
      <div class="metrics-row">
        <div class="metric-box">
          <div class="metric-title">This Week — Team Calls</div>
          <div class="metric-value">${totalCalls}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Total Submitted AV</div>
          <div class="metric-value">${formatMoney(totalAv)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Deals Submitted</div>
          <div class="metric-value">${totalDeals}</div>
        </div>
      </div>
      <div class="section-title">Weekly Activity</div>
    `;

    const tbl = $el('div', 'table table-activity');
    const header = $el('div', 'table-row table-header');
    header.innerHTML = `
      <div class="col-agent">Agent</div>
      <div class="col-calls">Calls</div>
      <div class="col-deals">Deals</div>
      <div class="col-conv">Conv%</div>
      <div class="col-talk">Talk (min)</div>
      <div class="col-logged">Logged (min)</div>
    `;
    tbl.appendChild(header);

    rows.forEach(r => {
      const conv = r.leads > 0 ? Math.round((r.sold / r.leads) * 100) : 0;
      const tr = $el('div', 'table-row');
      tr.innerHTML = `
        <div class="col-agent">
          <span class="agent-inline-photo ${r.photo ? '' : 'no-photo'}">
            ${r.photo ? `<img src="${r.photo}">` : (r.name || r.email || '?').slice(0,1)}
          </span>
          ${r.name}
        </div>
        <div class="col-calls">${r.calls}</div>
        <div class="col-deals">${r.sold}</div>
        <div class="col-conv">${conv}%</div>
        <div class="col-talk">${r.talkMin}</div>
        <div class="col-logged">${r.loggedMin}</div>
      `;
      tbl.appendChild(tr);
    });

    board.appendChild(tbl);
    root.appendChild(board);
  }

  function renderVendorsBoard(root) {
    const data = state.vendors45;
    const weeklyAV = normalizeWeeklyAV();
    const rowsCalls = normalizeWeeklyCalls();
    const totalCalls = rowsCalls.reduce((s, r) => s + (r.calls || 0), 0);
    const totalAv = weeklyAV.reduce((s, x) => s + (x.av || 0), 0);
    const totalDeals = weeklyAV.reduce((s, x) => s + (x.deals || 0), 0);

    const board = $el('div', 'board board-vendors');
    board.innerHTML = `
      <div class="metrics-row">
        <div class="metric-box">
          <div class="metric-title">This Week — Team Calls</div>
          <div class="metric-value">${totalCalls}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Total Submitted AV</div>
          <div class="metric-value">${formatMoney(totalAv)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Deals Submitted</div>
          <div class="metric-value">${totalDeals}</div>
        </div>
      </div>
      <div class="section-title">Lead Vendors — Last 45 Days</div>
    `;

    const wrap = $el('div', 'vendors-wrap');
    const donut = $el('div', 'vendors-donut');
    const list = $el('div', 'vendors-list');

    if (data && Array.isArray(data.vendors)) {
      const totalVendorDeals = data.vendors.reduce((s, v) => s + (Number(v.deals) || 0), 0);
      // we can't actually draw a svg donut without css here, but we'll output structure
      donut.innerHTML = `
        <div class="donut-circle">
          <div class="donut-center">
            <div class="donut-label">Deals</div>
            <div class="donut-value">${totalVendorDeals}</div>
          </div>
        </div>
      `;

      const table = $el('div', 'table table-vendors');
      const header = $el('div', 'table-row table-header');
      header.innerHTML = `
        <div class="col-vendor">Vendor</div>
        <div class="col-deals">Deals</div>
        <div class="col-pct">% of total</div>
      `;
      table.appendChild(header);

      data.vendors.forEach((v, idx) => {
        const deals = Number(v.deals) || 0;
        const pct = totalVendorDeals > 0 ? ((deals / totalVendorDeals) * 100).toFixed(1) : '0.0';
        const tr = $el('div', 'table-row');
        tr.innerHTML = `
          <div class="col-vendor">${v.name}</div>
          <div class="col-deals">${deals}</div>
          <div class="col-pct">${pct}%</div>
        `;
        table.appendChild(tr);
      });

      list.appendChild(table);
    } else {
      donut.textContent = 'No vendor data';
    }

    wrap.appendChild(donut);
    wrap.appendChild(list);
    board.appendChild(wrap);
    root.appendChild(board);
  }

  function renderParBoard(root) {
    const par = state.par;
    const weeklyAV = normalizeWeeklyAV();
    const rowsCalls = normalizeWeeklyCalls();
    const totalCalls = rowsCalls.reduce((s, r) => s + (r.calls || 0), 0);
    const totalAv = weeklyAV.reduce((s, x) => s + (x.av || 0), 0);
    const totalDeals = weeklyAV.reduce((s, x) => s + (x.deals || 0), 0);

    const board = $el('div', 'board board-par');
    board.innerHTML = `
      <div class="metrics-row">
        <div class="metric-box">
          <div class="metric-title">This Week — Team Calls</div>
          <div class="metric-value">${totalCalls}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Total Submitted AV</div>
          <div class="metric-value">${formatMoney(totalAv)}</div>
        </div>
        <div class="metric-box">
          <div class="metric-title">This Week — Deals Submitted</div>
          <div class="metric-value">${totalDeals}</div>
        </div>
      </div>
      <div class="section-title">PAR — Tracking</div>
    `;

    const tbl = $el('div', 'table table-par');
    const header = $el('div', 'table-row table-header');
    header.innerHTML = `
      <div class="col-agent">Agent</div>
      <div class="col-take">Take Rate</div>
      <div class="col-ytd">YTD AV</div>
    `;
    tbl.appendChild(header);

    if (par && Array.isArray(par.agents)) {
      par.agents.forEach(a => {
        // get YTD from par itself (you put ytd_av in par.json)
        const tr = $el('div', 'table-row');
        tr.innerHTML = `
          <div class="col-agent">${a.name}</div>
          <div class="col-take">${a.take_rate || 0}%</div>
          <div class="col-ytd">${formatMoney(a.ytd_av || 0)}</div>
        `;
        tbl.appendChild(tr);
      });
      // pace row
      const tr = $el('div', 'table-row table-footer');
      tr.innerHTML = `
        <div class="col-agent"><strong>PACE TO QUALIFY</strong></div>
        <div class="col-take"></div>
        <div class="col-ytd">${formatMoney(par.pace_target || 0)}</div>
      `;
      tbl.appendChild(tr);
    } else {
      const tr = $el('div', 'table-row');
      tr.innerHTML = `<div class="col-agent">No PAR data</div>`;
      tbl.appendChild(tr);
    }

    board.appendChild(tbl);
    root.appendChild(board);
  }

  function sumCallsFromOverrides() {
    // used in two boards
    const src = state.callsWeek;
    let total = 0;
    if (src && typeof src === 'object') {
      Object.values(src).forEach(v => {
        total += Number(v.calls || 0);
      });
    }
    return total;
  }

  function renderFooter() {
    let f = $('#few-footer');
    if (!f) {
      f = $el('div', 'few-footer');
      f.id = 'few-footer';
      document.body.appendChild(f);
    }
    f.innerHTML = `
      <div class="oe-countdown" id="oe-countdown">
        OE Countdown
        <span id="oe-countdown-value">...</span>
      </div>
      <div class="music-btn" id="music-btn">🎵</div>
    `;
  }

  function setupCountdown() {
    // placeholder OE date
    const target = new Date();
    target.setDate(target.getDate() + 2);
    target.setHours(target.getHours() + 5);
    target.setMinutes(target.getMinutes() + 0);
    target.setSeconds(target.getSeconds() + 0);

    function tick() {
      const now = new Date();
      const diff = target - now;
      const el = $('#oe-countdown-value');
      if (!el) return;
      if (diff <= 0) {
        el.textContent = '0d 00h 00m 00s';
        return;
      }
      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const m = Math.floor((diff / (1000 * 60)) % 60);
      const s = Math.floor((diff / 1000) % 60);
      el.textContent = `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
    }
    tick();
    setInterval(tick, 1000);
  }

  function render() {
    renderHeader();
    renderFooter();

    const root = getBoardContainer();
    root.innerHTML = '';

    switch (state.boardIndex) {
      case 0:
        renderRosterBoard(root);
        break;
      case 1:
        renderWeeklyActivityBoard(root);
        break;
      case 2:
        renderVendorsBoard(root);
        break;
      case 3:
        renderParBoard(root);
        break;
    }
  }

  // ------------------- INIT -------------------
  document.addEventListener('DOMContentLoaded', () => {
    renderHeader();
    renderFooter();
    setupCountdown();
    loadAll();
  });

})();
