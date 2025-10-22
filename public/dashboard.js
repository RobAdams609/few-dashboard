/* ================= FEW Dashboard — Single File (Rotation + Headshots + Live) ================= */
"use strict";

/* ---------------- Config you can tweak ---------------- */
const ET_TZ = "America/New_York";
const ROTATE_MS = 30_000;                  // rotate views every 30s
const POLL_MS   = 30_000;                  // refresh data every 30s
const VIEWS     = ["roster", "aow", "leaderboard", "vendors"];  // rotation sequence

/* ---------------- Tiny DOM / format helpers ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const byId = (...ids) => ids.map(id=>document.getElementById(id)).find(Boolean) || null;

const escapeHtml = s => String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const money = n => "$" + Math.round(Number(n||0)).toLocaleString("en-US");
const toET  = d => new Date(new Date(d||Date.now()).toLocaleString("en-US",{ timeZone:ET_TZ }));
const initialsOf = (name="") => name.trim().split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
const norm = (s="") => String(s).toLowerCase().replace(/[^a-z]/g,"").trim();

/* ---------------- Net ---------------- */
async function getJSON(url){
  try{
    const r = await fetch(url + (url.includes("?")?"&":"?") + "ts="+Date.now(), { cache:"no-store" });
    if(!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  }catch(e){
    console.warn("getJSON failed:", url, e.message||e);
    return null;
  }
}

/* ---------------- Headshots ---------------- */
let ROSTER = [];                 // raw roster records
let PHOTO_BY_EMAIL = new Map();  // normalizedEmail -> record
let PHOTO_BY_NAME  = new Map();  // normalizedName  -> record
let PHOTO_BY_INIT  = new Map();  // initials        -> record

async function loadRoster(){
  const raw = await getJSON("/headshots/roster.json");
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.agents) ? raw.agents : []);
  ROSTER = list;

  PHOTO_BY_EMAIL.clear(); PHOTO_BY_NAME.clear(); PHOTO_BY_INIT.clear();
  for(const r of list){
    const nm = norm(r.name||"");
    const em = norm(r.email||"");
    const ini = initialsOf(r.name||"");
    if (em) PHOTO_BY_EMAIL.set(em, r);
    if (nm) PHOTO_BY_NAME.set(nm, r);
    if (ini) PHOTO_BY_INIT.set(ini, r);
  }
}

function findRosterRecord(name="", email=""){
  // Try email → exact name → initials (handles roster entries like “A S”, “F N”)
  const em = norm(email);
  if (em && PHOTO_BY_EMAIL.has(em)) return PHOTO_BY_EMAIL.get(em);
  const nm = norm(name);
  if (nm && PHOTO_BY_NAME.has(nm))  return PHOTO_BY_NAME.get(nm);
  const ini = initialsOf(name||"");
  if (ini && PHOTO_BY_INIT.has(ini)) return PHOTO_BY_INIT.get(ini);
  return null;
}

function avatarHTML(name, email){
  const rec = findRosterRecord(name, email);
  const initials = initialsOf(name);
  if (!rec || !rec.photo){
    return `<span class="avatar-fallback">${initials}</span>`;
  }
  // cache-bust with ?v=1 so stale 404s don’t stick
  const src = `/headshots/${rec.photo}?v=1`;
  return `
    <img class="avatar" src="${src}"
         onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';"
         alt="${escapeHtml(name)}"/>
    <span class="avatar-fallback" style="display:none">${initials}</span>`;
}

/* ---------------- Weekly merge (fixes missing agents) ---------------- */
function mergePerAgentWithAllSales(sold){
  if(!sold) return sold;
  const byName = new Map();

  (sold.perAgent||[]).forEach(a=>{
    byName.set(a.name, {
      name: a.name,
      email: a.email || "",
      sales: Number(a.sales||0),
      av12x: Number(a.av12x || a.amount || 0)
    });
  });

  (sold.allSales||[]).forEach(x=>{
    const name = x.agent || x.agentName || "";
    if (!name) return;
    const cur = byName.get(name) || { name, email: x.agentEmail||"", sales:0, av12x:0 };
    cur.sales += 1;
    cur.av12x += Number(x.av12x || x.amount || 0);
    byName.set(name, cur);
  });

  const merged = Array.from(byName.values()).sort((a,b)=> (b.av12x||0)-(a.av12x||0));
  sold.perAgent = merged;
  sold.team = sold.team || {};
  sold.team.totalAV12x = merged.reduce((s,a)=>s+(a.av12x||0),0);
  sold.team.totalSales = merged.reduce((s,a)=>s+(a.sales||0),0);
  return sold;
}

