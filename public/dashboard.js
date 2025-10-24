/* public/dashboard.js  — COMPLETE REPLACEMENT
   Rotates 4 boards:
   1) Weekly Submitted AV (roster)
   2) Agent of the Week (leader)
   3) Lead Vendors — % of Sales (last 45 days)
   4) Agent Activity (calls/talk/logged/leads/sold)

   Data sources (API first; static fallback):
   - /api/team_sold           -> /ytd_total.json  (fallback only used for sums)
   - /api/calls_by_agent      -> /calls_week_override.json (if present) else no rows
   - /api/sales_by_vendor     -> /sales_by_vendor.json
   - /headshots/roster.json   (names, emails, photos)
   - /ytd_av.json + /ytd_total.json (only for the YTD board if you decide to add it)
   - /rules.json              (array of rule strings)
*/

(async function boot(){
  /* ---------- utils ---------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const money = n => {
    const v = Number(n||0);
    return v.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
  };
  const fmtInt = n => Number(n||0).toLocaleString("en-US");
  const pct = x => `${Math.round(x*100)}%`;
  const wait = ms => new Promise(r=>setTimeout(r,ms));
  const nowISO = () => new Date().toISOString();

  async function loadJSON(url){
    const r = await fetch(url, {cache:"no-store"});
    if (!r.ok) throw new Error(url+" "+r.status);
    return r.json();
  }
  async function tryFirst(primary, fallback){
    try { return await loadJSON(primary); }
    catch{ if (fallback) return await loadJSON(fallback); throw new Error("Both failed: "+primary+" & "+fallback); }
  }

  /* ---------- DOM handles ---------- */
  const thead = $("#thead");
  const tbody = $("#tbody");
  const sumCalls = $("#sumCalls");
  const sumSales = $("#sumSales");
  const sumTalk  = $("#sumTalk"); // used as “Deals”
  const viewLabel = $("#viewLabel");
  const salePop = $("#salePop");
  const ticker = $("#ticker");

  /* ---------- rule of the day (every 12h) ---------- */
  (async function rulesTicker(){
    try{
      const rules = await tryFirst("/rules.json");
      const idx = Math.floor(Date.now() / (12*60*60*1000)) % rules.length;
      ticker.textContent = "RULE OF THE DAY — " + rules[idx];
    }catch{ ticker.textContent = "RULE OF THE DAY — …"; }
  })();

  /* ---------- headshots map ---------- */
  let photoByName = new Map();
  try{
    const roster = await tryFirst("/headshots/roster.json");
    roster.forEach(r=>{
      if (r?.name && r?.photo) photoByName.set(r.name.trim().toLowerCase(), "/headshots/"+r.photo);
    });
  }catch{}

  function avatarCell(name){
    const key = (name||"").trim().toLowerCase();
    const url = photoByName.get(key);
    if (url){
      return `<span class="agent"><img class="avatar" src="${url}" alt="" loading="lazy" /> <span>${escapeHtml(name||"")}</span></span>`;
    }
    // initials fallback
    const initials = (name||"").split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
    return `<span class="agent"><span class="avatar-fallback">${escapeHtml(initials||"?")}</span> <span>${escapeHtml(name||"")}</span></span>`;
  }

  function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }

  /* ---------- DATA FETCHERS ---------- */
  async function fetchTeamSold(){
    // API returns { startDate, endDate, team:{totalSales,totalAmount,totalAV12x}, perAgent:[{name,sales,amount,av12x}], allSales:[...] }
    // Fallback: empty
    try { return await loadJSON("/api/team_sold?ts="+Date.now()); }
    catch { return { startDate:null,endDate:null,team:{totalSales:0,totalAmount:0,totalAV12x:0}, perAgent:[], allSales:[] }; }
  }

  async function fetchCalls(){
    // API returns { startDate,endDate, team:{calls,talkMin,loggedMin,leads,sold}, perAgent:[{name,email,calls,talkMin,loggedMin,leads,sold}] }
    // Fallback to optional override json if provided
    try { return await loadJSON("/api/calls_by_agent?ts="+Date.now()); }
    catch {
      try { return await loadJSON("/calls_week_override.json"); }
      catch { return { startDate:null,endDate:null, team:{calls:0,talkMin:0,loggedMin:0,leads:0,sold:0}, perAgent:[] }; }
    }
  }

  async function fetchVendors(){
    // Prefer API; fallback to static
    try { return await loadJSON("/api/sales_by_vendor?ts="+Date.now()); }
    catch { return await loadJSON("/sales_by_vendor.json"); }
  }

  /* ---------- SUMMARY CARDS UPDATE ---------- */
  function updateSummary({calls, totalAV12x, deals}){
    if (typeof calls === "number") sumCalls.textContent = fmtInt(calls);
    if (typeof totalAV12x === "number") sumSales.textContent = money(totalAV12x);
    if (typeof deals === "number") sumTalk.textContent = fmtInt(deals);
  }

  /* ---------- BOARD RENDERERS ---------- */

  // 1) Weekly Submitted AV (roster)
  function viewRosterWeekly(sold){
    setTitle("This Week — Roster");
    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Submitted AV (12×)</th>
      </tr>`;
    const list = (sold.perAgent||[]).slice().sort((a,b)=> (b.amount||0) - (a.amount||0));
    if (!list.length){
      tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8ba3">Loading roster or no sales yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(a=>`
      <tr>
        <td>${avatarCell(a.name)}</td>
        <td class="num">${fmtInt(a.sales||0)}</td>
        <td class="num">${money(a.av12x||0)}</td>
      </tr>
    `).join("");
  }

  // 2) Agent of the Week (leader)
  function viewAgentOfWeek(sold){
    setTitle("Agent of the Week");
    const list = (sold.perAgent||[]).slice().sort((a,b)=> (b.av12x||0) - (a.av12x||0));
    thead.innerHTML = `
      <tr>
        <th>Leading for Agent of the Week</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Submitted AV (12×)</th>
      </tr>`;
    if (!list.length){
      tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8ba3">No leader yet.</td></tr>`;
      return;
    }
    const top = list[0];
    tbody.innerHTML = `
      <tr>
        <td style="font-size:16px;font-weight:700">${avatarCell(top.name)}</td>
        <td class="num" style="font-size:18px;font-weight:800">${fmtInt(top.sales||0)}</td>
        <td class="num" style="font-size:18px;font-weight:800">${money(top.av12x||0)}</td>
      </tr>
    `;
  }

  // 3) Lead Vendors — % of Sales (last 45 days) — inline SVG donut
  function viewVendors(vendorData){
    setTitle("Lead Vendors — % of Sales (Last 45 days)");
    thead.innerHTML = `<tr><th>Vendor</th><th style="text-align:right">Deals</th><th style="text-align:right">% of total</th></tr>`;
    const list = (vendorData?.vendors||[]).slice();
    const total = list.reduce((s,v)=> s + (v.deals||0), 0);
    if (!total){
      tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8ba3">No vendor chart available.</td></tr>`;
      return;
    }

    // build table rows
    const rows = list
      .sort((a,b)=>(b.deals||0)-(a.deals||0))
      .map(v=>`
        <tr>
          <td>${escapeHtml(v.name||"Unknown")}</td>
          <td class="num">${fmtInt(v.deals||0)}</td>
          <td class="num">${pct((v.deals||0)/total)}</td>
        </tr>
      `).join("");

    // donut svg
    const R = 32, C=40, STROKE=10, GAP=1.5;
    let acc = 0;
    const arcs = list.map((v,i)=>{
      const frac = (v.deals||0)/total;
      const len = 2*Math.PI*R*frac;
      const dash = `${len} ${2*Math.PI*R - len}`;
      const rot = (acc*360) - 90; acc += frac;
      const hue = (i*63)%360;
      return `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="hsl(${hue} 90% 60%)" stroke-width="${STROKE}"
        stroke-dasharray="${dash}" transform="rotate(${rot} ${C} ${C})" stroke-linecap="butt" />`;
    }).join("");

    const donut = `
      <tr>
        <td colspan="3" style="padding:10px 10px 0">
          <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
            <svg width="80" height="80" viewBox="0 0 80 80" role="img" aria-label="Vendor split donut">
              <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#1a2535" stroke-width="${STROKE}"/>
              ${arcs}
            </svg>
            <div style="flex:1;min-width:240px">
              <table style="width:100%"><tbody>${rows}</tbody></table>
            </div>
          </div>
        </td>
      </tr>`;

    tbody.innerHTML = donut;
  }

  // 4) Agent Activity (calls/talk/logged/leads/sold merged with sold report)
  function viewActivity(calls, sold){
    setTitle("Agent Activity — (This week)");
    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th style="text-align:right">Calls</th>
        <th style="text-align:right">Talk (min)</th>
        <th style="text-align:right">Logged (h:mm)</th>
        <th style="text-align:right">Leads</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Conv %</th>
      </tr>`;

    const soldByName = new Map((sold.perAgent||[]).map(a=>[String(a.name||"").toLowerCase(), a]));
    const list = (calls.perAgent||[]).slice();

    if (!list.length){
      // still show team totals even if perAgent is empty
      const t = calls.team || {};
      tbody.innerHTML = `
        <tr><td colspan="7" style="padding:14px;color:#7b8ba3">No activity reported yet.</td></tr>
        <tr>
          <td style="font-weight:700;color:#9fb0c8">Team totals:</td>
          <td class="num">${fmtInt(t.calls||0)}</td>
          <td class="num">${fmtInt(t.talkMin||0)}</td>
          <td class="num">${fmtHMM(t.loggedMin||0)}</td>
          <td class="num">${fmtInt(t.leads||0)}</td>
          <td class="num">${fmtInt(t.sold||0)}</td>
          <td class="num">${t.leads ? pct((t.sold||0)/t.leads) : "0%"}</td>
        </tr>`;
      return;
    }

    const rows = list
      .map(a=>{
        const soldA = soldByName.get(String(a.name||"").toLowerCase());
        const soldCnt = soldA?.sales || 0;
        const conv = a.leads ? (soldCnt / a.leads) : 0;
        return `
          <tr>
            <td>${avatarCell(a.name)}</td>
            <td class="num">${fmtInt(a.calls||0)}</td>
            <td class="num">${fmtInt(a.talkMin||0)}</td>
            <td class="num">${fmtHMM(a.loggedMin||0)}</td>
            <td class="num">${fmtInt(a.leads||0)}</td>
            <td class="num">${fmtInt(soldCnt)}</td>
            <td class="num">${pct(conv||0)}</td>
          </tr>`;
      }).join("");

    tbody.innerHTML = rows;
  }

  function fmtHMM(mins){
    const m = Math.max(0, Math.round(mins||0));
    const h = Math.floor(m/60); const mm = String(m%60).padStart(2,"0");
    return `${h}:${mm}`;
  }

  function setTitle(txt){
    if (viewLabel) viewLabel.textContent = txt;
  }

  /* ---------- SALE SPLASH (poll team_sold) ---------- */
  let lastSeenSaleIds = new Set();
  function splashSale(s){
    if (!s) return;
    salePop.innerHTML = `
      <div style="font-size:12px;opacity:.9">New Sale</div>
      <div style="font-size:18px;font-weight:800">${escapeHtml(s.agent||"")}</div>
      <div style="font-size:14px;margin-top:4px">${money((s.amount||0)*12)} AV (12×)</div>`;
    salePop.classList.add("show");
    setTimeout(()=> salePop.classList.remove("show"), 60000); // hold 60s
  }

  async function pollSales(){
    try{
      const data = await fetchTeamSold();
      const all = data.allSales || [];
      all.forEach(s=>{
        if (!lastSeenSaleIds.has(s.leadId)){
          lastSeenSaleIds.add(s.leadId);
          splashSale(s);
        }
      });
      // cap set
      if (lastSeenSaleIds.size > 500) {
        lastSeenSaleIds = new Set(Array.from(lastSeenSaleIds).slice(-250));
      }
    }catch{}
  }

  /* ---------- ROTATION ENGINE ---------- */
  const VIEWS = [
    "roster",  // Weekly Submitted AV
    "aow",     // Agent of the Week
    "vendors", // Vendor donut
    "activity" // Agent Activity
  ];
  let idx=0;
  async function renderCurrent(){
    // load everything we need for all four views in parallel
    const [sold, calls, vendors] = await Promise.all([
      fetchTeamSold(),
      fetchCalls(),
      fetchVendors(),
    ]);

    // update summary cards from the freshest data we have
    updateSummary({
      calls: calls.team?.calls ?? 0,
      totalAV12x: sold.team?.totalAV12x ?? 0,
      deals: sold.team?.totalSales ?? 0,
    });

    const view = VIEWS[idx % VIEWS.length];
    if (view==="roster")   viewRosterWeekly(sold);
    if (view==="aow")      viewAgentOfWeek(sold);
    if (view==="vendors")  viewVendors(vendors);
    if (view==="activity") viewActivity(calls, sold);
  }

  async function loop(){
    while(true){
      try { await renderCurrent(); }
      catch(e){
        console.error(e);
        thead.innerHTML = "";
        tbody.innerHTML = `<tr><td style="padding:14px;color:#f66">Error: ${escapeHtml(e.message||e)}</td></tr>`;
      }
      idx = (idx+1) % VIEWS.length;
      await wait(15000); // 15s per board; adjust if you want
    }
  }

  // First render & start sale polling
  await renderCurrent();
  loop();
  setInterval(pollSales, 30000); // poll sales every 30s
})();
