/* FEW DASHBOARD — CLEAN FINAL BUILD
   Fully functional: metrics cards, 5 rotating boards, vendor donut,
   headshots (Fabricio fix), live gold sale toasts (60s), and 12-hr rules rotation.
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

  // ---------- Utils ----------
  const $ = (sel, root=document) => root.querySelector(sel);
  const fmtMoney = (n) => `$${Math.round(+n || 0).toLocaleString()}`;
  const safe = (v, d=0) => (v == null ? d : v);
  const fetchJSON = async (url) => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) {
      console.warn("fetch fail:", url, e.message);
      return null;
    }
  };

  // ---------- Name Aliases (Fabricio fix) ----------
  const NAME_ALIASES = new Map([
    ['f n','fabricio navarrete cervantes'],
    ['fab','fabricio navarrete cervantes'],
    ['fabricio','fabricio navarrete cervantes'],
    ['fabrico','fabricio navarrete cervantes'],
    ['fabricio navarrete','fabricio navarrete cervantes'],
    ['fabricio cervantes','fabricio navarrete cervantes'],
    ['fabricio navarrete cervantes','fabricio navarrete cervantes'],
  ]);
  const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g,' ');
  const canonicalName = n => NAME_ALIASES.get(norm(n)) || n;

  // ---------- Headshot Resolver ----------
  function buildHeadshotResolver(roster) {
    const byName=new Map(), byEmail=new Map(), byPhone=new Map(), byInitial=new Map();
    const initialsOf = (full='')=>full.trim().split(/\s+/).map(w=>w[0]?.toUpperCase()||'').join('');
    const photoURL = p => !p ? null : (String(p).startsWith('http') || String(p).startsWith('/')) ? p : `/headshots/${p}`;

    for(const p of roster||[]){
      const name=norm(canonicalName(p.name)), email=(p.email||'').trim().toLowerCase(), photo=photoURL(p.photo);
      if(name) byName.set(name,photo);
      if(email) byEmail.set(email,photo);
      if(Array.isArray(p.phones)){
        for(const ph of p.phones){
          const num=String(ph||'').replace(/\D+/g,'');
          if(num) byPhone.set(num,photo);
        }
      }
      const ini=initialsOf(p.name);
      if(ini) byInitial.set(ini,photo);
    }

    return (agent={})=>{
      const name=norm(canonicalName(agent.name)), email=(agent.email||'').trim().toLowerCase();
      const phone=String(agent.phone||'').replace(/\D+/g,''); const ini=initialsOf(agent.name);
      return byName.get(name) ?? byEmail.get(email) ?? (phone?byPhone.get(phone):null) ?? byInitial.get(ini) ?? null;
    };
  }

  // ---------- Elements ----------
  const bannerTitle=$('.banner .title'), bannerSub=$('.banner .subtitle');
  const cards={calls:$('#sumCalls'), av:$('#sumSales'), deals:$('#sumTalk')};
  const headEl=$('#thead'), bodyEl=$('#tbody'), viewLabelEl=$('#viewLabel');
  const setView = label => { if(viewLabelEl) viewLabelEl.textContent = label; };

  // ---------- Sale Alerts ----------
  const alertsRoot=document.createElement('div');
  Object.assign(alertsRoot.style,{
    position:'fixed',right:'24px',bottom:'24px',display:'flex',flexDirection:'column',gap:'8px',zIndex:9999
  });
  document.body.appendChild(alertsRoot);
  const seenIds=new Set();
  function pushAlert({name,soldProductName,amount}){
    const el=document.createElement('div');
    Object.assign(el.style,{
      padding:'14px 18px',borderRadius:'12px',
      background:'linear-gradient(135deg,#9c7b00,#ffd34d)',
      color:'#000',fontWeight:'700',boxShadow:'0 6px 18px rgba(0,0,0,.4)',
      fontSize:'16px',textAlign:'center'
    });
    el.textContent=`${name} • ${soldProductName} • ${fmtMoney(amount)}`;
    alertsRoot.appendChild(el);
    setTimeout(()=>el.remove(),60000);
  }

  // ---------- Vendor Summarizer ----------
  const COLORS=['#FFD34D','#FF9F40','#FF6B6B','#6BCFFF','#7EE787','#B68CFF','#F78DA7','#72D4BA','#E3B341','#9CC2FF'];
  const colorFor = name => COLORS[[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%COLORS.length];
  function summarizeVendors(allSales=[]){
    const cutoff=Date.now()-45*24*3600*1000;
    const map=new Map();
    for(const s of allSales){
      const t=Date.parse(s.dateSold||s.date||''); if(!isFinite(t)||t<cutoff)continue;
      const v=(s.soldProductName||'Unknown').trim(), amt=+s.amount||0;
      const row=map.get(v)||{name:v,deals:0,amount:0};
      row.deals++; row.amount+=amt; map.set(v,row);
    }
    const rows=[...map.values()];
    const total=rows.reduce((a,b)=>a+b.deals,0)||1;
    for(const r of rows){r.share=+(r.deals*100/total).toFixed(1); r.color=colorFor(r.name);}
    rows.sort((a,b)=>b.deals-a.deals||b.amount-a.amount);
    return {rows,total};
  }

  // ---------- Render Helpers ----------
  const agentRowHTML = ({name,right1,right2,photoUrl,initial})=>{
    const avatar = photoUrl
      ? `<img src="${photoUrl}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;margin-right:8px;border:1px solid rgba(255,255,255,.15)">`
      : `<div style="width:26px;height:26px;border-radius:50%;background:#2a2a2a;display:flex;align-items:center;justify-content:center;margin-right:8px;font-size:12px;color:#ccc;border:1px solid rgba(255,255,255,.15)">${initial||'?'}</div>`;
    return `<tr><td style="display:flex;align-items:center">${avatar}${name}</td>
            <td class="right">${right1}</td>${right2!==undefined?`<td class="right">${right2}</td>`:''}</tr>`;
  };

  function renderCards({calls,sold}){
    if(cards.calls) cards.calls.textContent = (safe(calls?.team?.calls)).toLocaleString();
    if(cards.deals) cards.deals.textContent = (safe(sold?.team?.totalSales)).toLocaleString();
    if(cards.av) cards.av.textContent = fmtMoney(safe(sold?.team?.totalAV12X||sold?.team?.totalAv12x));
  }

  // ---------- Boards ----------
  function renderRosterBoard({roster,sold,resolvePhoto}){
    setView('This Week — Submitted AV');
    const per=new Map();
    for(const a of sold?.perAgent||[]){
      per.set(norm(a.name),{av:a.av12x||a.amount||0,deals:a.sales||0});
    }
    const rows=roster.map(p=>{
      const d=per.get(norm(p.name))||{av:0,deals:0};
      const photo=resolvePhoto(p);
      const initials=p.name.split(/\s+/).map(w=>w[0]).join('').toUpperCase();
      return {name:p.name,av:d.av,deals:d.deals,photo,initials};
    }).sort((a,b)=>b.av-a.av);

    headEl.innerHTML=`<tr><th>Agent</th><th class="right">Submitted AV</th><th class="right">Deals</th></tr>`;
    bodyEl.innerHTML=rows.map(r=>agentRowHTML({name:r.name,right1:fmtMoney(r.av),right2:r.deals,photoUrl:r.photo,initial:r.initials})).join('');
  }

  function renderYtdBoard({ytdList,ytdTotal,resolvePhoto}){
    setView('YTD — Team');
    const rows=[...ytdList].sort((a,b)=>b.av-a.av);
    headEl.innerHTML=`<tr><th>Agent</th><th class="right">YTD AV</th></tr>`;
    bodyEl.innerHTML=rows.map(p=>agentRowHTML({
      name:p.name,right1:fmtMoney(p.av),
      photoUrl:resolvePhoto({name:p.name}),initial:p.name.split(/\s+/).map(w=>w[0]).join('')
    })).join('')+`<tr class="total"><td><strong>Total</strong></td><td class="right"><strong>${fmtMoney(ytdTotal)}</strong></td></tr>`;
  }

  function renderWeeklyActivity({calls,sold,resolvePhoto}){
    setView('Weekly Activity');
    const callMap=new Map(calls?.perAgent?.map(a=>[norm(a.name),a.calls||0]));
    const dealMap=new Map(sold?.perAgent?.map(a=>[norm(a.name),a.sales||0]));
    const allNames=new Set([...callMap.keys(),...dealMap.keys()]);
    const rows=[...allNames].map(k=>({
      name:k.replace(/\b\w/g,m=>m.toUpperCase()),
      calls:callMap.get(k)||0,deals:dealMap.get(k)||0
    })).sort((a,b)=>(b.calls+b.deals)-(a.calls+a.deals));
    headEl.innerHTML=`<tr><th>Agent</th><th class="right">Calls</th><th class="right">Deals</th></tr>`;
    bodyEl.innerHTML=rows.map(r=>agentRowHTML({
      name:r.name,right1:r.calls,right2:r.deals,photoUrl:resolvePhoto({name:r.name}),
      initial:r.name.split(/\s+/).map(w=>w[0]).join('')
    })).join('');
  }

  function renderVendorsBoard({sold}){
    setView('Lead Vendors — Last 45 Days');
    const {rows,total}=summarizeVendors(sold?.allSales||[]);
    if(!rows.length){headEl.innerHTML='';bodyEl.innerHTML='<tr><td style="padding:18px;color:#5c6c82;">No vendor data yet.</td></tr>';return;}
    const size=240,cx=size/2,cy=size/2,r=size/2-8,stroke=26;
    const polar=(a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
    const arc=(a0,a1)=>{const large=(a1-a0)>Math.PI?1:0;const[x0,y0]=polar(a0),[x1,y1]=polar(a1);
      return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;};
    let acc=-Math.PI/2;
    const arcs=rows.map(v=>{const span=2*Math.PI*(v.deals/total);const d=arc(acc,acc+span);acc+=span;
      return `<path d="${d}" stroke="${v.color}" stroke-width="${stroke}" fill="none"></path>`;}).join('');
    const svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${arcs}<circle cx="${cx}" cy="${cy}" r="${r-stroke/2-4}" fill="#0f141c"/>
      <text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" fill="#9fb0c8">Total Deals</text>
      <text x="${cx}" y="${cy+18}" text-anchor="middle" font-size="20" font-weight="700" fill="#ffd36a">${total}</text>
    </svg>`;
    headEl.innerHTML=`<tr><th>Vendor</th><th class="right">Deals</th><th class="right">% of total</th></tr>`;
    const legend=rows.map(v=>`<div style="display:flex;justify-content:space-between;padding:4px 0">
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${v.color};margin-right:6px;"></span>${v.name}</div>
      <div>${v.deals} • ${v.share}%</div></div>`).join('');
    bodyEl.innerHTML=`<tr><td colspan="3" style="padding:16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap">${svg}<div>${legend}</div></td></tr>`;
  }

  function renderParBoard({par}){
    setView('PAR — Tracking');
    const pace=safe(par?.pace_target,0);
    const agents=Array.isArray(par?.agents)?par.agents:[];
    if(!agents.length){headEl.innerHTML='';bodyEl.innerHTML='<tr><td style="padding:18px;color:#5c6c82;">No PAR list provided.</td></tr>';return;}
    headEl.innerHTML='<tr><th>Agent</th><th class="right">Take Rate</th><th class="right">Annual AV</th></tr>';
    bodyEl.innerHTML=agents.map(a=>`<tr><td>${a.name}</td><td class="right">${safe(a.take_rate)}%</td><td class="right">${fmtMoney(safe(a.annual_av))}</td></tr>`).join('')
      +`<tr class="total"><td><strong>PACE TO QUALIFY</strong></td><td></td><td class="right"><strong>${fmtMoney(pace)}</strong></td></tr>`;
  }

  // ---------- Rules Rotation (12h) ----------
  function startRuleRotation(rulesJson){
    const base='THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
    if(bannerTitle) bannerTitle.textContent=base;
    const list=Array.isArray(rulesJson?.rules)?rulesJson.rules.filter(Boolean):[];
    if(!bannerSub) return;
    if(!list.length){bannerSub.textContent='Bonus: You are who you hunt with. Everybody wants to eat, but FEW will hunt.';return;}
    let i=0; bannerSub.textContent=list[0];
    setInterval(()=>{i=(i+1)%list.length; bannerSub.textContent=list[i];},12*60*60*1000);
  }

  // ---------- Load + Rotation ----------
  async function loadAll(){
    const [rules,roster,calls,sold,ytdList,ytdTotal,par]=await Promise.all([
      fetchJSON(ENDPOINTS.rules),
      fetchJSON(ENDPOINTS.roster),
      fetchJSON(ENDPOINTS.callsByAgent),
      fetchJSON(ENDPOINTS.teamSold),
      fetchJSON(ENDPOINTS.ytdAv),
      fetchJSON(ENDPOINTS.ytdTotal),
      fetchJSON(ENDPOINTS.par)
    ]);
    const resolvePhoto=buildHeadshotResolver(roster||[]);
    if(Array.isArray(sold?.allSales)){
      for(const s of sold.allSales){
        const id=s.leadId||s.id||`${s.agent}-${s.dateSold}-${s.soldProductName}-${s.amount}`;
        if(!seenIds.has(id)){
          seenIds.add(id);
          const t=Date.parse(s.dateSold||s.date||'');
          if(isFinite(t)&&(Date.now()-t)<=45*24*3600*1000){
            pushAlert({name:s.agent||'Agent',soldProductName:s.soldProductName||'Sale',amount:s.amount||0});
          }
        }
      }
    }
    return {rules,roster,calls,sold,ytdList:ytdList||[],ytdTotal:safe(ytdTotal?.ytd_av_total),par,resolvePhoto};
  }

  function startBoardRotation(data){
    const order=[
      ()=>renderRosterBoard(data),
      ()=>renderYtdBoard(data),
      ()=>renderWeeklyActivity(data),
      ()=>renderVendorsBoard(data),
      ()=>renderParBoard(data)
    ];
    let i=0; order[0]();
    setInterval(()=>{i=(i+1)%order.length; order[i]();},30000);
  }

  // ---------- Boot ----------
  (async()=>{
    try{
      const data=await loadAll();
      renderCards(data);
      startRuleRotation(data.rules);
      startBoardRotation(data);
    }catch(e){
      console.error(e);
      if(bannerTitle) bannerTitle.textContent='THE FEW — EVERYONE WANTS TO EAT BUT FEW WILL HUNT';
      if(bannerSub) bannerSub.textContent='Error loading data.';
    }
  })();

})();
