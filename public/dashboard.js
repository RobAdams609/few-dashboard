/* ======================= FEW Dashboard — One-File Fix ======================= */
"use strict";

/* ------------------------------ Config ------------------------------------ */
const ET_TZ        = "America/New_York";
const ROTATE_MS    = 30_000;                        // rotate every 30s
const VIEWS        = ["roster","av","aotw","vendors","ytd"];
const QS           = new URLSearchParams(location.search);
const VIEW_OVERRIDE= (QS.get("view") || "").toLowerCase();

/* ------------------------------ Tiny DOM ---------------------------------- */
const $  = s => document.querySelector(s);
const byId = id => document.getElementById(id);
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ------------------------------ Utils ------------------------------------- */
async function getJSON(pathOrUrl){
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${pathOrUrl}?v=${Date.now()}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${pathOrUrl} ${r.status}`);
  return r.json();
}
const money = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const fmtInt = n => Number(n||0).toLocaleString("en-US");
const initialsOf = name => (name||"").trim().split(/\s+/).map(w => w[0]||"").join("").slice(0,2).toUpperCase();

/* Map images: { emailLower -> photoFilename } and also keep a people list by email */
async function loadHeadshotsMap(){
  try{
    const raw = await getJSON("/headshots/roster.json");
    const list = Array.isArray(raw) ? raw : (raw?.agents || []);
    const map = new Map();
    const people = new Map(); // emailLower -> {name,email,photo}
    for (const a of list){
      const email = (a?.email || "").toLowerCase().trim();
      const photo = a?.photo || "";
      if (email) map.set(email, photo), people.set(email, { name: a?.name||"", email, photo });
    }
    return { map, people };
  }catch(e){
    console.warn("headshots load failed:", e.message);
    return { map:new Map(), people:new Map() };
  }
}

/* -------------------------- Summary Cards --------------------------------- */
function setSummary({ calls, teamAV12x, deals }){
  const sumCalls = byId("sumCalls");
  const sumSales = byId("sumSales");   // Total Submitted AV (12x)
  const sumTalk  = byId("sumTalk");    // Deals Submitted

  if (sumCalls) sumCalls.textContent = fmtInt(calls ?? 0);
  if (sumSales) sumSales.textContent = money(teamAV12x ?? 0);
  if (sumTalk)  sumTalk.textContent  = fmtInt(deals ?? 0);
}

/* ----------------------------- Renderers ---------------------------------- */
function renderTableHeader(cols){
  const thead = byId("thead");
  if (!thead) return;
  thead.innerHTML = `<tr>${cols.map(c => `<th${c.right?` style="text-align:right"`:""}>${c.title}</th>`).join("")}</tr>`;
}
function setBodyHtml(html){
  const tbody = byId("tbody");
  if (!tbody) return;
  tbody.innerHTML = html || `<tr><td colspan="10" style="padding:14px;color:#7b8aa3">No data found.</td></tr>`;
}
function errRow(msg){
  return `<tr><td colspan="10" style="padding:14px;color:#f66">${escapeHtml(msg)}</td></tr>`;
}

/* ---- View: This Week — Roster (from /api/team_sold) ---------------------- */
async function viewRoster(shared){
  const { sold } = shared;
  renderTableHeader([
    { title:"Agent" },
    { title:"Sold", right:true },
    { title:"Submitted AV (12x)", right:true },
  ]);
  const rows = (sold?.perAgent || []).map(a => `
    <tr>
      <td class="agent">
        <span class="avatar-fallback">${initialsOf(a.name)}</span>
        <span>${escapeHtml(a.name || "")}</span>
      </td>
      <td class="num">${fmtInt(a.sales||0)}</td>
      <td class="num">${money(a.av12x||0)}</td>
    </tr>
  `).join("");
  setBodyHtml(rows);
}

/* ---- View: Leaderboard (Submitted AV) ------------------------------------ */
async function viewAV(shared){
  const list = (shared?.sold?.perAgent || [])
    .map(a => ({ name:a.name||"", av12x:Number(a.av12x||0) }))
    .sort((a,b)=> b.av12x - a.av12x);

  renderTableHeader([
    { title:"Agent" },
    { title:"Submitted AV (12x)", right:true },
  ]);
  const rows = list.map(a => `
    <tr>
      <td class="agent"><span class="avatar-fallback">${initialsOf(a.name)}</span><span>${escapeHtml(a.name)}</span></td>
      <td class="num">${money(a.av12x)}</td>
    </tr>
  `).join("");
  setBodyHtml(rows);
}

/* ---- View: Agent of the Week -------------------------------------------- */
async function viewAOTW(shared){
  const top = (shared?.sold?.perAgent || [])
    .slice()
    .sort((a,b)=> Number(b.av12x||0) - Number(a.av12x||0))[0];

  renderTableHeader([
    { title:"Agent of the Week" },
    { title:"Submitted AV (12x)", right:true },
  ]);
  if (!top){
    return setBodyHtml(`<tr><td colspan="2" style="padding:14px;color:#7b8aa3">No results yet this week.</td></tr>`);
  }
  const row = `
    <tr>
      <td class="agent">
        <span class="avatar-fallback">${initialsOf(top.name)}</span>
        <span>${escapeHtml(top.name||"")}</span>
      </td>
      <td class="num">${money(top.av12x||0)}</td>
    </tr>
  `;
  setBodyHtml(row);
}

/* ---- View: Lead Vendors (image fallback) --------------------------------- */
async function viewVendors(){
  renderTableHeader([{ title:"Lead Vendors — % of Sales (Last 45 days)" }]);
  const img = new Image();
  img.src = "/sales_by_vendor.png?v=" + Date.now();
  img.alt = "Lead Vendor Breakdown";
  img.style.maxWidth = "100%";
  img.style.display = "block";
  const tbody = byId("tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td style="padding:10px"><div id="vendor_img_holder"></div></td></tr>`;
  byId("vendor_img_holder").appendChild(img);
  img.onerror = () => { setBodyHtml(`<tr><td style="padding:14px;color:#7b8aa3">No vendor chart available.</td></tr>`); };
}

