/* ========================================================================
   FEW Dashboard — Single File Replacement (public/dashboard.js)
   One banner. One dashboard. No duplicates.
   ======================================================================== */
(function () {
  const ET_TZ = "America/New_York";
  const $  = (s,el=document)=>el.querySelector(s);
  const $$ = (s,el=document)=>Array.from(el.querySelectorAll(s));
  const esc = s=>String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const money = n=>"$"+Math.round(Number(n||0)).toLocaleString("en-US");
  const fmtInt = n=>Number(n||0).toLocaleString("en-US");
  const fmtPct = n=>n==null?"—":Math.round(n*100).toLocaleString("en-US")+"%";
  const mmss  = mins=>{const m=Math.max(0,Math.floor(Number(mins||0)));const h=Math.floor(m/60),mm=String(m%60).padStart(2,"0");return h?`${h}:${mm}`:`${mm}m`;};
  const initials = name=>(name||"").split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();

  async function getJSON(url){const r=await fetch(url,{cache:"no-store"});if(!r.ok) throw new Error(url+" -> "+r.status);return r.json();}

  // --------- State
  const state = {
    roster: [],
    sold: null,
    calls: null,
    vendors: null,
    lastSaleId: localStorage.getItem("few:lastSaleId")||"",
    boardIndex: 0,
    boards: ["roster","aotw","vendors","activity"],
    rotateMs: 15000,
  };

  // --------- Make it ONE dashboard: hide legacy blocks automatically
  function isolatePageOnce(){
    if ($("#few-isolate-css")) return;
    // Try to keep the countdown if found by text
    const maybeCountdown = $$("body *").find(n => /OE\s*Countdown/i.test(n.textContent||""));
    if (maybeCountdown) maybeCountdown.setAttribute("data-keep","");
    const css = document.createElement("style");
    css.id = "few-isolate-css";
    css.textContent = `
      /* Keep ONLY our banner, our shell, and an optional countdown we tagged. */
      body > *:not(#rule-banner):not(#few-shell):not([data-keep]) { display: none !important; }
    `;
    document.head.appendChild(css);
  }

  // --------- One banner (12h rotation)
  async function mountRuleOfDay(){
    // remove any legacy rule banners
    $$("div#rule-of-the-day, .rule-of-the-day-legacy").forEach(n=>n.remove());
    let rule = "—";
    try{
      const rules = await getJSON("/public/rules.json"); // {rules:[...]}
      const bucket = Math.floor(Date.now()/(12*60*60*1000));
      const idx = (rules.rules?.length||0) ? bucket % rules.rules.length : 0;
      rule = rules.rules?.[idx] ?? "—";
    }catch(_) {}
    let bar = $("#rule-banner");
    if(!bar){
      bar = document.createElement("div");
      bar.id="rule-banner";
      bar.style.cssText = "width:100%;padding:10px 12px;margin:0;font-weight:700;letter-spacing:.3px;background:#0f1115;color:#cfd6ff;text-align:center;border-bottom:1px solid rgba(255,255,255,.06);position:sticky;top:0;z-index:10;";
      document.body.prepend(bar);
    }
    bar.textContent = `RULE OF THE DAY — ${rule}`;
  }

  // --------- Containers + CSS
  function ensureShell(){
    if ($("#few-css")){
      if (!$("#few-shell")) injectShell();
      return;
    }
    const css = document.createElement("style");
    css.id="few-css";
    css.textContent=`
      .num{text-align:right}
      .agent{display:flex;align-items:center;gap:10px}
      table{width:100%;border-collapse:collapse}
      th,td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
      th{color:#a8b3cf;font-weight:700}
      #board-title{font-weight:800;margin:6px 0 12px}
    `;
    document.head.appendChild(css);
    injectShell();
  }
  function injectShell(){
    const wrap = document.createElement("div");
    wrap.id="few-shell";
    wrap.style.cssText="max-width:1100px;margin:0 auto;padding:10px 14px 24px;";
    wrap.innerHTML=`
      <h2 id="board-title" style="text-align:left;font-size:18px;color:#dbe4ff;"></h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
        <div class="card" style="background:#0f141b;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px;">
          <div style="color:#a8b3cf;font-weight:700;font-size:12px;margin-bottom:6px">This Week — Team Calls</div>
          <div id="card-calls" style="font-weight:800;color:#fff;font-size:22px">0</div>
        </div>
        <div class="card" style="background:#0f141b;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px;">
          <div style="color:#a8b3cf;font-weight:700;font-size:12px;margin-bottom:6px">This Week — Total Submitted AV</div>
          <div id="card-av" style="font-weight:800;color:#fff;font-size:22px">$0</div>
        </div>
        <div class="card" style="background:#0f141b;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px;">
          <div style="color:#a8b3cf;font-weight:700;font-size:12px;margin-bottom:6px">This Week — Deals Submitted</div>
          <div id="card-deals" style="font-weight:800;color:#fff;font-size:22px">0</div>
        </div>
      </div>
      <table>
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
    `;
    document.body.appendChild(wrap);
  }

  function setTitle(t){const h=$("#board-title"); if(h) h.textContent=t;}
  function setCards({teamCalls,totalAV,totalDeals}){
    const c1=$("#card-calls"); if(c1) c1.textContent=fmtInt(teamCalls||0);
    const c2=$("#card-av");   if(c2) c2.textContent =money(totalAV||0);
    const c3=$("#card-deals");if(c3) c3.textContent =fmtInt(totalDeals||0);
  }

  // --------- Data
  async function loadRoster(){try{return await getJSON("/public/headshots/roster.json");}catch(_){return [];}}
  async function loadVendors(){
    try{return await getJSON("/api/sales_by_vendor");}
    catch(_){try{return await getJSON("/public/sales_by_vendor.json");}catch(__){return {vendors:[]};}}
  }
  async function loadTeamSold(){return await getJSON("/api/team_sold");}
  async function loadCalls(){return await getJSON("/api/calls_by_agent");}

  // --------- Sale splash
  function showSaleSplash(name,amount){
    let t=$("#sale-toast");
    if(!t){
      t=document.createElement("div");
      t.id="sale-toast";
      t.style.cssText="position:fixed;left:50%;top:120px;transform:translateX(-50%);background:rgba(0,0,0,.65);border:1px solid rgba(255,220,120,.5);color:#ffe8a3;padding:16px 20px;border-radius:14px;font-weight:800;font-size:20px;text-align:center;box-shadow:0 8px 30px rgba(255,220,120,.25);backdrop-filter:blur(6px);z-index:50;";
      document.body.appendChild(t);
    }
    t.innerHTML=`<div style="opacity:.9;font-size:14px;margin-bottom:4px">New Sale</div>
                 <div style="font-size:22px;margin-bottom:4px">${esc(name||"")}</div>
                 <div style="font-size:18px">${money(amount||0)} AV (12×)</div>`;
    t.style.display="block";
    setTimeout(()=>t.style.display="none",60_000);
  }
  function detectNewSale(allSales){
    if(!Array.isArray(allSales)||!allSales.length) return;
    const mostRecent=allSales.slice().sort((a,b)=>new Date(b.dateSold)-new Date(a.dateSold))[0];
    if(mostRecent?.leadId && mostRecent.leadId!==state.lastSaleId){
      state.lastSaleId=mostRecent.leadId;
      localStorage.setItem("few:lastSaleId",state.lastSaleId);
      showSaleSplash(mostRecent.agent||"Agent",mostRecent.amount||0);
    }
  }

  // --------- Headshots
  function headshotTag(name,big=false){
    const match=(state.roster||[]).find(r=>(r.name||"").toLowerCase().trim()===(name||"").toLowerCase().trim());
    const size=big?44:26;
    if(match?.photo){
      const p=esc(match.photo);
      return `<img class="avatar" src="/public/headshots/${p}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;margin-right:10px;vertical-align:middle">`;
    }
    return `<span class="avatar-fallback" style="display:inline-grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:#1a2230;color:#9eb0d3;font-weight:800;font-size:${big?14:12}px;margin-right:10px;vertical-align:middle">${initials(name)}</span>`;
  }

  // --------- Boards
  function renderRoster(){
    setTitle("This Week — Roster");
    const th=$("#thead"), tb=$("#tbody");
    th.innerHTML=`<tr><th>Agent</th><th style="text-align:right">Sold</th><th style="text-align:right">Submitted AV (12×)</th></tr>`;
    const per=(state.sold?.perAgent||[]).slice().sort((a,b)=>(b.amount||0)-(a.amount||0));
    if(!per.length){tb.innerHTML=`<tr><td colspan="3" style="padding:14px;color:#7b8aa3">Loading roster or no sales yet.</td></tr>`;return;}
    tb.innerHTML=per.map(a=>`
      <tr>
        <td class="agent">${headshotTag(a.name)}<span>${esc(a.name||"")}</span></td>
        <td class="num">${fmtInt(a.sales||0)}</td>
        <td class="num">${money(a.amount||0)}</td>
      </tr>`).join("");
  }
  function renderAOTW(){
    setTitle("Agent of the Week");
    const th=$("#thead"), tb=$("#tbody");
    th.innerHTML=`<tr><th>Agent of the Week</th><th style="text-align:right">Sold</th><th style="text-align:right">Submitted AV (12×)</th></tr>`;
    const per=(state.sold?.perAgent||[]).slice().sort((a,b)=>(b.amount||0)-(a.amount||0));
    if(!per.length){tb.innerHTML=`<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No leader yet.</td></tr>`;return;}
    const a=per[0];
    tb.innerHTML=`
      <tr>
        <td class="agent" style="font-size:18px;font-weight:800">${headshotTag(a.name,true)}
          <div><div>${esc(a.name)}</div><div style="font-size:12px;color:#9eb0d3;font-weight:600">Leading for Agent of the Week</div></div>
        </td>
        <td class="num" style="font-size:18px">${fmtInt(a.sales||0)}</td>
        <td class="num" style="font-size:18px">${money(a.amount||0)}</td>
      </tr>`;
  }
  function renderVendors(){
    setTitle("Lead Vendors — % of Sales (Last 45 days)");
    const th=$("#thead"), tb=$("#tbody");
    th.innerHTML=`<tr><th>Vendor</th><th style="text-align:right">Deals</th><th style="text-align:right">% of total</th></tr>`;
    const list=(state.vendors?.vendors||[]).slice(); const total=list.reduce((s,v)=>s+(v.deals||0),0);
    if(!total){tb.innerHTML=`<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`;return;}
    list.sort((a,b)=>(b.deals||0)-(a.deals||0));
    tb.innerHTML=list.map(v=>`
      <tr><td>${esc(v.name||"Unknown")}</td><td class="num">${fmtInt(v.deals||0)}</td><td class="num">${fmtPct((v.deals||0)/total)}</td></tr>`
    ).join("");
  }
  function renderActivity(){
    setTitle("Agent Activity — (This week)");
    const th=$("#thead"), tb=$("#tbody");
    th.innerHTML=`<tr>
      <th>Agent</th><th style="text-align:right">Calls</th><th style="text-align:right">Talk (min)</th>
      <th style="text-align:right">Logged (h:mm)</th><th style="text-align:right">Leads</th>
      <th style="text-align:right">Sold</th><th style="text-align:right">Conv %</th></tr>`;
    const rows=(state.calls?.perAgent||[]).slice();
    if(!rows.length){tb.innerHTML=`<tr><td colspan="7" style="padding:14px;color:#7b8aa3">No activity reported yet.</td></tr>`;return;}
    rows.sort((a,b)=>(b.calls||0)-(a.calls||0));
    tb.innerHTML=rows.map(a=>{
      const conv=(a.leads>0)?(a.sold||0)/(a.leads||1):null;
      return `<tr>
        <td class="agent">${headshotTag(a.name)}<span>${esc(a.name||"")}</span></td>
        <td class="num">${fmtInt(a.calls||0)}</td>
        <td class="num">${fmtInt(a.talkMin||0)}</td>
        <td class="num">${mmss(a.loggedMin||0)}</td>
        <td class="num">${fmtInt(a.leads||0)}</td>
        <td class="num">${fmtInt(a.sold||0)}</td>
        <td class="num">${fmtPct(conv)}</td>
      </tr>`;
    }).join("");
  }

  function renderBoard(){
    const b=state.boards[state.boardIndex%state.boards.length];
    if(b==="roster") renderRoster();
    if(b==="aotw")   renderAOTW();
    if(b==="vendors")renderVendors();
    if(b==="activity")renderActivity();
  }

  function startRotation(){
    setInterval(()=>{state.boardIndex=(state.boardIndex+1)%state.boards.length;renderBoard();}, state.rotateMs);
  }

  async function boot(){
    isolatePageOnce();
    await mountRuleOfDay();
    ensureShell();
    setCards({teamCalls:0,totalAV:0,totalDeals:0});

    const [roster, sold, calls, vendors] = await Promise.all([
      loadRoster().catch(_=>[]),
      loadTeamSold().catch(_=>null),
      loadCalls().catch(_=>null),
      loadVendors().catch(_=>null),
    ]);

    state.roster=roster||[]; state.sold=sold; state.calls=calls; state.vendors=vendors;

    setCards({
      teamCalls: calls?.team?.calls||0,
      totalAV  : sold?.team?.totalAV12x||0,
      totalDeals: sold?.team?.totalSales||0
    });

    detectNewSale(sold?.allSales||[]);
    state.boardIndex=0;
    renderBoard();
    startRotation();

    // Poll updates
    setInterval(async()=>{
      try{
        const fresh=await loadTeamSold();
        state.sold=fresh;
        setCards({teamCalls: state.calls?.team?.calls||0, totalAV:fresh?.team?.totalAV12x||0, totalDeals:fresh?.team?.totalSales||0});
        const b=state.boards[state.boardIndex%state.boards.length];
        if(b==="roster"||b==="aotw") renderBoard();
        detectNewSale(fresh?.allSales||[]);
      }catch(_){}
    }, 90_000);

    setInterval(async()=>{
      try{
        const fresh=await loadCalls();
        state.calls=fresh;
        setCards({teamCalls: fresh?.team?.calls||0, totalAV: state.sold?.team?.totalAV12x||0, totalDeals: state.sold?.team?.totalSales||0});
        const b=state.boards[state.boardIndex%state.boards.length];
        if(b==="activity") renderBoard();
      }catch(_){}
    }, 180_000);
  }

  boot().catch(e=>{
    console.error(e);
    const tb=$("#tbody"); if(tb) tb.innerHTML=`<tr><td style="padding:14px;color:#f66">Dashboard error: ${esc(e.message||e)}</td></tr>`;
  });
})();