/* ---------------- Vendors last 45 days ---------------- */
function vendorsFromAllSales(sold){
  const cutoff = Date.now() - 45*24*3600*1000;
  const m = new Map();
  for(const x of (sold?.allSales||[])){
    const when = new Date(x.dateSold || x.soldAt || 0).getTime();
    if (!(when>0 && when>=cutoff)) continue;
    const v = (x.leadVendor || x.vendor || x.source || x.soldProductSource || "Unknown").trim() || "Unknown";
    m.set(v, (m.get(v)||0) + 1);
  }
  return Array.from(m, ([vendor,count])=>({vendor,count})).sort((a,b)=>b.count-a.count);
}

/* ---------------- Render helpers ---------------- */
function setCards({calls=0, av12x=0, deals=0}){
  const sumCalls = byId("sumCalls");
  const sumSales = byId("sumSales");
  const sumDeals = byId("sumDeals");
  if (sumCalls) sumCalls.textContent = String(calls||0);
  if (sumSales) sumSales.textContent = money(av12x||0);
  if (sumDeals) sumDeals.textContent = String(deals||0);
}

function setTable(headHTML, bodyHTML){
  const thead = byId("thead","rosterHead"); if (thead) thead.innerHTML = headHTML;
  const tbody = byId("tbody","rosterBody"); if (tbody) tbody.innerHTML = bodyHTML;
}

/* ----- Views ----- */
function renderRoster(sold){
  setCards({ calls: 0, av12x: sold?.team?.totalAV12x||0, deals: sold?.team?.totalSales||0 });
  const head = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;
  const rows = (sold?.perAgent||[]).map(a=>`
    <tr>
      <td class="agent">${avatarHTML(a.name, a.email||"")}<span>${escapeHtml(a.name||"")}</span></td>
      <td class="num">${(a.sales||0).toLocaleString("en-US")}</td>
      <td class="num">${money(a.av12x||0)}</td>
    </tr>`).join("") || `<tr><td colspan="3" class="muted">No sales found.</td></tr>`;
  setTable(head, rows);
}

