<!-- <script src="dashboard.js"></script> -->
<script>
/* ========================= FEW DASHBOARD — FULL REWRITE =========================
   Fixes:
   - Vendor board uses rolling 45 days (live + backfill), not weekly.
   - Cards: Team Calls shows SUM of calls across agents (override JSON or API).
   - PAR: shows Take Rate + Annual AV per agent (sourced from YTD override).
   Kept:
   - Boards rotation every 30s, rules banner, headshot resolver, gold sale splash.
   - Resilience to missing endpoints. No layout width/style changes.
=============================================================================== */

(() => {
  // ---------- Endpoints (same paths you’ve been using)
  const ENDPOINTS = {
    teamSold: '/api/team_sold',               // { team, perAgent, allSales[] }
    callsByAgent: '/api/calls_by_agent',      // fallback if no override
    rules: '/rules.json',                     // { rules: [...] }
    roster: '/headshots/roster.json',
    ytdAv: '/ytd_av.json',                    // [{ name, av }]
    ytdTotal: '/ytd_total.json',              // { total: number } OR number
    par: '/par.json',                         // { pace_target, agents:[{ name, take_rate }] }
    callsOverride: '/calls_week_override.json'// { email: { calls, talkMin, loggedMin, leads, sold } }
  };

  // ---------- Helpers
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const norm = (s) => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const safe = (v,d=0)=> (v==null?d:v);
  const fmtMoney = (n)=> `$${Math.round(Number(n)||0).toLocaleString()}`;
  const initials = (name) => String(name||'').trim().split(/\s+/).map(w=>w[0]?.toUpperCase()||'').join('');

  const fetchJSON = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON fail:', url, e.message||e);
      return null;
    }
  };

  // Permanent vendor whitelist
  const VENDOR_SET = new Set([
    '$7.50','George Region Shared','Red Media','Blast/Bulk','Exclusive JUMBO','ABC',
    'Shared Jumbo','VS Default','RKA Website','Redrip/Give up Purchased','Lamy Dynasty Specials',
    'JUMBO Splits','Exclusive 30s','Positive Intent/Argos','HotLine Bling','Referral','CG Exclusive','TTM Nice!'
  ]);

  // Canonical name mapping (expand as needed)
  const NAME_ALIASES = new Map([
    ['f n','fabricio navarrete cervantes'], ['fab','fabricio navarrete cervantes'],
    ['fabricio','fabricio navarrete cervantes'],
    ['fabricio navarrete','fabricio navarrete cervantes'],
    ['fabricio cervantes','fabricio navarrete cervantes'],
    ['a s','ajani senior'],
    ['marie saint cyr','marie saint cyr'],
    ['eli thermilus','eli thermilus'],
    ['philip baxter','philip baxter'],
    ['robert adams','robert adams'],
    ['nathan johnson','nathan johnson'],
    ['anna gleason','anna'],
    ['sebastian beltran','sebastian beltran']
  ]);
  const canonical = (name)=> NAME_ALIASES.get(norm(name)) || name;

  // Headshot resolver
  function buildHeadshotResolver(roster) {
    const byName = new Map(), byEmail = new Map(), byPhone = new Map(), byIni = new Map();
    const photoURL = (p)=>!p?null:(String(p).startsWith('http')||String(p).startsWith('/'))?String(p):`/headshots/${p}`;
    for (const p of roster||[]) {
      const c = norm(canonical(p.name));
      const em= String(p.email||'').trim().toLowerCase();
      const ph= photoURL(p.photo);
      if (c) byName.set(c, ph);
      if (em) byEmail.set(em, ph);
      if (Array.isArray(p.phones)) for (const raw of p.phones) {
        const d = String(raw||'').replace(/\D+/g,''); if (d) byPhone.set(d, ph);
      }
      const ini = initials(p.name);
      if (ini) byIni.set(ini, ph);
    }
    return (agent={})=>{
      const c = norm(canonical(agent.name));
      const em= String(agent.email||'').trim().toLowerCase();
      const ph= String(agent.phone||'').replace(/\D+/g,'');
      const ini= initials(agent.name||'');
      return byName.get(c) ?? byEmail.get(em) ?? (ph?byPhone.get(ph):null) ?? byIni.get(ini) ?? null;
    };
  }

  // ---------- DOM anchors (match your HTML)
  const bannerTitle=$('.banner .title'), bannerSub=$('.banner .subtitle');
  const cards = { calls: $('#sumCalls'), av: $('#sumSales'), deals: $('#sumTalk') };
  const headEl = $('#thead'), bodyEl = $('#tbody'), viewLabelEl = $('#viewLabel');

  const setView = (t)=>{ if (viewLabelEl) viewLabelEl.textContent = t; };
  const setBanner = (h,s='')=>{ if(bannerTitle) bannerTitle.textContent=h||''; if(bannerSub) bannerSub.textContent=s||''; };

  // Tiny CSS for donut/legend/splash (no width changes)
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
      .splash{ position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); background:linear-gradient(135deg,#a68109,#ffd34d); color:#1a1a1a; padding:22px 28px; border-radius:16px; box-shadow:0 18px 48px rgba(0,0,0,.45); z-index:9999; min-width:320px; text-align:center; }
      .splash .big{ font-size:24px; font-weight:900; line-height:1.2; }
      .splash .mid{ font-size:20px; font-weight:800; margin-top:6px; }
      .splash .sub{ font-size:12px; opacity:.85; margin-top:8px; }
    `;
    const tag=document.createElement('style'); tag.id='few-inline-css'; tag.textContent=css; document.head.appendChild(tag);
  })();

  // Splash for new sales
  const seenLeadIds = new Set();
  const saleId = (s)=> String(s.leadId || s.id || `${s.agent}-${s.dateSold||s.date}-${s.soldProductName}-${s.amount}`);
  function showSplash({ name, amount, soldProductName }) {
    const el = document.createElement('div');
    el.className='splash';
    el.innerHTML = `<div class="big">${name}</div><div class="mid">${fmtMoney(amount)}</div><div class="sub">${soldProductName||''}</div>`;
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 60_000);
  }

  // ---------- Vendor summarizer (strict 45-day rolling window)
  function summarizeVendors45d(allSales=[]) {
    const cutoff = Date.now() - 45*24*3600*1000;
    const by = new Map();
    for (const s of allSales) {
      const t = Date.parse(s.dateSold || s.date || '');
      if (!Number.isFinite(t) || t<cutoff) continue;
      const vendor = String(s.soldProductName||'').trim();
      if (!VENDOR_SET.has(vendor)) continue; // only approved labels
      const amt = +s.amount || 0;
      const row = by.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      row.deals += 1; row.amount += amt;
      by.set(vendor,row);
    }
    const rows = [...by.values()];
    const totalDeals = rows.reduce((a,r)=>a+r.deals,0)||1;
    const totalAmount = rows.reduce((a,r)=>a+r.amount,0);
    for (const r of rows) {
      r.shareDeals = +(r.deals*100/totalDeals).toFixed(1);
      r.shareAmount = totalAmount ? +((r.amount*100/totalAmount).toFixed(1)) : 0;
    }
    rows.sort((a,b)=> b.shareDeals - a.shareDeals || b.amount - a.amount);
    return { rows, totalDeals, totalAmount };
  }

  // ---------- Cards
  function renderCards({ callsOverride, callsApi, sold }) {
    // Team Calls = SUM(calls) from override if present else API perAgent
    let teamCalls = 0;
    if (callsOverride && typeof callsOverride==='object') {
      for (const k of Object.keys(callsOverride)) teamCalls += +safe(callsOverride[k]?.calls,0);
    } else if (Array.isArray(callsApi?.perAgent)) {
      for (const a of callsApi.perAgent) teamCalls += +safe(a.calls,0);
    }
    if (cards.calls) cards.calls.textContent = (teamCalls||0).toLocaleString();

    // Weekly AV / Deals — favor server-provided team fields, otherwise sum perAgent
    let weekAv = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
    let weekDeals = safe(sold?.team?.totalSales, 0);
    if ((!weekAv || !weekDeals) && Array.isArray(sold?.perAgent)) {
      weekAv = sold.perAgent.reduce((a,p)=> a + (+p.av12x || +p.av12X || +p.amount || 0), 0);
      weekDeals = sold.perAgent.reduce((a,p)=> a + (+p.sales||0), 0);
    }
    if (cards.av)    cards.av.textContent = fmtMoney(weekAv);
    if (cards.deals) cards.deals.textContent = (weekDeals||0).toLocaleString();
  }

  function agentRowHTML({ name, right1, right2, photoUrl }) {
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:28px;height:28px;border-radius:50%;background:#1f2a3a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;font-weight:700;color:#89a2c6">${initials(name)}</div>`;
    return `<tr><td class="agent" style="display:flex;align-items:center">${avatar}<span>${name}</span></td><td class="right">${right1}</td>${right2!=null?`<td class="right">${right2}</td>`:''}</tr>`;
  }

  // ---------- Boards
  function renderRosterBoard({ roster, sold, resolvePhoto }) {
    setView('This Week — Roster');
    const per = new Map();
    for (const a of (sold?.perAgent||[])) {
      const k = norm(canonical(a.name));
      per.set(k, { av:+(a.av12x||a.av12X||a.amount||0), deals:+safe(a.sales,0) });
    }
    const rows = [];
    for (const p of (roster||[])) {
      const k = norm(canonical(p.name));
      const d = per.get(k) || { av:0, deals:0 };
      rows.push({
        name: p.name,
        av: d.av,
        deals: d.deals,
        photoUrl: resolvePhoto({ name: p.name, email: p.email })
      });
    }
    rows.sort((a,b)=> b.av - a.av);
    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r=>agentRowHTML({ name:r.name, right1:fmtMoney(r.av), right2:(r.deals||0).toLocaleString(), photoUrl:r.photoUrl })).join('');
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }) {
    setView('YTD — Team');
    const rows = Array.isArray(ytdList)?[...ytdList]:[];
    rows.sort((a,b)=> (b.av||0) - (a.av||0));
    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = `
      ${rows.map(p => agentRowHTML({ name:p.name, right1:fmtMoney(p.av||0), photoUrl: resolvePhoto({ name:p.name }) })).join('')}
      <tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${fmtMoney((typeof ytdTotal==='number')?ytdTotal:(ytdTotal?.total||0))}</strong></td></tr>
    `;
  }

  function renderWeeklyActivity({ roster, sold, callsOverride, callsApi, resolvePhoto }) {
    setView('Weekly Activity');

    // Prefer override with richer fields; else fallback to simple calls+deals by agent
    if (callsOverride && typeof callsOverride==='object') {
      const emailToName = new Map();
      for (const p of roster||[]) {
        const em = String(p.email||'').trim().toLowerCase();
        if (em) emailToName.set(em, p.name||em);
      }

      const rows = Object.entries(callsOverride).map(([email, m])=>{
        const name = emailToName.get(String(email).toLowerCase()) || String(email).split('@')[0];
        const leads = +safe(m.leads,0), soldC = +safe(m.sold,0);
        const conv = leads>0 ? (soldC/leads*100) : 0;
        return {
          name,
          calls:+safe(m.calls,0),
          talkMin:+safe(m.talkMin,0),
          loggedMin:+safe(m.loggedMin,0),
          leads, sold:soldC, conv
        };
      }).sort((a,b)=> (b.sold-a.sold) || (b.calls-a.calls));

      if (headEl) headEl.innerHTML = `
        <tr>
          <th>Agent</th>
          <th class="right">Calls</th>
          <th class="right">Talk&nbsp;Time</th>
          <th class="right">Logged</th>
          <th class="right">Leads</th>
          <th class="right">Sold</th>
          <th class="right">Conv&nbsp;%</th>
        </tr>`;
      const fmtMin=(n)=>{ const m=Math.max(0,Math.floor(+n||0)); const h=Math.floor(m/60), mm=m%60; return h?`${h}h ${mm}m`:`${mm}m`; };
      if (bodyEl) bodyEl.innerHTML = rows.map(r=>agentRowHTML({
        name:r.name,
        right1:r.calls.toLocaleString(),
        right2:`${fmtMin(r.talkMin)} | ${fmtMin(r.loggedMin)} | ${r.leads.toLocaleString()} | ${r.sold.toLocaleString()} | ${r.conv.toFixed(1)}%`,
        photoUrl: resolvePhoto({ name:r.name })
      })).join('');
      return;
    }

    // Fallback
    const callMap=new Map(), dealMap=new Map();
    for (const a of (callsApi?.perAgent||[])) callMap.set(norm(canonical(a.name)), +safe(a.calls,0));
    for (const a of (sold?.perAgent||[]))   dealMap.set(norm(canonical(a.name)), +safe(a.sales,0));
    const keys = new Set([...callMap.keys(),...dealMap.keys()]);
    const rows = [...keys].map(k=>{
      const disp = k.replace(/\b\w/g,m=>m.toUpperCase());
      return { name:disp, calls:callMap.get(k)||0, deals:dealMap.get(k)||0 };
    }).sort((a,b)=> (b.calls+b.deals)-(a.calls+a.deals));

    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Calls</th><th class="right">Deals</th></tr>`;
    if (bodyEl) bodyEl.innerHTML = rows.map(r=>agentRowHTML({
      name:r.name, right1:r.calls.toLocaleString(), right2:r.deals.toLocaleString(), photoUrl: resolvePhoto({ name:r.name })
    })).join('');
  }

  function renderVendorsBoard({ vendor45, headEl, bodyEl }) {
    setView('Lead Vendors — Last 45 Days');
    const rows = vendor45.rows||[];
    const totalDeals = vendor45.totalDeals||0;

    if (!rows.length) {
      if (headEl) headEl.innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    if (headEl) headEl.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th class="right">Deals</th>
        <th class="right">% of total</th>
      </tr>`;

    const COLORS=['#ffd34d','#ff9f40','#ff6b6b','#6bcfff','#7ee787','#b68cff','#f78da7','#72d4ba','#e3b341','#9cc2ff'];
    const colorFor=(name='')=> COLORS[[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%COLORS.length];

    // donut
    const size=240,cx=size/2,cy=size/2,r=size/2-8;
    const polar=(cx,cy,r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
    const arc=(a0,a1)=>{const L=(a1-a0)>Math.PI?1:0; const [x0,y0]=polar(cx,cy,r,a0); const [x1,y1]=polar(cx,cy,r,a1); return `M ${x0} ${y0} A ${r} ${r} 0 ${L} 1 ${x1} ${y1}`;};
    let acc=-Math.PI/2; const arcs=rows.map(v=>{const span=2*Math.PI*(v.deals/totalDeals); const d=arc(acc,acc+span); acc+=span; return `<path d="${d}" stroke="${colorFor(v.name)}" stroke-width="28" fill="none"></path>`;}).join('');
    const svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}<circle cx="${cx}" cy="${cy}" r="${r-16}" fill="#0f141c"></circle><text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Deals</text><text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text></svg>`;

    const legend = rows.map(v=>`<div class="legend-item"><span class="dot" style="background:${colorFor(v.name)}"></span><span class="label">${v.name}</span><span class="val">${v.deals.toLocaleString()} • ${v.shareDeals}%</span></div>`).join('');
    const donutRow = `<tr><td colspan="3" style="padding:18px"><div class="vendor-flex">${svg}<div class="legend">${legend}</div></div></td></tr>`;

    const tableRows = rows.map(v=>`<tr><td><span class="dot" style="background:${colorFor(v.name)}"></span>${v.name}</td><td class="right">${v.deals.toLocaleString()}</td><td class="right" style="color:${colorFor(v.name)}">${v.shareDeals}%</td></tr>`).join('');
    const totals = `<tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${totalDeals.toLocaleString()}</strong></td><td></td></tr>`;
    if (bodyEl) bodyEl.innerHTML = donutRow + tableRows + totals;
  }

  function renderParBoard({ par, ytdMap }) {
    setView('PAR — Tracking');
    const pace = +safe(par?.pace_target,0);
    const agents = Array.isArray(par?.agents)?par.agents:[];
    if (!agents.length) {
      if (headEl) headEl.innerHTML=''; if (bodyEl) bodyEl.innerHTML=`<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`;
      return;
    }
    if (headEl) headEl.innerHTML = `<tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">Annual&nbsp;AV</th></tr>`;
    const rows = agents.map(a=>{
      const y = ytdMap.get(norm(canonical(a.name))) || 0;
      return `<tr><td>${a.name}</td><td class="right">${safe(a.take_rate,0)}%</td><td class="right">${fmtMoney(y)}</td></tr>`;
    }).join('');
    if (bodyEl) bodyEl.innerHTML = rows + `<tr class="total"><td><strong>PACE TO QUALIFY</strong></td><td></td><td class="right"><strong>${fmtMoney(pace)}</strong></td></tr>`;
  }

  // ---------- Rules rotation (12h)
  function startRuleRotation(rulesJson) {
    const base='THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    const list=Array.isArray(rulesJson?.rules)?rulesJson.rules.filter(Boolean):[];
    if (!list.length) { setBanner(base,'Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.'); return; }
    let i=0; const apply=()=>setBanner(base,list[i%list.length]); apply(); setInterval(()=>{i++;apply();},12*60*60*1000);
  }

  // ---------- Data load (single pass)
  async function loadAll() {
    const [rules, roster, callsApi, sold, ytdList, ytdTotal, par, callsOverride] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par),
      fetchJSON(ENDPOINTS.callsOverride)
    ]);

    const resolvePhoto = buildHeadshotResolver(roster||[]);

    // Vendor 45d build from live allSales only (no weekly filter)
    const allSales = Array.isArray(sold?.allSales)?sold.allSales:[];
    // seed seen ids for splash
    const cutoff = Date.now()-45*24*3600*1000;
    for (const s of allSales) {
      const t=Date.parse(s.dateSold||s.date||''); if (Number.isFinite(t) && t>=cutoff) seenLeadIds.add(saleId(s));
    }
    const vendor45 = summarizeVendors45d(allSales);

    // YTD map for quick lookup (PAR board)
    const ytdMap = new Map();
    for (const r of (ytdList||[])) ytdMap.set(norm(canonical(r.name)), +safe(r.av,0));

    return { rules, roster, callsApi, sold, ytdList, ytdTotal, par, callsOverride, resolvePhoto, vendor45, ytdMap };
  }

  // ---------- Rotation
  function startBoardRotation(data) {
    const order = [
      ()=>renderRosterBoard(data),
      ()=>renderYtdBoard(data),
      ()=>renderWeeklyActivity(data),
      ()=>renderVendorsBoard({ vendor45:data.vendor45, headEl, bodyEl }),
      ()=>renderParBoard(data)
    ];
    let i=0; const paint=()=>order[i%order.length](); paint(); setInterval(()=>{i++;paint();},30_000);
  }

  // ---------- Live sale polling (splash + update cards)
  function startLiveSalePolling(base) {
    const POLL = 12_000, WINDOW = 45*24*3600*1000;
    const tick = async ()=>{
      const sold = await fetchJSON(ENDPOINTS.teamSold); if (!sold) return;
      const allSales = Array.isArray(sold.allSales)?sold.allSales:[];
      let bumped=false; const nowCut=Date.now()-WINDOW;
      for (const s of allSales) {
        const id=saleId(s); const t=Date.parse(s.dateSold||s.date||'');
        if (!seenLeadIds.has(id) && Number.isFinite(t) && t>=nowCut) {
          seenLeadIds.add(id); bumped=true;
          showSplash({ name: s.agent||'Agent', amount: s.amount||0, soldProductName: s.soldProductName||'' });
        }
      }
      if (bumped) renderCards({ callsOverride: base.callsOverride, callsApi: base.callsApi, sold });
    };
    setInterval(tick, POLL);
  }

  // ---------- Boot
  (async ()=>{
    try {
      const data = await loadAll();
      renderCards(data);           // includes Team Calls sum fix
      startRuleRotation(data.rules);
      startBoardRotation(data);    // shows boards incl. 45-day vendor
      startLiveSalePolling(data);
    } catch (e) {
      console.error(e);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT', 'Error loading data.');
      if (bodyEl) bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
    }
  })();
})();

// ---------- OE Countdown (unchanged) ----------
(function(){
  const el = document.querySelector('#oeTimer'); if (!el) return;
  const deadline = new Date('2025-11-01T00:00:00-04:00'); // ET
  const pad = n=>String(n).padStart(2,'0');
  function tick(){
    const diff = deadline - new Date();
    if (diff<=0) { el.textContent='LIVE'; return; }
    const d=Math.floor(diff/86400000), h=Math.floor(diff/3600000)%24, m=Math.floor(diff/60000)%60, s=Math.floor(diff/1000)%60;
    el.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    requestAnimationFrame(()=>setTimeout(tick,250));
  }
  tick();
})();
</script>