/* ---- View: YTD Leaders (join by email to headshots) ---------------------- */
async function viewYTD(shared){
  const { headshotsMap } = shared;
  let ytd = [];
  try { ytd = await getJSON("/ytd_av.json"); }
  catch(e){ return setBodyHtml(errRow("YTD load error: " + e.message)); }

  renderTableHeader([
    { title:"Agent" },
    { title:"YTD AV (12x)", right:true },
  ]);

  const rows = (ytd || []).map(a => {
    const name  = a.name || "";
    const email = (a.email || "").toLowerCase().trim();
    const avatar = initialsOf(name);
    // optional: if you later want to show <img>, you can resolve headshotsMap.map.get(email)
    return `
      <tr>
        <td class="agent"><span class="avatar-fallback">${avatar}</span><span>${escapeHtml(name)}</span></td>
        <td class="num">${money(a.av||0)}</td>
      </tr>
    `;
  }).join("");

  setBodyHtml(rows);
}

/* ------------------------------- Boot ------------------------------------- */
(async function initDashboard(){
  try{
    // parallel fetches
    const [sold, calls, headshots] = await Promise.all([
      getJSON("/api/team_sold"),
      // calls API may be empty; guard below
      getJSON("/api/calls_by_agent").catch(()=>({team:{calls:0}})),
      loadHeadshotsMap(),
    ]);

    // Summary cards
    setSummary({
      calls:   Number(calls?.team?.calls || 0),
      teamAV12x: Number(sold?.team?.totalAV12x || 0),
      deals:   Number(sold?.team?.totalSales || 0),
    });

    // View router
    const shared = { sold, calls, headshotsMap: headshots };
    let viewIdx = 0;
    const views = {
      roster:  () => viewRoster(shared),
      av:      () => viewAV(shared),
      aotw:    () => viewAOTW(shared),
      vendors: () => viewVendors(shared),
      ytd:     () => viewYTD(shared),
    };

    const order = VIEW_OVERRIDE && VIEWS.includes(VIEW_OVERRIDE) ? [VIEW_OVERRIDE] : VIEWS.slice();

    async function renderCurrent(){
      const key = order[viewIdx % order.length];
      // title subtitle if you use them (optional — safe if missing)
      const titleEl = byId("pageTitle");
      if (titleEl) titleEl.textContent = ({
        roster: "This Week — Roster",
        av:     "This Week — Leaderboard (Submitted AV)",
        aotw:   "Agent of the Week",
        vendors:"Lead Vendors — % of Sales (Last 45 days)",
        ytd:    "YTD — Leaders",
      })[key] || "Dashboard";

      const tbody = byId("tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding:14px;color:#7b8aa3">Loading...</td></tr>`;

      try{
        await views[key]();
      }catch(e){
        setBodyHtml(errRow(`Render error (${key}): ${e.message}`));
        console.error(e);
      }
    }

    // first render + rotate (unless a single view is forced)
    await renderCurrent();
    if (order.length > 1){
      setInterval(()=>{ viewIdx = (viewIdx+1) % order.length; renderCurrent(); }, ROTATE_MS);
    }
  }catch(e){
    console.error(e);
    setBodyHtml(errRow("Dashboard failed to load: " + e.message));
    setSummary({ calls:0, teamAV12x:0, deals:0 });
  }
})();