function renderAOW(sold){
  setCards({ calls: 0, av12x: sold?.team?.totalAV12x||0, deals: sold?.team?.totalSales||0 });
  const top = (sold?.perAgent||[])[0];
  const head = `
    <tr>
      <th>Agent of the Week</th>
      <th style="text-align:right">Sold</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;
  const body = top ? `
    <tr>
      <td class="agent">${avatarHTML(top.name, top.email||"")}<span>${escapeHtml(top.name)}</span></td>
      <td class="num">${(top.sales||0).toLocaleString("en-US")}</td>
      <td class="num">${money(top.av12x||0)}</td>
    </tr>` : `<tr><td colspan="3" class="muted">No data this week.</td></tr>`;
  setTable(head, body);
}

function renderLeaderboard(sold){
  setCards({ calls: 0, av12x: sold?.team?.totalAV12x||0, deals: sold?.team?.totalSales||0 });
  const head = `
    <tr>
      <th>Agent</th>
      <th style="text-align:right">Submitted AV (12x)</th>
    </tr>`;
  const body = (sold?.perAgent||[]).slice().sort((a,b)=>(b.av12x||0)-(a.av12x||0))
    .map(a=>`
      <tr>
        <td class="agent">${avatarHTML(a.name, a.email||"")}<span>${escapeHtml(a.name||"")}</span></td>
        <td class="num">${money(a.av12x||0)}</td>
      </tr>`).join("") || `<tr><td colspan="2" class="muted">No data.</td></tr>`;
  setTable(head, body);
}

async function renderVendorsView(sold){
  setCards({ calls: 0, av12x: sold?.team?.totalAV12x||0, deals: sold?.team?.totalSales||0 });
  const head = `
    <tr><th colspan="2">Lead Vendors — % of Sales (Last 45 days)</th></tr>`;
  const boxRow = `<tr><td colspan="2"><div id="vendorsBox"></div></td></tr>`;
  setTable(head, boxRow);

  let data = vendorsFromAllSales(sold);
  if (!data.length){
    const fallback = await getJSON("/sales_by_vendor.json");
    if (Array.isArray(fallback)) data = fallback.map(x=>({vendor:x.vendor||x.name||"Unknown", count:Number(x.count||x.sales||0)}));
  }

  const box = $("#vendorsBox");
  if (!box) return;
  if (!data.length){
    box.innerHTML = `<div class="muted" style="padding:14px">No vendor chart available.</div>`;
    return;
  }
  const total = data.reduce((s,v)=>s+Number(v.count||0),0) || 1;
  box.innerHTML = data.map(v=>{
    const c = Number(v.count||0);
    const pct = Math.round((c/total)*100);
    return `<div class="vendor-row"><span>${escapeHtml(v.vendor)}</span><span class="num">${c.toLocaleString("en-US")} (${pct}%)</span></div>`;
  }).join("");
}

/* ---------------- Live updater + rotation + sale pop ---------------- */
let CURRENT_VIEW_IDX = 0;
let LAST_ALLSALE_IDS = new Set();  // to detect brand-new sales

function showView(name, sold){
  if (name==="roster")      renderRoster(sold);
  else if (name==="aow")    renderAOW(sold);
  else if (name==="leaderboard") renderLeaderboard(sold);
  else                      renderVendorsView(sold);
}

function rotate(sold){
  CURRENT_VIEW_IDX = (CURRENT_VIEW_IDX + 1) % VIEWS.length;
  showView(VIEWS[CURRENT_VIEW_IDX], sold);
}

function collectSaleIds(sold){
  const ids = new Set();
  for (const x of (sold?.allSales||[])){
    const id = String(x.leadId || x.id || x._id || (x.agent + "|" + x.dateSold));
    if (id) ids.add(id);
  }
  return ids;
}

function announceNewSales(prevIds, sold){
  const nowIds = collectSaleIds(sold);
  let announced = false;
  for (const x of (sold?.allSales||[])){
    const id = String(x.leadId || x.id || x._id || (x.agent + "|" + x.dateSold));
    if (!id || prevIds.has(id)) continue;
    const agent = x.agent || x.agentName || "New Sale";
    const av    = money(x.av12x || x.amount || 0);
    flashSale(`${escapeHtml(agent)} — ${av}`);
    announced = true;
  }
  return nowIds;
}

function flashSale(text){
  let el = $("#saleFlash");
  if (!el){
    el = document.createElement("div");
    el.id = "saleFlash";
    el.className = "sale-flash";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("on");
  setTimeout(()=> el.classList.remove("on"), 60_000); // show ~60s
}

/* ---------------- YTD optional (uses existing table if present) ---------------- */
function renderYTD(ytd){
  const head = byId("ytdHead");
  const body = byId("ytdBody");
  if (!head || !body || !Array.isArray(ytd)) return;

  head.innerHTML = `<tr><th>Agent</th><th style="text-align:right">YTD AV (12x)</th></tr>`;
  body.innerHTML = ytd.slice().sort((a,b)=>(b.av||0)-(a.av||0)).map(a=>`
    <tr>
      <td class="agent">${avatarHTML(a.name, a.email||"")}<span>${escapeHtml(a.name||"")}</span></td>
      <td class="num">${money(a.av||0)}</td>
    </tr>
  `).join("");
}

/* --------------------------------- Boot ----------------------------------- */
(async function boot(){
  // CSS for avatars, banner one-line, vendor rows, sale flash
  const css = `
  .agent{display:flex;align-items:center;gap:8px}
  .num{text-align:right}
  .avatar{width:28px;height:28px;border-radius:50%;object-fit:cover;display:inline-block}
  .avatar-fallback{width:28px;height:28px;border-radius:50%;background:#2a2f3a;color:#cbd5e1;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:12px}
  .vendor-row{display:flex;justify-content:space-between;padding:6px 2px;border-bottom:1px solid rgba(255,255,255,.08)}
  .muted{color:#7b8aa3}
  /* force title in one centered line if your theme allows */
  h1, .title, .site-title, .main-banner {white-space:nowrap;text-align:center}
  /* live-sale flash */
  .sale-flash{position:fixed;left:50%;top:18px;transform:translateX(-50%);padding:10px 16px;border:2px solid #ffcc55;border-radius:12px;background:rgba(30,30,30,.9);color:#ffde7a;font-weight:800;font-size:20px;letter-spacing:.3px;opacity:0;pointer-events:none;transition:opacity .25s}
  .sale-flash.on{opacity:1}
  `;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  // Load roster photos
  await loadRoster();

  // Initial fetch
  let sold = await getJSON("/api/team_sold");
  if (!sold) throw new Error("team_sold unavailable");
  mergePerAgentWithAllSales(sold);

  // Init last sale ids
  LAST_ALLSALE_IDS = collectSaleIds(sold);

  // Show first view
  showView(VIEWS[CURRENT_VIEW_IDX], sold);

  // Optional YTD render if table exists
  const ytd = await getJSON("/ytd_av.json");
  if (Array.isArray(ytd)) renderYTD(ytd);

  // Rotation timer
  setInterval(()=> rotate(sold), ROTATE_MS);

  // Poll for updates + new sale flash
  setInterval(async ()=>{
    const fresh = await getJSON("/api/team_sold");
    if (!fresh) return;
    mergePerAgentWithAllSales(fresh);

    // announce new sales
    LAST_ALLSALE_IDS = announceNewSales(LAST_ALLSALE_IDS, fresh);

    // replace in-memory model & refresh current view
    sold = fresh;
    showView(VIEWS[CURRENT_VIEW_IDX], sold);
  }, POLL_MS);

})().catch(e=>{
  const tbody = byId("tbody","rosterBody");
  if (tbody) tbody.innerHTML = `<tr><td style="padding:14px;color:#f66">Error loading dashboard: ${escapeHtml(e.message||e)}</td></tr>`;
  console.error(e);
});
