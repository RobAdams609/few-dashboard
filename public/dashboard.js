/* public/dashboard.js
   FEW Dashboard — full replacement (rotation + boards + sale splash + rule-of-day)

   EXPECTS these endpoints/files to exist:
   - /api/team_sold                         -> weekly sales, perAgent + allSales
   - /api/calls_by_agent                    -> weekly call/talk/logged/leads/sold per agent (uses Ringy keys on Netlify)
   - /public/headshots/roster.json          -> [{ name, email, photo, phones? }]  photo file in /public/headshots/
   - /public/rules.json                     -> { "rules":[ "Rule A", "Rule B", ... ] }
   - /public/ytd_av.json & /public/ytd_total.json
       ytd_av.json:    [{ name, email, av }]
       ytd_total.json: { total: number }
   - VENDOR SOURCE (pick 1, the code will try API then fallback to static):
       /api/sales_by_vendor  (preferred) -> { vendors:[{name, deals}], window_days: 45, as_of: "YYYY-MM-DD" }
       /public/sales_by_vendor.json      -> same shape
   - NEW manual override (optional):
       /public/par.json -> { "year": 2025, "entries":[
            { "name":"Robert Adams", "issuedAV":597236 },
            { "name":"Fabricio Navarrete Cervantes", "issuedAV":657760 },
            ...
         ]}

   NOTES:
   - Rotation order is configurable below (ROTATION array).
   - “Sale splash” holds for 60s, shows Agent + Submitted AV (no “×12” badge).
   - Donut chart is canvas-based, no external libs.
*/

