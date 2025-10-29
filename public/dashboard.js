<script>
/* =========================  FEW DASHBOARD — FULL REWRITE  =========================
   Boards (rotating every 30s): 
     1) This Week — Roster
     2) YTD — Team
     3) Weekly Activity
     4) Lead Vendors — Last 45 Days
     5) PAR — Tracking

   Fixes:
     • Vendor board uses rolling 45d from (team_sold.allSales + BACKFILL)
     • Cards: Team Calls totals from override (sum) → API fallback
     • PAR: shows Take Rate and Annual AV per agent from YTD list
     • Removes old duplicates / bad return; resilient fetch & nulls
================================================================================== */

(() => {
  // -------------------- Endpoints (relative to site root) --------------------
  const ENDPOINTS = {
    teamSold: '/api/team_sold',
    callsByAgent: '/api/calls_by_agent',
    rules: '/rules.json',
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',
    ytdTotal: '/ytd_total.json',
    par: '/par.json',
    callsOverride: '/calls_week_override.json'
  };

  // -------------------- Tiny utils --------------------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const safe = (v, d=0) => (v === undefined || v === null ? d : v);
  const fmtMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const initials = (name='') => name.trim().split(/\s+/).map(w => (w[0]||'').toUpperCase()).join('');
  const sum = (arr, pick = x=>x) => (arr||[]).reduce((a,b)=> a + (Number(pick(b))||0), 0);

  const fetchJSON = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} -> ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON fail:', url, e.message || e);
      return null;
    }
  };

  // -------------------- Canonical vendor whitelist (permanent) --------------------
  const VENDOR_SET = new Set([
    '$7.50', 'TTM Nice!', 'George Region Shared', 'Red Media', 'Blast/Bulk', 'Exclusive JUMBO', 'ABC',
    'Shared Jumbo', 'VS Default', 'RKA Website', 'Redrip/Give up Purchased', 'Lamy Dynasty Specials',
    'JUMBO Splits', 'Exclusive 30s', 'Positive Intent/Argos', 'HotLine Bling', 'Referral', 'CG Exclusive'
  ]);

  // -------------------- Name normalization (stable mappings) --------------------
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

  // -------------------- Headshot resolver from roster --------------------
  function buildHeadshotResolver(roster) {
    const byName = new Map(), byEmail = new Map(), byPhone = new Map(), byInitial = new Map();

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
      const ini = initials(p.name || '');
      if (ini) byInitial.set(ini, photo);
    }

    return (agent = {}) => {
      const cName = norm(canonicalName(agent.name));
      const email = String(agent.email || '').trim().toLowerCase();
      const phone = String(agent.phone || '').replace(/\D+/g,'');
      const ini   = initials(agent.name || '');
      return (
        byName.get(cName) ??
        (email ? byEmail.get(email) : null) ??
        (phone ? byPhone.get(phone) : null) ??
        byInitial.get(ini) ??
        null
      );
    };
  }

  // -------------------- Layout anchors --------------------
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const cards = { calls: $('#sumCalls'), av: $('#sumSales'), deals: $('#sumTalk') };
  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  const setView = (t) => { if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h, s = '') => {
    if (bannerTitle) bannerTitle.textContent = h || '';
    if (bannerSub)   bannerSub.textContent   = s || '';
  };

  // -------------------- Minimal CSS (donut & splash) --------------------
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
        background:linear-gradient(135deg,#a68109,#ffd34d); color:#1a1a1a;
        padding:22px 28px; border-radius:16px; box-shadow:0 18px 48px rgba(0,0,0,.45);
        z-index:9999; min-width:320px; text-align:center;
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

  // -------------------- Sale splash & tracking --------------------
  const seenLeadIds = new Set();
  const saleId = (s) => String(
    s.leadId || s.id || `${s.agent}-${s.dateSold || s.date}-${s.soldProductName}-${s.amount}`
  );
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className = 'splash';
    el.innerHTML = `
      <div class="big">${name || 'Agent'}</div>
      <div class="mid">${fmtMoney(amount)}</div>
      <div class="sub">${soldProductName || ''}</div>
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 60_000);
  }

  // -------------------- Cards --------------------
  function renderCards({ callsTeamTotal, sold }) {
    const avVal = (() => {
      let v = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
      if (!v && Array.isArray(sold?.perAgent)) {
        v = sum(sold.perAgent, p => p.av12x || p.av12X || p.amount || 0);
      }
      return v;
    })();

    const dealsVal = (() => {
      let v = safe(sold?.team?.totalSales, 0);
      if (!v && Array.isArray(sold?.perAgent)) v = sum(sold.perAgent, p => p.sales || 0);
      return v;
    })();

    if (cards.calls) cards.calls.textContent = (callsTeamTotal || 0).toLocaleString();
    if (cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if (cards.deals) cards.deals.textContent = (dealsVal || 0).toLocaleString();
  }

  function agentRowHTML({ name, right1, right2, photoUrl }) {
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initials(name)}</div>`;
    return `
      <tr>
        <td class="agent" style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
        <td class="right">${right1}</td>
        ${right2 !== undefined ? `<td class="right">${right2}</td>` : ''}
      </tr>
    `;
  }

  // -------------------- Vendor summarizer (rolling 45d) --------------------
  function summarizeVendors(allSales = []) {
    const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    const byName = new Map();
    for (const s of allSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t < cutoff) continue;
      const vendorRaw = String(s.soldProductName || 'Unknown').trim();
      const vendor = VENDOR_SET.has(vendorRaw) ? vendorRaw : null;
      if (!vendor) continue;

      const row = byName.get(vendor) || { name: vendor, deals: 0 };
      row.deals += 1;
      byName.set(vendor, row);
    }
    const rows = [...byName.values()];
    const totalDeals = sum(rows, r => r.deals) || 1;
    for (const r of rows) r.shareDeals = +(r.deals * 100 / totalDeals).toFixed(1);
    rows.sort((a,b)=> b.shareDeals - a.shareDeals || b.deals - a.deals);
    return { rows, totalDeals };
  }

  // -------------------- Boards --------------------
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');

    const per = new Map();
    for (const a of (sold?.perAgent || [])) {
      const key = norm(canonicalName(a.name));
      per.set(key, {
        av: Number(a.av12x || a.av12X || a.amount || 0),
        deals: Number(a.sales || 0)
      });
    }

    const rows = (roster || []).map(p => {
      const key = norm(canonicalName(p.name));
      const d = per.get(key) || { av:0, deals:0 };
      return {
        name: p.name,
        av: d.av,
        deals: d.deals,
        photo: resolvePhoto({ name: p.name, email: p.email })
      };
    }).sort((a,b)=> b.av - a.av);

    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name, right1:fmtMoney(r.av), right2:(r.deals||0).toLocaleString(), photoUrl:r.photo
    })).join('');
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList) ? [...ytdList] : [];
    rows.sort((a,b)=> (b.av || 0) - (a.av || 0));

    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${rows.map(p => agentRowHTML({
        name: p.name, right1: fmtMoney(p.av || 0), photoUrl: resolvePhoto({ name: p.name })
      })).join('')}
      <tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${fmtMoney(ytdTotal || 0)}</strong></td></tr>
    `;
  }

  function renderWeeklyActivity({ roster, calls, sold, resolvePhoto, callsOverride }) {
    setView('Weekly Activity');

    const fmtMin = (n) => {
      const m = Math.max(0, Math.floor(+n || 0));
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return h ? `${h}h ${mm}m` : `${mm}m`;
    };

    // Use override if present
    if (callsOverride && typeof callsOverride === 'object' && Object.keys(callsOverride).length) {
      const byEmailToName = new Map();
      for (const p of roster || []) {
        const email = String(p.email || '').trim().toLowerCase();
        if (email) byEmailToName.set(email, p.name || email);
      }

      const rows = Object.entries(callsOverride).map(([emailRaw, m]) => {
        const email = String(emailRaw || '').trim().toLowerCase();
        const name  = byEmailToName.get(email) || (email ? email.split('@')[0] : 'Agent');
        const leads = +m.leads || 0;
        const soldC = +m.sold  || 0;
        const conv  = leads > 0 ? ((soldC / leads) * 100) : 0;
        return {
          key: email || name,
          name,
          calls: +m.calls || 0,
          talkMin: +m.talkMin || 0,
          loggedMin: +m.loggedMin || 0,
          leads, sold: soldC, conv
        };
      }).sort((a,b)=> (b.sold - a.sold) || (b.calls - a.calls));

      if (headEl) headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Calls</th>
          <th class="right">Talk&nbsp;Time</th>
          <th class="right">Logged</th>
          <th class="right">Leads</th>
          <th class="right">Sold</th>
          <th class="right">Conv&nbsp;%</th>
        </tr>
      `;
      if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
        name:r.name,
        right1: r.calls.toLocaleString(),
        right2: `${fmtMin(r.talkMin)} / ${fmtMin(r.loggedMin)} / ${r.leads} / ${r.sold} / ${r.conv.toFixed(1)}%`,
        photoUrl: resolvePhoto({ name: r.name, email: r.key.includes('@') ? r.key : undefined })
      })).join('');
      return;
    }

    // Fallback: simple Calls + Deals by canonicalized agent
    const callMap = new Map();
    for (const a of (calls?.perAgent || [])) callMap.set(norm(canonicalName(a.name)), +a.calls || 0);
    const dealMap = new Map();
    for (const a of (sold?.perAgent || []))  dealMap.set(norm(canonicalName(a.name)), +a.sales || 0);

    const keys = new Set([...callMap.keys(), ...dealMap.keys()]);
    const rows = [...keys].map(k => {
      const disp = k.replace(/\b\w/g, m => m.toUpperCase());
      return { key:k, name:disp, calls:callMap.get(k)||0, deals:dealMap.get(k)||0 };
    }).sort((a,b)=> (b.calls + b.deals) - (a.calls + a.deals));

    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Calls</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r => agentRowHTML({
      name:r.name,
      right1:(r.calls || 0).toLocaleString(),
      right2:(r.deals || 0).toLocaleString(),
      photoUrl: resolvePhoto({ name: r.name })
    })).join('');
  }

  function renderVendorsBoard({ vendorRows }) {
    const data = vendorRows || { rows: [], totalDeals: 0 };
    const rows = data.rows || [];
    const totalDeals = data.totalDeals || 0;

    setView('Lead Vendors — Last 45 Days');

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    const COLORS = ['#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787','#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'];
    const colorFor = (name = '') => COLORS[[...name].reduce((a,c)=> a + c.charCodeAt(0), 0) % COLORS.length];

    // Simple donut by deals
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

  function renderParBoard({ par, ytdList }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target, 0);
    const agents = Array.isArray(par?.agents) ? par.agents : [];
    const ytdMap = new Map((ytdList||[]).map(a => [norm(canonicalName(a.name)), +a.av || 0]));

    if (!agents.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`;
      return;
    }

    if (headEl) headEl.innerHTML = `
      <tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">Annual&nbsp;AV</th></tr>
    `;
    if (bodyEl) bodyEl.innerHTML = `
      ${agents.map(a => {
        const annual = ytdMap.get(norm(canonicalName(a.name))) || 0;
        return `
          <tr>
            <td>${a.name}</td>
            <td class="right">${safe(a.take_rate,0)}%</td>
            <td class="right">${fmtMoney(annual)}</td>
          </tr>`;
      }).join('')}
      <tr class="total"><td><strong>PACE TO QUALIFY</strong></td><td></td>
      <td class="right"><strong>${fmtMoney(pace)}</strong></td></tr>
    `;
  }

  // -------------------- Backfill parser (your pasted block) --------------------
  const BACKFILL_TEXT = ``; // keep empty if you don't want backfill; otherwise paste the block
  function parseBackfill(text) {
    if (!text) return [];
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

  // -------------------- Load all data (FIXED return) --------------------
  async function loadAll() {
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par, callsOverride] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par),
      fetchJSON(ENDPOINTS.callsOverride)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster || []);

    // Build vendor rows from merged allSales + backfill
    const liveAllSales = Array.isArray(sold?.allSales) ? sold.allSales : [];
    const mergedAllSales = [...liveAllSales, ...BACKFILL_SALES];
    const vendorRows = summarizeVendors(mergedAllSales);

    // Seed seen IDs (45d window)
    const cutoff = Date.now() - 45*24*3600*1000;
    for (const s of liveAllSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (Number.isFinite(t) && t >= cutoff) seenLeadIds.add(saleId(s));
    }

    // Compute Team Calls total: override → API fallback
    let callsTeamTotal = 0;
    if (callsOverride && typeof callsOverride === 'object' && Object.keys(callsOverride).length) {
      callsTeamTotal = sum(Object.values(callsOverride), m => m.calls || 0);
    } else if (Number.isFinite(+calls?.team?.calls)) {
      callsTeamTotal = +calls.team.calls;
    } else if (Array.isArray(calls?.perAgent)) {
      callsTeamTotal = sum(calls.perAgent, a => a.calls || 0);
    }

    return {
      rules: rules || { rules: [] },
      roster: roster || [],
      calls: calls || { team: { calls: 0 }, perAgent: [] },
      sold:  sold || { team: { totalSales: 0, totalAV12X: 0 }, perAgent: [], allSales: [] },
      ytdList: ytdList || [],
      ytdTotal: Number(ytdTotalJson?.total || 0),
      par: par || { pace_target: 0, agents: [] },
      callsOverride: callsOverride || null,
      resolvePhoto,
      vendorRows,
      callsTeamTotal
    };
  }

  // -------------------- Rotation & polling --------------------
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
          showSplash({ name: s.agent || 'Agent', amount: s.amount || 0, soldProductName: s.soldProductName || '' });
        }
      }
      if (newSalesFound) renderCards({ callsTeamTotal: initialData.callsTeamTotal, sold });
    };

    setInterval(tick, POLL_MS);
  }

  // -------------------- Rules rotation (12h) --------------------
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

  // -------------------- Boot --------------------
  (async () => {
    try {
      const data = await loadAll();
      renderCards({ callsTeamTotal: data.callsTeamTotal, sold: data.sold });
      startRuleRotation(data.rules);
      startBoardRotation(data);
      startLiveSalePolling(data);
      // Clear "Loading..." if present
      const loading = $('#loadingRow');
      if (loading && loading.parentNode) loading.parentNode.removeChild(loading);
    } catch (err) {
      console.error(err);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
    }
  })();
})();

// -------------------- OE Countdown (unchanged) --------------------
(function () {
  const timerEl = document.querySelector('#oeTimer');
  if (!timerEl) return;
  const deadline = new Date('2025-11-01T00:00:00-04:00');
  const pad = n => String(n).padStart(2, '0');
  function updateCountdown() {
    const now = new Date();
    const diff = deadline - now;
    if (diff <= 0) { timerEl.textContent = 'LIVE'; return; }
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / (1000 * 60)) % 60);
    const s = Math.floor((diff / 1000) % 60);
    timerEl.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    requestAnimationFrame(() => setTimeout(updateCountdown, 250));
  }
  updateCountdown();
})();
</script>
