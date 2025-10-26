/* ===== THE FEW — FULL DASHBOARD (single file, no placeholders) ===== */

(() => {
  // ---------- Config ----------
  const ROTATE_MS = 15000;           // time per board
  const SALE_HOLD_MS = 60000;        // sale splash hold
  const RULE_ROTATE_HOURS = 12;      // rule change cadence

  const ENDPOINTS = {
    team:  '/api/team_sold',
    calls: '/api/calls_by_agent',
    vendor:'/api/sales_by_vendor'
  };

  const OVERRIDES = {
    ytdList:  '/public/ytd_av.json',
    ytdTotal: '/public/ytd_total.json',
    par:      '/public/par_override.json',   // optional; if missing, PAR board is skipped
    rules:    '/public/rules.json',          // array of rule strings
    vendorStatic: '/public/sales_by_vendor.json' // fallback if API empty
  };

  // ---------- State ----------
  let dataTeam = null;          // { team, perAgent[], allSales[] }
  let dataCalls = null;         // { team, perAgent[] }
  let dataVendors = null;       // { as_of, window_days, vendors[] }
  let ytd = null;               // { list:[], total:number } from overrides
  let parList = null;           // optional
  let lastSaleId = null;

  const boards = [
    drawRoster, drawAgentOfWeek, drawVendors, drawActivity, drawYTD, drawPAR
  ];

  // ---------- DOM helpers ----------
  const $ = sel => document.querySelector(sel);
  const thead = $('#thead'), tbody = $('#tbody');

  const fmtInt = n => (n||0).toLocaleString();
  const fmtUSD = n => {
    const num = Number(n||0);
    return num.toLocaleString(undefined, {style:'currency', currency:'USD', maximumFractionDigits:0});
  };
  const slug = name => (name||'').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

  const setSummary = () => {
    // Calls (week) from calls API, AV & deals from team API
    const calls = dataCalls?.team?.calls ?? 0;
    const deals = dataTeam?.team?.totalSales ?? 0;
    const av = dataTeam?.team?.totalAV12x ?? dataTeam?.team?.totalAV12X ?? dataTeam?.team?.totalAV12x ?? 0;
    $('#sumCalls').textContent = fmtInt(calls);
    $('#sumDeals').textContent = fmtInt(deals);
    $('#sumSales').textContent = fmtUSD(av);
  };

  const setTitle = s => $('#viewLabel').textContent = s;

  const avatarHTML = (name) => {
    const s = slug(name);
    const initials = (name||'').split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase();
    // Try jpg/png/webp
    const sources = [`/public/headshots/${s}.jpg`,`/public/headshots/${s}.png`,`/public/headshots/${s}.webp`];
    const id = `img-${Math.random().toString(36).slice(2)}`;
    // We create a wrapper and try to set one that loads.
    const wrapper = document.createElement('div'); wrapper.className='avatar';
    const img = document.createElement('img'); img.alt = name||'';
    img.onerror = () => { wrapper.outerHTML = `<div class="avatar-fallback">${initials}</div>`; };
    img.src = sources[0];
    // progressive failover
    img.addEventListener('error', (e) => {
      const next = sources.shift();
      if (next === undefined){ wrapper.outerHTML = `<div class="avatar-fallback">${initials}</div>`; }
      else { img.src = next; }
    }, {once:false});
    wrapper.appendChild(img);
    return wrapper.outerHTML;
  };

  // ---------- Networking ----------
  async function getJSON(url){
    const r = await fetch(url, {cache:'no-store'});
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }

  async function loadAll(){
    [dataTeam, dataCalls] = await Promise.all([
      getJSON(ENDPOINTS.team).catch(_=>({team:{}, perAgent:[], allSales:[]})),
      getJSON(ENDPOINTS.calls).catch(_=>({team:{}, perAgent:[]})),
    ]);

    try {
      dataVendors = await getJSON(ENDPOINTS.vendor);
      if (!dataVendors?.vendors?.length){
        dataVendors = await getJSON(OVERRIDES.vendorStatic).catch(_=>({vendors:[]}));
      }
    } catch { dataVendors = {vendors:[]}; }

    // Overrides
    ytd = null;
    try{
      const list = await getJSON(OVERRIDES.ytdList);
      const total = await getJSON(OVERRIDES.ytdTotal);
      ytd = {list, total};
    }catch{}

    parList = null;
    try{ parList = await getJSON(OVERRIDES.par); }catch{}

    setSummary();
    rotateStart();
    trackNewSales();
  }

  // ---------- Rule of the day (12h) ----------
  async function initRule(){
    let rules = [];
    try { rules = await getJSON(OVERRIDES.rules); } catch {}
    const key = 'few.rule.index';
    const tsKey = 'few.rule.ts';
    let idx = Number(localStorage.getItem(key) || 0);
    let ts  = Number(localStorage.getItem(tsKey) || 0);
    const now = Date.now();
    const ageHrs = (now - ts)/(1000*60*60);

    if (!rules.length){
      $('#ruleTicker').textContent = 'RULE OF THE DAY — You are who you hunt with. Everybody wants to eat, but FEW will hunt.';
      return;
    }
    if (ageHrs >= RULE_ROTATE_HOURS){ idx = (idx+1) % rules.length; ts = now; }
    localStorage.setItem(key, String(idx));
    localStorage.setItem(tsKey, String(ts||now));
    $('#ruleTicker').textContent = 'RULE OF THE DAY — ' + rules[idx];
  }

  // ---------- Rotation ----------
  let rotateIdx = 0, rotateTimer = null;

  function rotateStart(){
    clearInterval(rotateTimer);
    drawCurrent();
    rotateTimer = setInterval(()=>{
      rotateIdx = (rotateIdx+1) % boards.length;
      drawCurrent();
    }, ROTATE_MS);
  }

  function drawCurrent(){
    // Skip boards that have no data
    let guard = 0;
    while(guard++ < boards.length){
      const fn = boards[rotateIdx];
      const ok = fn();
      if (ok) break;
      rotateIdx = (rotateIdx+1) % boards.length;
    }
  }

  // ---------- Boards ----------
  // 1) ROSTER — This Week — Submitted AV (from team API)
  function drawRoster(){
    if (!dataTeam?.perAgent?.length) return false;
    setTitle('This Week — Roster');
    thead.innerHTML = `<tr>
      <th>Agent</th><th>Sold</th><th class="num">Submitted AV</th>
    </tr>`;
    const rows = dataTeam.perAgent
      .slice()
      .sort((a,b)=>(b.av12x||0)-(a.av12x||0))
      .map(a=>`
        <tr>
          <td><div class="agent">${avatarHTML(a.name)}<span>${escapeHtml(a.name)}</span></div></td>
          <td>${fmtInt(a.sales||0)}</td>
          <td class="num">${fmtUSD(a.av12x||0)}</td>
        </tr>
      `).join('');
    tbody.innerHTML = rows || `<tr><td style="padding:16px;color:#7e8ea4;">No sales yet.</td></tr>`;
    return true;
  }

  // 2) AGENT OF THE WEEK — large headshot, name, deals, AV (weekly), show one leader row
  function drawAgentOfWeek(){
    if (!dataTeam?.perAgent?.length) return false;
    setTitle('Agent of the Week');

    const top = dataTeam.perAgent
      .slice()
      .sort((a,b)=>(b.av12x||0)-(a.av12x||0))[0];

    thead.innerHTML = `<tr>
      <th>Leading for Agent of the Week</th><th>Sold</th><th class="num">Submitted AV</th>
    </tr>`;
    tbody.innerHTML = `
      <tr class="hero-row">
        <td class="hero">
          <div class="agent">${avatarHTML(top.name)}<span style="font-weight:900">${escapeHtml(top.name)}</span></div>
        </td>
        <td>${fmtInt(top.sales||0)}</td>
        <td class="num">${fmtUSD(top.av12x||0)}</td>
      </tr>
    `;
    return true;
  }

  // 3) LEAD VENDORS — 45-day donut + table
  function drawVendors(){
    if (!dataVendors?.vendors?.length) return false;
    setTitle('Lead Vendors — % of Sales (Last 45 days)');

    const list = dataVendors.vendors.slice().sort((a,b) => (b.deals||0)-(a.deals||0));
    const total = list.reduce((s,v)=>s+(v.deals||0),0) || 1;

    // Donut SVG
    const R=56, C=2*Math.PI*R;
    let acc = 0;
    const colors = list.map((_,i)=>`hsl(${(i*57)%360} 70% 55%)`);
    const arcs = list.map((v,i)=>{
      const frac = (v.deals||0)/total;
      const dash = `${(frac*C).toFixed(2)} ${(C - frac*C).toFixed(2)}`;
      const rot = (acc/total)*360; acc += v.deals||0;
      return `<circle r="${R}" cx="70" cy="70" fill="transparent"
        stroke="${colors[i]}" stroke-width="18"
        stroke-dasharray="${dash}" transform="rotate(${rot-90} 70 70)"></circle>`;
    }).join('');

    thead.innerHTML = `<tr><th colspan="3">Lead Vendors</th></tr>`;
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="padding:10px 6px">
          <div class="donutWrap">
            <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Vendor donut">
              <circle r="${R}" cx="70" cy="70" fill="transparent" stroke="#1a2433" stroke-width="18"></circle>
              ${arcs}
              <text x="70" y="75" text-anchor="middle" fill="#cfd7e3" font-size="14" font-weight="800">${fmtInt(total)} deals</text>
            </svg>
            <div class="legend">
              ${list.map((v,i)=>`
                <div class="legend-row">
                  <div class="legend-name">
                    <span class="swatch" style="background:${colors[i]}"></span>
                    <span>${escapeHtml(v.name||'Unknown')}</span>
                  </div>
                  <div>${fmtInt(v.deals||0)} • ${Math.round(((v.deals||0)/total)*100)}%</div>
                </div>
              `).join('')}
            </div>
          </div>
        </td>
      </tr>
    `;
    return true;
  }

  // 4) AGENT ACTIVITY — calls, talk, logged, leads, sold, conv%
  function drawActivity(){
    if (!dataCalls?.perAgent) return false;
    setTitle('Agent Activity — (This week)');
    thead.innerHTML = `<tr>
      <th>Agent</th><th>Calls</th><th>Talk (min)</th><th>Logged (h:mm)</th><th>Leads</th><th>Sold</th><th class="num">Conv %</th>
    </tr>`;

    // Stitch in weekly sold counts from team list by name
    const soldBy = new Map();
    (dataTeam?.perAgent||[]).forEach(a => soldBy.set((a.name||'').toLowerCase(), a.sales||0));

    const rows = (dataCalls.perAgent||[])
      .slice()
      .sort((a,b)=>(b.calls||0)-(a.calls||0))
      .map(a=>{
        const key = (a.name||'').toLowerCase();
        const sold = soldBy.get(key) || 0;
        const conv = (a.leads>0) ? Math.round((sold/a.leads)*100) : 0;
        const h = Math.floor((a.loggedMin||0)/60), m = (a.loggedMin||0)%60;
        return `<tr>
          <td><div class="agent">${avatarHTML(a.name)}<span>${escapeHtml(a.name)}</span></div></td>
          <td>${fmtInt(a.calls||0)}</td>
          <td>${fmtInt(a.talkMin||0)}</td>
          <td>${fmtInt(h)}:${String(m).padStart(2,'0')}</td>
          <td>${fmtInt(a.leads||0)}</td>
          <td>${fmtInt(sold)}</td>
          <td class="num">${fmtInt(conv)}%</td>
        </tr>`;
      }).join('');

    tbody.innerHTML = rows || `<tr><td style="padding:16px;color:#7e8ea4;">No activity reported yet.</td></tr>`;
    return true;
  }

  // 5) YTD AV board (manual override files)
  function drawYTD(){
    if (!ytd?.list?.length) return false;
    setTitle('YTD AV (Override)');
    thead.innerHTML = `<tr><th>Agent</th><th class="num">YTD AV</th></tr>`;
    const rows = ytd.list
      .slice()
      .sort((a,b)=>(b.av12x||0)-(a.av12x||0))
      .map(a=>`
        <tr>
          <td><div class="agent">${avatarHTML(a.name)}<span>${escapeHtml(a.name)}</span></div></td>
          <td class="num">${fmtUSD(a.av12x||0)}</td>
        </tr>
      `).join('');
    tbody.innerHTML = rows || `<tr><td style="padding:16px">No YTD entries.</td></tr>`;
    return true;
  }

  // 6) PAR board (optional override list with names & amounts)
  function drawPAR(){
    if (!parList?.length) return false;
    setTitle('PAR — Performance & Retention');
    thead.innerHTML = `<tr><th>Agent</th><th class="num">Issued AV</th></tr>`;
    const rows = parList
      .slice()
      .sort((a,b)=>(b.issued||0)-(a.issued||0))
      .map(a=>`
        <tr>
          <td><div class="agent">${avatarHTML(a.name)}<span>${escapeHtml(a.name)}</span></div></td>
          <td class="num">${fmtUSD(a.issued||0)}</td>
        </tr>
      `).join('');
    tbody.innerHTML = rows || `<tr><td style="padding:16px">No PAR entries.</td></tr>`;
    return true;
  }

  // ---------- New sale splash (no "×12" text; show av12x as the amount) ----------
  function trackNewSales(){
    // find latest id in allSales; if different from lastSaleId, show splash
    const all = dataTeam?.allSales || [];
    if (!all.length) return;
    const newest = all[all.length-1];
    if (newest.leadId && newest.leadId !== lastSaleId){
      lastSaleId = newest.leadId;
      showSaleSplash(newest.agent, newest.av12x || newest.amount || 0);
    }
  }

  function showSaleSplash(agentName, amount){
    const wrap = $('#saleSplash');
    wrap.querySelector('.name').textContent = agentName || '—';
    wrap.querySelector('.amt').textContent  = fmtUSD(amount||0);
    wrap.style.display = 'flex';
    setTimeout(()=>{ wrap.style.display = 'none'; }, SALE_HOLD_MS);
  }

  // ---------- Utility ----------
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- OE countdown ----------
  function initOE(targetISO='2025-11-01T00:00:00-04:00'){
    const el = $('#oeTimer');
    const pad = n => String(n).padStart(2,'0');
    function tick(){
      const now = new Date();
      const target = new Date(targetISO);
      let s = Math.max(0, Math.floor((target - now)/1000));
      const d = Math.floor(s/86400); s%=86400;
      const h = Math.floor(s/3600); s%=3600;
      const m = Math.floor(s/60); const sec = s%60;
      el.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
      requestAnimationFrame(()=>setTimeout(tick, 250));
    }
    tick();
  }

  // ---------- Boot ----------
  initRule();
  initOE();
  loadAll();

  // Refresh data periodically (sales pop + cards) without breaking rotation
  setInterval(async ()=>{
    try{
      dataTeam  = await getJSON(ENDPOINTS.team).catch(_=>dataTeam);
      dataCalls = await getJSON(ENDPOINTS.calls).catch(_=>dataCalls);
      setSummary();
      trackNewSales();
    }catch{}
  }, 30000);
})();