(function () {
  // ========== CONFIG ==========
  const ROTATE_MS = 25000;                   // board rotation interval
  const SALE_SPLASH_MS = 60000;              // 60s hold
  const TIMEZONE = "America/New_York";
  const SHOW_YTD_BOARD = true;
  const SHOW_PAR_BOARD = true;

  // Endpoints
  const ENDPOINTS = {
    TEAM_SOLD: "/api/team_sold",
    CALLS_BY_AGENT: "/api/calls_by_agent",
    SALES_BY_VENDOR_API: "/api/sales_by_vendor",
    SALES_BY_VENDOR_STATIC: "/public/sales_by_vendor.json",
    ROSTER: "/public/headshots/roster.json",
    RULES: "/public/rules.json",
    YTD_AV: "/public/ytd_av.json",
    YTD_TOTAL: "/public/ytd_total.json",
    PAR: "/public/par.json"
  };

  // Rotation — set exactly what you want to show & in what order.
  // (I’ve enabled 6 boards per your last note. Remove any you don’t want.)
  const ROTATION = [
    "weeklyRoster",
    "agentOfWeek",
    "vendors",
    "agentActivity",
    ...(SHOW_YTD_BOARD ? ["ytdBoard"] : []),
    ...(SHOW_PAR_BOARD ? ["parBoard"] : []),
  ];

  // ========== DOM refs ==========
  const $ = (sel) => document.querySelector(sel);
  const thead = $("#thead");
  const tbody = $("#tbody");

  // top summary cards
  const sumCalls = $("#sumCalls");
  const sumSales = $("#sumSales");
  const sumTalk  = $("#sumTalk"); // used for "deals submitted"

  const viewLabel = $("#viewLabel");
  const ticker = $("#ticker");             // top RULE OF THE DAY — …
  const principle = $("#principle");       // subtitle (bonus line)
  const salePop = $("#salePop");

  // ========== utils ==========
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const now = () => new Date();

  const fmtInt  = (v) => Number(v||0).toLocaleString("en-US");
  const money   = (n) => "$" + Number(n||0).toLocaleString("en-US");

  const pad2 = (n) => String(n).padStart(2, "0");

  function toETDateString(d) {
    try {
      const dt = new Date(d);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      }).format(dt);
    } catch {
      return String(d || "");
    }
  }

  async function fetchJSON(url) {
    const u = url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    const r = await fetch(u, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.json();
  }

  function initialsFrom(name="") {
    return (name||"")
      .split(/\s+/)
      .filter(Boolean)
      .map(s => s[0])
      .slice(0,2)
      .join("")
      .toUpperCase();
  }

  // Load roster for headshots
  let ROSTER = [];             // [{name,email,photo,...}]
  let HEADSHOT_BY_NAME = new Map();
  async function ensureRoster() {
    if (ROSTER.length) return;
    try {
      ROSTER = await fetchJSON(ENDPOINTS.ROSTER);
      for (const r of ROSTER) {
        HEADSHOT_BY_NAME.set((r.name||"").trim().toLowerCase(), r.photo || null);
      }
    } catch (e) {
      console.error("roster load error:", e);
      ROSTER = [];
    }
  }

  function avatarCell(name) {
    const photo = HEADSHOT_BY_NAME.get((name||"").trim().toLowerCase());
    if (photo) {
      return `<img class="avatar" src="/public/headshots/${photo}" alt="${name}" />`;
    }
    return `<span class="avatar-fallback">${initialsFrom(name)}</span>`;
  }

  // ========== Rule of the day (rotate every 12h) ==========
  let RULES = [];
  async function loadRules() {
    try {
      const data = await fetchJSON(ENDPOINTS.RULES);
      RULES = Array.isArray(data.rules) ? data.rules : [];
    } catch (e) {
      console.warn("rules.json missing or invalid:", e);
      RULES = [];
    }
  }

  function setRuleOfDay() {
    if (!RULES.length) {
      ticker.textContent = "RULE OF THE DAY — …";
      return;
    }
    // pick rule based on 12-hour buckets
    const hours = Math.floor(Date.now() / (12 * 60 * 60 * 1000));
    const idx = hours % RULES.length;
    ticker.textContent = `RULE OF THE DAY — ${RULES[idx]}`;
  }

  // re-evaluate every minute to catch the 12h boundary without reloading
  setInterval(setRuleOfDay, 60_000);

  // ========== Shared caches from APIs ==========
  let CACHED_SOLD = null;          // data from /api/team_sold
  let CACHED_CALLS = null;         // data from /api/calls_by_agent
  let LAST_SALE_IDS = new Set();   // to detect brand-new allSales entries

  async function loadTeamSold() {
    CACHED_SOLD = await fetchJSON(ENDPOINTS.TEAM_SOLD);
    // summary cards
    const teamDeals = CACHED_SOLD?.team?.totalSales || 0;
    const teamAV12x = CACHED_SOLD?.team?.totalAV12x || 0;

    sumCalls.textContent = fmtInt(CACHED_CALLS?.team?.calls || 0); // may be 0 until calls loaded
    sumSales.textContent = money(teamAV12x);
    sumTalk.textContent  = fmtInt(teamDeals);
  }

  async function loadCallsByAgent() {
    CACHED_CALLS = await fetchJSON(ENDPOINTS.CALLS_BY_AGENT);
    sumCalls.textContent = fmtInt(CACHED_CALLS?.team?.calls || 0);
  }

  // ========== Views ==========

  function setTitle(label){
    viewLabel.textContent = label;
  }

  // 1) Weekly Submitted AV — Roster
  async function viewWeeklyRoster(){
    setTitle("This Week — Roster");

    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Submitted AV</th>
      </tr>`;

    if (!CACHED_SOLD) await loadTeamSold();

    const rows = (CACHED_SOLD?.perAgent || [])
      .map(a => {
        return `<tr>
          <td class="agent">${avatarCell(a.name)}<span>${a.name||""}</span></td>
          <td class="num">${fmtInt(a.sales||0)}</td>
          <td class="num">${money(a.av12x||0)}</td>
        </tr>`;
      }).join("");

    tbody.innerHTML = rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa5">Loading roster or no sales yet.</td></tr>`;
  }

  // 2) Agent of the Week — big headshot, name, deals, weekly AV + YTD AV
  async function viewAgentOfWeek(){
    setTitle("Agent of the Week");

    thead.innerHTML = `
      <tr>
        <th>Leading for Agent of the Week</th>
        <th style="text-align:right">Sold</th>
        <th style="text-align:right">Submitted AV</th>
      </tr>`;

    if (!CACHED_SOLD) await loadTeamSold();
    await ensureRoster();

    const list = (CACHED_SOLD?.perAgent || []);
    if (!list.length){
      tbody.innerHTML = `<tr><td colspan="3" style="padding:14px;color:#7b8aa5">No leader yet.</td></tr>`;
      return;
    }
    // pick by weekly AV
    const leader = [...list].sort((a,b)=> (b.av12x||0)-(a.av12x||0))[0];

    // YTD lookup
    let ytdAV = null;
    try {
      const ytdList = await fetchJSON(ENDPOINTS.YTD_AV);
      const match = ytdList.find(x => (x.name||"").trim().toLowerCase() === (leader.name||"").trim().toLowerCase());
      ytdAV = match?.av || null;
    } catch {}

    // Big header row
    tbody.innerHTML = `
      <tr>
        <td class="agent" style="padding-top:16px;padding-bottom:16px">
          <div style="display:flex;align-items:center;gap:18px;">
            ${bigAvatar(leader.name)}
            <div>
              <div style="font-weight:800;font-size:28px;">${leader.name||""}</div>
              <div style="font-size:13px;color:#9fb0c8;">${ytdAV!=null ? `YTD AV: <strong style="color:#ffd36a">${money(ytdAV)}</strong>` : ""}</div>
            </div>
          </div>
        </td>
        <td class="num" style="font-size:22px;font-weight:800">${fmtInt(leader.sales||0)}</td>
        <td class="num" style="font-size:22px;font-weight:800">${money(leader.av12x||0)}</td>
      </tr>`;

    function bigAvatar(name){
      const photo = HEADSHOT_BY_NAME.get((name||"").trim().toLowerCase());
      if (photo) {
        return `<img src="/public/headshots/${photo}" alt="${name}"
                 style="width:84px;height:84px;border-radius:50%;object-fit:cover;box-shadow:0 8px 26px rgba(0,0,0,.35);" />`;
      }
      return `<span class="avatar-fallback" style="width:84px;height:84px;font-size:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#152131;color:#8fb3ff;box-shadow:0 8px 26px rgba(0,0,0,.35);">${initialsFrom(name)}</span>`;
    }
  }

  // 3) Lead Vendors — % of Sales (Last 45 days) with donut
  async function viewVendors(){
    setTitle("Lead Vendors — % of Sales (Last 45 days)");
    thead.innerHTML = `
      <tr>
        <th>Vendor</th>
        <th style="text-align:right">Deals</th>
        <th style="text-align:right">% of total</th>
      </tr>`;

    // Try API then static fallback
    let data = null;
    try {
      data = await fetchJSON(ENDPOINTS.SALES_BY_VENDOR_API);
    } catch {
      try { data = await fetchJSON(ENDPOINTS.SALES_BY_VENDOR_STATIC); } catch {}
    }

    const list = Array.isArray(data?.vendors) ? data.vendors : [];
    const total = list.reduce((s,v)=> s + (v.deals||0), 0);

    // Donut on the left (inject a full-row canvas)
    const CANVAS_ID = "vendorDonut";
    const donutRow = `<tr><td colspan="3">
      <div style="display:flex;gap:20px;align-items:center;min-height:220px;">
        <canvas id="${CANVAS_ID}" width="220" height="220" style="max-width:220px"></canvas>
        <div id="vendorLegend" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
      </div>
    </td></tr>`;

    // Table rows
    const rows = list.map((v,i)=>{
      const pct = total ? Math.round((v.deals||0)*100/total) : 0;
      return `<tr data-vendor="${i}">
        <td>${escapeHtml(v.name||"Unknown")}</td>
        <td class="num">${fmtInt(v.deals||0)}</td>
        <td class="num">${pct}%</td>
      </tr>`;
    }).join("");

    tbody.innerHTML = donutRow + (rows || `<tr><td colspan="3" style="padding:14px;color:#7b8aa5">No vendor chart available.</td></tr>`);

    // draw donut if we have data
    if (list.length && total) drawDonut(CANVAS_ID, list, total);

    function drawDonut(id, list, total){
      const el = document.getElementById(id);
      if (!el) return;
      const ctx = el.getContext("2d");
      const centerX = el.width/2, centerY = el.height/2;
      const radius = Math.min(centerX, centerY)-8;
      const inner = radius * 0.62;

      const colors = palette(list.length);
      let start = -Math.PI/2;
      list.forEach((v, i)=>{
        const frac = (v.deals||0)/total;
        const end = start + frac * Math.PI*2;
        // slice
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = colors[i];
        ctx.fill();

        start = end;
      });

      // hole
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(centerX, centerY, inner, 0, Math.PI*2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      // legend
      const legend = $("#vendorLegend");
      legend.innerHTML = list.map((v,i)=> {
        const pct = total ? Math.round((v.deals||0)*100/total):0;
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0b0f15;border:1px solid #253041;border-radius:10px;">
          <span style="width:12px;height:12px;border-radius:3px;background:${colors[i]}"></span>
          <span style="color:#cfd7e3">${escapeHtml(v.name||"Unknown")}</span>
          <span style="color:#9fb0c8;font-weight:700;margin-left:6px">${fmtInt(v.deals||0)}</span>
          <span style="color:#9fb0c8;margin-left:6px">${pct}%</span>
        </div>`;
      }).join("");
    }

    function palette(n){
      const base = [
        "#ffd36a","#7dd3fc","#a78bfa","#60f0b2","#fb7185",
        "#fbbf24","#34d399","#93c5fd","#f472b6","#f59e0b",
        "#4ade80","#818cf8","#22c55e","#c084fc","#38bdf8"
      ];
      if (n <= base.length) return base.slice(0,n);
      // repeat if more than base length
      const out = [];
      while (out.length < n) out.push(...base);
      return out.slice(0,n);
    }
  }

  // 4) Agent Activity (calls, talk, logged, leads, sold, conv%)
  async function viewAgentActivity(){
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

    if (!CACHED_CALLS) await loadCallsByAgent();

    const list = CACHED_CALLS?.perAgent || [];
    if (!list.length){
      tbody.innerHTML = `<tr><td colspan="7" style="padding:14px;color:#7b8aa5">No activity reported yet.</td></tr>`;
      return;
    }

    const totals = { calls:0, talkMin:0, loggedMin:0, leads:0, sold:0 };
    const rows = list.map(a=>{
      const conv = (a.leads>0) ? Math.round((a.sold||0)*100/(a.leads||0)) : 0;
      totals.calls += a.calls||0;
      totals.talkMin += a.talkMin||0;
      totals.loggedMin += a.loggedMin||0;
      totals.leads += a.leads||0;
      totals.sold += a.sold||0;

      return `<tr>
        <td class="agent">${avatarCell(a.name)}<span>${a.name||""}</span></td>
        <td class="num">${fmtInt(a.calls||0)}</td>
        <td class="num">${fmtInt(a.talkMin||0)}</td>
        <td class="num">${fmtHM(a.loggedMin||0)}</td>
        <td class="num">${fmtInt(a.leads||0)}</td>
        <td class="num">${fmtInt(a.sold||0)}</td>
        <td class="num">${fmtInt(conv)}%</td>
      </tr>`;
    }).join("");

    const foot = `<tr>
      <td style="font-weight:700;color:#9fb0c8">Team totals:</td>
      <td class="num">${fmtInt(totals.calls)}</td>
      <td class="num">${fmtInt(totals.talkMin)}</td>
      <td class="num">${fmtHM(totals.loggedMin)}</td>
      <td class="num">${fmtInt(totals.leads)}</td>
      <td class="num">${fmtInt(totals.sold)}</td>
      <td class="num">${ totals.leads ? Math.round(totals.sold*100/totals.leads) : 0 }%</td>
    </tr>`;

    tbody.innerHTML = rows + foot;

    function fmtHM(min){
      min = Math.max(0, Number(min||0));
      const h = Math.floor(min/60), m = min%60;
      return `${h}:${pad2(m)}`;
    }
  }

  // 5) YTD Board — manual override files
  async function viewYTD(){
    setTitle("YTD AV — Manual Override");

    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th style="text-align:right">YTD AV</th>
      </tr>`;

    let list = [];
    try { list = await fetchJSON(ENDPOINTS.YTD_AV); } catch {}
    if (!list.length){
      tbody.innerHTML = `<tr><td colspan="2" style="padding:14px;color:#7b8aa5">No YTD override available.</td></tr>`;
      return;
    }
    list.sort((a,b)=> (b.av||0) - (a.av||0));
    await ensureRoster();

    const rows = list.map(a=> `
      <tr>
        <td class="agent">${avatarCell(a.name)}<span>${a.name||""}</span></td>
        <td class="num">${money(a.av||0)}</td>
      </tr>
    `).join("");

    tbody.innerHTML = rows;
  }

  // 6) PAR Board — manual override
  async function viewPAR(){
    setTitle("PAR — Personal Production Qualifiers (Manual)");

    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th style="text-align:right">Issued AV</th>
      </tr>`;

    let data = null;
    try { data = await fetchJSON(ENDPOINTS.PAR); } catch {}
    const list = Array.isArray(data?.entries) ? data.entries : [];
    if (!list.length){
      tbody.innerHTML = `<tr><td colspan="2" style="padding:14px;color:#7b8aa5">No PAR entries found.</td></tr>`;
      return;
    }
    await ensureRoster();

    const rows = list.map(e => `
      <tr>
        <td class="agent">${avatarCell(e.name)}<span>${e.name||""}</span></td>
        <td class="num">${money(e.issuedAV||0)}</td>
      </tr>`).join("");

    tbody.innerHTML = rows;
  }

  // ========== Sale splash ==========
  // A gold banner shows new sale for 60s: "Agent Name — $AV"
  let splashTimer = null;
  async function checkNewSalesAndSplash(){
    if (!CACHED_SOLD) return;
    const items = CACHED_SOLD.allSales || [];
    if (!items.length) return;

    for (const s of items) {
      const id = (s.leadId || s.id || `${s.agent}-${s.amount}-${s.dateSold}`); // robust-ish key
      if (LAST_SALE_IDS.has(id)) continue;
      LAST_SALE_IDS.add(id);

      // show splash
      const av = s.amount || 0;           // IMPORTANT: show submitted AV (no ×12 text)
      const who = s.agent || "New Sale";
      showSaleSplash(who, av);

      // update summary cards right away (avoid waiting next poll)
      try{ sumTalk.textContent = fmtInt((CACHED_SOLD?.team?.totalSales||0)); } catch{}
    }
  }

  function showSaleSplash(agent, av){
    if (!salePop) return;
    salePop.innerHTML = `
      <div style="display:flex;gap:12px;align-items:baseline;">
        <div style="font-size:13px;font-weight:800;color:#ffe59e;letter-spacing:.04em;text-transform:uppercase">New Sale</div>
        <div style="font-size:22px;font-weight:900;color:#fff4cf;text-shadow:0 0 18px rgba(255,200,50,.45)">${escapeHtml(agent)}</div>
        <div style="font-size:16px;font-weight:800;color:#ffe59e">${money(av)}</div>
      </div>`;
    salePop.classList.add("show");

    clearTimeout(splashTimer);
    splashTimer = setTimeout(()=> salePop.classList.remove("show"), SALE_SPLASH_MS);
  }

  // ========== Rotation controller ==========
  let rotIndex = 0;

  const VIEW_MAP = {
    weeklyRoster: viewWeeklyRoster,
    agentOfWeek:  viewAgentOfWeek,
    vendors:      viewVendors,
    agentActivity:viewAgentActivity,
    ytdBoard:     viewYTD,
    parBoard:     viewPAR,
  };

  async function renderCurrent(){
    const key = ROTATION[rotIndex % ROTATION.length];
    const fn = VIEW_MAP[key];
    if (!fn) return;
    try { await fn(); } catch (e) {
      console.error("render error:", key, e);
      tbody.innerHTML = `<tr><td colspan="7" style="padding:14px;color:#ff9595">Error loading board: ${escapeHtml(String(e.message||e))}</td></tr>`;
    }
  }

  async function rotate(){
    rotIndex++;
    await renderCurrent();
  }

  // ========== bootstrap ==========
  async function boot(){
    try { await loadRules(); } catch{}
    setRuleOfDay();

    await ensureRoster();

    // pre-load calls & sold (in parallel)
    await Promise.allSettled([ loadCallsByAgent(), loadTeamSold() ]);

    // seed last sales to avoid replaying old ones
    (CACHED_SOLD?.allSales||[]).forEach(s=>{
      const id = (s.leadId || s.id || `${s.agent}-${s.amount}-${s.dateSold}`);
      LAST_SALE_IDS.add(id);
    });

    // initial render
    rotIndex = 0;
    await renderCurrent();

    // rotation heartbeat
    setInterval(rotate, ROTATE_MS);

    // poll for fresh team_sold every 20s and splash new sales
    setInterval(async ()=>{
      try{
        await loadTeamSold();
        await checkNewSalesAndSplash();
      }catch(e){ console.warn("team_sold poll error:", e); }
    }, 20000);

    // refresh calls_by_agent every 60s
    setInterval(async ()=>{
      try{
        await loadCallsByAgent();
      }catch(e){ console.warn("calls_by_agent poll error:", e); }
    }, 60000);
  }

  // small escape util
  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  boot();
})();
