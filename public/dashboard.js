/* FEW Dashboard — Single File, Final + Donut + Center Splash
   Boards: This Week — Roster | YTD — Team | Weekly Activity | Vendor Report 45 days | PAR — Tracking
*/
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
  };

  // ---------- Utilities ----------
  const $  = (s,root=document)=>root.querySelector(s);
  const $$ = (s,root=document)=>Array.from(root.querySelectorAll(s));
  const fmtMoney = (n)=>`$${Math.round(+n||0).toLocaleString()}`;
  const safe = (v,d)=> (v===undefined||v===null?d:v);
  const fetchJSON = async (url)=>{
    try{
      const r = await fetch(url,{cache:'no-store'});
      if(!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    }catch(e){ console.warn('fetchJSON', url, e.message||e); return null; }
  };

  // ---------- Name normalization (fixes F N / Fabricio variants) ----------
  const NAME_ALIASES = new Map([
    ['f n','fabricio navarrete cervantes'],
    ['fabricio navarrete','fabricio navarrete cervantes'],
    ['fabricio cervantes','fabricio navarrete cervantes'],
  ]);
  const norm = s => (s||'').trim().toLowerCase().replace(/\s+/g,' ');
  const canonicalName = (name) => NAME_ALIASES.get(norm(name)) || name;

  // ---------- Headshot resolver ----------
  function buildHeadshotResolver(roster){
    const byName=new Map(), byEmail=new Map(), byPhone=new Map(), byInitial=new Map();
    const initialsOf=(full='')=>full.trim().split(/\s+/).map(w=>(w[0]||'').toUpperCase()).join('');
    for(const p of roster||[]){
      const name = norm(p.name);
      const email=(p.email||'').trim().toLowerCase();
      const photo=p.photo||null;
      if(name) byName.set(name, photo);
      if(email) byEmail.set(email, photo);
      if(Array.isArray(p.phones)) for(const raw of p.phones){
        const ph=String(raw||'').replace(/\D+/g,''); if(ph) byPhone.set(ph, photo);
      }
      const ini = initialsOf(p.name); if(ini) byInitial.set(ini, photo);
    }
    return (agent={})=>{
      const cname = norm(canonicalName(agent.name||''));
      const email=(agent.email||'').trim().toLowerCase();
      const phone=String(agent.phone||'').replace(/\D+/g,'');
      const ini = initialsOf(agent.name||'');
      return byName.get(cname) ?? byEmail.get(email) ?? (phone?byPhone.get(phone):null) ?? byInitial.get(ini) ?? null;
    };
  }

  // ---------- Layout anchors (match your index.html) ----------
  const bannerTitle = $('.banner .title');
  const bannerSub   = $('.banner .subtitle');
  const cards = { calls: $('#sumCalls'), av: $('#sumSales'), deals: $('#sumTalk') };
  const boardTable  = $('#board');
  const headEl      = $('#thead');
  const bodyEl      = $('#tbody');
  const viewLabelEl = $('#viewLabel');

  const setView = (t)=>{ if(viewLabelEl) viewLabelEl.textContent=t; };
  const setBanner = (h,s='')=>{ if(bannerTitle) bannerTitle.textContent=h||''; if(bannerSub) bannerSub.textContent=s||''; };

  // ---------- Inject minimal CSS for donut + splash ----------
  (function injectCSS(){
    const css = `
      .right{ text-align:right; font-variant-numeric:tabular-nums; }
      .vendor-flex{ display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
      .legend{ min-width:240px; }
      .legend-item{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid #1b2534; }
      .legend-item .label{ color:#cfd7e3; }
      .legend-item .val{ color:#9fb0c8; font-variant-numeric:tabular-nums; }
      .dot{ display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; vertical-align:middle; }
      #saleSplash{
        position:fixed; inset:0; display:none; place-items:center; z-index:10000;
        background:rgba(0,0,0,.35);
      }
      #saleSplash .card{
        background:linear-gradient(135deg,#b08500,#ffe17a);
        color:#1b1603; padding:24px 32px; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,.45);
        text-align:center; max-width:80vw;
      }
      #saleSplash .who{ font-size:26px; font-weight:900; letter-spacing:.3px; }
      #saleSplash .amt{ font-size:24px; font-weight:800; margin-top:6px; }
      #saleSplash .prod{ font-size:14px; opacity:.85; margin-top:2px; }
    `;
    const tag=document.createElement('style'); tag.textContent=css; document.head.appendChild(tag);
    const splash=document.createElement('div'); splash.id='saleSplash'; splash.innerHTML=`<div class="card"><div class="who"></div><div class="amt"></div><div class="prod"></div></div>`;
    document.body.appendChild(splash);
  })();

  // ---------- Center Splash (queued, 60s) ----------
  const splashQ = [];
  let splashOn = false;
  function showSplash(item){
    splashQ.push(item); run();
    function run(){
      if(splashOn || !splashQ.length) return;
      splashOn = true;
      const {name, amount, soldProductName} = splashQ.shift();
      const root = $('#saleSplash');
      root.style.display='grid';
      root.querySelector('.who').textContent = name || 'New Sale';
      root.querySelector('.amt').textContent = fmtMoney(amount||0);
      root.querySelector('.prod').textContent = soldProductName || '';
      const hide=()=>{ root.style.display='none'; splashOn=false; run(); };
      setTimeout(hide, 60_000);
    }
  }

  // ---------- Vendor summary (rolling 45 days) ----------
  function vendorSummary(allSales=[]){
    const cutoff = Date.now() - 45*24*3600*1000;
    const map = new Map(); // name -> {deals, amount}
    for(const s of allSales){
      const t = Date.parse(s.dateSold||s.date||''); if(!isFinite(t) || t < cutoff) continue;
      const vendor = (s.soldProductName||'Unknown').trim();
      const amount = +s.amount || 0;
      const row = map.get(vendor) || { name: vendor, deals: 0, amount: 0 };
      row.deals += 1; row.amount += amount; map.set(vendor,row);
    }
    const rows = [...map.values()];
    const totalDeals = rows.reduce((a,b)=>a+b.deals,0) || 1;
    for(const r of rows) r.share = +(r.deals*100/totalDeals).toFixed(1);
    rows.sort((a,b)=> b.share - a.share || b.deals - a.deals || b.amount - a.amount);
    return { rows, totalDeals };
  }

  // ---------- Colors for vendors (stable) ----------
  const VENDOR_COLORS = ['#ffd34d','#ff9f40','#6bcfff','#7ee787','#f78da7','#b68cff','#72d4ba','#ff6b6b','#e3b341','#9cc2ff'];
  const colorFor = (name='')=> VENDOR_COLORS[[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%VENDOR_COLORS.length];

  // ---------- Render helpers ----------
  function renderCards({calls, sold}){
    const callsVal = safe(calls?.team?.calls, 0);
    const avVal    = safe(sold?.team?.totalAV12X ?? sold?.team?.totalAv12x, 0);
    const dealsVal = safe(sold?.team?.totalSales, 0);
    if(cards.calls) cards.calls.textContent = (callsVal||0).toLocaleString();
    if(cards.av)    cards.av.textContent    = fmtMoney(avVal);
    if(cards.deals) cards.deals.textContent = (dealsVal||0).toLocaleString();
  }

  function agentRowHTML({ name, right1, right2, photoUrl, initial }){
    const avatar = photoUrl
      ? `<img src="${photoUrl}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;margin-right:10px;border:1px solid rgba(255,255,255,.15)" />`
      : `<div style="width:26px;height:26px;border-radius:50%;background:#2a2a2a;display:flex;align-items:center;justify-content:center;margin-right:10px;border:1px solid rgba(255,255,255,.15);font-size:12px;color:#ddd">${initial||'?'}</div>`;
    return `<tr>
      <td style="display:flex;align-items:center">${avatar}<span>${name}</span></td>
      <td class="right">${right1}</td>
      ${right2!==undefined?`<td class="right">${right2}</td>`:''}
    </tr>`;
  }

  // ---------- Boards ----------
  function renderRosterBoard({ roster, sold, resolvePhoto }){
    setView('This Week — Roster');
    const per=new Map();
    for(const a of (sold?.perAgent||[])){
      const key=norm(canonicalName(a.name||''));
      per.set(key,{ av:a.av12x??a.av12X??a.amount??0, deals:a.sales??0 });
    }
    const rows=[];
    for(const p of roster||[]){
      const key=norm(canonicalName(p.name||''));
      const d=per.get(key)||{av:0,deals:0};
      const photo=resolvePhoto({name:p.name,email:p.email});
      const initials=(p.name||'').split(/\s+/).map(w=>(w[0]||'').toUpperCase()).join('');
      rows.push({name:p.name,av:d.av,deals:d.deals,photo,initials});
    }
    rows.sort((a,b)=>b.av-a.av);

    headEl.innerHTML = `<tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    bodyEl.innerHTML = rows.map(r=>agentRowHTML({
      name:r.name,right1:fmtMoney(r.av),right2:(r.deals||0).toLocaleString(),photoUrl:r.photo,initial:r.initials
    })).join('');
  }

  function renderYtdBoard({ ytdList, ytdTotal, resolvePhoto }){
    setView('YTD — Team');
    const rows = Array.isArray(ytdList)?[...ytdList]:[];
    rows.sort((a,b)=>(b.av||0)-(a.av||0));
    headEl.innerHTML = `<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    bodyEl.innerHTML = `
      ${rows.map(p=>agentRowHTML({
        name:p.name,right1:fmtMoney(p.av||0),
        photoUrl:resolvePhoto({name:p.name}),initial:(p.name||'').split(/\s+/).map(w=>(w[0]||'').toUpperCase()).join('')
      })).join('')}
      <tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${fmtMoney(ytdTotal||0)}</strong></td></tr>
    `;
  }

  function renderWeeklyActivity({ calls, sold, resolvePhoto }){
    setView('Weekly Activity');
    const callMap=new Map(); for(const a of (calls?.perAgent||[])) callMap.set(norm(canonicalName(a.name||'')), a.calls||0);
    const dealMap=new Map(); for(const a of (sold?.perAgent||[]))  dealMap.set(norm(canonicalName(a.name||'')), a.sales||0);
    const names=new Set([...callMap.keys(),...dealMap.keys()]);
    const rows=[...names].map(k=>{
      const caps = k.replace(/\b\w/g,m=>m.toUpperCase());
      return { key:k, name:caps, calls:callMap.get(k)||0, deals:dealMap.get(k)||0 };
    }).sort((a,b)=>(b.calls+b.deals)-(a.calls+a.deals));

    headEl.innerHTML = `<tr><th>Agent</th><th class="right">Calls</th><th class="right">Deals</th></tr>`;
    bodyEl.innerHTML = rows.map(r=>agentRowHTML({
      name:r.name,right1:(r.calls||0).toLocaleString(),right2:(r.deals||0).toLocaleString(),
      photoUrl:resolvePhoto({name:r.name}),initial:r.name.split(/\s+/).map(w=>(w[0]||'').toUpperCase()).join('')
    })).join('');
  }

  function renderVendorsBoard({ vendorRows }){
    setView('Vendor Report — Last 45 Days');

    if(!vendorRows || !vendorRows.rows.length){
      headEl.innerHTML = '';
      bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>`;
      return;
    }

    const { rows, totalDeals } = vendorRows;
    const rowsColored = rows.map(r=>({...r, color: colorFor(r.name)}));

    // Donut SVG
    const size=220, cx=size/2, cy=size/2, r=size/2-6;
    let acc=-Math.PI/2;
    const arcs = rowsColored.map(v=>{
      const span = 2*Math.PI*(v.deals/totalDeals);
      const large = span>Math.PI?1:0;
      const p = (a)=>[cx+r*Math.cos(a), cy+r*Math.sin(a)];
      const [x0,y0]=p(acc), [x1,y1]=p(acc+span); acc+=span;
      return `<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}" stroke="${v.color}" stroke-width="26" fill="none"/>`;
    }).join('');

    const svg = `
      <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Vendor share donut">
        ${arcs}
        <circle cx="${cx}" cy="${cy}" r="${r-14}" fill="#0f141c"></circle>
        <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="14" fill="#9fb0c8">Total deals</text>
        <text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${totalDeals.toLocaleString()}</text>
      </svg>
    `;

    headEl.innerHTML = `<tr><th>Vendor</th><th class="right">Deals</th><th class="right">% of total</th><th class="right">Amount</th></tr>`;
    bodyEl.innerHTML = `
      <tr>
        <td colspan="4" style="padding:18px">
          <div class="vendor-flex">
            ${svg}
            <div class="legend">
              ${rowsColored.map(v=>`
                <div class="legend-item">
                  <span><span class="dot" style="background:${v.color}"></span><span class="label">${v.name}</span></span>
                  <span class="val">${v.deals.toLocaleString()} • ${v.share}% • ${fmtMoney(v.amount)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </td>
      </tr>
      ${rowsColored.map(v=>`
        <tr>
          <td><span class="dot" style="background:${v.color}"></span>${v.name}</td>
          <td class="right">${v.deals.toLocaleString()}</td>
          <td class="right" style="color:${v.color}">${v.share}%</td>
          <td class="right">${fmtMoney(v.amount)}</td>
        </tr>
      `).join('')}
    `;
  }

  function renderParBoard({ par }){
    setView('PAR — Tracking');
    const pace=+safe(par?.pace_target,0);
    const agents=Array.isArray(par?.agents)?par.agents:[];
    if(!agents.length){ headEl.innerHTML=''; bodyEl.innerHTML=`<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>`; return; }
    headEl.innerHTML = `<tr><th>Agent</th><th class="right">Take&nbsp;Rate</th><th class="right">Annual&nbsp;AV</th></tr>`;
    bodyEl.innerHTML = `
      ${agents.map(a=>`
        <tr>
          <td>${a.name}</td>
          <td class="right">${safe(a.take_rate,0)}%</td>
          <td class="right">${fmtMoney(safe(a.annual_av,0))}</td>
        </tr>
      `).join('')}
      <tr class="total"><td><strong>PACE TO QUALIFY</strong></td><td></td><td class="right"><strong>${fmtMoney(pace)}</strong></td></tr>
    `;
  }

// --------- Rules (headline rotates every 12 hours, persistent + aligned)
function startRuleRotation(rulesJson) {
  const base = 'THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
  const list = Array.isArray(rulesJson?.rules) && rulesJson.rules.length
    ? rulesJson.rules.filter(Boolean)
    : ['Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.'];

  // Remove any leftover “Rule of the Day” banner if it exists
  const legacyTicker = document.getElementById('ticker');
  if (legacyTicker) legacyTicker.remove();

  // Persistent timing keys
  const LS_BASE = 'few.rules.baseTs';
  const LS_IDX  = 'few.rules.startIndex';

  let baseTs = Number(localStorage.getItem(LS_BASE));
  if (!Number.isFinite(baseTs) || baseTs <= 0) {
    baseTs = Date.now();
    localStorage.setItem(LS_BASE, String(baseTs));
  }

  let startIdx = Number(localStorage.getItem(LS_IDX));
  if (!Number.isFinite(startIdx)) startIdx = 0;

  const SLOT_MS = 12 * 60 * 60 * 1000; // 12 hours

  const apply = () => {
    const elapsed = Math.max(0, Date.now() - baseTs);
    const slots = Math.floor(elapsed / SLOT_MS);
    const i = ((startIdx + slots) % list.length + list.length) % list.length;
    setBanner(base, list[i]);
  };

  apply(); // initial paint
  const msToBoundary = SLOT_MS - ((Date.now() - baseTs) % SLOT_MS);
  setTimeout(() => {
    apply();
    setInterval(apply, SLOT_MS);
  }, msToBoundary);
}
  // ---------- Data load ----------
  const seenLeadIds = new Set();
  async function loadAll(){
    const [rules, roster, calls, sold, ytdList, ytdTotalJson, par] = await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par),
    ]);

    const resolvePhoto = buildHeadshotResolver(roster||[]);

    // Vendor rows
    const vendorRows = vendorSummary(sold?.allSales||[]);

    // Center splash alerts (last 45d, de-duped)
    if(Array.isArray(sold?.allSales)){
      const cutoff = Date.now() - 45*24*3600*1000;
      for(const s of sold.allSales){
        const id = s.leadId || s.id || `${s.agent}-${s.dateSold}-${s.soldProductName}-${s.amount}`;
        const t = Date.parse(s.dateSold||s.date||'');
        if(!seenLeadIds.has(id) && isFinite(t) && t>=cutoff){
          seenLeadIds.add(id);
          showSplash({ name: s.agent || 'Agent', amount: s.amount || 0, soldProductName: s.soldProductName || '' });
        }
      }
    }

    return {
      rules: rules || {rules:[]},
      roster: roster || [],
      calls: calls || {team:{calls:0}, perAgent:[]},
      sold:  sold  || {team:{totalSales:0,totalAV12X:0}, perAgent:[], allSales:[]},
      vendorRows,
      ytdList: ytdList || [],
      ytdTotal: (ytdTotalJson && ytdTotalJson.ytd_av_total) || 0,
      par: par || { pace_target:0, agents:[] },
      resolvePhoto
    };
  }

  // ---------- Rotation (5 boards x 30s) ----------
  function startRotation(data){
    const order = [
      ()=>renderRosterBoard(data),
      ()=>renderYtdBoard(data),
      ()=>renderWeeklyActivity(data),
      ()=>renderVendorsBoard(data),
      ()=>renderParBoard(data),
    ];
    let i=0; const paint=()=>order[i%order.length](); paint(); setInterval(()=>{i++; paint();}, 30_000);
  }

  // ---------- Boot ----------
  (async()=>{
    try{
      const data = await loadAll();
      renderCards(data);
      startRuleRotation(data.rules);
      startRotation(data);
    }catch(err){
      console.error(err);
      setBanner('THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT','Error loading data.');
      bodyEl.innerHTML = `<tr><td style="padding:18px;color:#5c6c82;">Could not load dashboard data.</td></tr>`;
    }
  })();
})();
