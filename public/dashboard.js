/* ========================================================================
   FEW Dashboard — Single File Replacement (public/dashboard.js)
   Last updated: 2025-10-24
   ------------------------------------------------------------------------
   Data sources (already in your project):
     - Weekly sales & AV          : /api/team_sold
     - Weekly calls & activity    : /api/calls_by_agent
     - Vendors last 45 days       : /api/sales_by_vendor  (fallback -> /public/sales_by_vendor.json)
     - Roster + headshots         : /public/headshots/roster.json
     - YTD AV (manual override)   : /public/ytd_av.json   (unused on main cycle; helpers preserved)
     - Rules of the day           : /public/rules.json

   Boards auto-rotate. New sales splash in gold for ~60s. One banner only.
   ======================================================================== */

(function () {
  const ET_TZ = "America/New_York";

  // ===== DOM helpers =====
  const $  = (sel, el=document)=> el.querySelector(sel);
  const $$ = (sel, el=document)=> Array.from(el.querySelectorAll(sel));
  const esc = s => String(s ?? "").replace(/[&<>\"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

  // ===== Formatting =====
  const money = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
  const fmtInt = n => Number(n||0).toLocaleString("en-US");
  const fmtPct = n => (n==null ? "—" : Math.round(n*100).toLocaleString("en-US")+"%");
  const mmss = mins => {
    const m = Math.max(0, Math.floor(Number(mins||0)));
    const h = Math.floor(m/60); const mm = String(m%60).padStart(2,"0");
    return h ? `${h}:${mm}` : `${mm}m`;
  };
  const initialsOf = name => (name||"")
      .split(/\s+/).map(w => w[0]||"").join("").slice(0,2).toUpperCase();

  // ===== Time window (Fri->Fri, ET) =====
  function weekRangeET(now=new Date()){
    const n = new Date(new Date().toLocaleString("en-US",{timeZone:ET_TZ}));
    const day = n.getDay(); // 0 Sun
    const sinceFri = (day+2)%7; // distance to Friday
    const start = new Date(n); start.setHours(0,0,0,0); start.setDate(n.getDate()-sinceFri);
    const end   = new Date(start); end.setDate(start.getDate()+7);
    return { start, end };
  }
  function toUtcStr(d){
    const z = new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return z.toISOString().slice(0,19).replace("T"," ");
  }

  // ===== Fetch helpers (with safe JSON) =====
  async function getJSON(url){
    const r = await fetch(url, {cache:"no-store"});
    if(!r.ok) throw new Error(url+" -> "+r.status);
    return r.json();
  }

  async function loadRoster(){
    try { return await getJSON("/public/headshots/roster.json"); }
    catch(_) { return []; }
  }
  async function loadVendors(){
    try { return await getJSON("/api/sales_by_vendor"); }
    catch(_){
      try { return await getJSON("/public/sales_by_vendor.json"); }
      catch(__){ return { vendors: [] }; }
    }
  }
  async function loadTeamSold(){
    return await getJSON("/api/team_sold"); // {team:{totalSales,totalAmount,totalAV12x}, perAgent:[{name,sales,amount,av12x}], allSales:[{leadId,...,amount,agent,dateSold}]}
  }
  async function loadCalls(){
    return await getJSON("/api/calls_by_agent"); // {team:{calls,talkMin,loggedMin,leads,sold}, perAgent:[{name,email,calls,talkMin,loggedMin,leads,sold}]}
  }

  // ===== State =====
  const state = {
    roster: [],
    sold: null,
    calls: null,
    vendors: null,
    lastSaleId: localStorage.getItem("few:lastSaleId") || "",
    boardIndex: 0,
    boards: ["roster","aotw","vendors","activity"],
    rotateMs: 1000 * 15, // 15s per board
  };

  // ===== Banner (one only) =====
  async function mountRuleOfDay(){
    // remove any legacy banner
    const legacy = $$("div#rule-of-the-day, .rule-of-the-day-legacy");
    legacy.forEach(n => n.remove());

    let rule = "—";
    try {
      const rules = await getJSON("/public/rules.json"); // {rules:["...","..."], as_of: "..."}
      // rotate every 12h based on integer bucket
      const bucket = Math.floor(Date.now()/(12*60*60*1000));
      const idx = rules.rules && rules.rules.length ? bucket % rules.rules.length : 0;
      rule = rules.rules?.[idx] ?? "—";
    } catch(_){ /* keep default */ }

    let bar = $("#rule-banner");
    if(!bar){
      bar = document.createElement("div");
      bar.id = "rule-banner";
      bar.style.cssText = `
        width:100%;padding:10px 12px;margin:0;
        font-weight:700; letter-spacing:.3px;
        background:#0f1115; color:#cfd6ff; text-align:center;
        border-bottom:1px solid rgba(255,255,255,.06);
        position:sticky; top:0; z-index:10;
      `;
      document.body.prepend(bar);
    }
    bar.textContent = `RULE OF THE DAY — ${rule}`;
  }

  // ===== Cards =====
  function setCards({teamCalls, totalAV, totalDeals}){
    const c1 = $("#card-calls");   if (c1) c1.textContent   = fmtInt(teamCalls||0);
    const c2 = $("#card-av");      if (c2) c2.textContent    = money(totalAV||0);
    const c3 = $("#card-deals");   if (c3) c3.textContent    = fmtInt(totalDeals||0);
  }

  // ===== New Sale Splash =====
  function showSaleSplash(name, amount){
    let toast = $("#sale-toast");
    if(!toast){
      toast = document.createElement("div");
      toast.id = "sale-toast";
      toast.style.cssText = `
        position:fixed; left:50%; top:120px; transform:translateX(-50%);
        background:rgba(0,0,0,.65); border:1px solid rgba(255,220,120,.5);
        color:#ffe8a3; padding:16px 20px; border-radius:14px;
        font-weight:800; font-size:20px; text-align:center;
        box-shadow:0 8px 30px rgba(255,220,120,.25);
        backdrop-filter: blur(6px);
        z-index:50;
      `;
      document.body.appendChild(toast);
    }
    toast.innerHTML = `
      <div style="opacity:.9; font-size:14px; margin-bottom:4px">New Sale</div>
      <div style="font-size:22px; margin-bottom:4px">${esc(name)}</div>
      <div style="font-size:18px">${money(amount)} AV (12×)</div>
    `;
    toast.style.display = "block";
    setTimeout(()=> toast.style.display="none", 60_000);
  }

  function detectNewSale(allSales){
    if(!Array.isArray(allSales) || !allSales.length) return;
    const mostRecent = allSales
      .slice()
      .sort((a,b)=> new Date(b.dateSold) - new Date(a.dateSold))[0];

    if(mostRecent && mostRecent.leadId && mostRecent.leadId !== state.lastSaleId){
      state.lastSaleId = mostRecent.leadId;
      localStorage.setItem("few:lastSaleId", state.lastSaleId);
      showSaleSplash(mostRecent.agent || "Agent", mostRecent.amount || 0);
    }
  }

  // ===== Roster board (Weekly Submitted AV) =====
  function renderRosterBoard(){
    setTitle("This Week — Roster");
    const thead = $("#thead"); const tbody = $("#tbody");
    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Submitted AV (12×)</th>
      </tr>`;
    const per = (state.sold?.perAgent || []).slice()
      .sort((a,b)=> (b.amount||0) - (a.amount||0));

    if(!per.length){
      tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">Loading roster or no sales yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = per.map(a=>{
      const head = headshotTag(a.name);
      return `
        <tr>
          <td class="agent">${head}<span>${esc(a.name||"")}</span></td>
          <td class="num">${fmtInt(a.sales||0)}</td>
          <td class="num">${money(a.amount||0)}</td>
        </tr>`;
    }).join("");
  }

  // ===== Agent of the Week =====
  function renderAOTW(){
    setTitle("Agent of the Week");
    const thead = $("#thead"); const tbody = $("#tbody");
    thead.innerHTML = `
      <tr>
        <th>Agent of the Week</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Submitted AV (12×)</th>
      </tr>`;

    const per = (state.sold?.perAgent || []).slice()
      .sort((a,b)=> (b.amount||0)-(a.amount||0));

    if(!per.length){
      tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No leader yet.</td></tr>`;
      return;
    }

    const a = per[0];
    const head = headshotTag(a.name, true);
    tbody.innerHTML = `
      <tr>
        <td class="agent" style="font-size:18px; font-weight:800">
          ${head}
          <div>
            <div>${esc(a.name)}</div>
            <div style="font-size:12px;color:#9eb0d3; font-weight:600">Leading for Agent of the Week</div>
          </div>
        </td>
        <td class="num" style="font-size:18px">${fmtInt(a.sales||0)}</td>
        <td class="num" style="font-size:18px">${money(a.amount||0)}</td>
      </tr>`;
  }

  // ===== Vendors (Last 45 days) =====
  function renderVendors(){
    setTitle("Lead Vendors — % of Sales (Last 45 days)");
    const thead = $("#thead"); const tbody = $("#tbody");
    thead.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th style="text-align:right">Deals</th>
        <th style="text-align:right">% of total</th>
      </tr>`;

    const list = (state.vendors?.vendors||[]).slice();
    const total = list.reduce((s,v)=> s + (v.deals||0), 0);
    if(!total){
      tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`;
      return;
    }

    list.sort((a,b)=> (b.deals||0)-(a.deals||0));
    tbody.innerHTML = list.map(v=>`
      <tr>
        <td>${esc(v.name||"Unknown")}</td>
        <td class="num">${fmtInt(v.deals||0)}</td>
        <td class="num">${fmtPct((v.deals||0)/total)}</td>
      </tr>`).join("");
  }

  // ===== Activity (This week) =====
  function renderActivity(){
    setTitle("Agent Activity — (This week)");
    const thead = $("#thead"); const tbody = $("#tbody");
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

    const rows = (state.calls?.perAgent || []).slice();
    if(!rows.length){
      tbody.innerHTML = `<tr><td colspan="7" style="padding:14px;color:#7b8aa3">No activity reported yet.</td></tr>`;
      return;
    }
    rows.sort((a,b)=> (b.calls||0)-(a.calls||0));

    tbody.innerHTML = rows.map(a=>{
      const conv = (a.leads>0) ? (a.sold||0)/(a.leads||1) : null;
      return `
        <tr>
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

  // ===== Headshot or initials =====
  function headshotTag(name, big=false){
    const person = (state.roster||[]).find(r => (r.name||"").toLowerCase().trim() === (name||"").toLowerCase().trim());
    const size = big ? 44 : 26;
    if(person && person.photo){
      const safe = esc(person.photo);
      return `<img class="avatar" src="/public/headshots/${safe}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;margin-right:10px;vertical-align:middle">`;
    }
    const init = initialsOf(name);
    return `<span class="avatar-fallback" style="
      display:inline-grid;place-items:center; width:${size}px;height:${size}px; border-radius:50%;
      background:#1a2230;color:#9eb0d3; font-weight:800; font-size:${big?14:12}px; margin-right:10px; vertical-align:middle">${init}</span>`;
  }

  // ===== Title & basic table CSS wiring =====
  function setTitle(t){
    const h = $("#board-title");
    if(h) h.textContent = t;
  }

  function injectOnceCSS(){
    if($("#few-css")) return;
    const css = document.createElement("style");
    css.id = "few-css";
    css.textContent = `
      #rule-banner { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; }
      .num { text-align:right; }
      .agent { display:flex; align-items:center; gap:10px; }
      table { width:100%; border-collapse: collapse; }
      th, td { padding:10px 12px; border-bottom: 1px solid rgba(255,255,255,.06); }
      th { color:#a8b3cf; font-weight:700; }
      #board-title { font-weight:800; margin: 6px 0 12px; }
    `;
    document.head.appendChild(css);
  }

  // ===== Board rotation =====
  function renderBoard(){
    const b = state.boards[state.boardIndex % state.boards.length];
    if(b==="roster")   renderRosterBoard();
    if(b==="aotw")     renderAOTW();
    if(b==="vendors")  renderVendors();
    if(b==="activity") renderActivity();
  }

  function startRotation(){
    setInterval(()=>{
      state.boardIndex = (state.boardIndex+1) % state.boards.length;
      renderBoard();
    }, state.rotateMs);
  }

  // ===== Boot =====
  async function boot(){
    injectOnceCSS();
    await mountRuleOfDay();

    // Pre-wire cards to zero (will be set after fetch)
    setCards({teamCalls:0,totalAV:0,totalDeals:0});

    // Load all data in parallel
    const t0 = Date.now();
    const [roster, sold, calls, vendors] = await Promise.all([
      loadRoster().catch(_=>[]),
      loadTeamSold().catch(_=>null),
      loadCalls().catch(_=>null),
      loadVendors().catch(_=>null),
    ]);

    state.roster = roster||[];
    state.sold   = sold;
    state.calls  = calls;
    state.vendors = vendors;

    // Cards
    setCards({
      teamCalls: calls?.team?.calls || 0,
      totalAV  : sold?.team?.totalAV12x || 0,
      totalDeals: sold?.team?.totalSales || 0
    });

    // New sale splash (if any)
    detectNewSale(sold?.allSales || []);

    // First board & rotation
    state.boardIndex = 0;
    renderBoard();
    startRotation();

    // Poll for new sales every 90s (keeps splash + cards fresh)
    setInterval(async()=>{
      try {
        const fresh = await loadTeamSold();
        if(fresh){
          state.sold = fresh;
          setCards({
            teamCalls: state.calls?.team?.calls || 0,
            totalAV  : fresh?.team?.totalAV12x || 0,
            totalDeals: fresh?.team?.totalSales || 0
          });
          detectNewSale(fresh.allSales||[]);
          // If we’re on roster or aotw, rerender
          const b = state.boards[state.boardIndex % state.boards.length];
          if (b==="roster" || b==="aotw") renderBoard();
        }
      } catch(_){}
    }, 90_000);

    // Poll activity every 3 min
    setInterval(async()=>{
      try {
        const fresh = await loadCalls();
        if(fresh){
          state.calls = fresh;
          setCards({
            teamCalls: fresh?.team?.calls || 0,
            totalAV  : state.sold?.team?.totalAV12x || 0,
            totalDeals: state.sold?.team?.totalSales || 0
          });
          const b = state.boards[state.boardIndex % state.boards.length];
          if (b==="activity") renderBoard();
        }
      } catch(_){}
    }, 180_000);
  }

  // ===== Create basic containers if missing (so we never rely on legacy markup) =====
  function ensureShell(){
    if($("#few-shell")) return;
    const wrap = document.createElement("div");
    wrap.id = "few-shell";
    wrap.style.cssText = "max-width:1100px;margin:0 auto;padding:10px 14px 24px;";
    wrap.innerHTML = `
      <h2 id="board-title" style="text-align:left; font-size:18px; color:#dbe4ff;"></h2>
      <div style="display:grid; grid-template-columns: repeat(3,1fr); gap:10px; margin-bottom:14px;">
        <div class="card" style="background:#0f141b; border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:14px;">
          <div style="color:#a8b3cf; font-weight:700; font-size:12px; margin-bottom:6px">This Week — Team Calls</div>
          <div id="card-calls" style="font-weight:800; color:#fff; font-size:22px">0</div>
        </div>
        <div class="card" style="background:#0f141b; border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:14px;">
          <div style="color:#a8b3cf; font-weight:700; font-size:12px; margin-bottom:6px">This Week — Total Submitted AV</div>
          <div id="card-av" style="font-weight:800; color:#fff; font-size:22px">$0</div>
        </div>
        <div class="card" style="background:#0f141b; border:1px solid rgba(255,255,255,.06); border-radius:12px; padding:14px;">
          <div style="color:#a8b3cf; font-weight:700; font-size:12px; margin-bottom:6px">This Week — Deals Submitted</div>
          <div id="card-deals" style="font-weight:800; color:#fff; font-size:22px">0</div>
        </div>
      </div>
      <table>
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
    `;
    document.body.appendChild(wrap);
  }

  // Kick off
  ensureShell();
  boot().catch(e=>{
    console.error("Dashboard boot failed:", e);
    const tbody = $("#tbody");
    if(tbody) tbody.innerHTML = `<tr><td style="padding:14px;color:#f66">Dashboard error: ${esc(e.message||e)}</td></tr>`;
  });

})();
